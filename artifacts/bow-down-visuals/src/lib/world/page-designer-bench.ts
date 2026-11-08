/* ─── AI Page Designer bench in-world (Stack 400 world parity,
   census Lane B item B-05) ────────────────────────────────────
   The /artist-setup page designer's own rails, native at the
   in-World profile desk (the My Studio board, beside the
   creator-profile card):

     POST /api/ai-page-designer/theme  { vertical, vibe,
       displayName, palette, baseThemeId, regenerate }
       → { themeConfig, sections, rationale }   400 Bucs (registry)
     POST /api/ai-page-designer/bio    { vertical, displayName,
       facts } → { bio }                        100 Bucs (registry)
     POST /api/ai-page-designer/banner { vertical, vibe, palette }
       → { url }                                200 Bucs (registry)
     POST /api/ai-page-designer/upload (multipart { file, kind })
       → { url }                                  0 Bucs (registry)

   Applying a result rides the profile's own rail — PUT
   /api/creator-profiles/me with the exact patch shapes the 2D
   designer's onApply hands the setup page ({ vertical, theme_id,
   theme_config, sections, ai_design } for a design, { bio } for
   a bio, { banner_url } for a banner, { avatar_url } /
   { banner_url } for an upload) — never a second, invented
   apply path.

   Confirmation law: the three charged rails ride
   useConfirmedApi's confirmedFetch at their registry prices;
   the upload door is free (skipConfirm), exactly as on the 2D
   twins. The page's own gates ride along: vibe and bio facts
   each need a real sentence (trimmed length ≥ 10) before a
   charged call can start. */
import { getCreditCost } from "../credit-costs";

export const PAGE_DESIGNER_THEME_PATH = "/api/ai-page-designer/theme";
export const PAGE_DESIGNER_BIO_PATH = "/api/ai-page-designer/bio";
export const PAGE_DESIGNER_BANNER_PATH = "/api/ai-page-designer/banner";
export const PAGE_DESIGNER_UPLOAD_PATH = "/api/ai-page-designer/upload";
export const PROFILE_ME_PATH = "/api/creator-profiles/me";

/** POST /api/ai-page-designer/theme — registry 400. */
export function pageDesignerThemeCost(): number {
  const entry = getCreditCost(PAGE_DESIGNER_THEME_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PAGE_DESIGNER_THEME_PATH}`);
  return entry.cost;
}

/** POST /api/ai-page-designer/bio — registry 100. */
export function pageDesignerBioCost(): number {
  const entry = getCreditCost(PAGE_DESIGNER_BIO_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PAGE_DESIGNER_BIO_PATH}`);
  return entry.cost;
}

/** POST /api/ai-page-designer/banner — registry 200. */
export function pageDesignerBannerCost(): number {
  const entry = getCreditCost(PAGE_DESIGNER_BANNER_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PAGE_DESIGNER_BANNER_PATH}`);
  return entry.cost;
}

/** POST /api/ai-page-designer/upload — registry 0 (free). */
export function pageDesignerUploadCost(): number {
  const entry = getCreditCost(PAGE_DESIGNER_UPLOAD_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PAGE_DESIGNER_UPLOAD_PATH}`);
  return entry.cost;
}

/** The designer's own wording gates: a vibe or a facts paragraph
 *  under this trimmed length never reaches a charged rail. */
export const PAGE_DESIGNER_MIN_WORDING = 10;

export function pageDesignerWordingReady(text: string): boolean {
  return text.trim().length >= PAGE_DESIGNER_MIN_WORDING;
}

/** The designer's base-theme default when the profile has none. */
export const PAGE_DESIGNER_DEFAULT_BASE_THEME = "midnight-gold";

/** The designer's display-name fallback, verbatim. */
export const PAGE_DESIGNER_DEFAULT_DISPLAY_NAME = "Creator";

/* ─── Payload builders — the component's own post bodies ─────── */

export interface PageThemeInput {
  vertical: string;
  vibe: string;
  displayName: string;
  palette: string[];
  baseThemeId: string;
  regenerate: boolean;
}

/** The theme post body, byte for byte (vibe trimmed, display
 *  name falling back to the page's "Creator"). */
export function buildPageThemePayload(input: PageThemeInput) {
  return {
    vertical: input.vertical,
    vibe: input.vibe.trim(),
    displayName: input.displayName || PAGE_DESIGNER_DEFAULT_DISPLAY_NAME,
    palette: input.palette,
    baseThemeId: input.baseThemeId,
    regenerate: input.regenerate,
  };
}

export interface PageBioInput {
  vertical: string;
  displayName: string;
  facts: string;
}

