import "dotenv/config";
import { ethers } from "ethers";
import { sendTelegramReport } from './telegramreporter.js';

const RPC_URL = process.env.RPC_URL_SOMNIA_TESTNET;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const USDTG_ADDRESS = process.env.USDTG_ADDRESS;
const NIA_ADDRESS = process.env.NIA_ADDRESS;
const ROUTER_ADDRESS = "0xb98c15a0dC1e271132e341250703c7e94c059e8D";
const WSTT_ADDRESS = "0xf22ef0085f6511f70b01a68f360dcc56261f768a";
const NETWORK_NAME = "Somnia Testnet";
const DEBUG_MODE = false;

const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const ROUTER_ABI = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) public payable returns (uint256[])",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) public returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])"
  // Jika ingin lebih presisi mengisi kebutuhan, bisa tambahkan getAmountsIn:
  // "function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[])"
];

const randomAmountRanges = {
  "STT_USDTG": { STT: { min: 0.001, max: 0.002 }, USDTG: { min: 0.004, max: 0.005 } },
  "STT_NIA": { STT: { min: 0.001, max: 0.002 }, NIA: { min: 0.001, max: 0.002 } }
};

const globalHeaders = {
  'accept': 'application/json',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'origin': 'https://somnia.exchange',
  'pragma': 'no-cache',
  'priority': 'u=1, i',
  'referer': 'https://somnia.exchange/',
  'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Opera";v="119"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
};


let walletInfo = {
  address: "",
  balanceStt: "0.00",
  balanceUsdtg: "0.00",
  balanceNia: "0.00",
  points: 0,
  rank: 0,
  network: NETWORK_NAME,
  status: "Initializing"
};

let swapCancelled = false;
let globalWallet = null;
let provider = null;
let lastSwapDirectionSttUsdtg = "USDTG_TO_STT"; // Awalnya coba jual USDTG untuk dapat STT
let lastSwapDirectionSttNia = "NIA_TO_STT";     // Awalnya coba jual NIA untuk dapat STT

function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function addLog(message, type) {
  if (type === "debug" && !DEBUG_MODE) return;
  const timestamp = new Date().toLocaleTimeString();
  const cleanMessage = message.replace(/{[^}]+}/g, "");
  let prefix = `[${timestamp}]`;
  if (type) {
    prefix += ` [${type.toUpperCase()}]`;
  }
  console.log(`${prefix} ${cleanMessage}`);
}

function getRandomDelay() {
  return Math.random() * (60000 - 30000) + 30000;
}

function getRandomNumber(min, max, decimals = 4) {
  const random = Math.random() * (max - min) + min;
  return parseFloat(random.toFixed(decimals));
}

async function getTokenBalance(tokenAddress) {
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20ABI, provider);
    const balance = await contract.balanceOf(globalWallet.address);
    const decimals = await contract.decimals();
    return ethers.formatUnits(balance, decimals);
  } catch (error) {
    addLog(`Gagal mengambil saldo token ${ethers.getAddress(tokenAddress)}: ${error.message}`, "error");
    return "0";
  }
}

async function updateWalletData() {
  if (!provider || !globalWallet) {
    addLog("Provider atau wallet belum siap untuk updateWalletData.", "warning");
    try {
        provider = new ethers.JsonRpcProvider(RPC_URL);
        globalWallet = new ethers.Wallet(PRIVATE_KEY, provider);
    } catch (e) {
        addLog(`Gagal inisialisasi provider/wallet: ${e.message}`, "error");
        return;
    }
  }
  try {
    walletInfo.address = globalWallet.address;
    const sttBalance = await provider.getBalance(globalWallet.address);
    walletInfo.balanceStt = ethers.formatEther(sttBalance);
    walletInfo.balanceUsdtg = await getTokenBalance(USDTG_ADDRESS);
    walletInfo.balanceNia = await getTokenBalance(NIA_ADDRESS);

    const apiUrl = `https://api.somnia.exchange/api/leaderboard?wallet=${globalWallet.address}`;
    const response = await fetch(apiUrl, { headers: globalHeaders });
    if (response.ok) {
      const data = await response.json();
      walletInfo.points = data.success && data.currentUser ? data.currentUser.points : 0;
      walletInfo.rank = data.success && data.currentUser ? data.currentUser.rank : 0;
    } else {
      addLog(`Gagal ambil data leaderboard: ${response.statusText}`, "error");
      walletInfo.points = 0; walletInfo.rank = 0;
    }
    updateWallet();
    addLog("Informasi Wallet Diperbarui!", "system");
  } catch (error) {
    addLog(`Gagal update data wallet: ${error.message}`, "error");
  }
}

