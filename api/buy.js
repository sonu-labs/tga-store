const {
  getDatabase,
  getTelegramId,
  readJsonBody,
  setCors
} = require("../lib/db");
const { getCountryInfo: getTgLionCountryInfo, getNumber: getTgLionNumber } = require("../lib/tglion");
const { sellingPriceInr } = require("../lib/money");
const { getMaintenance, logEvent } = require("../lib/site");
const { fetchServer2Countries, checkS2ApiBalance } = require("../lib/server2");

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

    // TG-Lion is the only provider used by the website
    let country = null;
    try {
      // Try unified fetch via server2 (like bot's fetch_server2_countries)
      const { countries } = await fetchServer2Countries(db);
      const found = countries.find(c => c.code.toUpperCase() === countryCode.toUpperCase());
      if (found) {
        country = { name: found.name, code: found.code, qty: found.qty, price: found.price };
      }
    } catch (e) {
      console.error("Unified country fetch error:", e);
    }
    if (!country) {
      // fallback to TG-Lion
      country = await getTgLionCountryInfo(countryCode);
    }

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

    // Bot-like: check provider balance before charging user
    try {
      const balCheck = await checkS2ApiBalance();
      if (!balCheck.ok) {
        console.warn("Provider balance low:", balCheck);
        // still allow purchase but log; uncomment next lines to block if you want strict
        // return res.status(503).json({ success: false, message: "Provider balance is low. Try later." });
      }
    } catch (e) {
      console.error("Balance check error:", e);
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

    // Purchase via TG-Lion (only provider used by the website)
    let purchased = null;
    try {
      purchased = await getTgLionNumber(countryCode, country.price);
    } catch (e) {
      if (e && e.statusCode) throw e;
      console.error("TG-Lion purchase failed:", e);
      throw e;
    }

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
      created_at: new Date(),
      provider: "tglion",
      provider_hash: null
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
