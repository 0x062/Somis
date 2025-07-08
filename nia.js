import "dotenv/config";
import { ethers } from "ethers";
// import { sendTelegramReport } from './telegramreporter.js'; // Aktifkan jika perlu

// --- PUSAT KONFIGURASI ---
const config = {
    rpcUrl: process.env.RPC_URL_SOMNIA_TESTNET,
    privateKey: process.env.PRIVATE_KEY,
    niaAddress: process.env.NIA_ADDRESS,
    routerAddress: "0xb98c15a0dC1e271132e341250703c7e94c059e8D",
    wsttAddress: "0xf22ef0085f6511f70b01a68f360dcc56261f768a",
    
    // --- Pengaturan Jumlah Swap ---
    // Jumlah STT yang akan dijual di Fase 1
    sttToSell: { 
        min: 0.2, 
        max: 1 
    },
    
    // --- Pengaturan Perilaku Bot ---
    delayBetweenPhases: 60000, // Jeda 60 detik antara Fase 1 dan Fase 2
    slippagePercent: 5, // 5%
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
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomNumber = (min, max, decimals = 5) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));

/**
 * Fungsi untuk mengeksekusi transaksi dengan penanganan nonce otomatis.
 */
async function executeTxWithRetry(txFn) {
    try {
        const nonce = await provider.getTransactionCount(wallet.address, "pending");
        const tx = await txFn(nonce);
        const receipt = await tx.wait();
        if (receipt.status === 1) return receipt;
        throw new Error("Transaksi revert oleh blockchain.");
    } catch (error) {
        logger.error(`Eksekusi Transaksi Gagal: ${error.message}`);
        throw error; // Lemparkan error agar proses bisa dihentikan
    }
}

/**
 * Mendapatkan dan menampilkan saldo STT & NIA saat ini.
 */
async function getAndShowBalances(label) {
    logger.info(`--- Saldo Wallet (${label}) ---`);
    try {
        const sttBalance = await provider.getBalance(wallet.address);
        const niaContract = new ethers.Contract(config.niaAddress, ["function balanceOf(address) view returns (uint256)"], provider);
        const niaBalance = await niaContract.balanceOf(wallet.address);
        
        logger.info(`   STT: ${parseFloat(ethers.formatEther(sttBalance)).toFixed(5)}`);
        logger.info(`   NIA: ${parseFloat(ethers.formatUnits(niaBalance, 18)).toFixed(5)}`); // Asumsi NIA 18 desimal
    } catch (error) {
        logger.error(`Gagal mendapatkan saldo: ${error.message}`);
    }
    logger.info(`------------------------------------`);
}

/**
 * FASE 1: Menjual sejumlah STT untuk mendapatkan NIA.
 */
async function swapSttToNia() {
    logger.log("Memulai Fase 1: Menjual STT ➔ NIA");
    const amountToSell = getRandomNumber(config.sttToSell.min, config.sttToSell.max);
    logger.info(`Akan menjual ${amountToSell} STT...`);
    
    try {
        const router = new ethers.Contract(config.routerAddress, ["function getAmountsOut(uint256, address[]) view returns (uint256[])", "function swapExactETHForTokens(uint, address[], address, uint) payable"], wallet);
        const amountIn = ethers.parseEther(amountToSell.toString());
        const path = [config.wsttAddress, config.niaAddress];
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        const amountsOut = await router.getAmountsOut(amountIn, path);
        const amountOutMin = (amountsOut[1] * BigInt(100 - config.slippagePercent)) / BigInt(100);

        const txFn = (nonce) => router.swapExactETHForTokens(amountOutMin, path, wallet.address, deadline, { value: amountIn, nonce });
        const receipt = await executeTxWithRetry(txFn);

        logger.success(`FASE 1 BERHASIL: ${amountToSell} STT ditukar ke NIA. Hash: ${receipt.hash}`);
        return true;
    } catch (error) {
        logger.error(`FASE 1 GAGAL: ${error.message}`);
        return false;
    }
}

/**
 * FASE 2: Menjual (sweep) seluruh saldo NIA kembali ke STT.
 */
async function sweepAllNiaToStt() {
    logger.log("Memulai Fase 2: Menjual semua NIA ➔ STT");

    try {
        const niaContract = new ethers.Contract(config.niaAddress, ["function balanceOf(address) view returns (uint256)", "function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)"], wallet);
        const router = new ethers.Contract(config.routerAddress, ["function getAmountsOut(uint256, address[]) view returns (uint256[])", "function swapExactTokensForETH(uint, uint, address[], address, uint)"], wallet);
        
        const niaBalance = await niaContract.balanceOf(wallet.address);
        if (niaBalance === 0n) {
            logger.warning("Saldo NIA adalah 0. Tidak ada yang perlu di-sweep.");
            return true; // Dianggap berhasil karena tidak ada tugas
        }
        
        logger.info(`Ditemukan ${ethers.formatUnits(niaBalance, 18)} NIA untuk di-sweep.`);

        // 1. Approve
        const currentAllowance = await niaContract.allowance(wallet.address, config.routerAddress);
        if (currentAllowance < niaBalance) {
            logger.info("Memerlukan approval untuk seluruh saldo NIA...");
            const approveTxFn = (nonce) => niaContract.approve(config.routerAddress, ethers.MaxUint256, { nonce });
            await executeTxWithRetry(approveTxFn);
            logger.success("Approval berhasil.");
        }

        // 2. Swap
        const path = [config.niaAddress, config.wsttAddress];
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
        const amountsOut = await router.getAmountsOut(niaBalance, path);
        const amountOutMin = (amountsOut[1] * BigInt(100 - config.slippagePercent)) / BigInt(100);
        
        const swapTxFn = (nonce) => router.swapExactTokensForETH(niaBalance, amountOutMin, path, wallet.address, deadline, { nonce });
        const receipt = await executeTxWithRetry(swapTxFn);
        
        logger.success(`FASE 2 BERHASIL: Seluruh NIA berhasil ditukar ke STT. Hash: ${receipt.hash}`);
        return true;
    } catch (error) {
        logger.error(`FASE 2 GAGAL: ${error.message}`);
        return false;
    }
}

/**
 * Fungsi utama untuk menjalankan keseluruhan proses.
 */
async function main() {
    logger.log("Memulai Bot Swap 2 Fase (STT ➔ NIA ➔ STT)...");

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
    
    await getAndShowBalances("Awal");

    // --- Menjalankan Fase 1 ---
    const fase1Success = await swapSttToNia();
    if (!fase1Success) {
        logger.error("Proses dihentikan karena Fase 1 gagal.");
        process.exit(1);
    }

    await getAndShowBalances("Setelah Fase 1");

    // Jeda sebelum lanjut ke fase berikutnya
    const delaySeconds = config.delayBetweenPhases / 1000;
    logger.log(`Menunggu ${delaySeconds} detik sebelum memulai Fase 2...`);
    await sleep(config.delayBetweenPhases);

    // --- Menjalankan Fase 2 ---
    await sweepAllNiaToStt();

    await getAndShowBalances("Akhir");
    logger.log("=== Bot Selesai ===");
}

main().catch(error => {
    logger.error(`Error fatal tidak tertangani: ${error.message}`);
    process.exit(1);
});
