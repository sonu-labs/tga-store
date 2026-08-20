// One-time data fixes that run automatically on the next deployment.
//
// Each migration is guarded by an `applied[name]` flag stored in the
// `settings` collection under `{ _id: "migrations" }`, so it is idempotent:
// it can run on every cold start / page load without doing the same work
// twice. We also remember the deploy id it last ran under to avoid scanning
// on every single request.

const { currentDeployId } = require("./notify");

// Fix the old website order that lost its place in the bot's purchase history.
//
// bot.py lists a buyer's history with `orders.find({user_id: tgid, status:
// "purchased"})`, so an order whose `status` was flipped to "completed" (with
// no `delivery_status`) disappears from "📂 View Purchase Logs". This is
// exactly what happened to +918053118669 — bought on the website, OTP was
// fetched, status became "completed", and the bot stopped showing it.
// Website-side completion belongs in `delivery_status`, so we set status back
// to "purchased" while keeping delivery_status="completed".
async function fixOrder918053118669(db) {
  const variants = ["+918053118669", "918053118669"];
  let modified = 0;

  for (const number of variants) {
    const res = await db.collection("orders").updateOne(
      { number },
      { $set: { status: "purchased", delivery_status: "completed" } }
    );
    modified += res.modifiedCount || 0;
  }

  return { modified };
}

const MIGRATIONS = [
  { name: "fix_order_918053118669", run: fixOrder918053118669 }
];

async function runMigrations(db) {
  if (!db) return { ran: 0 };

  try {
    const doc = await db.collection("settings").findOne({ _id: "migrations" });
    const applied = (doc && doc.applied) || {};
    const deployId = currentDeployId() || "local-dev";

    // Already scanned on this deploy id → nothing to do.
    if (doc && doc.last_deploy === deployId) {
      return { ran: 0, skipped: true };
    }

    const results = {};
    let ran = 0;

    for (const migration of MIGRATIONS) {
      if (applied[migration.name]) continue;
      try {
        const result = await migration.run(db);
        applied[migration.name] = { at: new Date(), ...result };
        ran += 1;
        console.log(`[migrations] ${migration.name} applied:`, JSON.stringify(applied[migration.name]));
      } catch (e) {
        console.error(`[migrations] ${migration.name} failed:`, (e && e.message) || e);
      }
    }

    await db.collection("settings").updateOne(
      { _id: "migrations" },
      { $set: { applied, last_deploy: deployId } },
      { upsert: true }
    );

    return { ran };
  } catch (e) {
    console.error("[migrations] runMigrations error:", (e && e.message) || e);
    return { ran: 0, error: String((e && e.message) || e) };
  }
}

module.exports = { runMigrations };
