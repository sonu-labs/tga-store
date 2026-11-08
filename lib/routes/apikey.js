const crypto = require("crypto");
const { getDatabase, readJsonBody, setCors } = require("../db");
const { telegramIdOf, accountIdOf } = require("../orders");
const { requireUser } = require("../userAuth");

const MAX_KEYS_PER_USER = 1;

/*
  API keys are server-tagged: "TGAS" + server digit + 10 random digits,
  e.g. this deployment is Server 2 → "TGAS2…" (TGAS2123456789).
  The digit lets later servers (1, 3…) mint their own keys from the same
  pool. `API_KEY_SERVER` overrides the digit when this project is reused for
  another server. Validation is a plain DB lookup on the key itself, so
  legacy "TGA_…" keys keep working forever.
*/
const API_KEY_SERVER = (String(process.env.API_KEY_SERVER || "2").match(/[1-9]/) || ["2"])[0];

function generateApiKey() {
  let digits = "";
  for (let i = 0; i < 10; i++) digits += crypto.randomInt(0, 10);
  return "TGAS" + API_KEY_SERVER + digits;
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
    const db = await getDatabase();
    const authed = await requireUser(db, req, res);
    if (!authed) return;
    const user = authed.user;

    const userKey = accountIdOf(user) || String(user._id);
    const tgId = telegramIdOf(user);
    const keysCol = db.collection("api_keys");

    if (action === "logs") {
      const limit = Math.min(Math.max(Number(req.query.limit || body.limit || 100), 1), 500);
      const logs = await db.collection("api_logs")
        .find({ $or: [{ user_id: userKey }, { user_telegram: tgId }] })
        .sort({ created_at: -1 }).limit(limit).toArray();
      return res.status(200).json({ success: true, logs: logs.map((log) => ({
        _id: log._id, action: log.action, method: log.method,
        status_code: log.status_code, success: log.success,
        query: log.query || {}, created_at: log.created_at,
        duration_ms: log.duration_ms
      })) });
    }

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
          message: "You already have an API key. Revoke it to create a new one.",
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

    return res.status(400).json({ success: false, message: "Unknown action. Use list | generate | revoke | logs." });
  } catch (e) {
    console.error("API key error:", e);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// Exported for tests only — the route still serves via module.exports(req, res).
module.exports.generateApiKey = generateApiKey;
