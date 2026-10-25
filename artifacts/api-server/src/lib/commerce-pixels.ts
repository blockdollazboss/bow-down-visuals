/* Commerce tracking pixels (wave-4 #41, migration 0240).
 *
 * The release rail proved this pattern first (migration 0186,
 * routes/generate/distribution.ts): a creator attaches THEIR OWN
 * Meta / TikTok / Google ad-platform IDs, the public surface fires
 * exactly those IDs, and a surface with none configured fires
 * nothing. This module is the same discipline for commerce —
 * storefronts (creator_profiles) and shops (shops) — so both rails
 * validate, store and present pixel IDs identically.
 *
 * Consent honesty (the hard rule): pixels fire under exactly the
 * same rules as the release rail, never wider. The ONLY IDs that can
 * ever fire are the seller's own, entered by the seller in their own
 * settings, shape-validated on save and re-validated on every public
 * read. There are no platform/default pixels, and no ID set means
 * the page loads no pixel library and fires no event at all.
 */

export interface CommercePixels {
  metaPixelId: string | null;
  tiktokPixelId: string | null;
  googleTagId: string | null;
}

export const NO_PIXELS: CommercePixels = {
  metaPixelId: null,
  tiktokPixelId: null,
  googleTagId: null,
};

/* Same shapes as the release rail (PIXEL_ID_PATTERNS in
   routes/generate/distribution.ts + the frontend mirror in
   lib/smartlink-pixels.ts) — one truth for what a real ID looks like. */
export const COMMERCE_PIXEL_ID_PATTERNS = {
  meta: /^\d{6,20}$/,
  tiktok: /^[A-Za-z0-9]{10,32}$/,
  google: /^(?:G|AW|GT|UA)-[A-Za-z0-9-]{4,24}$/,
} as const;

export type CommercePixelKind = keyof typeof COMMERCE_PIXEL_ID_PATTERNS;

const PIXEL_LABELS: Record<CommercePixelKind, string> = {
  meta: "Meta Pixel",
  tiktok: "TikTok Pixel",
  google: "Google tag",
};

/* undefined = leave as-is · "" = clear · anything else must match the
   platform's published ID shape or the save is refused honestly — a
   bad ID stored silently would fire nothing and lie by omission.
   (Mirrors cleanPixelId on the release rail, same messages.) */
export function cleanCommercePixelId(
  kind: CommercePixelKind,
  raw: string | undefined,
  current: string | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: current };
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  if (!COMMERCE_PIXEL_ID_PATTERNS[kind].test(v)) {
    return { ok: false, error: `That ${PIXEL_LABELS[kind]} ID doesn't look right — double-check it and try again.` };
  }
  return { ok: true, value: v };
}

/** Validate a whole settings save at once: any bent ID refuses the
 *  whole save (nothing is written), exactly like the release rail. */
export function cleanCommercePixels(
  input: { metaPixelId?: string; tiktokPixelId?: string; googleTagId?: string },
  current: CommercePixels,
):
  | { ok: true; value: CommercePixels }
  | { ok: false; error: string } {
  const meta = cleanCommercePixelId("meta", input.metaPixelId, current.metaPixelId);
  if (!meta.ok) return meta;
  const tiktok = cleanCommercePixelId("tiktok", input.tiktokPixelId, current.tiktokPixelId);
  if (!tiktok.ok) return tiktok;
  const google = cleanCommercePixelId("google", input.googleTagId, current.googleTagId);
  if (!google.ok) return google;
  return { ok: true, value: { metaPixelId: meta.value, tiktokPixelId: tiktok.value, googleTagId: google.value } };
}

/** Re-validate stored values on the way OUT to a public surface: a
 *  row written any other way can never arm a pixel — bent shapes
 *  present as null (not configured). */
export function sanitizeCommercePixels(row: {
  meta_pixel_id?: string | null;
  tiktok_pixel_id?: string | null;
  google_tag_id?: string | null;
} | null | undefined): CommercePixels {
  if (!row) return { ...NO_PIXELS };
  const pick = (kind: CommercePixelKind, v: string | null | undefined): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return t && COMMERCE_PIXEL_ID_PATTERNS[kind].test(t) ? t : null;
  };
  return {
    metaPixelId: pick("meta", row.meta_pixel_id),
    tiktokPixelId: pick("tiktok", row.tiktok_pixel_id),
    googleTagId: pick("google", row.google_tag_id),
  };
}

/** True when at least one configured, well-shaped ID exists — the
 *  only state in which a commerce surface may fire anything. */
export function hasArmedCommercePixel(pixels: CommercePixels | null | undefined): boolean {
  if (!pixels) return false;
  return Boolean(pixels.metaPixelId || pixels.tiktokPixelId || pixels.googleTagId);
}