function updateWallet() {
  const shortAddress = getShortAddress(walletInfo.address);
  const stt = Number(walletInfo.balanceStt || 0).toFixed(4);
  const usdtg = Number(walletInfo.balanceUsdtg || 0).toFixed(2);
  const nia = Number(walletInfo.balanceNia || 0).toFixed(4);

  console.log(`
--- Informasi Wallet ---
Alamat    : ${shortAddress}
STT       : ${stt}
USDT.g    : ${usdtg}
NIA       : ${nia}
Poin      : ${walletInfo.points}
Peringkat : ${walletInfo.rank}
Network   : ${NETWORK_NAME}
----------------------`);
}

async function approveToken(tokenAddress, amountInString) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI, globalWallet);
    const decimals = await tokenContract.decimals();
    const amountToApprove = ethers.parseUnits(amountInString, decimals); // amountInString sudah string
    const currentAllowance = await tokenContract.allowance(globalWallet.address, ROUTER_ADDRESS);

    if (currentAllowance < amountToApprove) {
      addLog(`Meng-approve ${amountInString} token ${ethers.getAddress(tokenAddress)}...`, "swap");
      const approvalTx = await executeSwapWithNonceRetry(async (nonce) =>
        tokenContract.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce })
      , true);
      await approvalTx.wait();
      addLog(`Token ${ethers.getAddress(tokenAddress)} berhasil di-approve.`, "success");
    }
    return true;
  } catch (error) {
    addLog(`Gagal approve token ${ethers.getAddress(tokenAddress)}: ${error.message}`, "error");
    return false;
  }
}

