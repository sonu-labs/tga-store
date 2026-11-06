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

  function flagSvg(codeOrName, className) {
    var code = isoOf(codeOrName);
    if (!code) return "";
    var cls = "flag" + (className ? " " + className : "");

    if (SPECIAL[code]) {
      // Simple solid-field flags are nicer than a generic rectangle.
      return (
        "<svg class=" + cls + " viewBox='0 0 60 40' aria-hidden=true focusable=false>" +
        "<rect width='60' height='40' rx='6' fill='" + SPECIAL[code][0] + "'/>" +
        "<circle cx='30' cy='20' r='9' fill='none' stroke='#ffd617' stroke-width='3'/>" +
        "</svg>"
      );
    }

    // Two bands derived from the country code — deterministic, instant, and
    // no network request. A country always gets the same colours, so cards stay
    // recognisable between visits.
    var pal = paletteFor(code);
    return (
      "<svg class=" + cls + " viewBox='0 0 60 40' aria-hidden=true focusable=false>" +
      "<rect width='60' height='40' rx='6' fill='" + pal[0] + "'/>" +
      "<path d='M0 26h60v8a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6z' fill='" + pal[1] + "'/>" +
      "<text x='30' y='19' text-anchor='middle' font-family='system-ui,-apple-system,Segoe UI,Roboto,sans-serif' " +
      "font-size='15' font-weight='700' fill='rgba(255,255,255,.95)'>" + code + "</text>" +
      "</svg>"
    );
  }

  var PALETTES = [
    ["#1e3a8a", "#3b82f6"],
    ["#065f46", "#10b981"],
    ["#7c2d12", "#f97316"],
    ["#4c1d95", "#8b5cf6"],
    ["#0c4a6e", "#0ea5e9"],
    ["#7f1d1d", "#ef4444"],
    ["#365314", "#84cc16"],
    ["#134e4a", "#14b8a6"],
    ["#581c87", "#a855f7"],
    ["#78350f", "#f59e0b"],
    ["#1f2937", "#6b7280"],
    ["#831843", "#ec4899"]
  ];

  function paletteFor(code) {
    var sum = 0;
    for (var i = 0; i < code.length; i++) sum += code.charCodeAt(i) * (i + 3);
    return PALETTES[sum % PALETTES.length];
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

  window.TGA_ICONS = {
    icon: icon,
    flagSvg: flagSvg,
    isoOf: isoOf,
    stripEmoji: stripEmoji,
    sprite: SPRITE
  };

  // Short global aliases used by the inline page scripts and dynamic HTML.
  window.icon = window.icon || icon;
  window.flagSvg = window.flagSvg || flagSvg;
  window.stripEmoji = window.stripEmoji || stripEmoji;
})();
