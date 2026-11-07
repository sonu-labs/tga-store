/* ==========================================================================
   TGA STORE — TELEGRAM MINI APP AUTH
   ==========================================================================
   POST /api/telegram        body: { initData }
       → verifies Telegram's signed initData (HMAC-SHA256 with BOT_TOKEN),
         finds-or-creates the user document for that Telegram account and
         returns a normal website session token. The user lands on the store
         already logged in, with their Telegram id, name, username and photo.

   GET  /api/telegram?action=config
       → { bot_username } so the web app can build the bot deep link without
         hard-coding it.

   The user document keeps the exact shape the Telegram bot (bot.py) writes:
   `_id` = numeric Telegram id, `telegram_id`, `username`, `balance` (INR).
   That means Mini App sign-in needs no change at all in bot.py, and every
   order / balance / purchase log stays shared between bot and website.
   ========================================================================== */

const { getDatabase, readJsonBody, setCors, resolveUserId } = require("../db");
const { getMaintenance, logEvent, createSession } = require("../site");
const { clientIp, hashKey, consumeRateLimit, rateLimitedResponse } = require("../security");
const { verifyInitData, displayNameOf, botToken } = require("../telegramAuth");
const { tgSend } = require("../notify");
const { ObjectId } = require("mongodb");

const SESSION_IP_MAX_MS = 15 * 60 * 1000;

function botUsername() {
  return (
    process.env.BOT_USERNAME ||
    process.env.BOTUSER ||
    "TGAStore1Bot"
  ).replace(/^@/, "");
}

function adminChatId() {
  return process.env.ADMIN_LOG_CHAT_ID || process.env.ADMINLOG || "";
}

function profileFrom(tgUser) {
  const u = tgUser || {};
  return {
    telegram_id: Number(u.id),
    username: u.username ? String(u.username).slice(0, 64) : null,
    first_name: u.first_name ? String(u.first_name).slice(0, 64) : null,
    last_name: u.last_name ? String(u.last_name).slice(0, 64) : null,
    language_code: u.language_code ? String(u.language_code).slice(0, 16) : null,
    photo_url: typeof u.photo_url === "string" ? u.photo_url.slice(0, 512) : null,
    is_premium: Boolean(u.is_premium),
  };
}

