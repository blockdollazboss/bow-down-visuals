// Base URL for heavy site media (video/audio/images).
//
// MEDIA_CDN_URL points at the R2 public bucket (bow-down-visuals-media), so
// heavy media is served off Render's metered bandwidth. Empty string would
// serve from the app origin instead. One place to flip the whole site.
//
// IMPORTANT: the r2.dev public URL sends no CORS headers, so only plain
// element consumers (<img>, <video>, <audio>, CSS backgrounds, posters) may
// use these URLs. Anything loaded with crossOrigin="anonymous" (the World
// hall) or drawn into a canvas (hero sprite sheets, fog, game sprites,
// export watermark) must keep its origin path — those stay on BASE_URL.
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
