// telegramreporter.js
import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config'; // Untuk memuat variabel dari .env

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let bot;

if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN); // Tidak perlu polling jika hanya untuk mengirim
} else {
  console.warn('[Telegram Reporter] Token Bot atau Chat ID tidak ditemukan di .env. Reporter Telegram mungkin tidak berfungsi.');
}

/**
 * Mengirim pesan ke chat Telegram yang ditentukan.
 * @param {string} message Pesan yang akan dikirim.
 * @param {object} options Opsi tambahan untuk sendMessage (misalnya, parse_mode).
 * @returns {Promise<boolean>} True jika pesan berhasil dikirim, false jika gagal.
 */
async function sendTelegramReport(message, options = { parse_mode: 'Markdown' }) {
  if (!bot) {
    console.error('[Telegram Reporter] Bot Telegram belum diinisialisasi. Pastikan Token dan Chat ID sudah benar.');
    // Mengembalikan true agar tidak dianggap error fatal di skrip utama jika ini hanya notifikasi opsional
    // atau false jika ini adalah notifikasi kritis. Tergantung kebutuhan.
    // Untuk laporan akhir, mungkin lebih baik menganggapnya sebagai masalah jika gagal.
    return false;
  }

  if (!TELEGRAM_CHAT_ID) {
    console.error('[Telegram Reporter] TELEGRAM_CHAT_ID tidak disetel.');
    return false;
  }

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, options);
    // console.log('[Telegram Reporter] Pesan berhasil dikirim ke Telegram.'); // Bisa di-uncomment untuk debug
    return true;
  } catch (error) {
    console.error(`[Telegram Reporter] Gagal mengirim pesan ke Telegram: ${error.message}`);
    if (error.response && error.response.body) {
      console.error(`[Telegram Reporter] Detail error dari API: ${error.response.body.description || JSON.stringify(error.response.body)}`);
    }
    return false;
  }
}

// Ekspor fungsi agar bisa digunakan di file lain
export { sendTelegramReport };
