/* ==========================================================================
   TGA STORE — TELEGRAM MINI APP BOOTSTRAP
   ==========================================================================
   Loaded by index.html. When the page is opened *inside* Telegram (bot menu
   button, web_app inline button, or a t.me/<bot>/<app> link) this script:

     1. asks Telegram for the signed `initData` (window.Telegram.WebApp),
     2. posts it to /api/telegram, where the server verifies the HMAC signature,
        finds/creates the user by numeric Telegram id and returns a session,
     3. stores that session exactly like a normal website login, so the ID,
        name, username, photo and balance are all filled in automatically,
     4. tells index.html to open the dashboard (`window.__tgaOpenDashboard`).

   Why it can look like "auto-login does not work":
     • The page was opened in Telegram's in-app *browser* (a normal link in a
       chat), not as a Mini App → Telegram passes no initData at all.
     • telegram-web-app.js was blocked/slow (adblock, flaky network) → there is
       still initData in the launch URL hash (`#tgWebAppData=…`) which we can
       read ourselves.
     • The bot token on the server belongs to a different bot than the one the
       Mini App is attached to → /api/telegram answers 401 bad_hash.

   Every failure path now reports a specific reason (console + the
   `tga:telegram-auth-failed` event + window.__tgaTelegramDiag) instead of
   silently showing the password form.
   ========================================================================== */

