/*
  Session behaviour test (development only, no MongoDB required).

    node dev/session-test.js

  Checks the sliding-session rules that keep users logged in:
    • a new session expires ~30 days out,
    • an active session is pushed forward on use,
    • a genuinely idle/expired session is rejected and removed,
    • legacy docs (no expires_at) still work until their TTL passes.
*/

const assert = require("assert");
const { createSession, getSession, USER_SESSION_TTL_MS } = require("../lib/site");

function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    collection() {
      return {
        insertOne: async (doc) => {
          store.set(doc._id, { ...doc });
          return { insertedCount: 1 };
        },
        findOne: async ({ _id }) => (store.has(_id) ? { ...store.get(_id) } : null),
        updateOne: async ({ _id }, update) => {
          const doc = store.get(_id);
          if (!doc) return { matchedCount: 0 };
          Object.assign(doc, (update && update.$set) || {});
          return { matchedCount: 1 };
        },
        deleteOne: async ({ _id }) => {
          const had = store.delete(_id);
          return { deletedCount: had ? 1 : 0 };
        }
      };
    }
  };
}

const reqWith = (token) => ({ headers: { authorization: "Bearer " + token } });

(async () => {
  // 1. new session
  const db = fakeDb();
  const token = await createSession(db, { role: "user", userId: "123", id: "123" });
  const created = db.store.get(token);
  const days = (new Date(created.expires_at) - Date.now()) / 864e5;
  assert.ok(days > 29 && days < 31, "new session should expire in ~30 days, got " + days);
  console.log("✓ new session expires in", days.toFixed(1), "days");

  // 2. active use slides the expiry forward
  const old = new Date(Date.now() - 10 * 60 * 1000);
  created.last_seen = old;
  created.expires_at = new Date(Date.now() + 60 * 1000); // about to die
  const before = new Date(created.expires_at).getTime();
  const seen = await getSession(db, reqWith(token));
  assert.ok(seen, "session should still be valid");
  const after = new Date(db.store.get(token).expires_at).getTime();
  assert.ok(after > before + 864e5, "active session should be extended");
  console.log("✓ active session extended by", ((after - before) / 864e5).toFixed(1), "days");

  // 3. a genuinely expired session is rejected and deleted
  const deadToken = await createSession(db, { role: "user", userId: "9", id: "9" });
  db.store.get(deadToken).expires_at = new Date(Date.now() - 1000);
  assert.strictEqual(await getSession(db, reqWith(deadToken)), null);
  assert.ok(!db.store.has(deadToken), "expired session row should be deleted");
  console.log("✓ expired session rejected + removed");

  // 4. legacy doc with no expires_at (created 10 days ago) is still valid
  const legacy = "a".repeat(64);
  db.store.set(legacy, {
    _id: legacy,
    role: "user",
    userId: "123",
    created_at: new Date(Date.now() - 10 * 864e5),
    last_seen: new Date(Date.now() - 10 * 864e5)
  });
  assert.ok(await getSession(db, reqWith(legacy)), "legacy session inside TTL should work");
  console.log("✓ legacy session (no expires_at) accepted inside TTL");

  // 5. legacy doc created 40 days ago is rejected
  const stale = "b".repeat(64);
  db.store.set(stale, {
    _id: stale,
    role: "user",
    userId: "123",
    created_at: new Date(Date.now() - 40 * 864e5),
    last_seen: new Date(Date.now() - 40 * 864e5)
  });
  assert.strictEqual(await getSession(db, reqWith(stale)), null);
  console.log("✓ legacy session past TTL rejected");

  // 6. short tokens / garbage are ignored
  assert.strictEqual(await getSession(db, reqWith("short")), null);
  assert.strictEqual(await getSession(db, { headers: {} }), null);
  console.log("✓ malformed tokens ignored");

  console.log("\nAll session tests passed (user TTL =", USER_SESSION_TTL_MS / 864e5, "days)");
})().catch((e) => {
  console.error("✗", e.message);
  process.exitCode = 1;
});
