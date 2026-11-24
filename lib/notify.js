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
//   OWNER_TG_ID         - optional, owner's numeric Telegram id for deploy pings
//
// IMPORTANT (serverless): every notification must be AWAITED by the caller.
// On Vercel the lambda is frozen as soon as the HTTP response is returned, so
// a "fire and forget" promise is very often killed before the Telegram request
// leaves the machine — that is why purchase alerts silently never arrived.

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
const SALES_CHAT_ID = process.env.SALES_CHAT_ID || process.env.SALES || "-1002254383562";
const ADMIN_LOG_CHAT_ID = process.env.ADMIN_LOG_CHAT_ID || process.env.ADMINLOG || "-1003441797589";
const BOT_USERNAME = process.env.BOT_USERNAME || process.env.BOTUSER || "TGAStore1Bot";
const BOT_CHANNEL = process.env.BOT_CHANNEL || process.env.CHANNEL || "TGAForu";
const OWNER_TG_ID = process.env.OWNER_TG_ID || process.env.OWNER_ID || "";
const SEND_TIMEOUT_MS = Number(process.env.TELEGRAM_TIMEOUT_MS || 8000);

/** A chat id we can DM: numeric Telegram id (or @channel / -100... group). */
function isSendableChatId(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (s.startsWith("@")) return true;
  return /^-?\d+$/.test(s);
}

