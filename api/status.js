const { getDatabase, setCors } = require("../lib/db");
const { getMaintenance } = require("../lib/site");
const { maybeNotifyDeploy, currentDeployId } = require("../lib/notify");

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

    // "Logs are active" ping.
    //
    // Vercel has no startup hook, so the first request after a new deployment
    // announces it. maybeNotifyDeploy() locks on the deployment id in the
    // `settings` collection, so this fires exactly ONCE per deploy/restart and
    // never spams the channel on subsequent page loads.
    let deploy = null;
    try {
      deploy = await maybeNotifyDeploy(db);
    } catch (e) {
      console.error("Deploy ping error:", (e && e.message) || e);
    }

    return res.status(200).json({
      success: true,
      maintenance: maintenance.enabled,
      message: maintenance.message,
      deploy_id: currentDeployId() || null,
      deploy_ping: deploy && deploy.skipped ? "already-sent" : deploy && deploy.ok ? "sent" : "failed"
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
