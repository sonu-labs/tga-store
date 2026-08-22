#!/usr/bin/env node
/* ==========================================================================
   GENERATE PLACEHOLDER EMOJI LOTTIE FILES
   ==========================================================================
   Creates public/emoji/<key>.json for every character in TGA_EMOJI_ANIMATED.

   Key resolution
     - Character has a Telegram custom id  -> emoji/<custom_emoji_id>.json
     - Otherwise                           -> emoji/<codepoints>.json
       (e.g. 🤖 = 1f916, 👨🎨 = 1f468-200d-1f3a8)

   The generated animations are simple Lottie *text* layers: the emoji glyph
   is rendered by the browser's emoji font and gently animated (float, bounce,
   pulse, spin, wiggle). They are placeholders — drop the REAL Telegram
   premium lottie files (downloaded from an emoji downloader bot such as
   @EmojiSaverBot) into public/emoji/<custom_emoji_id>.json and the site uses
   those automatically.

   Usage:
     node dev/gen-emoji-lottie.js
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { TGA_CUSTOM_EMOJI, TGA_EMOJI_ANIMATED } = require("../public/emoji-map.js");

const OUT_DIR = path.join(__dirname, "..", "public", "emoji");

function codepointKey(char) {
  return [...char].map((c) => c.codePointAt(0).toString(16)).join("-");
}

function fileKeyFor(char) {
  return TGA_CUSTOM_EMOJI[char] || codepointKey(char);
}

// A curated style per character; everything else falls back to hash pick.
const STYLE_PICK = {
  "⚙": "spin",   "🔄": "spin",   "🔃": "spin",   "⏳": "spin",
  "⚡": "pulse",  "💡": "pulse",  "⭐": "pulse",  "🌠": "pulse",
  "✅": "pop",    "❌": "pop",    "🎵": "pop",    "🎶": "pop",
  "✈": "float",  "📖": "float",  "📄": "float",  "📧": "float",
  "📩": "float",  "🔍": "float",  "🌙": "float",  "📈": "float",
  "💰": "bounce", "🤖": "bounce", "💳": "bounce", "📦": "bounce",
  "🛒": "bounce", "🪙": "bounce", "🔑": "bounce", "🎧": "bounce",
  "⚠": "wiggle",  "📣": "wiggle", "📢": "wiggle", "👁": "wiggle",
  "💱": "wiggle",  "🛠": "wiggle", "📍": "wiggle", "📌": "wiggle"
};

const STYLES = ["float", "bounce", "pulse", "wiggle", "spin"];
function styleFor(char) {
  if (STYLE_PICK[char]) return STYLE_PICK[char];
  let h = 0;
  for (const c of char) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return STYLES[h % STYLES.length];
}

const FR = 30;
const DUR = 120; // frames (4s loop)
const W = 256;
const H = 256;
const FONT = "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";

function kf(t, s) {
  return { t, s, h: 0 };
}

function textLayer(char, anim) {
  const ks = {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [W / 2, H / 2, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 1, k: anim.scale, ix: 3 }
  };
  if (anim.pos) ks.p = { a: 1, k: anim.pos };
  if (anim.rot) ks.r = { a: 1, k: anim.rot };

  return {
    ddd: 0,
    ind: 1,
    ty: 5,
    nm: "emoji",
    sr: 1,
    ks,
    ao: 0,
    t: {
      d: {
        k: [
          {
            s: {
              s: 150,
              f: FONT,
              t: char,
              j: 2,
              tr: 0,
              lh: 200,
              ls: 0,
              fc: [1, 1, 1, 1]
            }
          }
        ]
      },
      p: {},
      m: { g: 1, a: { a: 0, k: [0, 0] } },
      a: []
    },
    ip: 0,
    op: DUR,
    st: 0,
    bm: 0
  };
}

function buildAnimation(char, style) {
  const half = DUR / 2;
  let scale, pos, rot;

  if (style === "float") {
    scale = [kf(0, [100, 100, 100]), kf(half, [104, 104, 100]), kf(DUR, [100, 100, 100])];
    pos = [kf(0, [W / 2, H / 2, 0]), kf(half, [W / 2, H / 2 - 14, 0]), kf(DUR, [W / 2, H / 2, 0])];
  } else if (style === "bounce") {
    scale = [
      kf(0, [100, 100, 100]),
      kf(half - 8, [106, 106, 100]),
      kf(half, [112, 92, 100]),
      kf(half + 10, [98, 104, 100]),
      kf(DUR, [100, 100, 100])
    ];
    pos = [kf(0, [W / 2, H / 2, 0]), kf(half - 8, [W / 2, H / 2 - 10, 0]), kf(half, [W / 2, H / 2, 0]), kf(half + 10, [W / 2, H / 2 - 2, 0]), kf(DUR, [W / 2, H / 2, 0])];
  } else if (style === "pulse") {
    scale = [kf(0, [100, 100, 100]), kf(30, [114, 114, 100]), kf(60, [100, 100, 100]), kf(90, [114, 114, 100]), kf(DUR, [100, 100, 100])];
  } else if (style === "wiggle") {
    rot = [kf(0, [0]), kf(30, [-8]), kf(60, [8]), kf(90, [-8]), kf(DUR, [0])];
    scale = [kf(0, [100, 100, 100]), kf(DUR, [100, 100, 100])];
  } else {
    // spin — two full rotations, smooth
    rot = [kf(0, [0]), kf(DUR, [360])];
    scale = [kf(0, [100, 100, 100]), kf(DUR, [100, 100, 100])];
  }

  return {
    v: "5.7.4",
    fr: FR,
    ip: 0,
    op: DUR,
    w: W,
    h: H,
    nm: "tga-emoji-" + style,
    ddd: 0,
    assets: [],
    layers: [textLayer(char, { scale, pos, rot })],
    markers: []
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let count = 0;
for (const char of TGA_EMOJI_ANIMATED) {
  const key = fileKeyFor(char);
  const style = styleFor(char);
  const anim = buildAnimation(char, style);
  const file = path.join(OUT_DIR, key + ".json");
  fs.writeFileSync(file, JSON.stringify(anim));
  count++;
  console.log(`  ✓ ${char} -> ${key}.json (${style})`);
}

console.log(`\nWrote ${count} emoji lottie file(s) to public/emoji/`);
