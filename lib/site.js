const crypto = require("crypto");

const SETTINGS_ID = "maintenance";

/*
  Session lifetime is a *sliding* window, not a fixed countdown from the moment
  of login. Before this change every session died exactly 7 days after it was
  created even for users who were online every day — which is what made the
  store feel like it "automatically logs out" for no reason.

  Now every authenticated request pushes `expires_at` forward (at most once per
  SESSION_TOUCH_INTERVAL_MS, so we do not write to Mongo on every single call).
  Only a genuinely idle session expires.
*/
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours idle
const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days idle
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // refresh at most every 5 min

async function getMaintenance(db) {
  try {
    const doc = await db.collection("settings").findOne({
      _id: SETTINGS_ID
    });

    if (!doc) {
      return {
        enabled: false,
        message: "",
        updated_at: null,
        updated_by: null
      };
    }

    return {
      enabled: Boolean(doc.enabled),
      message: String(doc.message || ""),
      updated_at: doc.updated_at || null,
      updated_by: doc.updated_by || null
    };
  } catch (error) {
    console.error("getMaintenance error:", error);

    return {
      enabled: false,
      message: "",
      updated_at: null,
      updated_by: null
    };
  }
}

async function setMaintenance(db, options) {
  const doc = {
    enabled: Boolean(options.enabled),
    message: String(options.message || "").slice(0, 500),
    updated_at: new Date(),
    updated_by: String(options.updatedBy || "admin")
  };

  await db.collection("settings").updateOne(
    { _id: SETTINGS_ID },
    { $set: doc },
    { upsert: true }
  );

  return doc;
}

async function logEvent(db, event) {
  try {
    const doc = {
      type: String(event.type || "event"),
      status: String(event.status || ""),
      user_id:
        event.user_id !== undefined && event.user_id !== null
          ? Number(event.user_id)
          : null,
      username: String(event.username || ""),
      message: String(event.message || ""),
      country: event.country ? String(event.country) : "",
      country_code: event.country_code ? String(event.country_code) : "",
      number: event.number ? String(event.number) : "",
      price: Number.isFinite(Number(event.price)) ? Number(event.price) : 0,
      created_at: new Date()
    };

    await db.collection("logs").insertOne(doc);
  } catch (error) {
    console.error("logEvent error:", error);
  }
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function sessionTtlMs(role) {
  return role === "admin" ? ADMIN_SESSION_TTL_MS : USER_SESSION_TTL_MS;
}

async function createSession(db, options) {
  const token = createToken();
  const role = String(options.role || "admin");
  const now = new Date();
  const expires = new Date(now.getTime() + sessionTtlMs(role));

  await db.collection("sessions").insertOne({
    _id: token,
    role,
    id: String(options.id || options.userId || "admin"),
    userId: options.userId ? String(options.userId) : null,
    ip: options.ip ? String(options.ip).slice(0, 80) : "",
    created_at: now,
    last_seen: now,
    expires_at: expires
  });

  return token;
}

function readBearerToken(req) {
  const header = String((req && req.headers && req.headers.authorization) || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return header.trim();
}

/** When does this session doc die? Supports old docs that only have created_at. */
function sessionExpiresAtMs(session) {
  if (!session) return 0;

  const explicit = session.expires_at
    ? new Date(session.expires_at).getTime()
    : 0;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const stamp = session.last_seen || session.created_at;
  const base = stamp ? new Date(stamp).getTime() : 0;
  if (!Number.isFinite(base) || base <= 0) return 0;

  return base + sessionTtlMs(session.role);
}

async function getSession(db, req) {
  const token = readBearerToken(req);
  if (!token || token.length < 32 || token.length > 200) {
    return null;
  }

  const session = await db.collection("sessions").findOne({ _id: token });
  if (!session) {
    return null;
  }

  const expiresAt = sessionExpiresAtMs(session);

  if (!expiresAt || Date.now() > expiresAt) {
    try {
      await db.collection("sessions").deleteOne({ _id: token });
    } catch (error) {
      console.error("Session cleanup error:", error);
    }
    return null;
  }

  /*
    Sliding expiry: keep an active user signed in. Throttled so a burst of API
    calls (dashboard + countries + status) costs a single small update.
  */
  const now = Date.now();
  const lastSeen = session.last_seen
    ? new Date(session.last_seen).getTime()
    : 0;

  if (!lastSeen || now - lastSeen > SESSION_TOUCH_INTERVAL_MS) {
    const nextExpiry = new Date(now + sessionTtlMs(session.role));
    try {
      await db.collection("sessions").updateOne(
        { _id: token },
        { $set: { last_seen: new Date(now), expires_at: nextExpiry } }
      );
    } catch (error) {
      // A failed refresh must never log the user out — the session is still
      // valid until its current expiry.
      console.error("Session refresh error:", error);
    }
    session.last_seen = new Date(now);
    session.expires_at = nextExpiry;
  }

  return session;
}

async function deleteSession(db, token) {
  if (!token) {
    return;
  }

  await db.collection("sessions").deleteOne({ _id: token });
}

async function deleteUserSessions(db, userId, exceptToken) {
  if (!userId) return;
  const filter = { role: "user", userId: String(userId) };
  if (exceptToken) filter._id = { $ne: exceptToken };
  await db.collection("sessions").deleteMany(filter);
}

async function deleteAdminSessions(db, adminId) {
  await db.collection("sessions").deleteMany({
    role: "admin",
    id: String(adminId || "admin")
  });
}

module.exports = {
  getMaintenance,
  setMaintenance,
  logEvent,
  createSession,
  getSession,
  deleteSession,
  deleteUserSessions,
  deleteAdminSessions,
  readBearerToken,
  sessionExpiresAtMs,
  ADMIN_SESSION_TTL_MS,
  USER_SESSION_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS
};
