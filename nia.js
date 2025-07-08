import "dotenv/config";
import { ethers } from "ethers";
// Pastikan file telegramreporter.js ada di folder yang sama
// import { sendTelegramReport } from './telegramreporter.js';

// --- PUSAT KONFIGURASI ---
const config = {
    rpcUrl: process.env.RPC_URL_SOMNIA_TESTNET,
    privateKey: process.env.PRIVATE_KEY,
    niaAddress: process.env.NIA_ADDRESS,
    routerAddress: "0xb98c15a0dC1e271132e341250703c7e94c059e8D",
    wsttAddress: "0xf22ef0085f6511f70b01a68f360dcc56261f768a",
    
    // --- Pengaturan Perilaku Bot ---
    iterations: 7, // Berapa kali swap akan diulang
    delayBetweenSwaps: { min: 30000, max: 60000 }, // Jeda antar swap 30-60 detik
    slippagePercent: 5, // 5%
    enableFinalSweep: true, // Set `true` untuk menjual semua sisa NIA ke STT di akhir

    // --- Pengaturan Jumlah Swap ---
    amountRanges: {
        stt: { min: 0.2, max: 1 },
        nia: { min: 10, max: 100 }
    }
};

// --- Logger Sederhana (Tanpa chalk) ---
const logger = {
    _log: (type, message) => console.log(`[${new Date().toLocaleTimeString()}] [${type}] ${message}`),
    info: (message) => logger._log("INFO", message),
    success: (message) => logger._log("✅ SUCCESS", message),
    warning: (message) => logger._log("⚠️ WARN", message),
    error: (message) => logger._log("❌ ERROR", message),
    log: (message) => logger._log("SYSTEM", message),
};

// --- Variabel Global (State) ---
let provider, wallet;
let lastSwapDirection = "NIA_TO_STT"; // Awalnya: Beli STT dengan menjual NIA

// --- Fungsi Bantuan ---
const getShortAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "N/A";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomDelay = () => Math.random() * (config.delayBetweenSwaps.max - config.delayBetweenSwaps.min) + config.delayBetweenSwaps.min;
const getRandomNumber = (min, max, decimals = 4) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));

/**
 * Fungsi untuk mengeksekusi transaksi dengan penanganan nonce otomatis.
 */
async function executeTxWithRetry(txFn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const nonce = await provider.getTransactionCount(wallet.address, "pending");
            const tx = await txFn(nonce);
            const receipt = await tx.wait();
            if (receipt.status === 1) return receipt;
            throw new Error("Transaksi revert.");
        } catch (error) {
            const msg = error.message.toLowerCase();
            if (msg.includes("nonce") || msg.includes("revert")) {
                logger.warning(`Tx gagal (coba ${i + 1}/${maxRetries}): ${msg}. Coba lagi...`);
                if (i === maxRetries - 1) throw error;
                await sleep(2000 * (i + 1));
            } else {
                throw error;
            }
        }
    }
}

/**
 * Mendapatkan saldo STT dan NIA, lalu menampilkannya.
 */
async function getAndUpdateBalances() {
    try {
        const sttBalanceBigInt = await provider.getBalance(wallet.address);
        const niaContract = new ethers.Contract(config.niaAddress, ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider);
        const niaBalanceBigInt = await niaContract.balanceOf(wallet.address);
        const niaDecimals = await niaContract.decimals();

        const balances = {
            stt: ethers.formatEther(sttBalanceBigInt),
            nia: ethers.formatUnits(niaBalanceBigInt, niaDecimals),
        };

        logger.info(`--- Saldo Wallet [${getShortAddress(wallet.address)}] ---`);
        logger.info(`   STT: ${parseFloat(balances.stt).toFixed(5)}`);
        logger.info(`   NIA: ${parseFloat(balances.nia).toFixed(5)}`);
        logger.info(`------------------------------------`);
        return balances;
    } catch (error) {
        logger.error(`Gagal mendapatkan saldo: ${error.message}`);
        return null;
    }
}

/**
 * Melakukan approval jika allowance token kurang dari yang dibutuhkan.
 */
