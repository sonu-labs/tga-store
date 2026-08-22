/* ==========================================================================
   TGA STORE — SINGLE SERVERLESS FUNCTION (Vercel Hobby plan)

   Vercel's Hobby plan ships a limited number of serverless Functions per
   project, so instead of deploying one lambda per route in `api/` (login,
   account, admin, buy, code, countries, dashboard, recharge, status,
   qr_proxy, admin_login, apikey, v1) everything is consolidated into a
   single catch-all Function.

   The catch-all `api/[...slug].js` receives every request under `/api/*`
   (Vercel exposes the path segments as `req.query.slug`). We read the first
   segment to pick the matching route handler, then delegate the SAME req/res
   to it. Every handler keeps its own CORS, method checks, body parsing and
   error handling, so behaviour is identical to the old one-file-per-route
   setup — just one deployed Function instead of 13.

   Handlers live in `lib/routes/` (regular modules, not deployed as
   Functions).
   ========================================================================== */

const { setSecurityHeaders } = require("../lib/security");

const routes = {
  login: require("../lib/routes/login"),
  account: require("../lib/routes/account"),
  admin: require("../lib/routes/admin"),
  admin_login: require("../lib/routes/admin_login"),
  apikey: require("../lib/routes/apikey"),
  buy: require("../lib/routes/buy"),
  code: require("../lib/routes/code"),
  countries: require("../lib/routes/countries"),
  dashboard: require("../lib/routes/dashboard"),
  qr_proxy: require("../lib/routes/qr_proxy"),
  recharge: require("../lib/routes/recharge"),
  status: require("../lib/routes/status"),
  v1: require("../lib/routes/v1"),
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  setSecurityHeaders(res);
}

/**
 * Resolve the first path segment (the "route") for a request to /api/<route>.
 * Prefers Vercel's catch-all param (req.query.slug) and falls back to parsing
 * req.url so the dispatch is robust across runtimes.
 */
function getRoute(req) {
  const query = req && req.query ? req.query : {};
  const slug = query.slug;

  if (Array.isArray(slug) && slug.length && slug[0]) {
    return slug[0];
  }
  if (typeof slug === "string" && slug) {
    return slug;
  }

  // Fallback: parse the raw URL. Handles both "/api/login" (function mounted
  // at /api) and "/login" (already relative to the function).
  try {
    const rawPath = String(req.url || "/").split("?")[0];
    const segments = rawPath.split("/").filter(Boolean);
    const apiIndex = segments.indexOf("api");
    if (apiIndex !== -1 && segments[apiIndex + 1]) {
      return segments[apiIndex + 1];
    }
    if (segments.length) {
      // If there's no "/api" prefix, the first segment IS the route.
      return segments[0];
    }
  } catch (e) {
    // ignore — fall through to "not found"
  }

  return "";
}

module.exports = async function handler(req, res) {
  const route = getRoute(req);
  const routeHandler = routes[route];

  if (!routeHandler) {
    setCors(res);
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    return res.status(404).json({ success: false, message: "API endpoint not found." });
  }

  try {
    await routeHandler(req, res);
  } catch (error) {
    console.error(`API dispatch error [${route}]:`, error);
    // Only respond if the handler hasn't already started sending a response.
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Server error." });
    }
  }
};
