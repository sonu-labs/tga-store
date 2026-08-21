/*
  LOCAL THEME PREVIEW SERVER (development only — not used by Vercel)

  Serves /public with a small in-memory mock of the store API so the whole
  user interface (login → dashboard → buy → recharge → orders → settings) can
  be clicked through while checking the full-UI themes, without MongoDB or the
  Telegram bot.

    node dev/preview-server.js          # http://localhost:3000
    node dev/preview-server.js 8080     # custom port

  Query helpers:
    /?preview_theme=glass               force a theme for one tab
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const { THEMES, normalizeTheme } = require("../lib/themes");

const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

let activeTheme = process.env.THEME || "default";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const COUNTRIES = {
  US: { qty: 214, price: 0.62 }, IN: { qty: 980, price: 0.28 },
  GB: { qty: 143, price: 0.71 }, DE: { qty: 88, price: 0.66 },
  FR: { qty: 61, price: 0.64 },  BR: { qty: 402, price: 0.35 },
  ID: { qty: 517, price: 0.31 }, RU: { qty: 0, price: 0.44 },
  NG: { qty: 233, price: 0.29 }, PK: { qty: 176, price: 0.33 },
  PH: { qty: 122, price: 0.38 }, TR: { qty: 305, price: 0.4 },
  VN: { qty: 264, price: 0.36 }, MY: { qty: 74, price: 0.52 },
  ZA: { qty: 39, price: 0.57 },  EG: { qty: 158, price: 0.34 }
};

const ORDERS = [
  { country: "United States", number: "+14155550142", otp: "48213", status: "completed", price: 58, date: "2026-08-19" },
  { country: "Indonesia", number: "+628115550091", otp: "", status: "waiting", price: 29, date: "2026-08-20" },
  { country: "Germany", number: "+4915155501", otp: "77120", status: "completed", price: 62, date: "2026-08-20" },
  { country: "Brazil", number: "+5511955501", otp: "", status: "cancelled", price: 33, date: "2026-08-21" }
];

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); }
    });
  });
}

async function api(req, res, url) {
  const route = url.pathname.replace(/^\/api\//, "");
  const action = url.searchParams.get("action") || "";
  const body = req.method === "POST" ? await readBody(req) : {};

  if (route === "status") {
    return json(res, 200, { success: true, maintenance: false, message: "", theme: normalizeTheme(activeTheme) });
  }

  if (route === "login") {
    return json(res, 200, {
      success: true,
      user: { userId: "demo-1", telegramId: "7888066934", username: "Demo User", balance: 4720 }
    });
  }

  if (route === "dashboard") {
    return json(res, 200, {
      success: true,
      user: { username: "Demo User", balance: 4720, telegramId: "7888066934" },
      totalOrders: ORDERS.length,
      totalRecharge: 7,
      announcement: { title: "Theme demo", text: "This is the local mock API used for previewing themes." },
      orders: ORDERS
    });
  }

  if (route === "countries") {
    return json(res, 200, { success: true, countries: COUNTRIES });
  }

  if (route === "buy") {
    return json(res, 200, {
      success: true,
      order: { id: "demo-order", country: "Demo", number: "+10000000000", price: 40 },
      number: "+10000000000",
      password: "demo-pass-1234",
      code: "demo-code"
    });
  }

  if (route === "code") {
    return json(res, 200, { success: true, otp: "" + Math.floor(10000 + Math.random() * 89999) });
  }

  if (route === "recharge") {
    if (action === "settings") {
      return json(res, 200, {
        success: true,
        settings: { active_inr_gateway: "upi", binance_enabled: true, crypto_enabled: true },
        binance: { pay_id: "123456789", qr_url: "" },
        usdt_to_inr: 90,
        min_usdt: 0.1
      });
    }
    if (action === "history") {
      return json(res, 200, {
        success: true,
        recharges: [
          { amount: 500, method: "UPI", status: "completed", date: "2026-08-18" },
          { amount: 1200, method: "Binance", status: "completed", date: "2026-08-14" }
        ]
      });
    }
    return json(res, 200, { success: true });
  }

  if (route === "account") {
    if (action === "bot-connect") {
      return json(res, 200, { success: true, connected: true, code: "TGA-DEMO", linked: true });
    }
    return json(res, 200, { success: true, message: "Mock account endpoint." });
  }

  if (route === "admin") {
    if (action === "theme" || action === "themes") {
      if (req.method === "POST") {
        activeTheme = normalizeTheme(body.theme || body.id || "default");
      }
      return json(res, 200, { success: true, theme: activeTheme, themes: THEMES });
    }
    return json(res, 200, { success: true });
  }

  return json(res, 404, { success: false, message: "Mock API: unknown route " + route });
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  if (url.pathname.startsWith("/api/")) {
    api(req, res, url).catch((e) => json(res, 500, { success: false, message: String(e) }));
    return;
  }

  // dev-only gallery: every theme rendered live, side by side
  if (url.pathname === "/gallery") {
    const cards = THEMES.map((t) => `
      <figure>
        <figcaption>
          <b>${t.emoji} ${t.name}</b>
          <span>${t.ui}</span>
          <a href="/?preview_theme=${t.id}" target="_blank" rel="noopener">open ↗</a>
        </figcaption>
        <div class="frame"><iframe src="/?preview_theme=${t.id}" loading="lazy"></iframe></div>
      </figure>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TGA Store — theme gallery (${THEMES.length})</title>
<style>
  body{margin:0;background:#0b0d10;color:#e8eef6;font:14px/1.5 system-ui,sans-serif;padding:22px}
  h1{font-size:20px;margin:0 0 4px}
  p.sub{color:#8b97a8;margin:0 0 20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}
  figure{margin:0;background:#12161c;border:1px solid #232b36;border-radius:14px;overflow:hidden}
  figcaption{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-bottom:1px solid #232b36}
  figcaption span{color:#8b97a8;font-size:11.5px}
  figcaption a{color:#4ade9b;font-size:11.5px;text-decoration:none;margin-top:4px}
  .frame{height:520px;overflow:hidden;background:#000}
  iframe{width:1280px;height:1486px;border:0;transform:scale(.35);transform-origin:0 0}
</style></head><body>
<h1>TGA Store — ${THEMES.length} full-UI themes</h1>
<p class="sub">Log in once on any frame (mock API accepts anything) — all frames share the session.</p>
<div class="grid">${cards}</div>
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
    return;
  }

  // small helper endpoint so the gallery page can switch the "stored" theme
  if (url.pathname === "/__set-theme") {
    activeTheme = normalizeTheme(url.searchParams.get("id") || "default");
    return json(res, 200, { success: true, theme: activeTheme });
  }

  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  if (rel === "/admin" || rel === "/admin/") rel = "/admin.html";
  if (rel === "/admin_login" || rel === "/admin_login/") rel = "/admin_login.html";

  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  serveStatic(res, filePath);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("TGA theme preview running on http://0.0.0.0:" + PORT);
  console.log("Themes: " + THEMES.map((t) => t.id).join(", "));
});
