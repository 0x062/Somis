import "dotenv/config";
import { ethers } from "ethers";

// --- PUSAT KONFIGURASI ---
const config = {
    rpcUrl: process.env.RPC_URL_SOMNIA_TESTNET,
    privateKey: process.env.PRIVATE_KEY,
    niaAddress: process.env.NIA_ADDRESS,
    routerAddress: "0xb98c15a0dC1e271132e341250703c7e94c059e8D",
    wsttAddress: "0xf22ef0085f6511f70b01a68f360dcc56261f768a",
    
    // --- Pengaturan Perilaku Bot ---
    iterations: 10, // 👈 Tentukan berapa kali swap di sini
    delayBetweenSwaps: { min: 30000, max: 60000 }, // Jeda antar swap 30-60 detik
    slippagePercent: 5,

    // --- Pengaturan Jumlah Swap (acak) ---
    amountRanges: {
        stt: { min: 0.2, max: 1.2 },
        nia: { min: 1, max: 100 }
    }
};

// --- Logger Sederhana ---
const logger = {
    _log: (type, message) => console.log(`[${new Date().toLocaleTimeString()}] [${type}] ${message}`),
    info: (message) => logger._log("INFO", message),
    success: (message) => logger._log("✅ SUCCESS", message),
    warning: (message) => logger._log("⚠️ WARN", message),
    error: (message) => logger._log("❌ ERROR", message),
    log: (message) => logger._log("SYSTEM", message),
};

// --- Variabel Global & Fungsi Bantuan ---
let provider, wallet;
let lastSwapDirection = "NIA_TO_STT"; // Arah awal: Jual NIA untuk beli STT
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomDelay = () => Math.random() * (config.delayBetweenSwaps.max - config.delayBetweenSwaps.min) + config.delayBetweenSwaps.min;
const getRandomNumber = (min, max, decimals = 5) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));

async function executeTxWithRetry(txFn) {
    try {
        const nonce = await provider.getTransactionCount(wallet.address, "pending");
        const tx = await txFn(nonce);
        const receipt = await tx.wait();
        if (receipt.status === 1) return receipt;
        throw new Error("Transaksi revert oleh blockchain.");
    } catch (error) {
        logger.error(`Eksekusi Transaksi Gagal: ${error.message}`);
        throw error;
    }
}

async function getAndShowBalances() {
    // Fungsi ini bisa dibuat lebih detail jika perlu, untuk sekarang kita fokus ke loop
    const sttBalance = await provider.getBalance(wallet.address);
    const niaContract = new ethers.Contract(config.niaAddress, ["function balanceOf(address) view returns (uint256)"], provider);
    const niaBalance = await niaContract.balanceOf(wallet.address);
    const balances = {
        stt: ethers.formatEther(sttBalance),
        nia: ethers.formatUnits(niaBalance, 18),
    };
    logger.info(`Saldo saat ini -> STT: ${parseFloat(balances.stt).toFixed(4)}, NIA: ${parseFloat(balances.nia).toFixed(4)}`);
    return balances;
}

