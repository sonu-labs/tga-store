const {
  getDatabase,
  getTelegramId,
  readJsonBody,
  setCors
} = require("../lib/db");
const { getCode } = require("../lib/tglion");

function numberVariants(value) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return [];
  }

  const compact = raw.replace(/[^\d+]/g, "");
  const digits = compact.replace(/^\+/, "");
  const withPlus = digits ? `+${digits}` : "";

  return [...new Set([raw, compact, digits, withPlus].filter(Boolean))];
}

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");

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
    const body = readJsonBody(req);
    const telegramId = getTelegramId(body.telegramId);
    const number = String(body.number || body.Number || "").trim();

    if (telegramId === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid Telegram ID."
      });
    }

    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Number is required."
      });
    }

    const variants = numberVariants(number);
    const db = await getDatabase();

    const order = await db.collection("orders").findOne({
      user_id: telegramId,
      number: { $in: variants }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "No order found for this number."
      });
    }

    const result = await getCode(order.number || number);

    if (!result.code) {
      return res.status(409).json({
        success: false,
        message: "OTP is not available yet. Try again in a moment."
      });
    }

    await db.collection("orders").updateOne(
      { _id: order._id },
      {
        $set: {
          otp: result.code,
          pass: result.pass || "",
          status: "completed",
          code_at: new Date()
        }
      }
    );

    return res.status(200).json({
      success: true,
      Number: result.Number,
      number: result.Number,
      code: result.code,
      pass: result.pass || ""
    });
  } catch (error) {
    console.error("OTP error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "OTP could not be received."
    });
  }
};
