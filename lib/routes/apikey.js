const crypto = require("crypto");
const { getDatabase, readJsonBody, setCors, findUserById } = require("../db");
const { telegramIdOf, accountIdOf } = require("../orders");

const MAX_KEYS_PER_USER = 3;

function generateApiKey() {
  return "TGA_" + crypto.randomBytes(20).toString("hex");
}

module.exports = async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  try {
    const body = req.method === "POST" ? readJsonBody(req) : {};
    const action = String(body.action || req.query.action || "").toLowerCase();
    const userId = String(body.userId || req.query.userId || req.query.telegramId || "").trim();

    if (!userId) {
      return res.status(400).json({ success: false, message: "Missing user." });
    }

    const db = await getDatabase();
    const users = db.collection("users");

    let user = await findUserById(db, userId);
    if (!user && /^\d+$/.test(userId)) user = await users.findOne({ _id: Number(userId) });
    if (!user && userId.includes("@")) user = await users.findOne({ email: userId.toLowerCase() });
    if (!user && userId.startsWith("+")) user = await users.findOne({ phone: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found. Please login again." });
    }

    const userKey = accountIdOf(user) || String(user._id);
    const tgId = telegramIdOf(user);
    const keysCol = db.collection("api_keys");

    if (action === "list") {
      const keys = await keysCol
        .find({ $or: [{ user_id: userKey }, { user_telegram: tgId }] })
        .sort({ created_at: -1 })
        .limit(MAX_KEYS_PER_USER + 5)
        .toArray();
      return res.status(200).json({
        success: true,
        keys: keys.map((k) => ({
          _id: k._id,
          created_at: k.created_at || null,
          last_used_at: k.last_used_at || null,
        })),
      });
    }

    if (action === "generate") {
      const existing = await keysCol.countDocuments({
        $or: [{ user_id: userKey }, { user_telegram: tgId }],
      });
      if (existing >= MAX_KEYS_PER_USER) {
        return res.status(400).json({
          success: false,
          message: `You can have up to ${MAX_KEYS_PER_USER} API keys. Revoke one first.`,
        });
      }
      const key = generateApiKey();
      await keysCol.insertOne({
        _id: key,
        user_id: userKey,
        user_telegram: tgId,
        created_at: new Date(),
        last_used_at: null,
      });
      return res.status(200).json({ success: true, key, message: "API key generated." });
    }

    if (action === "revoke") {
      const key = String(body.key || req.query.key || "").trim();
      if (!key) return res.status(400).json({ success: false, message: "Missing key." });
      const result = await keysCol.deleteOne({
        _id: key,
        $or: [{ user_id: userKey }, { user_telegram: tgId }],
      });
      if (!result.deletedCount) {
        return res.status(404).json({ success: false, message: "Key not found or does not belong to you." });
      }
      return res.status(200).json({ success: true, message: "API key revoked." });
    }

    return res.status(400).json({ success: false, message: "Unknown action. Use list | generate | revoke." });
  } catch (e) {
    console.error("API key error:", e);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
