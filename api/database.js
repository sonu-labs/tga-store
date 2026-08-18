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

function serializeDocument(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeDocument);
  }

  if (typeof value === "object") {
    const output = {};

    for (const [key, val] of Object.entries(value)) {
      if (key === "_id" && val && typeof val.toHexString === "function") {
        output[key] = val.toHexString();
      } else {
        output[key] = serializeDocument(val);
      }
    }

    return output;
  }

  return value;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  try {
    const telegramId = getTelegramId(req.query.telegramId);

    if (telegramId === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid Telegram ID."
      });
    }

    const db = await getDatabase();

    const users = db.collection("users");
    const ordersCollection = db.collection("orders");
    const transactionsCollection = db.collection("transactions");

    // Find user
    const user = await users.findOne({
      _id: telegramId
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    // Find user's orders
    const orders = await ordersCollection
      .find({
        user_id: telegramId
      })
      .sort({
        created_at: -1
      })
      .limit(50)
      .toArray();

    // Find approved recharge transactions
    const transactions = await transactionsCollection
      .find({
        user_id: telegramId,
        status: "approved"
      })
      .limit(200)
      .toArray();

    const balance = Number(user.balance || 0);

    return res.status(200).json({
      success: true,

      user: {
        telegramId: telegramId,
        username: user.username || "User",
        balance: Number.isFinite(balance) ? balance : 0
      },

      orders: orders.map(serializeDocument),

      totalOrders: orders.length,

      totalRecharge: transactions.length
    });

  } catch (error) {
    console.error("Dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load dashboard data."
    });
  }
};