// Fungsi swap bolak-balik
async function autoSwapSttNia() {
    logger.log(`Memeriksa saldo dan memulai logika swap. Arah target: ${lastSwapDirection}`);
    const balances = await getAndShowBalances();
    if (!balances) return false;

    const router = new ethers.Contract(config.routerAddress, ["function getAmountsOut(uint256, address[]) view returns (uint256[])", "function swapExactETHForTokens(uint, address[], address, uint) payable", "function swapExactTokensForETH(uint, uint, address[], address, uint)", "function approve(address, uint)"], wallet);
    const niaContract = new ethers.Contract(config.niaAddress, ["function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)"], wallet);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    try {
        // --- LOGIKA JUAL NIA -> STT ---
        if (lastSwapDirection === "NIA_TO_STT") {
            const niaAmount = getRandomNumber(config.amountRanges.nia.min, config.amountRanges.nia.max);
            if (parseFloat(balances.nia) >= niaAmount) {
                logger.info(`Mencoba menjual ${niaAmount} NIA ➔ STT`);
                const amountIn = ethers.parseUnits(niaAmount.toString(), 18);

                // Approve jika perlu
                const currentAllowance = await niaContract.allowance(wallet.address, config.routerAddress);
                if (currentAllowance < amountIn) {
                    logger.info("Approval dibutuhkan untuk NIA...");
                    await executeTxWithRetry((nonce) => niaContract.approve(config.routerAddress, ethers.MaxUint256, { nonce }));
                    logger.success("Approval NIA berhasil.");
                }

                // Swap
                const path = [config.niaAddress, config.wsttAddress];
                const amountsOut = await router.getAmountsOut(amountIn, path);
                const amountOutMin = (amountsOut[1] * BigInt(100 - config.slippagePercent)) / BigInt(100);
                const receipt = await executeTxWithRetry((nonce) => router.swapExactTokensForETH(amountIn, amountOutMin, path, wallet.address, deadline, { nonce }));
                
                logger.success(`BERHASIL swap ${niaAmount} NIA ➔ STT. Hash: ${receipt.hash}`);
                lastSwapDirection = "STT_TO_NIA"; // Ubah arah untuk swap berikutnya
                return true;
            } else {
                logger.warning(`Saldo NIA (${balances.nia}) tidak cukup. Mengubah arah ke STT -> NIA.`);
                lastSwapDirection = "STT_TO_NIA";
            }
        }
        
        // --- LOGIKA JUAL STT -> NIA ---
        if (lastSwapDirection === "STT_TO_NIA") {
            const sttAmount = getRandomNumber(config.amountRanges.stt.min, config.amountRanges.stt.max);
            if (parseFloat(balances.stt) >= sttAmount) {
                logger.info(`Mencoba menjual ${sttAmount} STT ➔ NIA`);
                const amountIn = ethers.parseEther(sttAmount.toString());
                const path = [config.wsttAddress, config.niaAddress];
                
                const amountsOut = await router.getAmountsOut(amountIn, path);
                const amountOutMin = (amountsOut[1] * BigInt(100 - config.slippagePercent)) / BigInt(100);

                const receipt = await executeTxWithRetry((nonce) => router.swapExactETHForTokens(amountOutMin, path, wallet.address, deadline, { value: amountIn, nonce }));
                
                logger.success(`BERHASIL swap ${sttAmount} STT ➔ NIA. Hash: ${receipt.hash}`);
                lastSwapDirection = "NIA_TO_STT"; // Ubah arah untuk swap berikutnya
                return true;
            } else {
                logger.warning(`Saldo STT (${balances.stt}) tidak cukup. Mengubah arah ke NIA -> STT.`);
                lastSwapDirection = "NIA_TO_STT";
            }
        }
    } catch (error) {
        logger.error(`Terjadi error saat swap: ${error.message}`);
        return false;
    }
    
    logger.log("Tidak ada saldo yang cukup untuk swap pada iterasi ini.");
    return false;
}

async function main() {
    logger.log("Memulai Bot Swap Versi Looping...");

    try {
        provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { timeout: 20000 });
        wallet = new ethers.Wallet(config.privateKey, provider);
        const network = await provider.getNetwork();
        logger.success(`Terhubung ke ${network.name || 'jaringan custom'}. Wallet: ${wallet.address}`);
    } catch (e) {
        logger.error(`Error inisialisasi: ${e.message}`);
        process.exit(1);
    }
    
    // Loop utama untuk swap
    for (let i = 1; i <= config.iterations; i++) {
        logger.log(`--- Iterasi ${i} dari ${config.iterations} ---`);
        await autoSwapSttNia();
        
        if (i < config.iterations) {
            const delay = getRandomDelay();
            logger.log(`Menunggu ${Math.round(delay/1000)} detik untuk iterasi berikutnya...`);
            await sleep(delay);
        }
    }
    
    logger.log("=== Semua Iterasi Selesai ===");
    await getAndShowBalances();
}

main().catch(error => {
    logger.error(`Error fatal: ${error.message}`);
    console.error(error); // Cetak detail error stack
    process.exit(1);
});
