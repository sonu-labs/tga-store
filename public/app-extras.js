/* ==========================================================================
   TGA STORE — APP EXTRAS
   ==========================================================================
   • Icon helpers (SVG sprite, no device emoji)
   • Header 3-dot menu
   • TGA Store API documentation — standalone page at /docs
   • Pricing modal
   Loaded after the main inline app script (uses copyToClipboard, handleLogin,
   etc. defined there).
   ========================================================================== */

(function () {
  "use strict";

  /* ----------------------------------------------------------------
     1. ICON HELPERS
     Everything drawn in this file comes from /icons.svg (loaded by
     /icons.js) so the UI never falls back to OS emoji, which look
     different on every phone and are missing on some Android builds.
     ---------------------------------------------------------------- */
  function iconHtml(name, cls) {
    if (window.icon) return window.icon(name, cls || "sm");
    // /icons.js missing (offline cache of an old page): render nothing rather
    // than leaking an emoji or a broken glyph.
    return "";
  }

  // Country flags are inline SVG generated from the ISO code (see /icons.js).
  function flagHtmlFor(name, code) {
    if (window.flagSvg) return window.flagSvg(code || name, "xs");
    return "";
  }

  // Kept for backwards compatibility: older dynamic UI code calls this after
  // every render. There is no emoji pass any more, so it is a cheap no-op.
  window.TGA_EMOJI = { mount: function () {}, enhance: function () {} };
  window.enhanceDynamicEmojis = function () {};

  /* ----------------------------------------------------------------
     2. HEADER 3-DOT MENU
     ---------------------------------------------------------------- */
  window.toggleHeaderMenu = function (event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById("headerMenu");
    if (!menu) return;
    const willShow = menu.classList.contains("hidden");
    menu.classList.toggle("hidden");
    if (willShow) {
      setTimeout(function () {
        document.addEventListener("click", closeHeaderMenuOnce, { once: true });
      }, 0);
    }
  };

  function closeHeaderMenuOnce() {
    const menu = document.getElementById("headerMenu");
    if (menu) menu.classList.add("hidden");
  }

  window.headerMenuAction = function (type) {
    const menu = document.getElementById("headerMenu");
    if (menu) menu.classList.add("hidden");
    if (type === "pricing") openPricing();
    else if (type === "api") openApiDocs();
    else if (type === "terms") openTerms();
  };

  /* ----------------------------------------------------------------
     3. SHARED HELPERS
     ---------------------------------------------------------------- */
  window.copyText = function (text) {
    if (typeof copyToClipboard === "function") copyToClipboard(String(text || ""));
    else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text || ""));
    }
  };

  /* ----------------------------------------------------------------
     4. API DOCS (standalone page)
     The API docs, key management and test area now live on their own
     page at /docs — every "API Docs" entry point just navigates there.
     ---------------------------------------------------------------- */
  window.openApiDocs = function () {
    window.location.assign("/docs");
  };

  /* ----------------------------------------------------------------
     5. PRICING MODAL
     ---------------------------------------------------------------- */
  window.openPricing = async function () {
    const modal = document.getElementById("pricingModal");
    if (modal) modal.classList.add("show");
    const tbody = document.getElementById("pricingTableBody");
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align:center;color:var(--muted)">' +
      '<div class="loading"><div class="spinner"></div> Loading pricing…</div></td></tr>';
    try {
      const resp = await fetch("/api/countries");
      const data = await resp.json();
      const dict = (data && data.countries) || {};
      const rows = Object.values(dict)
        .filter(function (c) { return c && c.code; })
        .sort(function (a, b) { return Number(a.price || 0) - Number(b.price || 0); });

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">' + iconHtml("info") + ' No countries available right now.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(function (c) {
        const name = String(c.name || c.code || "");
        const cleanName = window.stripEmoji ? window.stripEmoji(name) : name;
        const price = Number(c.price || 0);
        return (
          "<tr>" +
          '<td><span class="pricing-flag">' + flagHtmlFor(name, String(c.code || "")) + "</span>" + escapeHtml(cleanName) + "</td>" +
          '<td class="pricing-price">$' + price.toFixed(2) + "</td>" +
          '<td class="pricing-stock">' + Number(c.qty || 0) + " available</td>" +
          "</tr>"
        );
      }).join("");
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">' + iconHtml("alert") + ' Could not load pricing. Try again.</td></tr>';
    }
  };

  /* ----------------------------------------------------------------
     6. DYNAMIC CONTENT
     Nothing to re-decorate any more: rendered HTML already contains the
     sprite icons, so there is no post-render emoji pass and no observer
     re-scanning the DOM on every update.
     ---------------------------------------------------------------- */
})();
