// Server-side proxy for QR images.
// Some UPI/FamPay QR endpoints (a) block hot-linking / require certain
// headers, (b) return short-lived signed URLs, or (c) send an HTML page
// instead of an image — all of which show a "broken image" icon in the
// browser and also break the `download` attribute on <a> (cross-origin
// downloads are ignored by Chrome on Android and just open the URL).
//
// This endpoint fetches the upstream image server-side and streams the
// bytes back on our own origin, so:
//   • <img src="/api/qr_proxy?url=..."> reliably displays
//   • <a href="/api/qr_proxy?url=...&dl=qr.jpg" download> actually
//     saves the file, because it's now same-origin AND we send a
//     Content-Disposition: attachment header.

const { setCors } = require("../db");

// Only allow fetching from http(s) URLs. Nothing else.
function isSafeUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function pickExt(contentType, fallbackName) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  // fallback: try to keep whatever the caller asked for
  const m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(fallbackName || "");
  return m ? m[1].toLowerCase() : "png";
}

module.exports = async function handler(req, res) {
  setCors(res, "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  const raw = String(req.query.url || "").trim();
  if (!raw || !isSafeUrl(raw)) {
    return res.status(400).json({ success: false, message: "Invalid or missing url." });
  }

  // If ?dl=... is present, force a download with that filename.
  const dl = String(req.query.dl || "").trim();

  try {
    const upstream = await fetch(raw, {
      method: "GET",
      // Some providers reject requests without a UA / Accept header.
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TGA-Store-QR-Proxy/1.0)",
        "Accept": "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return res.status(502).json({
        success: false,
        message: `Upstream QR fetch failed (${upstream.status}).`,
      });
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    // Guard: if upstream returned HTML/JSON (some gateways do this on error),
    // don't pretend it's an image — the browser would still show a broken icon.
    const lowerCt = contentType.toLowerCase();
    if (!lowerCt.startsWith("image/") && !lowerCt.includes("octet-stream")) {
      return res.status(502).json({
        success: false,
        message: "Upstream did not return an image.",
        content_type: contentType,
      });
    }

    const arrayBuf = await upstream.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buf.length);
    // Cache briefly at the edge — QR contents don't change per order.
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");

    if (dl) {
      // Sanitize filename: strip path separators, cap length, ensure extension.
      let safe = dl.replace(/[\\\/\r\n"']/g, "_").slice(0, 80) || "qr";
      if (!/\.[a-z0-9]{2,5}$/i.test(safe)) {
        safe = `${safe}.${pickExt(contentType, dl)}`;
      }
      res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
    } else {
      res.setHeader("Content-Disposition", "inline");
    }

    return res.status(200).end(buf);
  } catch (err) {
    console.error("qr_proxy error:", err);
    return res.status(500).json({
      success: false,
      message: "QR proxy failed.",
      error: String(err && err.message || err),
    });
  }
};