async function approveToken(tokenAddress, amountStr, decimals) {
    const routerAddress = config.routerAddress;
    const tokenContract = new ethers.Contract(tokenAddress, ["function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)"], wallet);
    const amountToApprove = ethers.parseUnits(amountStr, decimals);
    const currentAllowance = await tokenContract.allowance(wallet.address, routerAddress);

    if (currentAllowance < amountToApprove) {
        logger.info(`Memberikan approval untuk ${amountStr} NIA...`);
        try {
            const txFn = (nonce) => tokenContract.approve(routerAddress, ethers.MaxUint256, { nonce });
            await executeTxWithRetry(txFn);
            logger.success("Approval token NIA berhasil.");
            return true;
        } catch (error) {
            logger.error(`Gagal approval token NIA: ${error.message}`);
            return false;
        }
    }
    return true;
}

/**
 * Fungsi utama untuk melakukan satu siklus swap STT <-> NIA.
 */
async function autoSwapSttNia() {
    logger.log("Memeriksa saldo dan memulai logika swap...");
    const balances = await getAndUpdateBalances();
    if (!balances) return false;

    const router = new ethers.Contract(config.routerAddress, ["function getAmountsOut(uint256, address[]) view returns (uint256[])", "function swapExactETHForTokens(uint, address[], address, uint) payable", "function swapExactTokensForETH(uint, uint, address[], address, uint)"], wallet);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 menit

    try {
        // --- LOGIKA 1: Jual NIA untuk dapat STT ---
        if (lastSwapDirection === "NIA_TO_STT") {
            const niaAmount = getRandomNumber(config.amountRanges.nia.min, config.amountRanges.nia.max);
            if (parseFloat(balances.nia) >= niaAmount) {
                logger.info(`Mencoba menjual ${niaAmount} NIA ➔ STT`);
                const niaDecimals = 18; // Asumsi desimal NIA adalah 18
                const amountIn = ethers.parseUnits(niaAmount.toString(), niaDecimals);
                const path = [config.niaAddress, config.wsttAddress];
                
                if (!await approveToken(config.niaAddress, niaAmount.toString(), niaDecimals)) return false;

                const amountsOut = await router.getAmountsOut(amountIn, path);
                const amountOutMin = (amountsOut[1] * BigInt(100 - config.slippagePercent)) / BigInt(100);

                const txFn = (nonce) => router.swapExactTokensForETH(amountIn, amountOutMin, path, wallet.address, deadline, { nonce });
                const receipt = await executeTxWithRetry(txFn);
                
                logger.success(`BERHASIL swap ${niaAmount} NIA ➔ STT. Hash: ${receipt.hash}`);
                lastSwapDirection = "STT_TO_NIA"; // Ubah arah untuk swap berikutnya
                return true;
            } else {
                logger.warning(`Saldo NIA (${balances.nia}) tidak cukup untuk swap ${niaAmount}. Mencoba arah sebaliknya.`);
                lastSwapDirection = "STT_TO_NIA"; // Langsung ganti arah
            }
        }
        
        // --- LOGIKA 2: Jual STT untuk dapat NIA ---
        if (lastSwapDirection === "STT_TO_NIA") {
            const sttAmount = getRandomNumber(config.amountRanges.stt.min, config.amountRanges.stt.max);
            if (parseFloat(balances.stt) >= sttAmount) {
                logger.info(`Mencoba menjual ${sttAmount} STT ➔ NIA`);
                const amountIn = ethers.parseEther(sttAmount.toString());
                const path = [config.wsttAddress, config.niaAddress];
                
                const amountsOut = await router.getAmountsOut(amountIn, path);
                const amountOutMin = (amountsOut[1] * BigInt(100 - config.slippagePercent)) / BigInt(100);

                const txFn = (nonce) => router.swapExactETHForTokens(amountOutMin, path, wallet.address, deadline, { value: amountIn, nonce });
                const receipt = await executeTxWithRetry(txFn);

                logger.success(`BERHASIL swap ${sttAmount} STT ➔ NIA. Hash: ${receipt.hash}`);
                lastSwapDirection = "NIA_TO_STT"; // Ubah arah untuk swap berikutnya
                return true;
            } else {
                logger.warning(`Saldo STT (${balances.stt}) tidak cukup untuk swap ${sttAmount}.`);
                lastSwapDirection = "NIA_TO_STT"; // Balikkan lagi agar mencoba beli STT lain kali
            }
        }
    } catch (error) {
        logger.error(`Terjadi error saat swap: ${error.message}`);
        return false;
    }
    
    logger.log("Tidak ada swap yang dilakukan pada iterasi ini.");
    return false;
}

