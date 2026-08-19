const {
  getDatabase,
  readJsonBody,
  setCors
} = require("../lib/db");

const { createSession } = require("../lib/site");

const ADMIN_ID = process.env.ADMIN_ID || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "adminlogin123";

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

    const id = String(body.id || body.username || "").trim();
    const password = String(body.password || "");

    if (!id || !password) {
      return res.status(400).json({
        success: false,
        message: "Enter your admin ID and password."
      });
    }

    if (id !== ADMIN_ID || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin ID or password."
      });
    }

    const db = await getDatabase();
    const token = await createSession(db, {
      role: "admin",
      id: id
    });

    return res.status(200).json({
      success: true,
      token: token
    });
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not sign in. Database error."
    });
  }
};
