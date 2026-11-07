// Telegram Mini App (WebApp) initData verification.
//
// When the store is opened inside Telegram (bot menu button → "Open Store",
// inline button with web_app, or a Mini App link), Telegram passes a signed
// `initData` string through `window.Telegram.WebApp.initData`. It looks like:
//
//   query_id=AAF...&user=%7B%22id%22%3A123...%7D&auth_date=1730000000&hash=abc...
//
// Security (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
//   1. secret = HMAC_SHA256(key: "WebAppData", message: BOT_TOKEN)
//   2. data_check_string = every field EXCEPT `hash` — the optional Ed25519
//      `signature` field is KEPT, it is part of the signed payload — sorted by
//      key, joined with "\n" as `key=value` (decoded values)
//   3. calc = HMAC_SHA256(key: secret, message: data_check_string).hex
//   4. compare with crypto.timingSafeEqual (after a length check)
//
// We additionally reject stale payloads (auth_date older than MAX_AGE) so a
// leaked link cannot be replayed forever. Modern Telegram clients send BOTH
// `hash` and `signature`; excluding `signature` here was what made every Mini
// App launch fail verification with bad_hash.

const crypto = require("crypto");

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // 24h — Telegram recommends < 1 day
const CLOCK_SKEW_SECONDS = 60;

function botToken() {
  return process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
}

/** Parse initData into { raw, fields: Map, user } without trusting anything yet. */
function parseInitData(initData) {
  const raw = String(initData || "").trim();
  if (!raw) return null;

  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }

  const fields = new Map();
  for (const [key, value] of params.entries()) {
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
  const raw = String(initData || "").trim();
  if (!raw) return { ok: false, reason: "missing_init_data" };

  const token = options.botToken || botToken();
  if (!token) return { ok: false, reason: "bot_token_missing" };

  // Bot-token HMAC validation exactly as Telegram documents it:
  //   hash = HMAC_SHA256(secret, data_check_string).hex
  //   secret = HMAC_SHA256("WebAppData", BOT_TOKEN)   — token is the MESSAGE
  //   data_check_string = every field except `hash` (signature is KEPT),
  //     sorted by key, `key=value` joined with "\n", decoded values.
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: "missing_init_data" };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash"); // sirf hash hatao — signature field ko mat hatao

  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token, "utf8").digest();
  const expected = hmacHex(secretKey, dataCheckString);

  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(String(hash), "hex");
  if (expectedBuf.length !== givenBuf.length || !crypto.timingSafeEqual(expectedBuf, givenBuf)) {
    return { ok: false, reason: "bad_hash" };
  }

  // freshness — a leaked launch link cannot be replayed forever
  const authDate = Number(params.get("auth_date") || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate) return { ok: false, reason: "missing_auth_date" };
  if (authDate > nowSeconds + CLOCK_SKEW_SECONDS) return { ok: false, reason: "auth_date_in_future" };
  if (nowSeconds - authDate > MAX_AUTH_AGE_SECONDS) return { ok: false, reason: "expired" };

  // user payload sanity
  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }
  const userId = user && Number(user.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { ok: false, reason: "missing_user" };
  }

  return {
    ok: true,
    user,
    userId,
    authDate,
    queryId: params.get("query_id") || "",
    startParam: params.get("start_param") || "",
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
