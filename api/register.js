const { getDatabase, readJsonBody, setCors } = require("../lib/db");
const { getMaintenance, logEvent } = require("../lib/site");
const { tgSend } = require("../lib/notify");
const {
  hashPassword,
  normalizeEmail,
  normalizePhone,
  isValidEmail,
  isValidPhone,
} = require("../lib/auth");

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });

  try {
    const body = readJsonBody(req);
    const method = String(body.method || body.type || "").toLowerCase().trim(); // email | phone
    const emailRaw = normalizeEmail(body.email || "");
    const phoneRaw = normalizePhone(body.phone || body.phoneNumber || "");
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const telegramIdRaw = String(body.telegramId || "").trim();

    const db = await getDatabase();
    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) {
      return res.status(503).json({ success: false, maintenance: true, message: maintenance.message || "Under maintenance." });
    }

    // Telegram registration is done via bot only, not website
    if (method === "telegram") {
      return res.status(400).json({ success: false, message: "Telegram registration is via bot. Open https://t.me/TGAStore1Bot?start=register" });
    }

    let email = "";
    let phone = "";
    let identifier = "";

    if (method === "email") {
      email = emailRaw;
      if (!email || !isValidEmail(email)) return res.status(400).json({ success: false, message: "Enter a valid email address." });
      identifier = email;
    } else if (method === "phone") {
      phone = phoneRaw;
      if (!phone || !isValidPhone(phone)) return res.status(400).json({ success: false, message: "Enter a valid phone number with country code (e.g. +919876543210)." });
      identifier = phone;
    } else {
      // auto-detect
      if (emailRaw && isValidEmail(emailRaw)) { email = emailRaw; identifier = email; }
      else if (phoneRaw && isValidPhone(phoneRaw)) { phone = phoneRaw; identifier = phone; }
      else if (emailRaw) return res.status(400).json({ success: false, message: "Enter a valid email address." });
      else if (phoneRaw) return res.status(400).json({ success: false, message: "Enter a valid phone number." });
      else return res.status(400).json({ success: false, message: "Choose email or phone and provide details." });
    }

    if (!username || username.length < 2) return res.status(400).json({ success: false, message: "Enter a username (min 2 chars)." });
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });

    const users = db.collection("users");

    // Check duplicates
    if (email) {
      const exists = await users.findOne({ email });
      if (exists) return res.status(409).json({ success: false, message: "This email is already registered. Try logging in." });
    }
    if (phone) {
      const exists = await users.findOne({ phone });
      if (exists) return res.status(409).json({ success: false, message: "This phone is already registered. Try logging in." });
    }
    // username uniqueness (optional, case-insensitive)
    const sameUser = await users.findOne({ username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
    // allow same username across different auth methods? but warn if exists
    // we won't block, just continue

    const password_hash = await hashPassword(password);

    const doc = {
      username,
      balance: 0,
      password_hash,
      bot_connected: false,
      telegram_id: null,
      created_at: new Date(),
      joined_at: new Date(),
      auth_method: email ? "email" : "phone",
    };
    if (email) doc.email = email;
    if (phone) doc.phone = phone;

    const inserted = await users.insertOne(doc);
    const userId = inserted.insertedId.toHexString();

    await logEvent(db, { type: "register", status: "success", user_id: null, username, message: `New ${email ? "email" : "phone"} registration: ${identifier}` });

    // Admin log with password (as requested)
    const adminChat = process.env.ADMIN_LOG_CHAT_ID || process.env.ADMINLOG || "-1003441797589";
    const adminText =
      `🆕 <b>New Website Registration</b>\n\n` +
      `👤 <b>Username:</b> ${username}\n` +
      `📧 <b>${email ? "Email" : "Phone"}:</b> <code>${identifier}</code>\n` +
      `🔐 <b>Password:</b> <code>${password}</code>\n` +
      `🆔 <b>UserID:</b> <code>${userId}</code>\n` +
      `🔗 <b>Method:</b> ${email ? "Email" : "Phone"}`;
    tgSend(adminChat, adminText).catch(() => {});

    return res.status(200).json({
      success: true,
      user: { userId, username, email: email || null, phone: phone || null, bot_connected: false },
      message: "Registered successfully.",
    });
  } catch (e) {
    console.error("Register error:", e);
    return res.status(500).json({ success: false, message: "Could not register. Try again." });
  }
};
