// Base URL for heavy site media (video/audio/images).
//
// MEDIA_CDN_URL points at the R2 public bucket (bow-down-visuals-media), so
// heavy media is served off Render's metered bandwidth. Empty string would
// serve from the app origin instead. One place to flip the whole site.
//
// CORS: the bucket carries a CORS policy for the site's origins
// (bowdownvisuals.com, www, both onrender hosts; GET/HEAD, verified live
// 2026-10-21 — ACAO echoes the request origin, Vary: Origin, preflight
// 204), so crossOrigin="anonymous" consumers (the World hall) and
// canvas-drawn assets (hero sprite sheets, fog, game sprites, export
// watermark) may use these URLs too, as long as the draw path actually
// requests the image in CORS mode (crossOrigin="anonymous" set before
// src) so the canvas stays untainted.
export const MEDIA_CDN_URL: string =
  "https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev";

/** Base URL (trailing slash) that media paths hang off of. */
export function mediaBaseUrl(): string {
  if (MEDIA_CDN_URL) return `${MEDIA_CDN_URL.replace(/\/+$/, "")}/`;
  return import.meta.env.BASE_URL;
}

export function mediaUrl(path: string): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `${mediaBaseUrl()}${clean}`;
}
