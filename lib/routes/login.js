const { getDatabase, readJsonBody, setCors, resolveUserId } = require("../db");
const { getMaintenance, logEvent } = require("../site");
const { verifyPassword, normalizeEmail, normalizePhone } = require("../auth");
const { ObjectId } = require("mongodb");

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });

  try {
    const body = readJsonBody(req);
    const password = String(body.password ?? "");
    const rawIdentifier = String(body.identifier || body.email || body.phone || body.telegramId || body.userId || "").trim();
    const method = String(body.method || "").toLowerCase().trim(); // telegram | email | phone

    if (!password) return res.status(400).json({ success: false, message: "Enter password." });
    if (!rawIdentifier) return res.status(400).json({ success: false, message: "Enter Telegram ID / Email / Phone." });

    const db = await getDatabase();
    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) {
      return res.status(503).json({ success: false, maintenance: true, message: maintenance.message || "Under maintenance." });
    }

    const users = db.collection("users");
    let user = null;

    // Try to find user by various identifiers
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
      // generic: try all
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

    // Fallback generic lookup
    if (!user) {
      // try findUserByAny logic: try numeric
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

    if (!user) {
      await logEvent(db, { type: "login", status: "failed", user_id: null, message: `No account for ${rawIdentifier}` });
      return res.status(404).json({ success: false, message: "No account found. Please register or start the bot with /start." });
    }

    // Verify password: support legacy demo + plain + hashed
    let ok = false;
    if (user.password_hash) {
      ok = await verifyPassword(password, user.password_hash);
    } else if (user.password) {
      // legacy plain field
      ok = password === String(user.password);
      if (ok) {
        // migrate to hash
        const bcrypt = require("bcryptjs");
        const hash = await bcrypt.hash(password, 10);
        await users.updateOne({ _id: user._id }, { $set: { password_hash: hash }, $unset: { password: "" } });
      }
    } else {
      // user has no password yet (old telegram user) -> if password is demo? We removed demo, so require setting
      ok = false;
    }

    if (!ok) {
      await logEvent(db, { type: "login", status: "failed", user_id: typeof user._id === "number" ? user._id : null, message: "Incorrect password." });
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    // Determine telegramId for backward compat: prefer telegram_id, else numeric _id
    const telegramId = user.telegram_id || (typeof user._id === "number" ? user._id : null);
    const userId = resolveUserId(user);

    await logEvent(db, { type: "login", status: "success", user_id: telegramId || null, username: user.username || "" });

    return res.status(200).json({
      success: true,
      user: {
        userId,
        telegramId,
        username: user.username || "User",
        email: user.email || null,
        phone: user.phone || null,
        bot_connected: Boolean(user.bot_connected || user.telegram_id),
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ success: false, message: "Database connection error." });
  }
};
