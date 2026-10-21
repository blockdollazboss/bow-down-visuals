/* Retargeting pixels for release smartlinks (migration 0187).
 *
 * A creator can attach THEIR OWN ad-platform IDs to a release; the
 * public presave/smartlink landing fires exactly those on view, so a
 * fan's visit becomes a retargeting audience in the creator's own ad
 * accounts. No IDs configured → nothing loads, nothing fires. The
 * server validates ID shapes on save (routes/generate/distribution.ts
 * is the source of truth); the patterns are mirrored here so the
 * settings form can catch a typo before the round-trip.
 */

export interface SmartlinkPixels {
  metaPixelId: string | null;
  tiktokPixelId: string | null;
  googleTagId: string | null;
}

export const PIXEL_ID_PATTERNS = {
  meta: /^\d{6,20}$/,
  tiktok: /^[A-Za-z0-9]{10,32}$/,
  google: /^(?:G|AW|GT|UA)-[A-Za-z0-9-]{4,24}$/,
} as const;

export type PixelKind = keyof typeof PIXEL_ID_PATTERNS;

/** Empty is allowed (means "not configured"); otherwise the ID must
 *  match the platform's real shape. */
export function isValidPixelId(kind: PixelKind, value: string): boolean {
  const v = value.trim();
  return v === "" || PIXEL_ID_PATTERNS[kind].test(v);
}

export interface ArmedPixel {
  kind: PixelKind;
  id: string;
}

/** The pixels that should actually fire for a landing: configured AND
 *  well-shaped. Pure — the public page and the tests both use it. */
export function armedPixels(pixels: SmartlinkPixels | null | undefined): ArmedPixel[] {
  if (!pixels) return [];
  const out: ArmedPixel[] = [];
  const meta = pixels.metaPixelId?.trim();
  if (meta && PIXEL_ID_PATTERNS.meta.test(meta)) out.push({ kind: "meta", id: meta });
  const tiktok = pixels.tiktokPixelId?.trim();
  if (tiktok && PIXEL_ID_PATTERNS.tiktok.test(tiktok)) out.push({ kind: "tiktok", id: tiktok });
  const google = pixels.googleTagId?.trim();
  if (google && PIXEL_ID_PATTERNS.google.test(google)) out.push({ kind: "google", id: google });
  return out;
}

/* One page load arms each (network, id) pair at most once, however
   many times the landing re-renders. */
const injected = new Set<string>();

/** Test hook: clears the once-per-load guard. */
export function __resetSmartlinkPixelsForTests(): void {
  injected.clear();
}

function loadScript(src: string, key: string): void {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return;
  const s = doc.createElement("script");
  s.async = true;
  s.src = src;
  doc.head.appendChild(s);
  injected.add(key);
}

/**
 * Fire the configured pixels. Returns the networks armed by THIS call
 * (empty when nothing is configured, when there's no DOM, or when
 * everything was already armed). Never throws — pixels must never
 * break the fan's page.
 */
export function injectSmartlinkPixels(pixels: SmartlinkPixels | null | undefined): PixelKind[] {
  try {
    const win = typeof window !== "undefined" ? (window as unknown as Record<string, any>) : null;
    if (!win) return [];
    const fired: PixelKind[] = [];
    for (const { kind, id } of armedPixels(pixels)) {
      const key = `${kind}:${id}`;
      if (injected.has(key)) continue;

      if (kind === "meta") {
        /* Meta Pixel bootstrap: queue stub, library, init + PageView. */
        if (typeof win.fbq !== "function") {
          const fbq: any = function (...args: unknown[]) {
            (fbq.q = fbq.q || []).push(args);
          };
          fbq.q = [];
          fbq.loaded = true;
          fbq.version = "2.0";
          win.fbq = fbq;
          win._fbq = fbq;
        }
        loadScript("https://connect.facebook.net/en_US/fbevents.js", key);
        win.fbq("init", id);
        win.fbq("track", "PageView");
        fired.push("meta");
      }

      if (kind === "tiktok") {
        /* TikTok Pixel bootstrap: method queue, library, PageView. */
        const ttq: any[] = Array.isArray(win.ttq) ? win.ttq : [];
        win.ttq = ttq;
        const methods = ["track", "page", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
        for (const m of methods) {
          if (typeof (ttq as any)[m] !== "function") {
            (ttq as any)[m] = (...args: unknown[]) => { ttq.push([m, ...args]); };
          }
        }
        loadScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`, key);
        (ttq as any).page();
        fired.push("tiktok");
      }

      if (kind === "google") {
        /* Google tag bootstrap: dataLayer + gtag, library, config. */
        win.dataLayer = Array.isArray(win.dataLayer) ? win.dataLayer : [];
        if (typeof win.gtag !== "function") {
          win.gtag = (...args: unknown[]) => { win.dataLayer.push(args); };
        }
        loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`, key);
        win.gtag("js", new Date());
        win.gtag("config", id);
        fired.push("google");
      }
    }
    return fired;
  } catch {
    return [];
  }
}
