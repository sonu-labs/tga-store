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

module.exports = {
  DATABASE_NAME,
  getDatabase,
  getTelegramId,
  readJsonBody,
  setCors
};
