/* Bow Down Visuals service worker.
 * Cache-first ONLY for hashed build assets (/assets/* — a new deploy means
 * new URLs, so cache-first can never serve stale code) and for the vendored
 * engine BINARIES (/engines/* WASM/models under stable names, served
 * immutable by the API; cache-first stops repeat visits from re-downloading
 * tens of MB). Engine SCRIPT GLUE (.js/.mjs under /engines/*) is
 * network-first, mirroring the API's cache policy (lib/cache-policy.ts):
 * glue is mutable code whose content changes under a stable name, and
 * cache-first here would pin the old copy in this cache even though the
 * server deliberately revalidates glue — the green-screen disease (a
 * year-pinned rvm-worker.js) in a second host. Everything else
 * same-origin (public files with stable names: the extension zip,
 * posters, opengraph, llms.txt, sitemap) is network-first with a cache
 * fallback — those files are rebuilt under the SAME name, and cache-first
 * would pin returning visitors to the old copy indefinitely.
 * Network-first for API + navigations.
 * Bump CACHE_VERSION to force clients onto fresh assets after a deploy —
 * v6 exists to purge the v5 caches, which hold engine glue pinned by the
 * old blanket cache-first rule; v7 ships the offline page's brand image
 * swap (app-icon portrait → the logo lockup, precached with the shell).
 */
const CACHE_VERSION = "bdv-v7";
const STATIC_CACHE = `bdv-static-${CACHE_VERSION}`;
const SHELL_CACHE = `bdv-shell-${CACHE_VERSION}`;

// App shell cached at install so the PWA opens offline. offline.html
// rides along: when the shell itself never made it into the cache, an
// offline open still lands on a designed page that says what's wrong —
// never a bare text error or a half-booted shell.
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/logo-static.webp", "/offline.html"];

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

/** VAPID public keys arrive base64url — the Push API wants raw bytes.
 *  (Mirror of src/lib/push-client.ts's decoder; the worker is a plain
 *  script and cannot import it.) */
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

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

/* ── Push subscription rotation ─────────────────────────────────────────
 * Browsers rotate push subscriptions on their own schedule and fire
 * pushsubscriptionchange. A worker that ignores it can be left with NO
 * subscription at all — and the sign-in repair (src/lib/push-client.ts)
 * can only re-register a subscription that still exists, so the device
 * would silently stop receiving pings until the person re-opts-in by
 * hand in Settings. Resubscribe here with the same VAPID key (the old
 * subscription's own key when the browser hands it over, otherwise the
 * public key from the public /api/push/config) so a live subscription
 * always exists. Registering it to the signed-in user needs their auth,
 * which the worker never holds — that stays the repair's job at the
 * next sign-in, and the server prunes the dead endpoint on its next
 * send (404/410), so the chain closes with no row able to strand. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        let applicationServerKey =
          (event.oldSubscription && event.oldSubscription.options
            ? event.oldSubscription.options.applicationServerKey
            : null) || null;
        if (!applicationServerKey) {
          const res = await fetch("/api/push/config");
          const config = res && res.ok ? await res.json().catch(() => null) : null;
          if (!config || config.configured !== true || typeof config.publicKey !== "string") {
            return; // push is off in this environment — nothing to renew
          }
          applicationServerKey = urlBase64ToUint8Array(config.publicKey);
        }
        await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      } catch {
        /* best effort — the sign-in repair and the settings card remain */
      }
    })()
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

/* Engine script glue (.js/.mjs under /engines/*) — mutable code under
 * stable names, network-first like the server's own cache policy.
 * Everything else under /engines/* (wasm/onnx/tflite/task/bin/data)
 * is a version-pinned heavy binary and stays cache-first. */
function isEngineGlue(url) {
  if (!url.pathname.startsWith("/engines/")) return false;
  const lower = url.pathname.toLowerCase();
  return lower.endsWith(".js") || lower.endsWith(".mjs");
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
          // Only a good page may become the offline shell — an error
          // response (a 401 gate form, a 500) cached here would be
          // served later as if it were the app.
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
          }
          return res;
        })
        .catch(() =>
          caches.match("/index.html").then((cached) => {
            if (cached) return cached;
            return caches.match("/offline.html").then((offlinePage) => {
              if (offlinePage) return offlinePage;
              return new Response("Offline — Bow Down Visuals needs a connection to load.", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              });
            });
          })
        )
    );
    return;
  }

  // Engine script glue: network-first (see isEngineGlue) — a cached
  // copy is only the offline fallback, never the first answer.
  if (isEngineGlue(url)) {
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
    return;
  }

  // Hashed build assets (/assets/*): the filename carries a content hash,
  // so a cached copy can never be stale — cache-first, populate on miss.
  // Vendored engine binaries (/engines/*) get the same treatment:
  // version-pinned files under stable names, served with immutable
  // cache headers.
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
