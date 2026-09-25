/* Bow Down Visuals service worker.
 * Cache-first for static assets, network-first for API + navigations.
 * Bump CACHE_VERSION to force clients onto fresh assets after a deploy.
 */
const CACHE_VERSION = "bdv-v1";
const STATIC_CACHE = `bdv-static-${CACHE_VERSION}`;
const SHELL_CACHE = `bdv-shell-${CACHE_VERSION}`;

// App shell cached at install so the PWA opens offline.
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* offline during install — shell fills in on first fetch */
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (k) =>
              k.startsWith("bdv-static-") ||
              k.startsWith("bdv-shell-") ||
              k.startsWith("bow-down-visuals-")
          )
          .filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isNavigation(request) {
  return request.mode === "navigate";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests; let POST/PUT/etc. pass through untouched.
  if (request.method !== "GET") return;

  // API calls: network-first, never cached (credits + live data must stay fresh).
  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Cross-origin (fonts, CDNs, provider URLs): let the browser handle it.
  if (url.origin !== self.location.origin) return;

  // SPA navigations: network-first so new deploys are picked up,
  // fall back to the cached app shell when offline.
  if (isNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match("/index.html").then((cached) => {
            if (cached) return cached;
            return new Response("Offline — Bow Down Visuals needs a connection to load.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            });
          })
        )
    );
    return;
  }

  // Same-origin static assets (hashed JS/CSS, images, audio, manifest, icons):
  // cache-first, populate on miss.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        // Only cache successful, basic (same-origin) responses.
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      });
    })
  );
});
