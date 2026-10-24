/* Bow Down Visuals service worker.
 * Cache-first ONLY for hashed build assets (/assets/* — a new deploy means
 * new URLs, so cache-first can never serve stale code) and for the vendored
 * engine files (/engines/* — version-pinned WASM/models under stable names,
 * served immutable by the API; cache-first stops repeat visits from
 * re-downloading tens of MB). Everything else same-origin (public files
 * with stable names: the extension zip, posters, opengraph, llms.txt,
 * sitemap) is network-first with a cache fallback — those files are
 * rebuilt under the SAME name, and cache-first would pin returning
 * visitors to the old copy indefinitely.
 * Network-first for API + navigations.
 * Bump CACHE_VERSION to force clients onto fresh assets after a deploy.
 */
const CACHE_VERSION = "bdv-v5";
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

/* ── Web push (Stack 2 go-live alerts) ──────────────────────────────────
 * The server sends { title, body, link, kind } as JSON. A payload that
 * doesn't parse still shows an honest generic alert — never a fake
 * stream title. Clicking focuses an open tab on the link or opens it. */
self.addEventListener("push", (event) => {
  let data = { title: "Bow Down Visuals", body: "Someone you follow is live.", link: "/", kind: "live" };
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === "object") {
      data = {
        title: typeof parsed.title === "string" && parsed.title ? parsed.title : data.title,
        body: typeof parsed.body === "string" ? parsed.body : data.body,
        link: typeof parsed.link === "string" && parsed.link.startsWith("/") ? parsed.link : "/",
        kind: typeof parsed.kind === "string" ? parsed.kind : "live",
      };
    }
  } catch {
    /* keep the honest generic alert */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: `bdv-${data.kind}`,
      data: { link: data.link },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(link).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    })
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

  // Hashed build assets (/assets/*): the filename carries a content hash,
  // so a cached copy can never be stale — cache-first, populate on miss.
  // Vendored engines (/engines/*) get the same treatment: version-pinned
  // files under stable names, served with immutable cache headers.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/engines/")) {
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
    return;
  }

  // Everything else same-origin (public files with stable names — the
  // extension zip, poster/hero images, opengraph.jpg, llms.txt, icons):
  // network-first so a rebuilt file reaches returning visitors immediately;
  // fall back to the cached copy only when offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          return new Response("Offline — Bow Down Visuals needs a connection to load.", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        })
      )
  );
});
