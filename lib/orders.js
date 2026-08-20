// Order helpers shared by the website APIs.
//
// The Telegram bot (bot.py) reads purchase history with EXACTLY this query:
//
//   orders_col.find({ "user_id": <numeric telegram id>, "status": "purchased" })
//
// So for a website purchase to appear inside the bot's "📂 View Purchase Logs":
//   1. `user_id` MUST be the numeric Telegram id (not an ObjectId / hex string).
//   2. `status` MUST stay "purchased" — the bot has no "completed" filter, so
//      flipping the status after the OTP arrives makes the order VANISH from
//      the bot history. That is why +918053118669 disappeared: it was bought on
//      the website, its OTP was fetched, /api/code set status="completed", and
//      the bot query stopped matching it.
//   3. The password the bot prints comes from `order.password` (Server-3 style)
//      or from the `numbers` collection. We therefore write BOTH `pass` (used by
//      the website UI) and `password` (used by the bot) so "🔐 Pass" is not N/A.
//
// Website-side completion is tracked in `delivery_status` instead of `status`.

const { ObjectId } = require("mongodb");

/** Status value the bot expects on every visible order. */
const BOT_VISIBLE_STATUS = "purchased";

/** Numeric Telegram id of a user doc, or null. */
function telegramIdOf(user) {
  if (!user) return null;
  const tg = user.telegram_id;
  if (tg !== null && tg !== undefined && /^\d+$/.test(String(tg))) return Number(tg);
  if (typeof user._id === "number") return user._id;
  if (/^\d+$/.test(String(user._id))) return Number(user._id);
  return null;
}

/** String form of the website account id (`_id`). */
function accountIdOf(user) {
  if (!user) return null;
  return user._id instanceof ObjectId ? user._id.toHexString() : String(user._id);
}

/** Every id shape an order could have been written with for this user. */
function orderOwnerIds(user) {
  const ids = [];
  const tg = telegramIdOf(user);
  const acc = accountIdOf(user);

  if (tg !== null) {
    ids.push(tg, String(tg));
  }
  if (user && user._id !== undefined) ids.push(user._id);
  if (acc) {
    ids.push(acc);
    if (/^[a-fA-F0-9]{24}$/.test(acc)) {
      try { ids.push(new ObjectId(acc)); } catch {}
    }
  }

  // de-duplicate while keeping ObjectId/number instances intact
  const seen = new Set();
  return ids.filter((id) => {
    const key = `${typeof id}:${String(id)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Mongo `$or` clauses matching every id shape for this user. */
function ownerQueries(user) {
  return orderOwnerIds(user).map((id) => ({ user_id: id }));
}

/**
 * Re-point old website orders to the numeric Telegram id once the user links
 * their bot account, so `/history → View Purchase Logs` inside the bot shows
 * purchases that were made on the website before linking.
 *
 * Safe to call on every dashboard/login hit: it is a no-op when there is
 * nothing to migrate.
 */
async function backfillOrderOwnership(db, user) {
  const tg = telegramIdOf(user);
  const acc = accountIdOf(user);
  if (!db || tg === null || !acc) return { migrated: 0 };

  const legacyIds = orderOwnerIds(user).filter(
    (id) => String(id) !== String(tg) || typeof id === "string"
  );
  if (!legacyIds.length) return { migrated: 0 };

  try {
    const result = await db.collection("orders").updateMany(
      { user_id: { $in: legacyIds } },
      { $set: { user_id: tg, account_id: acc, telegram_id: tg } }
    );
    if (result.modifiedCount) {
      console.log(`[orders] migrated ${result.modifiedCount} order(s) to telegram id ${tg}`);
    }
    return { migrated: result.modifiedCount || 0 };
  } catch (e) {
    console.error("[orders] backfillOrderOwnership error:", (e && e.message) || e);
    return { migrated: 0, error: String((e && e.message) || e) };
  }
}

/**
 * Status the website UI should display, derived without breaking the bot:
 * an order is "completed" once its OTP has been delivered.
 */
function displayStatus(order) {
  if (!order) return "waiting";
  if (order.delivery_status) return String(order.delivery_status);
  if (order.otp && String(order.otp).trim()) return "completed";
  return String(order.status || BOT_VISIBLE_STATUS);
}

module.exports = {
  BOT_VISIBLE_STATUS,
  telegramIdOf,
  accountIdOf,
  orderOwnerIds,
  ownerQueries,
  backfillOrderOwnership,
  displayStatus,
};