async function tgApi(method, payload) {
  if (!BOT_TOKEN) {
    console.warn("[notify] BOT_TOKEN missing — skipping Telegram send.");
    return { ok: false, skipped: true, description: "BOT_TOKEN env var is missing" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) console.warn(`[notify] Telegram ${method} failed:`, JSON.stringify(data));
    return data;
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error(`[notify] Telegram ${method} error:`, msg);
    return { ok: false, error: msg, description: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a message. If Telegram rejects the inline keyboard (400 — e.g. an empty
 * copy_text, or an old Bot API that doesn't know copy_text), retry once WITHOUT
 * the keyboard so the text still gets delivered.
 */
async function tgSend(chatId, text, extra = {}) {
  if (!isSendableChatId(chatId)) {
    return { ok: false, skipped: true, description: `Not a Telegram chat id: ${chatId}` };
  }

  const base = {
    chat_id: String(chatId),
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  let data = await tgApi("sendMessage", { ...base, ...extra });

  if (!data.ok && extra && extra.reply_markup && data.error_code === 400) {
    console.warn("[notify] retrying without reply_markup:", data.description);
    data = await tgApi("sendMessage", base);
  }

  return data;
}

function maskId(id) {
  const s = String(id || "");
  if (s.length <= 4) return s + "****";
  return s.slice(0, 4) + "****";
}

function maskNumber(number) {
  const s = String(number || "").trim();
  return s ? s.slice(0, 6) + "•••••" : "Hidden";
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/** HTML-escape user/provider-controlled text used inside Telegram HTML messages. */
function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** ISO-3166 alpha-2 → regional-indicator flag ("IN" → 🇮🇳, invalid → ""). */
function flagEmoji(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(0x1f1e6 + (c.charCodeAt(0) - 65), 0x1f1e6 + (c.charCodeAt(1) - 65));
}

/** Sales-channel country label, flag first like the channel screenshots: "🇮🇳 India". */
function countryLabel(country, countryCode) {
  const name = String(country || "Unknown").trim();
  const flag = flagEmoji(countryCode);
  if (!flag) return name || "Unknown";
  const stripped = name.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();
  return `${flag} ${stripped || name}`;
}

/** Build the inline keyboard for a buyer DM, skipping buttons with empty data. */
function buyerButtons(number) {
  const rows = [];
  const num = String(number || "").trim();
  if (num) {
    rows.push([{ text: "📋 Copy number", copy_text: { text: num } }]);
    rows.push([{ text: "🔑 Get code", url: `https://t.me/${BOT_USERNAME}?start=otp_${encodeURIComponent(num)}` }]);
  } else {
    rows.push([{ text: "🤖 Open bot", url: `https://t.me/${BOT_USERNAME}` }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function adminUserButton(userId) {
  if (!/^\d+$/.test(String(userId || ""))) return {};
  return {
    reply_markup: {
      inline_keyboard: [[{ text: "USER ID", url: `tg://openmessage?user_id=${userId}` }]],
    },
  };
}

/** Rich underlined heading used by every log/DM post: <pre><u><b>…</b></u></pre>. */
function richHeading(text) {
  return `<pre><u><b>${esc(text)}</b></u></pre>`;
}

/** Screenshot-style blockquote body built from an array of lines. */
function blockquoteBlock(lines) {
  return `<blockquote>${lines.join("\n")}</blockquote>`;
}

/** "• Buy Now •" URL button appended to sales-channel posts (same as bot.py). */
const buyNowButtons = {
  reply_markup: {
    inline_keyboard: [[{ text: "• Buy Now •", url: `https://t.me/${BOT_USERNAME}?start=starting` }]],
  },
};

/**
 * Sales-channel post in the log channel's screenshot style:
 *   <pre><u><b>✅ rich heading</b></u></pre>
 *   <blockquote>
 *     🌏 Country / 📱 Application / 📞 Number / 🔑 Code / 🌐 Server /
 *     🔒 Password + price block or "Purchased via API"
 *   </blockquote>
 *   🛒 @bot || @channel  (+ "• Buy Now •" button added by the caller)
 *
 * source "website" → "💰 Price: ₹X" with "🌐 Purchased via website" underneath.
 * source "api"     → no price at all, just a single "🌐 Purchased via API" line.
 *
 * Exported for tests only — callers use notifyWebsitePurchase / notifyOtpDelivered.
 */
function salesPost(p) {
  const {
    heading = "New Number Purchase",
    country = "Unknown",
    countryCode = "",
    number = "",
    code = "",
    server = "",
    pass = "",
    price = 0,
    source = "website",
  } = p || {};

  const lines = [
    `🌏 <b>Country:</b> ${countryLabel(country, countryCode)}`,
    `📱 <b>Application:</b> Telegram`,
    `📞 <b>Number:</b> ${maskNumber(number)}`,
  ];
  if (String(code || "").trim()) lines.push(`🔑 <b>Code:</b> <span class='tg-spoiler'>${esc(code)}</span>`);
  if (String(server || "").trim()) lines.push(`🌐 <b>Server:</b> (${esc(server)})`);
  if (pass) lines.push(`🔒 <b>Password:</b> <span class='tg-spoiler'>${esc(pass)}</span>`);
  if (source === "api") {
    lines.push(`🌐 <b>Purchased via API</b>`);
  } else {
    lines.push(`💰 <b>Price:</b> ₹${money(price)}`);
    lines.push(`🌐 <b>Purchased via website</b>`);
  }

  return (
    `${richHeading(`✅ ${heading}`)}\n\n` +
    blockquoteBlock(lines) +
    `\n\n🛒 <b>@${BOT_USERNAME} || @${BOT_CHANNEL}</b>`
  );
}

/** Persist a notify result in the `logs` collection so the admin panel can show failures. */
async function recordNotifyLog(db, doc) {
  if (!db) return;
  try {
    await db.collection("logs").insertOne({
      type: "notify",
      status: doc.status || (doc.ok ? "success" : "failed"),
      user_id: /^\d+$/.test(String(doc.user_id || "")) ? Number(doc.user_id) : null,
      username: String(doc.username || ""),
      number: String(doc.number || ""),
      country: String(doc.country || ""),
      price: Number.isFinite(Number(doc.price)) ? Number(doc.price) : 0,
      message: String(doc.message || ""),
      targets: doc.targets || {},
      created_at: new Date(),
    });
  } catch (e) {
    console.error("[notify] recordNotifyLog error:", (e && e.message) || e);
  }
}

function summarize(results) {
  const out = {};
  for (const [key, value] of Object.entries(results)) {
    if (value && value.ok) out[key] = "sent";
    else if (value && value.skipped) out[key] = `skipped: ${value.description || "not applicable"}`;
    else out[key] = `failed: ${(value && (value.description || value.error)) || "unknown"}`;
  }
  return out;
}

/**
 * "success" when every non-skipped target went through, "partial" when only
 * some did, "failed" when nothing was delivered. Written into the logs
 * collection so the admin panel can show why a ping did not arrive.
 */
function overallStatus(targets) {
  const values = Object.values(targets);
  const attempted = values.filter((v) => !String(v).startsWith("skipped"));
  if (!attempted.length) return "skipped";
  const sent = attempted.filter((v) => v === "sent").length;
  if (sent === attempted.length) return "success";
  return sent ? "partial" : "failed";
}

/**
 * Notifications for a successful website purchase.
 * Mirrors bot.py's public/admin log format and adds "via website".
 *
 * MUST be awaited by the caller (serverless freeze — see file header).
 *
 * @param {object} p
 * @param {number|string} p.userId       Telegram user id of the buyer (numeric) — used for the DM
 * @param {string}        [p.username]   Telegram username (no @)
 * @param {string}        p.country      Country name (e.g. "India")
 * @param {string}        [p.countryCode]
 * @param {string}        p.number       Purchased phone number
 * @param {number}        p.price        Price paid (INR)
 * @param {number}        [p.balance]    User's balance AFTER purchase
 * @param {string}        [p.accountRef] Website account id when there is no Telegram id
 * @param {string}        [p.source]     "api" or "website" (default) — wording in the logs
 * @param {object}        [p.db]         Mongo db handle (optional) — used to log the result
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
    accountRef = "",
    source = "website",
    db = null,
  } = p || {};

  const canDm = isSendableChatId(userId);
  const maskedUser = maskId(userId || accountRef);
  const uname = username ? `@${username}` : "N/A";

  // Public sales channel — screenshot style (rich heading + blockquote).
  // Website purchases post immediately (price + "Purchased via website").
  // API purchases post NOTHING here at buy time: their post goes out when the
  // OTP arrives, via notifyOtpDelivered({ source: "api" }).
  const salesSend =
    source === "api"
      ? Promise.resolve({
          ok: false,
          skipped: true,
          description: "API purchase — sales post goes out when the OTP arrives",
        })
      : tgSend(
          SALES_CHAT_ID,
          salesPost({
            heading: "New Number Purchase (Website)",
            country,
            countryCode,
            number,
            price,
            source: "website",
          }),
          buyNowButtons
        );

  // Private admin log (full details) — same rich heading + blockquote style
  // as the sales channel, but keeps the price + full number for the admin.
  const adminLog =
    `${richHeading("📢 New Purchase Alert")}\n\n` +
    blockquoteBlock([
      `🌏 <b>Country:</b> ${countryLabel(country, countryCode)}`,
      `📱 <b>Application:</b> Telegram`,
      `📞 <b>Number:</b> <code>${esc(number || "N/A")}</code>`,
      `💰 <b>Price:</b> ₹${money(price)}`,
      `🌐 <b>${source === "api" ? "Purchased via API" : "Purchased via website"}</b>`,
    ]) +
    `\n\n<b>👤 User:</b> ${uname} (<code>${userId || accountRef || "N/A"}</code>)` +
    (accountRef && String(accountRef) !== String(userId)
      ? `\n🆔 <b>Website account:</b> <code>${esc(accountRef)}</code>`
      : "") +
    (balance !== null && balance !== undefined
      ? `\n💰 <b>Balance Left:</b> ₹${money(balance)}`
      : "") +
    (canDm ? "" : `\n\n⚠️ <i>Buyer has no Telegram linked — DM not sent.</i>`);

  // DM to the buyer — same style; buttons and full purchase info stay.
  const userDm =
    `${richHeading(`🌐 Purchased via ${source === "api" ? "API" : "website"}`)}\n\n` +
    blockquoteBlock([
      `🌏 <b>Country:</b> ${countryLabel(country, countryCode)}`,
      `📞 <b>Number:</b> <code>${esc(number || "N/A")}</code>`,
      `💰 <b>Price:</b> ₹${money(price)}`,
      ...(balance !== null && balance !== undefined
        ? [`💼 <b>Wallet Balance Left:</b> ₹${money(balance)}`]
        : []),
    ]) +
    `\n\nOpen the bot to view OTP once it arrives 👉 @${BOT_USERNAME}`;

  const [sales, admin, dm] = await Promise.all([
    salesSend,
    tgSend(ADMIN_LOG_CHAT_ID, adminLog, adminUserButton(userId)),
    canDm ? tgSend(userId, userDm, buyerButtons(number)) : Promise.resolve({ ok: false, skipped: true, description: "No Telegram id linked to this account" }),
  ]);

  const targets = summarize({ sales, admin, dm });
  const ok = Boolean(sales.ok || admin.ok || dm.ok);

  await recordNotifyLog(db, {
    ok,
    status: overallStatus(targets),
    user_id: userId,
    username,
    number,
    country,
    price,
    message: `Purchase notification (website): ${JSON.stringify(targets)}`,
    targets,
  });

  return { ok, targets };
}

/**
 * Notification once the OTP (and password) for an order arrives.
 * Mirrors bot.py's "Order Completed / New Purchase Alert" messages.
 *
 * @param {string} [p.source] "api" or "website" (default) — wording in the logs
 */
async function notifyOtpDelivered(p) {
  const {
    userId,
    username,
    country = "Unknown",
    countryCode = "",
    number = "",
    code = "",
    pass = "",
    price = 0,
    balance = null,
    accountRef = "",
    source = "website",
    db = null,
  } = p || {};

  const canDm = isSendableChatId(userId);
  const uname = username ? `@${username}` : "N/A";
  const passText = pass && String(pass).trim() ? String(pass).trim() : "None";

  // Public sales channel — screenshot style: rich heading + <blockquote> body.
  // API posts get a single "Purchased via API" line instead of the price;
  // website posts keep the price with "Purchased via website" underneath.
  const publicLog = salesPost({
    heading:
      source === "api"
        ? "New Number Purchase Successful"
        : "New Number Purchase Successful (Website)",
    country,
    countryCode,
    number,
    code: code || "",
    server: "2",
    pass: passText,
    price,
    source,
  });

  const adminLog =
    `${richHeading("📢 OTP Delivered")}\n\n` +
    blockquoteBlock([
      `🌏 <b>Country:</b> ${countryLabel(country, countryCode)}`,
      `📱 <b>Application:</b> Telegram`,
      `📞 <b>Number:</b> <code>${esc(number || "N/A")}</code>`,
      `💬 <b>OTP:</b> <code>${esc(code)}</code>`,
      `🔒 <b>Password:</b> <code>${esc(passText)}</code>`,
      `💰 <b>Price:</b> ₹${money(price)}`,
      `🌐 <b>${source === "api" ? "Purchased via API" : "Purchased via website"}</b>`,
    ]) +
    `\n\n<b>👤 User:</b> ${uname} (<code>${userId || accountRef || "N/A"}</code>)` +
    (balance !== null && balance !== undefined ? `\n💰 <b>Balance:</b> ₹${money(balance)}` : "");

  const userDm =
    `${richHeading(`✅ Order Completed (${source === "api" ? "API" : "Website"})`)}\n\n` +
    blockquoteBlock([
      `📞 <b>Number:</b> <code>${esc(number || "N/A")}</code>`,
      `💬 <b>Code:</b> <code>${esc(code)}</code>`,
      `🔑 <b>Password:</b> <code>${esc(passText)}</code>`,
    ]);

  const dmButtons = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Copy OTP", copy_text: { text: String(code || "-") } },
          { text: "Copy Pass", copy_text: { text: String(passText) } },
        ],
      ],
    },
  };

  const [sales, admin, dm] = await Promise.all([
    tgSend(SALES_CHAT_ID, publicLog, buyNowButtons),
    tgSend(ADMIN_LOG_CHAT_ID, adminLog, adminUserButton(userId)),
    canDm ? tgSend(userId, userDm, dmButtons) : Promise.resolve({ ok: false, skipped: true, description: "No Telegram id linked to this account" }),
  ]);

  const targets = summarize({ sales, admin, dm });
  const ok = Boolean(sales.ok || admin.ok || dm.ok);

  await recordNotifyLog(db, {
    ok,
    status: overallStatus(targets),
    user_id: userId,
    username,
    number,
    country,
    price,
    message: `OTP notification (website): ${JSON.stringify(targets)}`,
    targets,
  });

  return { ok, targets };
}

/** Identifier that changes on every new Vercel deployment / server restart. */
function currentDeployId() {
  return String(
    process.env.VERCEL_DEPLOYMENT_ID ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.DEPLOY_ID ||
      process.env.RENDER_GIT_COMMIT ||
      process.env.SOURCE_VERSION ||
      ""
  ).trim();
}

/**
 * "Logs are alive" ping — sent once per deployment/restart to the admin log
 * channel (and to the owner DM + sales channel when configured).
 */
async function notifyDeploy(options = {}) {
  const { db = null, deployId = currentDeployId(), reason = "Website updated / restarted", manual = false } = options;

  const commit = process.env.VERCEL_GIT_COMMIT_SHA ? String(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 7) : "";
  const msgLine = process.env.VERCEL_GIT_COMMIT_MESSAGE || "";
  const host = process.env.VERCEL_URL || process.env.SITE_URL || "";
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || "production";
  const when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const text =
    `<pre>🚀 Website ${manual ? "Notification Test" : "Deployed / Restarted"}</pre>\n\n` +
    `✅ <b>Logs are ACTIVE</b> — purchase alerts will be posted here.\n\n` +
    `🌐 <b>Site:</b> ${host ? `<code>${host}</code>` : "N/A"}\n` +
    `🧩 <b>Env:</b> ${env}\n` +
    (commit ? `🔖 <b>Commit:</b> <code>${commit}</code>\n` : "") +
    (msgLine ? `📝 <b>Change:</b> ${String(msgLine).slice(0, 120)}\n` : "") +
    (deployId ? `🆔 <b>Deploy:</b> <code>${String(deployId).slice(0, 24)}</code>\n` : "") +
    `⏰ <b>Time:</b> ${when}\n` +
    `📌 <b>Reason:</b> ${reason}\n\n` +
    `<b>• @${BOT_USERNAME} || @${BOT_CHANNEL}</b>`;

  const jobs = { admin: tgSend(ADMIN_LOG_CHAT_ID, text) };

  if (isSendableChatId(OWNER_TG_ID)) jobs.owner = tgSend(OWNER_TG_ID, text);
  if (String(process.env.DEPLOY_PING_SALES || "").toLowerCase() === "1") {
    jobs.sales = tgSend(SALES_CHAT_ID, text);
  }

  const keys = Object.keys(jobs);
  const values = await Promise.all(keys.map((k) => jobs[k]));
  const results = {};
  keys.forEach((k, i) => (results[k] = values[i]));

  const targets = summarize(results);
  const ok = values.some((v) => v && v.ok);

  await recordNotifyLog(db, {
    ok,
    status: overallStatus(targets),
    message: `${manual ? "Manual test" : "Deploy"} ping: ${JSON.stringify(targets)}`,
    targets,
  });

  return { ok, targets, deployId };
}

/**
 * Sends the deploy ping at most once per deployment id.
 * Uses the `settings` collection as the lock so concurrent lambdas
 * (and every page load) don't spam the channel.
 */
async function maybeNotifyDeploy(db) {
  const deployId = currentDeployId() || "local-dev";

  if (String(process.env.DEPLOY_PING_ENABLED || "1") === "0") {
    return { ok: false, skipped: true, reason: "DEPLOY_PING_ENABLED=0" };
  }

  try {
    const existing = await db.collection("settings").findOne({ _id: "deploy_ping" });
    if (existing && String(existing.deploy_id) === deployId) {
      return { ok: true, skipped: true, reason: "already announced" };
    }

    // Claim the ping first, so a parallel request doesn't send a duplicate.
    const claim = await db.collection("settings").updateOne(
      { _id: "deploy_ping", deploy_id: { $ne: deployId } },
      { $set: { deploy_id: deployId, announced_at: new Date(), status: "sending" } },
      { upsert: true }
    );

    if (!claim.modifiedCount && !claim.upsertedCount) {
      return { ok: true, skipped: true, reason: "claimed by another instance" };
    }

    const result = await notifyDeploy({ db, deployId });

    await db.collection("settings").updateOne(
      { _id: "deploy_ping" },
      { $set: { status: result.ok ? "sent" : "failed", targets: result.targets, announced_at: new Date() } }
    );

    return result;
  } catch (e) {
    // Duplicate-key race → another instance already announced it.
    if (e && e.code === 11000) return { ok: true, skipped: true, reason: "duplicate claim" };
    console.error("[notify] maybeNotifyDeploy error:", (e && e.message) || e);
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Config snapshot for the admin panel / debugging. */
function notifyConfig() {
  return {
    bot_token_set: Boolean(BOT_TOKEN),
    sales_chat_id: SALES_CHAT_ID,
    admin_log_chat_id: ADMIN_LOG_CHAT_ID,
    bot_username: BOT_USERNAME,
    bot_channel: BOT_CHANNEL,
    owner_tg_id: OWNER_TG_ID || null,
    deploy_id: currentDeployId() || null,
  };
}

module.exports = {
  notifyWebsitePurchase,
  notifyOtpDelivered,
  salesPost, // exported for tests only
  notifyDeploy,
  maybeNotifyDeploy,
  notifyConfig,
  currentDeployId,
  isSendableChatId,
  tgSend,
  tgApi,
};
