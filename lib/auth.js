const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const SALT_ROUNDS = 12;

function pickChar(pool) {
  return pool[crypto.randomInt(0, pool.length)];
}

function generateStrongPassword(length = 14) {
  const size = Math.max(12, Number(length) || 14);
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*_-+=";
  const all = upper + lower + digits + symbols;

  const chars = [
    pickChar(upper),
    pickChar(lower),
    pickChar(digits),
    pickChar(symbols)
  ];

  for (let i = chars.length; i < size; i++) {
    chars.push(pickChar(all));
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join("");
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  if (!String(hash).startsWith("$2")) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  let p = String(phone || "").trim().replace(/\s+/g, "");
  if (!p) return "";
  if (!p.startsWith("+")) {
    p = "+" + p.replace(/^\+/, "");
  }
  return p;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const p = normalizePhone(phone);
  return /^\+\d{7,15}$/.test(p);
}

function generateConnectToken() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = {
  generateStrongPassword,
  hashPassword,
  verifyPassword,
  normalizeEmail,
  normalizePhone,
  isValidEmail,
  isValidPhone,
  generateConnectToken,
};
