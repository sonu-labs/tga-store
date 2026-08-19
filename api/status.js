const { getDatabase, setCors } = require("../lib/db");
const { getMaintenance } = require("../lib/site");

module.exports = async function handler(req, res) {
  setCors(res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  try {
    const db = await getDatabase();
    const maintenance = await getMaintenance(db);

    return res.status(200).json({
      success: true,
      maintenance: maintenance.enabled,
      message: maintenance.message
    });
  } catch (error) {
    console.error("Status error:", error);

    return res.status(500).json({
      success: false,
      maintenance: false,
      message: "Could not load store status."
    });
  }
};
