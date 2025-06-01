// telegramreporter.js
import axios from 'axios';
import 'dotenv/config'; // Untuk memuat variabel dari .env

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Mengirim pesan ke chat Telegram yang ditentukan menggunakan Axios.
 * @param {string} message Pesan yang akan dikirim.
 * @param {object} options Opsi tambahan, terutama parse_mode.
 * @returns {Promise<boolean>} True jika pesan berhasil dikirim, false jika gagal.
 */
async function sendTelegramReport(message, options = { parse_mode: 'Markdown' }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram Reporter (Axios)] Token Bot atau Chat ID tidak ditemukan di .env. Reporter Telegram tidak akan mengirim pesan.');
    return false;
  }

  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: options.parse_mode || 'Markdown' // Default ke Markdown jika tidak ada di options
  };

  try {
    const response = await axios.post(telegramApiUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000 // Timeout 10 detik
    });

    if (response.data && response.data.ok) {
      // console.log('[Telegram Reporter (Axios)] Pesan berhasil dikirim ke Telegram.'); // Bisa di-uncomment untuk debug
      return true;
    } else {
      // Jika response.data.ok adalah false atau tidak ada
      console.error(`[Telegram Reporter (Axios)] Gagal mengirim pesan. Respons API: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    console.error(`[Telegram Reporter (Axios)] Error saat mengirim pesan ke Telegram: ${error.message}`);
    if (error.response) {
      // Error dari server Telegram (misalnya, 400, 401, 403, dll.)
      console.error(`[Telegram Reporter (Axios)] Status: ${error.response.status}`);
      console.error(`[Telegram Reporter (Axios)] Data: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // Request dibuat tapi tidak ada respons (misalnya, masalah jaringan)
      console.error('[Telegram Reporter (Axios)] Tidak ada respons dari server Telegram.');
    } else {
      // Error lain saat setup request
      console.error('[Telegram Reporter (Axios)] Error tidak diketahui:', error.message);
    }
    return false;
  }
}

// Ekspor fungsi agar bisa digunakan di file lain
export { sendTelegramReport };
