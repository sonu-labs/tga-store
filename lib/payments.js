const crypto = require("crypto");

// Settings ID for payment gateways (same as Bot Codes/payment_settings.py)
const SETTINGS_ID = "payment_gateways";
const USDT_TO_INR = 90;
const MIN_USDT = 0.1;

const DEFAULTS = {
  _id: SETTINGS_ID,
  active_inr_gateway: "upi", // "upi" | "fampay" | null
  binance_enabled: true,
  crypto_enabled: true,
};

async function getPaymentSettings(db) {
  try {
    const doc = await db.collection("settings").findOne({ _id: SETTINGS_ID });
    if (!doc) {
      await db.collection("settings").insertOne({ ...DEFAULTS });
      return { ...DEFAULTS };
    }
    let changed = false;
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (!(k in doc)) {
        doc[k] = v;
        changed = true;
      }
    }
    if (changed) {
      await db.collection("settings").updateOne({ _id: SETTINGS_ID }, { $set: doc }, { upsert: true });
    }
    return doc;
  } catch (e) {
    console.error("getPaymentSettings error:", e);
    return { ...DEFAULTS };
  }
}

async function setPaymentSettings(db, updates) {
  const allowed = {};
  if ("active_inr_gateway" in updates) {
    const v = updates.active_inr_gateway;
    if (v === "upi" || v === "fampay" || v === null || v === "off" || v === "") {
      allowed.active_inr_gateway = v === "off" || v === "" ? null : v;
    }
  }
  if ("binance_enabled" in updates) allowed.binance_enabled = Boolean(updates.binance_enabled);
  if ("crypto_enabled" in updates) allowed.crypto_enabled = Boolean(updates.crypto_enabled);

  if (Object.keys(allowed).length === 0) {
    return await getPaymentSettings(db);
  }
  await db.collection("settings").updateOne({ _id: SETTINGS_ID }, { $set: allowed }, { upsert: true });
  return await getPaymentSettings(db);
}

// UPI Gateway
async function createUPIInvoice(amount) {
  const apiKey = process.env.UPI_API_KEY;
  const apiUrl = process.env.UPI_API_URL || "https://bot.jackdev.tech/paymentlinkbot/api.php";
  if (!apiKey) return { success: false, error: "UPI gateway not configured. Set UPI_API_KEY." };
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, action: "create", amount: Number(amount) }),
    });
    const data = await res.json().catch(async () => JSON.parse(await res.text()));
    const order_id = data.order_id || data.orderId || data.id;
    const qr_url = data.qr_url || data.qrUrl || data.qr || data.url;
    if (!order_id || !qr_url) {
      return { success: false, error: data.message || "Invalid response from UPI gateway" };
    }
    return { success: true, order_id: String(order_id), qr_url: String(qr_url) };
  } catch (e) {
    console.error("createUPIInvoice error:", e);
    return { success: false, error: String(e.message || e) };
  }
}

async function verifyUPIInvoice(orderId) {
  const apiKey = process.env.UPI_API_KEY;
  const apiUrl = process.env.UPI_API_URL || "https://bot.jackdev.tech/paymentlinkbot/api.php";
  if (!apiKey) return false;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, action: "verify", order_id: orderId }),
    });
    const data = await res.json().catch(async () => JSON.parse(await res.text()));
    return Boolean(data.status === "success" || data.paid === true || data.success === true);
  } catch (e) {
    console.error("verifyUPIInvoice error:", e);
    return false;
  }
}

// FamPay
async function createFamPayInvoice() {
  const upi = process.env.FAMPAY_UPI;
  const qrUrl = process.env.FAMPAY_QR_API_URL || "https://anujbots.xyz/api/qr.php";
  const apiKey = process.env.FAMPAY_API_KEY;
  if (!upi) return { success: false, error: "FamPay UPI not configured. Set FAMPAY_UPI." };
  try {
    const url = `${qrUrl}?upi=${encodeURIComponent(upi)}`;
    const res = await fetch(url, { method: "GET" });
    const data = await res.json().catch(async () => JSON.parse(await res.text()));
    if (data.status === "success" && data.data) {
      const d = data.data;
      return {
        success: true,
        order_id: String(d.order_id),
        qr_url: String(d.qr_url),
        expire: d.expires_at_ist || d.expire || null,
      };
    }
    return { success: false, error: data.message || "Failed to create FamPay QR" };
  } catch (e) {
    console.error("createFamPayInvoice error:", e);
    return { success: false, error: String(e.message || e) };
  }
}

