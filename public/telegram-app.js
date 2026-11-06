/* ==========================================================================
   TGA STORE — TELEGRAM MINI APP BOOTSTRAP
   ==========================================================================
   Loaded by index.html. When the page is opened *inside* Telegram (bot menu
   button, web_app inline button, or a Mini App link) this script:

     1. asks Telegram for the signed `initData` (window.Telegram.WebApp),
     2. posts it to /api/telegram → the server verifies the HMAC signature,
        finds/creates the user by numeric Telegram id and returns a session,
     3. stores that session exactly like a normal website login, so the ID,
        name, username, photo and balance are all filled in automatically,
     4. tells index.html to open the dashboard (`window.__tgaOpenDashboard`).

   Outside Telegram nothing happens — the normal login form stays as it is.
   This file never touches the DOM; it only talks to localStorage + the API.
   ========================================================================== */

(function () {
  "use strict";

  var TG = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  /* Not inside Telegram (or Telegram did not inject a WebApp object). */
  if (!TG || !TG.initData) return;

  var handled = false;

  function storeSession(token, user) {
    try {
      localStorage.setItem("tga_session", token);
      var uid = String(user.userId || user.telegramId || "");
      if (uid) localStorage.setItem("tga_user_id", uid);
      if (user.telegramId) localStorage.setItem("tga_telegram_id", String(user.telegramId));
      if (user.username) localStorage.setItem("tga_username", user.username);
      if (user.photoUrl) localStorage.setItem("tga_photo", user.photoUrl);
      localStorage.setItem("tga_login_source", "telegram");
    } catch (e) {}
  }

  function openDashboard(user) {
    // index.html exposes this hook so the dashboard can open without a reload.
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

    // Last resort: a reload lets the page's own startup read the saved session.
    // Guarded so a broken API can never cause a reload loop.
    try {
      if (!sessionStorage.getItem("tga_tg_reloaded")) {
        sessionStorage.setItem("tga_tg_reloaded", "1");
        window.location.replace(window.location.pathname);
      }
    } catch (e) {}
  }

  function fail(message) {
    // The API being unreachable (offline, cold deploy) or a rejected signature
    // must not strand the user on the "signing in…" state: index.html listens
    // for this event and reveals the normal login form instead.
    console.warn("[tga] Telegram auto-login skipped:", message);
    try {
      localStorage.removeItem("tga_login_source");
    } catch (e) {}

    var notify = function () {
      try {
        window.dispatchEvent(new CustomEvent("tga:telegram-auth-failed", { detail: String(message || "") }));
      } catch (e) {}
    };

    // This file runs while the page is still parsing, so the page's own
    // listeners may not exist yet — remember the failure and re-signal once
    // the DOM is ready.
    try { window.__tgaTelegramAuthFailed = String(message || "failed"); } catch (e) {}
    notify();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", notify, { once: true });
    }
  }

  async function signIn() {
    if (handled) return;
    handled = true;

    try {
      TG.ready();
      TG.expand();
      if (TG.enableClosingConfirmation) TG.enableClosingConfirmation();
    } catch (e) {}

    try {
      var resp = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ initData: TG.initData })
      });
      var data = await resp.json().catch(function () { return {}; });

      if (!resp.ok || !data.success || !data.token) {
        fail(data.message || "HTTP " + resp.status);
        return;
      }

      storeSession(data.token, data.user || {});
      try { sessionStorage.removeItem("tga_tg_reloaded"); } catch (e) {}
      openDashboard(data.user || {});
    } catch (e) {
      fail((e && e.message) || String(e));
    }
  }

  // Telegram for Web Apps loads telegram-web-app.js from a CDN; if the script
  // itself failed we bail out quietly (handled above by the TG check).
  signIn();
})();
