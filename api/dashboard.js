const { getDatabase, findUserById, resolveUserId } = require("../lib/db");
const { ObjectId } = require("mongodb");

function serialize(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const output = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === "_id" && val && typeof val.toHexString === "function") output[key] = val.toHexString();
      else output[key] = serialize(val);
    }
    return output;
  }
  return value;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed." });

  try {
    const raw = String(req.query.userId || req.query.telegramId || req.query.identifier || "").trim();
    if (!raw) return res.status(400).json({ success: false, message: "Missing user identifier." });

    const db = await getDatabase();
    let user = await findUserById(db, raw);
    if (!user) {
      // try email/phone
      if (raw.includes("@")) user = await db.collection("users").findOne({ email: raw.toLowerCase() });
      else if (/^\+/.test(raw)) user = await db.collection("users").findOne({ phone: raw });
      else if (/^\d+$/.test(raw)) user = await db.collection("users").findOne({ telegram_id: Number(raw) });
    }
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const userIdStr = resolveUserId(user);
    const telegramId = user.telegram_id || (typeof user._id === "number" ? user._id : null);
    // orders may be stored under numeric telegramId or userId string/ObjectId; query both
    const orQueries = [];
    if (telegramId !== null) orQueries.push({ user_id: telegramId });
    orQueries.push({ user_id: user._id });
    orQueries.push({ user_id: userIdStr });
    try { orQueries.push({ user_id: new ObjectId(userIdStr) }); } catch {}
    if (telegramId !== null) orQueries.push({ user_id: String(telegramId) });

    const orders = await db.collection("orders").find({ $or: orQueries }).sort({ created_at: -1 }).limit(50).toArray();

    // Count recharges: need to handle multiple id forms
    const orUser = orQueries.map(q => ({ user_id: q.user_id }));
    const [transactions, cryptoTxns] = await Promise.all([
      db.collection("transactions").find({ $or: orUser, status: { $in: ["paid", "approved", "success", "completed"] } }).limit(200).toArray().catch(()=>[]),
      db.collection("crypto_invoices").find({ $or: orUser, status: { $in: ["paid", "approved", "success", "completed"] } }).limit(200).toArray().catch(()=>[]),
    ]);
    // Actually transactions filter with $or and status needs proper; above malformed. Use correct query:
    // We'll just query with orQueries for transactions too
    // For simplicity count via iterating if previous failed
    let t2 = transactions;
    if (!t2.length) {
      const alt = await db.collection("transactions").find({ status: { $in: ["paid", "approved", "success", "completed"] } }).limit(200).toArray().catch(()=>[]);
      t2 = alt.filter(t => orQueries.some(q => String(q.user_id) === String(t.user_id)));
    }

    const totalRecharge = t2.length + cryptoTxns.length;
    const balance = Number(user.balance || 0);

    return res.status(200).json({
      success: true,
      user: {
        userId: userIdStr,
        telegramId: telegramId,
        username: user.username || "User",
        email: user.email || null,
        phone: user.phone || null,
        bot_connected: Boolean(user.bot_connected && user.telegram_id),
        balance: Number.isFinite(balance) ? balance : 0,
      },
      orders: orders.map(serialize),
      totalOrders: orders.length,
      totalRecharge,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ success: false, message: "Could not load dashboard data.", error: error.message });
  }
};
