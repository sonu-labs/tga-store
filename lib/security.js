const crypto = require("crypto");

function setSecurityHeaders(res) {
  if (!res || typeof res.setHeader !== "function") return;
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
}

function clientIp(req) {
  const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "")
    .split(",")[0]
    .trim();
  if (forwarded) return forwarded.slice(0, 80);

  const real = String((req && req.headers && req.headers["x-real-ip"]) || "").trim();
  if (real) return real.slice(0, 80);

  const socket = req && (req.socket || req.connection);
  return String((socket && socket.remoteAddress) || "unknown").slice(0, 80);
}

function hashKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 32);
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  const max = Math.max(left.length, right.length, 1);
  const leftPad = Buffer.alloc(max);
  const rightPad = Buffer.alloc(max);
  left.copy(leftPad);
  right.copy(rightPad);
  const sameLen = left.length === right.length && left.length > 0;
  const sameBytes = crypto.timingSafeEqual(leftPad, rightPad);
  return sameLen && sameBytes;
}

async function consumeRateLimit(db, key, options) {
  const max = Math.max(1, Number(options && options.max) || 8);
  const windowMs = Math.max(1000, Number(options && options.windowMs) || 15 * 60 * 1000);
  const now = Date.now();
  const id = String(key || "").slice(0, 180);
  const col = db.collection("rate_limits");

  const doc = await col.findOne({ _id: id });
  const startedAt = doc ? Number(doc.started_at || 0) : 0;

  if (!doc || !startedAt || now - startedAt >= windowMs) {
    await col.updateOne(
      { _id: id },
      { $set: { count: 1, started_at: now, updated_at: new Date() } },
      { upsert: true }
    );
    return { ok: true, remaining: max - 1, retryAfter: 0 };
  }

  const count = Number(doc.count || 0);
  if (count >= max) {
    const retryAfter = Math.max(1, Math.ceil((startedAt + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfter };
  }

  await col.updateOne(
    { _id: id },
    { $inc: { count: 1 }, $set: { updated_at: new Date() } }
  );

  return { ok: true, remaining: Math.max(0, max - count - 1), retryAfter: 0 };
}

function rateLimitedResponse(res, retryAfter) {
  const seconds = Math.max(1, Number(retryAfter) || 60);
  res.setHeader("Retry-After", String(seconds));
  return res.status(429).json({
    success: false,
    message: "Too many attempts. Please wait a minute and try again."
  });
}

module.exports = {
  setSecurityHeaders,
  clientIp,
  hashKey,
  timingSafeEqualString,
  consumeRateLimit,
  rateLimitedResponse
};
