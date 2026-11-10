/* ==========================================================================
   TGA STORE — UI v2 behaviour helpers
   ==========================================================================
   Tiny, dependency-free enhancements loaded with `defer`:

     • injects the ambient aurora background layer,
     • native lazy-loading + async decode for every below-the-fold image,
     • a soft ripple on primary buttons (pure CSS animation),
     • graceful <img> fallbacks,
     • a "back online" toast after a dropped connection.

   Nothing here is required for the store to work — if it fails to load, the
   site behaves exactly as before.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------- aurora layer */

  function mountAurora() {
    if (document.querySelector(".ui-aurora")) return;
    if (!document.body) return;
    var layer = document.createElement("div");
    layer.className = "ui-aurora";
    layer.setAttribute("aria-hidden", "true");
    document.body.insertBefore(layer, document.body.firstChild);
  }

  /* --------------------------------------------------------- lazy images */

  function decorateImages(root) {
    var scope = root || document;
    var images = scope.querySelectorAll("img");

    for (var i = 0; i < images.length; i++) {
      var img = images[i];

      if (!img.getAttribute("decoding")) img.setAttribute("decoding", "async");

      var cls = String(img.className || "");
      var isAboveFold =
        img.hasAttribute("fetchpriority") ||
        /login-hero-logo|login-card-logo|header-logo/.test(cls);

      if (isAboveFold) {
        img.setAttribute("fetchpriority", "high");
        img.removeAttribute("loading");
        continue;
      }

      if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
    }
  }

  /* -------------------------------------------------------------- ripple */

  var RIPPLE_SELECTOR =
    ".login-btn, .primary-btn, .buy-now, .add-balance, .btn-telegram, .secondary-btn, .nav-btn";

  function addRipple(event) {
    var target = event.target && event.target.closest ? event.target.closest(RIPPLE_SELECTOR) : null;
    if (!target) return;
    if (target.disabled) return;

    var rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    var size = Math.max(rect.width, rect.height) * 1.1;
    var span = document.createElement("span");
    span.className = "ui-ripple";
    span.style.width = size + "px";
    span.style.height = size + "px";
    span.style.left = (event.clientX - rect.left) + "px";
    span.style.top = (event.clientY - rect.top) + "px";

    var style = window.getComputedStyle(target);
    if (style.position === "static") target.style.position = "relative";
    if (style.overflow === "visible") target.style.overflow = "hidden";

    target.appendChild(span);
    setTimeout(function () {
      if (span.parentNode) span.parentNode.removeChild(span);
    }, 700);
  }

  /* -------------------------------------------------- online/offline toast */

  function mountNetworkToast() {
    window.addEventListener("offline", function () {
      if (typeof window.toast === "function") {
        window.toast("You are offline — reconnecting when the network returns.", "error");
      }
    });

    window.addEventListener("online", function () {
      if (typeof window.toast === "function") {
        window.toast("Back online ✓", "success");
      }
    });
  }

  /* ---------------------------------------------------------------- boot */

  function boot() {
    mountAurora();
    decorateImages(document);
    mountNetworkToast();

    document.addEventListener("click", addRipple, { passive: true });

    // Dynamically inserted images (country cards, recharge methods, avatars).
    if (typeof MutationObserver === "function" && document.body) {
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          decorateImages(document);
        }, 200);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.TGA_UI_V2 = { decorateImages: decorateImages, mountAurora: mountAurora };
})();
