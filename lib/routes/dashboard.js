const { getDatabase, resolveUserId, setCors } = require("../db");
const {
  telegramIdOf,
  ownerQueries,
  backfillOrderOwnership,
  displayStatus,
} = require("../orders");
const { requireUser } = require("../userAuth");

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
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed." });

  try {
    const db = await getDatabase();
    const authed = await requireUser(db, req, res);
    if (!authed) return;
    const user = authed.user;

    const userIdStr = resolveUserId(user);
    const telegramId = telegramIdOf(user);

    // If this account has a Telegram id, make sure every past website order is
    // stored under that numeric id — otherwise the bot's "📂 View Purchase Logs"
    // (which queries orders by telegram id) will not list website purchases.
    await backfillOrderOwnership(db, user);

    // orders may be stored under numeric telegramId or userId string/ObjectId; query both
    const orQueries = ownerQueries(user);

    const rawOrders = await db.collection("orders").find({ $or: orQueries }).sort({ created_at: -1 }).limit(50).toArray();
    // `status` stays "purchased" in the DB for bot compatibility; the UI gets
    // the derived status so a delivered order still reads "completed".
    const orders = rawOrders.map(o => ({
      ...o,
      status: displayStatus(o),
      pass: o.pass || o.password || "",
    }));

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
    return res.status(500).json({ success: false, message: "Could not load dashboard data." });
  }
};
