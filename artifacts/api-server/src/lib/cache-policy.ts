/**
 * cache-policy.ts — Cache-Control for the statically served frontend.
 *
 * Three classes:
 *  - index.html → no-cache: it references the hashed asset filenames,
 *    so a browser must always revalidate it or it can sit on a stale
 *    shell and never pick up a new deploy.
 *  - /engines/* → immutable for a year: the vendored engine files
 *    (WASM, models — tens of MB) ship under stable, version-pinned
 *    names, so the hashed-asset rule never matched them and repeat
 *    visits revalidated/re-downloaded them (Lane F audit, cache flag).
 *    They change only when a new engine version is vendored.
 *  - hashed build assets (name contains a ≥8-char content hash) →
 *    immutable for a year, the original rule.
 * Everything else → null (serve-static's default: revalidate).
 */
export function cacheControlForFile(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith("index.html")) return "no-cache";
  if (normalized.includes("/engines/")) return "public, max-age=31536000, immutable";
  if (/[.-][0-9a-f]{8,}\.[^.]+$/.test(normalized)) return "public, max-age=31536000, immutable";
  return null;
}

/* SPA fallback status (Lane V5 F-2): the fallback serves index.html for
   every non-API GET, but it used to hardcode an allowlist of literal
   page paths for the 200 — every parameterized page (/artist/:slug,
   /live/:id, /unlock/:slug, …) and every page added after the list was
   written got a 404 status with a perfectly good page body, so smoke
   checks and uptime monitors read live pages as missing.
   Rule now: a path is a PAGE (200) unless its last segment names a
   static-asset file (a known asset extension) — a file-looking path
   that reached the fallback is a genuinely missing asset (404).
   Genuine /api misses never reach this helper (handled upstream). */
const ASSET_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "css", "map", "json", "txt", "xml", "webmanifest",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "wav", "ogg", "mp4", "webm", "mov",
  "wasm", "pdf", "zip", "onnx", "task", "bin",
]);

export function spaFallbackStatus(path: string): 200 | 404 {
  const clean = path.split("?")[0] ?? path;
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  if (dot > 0) {
    const ext = last.slice(dot + 1).toLowerCase();
    if (ASSET_EXTENSIONS.has(ext)) return 404;
  }
  return 200;
}
