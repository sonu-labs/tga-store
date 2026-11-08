/* ==========================================================================
   TGA STORE — CLOUDFLARE WORKER (Workers Builds / wrangler)
   ==========================================================================
   This repo also deploys to Cloudflare Workers through Workers Builds (the
   `tgastore` service). The app itself is a Vercel project — the API is Node
   serverless functions in `api/` with MongoDB and all secrets living in the
   Vercel project. So the Worker here does exactly two things:

     1. serves the static frontend from Workers Static Assets (./public), and
     2. proxies every `/api/*` request (same path, query and body) to the
        production Vercel deployment, which answers it.

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // /api/* → Vercel (streaming pass-through, headers untouched)
    if (path === "/api" || path.startsWith("/api/")) {
      const origin = String((env && env.API_ORIGIN) || API_ORIGIN_DEFAULT).replace(/\/+$/, "");
      const target = origin + path + url.search;
      const canHaveBody = request.method !== "GET" && request.method !== "HEAD";
      const upstream = new Request(target, {
        method: request.method,
        headers: request.headers,
        body: canHaveBody ? request.body : undefined,
        redirect: "manual",
      });
      return fetch(upstream);
    }

    // Pretty URLs → same targets vercel.json rewrites to
    const rewritten = PAGE_REWRITES[path];
    if (rewritten) {
      const assetUrl = new URL(rewritten, url);
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
