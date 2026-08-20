const { getDatabase, readJsonBody, setCors, findUserById } = require("../lib/db");
const { getCode: getTgLionCode } = require("../lib/tglion");
const { getMaintenance, logEvent } = require("../lib/site");
const { ObjectId } = require("mongodb");

function numberVariants(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const compact = raw.replace(/[^\d+]/g, "");
  const digits = compact.replace(/^\+/, "");
  const withPlus = digits ? `+${digits}` : "";
  return [...new Set([raw, compact, digits, withPlus].filter(Boolean))];
}

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });
  try {
    const body = readJsonBody(req);
    const rawUser = String(body.userId || body.telegramId || body.identifier || "").trim();
    const number = String(body.number || body.Number || "").trim();
    const orderIdRaw = String(body.orderId || body.order_id || "").trim();
    if (!rawUser) return res.status(400).json({ success: false, message: "Missing user." });
    if (!number && !orderIdRaw) return res.status(400).json({ success: false, message: "Number is required." });
    const variants = numberVariants(number);
    const db = await getDatabase();
    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) {
      return res.status(503).json({ success: false, maintenance: true, message: maintenance.message || "Under maintenance." });
    }

    // Resolve the user so we can confirm the order actually belongs to them.
    let user = await findUserById(db, rawUser);
    if (!user && /^\d+$/.test(rawUser)) user = await db.collection("users").findOne({ _id: Number(rawUser) });
    if (!user && rawUser.includes("@")) user = await db.collection("users").findOne({ email: rawUser.toLowerCase() });
    if (!user && rawUser.startsWith("+")) user = await db.collection("users").findOne({ phone: rawUser });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const telegramId = user.telegram_id || (typeof user._id === "number" ? user._id : null);
    const userIdStr = user._id instanceof ObjectId ? user._id.toHexString() : String(user._id);
    const candidates = [telegramId, user._id, userIdStr, String(user._id)].filter(v => v !== null && v !== undefined);
    try { candidates.push(new ObjectId(userIdStr)); } catch {}

    // Helper: make sure a found order belongs to this user.
    const ownsOrder = (order) => order && candidates.some(c => sameId(c, order.user_id));

    let order = null;

    // 1) Exact order lookup (used by the Order History "Get OTP" button).
    if (orderIdRaw) {
      const oid = /^[a-fA-F0-9]{24}$/.test(orderIdRaw) ? new ObjectId(orderIdRaw) : null;
      if (oid) {
        const found = await db.collection("orders").findOne({ _id: oid });
        if (ownsOrder(found)) order = found;
      }
    }

    // 2) Number-based lookup (used by the success modal "Get OTP" button).
    if (!order && variants.length) {
      for (const uid of candidates) {
        const found = await db.collection("orders").findOne({ user_id: uid, number: { $in: variants } });
        if (found) { order = found; break; }
      }
      if (!order) {
        const found = await db.collection("orders").findOne({ number: { $in: variants } });
        if (ownsOrder(found)) order = found;
      }
    }

    if (!order) {
      await logEvent(db, { type: "otp", status: "failed", user_id: telegramId, number, message: "No order found." });
      return res.status(404).json({ success: false, message: "No order found for this number." });
    }

    const orderNumber = String(order.number || number || "").trim();

    let result = null;
    if (order.provider === "tgpva" && order.provider_hash && process.env.TGPVA_API_KEY) {
      try {
        const url = `https://tgpva.com/api/user/getCode?apiKey=${encodeURIComponent(process.env.TGPVA_API_KEY)}&number=${encodeURIComponent(orderNumber)}&hash=${encodeURIComponent(order.provider_hash)}`;
        const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
        const data = await resp.json();
        if (data && data.ok && data.result && data.result.status === "Received" && data.result.code) {
          result = { Number: orderNumber, code: String(data.result.code).trim(), pass: String(data.result.password || data.result.pass || "").trim() };
        } else if (data && data.ok && data.result && data.result.status !== "Received") {
          result = { Number: orderNumber, code: "", pass: "" };
        }
      } catch (e) { console.error("TGPVA getCode error:", e); }
    }

    if (!result || !result.code) {
      try {
        result = await getTgLionCode(orderNumber);
      } catch (e) {
        if (!result) result = { code: "", pass: "" };
        if (e && e.statusCode && e.statusCode >= 500) throw e;
      }
    }

    if (!result || !result.code) {
      await logEvent(db, { type: "otp", status: "failed", user_id: telegramId, number: orderNumber, message: "OTP not available." });
      return res.status(409).json({ success: false, message: "OTP is not available yet. Try again in a moment." });
    }

    await db.collection("orders").updateOne(
      { _id: order._id },
      { $set: { otp: result.code, pass: result.pass || "", status: "completed", code_at: new Date() } }
    );
    await logEvent(db, { type: "otp", status: "success", user_id: telegramId, number: result.Number || orderNumber, message: "OTP received." });
    return res.status(200).json({
      success: true,
      Number: result.Number,
      number: result.Number || orderNumber,
      code: result.code,
      pass: result.pass || "",
      orderId: String(order._id),
      status: "completed"
    });
  } catch (error) {
    console.error("OTP error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "OTP could not be received." });
  }
};