/** The bio post body, byte for byte. */
export function buildPageBioPayload(input: PageBioInput) {
  return {
    vertical: input.vertical,
    displayName: input.displayName || PAGE_DESIGNER_DEFAULT_DISPLAY_NAME,
    facts: input.facts.trim(),
  };
}

export interface PageBannerInput {
  vertical: string;
  vibe: string;
  palette: string[];
}

/** The banner post body, byte for byte. */
export function buildPageBannerPayload(input: PageBannerInput) {
  return {
    vertical: input.vertical,
    vibe: input.vibe.trim(),
    palette: input.palette,
  };
}

/* ─── Response readers — null on drift, never dressed up ─────── */

export interface PageDesign {
  themeConfig: Record<string, unknown> & { themeId?: unknown };
  sections: unknown[];
  rationale: string;
}

/** { themeConfig, sections, rationale } off the theme rail — the
 *  apply step needs themeConfig.themeId, so a design without one
 *  is drift, not a design. */
export function pageDesignOf(data: unknown): PageDesign | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const themeConfig = d.themeConfig as Record<string, unknown> | null;
  if (!themeConfig || typeof themeConfig !== "object") return null;
  if (typeof themeConfig.themeId !== "string" || themeConfig.themeId.length === 0) return null;
  if (!Array.isArray(d.sections)) return null;
  return {
    themeConfig,
    sections: d.sections,
    rationale: typeof d.rationale === "string" ? d.rationale : "",
  };
}

/** { bio } off the bio rail. */
export function pageBioOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const bio = (data as { bio?: unknown }).bio;
  return typeof bio === "string" && bio.length > 0 ? bio : null;
}

/** { url } off the banner and upload rails. */
export function pageImageUrlOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const url = (data as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/* ─── The member's own profile, as the bench needs it ────────── */

export interface DesignerProfile {
  displayName: string;
  vertical: string;
  themeId: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  aiDesign: Record<string, unknown> | null;
}

/** GET /api/creator-profiles/me — the wire answer may be the bare
 *  profile or a { profile } wrap (the same two shapes the
 *  profile lib accepts). Null when there is no usable profile —
 *  the bench then shows its honest empty state instead of
 *  designing for nobody. */
export function designerProfileOf(data: unknown): DesignerProfile | null {
  if (!data || typeof data !== "object") return null;
  const wrapped = (data as { profile?: unknown }).profile;
  const p = (wrapped && typeof wrapped === "object" ? wrapped : data) as Record<string, unknown>;
  const displayName = typeof p.display_name === "string" ? p.display_name : "";
  const vertical = typeof p.vertical === "string" ? p.vertical : "";
  if (!displayName && !vertical) return null;
  return {
    displayName,
    vertical,
    themeId: typeof p.theme_id === "string" ? p.theme_id : null,
    avatarUrl: typeof p.avatar_url === "string" ? p.avatar_url : null,
    bannerUrl: typeof p.banner_url === "string" ? p.banner_url : null,
    bio: typeof p.bio === "string" ? p.bio : null,
    aiDesign:
      p.ai_design && typeof p.ai_design === "object" && !Array.isArray(p.ai_design)
        ? (p.ai_design as Record<string, unknown>)
        : null,
  };
}

/* ─── Apply patches — the designer's onApply shapes, verbatim ── */

export interface PageDesignApplyInput {
  vertical: string;
  design: PageDesign;
  vibe: string;
  palette: string[];
  existingAiDesign: Record<string, unknown> | null;
  designedAt: string;
}

/** applyDesign()'s patch: the design lands on the profile with
 *  its vibe, palette and rationale kept in ai_design. */
export function buildProfileDesignPatch(input: PageDesignApplyInput) {
  return {
    vertical: input.vertical,
    theme_id: input.design.themeConfig.themeId as string,
    theme_config: input.design.themeConfig,
    sections: input.design.sections,
    ai_design: {
      ...(input.existingAiDesign ?? {}),
      vibe: input.vibe,
      palette: input.palette,
      rationale: input.design.rationale,
      designedAt: input.designedAt,
    },
  };
}

/** The bio writer's apply patch. */
export function buildProfileBioPatch(bio: string) {
  return { bio };
}

/** The banner rail applies the moment the art lands. */
export function buildProfileBannerPatch(url: string) {
  return { banner_url: url };
}

/** An uploaded photo applies as the profile photo or the banner,
 *  by the door it came through. */
export function buildProfileUploadPatch(kind: "avatar" | "banner", url: string) {
  return kind === "avatar" ? { avatar_url: url } : { banner_url: url };
}