/**
 * Menjual semua sisa token NIA ke STT.
 */
async function sweepNiaToStt() {
    logger.log("Memulai proses final sweep: Menjual semua sisa NIA ke STT...");
    const niaContract = new ethers.Contract(config.niaAddress, ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider);
    const balanceBigInt = await niaContract.balanceOf(wallet.address);
    const decimals = await niaContract.decimals();
    const balanceString = ethers.formatUnits(balanceBigInt, decimals);

    if (balanceBigInt === 0n) {
        logger.info("Saldo NIA adalah 0. Tidak ada yang perlu di-sweep.");
        return;
    }

    logger.info(`Ditemukan ${balanceString} NIA. Mencoba menjual semuanya...`);
    
    if (!await approveToken(config.niaAddress, balanceString, decimals)) {
        logger.error("Gagal approve untuk sweep. Proses sweep dibatalkan.");
        return;
    }

    try {
        const router = new ethers.Contract(config.routerAddress, ["function getAmountsOut(uint256, address[]) view returns (uint256[])", "function swapExactTokensForETH(uint, uint, address[], address, uint)"], wallet);
        const path = [config.niaAddress, config.wsttAddress];
        const amountsOut = await router.getAmountsOut(balanceBigInt, path);
        const amountOutMin = (amountsOut[1] * BigInt(95)) / BigInt(100); // Slippage 5%
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        const txFn = (nonce) => router.swapExactTokensForETH(balanceBigInt, amountOutMin, path, wallet.address, deadline, { nonce });
        const receipt = await executeTxWithRetry(txFn);
        logger.success(`BERHASIL sweep ${balanceString} NIA ➔ STT. Hash: ${receipt.hash}`);
    } catch (error) {
        logger.error(`Gagal melakukan sweep NIA: ${error.message}`);
    }
}


/**
 * Fungsi utama untuk menjalankan keseluruhan proses.
 */
async function main() {
    logger.log("Memulai Bot Swap STT-NIA...");
    
    // Inisialisasi provider dan wallet
    try {
        if (!config.rpcUrl || !config.privateKey) throw new Error("RPC_URL atau PRIVATE_KEY tidak ada di file .env");
        provider = new ethers.JsonRpcProvider(config.rpcUrl);
        wallet = new ethers.Wallet(config.privateKey, provider);
        const network = await provider.getNetwork();
        logger.success(`Terhubung ke ${network.name}. Wallet: ${wallet.address}`);
    } catch (e) {
        logger.error(`Error inisialisasi: ${e.message}`);
        process.exit(1);
    }
    
    // Loop utama untuk swap
    for (let i = 1; i <= config.iterations; i++) {
        logger.log(`--- Iterasi ${i}/${config.iterations} ---`);
        await autoSwapSttNia();
        
        if (i < config.iterations) {
            const delay = getRandomDelay();
            logger.log(`Menunggu ${Math.round(delay/1000)} detik untuk iterasi berikutnya...`);
            await sleep(delay);
        }
    }
    
    logger.log("Semua iterasi swap selesai.");
    
    // Proses sweep token di akhir
    if (config.enableFinalSweep) {
        await sweepNiaToStt();
    }

    logger.log("=== Bot Selesai ===");
    await getAndUpdateBalances(); // Tampilkan saldo akhir
}

main().catch(error => {
    logger.error(`Error fatal: ${error.message}`);
    process.exit(1);
});
