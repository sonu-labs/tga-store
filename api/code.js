const { getDatabase, readJsonBody, setCors, findUserById } = require("../lib/db");
const { getCode: getTgLionCode } = require("../lib/tglion");
const { getMaintenance, logEvent } = require("../lib/site");
const { ObjectId } = require("mongodb");

function numberVariants(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const compact = raw.replace(/[^\\d+]/g, "");
  const digits = compact.replace(/^\+/, "");
  const withPlus = digits ? `+${digits}` : "";
  return [...new Set([raw, compact, digits, withPlus].filter(Boolean))];
}

module.exports = async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed." });
  try {
    const body = readJsonBody(req);
    const rawUser = String(body.userId || body.telegramId || body.identifier || "").trim();
    const number = String(body.number || body.Number || "").trim();
    if (!rawUser) return res.status(400).json({ success: false, message: "Missing user." });
    if (!number) return res.status(400).json({ success: false, message: "Number is required." });
    const variants = numberVariants(number);
    const db = await getDatabase();
    const maintenance = await getMaintenance(db);
    if (maintenance.enabled) {
      return res.status(503).json({ success: false, maintenance: true, message: maintenance.message || "Under maintenance." });
    }
    // resolve user to get possible user_id values
    let user = await findUserById(db, rawUser);
    if (!user && /^\d+$/.test(rawUser)) user = await db.collection("users").findOne({ _id: Number(rawUser) });
    if (!user && rawUser.includes("@")) user = await db.collection("users").findOne({ email: rawUser.toLowerCase() });
    if (!user && rawUser.startsWith("+")) user = await db.collection("users").findOne({ phone: rawUser });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    const telegramId = user.telegram_id || (typeof user._id === "number" ? user._id : null);
    const userIdStr = user._id instanceof ObjectId ? user._id.toHexString() : String(user._id);
    const candidates = [telegramId, user._id, userIdStr, String(user._id)].filter(v=>v!==null && v!==undefined);
    try { candidates.push(new ObjectId(userIdStr)); } catch {}
    // try find order with any of those user_ids
    let order = null;
    for (const uid of candidates) {
      order = await db.collection("orders").findOne({ user_id: uid, number: { $in: variants } });
      if (order) break;
    }
    if (!order) {
      order = await db.collection("orders").findOne({ number: { $in: variants } });
      // ensure belongs to this user? if found but different user, still deny
      if (order && !candidates.some(c=> String(c)===String(order.user_id))) order = null;
    }
    if (!order) {
      await logEvent(db, { type: "otp", status: "failed", user_id: telegramId, number, message: "No order found." });
      return res.status(404).json({ success: false, message: "No order found for this number." });
    }
    let result = null;
    if (order.provider === "tgpva" && order.provider_hash && process.env.TGPVA_API_KEY) {
      try {
        const url = `https://tgpva.com/api/user/getCode?apiKey=${encodeURIComponent(process.env.TGPVA_API_KEY)}&number=${encodeURIComponent(order.number || number)}&hash=${encodeURIComponent(order.provider_hash)}`;
        const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
        const data = await resp.json();
        if (data && data.ok && data.result && data.result.status === "Received" && data.result.code) {
          result = { Number: order.number || number, code: String(data.result.code).trim(), pass: String(data.result.password || data.result.pass || "").trim() };
        } else if (data && data.ok && data.result && data.result.status !== "Received") {
          result = { Number: order.number || number, code: "", pass: "" };
        }
      } catch (e) { console.error("TGPVA getCode error:", e); }
    }
    if (!result || !result.code) {
      try { result = await getTgLionCode(order.number || number); } catch (e) {
        if (!result) result = { code: "", pass: "" };
        if (e && e.statusCode && e.statusCode >= 500) throw e;
      }
    }
    if (!result.code) {
      await logEvent(db, { type: "otp", status: "failed", user_id: telegramId, number: order.number || number, message: "OTP not available." });
      return res.status(409).json({ success: false, message: "OTP is not available yet. Try again in a moment." });
    }
    await db.collection("orders").updateOne({ _id: order._id }, { $set: { otp: result.code, pass: result.pass || "", status: "completed", code_at: new Date() } });
    await logEvent(db, { type: "otp", status: "success", user_id: telegramId, number: result.Number || order.number, message: "OTP received." });
    return res.status(200).json({ success: true, Number: result.Number, number: result.Number, code: result.code, pass: result.pass || "" });
  } catch (error) {
    console.error("OTP error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "OTP could not be received." });
  }
};
