const {
  getDatabase,
  readJsonBody,
  setCors,
  findUserById,
  resolveUserId,
} = require("../lib/db");
const { getCountryInfo: getTgLionCountryInfo, getNumber: getTgLionNumber } = require("../lib/tglion");
const { sellingPriceInr } = require("../lib/money");
const { getMaintenance, logEvent } = require("../lib/site");
const { fetchServer2Countries, checkS2ApiBalance } = require("../lib/server2");
const { notifyWebsitePurchase } = require("../lib/notify");
const {
  BOT_VISIBLE_STATUS,
  telegramIdOf,
  accountIdOf,
} = require("../lib/orders");

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
    const rawUser = String(body.userId || body.telegramId || body.identifier || "").trim();
    const countryCode = getCountryCode(
      body.country_code || body.countryCode || body.code
    );

    attemptedCountryCode = countryCode;

    if (!rawUser) {
      return res.status(400).json({ success: false, message: "Missing user. Please login again." });
    }
    const db0 = await getDatabase();
    let lookupUser = await findUserById(db0, rawUser);
    if (!lookupUser && /^\d+$/.test(rawUser)) lookupUser = await db0.collection("users").findOne({ _id: Number(rawUser) });
    if (!lookupUser && rawUser.includes("@")) lookupUser = await db0.collection("users").findOne({ email: rawUser.toLowerCase() });
    if (!lookupUser && rawUser.startsWith("+")) lookupUser = await db0.collection("users").findOne({ phone: rawUser });
    if (!lookupUser) {
      return res.status(404).json({ success: false, message: "User not found. Please login again." });
    }
    // Numeric Telegram id — this is what bot.py queries orders by.
    const telegramId = telegramIdOf(lookupUser);
    // Use the actual _id for balance deduction to support both numeric and ObjectId users
    const userPrimaryId = lookupUser._id;
    const accountId = accountIdOf(lookupUser) || resolveUserId(lookupUser);
    // Orders MUST be stored under the numeric Telegram id so the bot's
    // "📂 View Purchase Logs" (user_id == telegram id) can find them.
    const userIdForOrder = telegramId !== null ? telegramId : accountId;

    attemptedUserId = userPrimaryId;

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
        _id: userPrimaryId,
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
      const existing = await users.findOne({ _id: userPrimaryId });

      if (!existing) {
        await logEvent(db, {
          type: "buy",
          status: "failed",
          user_id: telegramId,
          country_code: countryCode,
          message: "No account found."
        });

        return res.status(404).json({
          success: false,
          message: "No account found. Please login again."
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

    chargedUserId = userPrimaryId;
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
      user_id: userIdForOrder,
      // Extra ids so the order can always be traced back, whichever way it is queried.
      telegram_id: telegramId,
      account_id: accountId,
      country: purchased.name || country.name,
      country_code: countryCode,
      number: purchased.Number,
      otp: null,
      pass: null,
      // bot.py prints order["password"] in the purchase logs — keep the field
      // present so it shows a value instead of "N/A" once the OTP arrives.
      password: null,
      price: chargeInr,
      provider_price: country.price,
      // Keep "purchased": bot.py filters purchase history on status == "purchased".
      status: BOT_VISIBLE_STATUS,
      delivery_status: "waiting",
      source: "website",
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

    // Telegram notifications (sales channel + admin log + buyer DM).
    //
    // These are AWAITED on purpose. On Vercel the function is frozen the moment
    // the response is sent, so a detached promise usually gets killed before the
    // Telegram request is actually made — that was the reason no purchase alert
    // ever reached the logs channel or the buyer's DM.
    let notified = null;
    try {
      const buyer = user || (await db.collection("users").findOne({ _id: userPrimaryId })) || {};
      notified = await notifyWebsitePurchase({
        db,
        userId: telegramId,
        accountRef: accountId,
        username: buyer.username || "",
        country: order.country,
        countryCode: countryCode,
        number: purchased.Number,
        price: chargeInr,
        balance: Number(user?.balance || 0),
      });
      if (!notified.ok) console.warn("notifyWebsitePurchase incomplete:", notified.targets);
    } catch (e) {
      // A Telegram hiccup must never fail (or refund) a completed purchase.
      console.error("notify hook error:", (e && e.message) || e);
    }

    return res.status(200).json({
      success: true,
      Number: purchased.Number,
      number: purchased.Number,
      name: order.country,
      price: chargeInr,
      country_code: countryCode,
      orderId: order._id ? String(order._id) : null,
      balance: Number(user.balance || 0),
      notified: notified ? notified.targets : null
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
