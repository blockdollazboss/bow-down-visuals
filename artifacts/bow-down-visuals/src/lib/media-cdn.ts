// Base URL for heavy site media (video/audio).
//
// Set MEDIA_CDN_URL to the R2 public bucket URL (e.g. "https://pub-xxxx.r2.dev")
// to serve media off Render's metered bandwidth. Empty string = serve from the
// app origin (current behavior). One place to flip the whole site.
export const MEDIA_CDN_URL: string = "";

export function mediaUrl(path: string): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  if (MEDIA_CDN_URL) return `${MEDIA_CDN_URL.replace(/\/+$/, "")}/${clean}`;
  return `${import.meta.env.BASE_URL}${clean}`;
}
