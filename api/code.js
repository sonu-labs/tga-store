const {
  getDatabase,
  getTelegramId,
  readJsonBody,
  setCors
} = require("../lib/db");
const { getCode: getTgLionCode } = require("../lib/tglion");
const { getMaintenance, logEvent } = require("../lib/site");

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

    const order = await db.collection("orders").findOne({
      user_id: telegramId,
      number: { $in: variants }
    });

    if (!order) {
      await logEvent(db, {
        type: "otp",
        status: "failed",
        user_id: telegramId,
        number: number,
        message: "No order found for this number."
      });

      return res.status(404).json({
        success: false,
        message: "No order found for this number."
      });
    }

    // Try TGPVA first if order has provider_hash (like bot's server2)
    let result = null;
    if (order.provider === "tgpva" && order.provider_hash && process.env.TGPVA_API_KEY) {
      try {
        const url = `https://tgpva.com/api/user/getCode?apiKey=${encodeURIComponent(process.env.TGPVA_API_KEY)}&number=${encodeURIComponent(order.number || number)}&hash=${encodeURIComponent(order.provider_hash)}`;
        const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
        const data = await resp.json();
        if (data && data.ok && data.result && data.result.status === "Received" && data.result.code) {
          result = {
            Number: order.number || number,
            code: String(data.result.code).trim(),
            pass: String(data.result.password || data.result.pass || "").trim()
          };
        } else if (data && data.ok && data.result && data.result.status !== "Received") {
          // not yet received
          result = { Number: order.number || number, code: "", pass: "" };
        }
      } catch (e) {
        console.error("TGPVA getCode error:", e);
      }
    }
    if (!result || !result.code) {
      // fallback to TG-Lion (bot parity: try TG-Lion as fallback)
      try {
        result = await getTgLionCode(order.number || number);
      } catch (e) {
        // keep empty result to handle below
        if (!result) result = { code: "", pass: "" };
        // rethrow if it's a real error with statusCode and no TGPVA fallback succeeded
        if (e && e.statusCode && e.statusCode >= 500) throw e;
      }
    }

    if (!result.code) {
      await logEvent(db, {
        type: "otp",
        status: "failed",
        user_id: telegramId,
        number: order.number || number,
        message: "OTP is not available yet."
      });

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

    await logEvent(db, {
      type: "otp",
      status: "success",
      user_id: telegramId,
      number: result.Number || order.number,
      message: "OTP received."
    });

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
