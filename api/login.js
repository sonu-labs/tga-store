const { MongoClient } = require("mongodb");

const { getMaintenance, logEvent } = require("../lib/site");

const DATABASE_NAME = "TGAStoreBot";
const DEMO_PASSWORD = "demo";

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

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  try {
    const body = req.body || {};

    const telegramId = getTelegramId(body.telegramId);
    const password = String(body.password ?? "");

    const db = await getDatabase();

    const maintenance = await getMaintenance(db);

    if (maintenance.enabled) {
      return res.status(503).json({
        success: false,
        maintenance: true,
        message:
          maintenance.message ||
          "The store is under maintenance. Please try again later."
      });
    }

    if (telegramId === null) {
      await logEvent(db, {
        type: "login",
        status: "failed",
        user_id: null,
        message: "Enter a valid numeric Telegram ID."
      });

      return res.status(400).json({
        success: false,
        message: "Enter a valid numeric Telegram ID."
      });
    }

    if (password !== DEMO_PASSWORD) {
      await logEvent(db, {
        type: "login",
        status: "failed",
        user_id: telegramId,
        message: "Incorrect password."
      });

      return res.status(401).json({
        success: false,
        message: "Incorrect password."
      });
    }

    const user = await db.collection("users").findOne({
      _id: telegramId
    });

    if (!user) {
      await logEvent(db, {
        type: "login",
        status: "failed",
        user_id: telegramId,
        message: "No account found for this Telegram ID."
      });

      return res.status(404).json({
        success: false,
        message:
          "No account found for this Telegram ID. Start the bot first with /start."
      });
    }

    await logEvent(db, {
      type: "login",
      status: "success",
      user_id: telegramId,
      username: user.username || ""
    });

    return res.status(200).json({
      success: true,
      user: {
        telegramId: telegramId,
        username: user.username || "User"
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Database connection error."
    });
  }
};