(function () {
  "use strict";

  var SDK_WAIT_MS = 3000;
  var started = false;

  var diag = {
    hasTelegramObject: false,
    initDataLength: 0,
    source: "",
    attempts: 0,
    lastError: "",
    finished: false
  };
  window.__tgaTelegramDiag = diag;

  /* ---------------------------------------------------------------- helpers */

  function webApp() {
    return (window.Telegram && window.Telegram.WebApp) || null;
  }

  /* Telegram Web/Desktop sometimes only fills initData after the SDK script
     has fully booted. Poll briefly instead of giving up on the first tick. */
  function waitForInitData(deadline) {
    var app = webApp();
    if (app && app.initData) return Promise.resolve(app.initData);
    if (Date.now() > deadline) return Promise.resolve("");
    return new Promise(function (resolve) {
      setTimeout(function () {
        waitForInitData(deadline).then(resolve);
      }, 120);
    });
  }

  /*
    Fallback: a Mini App launch URL carries the payload in the hash, e.g.
      https://store.example/#tgWebAppData=query_id%3D...&tgWebAppVersion=7.0
    telegram-web-app.js normally parses this for us; reading it directly keeps
    sign-in working when the SDK script could not load (blocked CDN, old
    Telegram client, offline cache).
  */
  function initDataFromHash() {
    var hash = String((window.location && window.location.hash) || "");
    if (hash.length < 2) return "";

    var query = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var params;
    try {
      params = new URLSearchParams(query);
    } catch (e) {
      return "";
    }
    if (params.get("tgWebAppData")) return params.get("tgWebAppData");

    // Older clients double-encode the whole app payload.
    var flat = params.get("tgWebAppData");
    if (flat) return flat;

    var idx = query.indexOf("tgWebAppData=");
    if (idx === -1) return "";
    var value = query.slice(idx + "tgWebAppData=".length).split("&tgWebApp")[0];
    try {
      return decodeURIComponent(value);
    } catch (e) {
      return value;
    }
  }

  function storeSession(token, user) {
    try {
      localStorage.setItem("tga_session", token);
      var uid = String(user.userId || user.telegramId || "");
      if (uid) localStorage.setItem("tga_user_id", uid);
      if (user.telegramId) localStorage.setItem("tga_telegram_id", String(user.telegramId));
      if (user.username) localStorage.setItem("tga_username", user.username);
      if (user.photoUrl) localStorage.setItem("tga_photo", user.photoUrl);
      if (user.firstName) localStorage.setItem("tga_first_name", user.firstName);
      if (user.lastName) localStorage.setItem("tga_last_name", user.lastName);
      localStorage.setItem("tga_login_source", "telegram");
    } catch (e) {}
  }

  function openDashboard(user) {
    // index.html exposes this hook so the dashboard opens without a reload.
    try {
      if (typeof window.__tgaOpenDashboard === "function") {
        window.__tgaOpenDashboard(user || null);
        return;
      }
    } catch (e) {}

    // Pages without the hook (e.g. /docs) just listen for this event.
    try {
      window.dispatchEvent(new CustomEvent("tga:telegram-auth", { detail: user || null }));
    } catch (e) {}

    // Last resort: reload lets the page's own startup read the saved session.
    // Guarded so a broken API can never cause a reload loop.
    try {
      if (!sessionStorage.getItem("tga_tg_reloaded")) {
        sessionStorage.setItem("tga_tg_reloaded", "1");
        window.location.replace(window.location.pathname);
      }
    } catch (e) {}
  }

  function fail(reason, detail) {
    diag.lastError = String(reason || "failed");
    diag.finished = true;

    // Message ids map to the human explanations in index.html.
    console.warn("[tga] Telegram auto-login failed:", reason, detail || "");

    try {
      localStorage.removeItem("tga_login_source");
    } catch (e) {}

    var payload = { reason: String(reason || "failed"), detail: detail ? String(detail) : "" };

    var notify = function () {
      try {
        window.dispatchEvent(new CustomEvent("tga:telegram-auth-failed", { detail: payload }));
      } catch (e) {}
    };

    // This file runs while the page is still parsing, so the page's own
    // listeners may not exist yet — remember it and re-signal on DOM ready.
    try { window.__tgaTelegramAuthFailed = payload; } catch (e) {}
    notify();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", notify, { once: true });
    }
  }

  async function postInitData(initData) {
    diag.attempts += 1;
    var resp = await fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ initData: initData })
    });

    var data = {};
    try { data = await resp.json(); } catch (e) {}

    return { resp: resp, data: data };
  }

  async function signIn() {
    if (started) return;
    started = true;

    var app = webApp();
    diag.hasTelegramObject = Boolean(app);

    if (app) {
      try {
        app.ready();
        app.expand();
        if (app.disableVerticalSwipes) app.disableVerticalSwipes();
      } catch (e) {}
    }

    // 1. wait for the SDK, then fall back to the launch hash
    var initData = await waitForInitData(Date.now() + SDK_WAIT_MS);
    diag.source = initData ? "sdk" : "";

    if (!initData) {
      initData = initDataFromHash();
      if (initData) diag.source = "hash";
    }
    diag.initDataLength = initData ? initData.length : 0;

    if (!initData) {
      // Not a Mini App launch at all (opened in Telegram's in-app browser or a
      // normal tab). Nothing to sign in with — the normal login form is right.
      fail(
        app ? "no_init_data" : "not_in_telegram",
        "Open the store from the bot's menu button / Open Store button."
      );
      return;
    }

    // 2. verify it on the server (one network retry: cold serverless start)
    var result = null;
    try {
      result = await postInitData(initData);
      if (!result.resp.ok && result.resp.status >= 500) {
        await new Promise(function (r) { setTimeout(r, 1000); });
        result = await postInitData(initData);
      }
    } catch (e) {
      try {
        await new Promise(function (r) { setTimeout(r, 1000); });
        result = await postInitData(initData);
      } catch (e2) {
        fail("network", (e2 && e2.message) || String(e2));
        return;
      }
    }

    var resp = result.resp;
    var data = result.data || {};

    if (!resp.ok || !data.success || !data.token) {
      fail(data.reason || ("http_" + resp.status), data.message || "");
      return;
    }

    // 3. store the session exactly like a website login
    diag.finished = true;
    storeSession(data.token, data.user || {});
    try { sessionStorage.removeItem("tga_tg_reloaded"); } catch (e) {}

    // Hand the profile to the page straight away so the dashboard can paint
    // the avatar / name / username before /api/dashboard even answers.
    window.__tgaTelegramUser = data.user || null;
    try {
      window.dispatchEvent(new CustomEvent("tga:telegram-auth", { detail: data.user || null }));
    } catch (e) {}

    openDashboard(data.user || {});
  }

  /*
    Start as early as we can — but if the page script is still parsing, wait for
    DOMContentLoaded so index.html's `__tgaOpenDashboard` hook definitely exists
    (otherwise we would need the reload fallback on every launch).
  */
  function start() {
    signIn();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
