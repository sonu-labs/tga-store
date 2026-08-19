const {
  getDatabase,
  getTelegramId,
  readJsonBody,
  setCors
} = require("../lib/db");
const { getCountryInfo, getNumber } = require("../lib/tglion");
const { sellingPriceInr } = require("../lib/money");
const { getMaintenance, logEvent } = require("../lib/site");

function getCountryCode(value) {
  const code = String(value ?? "").trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(code)) {
    return null;
  }

  return code;
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

  let chargedUserId = null;
  let chargedAmount = 0;
  let attemptedUserId = null;
  let attemptedCountryCode = null;

  try {
    const body = readJsonBody(req);
    const telegramId = getTelegramId(body.telegramId);
    const countryCode = getCountryCode(
      body.country_code || body.countryCode || body.code
    );

    attemptedUserId = telegramId;
    attemptedCountryCode = countryCode;

    if (telegramId === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid Telegram ID."
      });
    }

    if (!countryCode) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid country."
      });
    }

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

    const country = await getCountryInfo(countryCode);

    if (!country.qty) {
      await logEvent(db, {
        type: "buy",
        status: "failed",
        user_id: telegramId,
        country_code: countryCode,
        message: `${country.name} is out of stock.`
      });

      return res.status(409).json({
        success: false,
        message: `${country.name} is out of stock.`
      });
    }

    const chargeInr = sellingPriceInr(country.price);

    if (chargeInr === null || chargeInr <= 0) {
      return res.status(502).json({
        success: false,
        message: "Could not calculate a selling price for this country."
      });
    }

    const users = db.collection("users");

    const updatedUser = await users.findOneAndUpdate(
      {
        _id: telegramId,
        balance: { $gte: chargeInr }
      },
      {
        $inc: { balance: -chargeInr }
      },
      {
        returnDocument: "after",
        includeResultMetadata: true
      }
    );

    const user = updatedUser?.value || null;

    if (!user) {
      const existing = await users.findOne({ _id: telegramId });

      if (!existing) {
        await logEvent(db, {
          type: "buy",
          status: "failed",
          user_id: telegramId,
          country_code: countryCode,
          message: "No account found for this Telegram ID."
        });

        return res.status(404).json({
          success: false,
          message: "No account found for this Telegram ID. Start the bot first with /start."
        });
      }

      await logEvent(db, {
        type: "buy",
        status: "failed",
        user_id: telegramId,
        country_code: countryCode,
        price: chargeInr,
        message: "Insufficient balance."
      });

      return res.status(402).json({
        success: false,
        message: `Insufficient balance. This account costs ₹${chargeInr.toFixed(2)}.`
      });
    }

    chargedUserId = telegramId;
    chargedAmount = chargeInr;

    const purchased = await getNumber(countryCode, country.price);

    const order = {
      user_id: telegramId,
      country: purchased.name || country.name,
      country_code: countryCode,
      number: purchased.Number,
      otp: null,
      pass: null,
      price: chargeInr,
      provider_price: country.price,
      status: "purchased",
      created_at: new Date()
    };

    try {
      const inserted = await db.collection("orders").insertOne(order);
      order._id = inserted.insertedId;
    } catch (error) {
      console.error("Order insert error:", error);
    }

    await logEvent(db, {
      type: "buy",
      status: "success",
      user_id: telegramId,
      country: order.country,
      country_code: countryCode,
      number: purchased.Number,
      price: chargeInr
    });

    return res.status(200).json({
      success: true,
      Number: purchased.Number,
      number: purchased.Number,
      name: order.country,
      price: chargeInr,
      country_code: countryCode,
      balance: Number(user.balance || 0)
    });
  } catch (error) {
    console.error("Buy error:", error);

    if (chargedUserId && chargedAmount > 0) {
      try {
        const db = await getDatabase();

        await db.collection("users").updateOne(
          { _id: chargedUserId },
          { $inc: { balance: chargedAmount } }
        );
      } catch (refundError) {
        console.error("Buy refund error:", refundError);
      }
    }

    try {
      const db = await getDatabase();

      await logEvent(db, {
        type: "buy",
        status: "failed",
        user_id: chargedUserId || attemptedUserId,
        country_code: attemptedCountryCode || "",
        message: error.message || "Could not complete purchase."
      });
    } catch (logError) {
      console.error("Buy log error:", logError);
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Could not complete purchase."
    });
  }
};
