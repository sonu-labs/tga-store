// Telegram Mini App (WebApp) initData verification.
//
// When the store is opened inside Telegram (bot menu button → "Open Store",
// inline button with web_app, or a Mini App link), Telegram passes a signed
// `initData` string through `window.Telegram.WebApp.initData`. It looks like:
//
//   query_id=AAF...&user=%7B%22id%22%3A123...%7D&auth_date=1730000000&hash=abc...
//
// Security (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
//   1. secret_key = HMAC_SHA256(key: "WebAppData", data: BOT_TOKEN)
//   2. data_check_string = every field except `hash` / `signature`,
//      sorted by key, joined with "\n" as `key=value`
//   3. valid when HMAC_SHA256(key: secret_key, data: data_check_string) === hash
//
// We additionally reject stale payloads (auth_date older than MAX_AGE) so a
// leaked link cannot be replayed forever, and we verify the optional
// `signature` (Ed25519, third-party validation) when it is present.

const crypto = require("crypto");

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // 24h — Telegram recommends < 1 day
const CLOCK_SKEW_SECONDS = 60;

function botToken() {
  return process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
}

/** Parse initData into { fields: Map, user } without trusting anything yet. */
function parseInitData(initData) {
  const raw = String(initData || "").trim();
  if (!raw) return null;

  const fields = new Map();
  for (const part of raw.split("&")) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = decodeURIComponent(part.slice(0, idx));
    const value = decodeURIComponent(part.slice(idx + 1));
    fields.set(key, value);
  }

  let user = null;
  if (fields.has("user")) {
    try {
      user = JSON.parse(fields.get("user"));
    } catch {
      user = null;
    }
  }

  return { raw, fields, user };
}

function hmacHex(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest("hex");
}

/**
 * Validate initData. Returns
 *   { ok: true, user, authDate, queryId, startParam }
 * or
 *   { ok: false, reason }
 */
function verifyInitData(initData, options = {}) {
  const parsed = parseInitData(initData);
  if (!parsed) return { ok: false, reason: "missing_init_data" };

  const token = options.botToken || botToken();
  if (!token) return { ok: false, reason: "bot_token_missing" };

  const { fields, user } = parsed;
  const hash = fields.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  // 1. data_check_string — every field except hash/signature, sorted by key.
  const checkString = [...fields.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const expected = hmacHex(secretKey, checkString);

  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(String(hash), "hex");
  if (expectedBuf.length !== givenBuf.length || !crypto.timingSafeEqual(expectedBuf, givenBuf)) {
    return { ok: false, reason: "bad_hash" };
  }

  // 2. freshness
  const authDate = Number(fields.get("auth_date") || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate) return { ok: false, reason: "missing_auth_date" };
  if (authDate > nowSeconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: "auth_date_in_future" };
  if (nowSeconds - authDate > MAX_AUTH_AGE_SECONDS) return { ok: false, reason: "expired" };

  // 3. user payload sanity
  const userId = user && Number(user.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { ok: false, reason: "missing_user" };
  }

  return {
    ok: true,
    user,
    userId,
    authDate,
    queryId: fields.get("query_id") || "",
    startParam: fields.get("start_param") || "",
  };
}

/** Display name from a Telegram WebApp user object. */
function displayNameOf(user) {
  if (!user) return "";
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user.username) return user.username;
  return user.id ? String(user.id) : "";
}

module.exports = {
  parseInitData,
  verifyInitData,
  displayNameOf,
  botToken,
  MAX_AUTH_AGE_SECONDS,
};
