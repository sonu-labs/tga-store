// Store theme catalog — single source of truth.
//
// The admin panel shows these themes in Settings → "🎨 Store Theme", and the
// active theme id is persisted in the `settings` collection under
// `{ _id: "site_config", theme: "<id>" }`. The user-facing website
// (public/index.html) reads it from /api/status and applies the matching
// `body[data-theme="<id>"]` CSS block. The admin panel NEVER changes its own
// look — only the user side follows the selected theme.
//
// "default" is the current TGA dark theme and is what ships out of the box.
// Everything else is an additional, fully distinct theme.

const DEFAULT_THEME = "default";

const THEMES = [
  {
    id: "default",
    name: "Default",
    emoji: "🌑",
    desc: "Current TGA dark theme",
    colors: { bg: "#000000", surface: "#0d0d0d", green: "#42e889", text: "#ffffff" }
  },
  {
    id: "neon",
    name: "Neon",
    emoji: "💚",
    desc: "Bright neon green glow on black",
    colors: { bg: "#020403", surface: "#0a130d", green: "#39ff88", text: "#eafff1" }
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    emoji: "🌆",
    desc: "Magenta & cyan on deep indigo",
    colors: { bg: "#0a0118", surface: "#120426", green: "#ff2bd6", text: "#f4eaff" }
  },
  {
    id: "matrix",
    name: "Matrix",
    emoji: "🟩",
    desc: "Classic hacker green on black",
    colors: { bg: "#000000", surface: "#041205", green: "#00ff6a", text: "#d9ffd9" }
  },
  {
    id: "midnight",
    name: "Midnight",
    emoji: "🌌",
    desc: "Deep navy with electric blue",
    colors: { bg: "#05070f", surface: "#0c1220", green: "#4d8dff", text: "#eaf0ff" }
  },
  {
    id: "ocean",
    name: "Ocean",
    emoji: "🌊",
    desc: "Calm blues and teals",
    colors: { bg: "#04121c", surface: "#081f2c", green: "#26d0ce", text: "#e3f6fb" }
  },
  {
    id: "sunset",
    name: "Sunset",
    emoji: "🌇",
    desc: "Warm orange and pink dusk",
    colors: { bg: "#170a12", surface: "#24101c", green: "#ff8a5c", text: "#ffefe9" }
  },
  {
    id: "royal",
    name: "Royal",
    emoji: "👑",
    desc: "Rich purple and violet",
    colors: { bg: "#0d0716", surface: "#1a0f2b", green: "#a86bff", text: "#f1e9ff" }
  },
  {
    id: "rose",
    name: "Rose",
    emoji: "🌹",
    desc: "Rose gold and blush",
    colors: { bg: "#1c0a12", surface: "#2a111c", green: "#ff9eb5", text: "#ffeef3" }
  },
  {
    id: "crimson",
    name: "Crimson",
    emoji: "🔴",
    desc: "Bold red and black",
    colors: { bg: "#0d0204", surface: "#1c070b", green: "#ff4d5e", text: "#ffecee" }
  },
  {
    id: "gold",
    name: "Gold",
    emoji: "✨",
    desc: "Luxury gold on black",
    colors: { bg: "#0d0a02", surface: "#1c1606", green: "#ffc857", text: "#fff6e0" }
  },
  {
    id: "forest",
    name: "Forest",
    emoji: "🌲",
    desc: "Deep greens, calm and natural",
    colors: { bg: "#04120a", surface: "#0a1f12", green: "#3ddc84", text: "#e6f7ec" }
  },
  {
    id: "sky",
    name: "Sky",
    emoji: "☁️",
    desc: "Light airy blue and white",
    colors: { bg: "#eef4fb", surface: "#ffffff", green: "#1b98f5", text: "#12263a" }
  },
  {
    id: "lavender",
    name: "Lavender",
    emoji: "💜",
    desc: "Soft purple, gentle and light",
    colors: { bg: "#f3effb", surface: "#ffffff", green: "#7c5cff", text: "#241d3a" }
  },
  {
    id: "mono",
    name: "Mono",
    emoji: "⬜",
    desc: "Minimal light gray and white",
    colors: { bg: "#f4f4f5", surface: "#ffffff", green: "#111111", text: "#111111" }
  },
  {
    id: "coffee",
    name: "Coffee",
    emoji: "☕",
    desc: "Warm browns and cream",
    colors: { bg: "#120c08", surface: "#1f1610", green: "#d7a86e", text: "#f6ecdf" }
  },
  {
    id: "teal",
    name: "Teal",
    emoji: "🩵",
    desc: "Teal and cyan on dark",
    colors: { bg: "#03110f", surface: "#07201d", green: "#2dd4bf", text: "#e0fbf6" }
  },
  {
    id: "violet",
    name: "Violet",
    emoji: "🟣",
    desc: "Electric violet on near-black",
    colors: { bg: "#0a0414", surface: "#160a26", green: "#8b5cf6", text: "#efe8ff" }
  },
  {
    id: "arctic",
    name: "Arctic",
    emoji: "❄️",
    desc: "Icy white and pale blue",
    colors: { bg: "#eaf2f7", surface: "#ffffff", green: "#0288d1", text: "#0b2735" }
  },
  {
    id: "cherry",
    name: "Cherry",
    emoji: "🍒",
    desc: "Playful pink and berry red",
    colors: { bg: "#1a0610", surface: "#2a0c1a", green: "#ff5c8a", text: "#ffeaf2" }
  },
  {
    id: "slate",
    name: "Slate",
    emoji: "🗻",
    desc: "Neutral slate, clean and modern",
    colors: { bg: "#0b0e12", surface: "#14181f", green: "#8ea5c0", text: "#e8edf4" }
  }
];

function isValidTheme(id) {
  return THEMES.some((t) => t.id === id);
}

function normalizeTheme(id) {
  return isValidTheme(id) ? id : DEFAULT_THEME;
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
  isValidTheme,
  normalizeTheme,
  getSiteTheme,
  setSiteTheme
};