async function verifyFamPayInvoice(orderId) {
  const apiKey = process.env.FAMPAY_API_KEY;
  const verifyUrl = process.env.FAMPAY_VERIFY_API_URL || "https://fampay.anujbots.xyz/verify.php";
  if (!apiKey) return { success: false };
  try {
    const url = `${verifyUrl}?order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: "GET" });
    const data = await res.json().catch(async () => JSON.parse(await res.text()));
    if (data.status === "success" && data.data) {
      const d = data.data;
      return {
        success: true,
        txn: String(d.transaction_id || d.txn || d.id),
        utr: d.utr || null,
        amount: parseFloat(d.amount),
        sender: d.sender_name || d.sender || "Unknown",
      };
    }
    return { success: false };
  } catch (e) {
    console.error("verifyFamPayInvoice error:", e);
    return { success: false };
  }
}

// Binance
async function verifyBinanceOrder(orderOrTxnId) {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_SECRET;
  if (!apiKey || !secret || !orderOrTxnId) return { success: false };
  try {
    const timestamp = Date.now();
    const recvWindow = 60000;
    const startTime = timestamp - 604800000; // 7 days
    const query = `timestamp=${timestamp}&recvWindow=${recvWindow}&startTime=${startTime}&endTime=${timestamp}`;
    const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
    const url = `https://api.binance.com/sapi/v1/pay/transactions?${query}&signature=${signature}`;
    const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    const data = await res.json().catch(async () => JSON.parse(await res.text()));
    const list = data.data || [];
    for (const tx of list) {
      if (String(tx.orderId) === String(orderOrTxnId) || String(tx.transactionId) === String(orderOrTxnId)) {
        return {
          success: true,
          amount: tx.amount,
          currency: tx.currency,
          payer_name: (tx.payerInfo && tx.payerInfo.name) || "Anonymous Payer",
        };
      }
    }
    return { success: false };
  } catch (e) {
    console.error("verifyBinanceOrder error:", e);
    return { success: false };
  }
}

// OxaPay
const OXAPAY_API_KEY = process.env.OXAPAY_API_KEY || "MMS26B-OMISYD-TRMU3M-RR4BWJ";
const OXAPAY_CREATE_URL = "https://api.oxapay.com/v1/payment/invoice";
const OXAPAY_STATUS_BASE = "https://api.oxapay.com/v1/payment";

async function createOxaInvoice(amountUsd, orderId) {
  try {
    const payload = {
      amount: Number(amountUsd),
      currency: "USD",
      to_currency: "USDT",
      lifetime: 30,
      fee_paid_by_payer: 1,
      under_paid_coverage: 2.5,
      auto_withdrawal: false,
      mixed_payment: true,
      order_id: String(orderId),
      description: `Recharge ${orderId}`,
      sandbox: false,
    };
    const res = await fetch(OXAPAY_CREATE_URL, {
      method: "POST",
      headers: {
        merchant_api_key: OXAPAY_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(async () => JSON.parse(await res.text()));
    if (data.status === 200 || data.message === "Operation completed successfully!") {
      return { success: true, data: data.data };
    }
    return { success: false, error: data.message || "Unknown OxaPay error" };
  } catch (e) {
    console.error("createOxaInvoice error:", e);
    return { success: false, error: String(e.message || e) };
  }
}

async function checkOxaInvoice(trackId) {
  try {
    const url = `${OXAPAY_STATUS_BASE}/${encodeURIComponent(String(trackId))}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { merchant_api_key: OXAPAY_API_KEY, "Content-Type": "application/json" },
    });
    const data = await res.json().catch(async () => JSON.parse(await res.text()));
    return data;
  } catch (e) {
    console.error("checkOxaInvoice error:", e);
    return { status: 500, message: String(e.message || e) };
  }
}

module.exports = {
  SETTINGS_ID,
  DEFAULTS,
  USDT_TO_INR,
  MIN_USDT,
  getPaymentSettings,
  setPaymentSettings,
  createUPIInvoice,
  verifyUPIInvoice,
  createFamPayInvoice,
  verifyFamPayInvoice,
  verifyBinanceOrder,
  createOxaInvoice,
  checkOxaInvoice,
};
