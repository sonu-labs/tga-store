const bcrypt = require("bcryptjs");
const {
  getDatabase,
  readJsonBody,
  setCors
} = require("../db");

const { createSession, deleteAdminSessions } = require("../site");
const {
  clientIp,
  hashKey,
  timingSafeEqualString,
  consumeRateLimit,
  rateLimitedResponse
} = require("../security");

const ADMIN_ID = String(process.env.ADMIN_ID || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "").trim();

function adminConfigured() {
  return Boolean(ADMIN_ID && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH));
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

  if (!adminConfigured()) {
    console.error("Admin login is not configured. Set ADMIN_ID and ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) in the host environment.");
    return res.status(503).json({
      success: false,
      message: "Admin login is not configured on the server."
    });
  }

  try {
    const body = readJsonBody(req);
    const id = String(body.id || body.username || "").trim();
    const password = String(body.password || "");
    const ip = clientIp(req);
    const db = await getDatabase();

    if (!id || !password) {
      return res.status(400).json({
        success: false,
        message: "Enter your admin ID and password."
      });
    }

    const ipLimit = await consumeRateLimit(db, `admin_login:ip:${hashKey(ip)}`, {
      max: 5,
      windowMs: 15 * 60 * 1000
    });
    if (!ipLimit.ok) return rateLimitedResponse(res, ipLimit.retryAfter);

    const idLimit = await consumeRateLimit(db, `admin_login:id:${hashKey(id.toLowerCase())}`, {
      max: 8,
      windowMs: 15 * 60 * 1000
    });
    if (!idLimit.ok) return rateLimitedResponse(res, idLimit.retryAfter);

    const idOk = timingSafeEqualString(id, ADMIN_ID);
    let passOk = false;
    if (ADMIN_PASSWORD_HASH) {
      try {
        passOk = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
      } catch {
        passOk = false;
      }
    } else {
      passOk = timingSafeEqualString(password, ADMIN_PASSWORD);
    }

    if (!idOk || !passOk) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin ID or password."
      });
    }

    await deleteAdminSessions(db, ADMIN_ID);
    const token = await createSession(db, {
      role: "admin",
      id: ADMIN_ID,
      ip
    });

    return res.status(200).json({
      success: true,
      token
    });
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not sign in."
    });
  }
};
