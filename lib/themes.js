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
    id: "prism",
    name: "Holo Prism",
    emoji: "🔮",
    desc: "Holographic 3D iridescent glass",
    ui: "Rainbow sheen, floating 3D cards, prism glow, tilt hover",
    colors: { bg: "#07060f", surface: "rgba(28,20,48,0.78)", green: "#7ef0ff", text: "#f4f0ff" }
  },
  {
    id: "neon3d",
    name: "Neon Pulse",
    emoji: "💜",
    desc: "Glowing neon 3D nightclub",
    ui: "Magenta/cyan rim lights, extruded cards, pulsing glow buttons",
    colors: { bg: "#05010d", surface: "#12061f", green: "#ff3df0", text: "#fff0ff" }
  },
  {
    id: "obsidian",
    name: "Obsidian Glow",
    emoji: "🖤",
    desc: "Luxury black stone with ember glow",
    ui: "Beveled 3D slabs, amber rim light, slow luxury motion",
    colors: { bg: "#050505", surface: "#121212", green: "#ffb020", text: "#fff6e8" }
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
    id: "crystal",
    name: "Crystal 3D",
    emoji: "💠",
    desc: "Faceted ice crystal UI",
    ui: "Diamond facets, icy bloom, 3D lift, frost glow",
    colors: { bg: "#041018", surface: "rgba(18,40,58,0.8)", green: "#5ee7ff", text: "#e8fbff" }
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
    id: "ember",
    name: "Ember Forge",
    emoji: "🔥",
    desc: "Molten metal and fire glow",
    ui: "3D forged plates, lava highlights, heat shimmer buttons",
    colors: { bg: "#0c0603", surface: "#1a0d08", green: "#ff6a1a", text: "#ffe8d4" }
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
    id: "nova",
    name: "Nova Glow",
    emoji: "✨",
    desc: "Cosmic starfield with 3D orbs",
    ui: "Star dust, violet bloom, floating depth, glow trails",
    colors: { bg: "#050714", surface: "#10152c", green: "#9d7bff", text: "#f0ecff" }
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
    id: "chrome3d",
    name: "Liquid Chrome",
    emoji: "🪙",
    desc: "Polished 3D metal chrome",
    ui: "Mirror gradients, extruded metal, specular shine, heavy depth",
    colors: { bg: "#0b0d11", surface: "#1a1e26", green: "#c8d4e8", text: "#f4f7fb" }
  },
  {
    id: "plasma",
    name: "Plasma Core",
    emoji: "⚡",
    desc: "Electric plasma energy field",
    ui: "Electric arcs, cyan-violet glow, 3D energy cards, spark buttons",
    colors: { bg: "#030712", surface: "#0b1428", green: "#39f6c8", text: "#e8fff8" }
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
  neon: "neon3d",
  cyberpunk: "hud",
  matrix: "plasma",
  ocean: "abyss",
  sunset: "ember",
  royal: "obsidian",
  rose: "sakura",
  crimson: "brutal",
  gold: "chrome3d",
  forest: "organic",
  sky: "crystal",
  lavender: "clay",
  mono: "obsidian",
  coffee: "paper",
  teal: "abyss",
  violet: "nova",
  arctic: "glass",
  cherry: "candy",
  slate: "console",
  terminal: "plasma",
  arcade: "neon3d",
  aurora: "nova",
  editorial: "midnight",
  luxe: "obsidian",
  swiss: "obsidian",
  vapor: "prism",
  metro: "chrome3d"
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
