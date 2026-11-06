/* ==========================================================================
   TGA STORE — APP EXTRAS
   ==========================================================================
   • Static system emoji (no Telegram premium IDs)
   • Header 3-dot menu
   • TGA Store API documentation — standalone page at /docs
   • Pricing modal
   Loaded after the main inline app script (uses copyToClipboard, handleLogin,
   etc. defined there).
   ========================================================================== */

(function () {
  "use strict";

  /* ----------------------------------------------------------------
     1. STATIC EMOJI
     ---------------------------------------------------------------- */
  // Telegram premium/custom emoji IDs are intentionally not used. Keep the
  // public hook as a no-op for older dynamic UI calls.
  function enhanceEmojis(root) {
    // No premium/custom emoji any more: static system emoji render fine
    // everywhere, so there is nothing to wrap. Kept as a function (instead of
    // deleting the calls) because the MutationObserver below and older dynamic
    // UI code call it on every render — it used to throw
    // "ReferenceError: enhanceEmojis is not defined" on the first DOM update.
    return root || null;
  }

  window.TGA_EMOJI = { mount: function () {}, enhance: enhanceEmojis };

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
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">No countries available right now.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(function (c) {
        const name = escapeHtml(String(c.name || c.code));
        const price = Number(c.price || 0);
        return (
          "<tr>" +
          '<td><span class="pricing-flag">' + flagEmojiOf(String(c.name || ""), String(c.code || "")) + "</span>" + name + "</td>" +
          '<td class="pricing-price">$' + price.toFixed(2) + "</td>" +
          '<td class="pricing-stock">' + Number(c.qty || 0) + " available</td>" +
          "</tr>"
        );
      }).join("");
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Could not load pricing. Try again.</td></tr>';
    }
  };

  function flagEmojiOf(name, code) {
    const m = String(name || "").match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if (m) return m[0];
    const c = String(code || "").toUpperCase();
    if (/^[A-Z]{2}$/.test(c)) {
      return String.fromCodePoint(
        ...[...c].map(function (ch) { return 0x1f1e6 + ch.charCodeAt(0) - 65; })
      );
    }
    return "";
  }

  /* ----------------------------------------------------------------
     6. AUTO-ENHANCE DYNAMIC CONTENT
     A debounced MutationObserver keeps every freshly rendered section
     (orders, account info, recharge invoices, toasts…) animated — the
     same engine runs over text nodes and wraps emoji in .tga-emoji spans.
     ---------------------------------------------------------------- */
  const origShowMessage = window.showMessage;
  if (typeof origShowMessage === "function") {
    window.showMessage = function (title, text) {
      origShowMessage(title, text);
      setTimeout(function () {
        const t = document.getElementById("messageTitle");
        const x = document.getElementById("messageText");
        if (window.TGA_EMOJI) {
          if (t) window.TGA_EMOJI.enhance(t);
          if (x) window.TGA_EMOJI.enhance(x);
        }
      }, 30);
    };
  }

  if (typeof window.MutationObserver === "function") {
    const observer = new MutationObserver(function (mutations) {
      let any = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes && m.addedNodes.length) {
          any = true;
          break;
        }
      }
      if (!any) return;
      clearTimeout(window.__tgaEmojiT);
      window.__tgaEmojiT = setTimeout(function () {
        enhanceEmojis(document.body);
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.enhanceDynamicEmojis = function (selector) {
    const root = selector ? document.querySelector(selector) : document.body;
    if (root) enhanceEmojis(root);
  };
})();
