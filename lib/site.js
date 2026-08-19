const crypto = require("crypto");

const SETTINGS_ID = "maintenance";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

async function createSession(db, options) {
  const token = createToken();

  await db.collection("sessions").insertOne({
    _id: token,
    role: String(options.role || "admin"),
    id: String(options.id || "admin"),
    created_at: new Date()
  });

  return token;
}

async function getSession(db, req) {
  const header = String(req.headers["authorization"] || "");
  const token = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : header.trim();

  if (!token) {
    return null;
  }

  const session = await db.collection("sessions").findOne({ _id: token });

  if (!session) {
    return null;
  }

  const createdAt = session.created_at
    ? new Date(session.created_at).getTime()
    : 0;

  if (!createdAt || Date.now() - createdAt > SESSION_TTL_MS) {
    try {
      await db.collection("sessions").deleteOne({ _id: token });
    } catch (error) {
      console.error("Session cleanup error:", error);
    }

    return null;
  }

  return session;
}

async function deleteSession(db, token) {
  if (!token) {
    return;
  }

  await db.collection("sessions").deleteOne({ _id: token });
}

module.exports = {
  getMaintenance,
  setMaintenance,
  logEvent,
  createSession,
  getSession,
  deleteSession
};
