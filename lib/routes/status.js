const { getDatabase, setCors } = require("../db");
const { getMaintenance } = require("../site");
const { maybeNotifyDeploy, currentDeployId } = require("../notify");
const { getSiteTheme } = require("../themes");
const { runMigrations } = require("../migrations");

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

    // Idempotent one-time data fixes (guarded by a flag in the settings
    // collection). Runs at most once per deployment.
    try {
      await runMigrations(db);
    } catch (e) {
      console.error("Migrations error:", (e && e.message) || e);
    }

    // Active store theme so the user site can restyle itself.
    let theme = "default";
    try {
      theme = await getSiteTheme(db);
    } catch (e) {
      console.error("Theme error:", (e && e.message) || e);
    }

    return res.status(200).json({
      success: true,
      maintenance: maintenance.enabled,
      message: maintenance.message,
      theme,
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
