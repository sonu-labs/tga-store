const { getDatabase, setCors } = require("../db");
const { getMaintenance } = require("../site");
const { maybeNotifyDeploy, currentDeployId } = require("../notify");
const { getSiteTheme } = require("../themes");
const { runMigrations } = require("../migrations");

/*
  SPEED: the store status (maintenance flag + active theme) is polled by every
  open tab, and each poll used to touch Mongo several times (maintenance read,
  deploy-ping read/write, migrations read/write, theme read). A 15 second
  in-memory cache keeps that traffic off the database and makes the client's
  polling loop effectively free, while a maintenance toggle still reaches every
  visitor within seconds.
*/
const STATUS_TTL_MS = 15 * 1000;
const statusCache = { at: 0, body: null };

function sendStatus(res, body, source) {
  res.setHeader("Cache-Control", "public, max-age=10, s-maxage=15, stale-while-revalidate=30");
  res.setHeader("X-Cache", source || "miss");
  return res.status(200).json(body);
}

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

  const now = Date.now();
  if (statusCache.body && now - statusCache.at < STATUS_TTL_MS) {
    return sendStatus(res, statusCache.body, "hit");
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

    const body = {
      success: true,
      maintenance: maintenance.enabled,
      message: maintenance.message,
      theme,
      deploy_id: currentDeployId() || null,
      deploy_ping: deploy && deploy.skipped ? "already-sent" : deploy && deploy.ok ? "sent" : "failed"
    };

    try {
      statusCache.body = body;
      statusCache.at = Date.now();
    } catch (e) {}

    return sendStatus(res, body, "miss");
  } catch (error) {
    console.error("Status error:", error);

    return res.status(500).json({
      success: false,
      maintenance: false,
      message: "Could not load store status."
    });
  }
};
