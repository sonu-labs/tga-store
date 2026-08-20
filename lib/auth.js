const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const SALT_ROUNDS = 10;

function generateStrongPassword(length = 14) {
  // Strong: upper + lower + digits + symbols, ensure at least one of each
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*_-+=";
  const all = upper + lower + digits + symbols;
  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];
  for (let i = 4; i < length; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  // shuffle
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  // legacy plain check: if hash not bcrypt, compare directly
  if (!hash.startsWith("$2")) return plain === hash;
  return bcrypt.compare(plain, hash);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  let p = String(phone || "").trim().replace(/\s+/g, "");
  if (!p) return "";
  if (!p.startsWith("+")) {
    // if 10 digits assume India? keep as is with +
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
  return crypto.randomBytes(16).toString("hex"); // 32 chars
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
