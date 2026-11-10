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

   IMPORTANT (auto-logout fix):
   telegram-web-app.js defines `window.Telegram.WebApp` in EVERY browser. This
   script therefore never assumes "SDK present = Mini App". It requires real
   initData, a real platform, or the launch hash. Outside Telegram it does
   nothing at all — the saved website session stays exactly as it was.

   It also exposes `window.__tgaTelegramRetry()` so an expired session can be
   renewed silently from the Mini App instead of throwing the user back to the
   login form.

   Why it can look like "auto-login does not work":
     • The page was opened in Telegram's in-app *browser* (a normal link in a
       chat), not as a Mini App → Telegram passes no initData at all.
     • telegram-web-app.js was blocked/slow (adblock, flaky network) → there is
       still initData in the launch URL hash (`#tgWebAppData=…`) which we can
       read ourselves.
     • The bot token on the server belongs to a different bot than the one the
       Mini App is attached to → /api/telegram answers 401 bad_hash.

   Every failure path reports a specific reason (console + the
   `tga:telegram-auth-failed` event + window.__tgaTelegramDiag) instead of
   silently showing the password form.
   ========================================================================== */

(function () {
  "use strict";

  var SDK_WAIT_MS = 3000;

  var diag = {
    hasTelegramObject: false,
    initDataLength: 0,
    source: "",
    attempts: 0,
    lastError: "",
    finished: false,
    retries: 0
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

    var idx = query.indexOf("tgWebAppData=");
    if (idx === -1) return "";
    var value = query.slice(idx + "tgWebAppData=".length).split("&tgWebApp")[0];
    try {
      return decodeURIComponent(value);
    } catch (e) {
      return value;
    }
  }

  /*
    Is this really a Telegram Mini App launch?
    Outside Telegram the SDK still exists, but `platform` is "unknown" and
    initData is empty — in that case we must NOT touch the website session.
  */
  function isTelegramContext() {
    try {
      var app = webApp();
      if (app) {
        if (app.initData) return true;
        if (app.initDataUnsafe && app.initDataUnsafe.user) return true;
        var platform = String(app.platform || "").toLowerCase();
        if (platform && platform !== "unknown") return true;
      }
      if (window.location.hash && window.location.hash.indexOf("tgWebAppData") !== -1) return true;
      if (window.location.search && window.location.search.indexOf("tgWebAppData") !== -1) return true;
    } catch (e) {}
    return false;
  }

  function hasSession() {
    try {
      return Boolean(localStorage.getItem("tga_session"));
    } catch (e) {
      return false;
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
    console.error("[tga] Telegram auto-login failed:", reason, detail || "");

    /*
      A saved website session is NOT an error. Never paint "Telegram sign-in
      failed" over a logged-in dashboard — that is what made the store look
      like it logged people out on every refresh.
    */
    if (hasSession()) {
      diag.lastError = String(reason || "failed") + " (kept existing session)";
      return;
    }

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

  async function runSignIn(silent) {
    diag.hasTelegramObject = Boolean(webApp());

    if (!isTelegramContext()) {
      /*
        Not a Mini App launch at all — a normal browser tab, or Telegram's
        in-app browser opened from a shared link. Nothing to do: the saved
        session (or the normal login form) is already on screen.

        We only explain the situation when the page really is running inside a
        Telegram client (its user agent says so). A visitor on Chrome/Safari
        must never see a "Telegram sign-in failed" message.
      */
      var inTelegramApp = /Telegram/i.test(String((navigator && navigator.userAgent) || ""));
      diag.lastError = "not_in_telegram";
      if (!silent && inTelegramApp && !hasSession()) {
        fail("not_in_telegram", "Open the store from the bot's menu button / Open Store button.");
      }
      return false;
    }

    var app = webApp();
    if (app) {
      try {
        app.ready();
        app.expand();
        if (app.disableVerticalSwipes) app.disableVerticalSwipes();
      } catch (e) {}
    }

    // 1. Prefer the SDK's signed initData (poll briefly — Telegram Web/
    // Desktop sometimes fills it late). If the SDK is missing or comes up
    // empty, fall back to the launch hash (#tgWebAppData=…) immediately.
    var initData = "";
    if (app) {
      initData = await waitForInitData(Date.now() + SDK_WAIT_MS);
      diag.source = initData ? "sdk" : "";
    }
    if (!initData) {
      initData = initDataFromHash();
      if (initData) diag.source = "hash";
    }
    diag.initDataLength = initData ? initData.length : 0;

    if (!initData) {
      if (!silent) {
        fail(
          app ? "no_init_data" : "not_in_telegram",
          "Open the store from the bot's menu button / Open Store button."
        );
      }
      return false;
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
        if (!silent) fail("network", (e2 && e2.message) || String(e2));
        return false;
      }
    }

    var resp = result.resp;
    var data = result.data || {};

    if (!resp.ok || !data.success || !data.token) {
      if (!silent) fail(data.reason || ("http_" + resp.status), data.message || "");
      return false;
    }

    // 3. store the session exactly like a website login
    diag.finished = true;
    storeSession(data.token, data.user || {});
    try { sessionStorage.removeItem("tga_tg_reloaded"); } catch (e) {}
    try { delete window.__tgaTelegramAuthFailed; } catch (e) {}

    // Hand the profile to the page straight away so the dashboard can paint
    // the avatar / name / username before /api/dashboard even answers.
    window.__tgaTelegramUser = data.user || null;
    try {
      window.dispatchEvent(new CustomEvent("tga:telegram-auth", { detail: data.user || null }));
    } catch (e) {}

    openDashboard(data.user || {});
    return true;
  }

  var inFlight = null;

  /*
    Public: renew the session silently. Used by index.html when an API call
    comes back 401 — inside the Mini App we can usually get a brand new session
    without ever showing the login form.
  */
  window.__tgaTelegramRetry = function () {
    if (inFlight) return inFlight;
    diag.retries += 1;
    inFlight = runSignIn(true)
      .catch(function () { return false; })
      .then(function (ok) {
        inFlight = null;
        return ok;
      });
    return inFlight;
  };

  function start() {
    if (inFlight) return inFlight;
    inFlight = runSignIn(false)
      .catch(function () { return false; })
      .then(function (ok) {
        inFlight = null;
        return ok;
      });
    return inFlight;
  }

  /*
    Start after the document is parsed so index.html's `__tgaOpenDashboard`
    hook definitely exists (it is registered on DOMContentLoaded). With
    `defer` on this file, readyState is "interactive" here — DOMContentLoaded
    has NOT fired yet, so waiting for it is still correct.
  */
  if (document.readyState === "complete") {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
})();
