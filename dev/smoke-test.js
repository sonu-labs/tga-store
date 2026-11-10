/*
  Headless smoke test for /public (development only).

    npm install --no-save jsdom
    node dev/smoke-test.js

  Boots index.html in jsdom with the real local scripts, stubs fetch() against
  the mock API contract, and reports every runtime error. Catches exactly the
  class of bugs that break the page silently (renamed ids, missing functions,
  syntax errors in dynamic HTML, …).
*/

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const PUBLIC = path.join(__dirname, "..", "public");

/* jsdom 31 no longer ships ResourceLoader — inline the local scripts instead. */
function inlineLocalScripts(html) {
  return html.replace(/<script\s+src="(\/[^"]+)"[^>]*><\/script>/g, (match, src) => {
    const file = path.join(PUBLIC, src);
    if (!fs.existsSync(file)) return "";
    return `<script>${fs.readFileSync(file, "utf8")}<\/script>`;
  }).replace(/<script\s+src="https:\/\/telegram\.org[^>]*><\/script>/g, "");
}

const errors = [];
const logs = [];

function jsonBody(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

const ROUTES = {
  "/api/status": { success: true, maintenance: false, message: "", theme: "default" },
  "/api/countries": {
    success: true,
    countries: {
      US: { qty: 214, price: 0.62 },
      IN: { qty: 980, price: 0.28 },
      GB: { qty: 143, price: 0.71 },
      DE: { qty: 88, price: 0.66 },
      BR: { qty: 402, price: 0.35 },
      ID: { qty: 517, price: 0.31 }
    }
  },
  "/api/dashboard": {
    success: true,
    user: {
      userId: "7888066934",
      telegramId: "7888066934",
      username: "tg_demo_user",
      firstName: "Demo",
      lastName: "User",
      balance: 4720,
      bot_connected: true
    },
    totalOrders: 4,
    totalRecharge: 7,
    orders: [
      { country: "United States", number: "+14155550142", otp: "48213", status: "completed", price: 58 },
      { country: "Indonesia", number: "+628115550091", otp: "", status: "waiting", price: 29 }
    ]
  },
  "/api/account?action=session": {
    success: true,
    auth: true,
    user: { userId: "7888066934", telegramId: "7888066934", username: "tg_demo_user", firstName: "Demo" }
  }
};

function boot({ withSession, stale }) {
  return new Promise((resolve) => {
    const html = inlineLocalScripts(fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"));
    const dom = new JSDOM(html, {
      url: "http://localhost/",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      beforeParse(window) {
        window.IntersectionObserver = class {
          constructor(cb) { this.cb = cb; this.active = true; }
          observe(el) {
            const self = this;
            setTimeout(() => {
              if (!self.active) return;
              try { self.cb([{ isIntersecting: true, target: el }], self); } catch (e) { errors.push("observer: " + e.message); }
            }, 15);
          }
          disconnect() { this.active = false; }
          unobserve() {}
        };
        window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
        window.scrollTo = () => {};
        window.fetch = async (url) => {
          const u = String(url);
          if (stale && u.includes("/api/dashboard")) {
            return { ok: false, status: 401, json: async () => ({ success: false, auth: false, message: "Please login again." }), text: async () => "" };
          }
          if (stale && u.includes("action=session")) {
            return { ok: true, status: 200, json: async () => ({ success: true, auth: false }), text: async () => "" };
          }
          const key = Object.keys(ROUTES).find((k) => u.includes(k));
          if (key) return jsonBody(ROUTES[key]);
          return jsonBody({ success: true });
        };
        if (withSession) {
          window.localStorage.setItem("tga_session", "preview-demo-token");
          window.localStorage.setItem("tga_user_id", "7888066934");
          window.localStorage.setItem("tga_telegram_id", "7888066934");
          window.localStorage.setItem("tga_first_name", "Demo");
          window.localStorage.setItem("tga_last_name", "User");
        }
        window.addEventListener("error", (e) => errors.push("window.onerror: " + (e.error && e.error.stack || e.message)));
        const origError = window.console.error;
        window.console.error = function (...args) {
          logs.push(args.map(String).join(" "));
          origError.apply(window.console, args);
        };
      }
    });

    setTimeout(() => resolve(dom), 1400);
  });
}

(async () => {
  // ---- 1. logged-out visitor (normal browser)
  let dom = await boot({ withSession: false });
  let doc = dom.window.document;
  const loginVisible = doc.getElementById("loginScreen").style.display !== "none";
  const dashHidden = doc.getElementById("dashboardScreen").style.display === "none";
  const bootingShown = Boolean(doc.getElementById("telegramBooting"));
  console.log("guest  → login visible:", loginVisible, "| dashboard hidden:", dashHidden, "| telegram spinner:", bootingShown);

  // The old bug: spinner + "Telegram sign-in did not complete" for normal visitors.
  if (bootingShown) errors.push("guest saw the Telegram booting spinner (auto-logout bug)");
  const guestError = doc.getElementById("loginError").textContent.trim();
  console.log("guest  → login error message:", JSON.stringify(guestError));
  if (guestError) errors.push("guest was shown a Telegram error message: " + guestError);

  // ---- 2. returning visitor with a saved session
  dom = await boot({ withSession: true });
  doc = dom.window.document;
  const dashVisible = doc.getElementById("dashboardScreen").style.display !== "none";
  const welcome = doc.getElementById("welcomeName").textContent.trim();
  const balance = doc.getElementById("balanceValue").textContent.trim();
  const cards = doc.querySelectorAll("#homeCountries .country-card").length;
  const buyCards = doc.querySelectorAll("#countriesGrid .country-card").length;
  console.log("session→ dashboard visible:", dashVisible, "| name:", JSON.stringify(welcome), "| balance:", balance, "| home cards:", cards, "| buy cards:", buyCards);
  console.log("cached dashboard keys:", Boolean(dom.window.localStorage.getItem("tga_cache_dashboard_v1")));

  if (!dashVisible) errors.push("saved session did not restore the dashboard");
  if (welcome !== "Demo User") errors.push("welcome name not painted: " + welcome);
  if (!cards) errors.push("home country cards not rendered");

  // ---- 3. expired session → login screen, exactly once
  dom = await boot({ withSession: true, stale: true });
  doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 1400));
  const backToLogin = doc.getElementById("loginScreen").style.display !== "none";
  const tokenCleared = !dom.window.localStorage.getItem("tga_session");
  const errMsg = doc.getElementById("loginError").textContent.trim();
  console.log("stale  → login shown:", backToLogin, "| token cleared:", tokenCleared, "| message:", JSON.stringify(errMsg));
  if (!backToLogin) errors.push("expired session did not return to the login screen");
  if (!tokenCleared) errors.push("expired session did not clear the stored token");

  const hardErrors = logs.filter((l) => !/Could not|Failed|TypeError: Cannot read|is not a function/.test(l));
  const bad = errors.concat(logs.filter((l) => /is not defined|is not a function|Cannot read/.test(l)));

  console.log("\nconsole.error calls:", logs.length);
  if (bad.length) {
    console.log("\n❌ PROBLEMS:");
    bad.forEach((b) => console.log(" -", b));
    process.exitCode = 1;
  } else {
    console.log("\n✅ smoke test passed");
  }
  dom.window.close();
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