async function getAmountOut(amountIn, path) {
  try {
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (error) {
    addLog(`Gagal hitung amountOut: ${error.message}`, "error");
    return ethers.parseEther("0");
  }
}

async function reportTransaction() {
  try {
    const payload = { address: globalWallet.address, taskId: "make-swap" };
    const response = await fetch("https://api.somnia.exchange/api/completeTask", {
      method: "POST", headers: globalHeaders, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (response.ok && data.success) {
      addLog(`Report Tx Berhasil: +${data.data.task.actualPointsAwarded} Poin`, "success");
      return true;
    }
    addLog(`Gagal Report Tx: ${data.error || response.statusText}`, "error");
    return false;
  } catch (error) {
    addLog(`Gagal Report Tx: ${error.message}`, "error");
    return false;
  }
}

async function executeSwapWithNonceRetry(txFn, returnTx = false, maxRetries = 3) {
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      const nonce = await provider.getTransactionCount(globalWallet.address, "pending");
      const tx = await txFn(nonce);
      if (returnTx) return tx;
      const receipt = await tx.wait();
      if (receipt.status === 1) return receipt;
      throw new Error("Transaksi reverted");
    } catch (error) {
      const errMsg = error.message.toLowerCase();
      if (errMsg.includes("nonce too low") || errMsg.includes("nonce has already been used") || errMsg.includes("reverted")) {
        addLog(`Tx gagal (coba ${retry + 1}/${maxRetries}): ${error.message}. Coba lagi...`, "warning");
        if (retry === maxRetries - 1) throw new Error(`Gagal setelah ${maxRetries} coba: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (retry + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Gagal eksekusi tx setelah ${maxRetries} coba.`);
}


async function autoSwapSttUsdtg() {
  await updateWalletData(); // Selalu update saldo di awal
  if (!globalWallet) { addLog("Wallet STT/USDTG belum siap.", "error"); return false; }

  const sttSwapAmount = getRandomNumber(randomAmountRanges.STT_USDTG.STT.min, randomAmountRanges.STT_USDTG.STT.max, 4);
  const usdtgSwapAmount = getRandomNumber(randomAmountRanges.STT_USDTG.USDTG.min, randomAmountRanges.STT_USDTG.USDTG.max, 4);
  const sttBalance = parseFloat(walletInfo.balanceStt);
  const usdtgBalance = parseFloat(walletInfo.balanceUsdtg);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, globalWallet);

  addLog(`[STT/USDTG] Arah: ${lastSwapDirectionSttUsdtg}. Saldo: STT ${sttBalance.toFixed(4)}, USDTG ${usdtgBalance.toFixed(2)}. Target Acak: STT ${sttSwapAmount}, USDTG ${usdtgSwapAmount}`, "debug");

  try {
    // ----- UTAMAKAN JUAL USDTG UNTUK DAPAT STT -----
    if (lastSwapDirectionSttUsdtg === "USDTG_TO_STT") {
      if (usdtgBalance >= usdtgSwapAmount) {
        addLog(`[STT/USDTG] Coba jual ${usdtgSwapAmount} USDT.g ➯ STT`, "swap");
        const tokenContract = new ethers.Contract(USDTG_ADDRESS, ERC20ABI, globalWallet);
        const decimals = await tokenContract.decimals();
        const amountIn = ethers.parseUnits(usdtgSwapAmount.toString(), decimals);
        const path = [USDTG_ADDRESS, WSTT_ADDRESS];
        const amountOutMin = await getAmountOut(amountIn, path);
        if (amountOutMin === ethers.toBigInt(0)) { addLog("[STT/USDTG] Gagal dapat amountOutMin untuk USDT.g->STT", "error"); return false;}
        const slippage = amountOutMin * BigInt(95) / BigInt(100);

        if (!await approveToken(USDTG_ADDRESS, usdtgSwapAmount.toString())) return false;
        
        const receipt = await executeSwapWithNonceRetry(async (nonce) =>
          routerContract.swapExactTokensForETH(amountIn, slippage, path, globalWallet.address, deadline, { gasLimit: 300000, nonce })
        );
        if (receipt && receipt.status === 1) {
          addLog(`[STT/USDTG] SUKSES: ${usdtgSwapAmount} USDT.g ➯ STT. Hash: ${receipt.hash}`, "success");
          await reportTransaction();
          lastSwapDirectionSttUsdtg = "STT_TO_USDTG"; // Berikutnya jual STT
          return true;
        }
      } else {
        addLog(`[STT/USDTG] Saldo USDT.g (${usdtgBalance.toFixed(2)}) tidak cukup untuk jual ${usdtgSwapAmount} USDT.g. Coba jual STT.`, "warning");
        // Otomatis lanjut ke blok STT_TO_USDTG di bawah jika ini gagal
      }
    }

    // ----- JIKA GAGAL DI ATAS ATAU ARAHNYA MEMANG JUAL STT -----
    // (lastSwapDirectionSttUsdtg === "STT_TO_USDTG" atau kondisi dari atas)
    if (sttBalance >= sttSwapAmount) {
      addLog(`[STT/USDTG] Coba jual ${sttSwapAmount} STT ➯ USDT.g`, "swap");
      const amountIn = ethers.parseEther(sttSwapAmount.toString());
      const path = [WSTT_ADDRESS, USDTG_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      if (amountOutMin === ethers.toBigInt(0)) { addLog("[STT/USDTG] Gagal dapat amountOutMin untuk STT->USDT.g", "error"); return false;}
      const slippage = amountOutMin * BigInt(95) / BigInt(100);
      
      const receipt = await executeSwapWithNonceRetry(async (nonce) =>
        routerContract.swapExactETHForTokens(slippage, path, globalWallet.address, deadline, { value: amountIn, gasLimit: 300000, nonce })
      );
      if (receipt && receipt.status === 1) {
        addLog(`[STT/USDTG] SUKSES: ${sttSwapAmount} STT ➯ USDT.g. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttUsdtg = "USDTG_TO_STT"; // Berikutnya jual USDTG
        return true;
      }
    } else {
      addLog(`[STT/USDTG] Saldo STT (${sttBalance.toFixed(4)}) juga tidak cukup untuk jual ${sttSwapAmount} STT. Tidak ada swap.`, "warning");
    }

  } catch (error) {
    addLog(`[STT/USDTG] Gagal swap: ${error.message}`, "error");
  }
  return false; // Jika semua upaya gagal
}


async function autoSwapSttNia() {
  await updateWalletData();
  if (!globalWallet) { addLog("Wallet STT/NIA belum siap.", "error"); return false; }

  const sttSwapAmount = getRandomNumber(randomAmountRanges.STT_NIA.STT.min, randomAmountRanges.STT_NIA.STT.max, 4);
  const niaSwapAmount = getRandomNumber(randomAmountRanges.STT_NIA.NIA.min, randomAmountRanges.STT_NIA.NIA.max, 4);
  const sttBalance = parseFloat(walletInfo.balanceStt);
  const niaBalance = parseFloat(walletInfo.balanceNia);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, globalWallet);

  addLog(`[STT/NIA] Arah: ${lastSwapDirectionSttNia}. Saldo: STT ${sttBalance.toFixed(4)}, NIA ${niaBalance.toFixed(4)}. Target Acak: STT ${sttSwapAmount}, NIA ${niaSwapAmount}`, "debug");

  try {
    // ----- UTAMAKAN JUAL NIA UNTUK DAPAT STT -----
    if (lastSwapDirectionSttNia === "NIA_TO_STT") {
      if (niaBalance >= niaSwapAmount) {
        addLog(`[STT/NIA] Coba jual ${niaSwapAmount} NIA ➯ STT`, "swap");
        const tokenContract = new ethers.Contract(NIA_ADDRESS, ERC20ABI, globalWallet);
        const decimals = await tokenContract.decimals();
        const amountIn = ethers.parseUnits(niaSwapAmount.toString(), decimals);
        const path = [NIA_ADDRESS, WSTT_ADDRESS];
        const amountOutMin = await getAmountOut(amountIn, path);
        if (amountOutMin === ethers.toBigInt(0)) { addLog("[STT/NIA] Gagal dapat amountOutMin untuk NIA->STT", "error"); return false; }
        const slippage = amountOutMin * BigInt(95) / BigInt(100);

        if (!await approveToken(NIA_ADDRESS, niaSwapAmount.toString())) return false;

        const receipt = await executeSwapWithNonceRetry(async (nonce) =>
          routerContract.swapExactTokensForETH(amountIn, slippage, path, globalWallet.address, deadline, { gasLimit: 300000, nonce })
        );
        if (receipt && receipt.status === 1) {
          addLog(`[STT/NIA] SUKSES: ${niaSwapAmount} NIA ➯ STT. Hash: ${receipt.hash}`, "success");
          await reportTransaction();
          lastSwapDirectionSttNia = "STT_TO_NIA"; // Berikutnya jual STT
          return true;
        }
      } else {
        addLog(`[STT/NIA] Saldo NIA (${niaBalance.toFixed(4)}) tidak cukup untuk jual ${niaSwapAmount} NIA. Coba jual STT.`, "warning");
      }
    }

    // ----- JIKA GAGAL DI ATAS ATAU ARAHNYA MEMANG JUAL STT -----
    if (sttBalance >= sttSwapAmount) {
      addLog(`[STT/NIA] Coba jual ${sttSwapAmount} STT ➯ NIA`, "swap");
      const amountIn = ethers.parseEther(sttSwapAmount.toString());
      const path = [WSTT_ADDRESS, NIA_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
       if (amountOutMin === ethers.toBigInt(0)) { addLog("[STT/NIA] Gagal dapat amountOutMin untuk STT->NIA", "error"); return false; }
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      const receipt = await executeSwapWithNonceRetry(async (nonce) =>
        routerContract.swapExactETHForTokens(slippage, path, globalWallet.address, deadline, { value: amountIn, gasLimit: 300000, nonce })
      );
      if (receipt && receipt.status === 1) {
        addLog(`[STT/NIA] SUKSES: ${sttSwapAmount} STT ➯ NIA. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttNia = "NIA_TO_STT"; // Berikutnya jual NIA
        return true;
      }
    } else {
      addLog(`[STT/NIA] Saldo STT (${sttBalance.toFixed(4)}) juga tidak cukup untuk jual ${sttSwapAmount} STT. Tidak ada swap.`, "warning");
    }

  } catch (error) {
    addLog(`[STT/NIA] Gagal swap: ${error.message}`, "error");
  }
  return false;
}

async function main() {
  addLog("Memulai skrip otomatis (versi STT awet)...", "system");
  addLog("Jangan Lupa Subscribe YT Dan Telegram @NTExhaust!! :D", "system");
  
  if (!RPC_URL || !PRIVATE_KEY || !USDTG_ADDRESS || !NIA_ADDRESS) {
    addLog("Variabel environment penting belum diatur. Cek file .env Anda.", "error");
    process.exit(1);
  }
  
  // Inisialisasi awal provider dan wallet
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    globalWallet = new ethers.Wallet(PRIVATE_KEY, provider);
  } catch (e) {
    addLog(`Koneksi RPC atau Private Key bermasalah: ${e.message}`, "error");
    process.exit(1);
  }


  await updateWalletData(); // Panggil sekali di awal untuk memastikan saldo ada

  const iterationsSttUsdtg = 6; // Atur jumlah iterasi yang diinginkan
  const iterationsSttNia = 6;   // Atur jumlah iterasi yang diinginkan
  const enableSttUsdtgSwap = true;
  const enableSttNiaSwap = true;

  if (enableSttUsdtgSwap) {
    addLog(`[LOOP STT/USDTG] Memulai ${iterationsSttUsdtg} iterasi.`, "system");
    for (let i = 1; i <= iterationsSttUsdtg; i++) {
      if (swapCancelled) { addLog(`[LOOP STT/USDTG] Dibatalkan.`, "warning"); break; }
      addLog(`[LOOP STT/USDTG] Iterasi ke-${i} dari ${iterationsSttUsdtg}`, "system");
      
      const success = await autoSwapSttUsdtg();
      // updateWalletData sudah dipanggil di awal autoSwapSttUsdtg
      
      if (!success) {
        addLog(`[LOOP STT/USDTG] Iterasi ke-${i} tidak ada transaksi berhasil/dilewati.`, "info");
      }

      if (i < iterationsSttUsdtg && !swapCancelled) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        addLog(`[LOOP STT/USDTG] Menunggu ${minutes}m ${seconds}d...`, "system");
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    }
    addLog(`[LOOP STT/USDTG] Selesai.`, "system");
  }

  if (enableSttNiaSwap && !swapCancelled) {
    addLog(`[LOOP STT/NIA] Memulai ${iterationsSttNia} iterasi.`, "system");
    for (let i = 1; i <= iterationsSttNia; i++) {
      if (swapCancelled) { addLog(`[LOOP STT/NIA] Dibatalkan.`, "warning"); break; }
      addLog(`[LOOP STT/NIA] Iterasi ke-${i} dari ${iterationsSttNia}`, "system");
      
      const success = await autoSwapSttNia();
      // updateWalletData sudah dipanggil di awal autoSwapSttNia
      
      if (!success) {
        addLog(`[LOOP STT/NIA] Iterasi ke-${i} tidak ada transaksi berhasil/dilewati.`, "info");
      }

      if (i < iterationsSttNia && !swapCancelled) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        addLog(`[LOOP STT/NIA] Menunggu ${minutes}m ${seconds}d...`, "system");
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    }
    addLog(`[LOOP STT/NIA] Selesai.`, "system");
  }

  addLog("Semua task swap otomatis selesai.", "system");
  process.exit(0);
}

main().catch(error => {
  addLog(`Error fatal: ${error.message}${error.stack ? `\nStack: ${error.stack}` : ''}`, "error");
  process.exit(1);
});
