/* ==========================================================================
   TGA STORE — ICON HELPERS (no device emoji anywhere)
   ==========================================================================
   • Icon set: /icons.svg (one consistent 24×24 stroke set, inherits `color`)
   • Flags: generated at runtime as SVG from the ISO-3166 alpha-2 code, so the
     country grid/table never shows OS emoji (Apple/Samsung/Windows flags look
     different and some Android builds have none at all).
   • Every function is defensive: a missing/unknown icon renders nothing
     instead of throwing, so old dynamic HTML can never break the page.

     icon("cart")                  -> <svg class="icon"><use href="/icons.svg#i-cart">
     icon("cart", "icon lg")       -> custom class
     flagSvg("ID")                 -> <svg class="flag">…</svg>
     stripEmoji("Indonesia <flag>") -> "Indonesia"
   ========================================================================== */

(function () {
  "use strict";

  var SPRITE = "/icons.svg";

  /* ------------------------------------------------------------------ icons */

  function icon(name, className) {
    var id = String(name || "").trim().replace(/^i-/, "");
    if (!id) return "";
    var cls = "icon" + (className ? " " + className : "");
    // Unquoted attribute values on purpose: the output is valid HTML *and*
    // safe to embed inside single- or double-quoted JS strings (dynamic HTML).
    return (
      "<svg class=" + cls + " aria-hidden=true focusable=false>" +
      "<use href=" + SPRITE + "#i-" + id + "></use></svg>"
    );
  }

  /* ---------------------------------------------------------------- flags */

  // ISO alpha-2 → the handful of flags that are simpler/better as bespoke art.
  var SPECIAL = {
    EU: ["#003399"],
    UN: ["#4b9cd3"]
  };

  /**
   * Flag for a country.
   *
   * Products like Telegram show the real flag emoji, and users asked for that
   * again: Android / iOS / Windows / Samsung all ship the flag artwork, so the
   * card now renders the same 🇮🇩 the OS draws everywhere else (and it scales
   * with the font, so it never looks blurry).
   *
   * `asEmoji()` also gives a plain-text fallback for anywhere the flag cannot
   * be drawn (e.g. a monochrome terminal copy/paste).
   */
  function flagEmoji(code) {
    var iso = isoOf(code);
    if (!iso || !/^[A-Z]{2}$/.test(iso)) return "";
    // Regional Indicator Symbol: A → U+1F1E6
    var a = String.fromCodePoint(0x1f1e6 + (iso.charCodeAt(0) - 65));
    var b = String.fromCodePoint(0x1f1e6 + (iso.charCodeAt(1) - 65));
    return a + b;
  }

  function flagSvg(codeOrName, className) {
    // Kept for backwards compatibility: the store now shows the native flag
    // emoji again, so this returns an inline <span> (still emoji, still the
    // device artwork) instead of a drawn SVG rectangle.
    var iso = isoOf(codeOrName);
    if (!iso) return "";
    var emoji = flagEmoji(iso);
    if (!emoji) return "";
    var cls = "flag-emoji" + (className ? " " + className : "");
    return '<span class="' + cls + '" aria-hidden="true">' + emoji + "</span>";
  }

  /** ISO alpha-2 code from a code or a country name ("Indonesia 🇮🇩" → "ID"). */
  function isoOf(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();

    var name = stripEmoji(raw).trim().toLowerCase();
    var map = window.TGA_COUNTRY_ISO;
    if (map && map[name]) return map[name];

    // "Uzbekistan (UZ)" / "uz - Uzbekistan" style strings
    var m = raw.match(/\b([A-Z]{2})\b/);
    if (m) return m[1];
    return "";
  }

  /* ---------------------------------------------------------------- emoji */

  // Unicode emoji + regional indicators + variation selectors + zero-width joiner.
  var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu;

  function stripEmoji(value) {
    return String(value == null ? "" : value).replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
  }

  /* ------------------------------------------------------------ sprite host */

  /*
    The icon markup above points at /icons.svg#i-… . An external <use> works in
    Chrome/Safari but NOT where an SVG document is treated as an image without
    CORS, and it is also the first thing to break behind a strict CDN cache —
    either way people see empty boxes.

    So the sprite is fetched once, inlined into the page (hidden), and every
    later `#i-…` reference resolves locally in the same document. If the fetch
    fails, the markup keeps pointing at /icons.svg and still works in browsers
    that support it.
  */
  var SPRITE_TAG = '<svg xmlns="http://www.w3.org/2000/svg" class="tga-sprite-inline" aria-hidden="true" '
    + 'focusable="false" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none">';

  function spriteLoaded() {
    return Boolean(document.querySelector(".tga-sprite-inline symbol"));
  }

  var spritePromise = null;

  function ensureSprite() {
    if (spriteLoaded()) return Promise.resolve(true);
    if (spritePromise) return spritePromise;

    spritePromise = fetch(SPRITE, { cache: "force-cache" })
      .then(function (res) { return res.ok ? res.text() : ""; })
      .then(function (text) {
        var body = String(text || "");
        var start = body.indexOf("<symbol");
        var end = body.lastIndexOf("</symbol>");
        if (start === -1 || end === -1) return false;

        var host = document.createElement("div");
        host.className = "tga-sprite-host";
        host.setAttribute("aria-hidden", "true");
        host.innerHTML = SPRITE_TAG + body.slice(start, end + 9) + "</svg>";

        var mount = document.body || document.documentElement;
        if (!mount) return false;
        mount.insertBefore(host, mount.firstChild);
        return spriteLoaded();
      })
      .catch(function () { return false; });

    return spritePromise;
  }

  /*
    Any <use href="/icons.svg#i-x"> in the page is rewritten to href="#i-x"
    once the sprite is inline, so lookups never leave the document.
  */
  function localizeUses(root) {
    var scope = root || document;
    var uses = scope.querySelectorAll('use[href*="/icons.svg#"], use[*|href*="icons.svg#"]');
    for (var i = 0; i < uses.length; i++) {
      var el = uses[i];
      var href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
      var hash = href.indexOf("#");
      if (hash === -1) continue;
      var local = href.slice(hash);
      el.setAttribute("href", local);
      if (el.hasAttribute("xlink:href")) el.setAttribute("xlink:href", local);
    }
  }

  function refreshIcons(root) {
    if (!spriteLoaded()) return;
    localizeUses(root);
  }

  // Re-run after every dynamic render (orders, country grid, modals …).
  function watchIcons() {
    if (typeof window.MutationObserver !== "function" || !document.body) return;
    var scheduled = false;
    new window.MutationObserver(function () {
      if (scheduled || !spriteLoaded()) return;
      scheduled = true;
      setTimeout(function () { scheduled = false; localizeUses(document); }, 60);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
      return;
    }
    ensureSprite().then(function (ok) {
      if (ok) {
        localizeUses(document);
        watchIcons();
      }
    });
  }

  window.TGA_ICONS = {
    icon: icon,
    flagSvg: flagSvg,
    flagEmoji: flagEmoji,
    isoOf: isoOf,
    stripEmoji: stripEmoji,
    sprite: SPRITE,
    ensureSprite: ensureSprite,
    refreshIcons: refreshIcons
  };

  // Short global aliases used by the inline page scripts and dynamic HTML.
  window.icon = window.icon || icon;
  window.flagSvg = window.flagSvg || flagSvg;
  window.flagEmoji = window.flagEmoji || flagEmoji;
  window.refreshIcons = window.refreshIcons || refreshIcons;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
