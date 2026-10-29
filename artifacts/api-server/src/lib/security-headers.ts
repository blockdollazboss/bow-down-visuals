/**
 * security-headers.ts — the app's security response headers (manual
 * implementation — no helmet dependency).
 *
 * Mounted FIRST in app.ts — before the rate limiter, the staging
 * gate, the API router, static serving, the SPA fallback, and the
 * 404/error handlers — so every settled response (API, static,
 * gated, and error alike) carries these headers.
 *
 * CSP is permissive for the Vite SPA bundle while blocking common
 * injection vectors.
 */
import type { Request, Response, NextFunction } from "express";

/* HSTS: once a browser has seen the site over HTTPS, it must refuse
   plain HTTP for a year (subdomains included). Browsers ignore the
   header when it arrives over HTTP, so setting it unconditionally
   is safe for local dev/test while closing the missing-header
   finding (Oct 26 daily security check) on the HTTPS
   production/staging responses. Deliberately no `preload` —
   preload-list submission is a separate, hard-to-reverse
   commitment the site has not made. */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  /* Embed pages (/embed/*) must be frameable on ANY site — they carry no
     auth, set no cookies, and are the product's billboard. Skip
     X-Frame-Options there and relax CSP (no frame-ancestors restriction). */
  const isEmbed = _req.path.startsWith("/embed/");
  res.setHeader("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!isEmbed) {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    isEmbed
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",
          "connect-src 'self'",
          "media-src 'self' https: blob: data:",
          "font-src 'self' data: https:",
        ].join("; ")
      : [
          "default-src 'self'",
          /* jsdelivr serves the Go Live kit's in-browser engines (MediaPipe
             segmentation + RNNoise suppression WASM); 'wasm-unsafe-eval'
             lets those WASM modules compile. Cloudflare Stream hosts take
             the WHIP/WHEP calls for native broadcasts. The r2.dev origin
             is the site's own media bucket (MEDIA_CDN_URL in the
             frontend's lib/media-cdn.ts): the kit's engines load
             bucket-first — MediaPipe/RVM scripts via script tags and
             importScripts (script-src), the ORT WASM + RVM model via
             fetch inside the engine worker (connect-src). Without it
             every bucket hop was CSP-refused and only the same-origin
             fallback copies ever served (Stack-100 #3 Lane C). */
          "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https: blob:",
          /* blob: rides connect-src, not just img-src, because of the
             World's 3D bodies: three.js GLTFLoader decodes EMBEDDED
             GLB images through ImageBitmapLoader, which turns each
             image's bytes into a blob: object URL and FETCHES it —
             and fetch answers to connect-src. Without blob: here,
             every embedded texture fetch was CSP-refused in
             production (img-src had blob: all along, which covers
             <img> loads only and made the policy look right), the
             loader swallowed the refusal into a null texture, and
             every fixture body parsed "successfully" with no
             textures at all — the owner's Oct 28 session: six
             "textures did not land" beacons, gold capsules at every
             post, while local benches (no CSP) stayed green. */
          "connect-src 'self' blob: https://*.supabase.co https://api.stripe.com wss://*.supabase.co https://cdn.jsdelivr.net https://*.cloudflarestream.com https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev",
          "worker-src 'self' blob:",
          "frame-src https://js.stripe.com",
          "font-src 'self' data: https:",
          "media-src 'self' https: blob:",
        ].join("; ")
  );
  next();
}
