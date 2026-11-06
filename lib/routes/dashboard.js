const { getDatabase, resolveUserId, setCors } = require("../db");
const {
  telegramIdOf,
  ownerQueries,
  orderOwnerIds,
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

    // Count recharges across every id shape this account can have (numeric
    // Telegram id, its string form, ObjectId / hex string) — same id set the
    // orders query uses. No global fallback scan: a user with zero recharges
    // must not sweep the whole collection.
    const idCandidates = orderOwnerIds(user);
    const paidStatus = { $in: ["paid", "approved", "success", "completed"] };
    const userFilter = { user_id: { $in: idCandidates }, status: paidStatus };
    const [transactions, cryptoTxns, totalOrders] = await Promise.all([
      db.collection("transactions").find(userFilter).limit(500).toArray().catch(()=>[]),
      db.collection("crypto_invoices").find(userFilter).limit(500).toArray().catch(()=>[]),
      db.collection("orders").countDocuments({ $or: orQueries }).catch(()=>null),
    ]);

    const totalRecharge = transactions.length + cryptoTxns.length;
    const balance = Number(user.balance || 0);

    // Full profile so the frontend can render the Telegram chip (photo,
    // first/last name) right after a Mini App sign-in or a cold session
    // restore — before this, the dashboard only sent `username`, which is
    // why the greeting fell back to "User" and the avatar/name never filled.
    const firstName = user.first_name || user.firstName || null;
    const lastName = user.last_name || user.lastName || null;
    const photoUrl =
      (typeof user.photo_url === "string" && user.photo_url) ||
      (typeof user.photoUrl === "string" && user.photoUrl) ||
      null;

    return res.status(200).json({
      success: true,
      user: {
        userId: userIdStr,
        telegramId: telegramId,
        username: user.username || null,
        firstName,
        lastName,
        photoUrl,
        email: user.email || null,
        phone: user.phone || null,
        bot_connected: Boolean(user.bot_connected && user.telegram_id),
        balance: Number.isFinite(balance) ? balance : 0,
      },
      orders: orders.map(serialize),
      totalOrders: Number.isFinite(totalOrders) && totalOrders !== null ? totalOrders : orders.length,
      totalRecharge,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ success: false, message: "Could not load dashboard data." });
  }
};
