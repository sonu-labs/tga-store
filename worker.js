/* ==========================================================================
   TGA STORE — CLOUDFLARE WORKER (Workers Builds / wrangler)
   ==========================================================================
   This repo also deploys to Cloudflare Workers through Workers Builds (the
   `tgastore` service). The app itself is a Vercel project — the API is Node
   serverless functions in `api/` with MongoDB and all secrets living in the
   Vercel project. So the Worker here does three things:

     1. serves the static frontend from Workers Static Assets (./public),
     2. proxies every `/api/*` request (same path, query and body) to the
        production Vercel deployment, which answers it,
     3. caches the two expensive public endpoints (/api/countries and
        /api/status) at the edge and adds long-lived Cache-Control headers to
        static files — that is what makes repeat visits feel instant.

   The public site is served at https://tgastore.rulebreaker.cc (Workers
   custom domain). No secrets live in this file or in the Worker. `API_ORIGIN`
   can be overridden with a plain (non-secret) environment variable in the
   dashboard if the Vercel deployment ever moves — defaults to the Vercel
   origin. It must NOT point at the Cloudflare domain or `/api/*` would be
   proxied to this Worker itself.
   ========================================================================== */

const API_ORIGIN_DEFAULT = "https://tga-store.vercel.app";

/* vercel.json rewrites the pretty URLs; Workers Static Assets only knows real
   files, so replicate those rewrites here. */
const PAGE_REWRITES = {
  "/docs": "/docs.html",
  "/docs/": "/docs.html",
  "/admin": "/admin.html",
  "/admin/": "/admin.html",
  "/admin_login": "/admin_login.html",
  "/admin_login/": "/admin_login.html",
};

/* Public GET endpoints that are safe to cache at the edge for a few seconds.
   Everything else under /api/ is per-user or mutating and is never cached. */
const EDGE_CACHEABLE = {
  "/api/countries": 30,
  "/api/status": 15,
};

const LONG_CACHE = "public, max-age=604800, stale-while-revalidate=86400";
const SHORT_CACHE = "public, max-age=3600, stale-while-revalidate=86400";
const HTML_CACHE = "public, max-age=0, must-revalidate";

function cacheControlFor(path) {
  if (/\.(png|jpe?g|webp|avif|gif|ico|svg|woff2?|ttf)$/i.test(path)) return LONG_CACHE;
  if (/\.(css|js|json|map)$/i.test(path)) return SHORT_CACHE;
  if (path === "/" || path.endsWith(".html")) return HTML_CACHE;
  return "";
}

function withHeaders(response, additions) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(additions)) {
    if (value) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function proxyApi(request, env, url, ctx) {
  const origin = String((env && env.API_ORIGIN) || API_ORIGIN_DEFAULT).replace(/\/+$/, "");
  const target = origin + url.pathname + url.search;
  const ttl = EDGE_CACHEABLE[url.pathname];

  const upstreamRequest = () =>
    fetch(
      new Request(target, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      })
    );

  // Non-GET or non-cacheable endpoints: straight pass-through.
  if (request.method !== "GET" || !ttl || typeof caches === "undefined") {
    return upstreamRequest();
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  try {
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, { "X-Edge-Cache": "hit" });
  } catch (e) {
    // cache API unavailable — fall through to the network
  }

  const response = await upstreamRequest();
  if (response.ok) {
    const cacheable = withHeaders(response, {
      "Cache-Control": `public, max-age=${Math.max(5, Math.floor(ttl / 2))}, s-maxage=${ttl}`,
      "X-Edge-Cache": "miss",
    });
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(cache.put(cacheKey, cacheable.clone()).catch(() => {}));
    }
    return cacheable;
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // /api/* → Vercel (with edge caching for public endpoints)
    if (path === "/api" || path.startsWith("/api/")) {
      return proxyApi(request, env, url, ctx);
    }

    // Pretty URLs → same targets vercel.json rewrites to
    const rewritten = PAGE_REWRITES[path];
    if (rewritten) {
      const assetUrl = new URL(rewritten, url);
      const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
      return withHeaders(response, { "Cache-Control": HTML_CACHE });
    }

    const response = await env.ASSETS.fetch(request);
    const cacheControl = cacheControlFor(path);
    return cacheControl
      ? withHeaders(response, { "Cache-Control": cacheControl })
      : response;
  },
};
