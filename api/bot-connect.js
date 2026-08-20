const { getDatabase, readJsonBody, setCors, findUserById, resolveUserId } = require("../lib/db");
const { generateConnectToken } = require("../lib/auth");
const { ObjectId } = require("mongodb");

// POST /api/bot-connect?action=create  { userId } -> { token, link }
// GET  /api/bot-connect?userId=...     -> { bot_connected: bool, telegram_id }
// POST /api/bot-connect?action=verify  (used by bot webhook if needed)
// GET  /api/bot-connect?action=resolve&token=xxx -> resolves token to userId (for bot)
module.exports = async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  const db = await getDatabase();
  const action = String(req.query.action || req.body?.action || "").toLowerCase();

  if (req.method === "GET") {
    if (action === "resolve") {
      const token = String(req.query.token || "").trim();
      if (!token) return res.status(400).json({ success: false, message: "Missing token." });
      const doc = await db.collection("connect_tokens").findOne({ _id: token });
      if (!doc) return res.status(404).json({ success: false, message: "Invalid or expired token." });
      // check expiry 15 min
      if (doc.created_at && Date.now() - new Date(doc.created_at).getTime() > 15 * 60 * 1000) {
        await db.collection("connect_tokens").deleteOne({ _id: token });
        return res.status(410).json({ success: false, message: "Token expired." });
      }
      return res.status(200).json({ success: true, userId: String(doc.userId), token });
    }
    // status
    const userId = String(req.query.userId || req.query.telegramId || "").trim();
    if (!userId) return res.status(400).json({ success: false, message: "Missing userId." });
    let user = await findUserById(db, userId);
    if (!user && /^\d+$/.test(userId)) user = await db.collection("users").findOne({ _id: Number(userId) });
    if (!user && userId.includes("@")) user = await db.collection("users").findOne({ email: userId.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    return res.status(200).json({
      success: true,
      bot_connected: Boolean(user.bot_connected && user.telegram_id),
      telegram_id: user.telegram_id || null,
      username: user.username || null,
    });
  }

  if (req.method === "POST") {
    if (action === "create") {
      const body = readJsonBody(req);
      const userId = String(body.userId || body.telegramId || "").trim();
      if (!userId) return res.status(400).json({ success: false, message: "Missing userId." });
      let user = await findUserById(db, userId);
      if (!user && /^\d+$/.test(userId)) user = await db.collection("users").findOne({ _id: Number(userId) });
      if (!user) return res.status(404).json({ success: false, message: "User not found." });
      if (user.bot_connected && user.telegram_id) {
        return res.status(200).json({ success: true, already_connected: true, telegram_id: user.telegram_id, message: "Already connected." });
      }
      const token = generateConnectToken();
      await db.collection("connect_tokens").insertOne({ _id: token, userId: resolveUserId(user), created_at: new Date() });
      // also auto-expire via TTL? we handle manually
      const botUsername = process.env.BOT_USERNAME || process.env.BOTUSER || "TGAStore1Bot";
      const link = `https://t.me/${botUsername}?start=connect_${token}`;
      return res.status(200).json({ success: true, token, link });
    }
    // verify: bot calls this after linking (optional)
    return res.status(400).json({ success: false, message: "Unknown action." });
  }

  return res.status(405).json({ success: false, message: "Method not allowed." });
};
