const bcrypt = require("bcryptjs");
const { getDatabase, readJsonBody, setCors, resolveUserId } = require("../db");
const { getMaintenance, logEvent, createSession } = require("../site");
const { verifyPassword, normalizeEmail, normalizePhone } = require("../auth");
const {
  clientIp,
  hashKey,
  consumeRateLimit,
  rateLimitedResponse
} = require("../security");
const { ObjectId } = require("mongodb");

const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.OjzO8Q8Q8Q8Q8Q8Q8Q8Q8Q8Q8Q8Q8e";

async function findLoginUser(users, rawIdentifier, method) {
  let user = null;

  if (method === "telegram" || /^\d+$/.test(rawIdentifier)) {
    const num = Number(rawIdentifier);
    user = await users.findOne({ _id: num });
    if (!user) user = await users.findOne({ telegram_id: num });
    if (!user && /^[a-f0-9]{24}$/i.test(rawIdentifier)) {
      try { user = await users.findOne({ _id: new ObjectId(rawIdentifier) }); } catch {}
    }
  } else if (method === "email" || rawIdentifier.includes("@")) {
    const email = normalizeEmail(rawIdentifier);
    user = await users.findOne({ email });
  } else if (method === "phone" || rawIdentifier.startsWith("+")) {
    const phone = normalizePhone(rawIdentifier);
    user = await users.findOne({ phone });
    if (!user) user = await users.findOne({ phone: rawIdentifier.trim() });
  } else {
    const email = normalizeEmail(rawIdentifier);
    if (email.includes("@")) user = await users.findOne({ email });
    if (!user) {
      const phone = normalizePhone(rawIdentifier);
      if (/^\+\d+$/.test(phone)) user = await users.findOne({ phone });
    }
    if (!user && /^\d+$/.test(rawIdentifier)) {
      const num = Number(rawIdentifier);
      user = await users.findOne({ _id: num }) || await users.findOne({ telegram_id: num });
    }
    if (!user && /^[a-f0-9]{24}$/i.test(rawIdentifier)) {
      try { user = await users.findOne({ _id: new ObjectId(rawIdentifier) }); } catch {}
    }
  }

  if (!user) {
    if (/^\d+$/.test(rawIdentifier)) {
      const num = Number(rawIdentifier);
      user = await users.findOne({ _id: num }) || await users.findOne({ telegram_id: num });
    }
    if (!user && rawIdentifier.includes("@")) {
      user = await users.findOne({ email: normalizeEmail(rawIdentifier) });
    }
    if (!user) {
      const ph = normalizePhone(rawIdentifier);
      if (ph) user = await users.findOne({ phone: ph });
    }
  }

  return user;
}

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });

  try {
    const body = readJsonBody(req);
    const password = String(body.password ?? "");
    const rawIdentifier = String(body.identifier || body.email || body.phone || body.telegramId || body.userId || "").trim();
    const method = String(body.method || "").toLowerCase().trim();

    if (!password || !rawIdentifier) {
      return res.status(400).json({ success: false, message: "Enter your login details." });
    }

    const db = await getDatabase();
    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) {
      return res.status(503).json({ success: false, maintenance: true, message: maintenance.message || "Under maintenance." });
    }

    const ip = clientIp(req);
    const ipLimit = await consumeRateLimit(db, `login:ip:${hashKey(ip)}`, {
      max: 10,
      windowMs: 15 * 60 * 1000
    });
    if (!ipLimit.ok) return rateLimitedResponse(res, ipLimit.retryAfter);

    const idLimit = await consumeRateLimit(db, `login:id:${hashKey(rawIdentifier.toLowerCase())}`, {
      max: 8,
      windowMs: 15 * 60 * 1000
    });
    if (!idLimit.ok) return rateLimitedResponse(res, idLimit.retryAfter);

    const users = db.collection("users");
    const user = await findLoginUser(users, rawIdentifier, method);

    let ok = false;
    if (!user) {
      try { await bcrypt.compare(password, DUMMY_HASH); } catch {}
      await logEvent(db, { type: "login", status: "failed", user_id: null, message: "Invalid login." });
      return res.status(401).json({ success: false, message: "Invalid login details." });
    }

    if (user.password_hash) {
      ok = await verifyPassword(password, user.password_hash);
    } else if (user.password) {
      ok = password === String(user.password);
      if (ok) {
        const hash = await bcrypt.hash(password, 12);
        await users.updateOne({ _id: user._id }, { $set: { password_hash: hash }, $unset: { password: "" } });
      }
    }

    if (!ok) {
      await logEvent(db, {
        type: "login",
        status: "failed",
        user_id: typeof user._id === "number" ? user._id : null,
        message: "Invalid login."
      });
      return res.status(401).json({ success: false, message: "Invalid login details." });
    }

    const telegramId = user.telegram_id || (typeof user._id === "number" ? user._id : null);
    // Sessions key on the user document id. Numeric Telegram ids (how the bot
    // creates users) stay numbers, ObjectId website accounts become hex.
    const userId = user._id instanceof ObjectId ? user._id.toHexString() : resolveUserId(user);
    const token = await createSession(db, {
      role: "user",
      id: userId,
      userId,
      ip
    });

    await logEvent(db, { type: "login", status: "success", user_id: telegramId || null, username: user.username || "" });

    return res.status(200).json({
      success: true,
      token,
      user: {
        userId,
        telegramId,
        username: user.username || null,
        firstName: user.first_name || user.firstName || null,
        lastName: user.last_name || user.lastName || null,
        photoUrl:
          (typeof user.photo_url === "string" && user.photo_url) ||
          (typeof user.photoUrl === "string" && user.photoUrl) ||
          null,
        email: user.email || null,
        phone: user.phone || null,
        bot_connected: Boolean(user.bot_connected || user.telegram_id),
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ success: false, message: "Could not sign in." });
  }
};
