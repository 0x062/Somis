import "dotenv/config";
import { ethers } from "ethers";

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
];

const randomAmountRanges = {
  "STT_USDTG": { STT: { min: 0.01, max: 0.05 }, USDTG: { min: 0.04, max: 0.21 } },
  "STT_NIA": { STT: { min: 0.01, max: 0.05 }, NIA: { min: 2, max: 10 } }
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
let lastSwapDirectionSttUsdtg = "USDTG_TO_STT";
let lastSwapDirectionSttNia = "NIA_TO_STT";

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
    addLog(`Gagal mengambil saldo token ${tokenAddress}: ${error.message}`, "error");
    return "0";
  }
}

async function updateWalletData() {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    globalWallet = wallet;
    walletInfo.address = wallet.address;

    const sttBalance = await provider.getBalance(wallet.address);
    walletInfo.balanceStt = ethers.formatEther(sttBalance);

    walletInfo.balanceUsdtg = await getTokenBalance(USDTG_ADDRESS);
    walletInfo.balanceNia = await getTokenBalance(NIA_ADDRESS);

    const apiUrl = `https://api.somnia.exchange/api/leaderboard?wallet=${wallet.address}`;
    const response = await fetch(apiUrl, { headers: globalHeaders });
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.currentUser) {
        walletInfo.points = data.currentUser.points;
        walletInfo.rank = data.currentUser.rank;
      } else {
        walletInfo.points = 0;
        walletInfo.rank = 0;
      }
    } else {
      addLog(`Gagal mengambil data leaderboard: ${response.statusText}`, "error");
      walletInfo.points = 0;
      walletInfo.rank = 0;
    }
    updateWallet();
    addLog("Informasi Wallet Diperbarui!", "system");
  } catch (error) {
    addLog("Gagal mengambil data wallet: " + error.message, "error");
  }
}

function updateWallet() {
  const shortAddress = walletInfo.address ? getShortAddress(walletInfo.address) : "N/A";
  const stt = walletInfo.balanceStt ? Number(walletInfo.balanceStt).toFixed(4) : "0.0000";
  const usdtg = walletInfo.balanceUsdtg ? Number(walletInfo.balanceUsdtg).toFixed(2) : "0.00";
  const nia = walletInfo.balanceNia ? Number(walletInfo.balanceNia).toFixed(4) : "0.0000";
  const points = walletInfo.points;
  const rank = walletInfo.rank;

  console.log("\n--- Informasi Wallet ---");
  console.log(`Alamat    : ${shortAddress}`);
  console.log(`STT       : ${stt}`);
  console.log(`USDT.g    : ${usdtg}`);
  console.log(`NIA       : ${nia}`);
  console.log(`Poin      : ${points}`);
  console.log(`Peringkat : ${rank}`);
  console.log(`Network   : ${NETWORK_NAME}`);
  console.log("----------------------\n");
}

async function approveToken(tokenAddress, amountInString) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI, globalWallet);
    const decimals = await tokenContract.decimals();
    const amountToApprove = ethers.parseUnits(amountInString.toString(), decimals);
    const currentAllowance = await tokenContract.allowance(globalWallet.address, ROUTER_ADDRESS);

    if (currentAllowance < amountToApprove) {
      addLog(`Meng-approve ${amountInString} token ${ethers.getAddress(tokenAddress)} untuk router...`, "swap");
      const approvalTx = await executeSwapWithNonceRetry(async (nonce) => {
        return await tokenContract.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce });
      }, true);
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
    addLog(`Gagal menghitung amountOut: ${error.message}`, "error");
    return ethers.parseEther("0");
  }
}

