// Store theme catalog — single source of truth.
//
// The admin panel shows these themes in Settings → "🎨 Store Theme", and the
// active theme id is persisted in the `settings` collection under
// `{ _id: "site_config", theme: "<id>" }`. The user-facing website
// (public/index.html) reads it from /api/status and applies the matching
// `body[data-theme="<id>"]` rules from public/theme-ui.css.
// The admin panel NEVER changes its own look — only the user side follows the
// selected theme.
//
// IMPORTANT: these are NOT colour-only skins. Every theme below is a full UI
// redesign of the store: different layout, card shape, typography, navigation
// style, button behaviour, hover/press animations, page transitions, loaders
// and background effects. Switching a theme changes the whole "model" of the
// website, not just its palette.
//
// "default" is the original TGA dark UI and is what ships out of the box.

const DEFAULT_THEME = "default";

const THEMES = [
  {
    id: "default",
    name: "Default",
    emoji: "🌑",
    desc: "Original TGA dark store",
    ui: "Rounded dark cards, floating pill nav, subtle fades",
    colors: { bg: "#000000", surface: "#0d0d0d", green: "#42e889", text: "#ffffff" }
  },
  {
    id: "glass",
    name: "Glass",
    emoji: "💎",
    desc: "Fully transparent frosted glass UI",
    ui: "See-through panels, heavy blur, floating glass nav, drifting light blobs",
    colors: { bg: "#0b1020", surface: "rgba(255,255,255,0.08)", green: "#7ce7ff", text: "#f2f7ff" }
  },
  {
    id: "neo",
    name: "Neumorphic",
    emoji: "🫧",
    desc: "Soft extruded light UI",
    ui: "Borderless puffy cards, dual soft shadows, press-in buttons, pill nav",
    colors: { bg: "#e6e9f0", surface: "#eef1f8", green: "#5b6cff", text: "#2a3045" }
  },
  {
    id: "brutal",
    name: "Neo Brutalist",
    emoji: "🧱",
    desc: "Loud blocks and hard shadows",
    ui: "Zero radius, 3px black borders, offset shadows, snap hover, uppercase",
    colors: { bg: "#ffe600", surface: "#ffffff", green: "#ff2e63", text: "#111111" }
  },
  {
    id: "terminal",
    name: "Terminal",
    emoji: "🖥️",
    desc: "Hacker console interface",
    ui: "Monospace, scanlines, bracket buttons, typing caret, boxed rows",
    colors: { bg: "#020a05", surface: "#04140a", green: "#37ff8b", text: "#c9ffd9" }
  },
  {
    id: "arcade",
    name: "Retro Arcade",
    emoji: "👾",
    desc: "80s pixel arcade cabinet",
    ui: "Pixel edges, neon grid horizon, blinking labels, chunky press buttons",
    colors: { bg: "#12002e", surface: "#1e0a45", green: "#ff2fb9", text: "#ffe9ff" }
  },
  {
    id: "aurora",
    name: "Aurora",
    emoji: "🌈",
    desc: "Animated aurora gradient",
    ui: "Moving mesh background, giant soft cards, glow buttons, slide transitions",
    colors: { bg: "#0a0f2c", surface: "rgba(22,28,64,0.72)", green: "#8affd1", text: "#eef2ff" }
  },
  {
    id: "paper",
    name: "Paper",
    emoji: "📒",
    desc: "Notebook and sticky notes",
    ui: "Ruled paper texture, dashed borders, tilted cards, ink underline buttons",
    colors: { bg: "#f7f1e1", surface: "#fffdf6", green: "#c1553a", text: "#2f2a22" }
  },
  {
    id: "editorial",
    name: "Editorial",
    emoji: "📰",
    desc: "Magazine typography layout",
    ui: "Serif display type, hairline rules, no shadows, wide whitespace, text nav",
    colors: { bg: "#faf9f7", surface: "#ffffff", green: "#b3121d", text: "#14110f" }
  },
  {
    id: "console",
    name: "Pro Console",
    emoji: "📊",
    desc: "Dense admin-style dashboard",
    ui: "Left side rail on desktop, compact rows, tiny radius, data-grid cards",
    colors: { bg: "#0f141b", surface: "#161d27", green: "#3ba3ff", text: "#dce6f2" }
  },
  {
    id: "hud",
    name: "Cyber HUD",
    emoji: "🛰️",
    desc: "Sci-fi heads-up display",
    ui: "Clipped corners, corner ticks, glitch hover, angular nav, scan sweep",
    colors: { bg: "#03080f", surface: "#07131f", green: "#00e5ff", text: "#d8f6ff" }
  },
  {
    id: "luxe",
    name: "Luxe",
    emoji: "🥂",
    desc: "Black tie gold boutique",
    ui: "Serif caps, hairline gold frames, slow elegant fades, underline nav",
    colors: { bg: "#080604", surface: "#12100b", green: "#d4af37", text: "#f6efdf" }
  },
  {
    id: "candy",
    name: "Candy Pop",
    emoji: "🍬",
    desc: "Bouncy pastel playground",
    ui: "Extra-round cards, bouncy springs, wiggle hover, sticker nav, confetti dots",
    colors: { bg: "#fff0f6", surface: "#ffffff", green: "#ff5fa2", text: "#42214a" }
  },
  {
    id: "swiss",
    name: "Swiss",
    emoji: "◼️",
    desc: "Strict minimal grid",
    ui: "No radius, no shadow, 1px rules, huge type scale, underline interactions",
    colors: { bg: "#ffffff", surface: "#ffffff", green: "#000000", text: "#000000" }
  },
  {
    id: "organic",
    name: "Organic",
    emoji: "🌿",
    desc: "Soft natural blob shapes",
    ui: "Asymmetric blob radii, leaf accents, gentle float animation, earthy calm",
    colors: { bg: "#f2f5ec", surface: "#ffffff", green: "#3f7d4e", text: "#22301f" }
  },
  {
    id: "vapor",
    name: "Vaporwave",
    emoji: "🌴",
    desc: "Chrome sunset dreamscape",
    ui: "Gradient sun backdrop, chrome text, italic type, glow slide buttons",
    colors: { bg: "#20003c", surface: "rgba(60,10,90,0.66)", green: "#ff71ce", text: "#f5e6ff" }
  },
  {
    id: "metro",
    name: "Metro Tiles",
    emoji: "🟦",
    desc: "Flat live-tile grid",
    ui: "Square tiles, zero radius, flat colour blocks, tilt-press, tile flip nav",
    colors: { bg: "#101418", surface: "#1b2732", green: "#00b7c3", text: "#f3f7fa" }
  },
  {
    id: "clay",
    name: "Claymorphism",
    emoji: "🧸",
    desc: "Chunky 3D clay shapes",
    ui: "Fat rounded clay cards, inner highlights, squish press, playful depth",
    colors: { bg: "#efe6ff", surface: "#ffffff", green: "#7a5cff", text: "#3a2a63" }
  },
  {
    id: "abyss",
    name: "Deep Abyss",
    emoji: "🌊",
    desc: "Underwater depth",
    ui: "Rising bubbles, wave dividers, caustic glow, slow drifting cards",
    colors: { bg: "#020c1b", surface: "#06182c", green: "#25d5ff", text: "#dff4ff" }
  },
  {
    id: "steel",
    name: "Industrial",
    emoji: "⚙️",
    desc: "Brushed metal machinery",
    ui: "Metal gradients, rivet corners, condensed caps, mechanical press buttons",
    colors: { bg: "#15171a", surface: "#22262b", green: "#ff8c1a", text: "#e8ebef" }
  },
  {
    id: "sakura",
    name: "Zen Sakura",
    emoji: "🌸",
    desc: "Calm Japanese garden",
    ui: "Falling petals, airy spacing, serif headings, ink-brush accents, soft fades",
    colors: { bg: "#fff6f7", surface: "#ffffff", green: "#e2748c", text: "#3d2b30" }
  },
  {
    id: "midnight",
    name: "Midnight Pro",
    emoji: "🌌",
    desc: "Modern deep-blue product UI",
    ui: "Gradient hero header, stacked cards, indigo glow, smooth rise transitions",
    colors: { bg: "#070b18", surface: "#101a33", green: "#6c8cff", text: "#e8eeff" }
  }
];

