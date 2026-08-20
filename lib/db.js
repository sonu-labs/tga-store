const { MongoClient } = require("mongodb");

const DATABASE_NAME = "TGAStoreBot";

let cachedClient = null;

async function getDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is missing.");
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    await cachedClient.connect();
  }

  return cachedClient.db(DATABASE_NAME);
}

function getTelegramId(value) {
  const id = String(value ?? "").trim();

  if (!/^\d+$/.test(id)) {
    return null;
  }

  return Number(id);
}

function readJsonBody(req) {
  const body = req.body;

  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body || "{}");
    } catch {
      return {};
    }
  }

  return body;
}

function setCors(res, methods) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const { ObjectId } = require("mongodb");

// Resolve user by any identifier: numeric _id, ObjectId hex, telegram_id, email, phone, userId string
async function findUserByAny(db, identifier) {
  const col = db.collection("users");
  const raw = String(identifier ?? "").trim();
  if (!raw) return null;

  // try numeric _id
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    let u = await col.findOne({ _id: num });
    if (u) return u;
    u = await col.findOne({ telegram_id: num });
    if (u) return u;
  }
  // try ObjectId
  if (/^[a-fA-F0-9]{24}$/.test(raw)) {
    try {
      const oid = new ObjectId(raw);
      let u = await col.findOne({ _id: oid });
      if (u) return u;
    } catch {}
  }
  // try email
  if (raw.includes("@")) {
    let u = await col.findOne({ email: raw.toLowerCase() });
    if (u) return u;
  }
  // try phone
  const phoneNorm = raw.replace(/\s+/g, "");
  if (/^\+?\d{7,15}$/.test(phoneNorm)) {
    let p = phoneNorm;
    if (!p.startsWith("+")) p = "+" + p;
    let u = await col.findOne({ phone: p });
    if (u) return u;
    // also without +
    let u2 = await col.findOne({ phone: phoneNorm });
    if (u2) return u2;
  }
  // try generic identifier field
  let u = await col.findOne({ telegram_id: Number(raw) || raw });
  if (u) return u;
  return null;
}

async function findUserById(db, idValue) {
  if (idValue === null || idValue === undefined) return null;
  const col = db.collection("users");
  // if it's already an ObjectId
  if (idValue instanceof ObjectId) {
    return col.findOne({ _id: idValue });
  }
  const raw = String(idValue).trim();
  if (/^[a-fA-F0-9]{24}$/.test(raw)) {
    try { return col.findOne({ _id: new ObjectId(raw) }); } catch {}
  }
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    let u = await col.findOne({ _id: num });
    if (u) return u;
    return col.findOne({ telegram_id: num });
  }
  return null;
}

function resolveUserId(user) {
  if (!user) return null;
  if (user._id instanceof ObjectId) return user._id.toHexString();
  return String(user._id);
}

module.exports = {
  DATABASE_NAME,
  getDatabase,
  getTelegramId,
  readJsonBody,
  setCors,
  findUserByAny,
  findUserById,
  resolveUserId,
};
