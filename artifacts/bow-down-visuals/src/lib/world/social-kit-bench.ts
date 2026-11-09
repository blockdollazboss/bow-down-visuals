/* ─── Social Kit bench in-world (Stack 400 world parity,
   census Lane B item 9 / manifest item B-09) ────────────────
   The Social Media Kit's own rail, native in the Post Office
   desk family — the 2D hub's SocialKitPanel flow:

     POST /api/social-kit  { brandName, tagline, style }
       → { assets: [{ url?, kind?, label? }], error?, message? }
       400 Visual Bucs — the credit registry's "/api/social-kit"
       entry (the route's own charge, the panel's own "Generate
       Kit · 400 Visual Bucs" label); the bench reads the
       registry, so the shown price can never drift from the
       confirmation's price. A failed generation is refunded
       server-side; the panel's own costNote states that and the
       bench shows the same copy.

   Confirmation law: the post rides useConfirmedApi's
   confirmedFetch — the registry-priced spend confirmation
   shows BEFORE anything runs, a declined confirmation runs
   nothing, and an empty asset list is a failure (the panel's
   own rule), never a dressed-up success.

   The hub spine carries over exactly: every returned asset
   lands in the hub project (kind "image", sourceAsset
   "social-kit"), so the scheduler and promo tools in-World
   can grab the kit the same way the 2D hub's tools can.

   Copy rides the panel's own catalog namespace
   (hubSpine.socialKit.*) so the bench's labels can never
   drift from the panel's. */
import { getCreditCost } from "../credit-costs";

export const SOCIAL_KIT_PATH = "/api/social-kit";

/** POST /api/social-kit — registry 400, the route's charge and
 *  the panel's own button label agree. */
export function socialKitCost(): number {
  const entry = getCreditCost(SOCIAL_KIT_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${SOCIAL_KIT_PATH}`);
  return entry.cost;
}

/* ─── The panel's own enums (verbatim from SocialKitPanel) ──── */

export const SOCIAL_KIT_STYLES = ["gold-luxury", "neon-pop", "minimal"] as const;
export type SocialKitStyle = (typeof SOCIAL_KIT_STYLES)[number];

/** The catalog label key per style (the panel's STYLES table). */
export const SOCIAL_KIT_STYLE_LABEL_KEYS: Record<SocialKitStyle, string> = {
  "gold-luxury": "hubSpine.socialKit.styleGold",
  "neon-pop": "hubSpine.socialKit.styleNeon",
  minimal: "hubSpine.socialKit.styleMinimal",
};

/** The panel's field ceilings: brand 60, tagline 120. */
export const SOCIAL_KIT_BRAND_MAX = 60;
export const SOCIAL_KIT_TAGLINE_MAX = 120;

/* ─── Form shaping — mirrors the panel's generate post ──────── */

export interface SocialKitInput {
  brandName: string;
  tagline: string;
  style: SocialKitStyle;
}

/** The panel posts trimmed fields verbatim: { brandName,
 *  tagline, style }. */
export function socialKitPayload(input: SocialKitInput): {
  brandName: string;
  tagline: string;
  style: SocialKitStyle;
} {
  return {
    brandName: input.brandName.trim(),
    tagline: input.tagline.trim(),
    style: input.style,
  };
}

/** The panel refuses to run without both a brand and a
 *  tagline — the same gate at the bench. */
export function socialKitCanRun(input: SocialKitInput): boolean {
  return input.brandName.trim().length > 0 && input.tagline.trim().length > 0;
}

/* ─── Response guards ───────────────────────────────────────────
   A payload that drifts is a failure state, never a dressed-up
   success: the parser returns null and the bench shows its
   error copy — the same discipline as the caption-styler seam. */

export interface SocialKitAsset {
  url: string | null;
  kind: string | null;
  label: string | null;
}

/** The POST answer: a non-empty asset list or it didn't happen
 *  (the panel throws on an empty list — so does the bench). */
export function socialKitAssetsOf(data: unknown): SocialKitAsset[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.assets) || d.assets.length === 0) return null;
  const out: SocialKitAsset[] = [];
  for (const a of d.assets) {
    if (!a || typeof a !== "object") continue;
    const asset = a as Record<string, unknown>;
    if (typeof asset.url !== "string" || asset.url.length === 0) continue;
    out.push({
      url: asset.url,
      kind: typeof asset.kind === "string" ? asset.kind : null,
      label: typeof asset.label === "string" ? asset.label : null,
    });
  }
  return out.length > 0 ? out : null;
}