// Old colour-only themes → closest full-UI replacement, so stores that already
// picked one keep a sensible look after the upgrade instead of snapping back
// to default.
const LEGACY_ALIASES = {
  neon: "terminal",
  cyberpunk: "hud",
  matrix: "terminal",
  ocean: "abyss",
  sunset: "vapor",
  royal: "luxe",
  rose: "sakura",
  crimson: "brutal",
  gold: "luxe",
  forest: "organic",
  sky: "aurora",
  lavender: "clay",
  mono: "swiss",
  coffee: "paper",
  teal: "abyss",
  violet: "aurora",
  arctic: "glass",
  cherry: "candy",
  slate: "console"
};

function isValidTheme(id) {
  return THEMES.some((t) => t.id === id);
}

function normalizeTheme(id) {
  if (isValidTheme(id)) return id;
  const alias = id && LEGACY_ALIASES[String(id)];
  if (alias && isValidTheme(alias)) return alias;
  return DEFAULT_THEME;
}

async function getSiteTheme(db) {
  try {
    const doc = await db.collection("settings").findOne({ _id: "site_config" });
    return normalizeTheme(doc && doc.theme);
  } catch (e) {
    console.error("[themes] getSiteTheme error:", (e && e.message) || e);
    return DEFAULT_THEME;
  }
}

async function setSiteTheme(db, theme, updatedBy) {
  const id = normalizeTheme(theme);
  await db.collection("settings").updateOne(
    { _id: "site_config" },
    { $set: { theme: id, updated_by: String(updatedBy || "admin"), updated_at: new Date() } },
    { upsert: true }
  );
  return id;
}

module.exports = {
  DEFAULT_THEME,
  THEMES,
  LEGACY_ALIASES,
  isValidTheme,
  normalizeTheme,
  getSiteTheme,
  setSiteTheme
};