async function reportTransaction() {
  try {
    const payload = {
      address: globalWallet.address,
      taskId: "make-swap"
    };
    const response = await fetch("https://api.somnia.exchange/api/completeTask", {
      method: "POST",
      headers: globalHeaders,
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (response.ok && data.success) {
      addLog(`Report Transaction Berhasil: +${data.data.task.actualPointsAwarded} Points`, "success");
      return true;
    } else {
      addLog(`Gagal Report Transaction: ${data.error || response.statusText}`, "error");
      return false;
    }
  } catch (error) {
    addLog(`Gagal Report Transaction: ${error.message}`, "error");
    return false;
  }
}

async function executeSwapWithNonceRetry(txFn, returnTx = false, maxRetries = 3) {
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      let nonce = await provider.getTransactionCount(globalWallet.address, "pending");
      const tx = await txFn(nonce);
      if (returnTx) return tx;
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        return receipt;
      } else {
        throw new Error("Transaksi reverted");
      }
    } catch (error) {
      if (error.message.includes("nonce too low") || error.message.includes("nonce has already been used") || error.message.includes("reverted")) {
        addLog(`Transaksi gagal (percobaan ${retry + 1}/${maxRetries}): ${error.message}. Mencoba lagi...`, "warning");
        if (retry === maxRetries - 1) {
          throw new Error(`Gagal setelah ${maxRetries} percobaan: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * (retry + 1)));
        continue;
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Gagal mengeksekusi transaksi setelah ${maxRetries} percobaan.`);
}

async function autoSwapSttUsdtg() {
  try {
    if (!globalWallet) {
        addLog("Wallet belum terinisialisasi.", "error");
        return false;
    }
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, globalWallet);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    if (!walletInfo.balanceStt || !walletInfo.balanceUsdtg) {
        addLog("Data saldo STT/USDTG belum lengkap. Lakukan refresh.", "warning");
        await updateWalletData();
        if (!walletInfo.balanceStt || !walletInfo.balanceUsdtg) {
            addLog("Gagal mendapatkan data saldo STT/USDTG setelah refresh.", "error");
            return false;
        }
    }

    const sttBalance = parseFloat(walletInfo.balanceStt);
    const usdtgBalance = parseFloat(walletInfo.balanceUsdtg);
    
    const sttAmountConfig = randomAmountRanges["STT_USDTG"].STT;
    const usdtgAmountConfig = randomAmountRanges["STT_USDTG"].USDTG;

    const sttAmount = getRandomNumber(sttAmountConfig.min, sttAmountConfig.max, 4);
    const usdtgAmount = getRandomNumber(usdtgAmountConfig.min, usdtgAmountConfig.max, 4);

    addLog(`Arah swap STT/USDTG: ${lastSwapDirectionSttUsdtg}`, "debug");
    addLog(`Saldo: STT=${sttBalance.toFixed(4)}, USDT.g=${usdtgBalance.toFixed(2)}`, "debug");
    addLog(`Jumlah acak: STT=${sttAmount}, USDT.g=${usdtgAmount}`, "debug");

    let receipt;

    if (lastSwapDirectionSttUsdtg === "USDTG_TO_STT") {
      if (usdtgBalance < usdtgAmount) {
        addLog(`Saldo USDT.g tidak cukup: ${usdtgBalance.toFixed(2)} < ${usdtgAmount}. Arah swap menjadi STT_TO_USDTG.`, "warning");
        lastSwapDirectionSttUsdtg = "STT_TO_USDTG";
        return false; 
      }

      const tokenContract = new ethers.Contract(USDTG_ADDRESS, ERC20ABI, globalWallet);
      const decimals = await tokenContract.decimals();
      const amountIn = ethers.parseUnits(usdtgAmount.toString(), decimals);
      const path = [USDTG_ADDRESS, WSTT_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      if (amountOutMin === ethers.parseEther("0")) return false;
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      const approved = await approveToken(USDTG_ADDRESS, usdtgAmount.toString());
      if (!approved) return false;

      addLog(`Melakukan swap ${usdtgAmount} USDT.g ➯ STT`, "swap");
      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactTokensForETH(amountIn, slippage, path, globalWallet.address, deadline, { gasLimit: 300000, nonce });
      });

      if (receipt && receipt.status === 1) {
        addLog(`Swap USDT.g ➯ STT Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttUsdtg = "STT_TO_USDTG";
        addLog(`Arah swap STT/USDTG diubah ke: ${lastSwapDirectionSttUsdtg}`, "debug");
        return true;
      }
    } else {
      if (sttBalance < sttAmount) {
        addLog(`Saldo STT tidak cukup: ${sttBalance.toFixed(4)} < ${sttAmount}. Arah swap menjadi USDTG_TO_STT.`, "warning");
        lastSwapDirectionSttUsdtg = "USDTG_TO_STT";
        return false;
      }

      const amountIn = ethers.parseEther(sttAmount.toString());
      const path = [WSTT_ADDRESS, USDTG_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      if (amountOutMin === ethers.parseEther("0")) return false;
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      addLog(`Melakukan swap ${sttAmount} STT ➯ USDT.g`, "swap");
      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactETHForTokens(slippage, path, globalWallet.address, deadline, { value: amountIn, gasLimit: 300000, nonce });
      });
      
      if (receipt && receipt.status === 1) {
        addLog(`Swap STT ➯ USDT.g Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttUsdtg = "USDTG_TO_STT";
        addLog(`Arah swap STT/USDTG diubah ke: ${lastSwapDirectionSttUsdtg}`, "debug");
        return true;
      }
    }
    return false;
  } catch (error) {
    addLog(`Gagal swap STT/USDTG: ${error.message}`, "error");
    return false;
  }
}

async function autoSwapSttNia() {
  try {
    if (!globalWallet) {
        addLog("Wallet belum terinisialisasi.", "error");
        return false;
    }
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, globalWallet);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    if (!walletInfo.balanceStt || !walletInfo.balanceNia) {
        addLog("Data saldo STT/NIA belum lengkap. Lakukan refresh.", "warning");
        await updateWalletData();
        if (!walletInfo.balanceStt || !walletInfo.balanceNia) {
            addLog("Gagal mendapatkan data saldo STT/NIA setelah refresh.", "error");
            return false;
        }
    }

    const sttBalance = parseFloat(walletInfo.balanceStt);
    const niaBalance = parseFloat(walletInfo.balanceNia);

    const sttAmountConfig = randomAmountRanges["STT_NIA"].STT;
    const niaAmountConfig = randomAmountRanges["STT_NIA"].NIA;

    const sttAmount = getRandomNumber(sttAmountConfig.min, sttAmountConfig.max, 4);
    const niaAmount = getRandomNumber(niaAmountConfig.min, niaAmountConfig.max, 4);

    addLog(`Arah swap STT/NIA: ${lastSwapDirectionSttNia}`, "debug");
    addLog(`Saldo: STT=${sttBalance.toFixed(4)}, NIA=${niaBalance.toFixed(4)}`, "debug");
    addLog(`Jumlah acak: STT=${sttAmount}, NIA=${niaAmount}`, "debug");

    let receipt;

    if (lastSwapDirectionSttNia === "NIA_TO_STT") {
      if (niaBalance < niaAmount) {
        addLog(`Saldo NIA tidak cukup: ${niaBalance.toFixed(4)} < ${niaAmount}. Arah swap menjadi STT_TO_NIA.`, "warning");
        lastSwapDirectionSttNia = "STT_TO_NIA";
        return false;
      }

      const tokenContract = new ethers.Contract(NIA_ADDRESS, ERC20ABI, globalWallet);
      const decimals = await tokenContract.decimals();
      const amountIn = ethers.parseUnits(niaAmount.toString(), decimals);
      const path = [NIA_ADDRESS, WSTT_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      if (amountOutMin === ethers.parseEther("0")) return false;
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      const approved = await approveToken(NIA_ADDRESS, niaAmount.toString());
      if (!approved) return false;

      addLog(`Melakukan swap ${niaAmount} NIA ➯ STT`, "swap");
      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactTokensForETH(amountIn, slippage, path, globalWallet.address, deadline, { gasLimit: 300000, nonce });
      });

      if (receipt && receipt.status === 1) {
        addLog(`Swap NIA ➯ STT Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttNia = "STT_TO_NIA";
        addLog(`Arah swap STT/NIA diubah ke: ${lastSwapDirectionSttNia}`, "debug");
        return true;
      }
    } else {
      if (sttBalance < sttAmount) {
        addLog(`Saldo STT tidak cukup: ${sttBalance.toFixed(4)} < ${sttAmount}. Arah swap menjadi NIA_TO_STT.`, "warning");
        lastSwapDirectionSttNia = "NIA_TO_STT";
        return false;
      }

      const amountIn = ethers.parseEther(sttAmount.toString());
      const path = [WSTT_ADDRESS, NIA_ADDRESS];
      const amountOutMin = await getAmountOut(amountIn, path);
      if (amountOutMin === ethers.parseEther("0")) return false;
      const slippage = amountOutMin * BigInt(95) / BigInt(100);

      addLog(`Melakukan swap ${sttAmount} STT ➯ NIA`, "swap");
      receipt = await executeSwapWithNonceRetry(async (nonce) => {
        return await routerContract.swapExactETHForTokens(slippage, path, globalWallet.address, deadline, { value: amountIn, gasLimit: 300000, nonce });
      });

      if (receipt && receipt.status === 1) {
        addLog(`Swap STT ➯ NIA Berhasil. Hash: ${receipt.hash}`, "success");
        await reportTransaction();
        lastSwapDirectionSttNia = "NIA_TO_STT";
        addLog(`Arah swap STT/NIA diubah ke: ${lastSwapDirectionSttNia}`, "debug");
        return true;
      }
    }
    return false;
  } catch (error) {
    addLog(`Gagal swap STT/NIA: ${error.message}`, "error");
    return false;
  }
}

async function main() {
  addLog("Memulai skrip otomatis...", "system");
  addLog("Jangan Lupa Subscribe YT Dan Telegram @NTExhaust!! :D", "system");
  
  if (!RPC_URL || !PRIVATE_KEY || !USDTG_ADDRESS || !NIA_ADDRESS) {
    addLog("Variabel environment penting belum diatur. Cek file .env Anda.", "error");
    process.exit(1);
  }

  await updateWalletData();

  const iterationsSttUsdtg = 1;
  const iterationsSttNia = 1;
  const enableSttUsdtgSwap = true;
  const enableSttNiaSwap = true;

  if (enableSttUsdtgSwap) {
    addLog(`Memulai ${iterationsSttUsdtg} iterasi swap STT & USDT.g.`, "system");
    for (let i = 1; i <= iterationsSttUsdtg; i++) {
      if (swapCancelled) {
        addLog(`Swap STT & USDT.g Dihentikan (global cancel).`, "warning");
        break;
      }
      addLog(`Memulai swap STT/USDT.g ke-${i} dari ${iterationsSttUsdtg}`, "swap");
      const success = await autoSwapSttUsdtg();
      if (success) {
        await updateWalletData();
      } else {
        addLog(`Swap STT/USDT.g ke-${i} tidak berhasil/dilewati.`, "warning");
      }

      if (i < iterationsSttUsdtg && !swapCancelled) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        addLog(`Menunggu ${minutes}m ${seconds}d sebelum swap STT/USDT.g berikutnya...`, "system");
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    }
    addLog(`Swap STT & USDT.g selesai.`, "system");
  }

  if (enableSttNiaSwap && !swapCancelled) {
    addLog(`Memulai ${iterationsSttNia} iterasi swap STT & NIA.`, "system");
    for (let i = 1; i <= iterationsSttNia; i++) {
      if (swapCancelled) {
        addLog(`Swap STT & NIA Dihentikan (global cancel).`, "warning");
        break;
      }
      addLog(`Memulai swap STT/NIA ke-${i} dari ${iterationsSttNia}`, "swap");
      const success = await autoSwapSttNia();
      if (success) {
        await updateWalletData();
      } else {
        addLog(`Swap STT/NIA ke-${i} tidak berhasil/dilewati.`, "warning");
      }

      if (i < iterationsSttNia && !swapCancelled) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        addLog(`Menunggu ${minutes}m ${seconds}d sebelum swap STT/NIA berikutnya...`, "system");
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    }
    addLog(`Swap STT & NIA selesai.`, "system");
  }

  addLog("Semua task swap selesai.", "system");
  process.exit(0);
}

main().catch(error => {
  addLog(`Error fatal pada eksekusi utama: ${error.message}${error.stack ? `\nStack: ${error.stack}` : ''}`, "error");
  process.exit(1);
});
