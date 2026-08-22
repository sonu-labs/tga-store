/* ==========================================================================
   TGA STORE — APP EXTRAS
   ==========================================================================
   • Static system emoji (no Telegram premium IDs)
   • Header 3-dot menu
   • TGA Store API documentation modal + API key management + test area
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
  window.TGA_EMOJI = { mount: function () {}, enhance: function () {} };

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
  function currentUserId() {
    return (
      localStorage.getItem("tga_user_id") ||
      localStorage.getItem("tga_telegram_id") ||
      ""
    );
  }

  window.copyText = function (text) {
    if (typeof copyToClipboard === "function") copyToClipboard(String(text || ""));
    else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text || ""));
    }
  };

  function apiBaseUrl() {
    return location.origin + "/api/v1";
  }

  function apiKeyForDocs() {
    const input = document.getElementById("docsTestApiKey");
    return input && input.value ? input.value : "YOUR_API_KEY";
  }


  /* ----------------------------------------------------------------
     4. API DOCS MODAL
     ---------------------------------------------------------------- */
  window.openApiDocs = function () {
    const base = apiBaseUrl();
    const set = function (id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set("docsBaseUrl", base);

    const uid = currentUserId();
    const key = apiKeyForDocs();

    set("docsUrlCountryInfo",
      base + "?action=country_info&apiKey=" + encodeURIComponent(key) + "&country_code=uz");
    set("docsUrlCountries",
      base + "?action=available_countries&apiKey=" + encodeURIComponent(key));
    set("docsUrlBalance",
      base + "?action=get_balance&apiKey=" + encodeURIComponent(key));
    set("docsUrlNumber",
      base + "?action=getNumber&apiKey=" + encodeURIComponent(key) + "&country_code=uz");
    set("docsUrlCode",
      base + "?action=getCode&apiKey=" + encodeURIComponent(key) + "&number=+99800000000");

    const modal = document.getElementById("apiDocsModal");
    if (modal) {
      modal.classList.add("show");
      modal.querySelector(".docs-scroll").scrollTop = 0;
    }
    docsTestUrlPreview();
    loadApiKeys();
    loadApiLogs();
  };

  window.handleLoginFromDocs = function () {
    closeModal("apiDocsModal");
    const loginScreen = document.getElementById("loginScreen");
    if (loginScreen && loginScreen.style.display !== "none") {
      const input = document.getElementById("telegramIdInput") || document.getElementById("loginEmailInput");
      if (input) { input.focus(); input.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }
  };

  /* API key management */
  window.loadApiKeys = async function () {
    const uid = currentUserId();
    const hint = document.getElementById("docsLoginHint");
    const genBtn = document.getElementById("docsGenKeyBtn");
    const list = document.getElementById("docsKeyList");
    if (!hint || !list) return;

    if (!uid) {
      hint.classList.remove("hidden");
      if (genBtn) genBtn.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    hint.classList.add("hidden");
    if (genBtn) genBtn.classList.remove("hidden");

    try {
      const resp = await fetch("/api/apikey?action=list&userId=" + encodeURIComponent(uid));
      const data = await resp.json();
      const keys = (data && data.keys) || [];
      if (!keys.length) {
        list.innerHTML =
          '<div class="docs-card-sub" style="margin:6px 0 0">No API keys yet. Tap ' +
          '<b>Generate API Key</b> above to create one.</div>';
        return;
      }
      list.innerHTML = keys.map(function (k) {
        const meta = (k.created_at || "").toString().slice(0, 10);
        return (
          '<div class="docs-key-item">' +
          "<span>" + escapeHtml(String(k._id || "")) + "</span>" +
          '<span class="key-meta">created ' + escapeHtml(meta || "—") + "</span>" +
          '<button class="docs-copy" type="button" onclick="copyText(\'' + escapeHtml(String(k._id || "")) + '\')">Copy</button>' +
          '<button class="docs-copy" type="button" style="color:var(--red)" onclick="revokeApiKey(\'' + escapeHtml(String(k._id || "")) + '\')">Revoke</button>' +
          "</div>"
        );
      }).join("");
    } catch (e) {
      list.innerHTML = '<div class="docs-card-sub">Could not load keys.</div>';
    }
  };

  window.loadApiLogs = async function () {
    const uid = currentUserId();
    const list = document.getElementById("docsApiLogList");
    if (!list || !uid) { if (list) list.innerHTML = ""; return; }
    try {
      const resp = await fetch("/api/apikey?action=logs&userId=" + encodeURIComponent(uid));
      const data = await resp.json();
      const logs = data.logs || [];
      if (!logs.length) { list.innerHTML = '<div class="docs-card-sub">No API requests yet.</div>'; return; }
      list.innerHTML = logs.map(function (log) {
        const time = String(log.created_at || "").slice(0, 19).replace("T", " ");
        const query = Object.keys(log.query || {}).map(function(k){ return k + "=" + log.query[k]; }).join("&");
        return '<div class="docs-key-item"><span><b>' + escapeHtml(log.method || "GET") + '</b> ' + escapeHtml(log.action || "") + '<small class="key-meta">' + escapeHtml(query) + '</small></span><span class="key-meta">' + escapeHtml(time) + ' · ' + escapeHtml(String(log.status_code || "")) + '</span></div>';
      }).join("");
    } catch (e) { list.innerHTML = '<div class="docs-card-sub">Could not load API logs.</div>'; }
  };

  window.generateApiKey = async function () {
    const uid = currentUserId();
    if (!uid) { showMessage("Login required", "Please login first."); return; }
    const btn = document.getElementById("docsGenKeyBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }
    try {
      const resp = await fetch("/api/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", userId: uid })
      });
      const data = await resp.json();
      if (data.success) {
        showMessage("API Key Generated", "Your new API key is ready. Copy it now — it is shown in the list below.");
      } else {
        showMessage("Error", data.message || "Could not generate key.");
      }
    } catch (e) {
      showMessage("Error", "Could not reach the server.");
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="tga-emoji" data-emoji="🔑">🔑</span> Generate API Key'; }
    await loadApiKeys();
    await loadApiLogs();
    docsTestUrlPreview();
  };

  window.revokeApiKey = async function (key) {
    const uid = currentUserId();
    if (!uid || !key) return;
    if (!window.confirm("Revoke this API key? Requests using it will stop working.")) return;
    try {
      const resp = await fetch("/api/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", userId: uid, key: key })
      });
      const data = await resp.json();
      showMessage(data.success ? "Key Revoked" : "Error", data.message || "");
    } catch (e) {
      showMessage("Error", "Could not reach the server.");
    }
    await loadApiKeys();
    docsTestUrlPreview();
  };

  /* Test area */
  window.docsTestUrlPreview = function () {
    const action = (document.getElementById("docsTestAction") || {}).value || "";
    const apiKey = (document.getElementById("docsTestApiKey") || {}).value || apiKeyForDocs();
    const country = (document.getElementById("docsTestCountry") || {}).value || "";
    const number = (document.getElementById("docsTestNumber") || {}).value || "";

    const parts = ["action=" + encodeURIComponent(action), "apiKey=" + encodeURIComponent(apiKey)];
    if (action === "country_info" || action === "getNumber") {
      if (country) parts.push("country_code=" + encodeURIComponent(country));
    }
    if (action === "getCode" && number) parts.push("number=" + encodeURIComponent(number));

    const url = apiBaseUrl() + "?" + parts.join("&");
    const el = document.getElementById("docsTestUrlPreview");
    if (el) el.textContent = url;
    return url;
  };

  window.docsTestSend = async function () {
    const url = docsTestUrlPreview();
    const btn = document.getElementById("docsTestSendBtn");
    const box = document.getElementById("docsTestResponse");
    const pre = document.getElementById("docsTestResponsePre");
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const resp = await fetch(url);
      let text = "";
      try { text = JSON.stringify(await resp.json(), null, 2); }
      catch (e) { text = await resp.text(); }
      if (!resp.ok && !/^[\s{[]/.test(text)) {
        text = JSON.stringify({ status: "error", message: text }, null, 2);
      }
      if (pre) pre.textContent = text;
      if (box) box.classList.remove("hidden");
    } catch (e) {
      if (pre) pre.textContent = JSON.stringify({ status: "error", message: "Network error: " + (e.message || e) }, null, 2);
      if (box) box.classList.remove("hidden");
    }
    await loadApiLogs();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="tga-emoji" data-emoji="⚡">⚡</span> Send Request';
      TGA_EMOJI.enhance(btn);
    }
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
