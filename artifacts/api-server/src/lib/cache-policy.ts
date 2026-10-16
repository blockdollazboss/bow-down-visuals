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
