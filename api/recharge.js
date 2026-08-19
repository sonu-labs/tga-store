const { getDatabase, getTelegramId, readJsonBody, setCors } = require("../lib/db");
const { getMaintenance, logEvent } = require("../lib/site");
const {
  getPaymentSettings,
  createUPIInvoice,
  verifyUPIInvoice,
  createFamPayInvoice,
  verifyFamPayInvoice,
  verifyBinanceOrder,
  createOxaInvoice,
  checkOxaInvoice,
  USDT_TO_INR,
  MIN_USDT,
} = require("../lib/payments");

const UPI_INVOICE_EXPIRY_MIN = 60;
const HISTORY_LIMIT = 10;

module.exports = async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const db = await getDatabase();
    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) {
      return res.status(503).json({
        success: false,
        maintenance: true,
        message: maintenance.message || "Store under maintenance.",
      });
    }

    const action = String(req.query.action || req.query.a || "").toLowerCase().trim();
    const body = req.method === "POST" ? readJsonBody(req) : {};

    // GET settings
    if (req.method === "GET" && (action === "settings" || action === "payment_settings" || action === "config" || !action)) {
      if (action && action !== "settings" && action !== "config" && action !== "payment_settings") {
        // fall through to other GET actions
      } else {
        const settings = await getPaymentSettings(db);
        const binancePayId = process.env.BINANCE_PAY_ID || "";
        const binanceQrUrl = process.env.BINANCE_QR_URL || "";
        return res.status(200).json({
          success: true,
          settings: {
            active_inr_gateway: settings.active_inr_gateway || null,
            binance_enabled: Boolean(settings.binance_enabled),
            crypto_enabled: Boolean(settings.crypto_enabled),
          },
          binance: {
            pay_id: binancePayId,
            qr_url: binanceQrUrl,
          },
          usdt_to_inr: USDT_TO_INR,
          min_usdt: MIN_USDT,
        });
      }
    }

    if (req.method === "GET" && action === "history") {
      const telegramId = getTelegramId(req.query.telegramId || req.query.user_id || body.telegramId);
      if (telegramId === null) {
        return res.status(400).json({ success: false, message: "Invalid Telegram ID." });
      }
      const txns = await db.collection("transactions")
        .find({ user_id: telegramId, status: "paid" })
        .sort({ settled_at: -1, created_at: -1 })
        .limit(HISTORY_LIMIT)
        .toArray();
      const cryptos = await db.collection("crypto_invoices")
        .find({ user_id: telegramId, status: "paid" })
        .sort({ settled_at: -1, created_at: -1 })
        .limit(HISTORY_LIMIT)
        .toArray();

      const combined = [];
      for (const tx of txns) {
        combined.push({
          method: String(tx.method || "unknown").toUpperCase(),
          amount: Number(tx.amount || 0),
          status: tx.status,
          order_id: String(tx._id),
          date: tx.settled_at || tx.created_at,
          raw: tx,
        });
      }
      for (const c of cryptos) {
        combined.push({
          method: "CRYPTO",
          amount: Number(c.amount_inr || 0),
          amount_usdt: Number(c.amount_usdt || 0),
          status: c.status,
          order_id: String(c.track_id || c._id),
          track_id: String(c.track_id),
          date: c.settled_at || c.created_at,
          raw: c,
        });
      }
      combined.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const dbt = b.date ? new Date(b.date).getTime() : 0;
        return dbt - da;
      });
      const sliced = combined.slice(0, HISTORY_LIMIT);
      // serialize dates
      const serialized = sliced.map((x) => ({
        ...x,
        date: x.date ? new Date(x.date).toISOString() : null,
      }));
      return res.status(200).json({ success: true, history: serialized });
    }

    // POST create
    if (req.method === "POST" && (action === "create" || action === "create_upi" || action === "create_fampay" || action === "create_crypto" || action === "create_binance")) {
      const telegramId = getTelegramId(body.telegramId || body.telegram_id || req.query.telegramId);
      if (telegramId === null) {
        return res.status(400).json({ success: false, message: "Invalid Telegram ID." });
      }
      const user = await db.collection("users").findOne({ _id: telegramId });
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found. Start the bot first." });
      }
      const settings = await getPaymentSettings(db);
      let method = String(body.method || body.type || "").toLowerCase();
      // infer from action if not provided
      if (!method) {
        if (action === "create_upi") method = "upi";
        else if (action === "create_fampay") method = "fampay";
        else if (action === "create_crypto") method = "crypto";
        else if (action === "create_binance") method = "binance";
      }
      if (!method) {
        return res.status(400).json({ success: false, message: "Payment method is required." });
      }

      // UPI
      if (method === "upi" || method === "upi_auto") {
        const gateway = settings.active_inr_gateway;
        if (gateway !== "upi") {
          return res.status(400).json({ success: false, message: "UPI Gateway is currently disabled." });
        }
        const amountRaw = body.amount ?? body.inr ?? body.price;
        const amount = parseFloat(String(amountRaw || "").trim());
        if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(\.\d+)?$/.test(String(amountRaw).trim())) {
          return res.status(400).json({ success: false, message: "Enter a valid amount (numbers only)." });
        }
        if (amount < 1) {
          return res.status(400).json({ success: false, message: "Minimum recharge is ₹1." });
        }
        const result = await createUPIInvoice(amount);
        if (!result.success) {
          return res.status(502).json({ success: false, message: result.error || "Could not generate UPI invoice." });
        }
        const orderId = result.order_id;
        // avoid duplicate
        const exists = await db.collection("transactions").findOne({ _id: orderId });
        if (exists) {
          return res.status(409).json({ success: false, message: "Invoice already exists. Try again." });
        }
        await db.collection("transactions").insertOne({
          _id: orderId,
          user_id: telegramId,
          method: "upi",
          amount: amount,
          status: "pending",
          created_at: new Date(),
          expires_at: new Date(Date.now() + UPI_INVOICE_EXPIRY_MIN * 60 * 1000),
        });
        await logEvent(db, { type: "recharge", status: "pending", user_id: telegramId, message: `UPI invoice created for ₹${amount} order ${orderId}` });
        return res.status(200).json({
          success: true,
          method: "upi",
          order_id: orderId,
          qr_url: result.qr_url,
          amount: amount,
          expires_in_min: UPI_INVOICE_EXPIRY_MIN,
        });
      }

      if (method === "fampay") {
        const gateway = settings.active_inr_gateway;
        if (gateway !== "fampay") {
          return res.status(400).json({ success: false, message: "UPI Gateway is currently disabled." });
        }
        const result = await createFamPayInvoice();
        if (!result.success) {
          return res.status(502).json({ success: false, message: result.error || "Could not generate UPI QR." });
        }
        const orderId = result.order_id;
        const exists = await db.collection("transactions").findOne({ _id: orderId });
        if (exists) {
          return res.status(409).json({ success: false, message: "Invoice already exists. Try again." });
        }
        await db.collection("transactions").insertOne({
          _id: orderId,
          user_id: telegramId,
          method: "fampay",
          amount: null,
          status: "pending",
          created_at: new Date(),
          expires_at: new Date(Date.now() + UPI_INVOICE_EXPIRY_MIN * 60 * 1000),
        });
        await logEvent(db, { type: "recharge", status: "pending", user_id: telegramId, message: `UPI invoice created order ${orderId}` });
        return res.status(200).json({
          success: true,
          method: "fampay",
          order_id: orderId,
          qr_url: result.qr_url,
          expire: result.expire,
          expires_in_min: UPI_INVOICE_EXPIRY_MIN,
        });
      }

      if (method === "upi_auto") {
        // unified auto like bot: if gateway is fampay then create fampay else upi with amount
        // but we treat separately, this route is not normally called
        return res.status(400).json({ success: false, message: "Use method upi or fampay." });
      }

      if (method === "crypto") {
        if (!settings.crypto_enabled) {
          return res.status(400).json({ success: false, message: "Crypto payment is currently disabled." });
        }
        const amountRaw = body.amount ?? body.usdt ?? body.usd;
        const usdt = parseFloat(String(amountRaw || "").trim());
        if (!Number.isFinite(usdt) || usdt < MIN_USDT) {
          return res.status(400).json({ success: false, message: `Enter a valid amount. Minimum is ${MIN_USDT} USDT.` });
        }
        const orderId = `Oxa_${telegramId}_${Date.now()}`;
        const resOxa = await createOxaInvoice(usdt, orderId);
        if (!resOxa.success) {
          return res.status(502).json({ success: false, message: resOxa.error || "Could not generate crypto invoice." });
        }
        const inv = resOxa.data;
        const trackId = String(inv.track_id || inv.trackId || inv.id);
        const payUrl = inv.payment_url || inv.payUrl || inv.url;
        const inrVal = Math.round(usdt * USDT_TO_INR * 100) / 100;
        await db.collection("crypto_invoices").insertOne({
          user_id: telegramId,
          track_id: trackId,
          order_id: orderId,
          amount_usdt: usdt,
          amount_inr: inrVal,
          status: "pending",
          payment_url: payUrl,
          created_at: new Date(),
        });
        await logEvent(db, { type: "recharge", status: "pending", user_id: telegramId, message: `Crypto invoice ${trackId} for ${usdt} USDT (₹${inrVal})` });
        return res.status(200).json({
          success: true,
          method: "crypto",
          track_id: trackId,
          order_id: orderId,
          pay_url: payUrl,
          amount_usdt: usdt,
          amount_inr: inrVal,
          expires_in_min: 30,
        });
      }

      if (method === "binance") {
        if (!settings.binance_enabled) {
          return res.status(400).json({ success: false, message: "Binance Pay is currently disabled." });
        }
        const payId = process.env.BINANCE_PAY_ID || "";
        const qrUrl = process.env.BINANCE_QR_URL || "";
        if (!payId) {
          return res.status(502).json({ success: false, message: "Binance Pay not configured." });
        }
        // No DB insert yet; user will verify with orderId later
        return res.status(200).json({
          success: true,
          method: "binance",
          pay_id: payId,
          qr_url: qrUrl,
        });
      }

      return res.status(400).json({ success: false, message: "Unknown payment method." });
    }

    // POST verify
    if (req.method === "POST" && (action === "verify" || action === "verify_upi" || action === "verify_fampay" || action === "verify_crypto" || action === "verify_binance")) {
      const telegramId = getTelegramId(body.telegramId || body.telegram_id || req.query.telegramId);
      if (telegramId === null) {
        return res.status(400).json({ success: false, message: "Invalid Telegram ID." });
      }
      let method = String(body.method || body.type || "").toLowerCase();
      if (!method) {
        if (action === "verify_upi") method = "upi";
        else if (action === "verify_fampay") method = "fampay";
        else if (action === "verify_crypto") method = "crypto";
        else if (action === "verify_binance") method = "binance";
      }
      const orderId = String(body.order_id || body.orderId || body.track_id || body.trackId || body.orderId || body.id || "").trim();
      const trackId = String(body.track_id || body.trackId || orderId).trim();
      if (!orderId && method !== "binance") {
        return res.status(400).json({ success: false, message: "Order ID / Track ID is required." });
      }

      if (method === "upi") {
        const tx = await db.collection("transactions").findOne({ _id: orderId });
        if (!tx) return res.status(404).json({ success: false, message: "Invoice not found." });
        if (String(tx.user_id) !== String(telegramId)) return res.status(403).json({ success: false, message: "Not your invoice." });
        if (tx.status === "paid") return res.status(200).json({ success: true, already: true, message: "Already credited!", amount: tx.amount, balance: (await db.collection("users").findOne({ _id: telegramId }))?.balance || 0 });
        if (tx.expires_at && new Date(tx.expires_at) < new Date()) {
          return res.status(410).json({ success: false, message: "Invoice expired." });
        }
        const paid = await verifyUPIInvoice(orderId);
        if (!paid) return res.status(202).json({ success: false, message: "Payment not received yet. Try again in a moment." });
        // credit
        await db.collection("transactions").updateOne({ _id: orderId }, { $set: { status: "paid", settled_at: new Date() } });
        await db.collection("users").updateOne({ _id: telegramId }, { $inc: { balance: Number(tx.amount || 0) } }, { upsert: true });
        const userAfter = await db.collection("users").findOne({ _id: telegramId });
        const newBal = Number(userAfter?.balance || 0);
        await logEvent(db, { type: "recharge", status: "success", user_id: telegramId, message: `UPI verified ₹${tx.amount} order ${orderId}, new balance ₹${newBal}` });
        return res.status(200).json({ success: true, amount: tx.amount, balance: newBal, message: "Payment verified! Balance credited." });
      }

      if (method === "fampay") {
        const tx = await db.collection("transactions").findOne({ _id: orderId });
        if (!tx) return res.status(404).json({ success: false, message: "Invoice not found." });
        if (String(tx.user_id) !== String(telegramId)) return res.status(403).json({ success: false, message: "Not your invoice." });
        if (tx.status === "paid") return res.status(200).json({ success: true, already: true, message: "Already credited!", amount: tx.amount, balance: (await db.collection("users").findOne({ _id: telegramId }))?.balance || 0 });
        if (tx.expires_at && new Date(tx.expires_at) < new Date()) {
          return res.status(410).json({ success: false, message: "Invoice expired." });
        }
        const resF = await verifyFamPayInvoice(orderId);
        if (!resF.success) return res.status(202).json({ success: false, message: "Payment not received yet. Try again in a moment." });
        // check duplicate txn
        const dup = await db.collection("transactions").findOne({ claimed_txn: resF.txn });
        if (dup) return res.status(409).json({ success: false, message: "This payment was already claimed." });
        const amount = Number(resF.amount);
        await db.collection("transactions").updateOne({ _id: orderId }, { $set: { status: "paid", amount: amount, claimed_txn: resF.txn, settled_at: new Date() } });
        await db.collection("users").updateOne({ _id: telegramId }, { $inc: { balance: amount } }, { upsert: true });
        const userAfter = await db.collection("users").findOne({ _id: telegramId });
        const newBal = Number(userAfter?.balance || 0);
        await logEvent(db, { type: "recharge", status: "success", user_id: telegramId, message: `UPI verified ₹${amount} order ${orderId}, new balance ₹${newBal}` });
        return res.status(200).json({ success: true, amount, balance: newBal, sender: resF.sender, txn: resF.txn, message: "Payment verified! Balance credited." });
      }

      if (method === "crypto") {
        const tid = trackId || orderId;
        const inv = await db.collection("crypto_invoices").findOne({ track_id: tid });
        if (!inv) return res.status(404).json({ success: false, message: "Invoice not found." });
        if (String(inv.user_id) !== String(telegramId)) return res.status(403).json({ success: false, message: "Not your invoice." });
        if (inv.status === "paid") return res.status(200).json({ success: true, already: true, message: "Already credited!", amount: inv.amount_inr, balance: (await db.collection("users").findOne({ _id: telegramId }))?.balance || 0 });
        const apiRes = await checkOxaInvoice(tid);
        let remoteStatus = "unknown";
        if (apiRes && apiRes.data && apiRes.data.status) remoteStatus = String(apiRes.data.status).toLowerCase();
        else if (apiRes && apiRes.status) remoteStatus = String(apiRes.status).toLowerCase();
        if (["paid", "complete", "confirmed"].includes(remoteStatus)) {
          await db.collection("crypto_invoices").updateOne({ track_id: tid }, { $set: { status: "paid", settled_at: new Date() } });
          await db.collection("users").updateOne({ _id: telegramId }, { $inc: { balance: Number(inv.amount_inr || 0) } }, { upsert: true });
          const userAfter = await db.collection("users").findOne({ _id: telegramId });
          const newBal = Number(userAfter?.balance || 0);
          await logEvent(db, { type: "recharge", status: "success", user_id: telegramId, message: `Crypto verified ${inv.amount_usdt} USDT (₹${inv.amount_inr}) track ${tid}, new balance ₹${newBal}` });
          return res.status(200).json({ success: true, amount: inv.amount_inr, amount_usdt: inv.amount_usdt, balance: newBal, message: "Payment verified! Balance credited." });
        } else if (remoteStatus === "confirming") {
          return res.status(202).json({ success: false, message: "Payment confirming on blockchain. Wait a moment." });
        } else {
          return res.status(202).json({ success: false, message: `Status: ${remoteStatus}. Not confirmed yet.` });
        }
      }

      if (method === "binance") {
        const target = String(body.order_id || body.orderId || body.txn_id || body.txnId || body.id || "").trim();
        if (!target) return res.status(400).json({ success: false, message: "Order ID is required." });
        const exists = await db.collection("transactions").findOne({ _id: `bnc_${target}` });
        if (exists) return res.status(409).json({ success: false, message: "This Order ID was already claimed." });
        const resB = await verifyBinanceOrder(target);
        if (!resB.success) return res.status(202).json({ success: false, message: "Payment not found. Check Order ID and try again after a minute." });
        let amountInr = 0;
        if (String(resB.currency).toUpperCase() === "INR") amountInr = parseFloat(resB.amount);
        else amountInr = Math.round(parseFloat(resB.amount) * USDT_TO_INR * 100) / 100;
        if (!Number.isFinite(amountInr) || amountInr <= 0) return res.status(502).json({ success: false, message: "Invalid amount from Binance." });
        await db.collection("transactions").insertOne({
          _id: `bnc_${target}`,
          user_id: telegramId,
          method: "binance",
          amount: amountInr,
          status: "paid",
          created_at: new Date(),
          settled_at: new Date(),
        });
        await db.collection("users").updateOne({ _id: telegramId }, { $inc: { balance: amountInr } }, { upsert: true });
        const userAfter = await db.collection("users").findOne({ _id: telegramId });
        const newBal = Number(userAfter?.balance || 0);
        await logEvent(db, { type: "recharge", status: "success", user_id: telegramId, message: `Binance verified ₹${amountInr} order ${target}, new balance ₹${newBal}` });
        return res.status(200).json({ success: true, amount: amountInr, balance: newBal, payer: resB.payer_name, message: "Binance Pay verified! Balance credited." });
      }

      return res.status(400).json({ success: false, message: "Unknown verify method." });
    }

    return res.status(400).json({ success: false, message: "Unknown action." });
  } catch (error) {
    console.error("Recharge API error:", error);
    return res.status(500).json({ success: false, message: "Recharge API error.", error: error.message });
  }
};
