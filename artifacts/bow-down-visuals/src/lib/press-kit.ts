/* ─── Press kit helpers ───────────────────────────────────────────────────
   Pure client-side utilities for the Press Kit Builder. */

/** Normalize a string into a URL-safe press-kit handle (lowercase, hyphens). */
export function slugifyHandle(v: string): string {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** Validate a press-kit handle per the server rules (3-30 chars, a-z0-9-). */
export function isValidHandle(v: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v) && v.length >= 3 && v.length <= 30;
}

/** Build the public press-kit URL for a handle. */
export function publicPressKitUrl(origin: string, handle: string): string {
  return `${origin.replace(/\/$/, "")}/press/${handle}`;
}
