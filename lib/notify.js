// Telegram notification helper for website purchases.
//
// Mirrors what bot.py does after a successful sale, but WITHOUT touching
// bot.py — we just talk to Telegram's Bot HTTP API directly using the same
// BOT_TOKEN, and post into the same channels/DMs.
//
// Required env vars (all already exist for the bot):
//   BOT_TOKEN           - the bot token (config.py BOT_TOKEN)
//   SALES_CHAT_ID       - public sales channel id (bot.py SALES,  e.g. -1002254383562)
//   ADMIN_LOG_CHAT_ID   - private admin log id   (bot.py ADMINLOG, e.g. -1003441797589)
//   BOT_USERNAME        - optional, used in footer (bot.py BOTUSER, e.g. TGAStore1Bot)
//   BOT_CHANNEL         - optional, used in footer (bot.py CHANNEL, e.g. TGAForu)
//
// Fallbacks are provided so this is safe to call even if some env vars
// aren't set yet — the call becomes a no-op instead of throwing.

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
const SALES_CHAT_ID = process.env.SALES_CHAT_ID || process.env.SALES || "-1002254383562";
const ADMIN_LOG_CHAT_ID = process.env.ADMIN_LOG_CHAT_ID || process.env.ADMINLOG || "-1003441797589";
const BOT_USERNAME = process.env.BOT_USERNAME || process.env.BOTUSER || "TGAStore1Bot";
const BOT_CHANNEL = process.env.BOT_CHANNEL || process.env.CHANNEL || "TGAForu";

async function tgSend(chatId, text, extra = {}) {
  if (!BOT_TOKEN) {
    console.warn("[notify] BOT_TOKEN missing — skipping Telegram send.");
    return { ok: false, skipped: true };
  }
  if (!chatId) return { ok: false, skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...extra,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) console.warn("[notify] Telegram sendMessage failed:", data);
    return data;
  } catch (e) {
    console.error("[notify] Telegram send error:", e && e.message || e);
    return { ok: false, error: String(e && e.message || e) };
  }
}

function maskId(id) {
  const s = String(id || "");
  if (s.length <= 4) return s + "****";
  return s.slice(0, 4) + "****";
}

/**
 * Fire-and-forget notifications for a successful website purchase.
 * Mirrors bot.py's public/admin log format and adds "via website".
 *
 * @param {object} p
 * @param {number|string} p.userId       Telegram user id of the buyer
 * @param {string}        [p.username]   Telegram username (no @)
 * @param {string}        p.country      Country name (e.g. "India")
 * @param {string}        [p.countryCode]
 * @param {string}        p.number       Purchased phone number
 * @param {number}        p.price        Price paid (INR)
 * @param {number}        [p.balance]    User's balance AFTER purchase
 */
async function notifyWebsitePurchase(p) {
  const {
    userId,
    username,
    country = "Unknown",
    countryCode = "",
    number = "",
    price = 0,
    balance = null,
  } = p || {};

  const maskedUser = maskId(userId);
  const maskedNumber = number ? (String(number).slice(0, 6) + "•••••") : "Hidden";
  const uname = username ? `@${username}` : "N/A";

  // Public channel (matches bot.py "New Number Purchase" style, tagged as website)
  const publicLog =
    `<pre><u>✅ <b>New Number Purchase (Website)</b></u></pre>\n\n` +
    `➖ <b><u>Country:</u></b> ${country}\n` +
    `➖ <b><u>Application:</u> Теlegгам 🍷</b>\n\n` +
    `➕ <b>Number: ${maskedNumber} 📞</b>\n` +
    `➕ <b>Buyer ID:</b> <code>${maskedUser}</code>\n` +
    `➕ <b>Price:</b> ₹${Number(price).toFixed(2)}\n` +
    `➕ <b>Source:</b> 🌐 Website\n\n` +
    `<b>• @${BOT_USERNAME} || @${BOT_CHANNEL}</b>`;

  // Private admin log (full details)
  const adminLog =
    `<pre>📢 New Purchase Alert — Website</pre>\n\n` +
    `<b>• Application:</b> Telegram\n` +
    `<b>• Country:</b> ${country}${countryCode ? ` (${countryCode})` : ""}\n` +
    `<b>• Number:</b> <code>${number || "N/A"}</code>\n` +
    `<b>• Price:</b> ₹${Number(price).toFixed(2)}\n` +
    `<b>• Source:</b> 🌐 Website\n\n` +
    `<b>👤 User:</b> ${uname} (<code>${userId}</code>)\n` +
    (balance !== null && balance !== undefined
      ? `<b>💰 Balance Left:</b> ₹${Number(balance).toFixed(2)}\n`
      : "");

  // DM to the buyer
  const userDm =
    `🌐 <b>New purchase via website</b>\n\n` +
    `📌 <b>Country:</b> ${country}\n` +
    `📞 <b>Number:</b> <code>${number || "N/A"}</code>\n` +
    `💰 <b>Price:</b> ₹${Number(price).toFixed(2)}\n\n` +
    `Open the bot to view the OTP once it arrives 👉 @${BOT_USERNAME}`;

  // Fire all three in parallel — never let a Telegram hiccup break the /api/buy response.
  await Promise.allSettled([
    tgSend(SALES_CHAT_ID, publicLog),
    tgSend(ADMIN_LOG_CHAT_ID, adminLog, {
      reply_markup: {
        inline_keyboard: [[{ text: "USER ID", url: `tg://openmessage?user_id=${userId}` }]],
      },
    }),
    tgSend(userId, userDm),
  ]);
}

module.exports = { notifyWebsitePurchase, tgSend };