module.exports = async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ---- public config (used to build the "open in Telegram" links) ----
  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      bot_username: botUsername(),
      bot_configured: Boolean(botToken()),
      webapp_enabled: Boolean(botToken()),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  try {
    const body = readJsonBody(req);
    const initData = String(body.initData || body.init_data || "").trim();

    if (!initData) {
      return res.status(400).json({
        success: false,
        auth: false,
        message: "Open this page from inside the Telegram app to sign in automatically.",
      });
    }

    if (!botToken()) {
      return res.status(503).json({
        success: false,
        message: "Telegram login is not configured on the server (BOT_TOKEN missing).",
      });
    }

    const db = await getDatabase();

    // Slightly generous limit: the Mini App may re-auth on every cold start.
    const ipLimit = await consumeRateLimit(db, `tglogin:ip:${hashKey(clientIp(req))}`, {
      max: 30,
      windowMs: SESSION_IP_MAX_MS,
    });
    if (!ipLimit.ok) return rateLimitedResponse(res, ipLimit.retryAfter);

    const verified = verifyInitData(initData);
    if (!verified.ok) {
      const map = {
        bad_hash: "Telegram signature verification failed. Please reopen the store from the bot.",
        expired: "This Telegram login has expired. Please reopen the store from the bot.",
        bot_token_missing: "Telegram login is not configured on the server.",
        missing_user: "Telegram did not share your account details.",
        missing_hash: "This Telegram login is incomplete. Please reopen the store from the bot.",
        missing_init_data: "Open this page from inside Telegram to sign in automatically.",
        missing_auth_date: "This Telegram login is incomplete. Please reopen the store from the bot.",
        auth_date_in_future: "Your device clock looks wrong — Telegram login was rejected.",
      };
      return res.status(401).json({
        success: false,
        auth: false,
        reason: verified.reason,
        message: map[verified.reason] || "Could not verify your Telegram account.",
      });
    }

    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) {
      return res.status(503).json({
        success: false,
        maintenance: true,
        message: maintenance.message || "Under maintenance.",
      });
    }

    const telegramId = verified.userId;
    const profile = profileFrom(verified.user);
    const users = db.collection("users");

    // The bot always stores `_id` as the numeric Telegram id, so look there
    // first, then fall back to a `telegram_id` match on website accounts.
    let user = await users.findOne({ _id: telegramId });
    if (!user) user = await users.findOne({ telegram_id: telegramId });

    let created = false;
    const now = new Date();

    if (!user) {
      const doc = {
        _id: telegramId,
        telegram_id: telegramId,
        username: profile.username,
        first_name: profile.first_name,
        last_name: profile.last_name,
        language_code: profile.language_code,
        photo_url: profile.photo_url,
        balance: 0,
        bot_connected: true,
        auth_method: "telegram_miniapp",
        joined_at: now,
        created_at: now,
        referral_rewarded: false,
      };
      try {
        await users.insertOne(doc);
        user = doc;
        created = true;
      } catch (e) {
        // Duplicate key (another request created it first) → read it back.
        user = await users.findOne({ _id: telegramId });
        if (!user) throw e;
      }
    } else {
      // Refresh the profile details Telegram gave us, but never blank out
      // fields someone already filled in.
      const set = {
        telegram_id: telegramId,
        bot_connected: true,
        last_tg_login_at: now,
      };
      if (profile.username) set.username = profile.username;
      if (profile.first_name) set.first_name = profile.first_name;
      if (profile.last_name) set.last_name = profile.last_name;
      if (profile.language_code) set.language_code = profile.language_code;
      if (profile.photo_url) set.photo_url = profile.photo_url;
      await users.updateOne({ _id: user._id }, { $set: set });
      user = { ...user, ...set };
    }

    // Sessions key on the user document id; anything that is not a numeric
    // Telegram id (an ObjectId website account) is stored as its hex string.
    const userId =
      user._id instanceof ObjectId ? user._id.toHexString() : resolveUserId(user);
    const token = await createSession(db, {
      role: "user",
      id: userId,
      userId,
      ip: clientIp(req),
    });

    // The response `username` must stay NULL when the Telegram account has no
    // @username — falling back to the display name would make the frontend
    // render "@Demo User" as if it were a real handle.
    const username = user.username || null;

    await logEvent(db, {
      type: "login",
      status: "success",
      user_id: telegramId,
      username: user.username || displayNameOf(verified.user) || "User",
      message: created ? "Mini App sign-in (new account)" : "Mini App sign-in",
    });

    if (created) {
      const chat = adminChatId();
      if (chat) {
        const text =
          `🆕 <b>New Telegram Mini App User</b>\n\n` +
          `👤 <b>Name:</b> ${displayNameOf(verified.user) || "N/A"}\n` +
          `🔗 <b>Username:</b> ${user.username ? "@" + user.username : "—"}\n` +
          `🆔 <b>Telegram ID:</b> <code>${telegramId}</code>\n` +
          `📱 <b>Source:</b> Mini App`;
        await tgSend(chat, text).catch(() => {});
      }
    }

    return res.status(200).json({
      success: true,
      token,
      created,
      user: {
        userId,
        telegramId,
        username,
        firstName: user.first_name || null,
        lastName: user.last_name || null,
        photoUrl: user.photo_url || null,
        email: user.email || null,
        phone: user.phone || null,
        balance: Number(user.balance || 0),
        bot_connected: true,
      },
    });
  } catch (error) {
    console.error("Telegram auth error:", error);
    return res.status(500).json({ success: false, message: "Could not sign in with Telegram." });
  }
};
