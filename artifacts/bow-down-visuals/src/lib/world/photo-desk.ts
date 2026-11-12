/* ─── Photo Desk bench family in-world (Stack 400 world parity,
   census Lane B items B-04 + B-23) ─────────────────────────────
   The Photo Studio family's own rails, native at the Photo Desk
   in the Create Wing. The 2D twins live in components/photo/
   (BgStudio + PhotoEnhance on /thumbnail-studio, HeadshotStudio
   + ProductPhotoStudio on /branding-kit) and ride:

     POST /api/remove-background   { imageUrl, aggressiveness }
       → { url, backgroundColor? }            200 Bucs (registry)
     POST /api/photo-backdrop      { prompt, provider, ratio }
       GET /api/photo-backdrop/status → { configured,
         nanoConfigured, ideogramConfigured }  100 Bucs (registry)
     POST /api/bg-generate         { prompt, style, idempotencyKey }
       GET /api/bg-generate/status  → { configured, creditCost,
         pricePlaceholder }                    200 Bucs (registry)
     POST /api/photo-enhance       { imageUrl, operations,
       strengths? } → { url, operations }      100 Bucs (registry)
     POST /api/generate-headshot   { mode, preset?, promptText?,
       model, referenceImageUrl } → { url }    100 Bucs (registry)
     POST /api/generate-product-photo { productImageUrl,
       productName, productKind, shotType, styleMode, scenePreset,
       customPrompt, model, ratio }
       → { status: "succeeded", url, path }    100 Bucs packshot /
       150 Bucs lifestyle (the page's own LIFESTYLE_CREDITS —
       owner-ratified Nov 7, 2026: product photo 100, lifestyle 150)

   Photo intake rides the family's own free upload door —
   POST /api/ai-page-designer/upload (multipart { file, kind },
   registry cost 0) — the exact door BgStudio and the profile
   setup page use, with BgStudio's own pick rules (image files,
   ≤ 5 MB).

   B-23's cartoonize mode (the Cover Art desk's artist-image
   bench) also lives here: the /cartoon-studio page's Cartoonize
   tab rides POST /api/generate-artist-image at 200 Bucs (the
   registry row) with the page's verbatim redraw prompt — the
   prompt builder below is byte-identical to the page's.

   Confirmation law: every charged call rides useConfirmedApi's
   confirmedFetch — the registry-priced spend confirmation shows
   BEFORE anything runs, a declined confirmation runs nothing,
   and status checks / the upload door are free (skipConfirm).
   Prices are read from the credit registry so the shown price
   can never drift from the confirmation's price. */
import { getCreditCost } from "../credit-costs";

/* ─── The shared photo intake (the family's free upload door) ── */

export const PHOTO_UPLOAD_PATH = "/api/ai-page-designer/upload";

/** POST /api/ai-page-designer/upload — registry 0 (free). */
export function photoUploadCost(): number {
  const entry = getCreditCost(PHOTO_UPLOAD_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PHOTO_UPLOAD_PATH}`);
  return entry.cost;
}

export const PHOTO_UPLOAD_KINDS = ["avatar", "banner", "background"] as const;
export type PhotoUploadKind = (typeof PHOTO_UPLOAD_KINDS)[number];

/** BgStudio's own ceiling on this door: 5 MB. */
export const PHOTO_INTAKE_MAX_BYTES = 5 * 1024 * 1024;

export type PhotoIntakeVerdict = "ok" | "not-image" | "too-large";

/** BgStudio's pickFile rules, shared by every desk bench that
 *  takes a photo: an image file, ≤ 5 MB. */
export function photoIntakeVerdict(file: { type: string; size: number }): PhotoIntakeVerdict {
  if (!file.type.startsWith("image/")) return "not-image";
  if (file.size > PHOTO_INTAKE_MAX_BYTES) return "too-large";
  return "ok";
}

/** The upload door's { url } — null when the payload drifts. */
export function photoUploadUrlOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const url = (data as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/* ─── Result readers shared across the family ────────────────── */

/** { url } off the sync image rails (remove-background,
 *  photo-backdrop, generate-headshot, photo-enhance) — null on
 *  drift so the bench shows its error copy, never a dressed-up
 *  empty result. */
export function photoResultUrlOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const url = (data as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** The server's error code on a response body, when it sent one. */
export function photoErrorCodeOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const code = (data as { code?: unknown; error?: unknown }).code ?? (data as { error?: unknown }).error;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/* ─── Remove Background (BgStudio step 2) ────────────────────── */

export const REMOVE_BACKGROUND_PATH = "/api/remove-background";

/** POST /api/remove-background — registry 200. */
export function removeBackgroundCost(): number {
  const entry = getCreditCost(REMOVE_BACKGROUND_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${REMOVE_BACKGROUND_PATH}`);
  return entry.cost;
}

export const REMOVE_BACKGROUND_DEFAULT_AGGRESSIVENESS = 0.5;

/** BgStudio's own post body, byte for byte. */
export function buildRemoveBackgroundPayload(imageUrl: string, aggressiveness: number) {
  return { imageUrl, aggressiveness };
}

/* ─── Photo Backdrop (BgStudio step 3, AI replace) ───────────── */

export const PHOTO_BACKDROP_PATH = "/api/photo-backdrop";
export const PHOTO_BACKDROP_STATUS_PATH = "/api/photo-backdrop/status";

/** POST /api/photo-backdrop — registry 100. */
export function photoBackdropCost(): number {
  const entry = getCreditCost(PHOTO_BACKDROP_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PHOTO_BACKDROP_PATH}`);
  return entry.cost;
}

export const BACKDROP_PROVIDERS = ["nano-banana-2.1", "ideogram-4.0"] as const;
export type BackdropProvider = (typeof BACKDROP_PROVIDERS)[number];

export const BACKDROP_RATIOS = ["1080:1080", "1080:1920", "1920:1080"] as const;
export type BackdropRatio = (typeof BACKDROP_RATIOS)[number];

/** BgStudio's closestRatio, verbatim: the backdrop renders at
 *  whichever candidate ratio sits nearest the source photo's own
 *  aspect (square default when no photo is loaded). */
export function closestBackdropRatio(w: number, h: number): BackdropRatio {
  if (!w || !h) return "1080:1080";
  const aspect = w / h;
  const candidates: Array<{ r: BackdropRatio; a: number }> = [
    { r: "1080:1920", a: 1080 / 1920 },
    { r: "1080:1080", a: 1 },
    { r: "1920:1080", a: 1920 / 1080 },
  ];
  return candidates.reduce((best, c) =>
    Math.abs(c.a - aspect) < Math.abs(best.a - aspect) ? c : best,
  ).r;
}

export interface BackdropStatus {
  configured: boolean;
  nanoConfigured: boolean;
  ideogramConfigured: boolean;
}

/** GET /api/photo-backdrop/status — null on drift. */
export function backdropStatusOf(data: unknown): BackdropStatus | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.configured !== "boolean") return null;
  return {
    configured: d.configured,
    nanoConfigured: d.nanoConfigured === true,
    ideogramConfigured: d.ideogramConfigured === true,
  };
}

/** BgStudio's provider pick: nano-banana first, ideogram when it
 *  is the only one wired. Null when neither is available. */
export function defaultBackdropProvider(status: BackdropStatus): BackdropProvider | null {
  if (status.nanoConfigured) return "nano-banana-2.1";
  if (status.ideogramConfigured) return "ideogram-4.0";
  return null;
}

/** BgStudio's own post body, byte for byte. */
export function buildPhotoBackdropPayload(prompt: string, provider: BackdropProvider, ratio: BackdropRatio) {
  return { prompt, provider, ratio };
}

/* ─── Background Plate (the editor's bg-generate rail) ───────── */

export const BG_GENERATE_PATH = "/api/bg-generate";
export const BG_GENERATE_STATUS_PATH = "/api/bg-generate/status";

/** POST /api/bg-generate — registry 200 (the status endpoint's
 *  own creditCost agrees; the bench confirms at the registry
 *  price like every other desk). */
export function bgGenerateCost(): number {
  const entry = getCreditCost(BG_GENERATE_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${BG_GENERATE_PATH}`);
  return entry.cost;
}

/** The editor section's style ids, verbatim. */
export const BG_GENERATE_STYLES = ["studio", "neon-city", "golden-palace", "beach-sunset"] as const;
export type BgGenerateStyle = (typeof BG_GENERATE_STYLES)[number];

/** The editor section's label key per style (its own catalog
 *  keys, ridden with their English defaultValues exactly as the
 *  section renders them). */
export const BG_GENERATE_STYLE_LABEL_KEYS: Record<BgGenerateStyle, string> = {
  studio: "wave9.bgReplace.ai.styleStudio",
  "neon-city": "wave9.bgReplace.ai.styleNeonCity",
  "golden-palace": "wave9.bgReplace.ai.styleGoldenPalace",
  "beach-sunset": "wave9.bgReplace.ai.styleBeachSunset",
};

export const BG_GENERATE_STYLE_DEFAULT_LABELS: Record<BgGenerateStyle, string> = {
  studio: "Studio",
  "neon-city": "Neon City",
  "golden-palace": "Golden Palace",
  "beach-sunset": "Beach Sunset",
};

/** The section's idempotency key, verbatim: minted once per
 *  user attempt and reused by that attempt's retries (no double
 *  charge); a fresh Generate click mints a new one. */
export function mintBgGenerateIdempotencyKey(now: number, random: number): string {
  return `bg-${now.toString(36)}-${random.toString(36).slice(2, 10)}`;
}

/** The section's own post body, byte for byte. */
export function buildBgGeneratePayload(prompt: string, style: BgGenerateStyle, idempotencyKey: string) {
  return { prompt, style, idempotencyKey };
}

export interface BgGenerateStatus {
  configured: boolean;
  creditCost: number;
}

/** GET /api/bg-generate/status — null on drift. */
export function bgGenerateStatusOf(data: unknown): BgGenerateStatus | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.configured !== "boolean") return null;
  return {
    configured: d.configured,
    creditCost: typeof d.creditCost === "number" ? d.creditCost : bgGenerateCost(),
  };
}

/** The plate rail answers { imageUrl } (not { url }). */
export function bgGenerateUrlOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const url = (data as { imageUrl?: unknown }).imageUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** A REPLAYED plate answer carries { replayed: true, replayNote }:
 *  the rail served the stored plate for an identical re-ask instead
 *  of charging again, and the note is the server's own explanation,
 *  read verbatim (server copy is the single source — the FE never
 *  writes its own version). A fresh answer carries neither field;
 *  any drift (flag without a note, note without the flag) yields
 *  null — no note shown. */
export function bgGenerateReplayNoteOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { replayed?: unknown; replayNote?: unknown };
  if (d.replayed !== true) return null;
  return typeof d.replayNote === "string" && d.replayNote.length > 0 ? d.replayNote : null;
}

/** The status gate's closed-door error code. */
export const BG_GENERATE_NOT_CONFIGURED_CODE = "BG_IMAGE_PROVIDER_NOT_CONFIGURED";

/* ─── Photo Enhance ──────────────────────────────────────────── */

export const PHOTO_ENHANCE_PATH = "/api/photo-enhance";

/** POST /api/photo-enhance — registry 100. */
export function photoEnhanceCost(): number {
  const entry = getCreditCost(PHOTO_ENHANCE_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PHOTO_ENHANCE_PATH}`);
  return entry.cost;
}

/** PhotoEnhance's op ids, verbatim. */
export const ENHANCE_OPS = ["upscale", "denoise", "restore", "colorize"] as const;
export type EnhanceOp = (typeof ENHANCE_OPS)[number];

/** The page's one-tap Autopilot set. */
export const AUTOPILOT_ENHANCE_OPS: readonly EnhanceOp[] = ["upscale", "denoise", "restore"];

/** PhotoEnhance's own post body: strengths ride only when the
 *  member shaped them in Advanced, one entry per chosen op. */
export function buildPhotoEnhancePayload(
  imageUrl: string,
  operations: readonly EnhanceOp[],
  strengths?: Partial<Record<EnhanceOp, number>> | null,
) {
  return {
    imageUrl,
    operations: [...operations],
    ...(strengths
      ? { strengths: Object.fromEntries(operations.map((o) => [o, strengths[o]])) }
      : {}),
  };
}

export interface EnhanceResult {
  url: string;
  operations: EnhanceOp[];
}

/** { url, operations } off the enhance rail — null on drift. */
export function enhanceResultOf(data: unknown, fallbackOps: readonly EnhanceOp[]): EnhanceResult | null {
  const url = photoResultUrlOf(data);
  if (!url) return null;
  const raw = (data as { operations?: unknown }).operations;
  const operations = Array.isArray(raw)
    ? raw.filter((o): o is EnhanceOp => (ENHANCE_OPS as readonly string[]).includes(o as string))
    : [];
  return { url, operations: operations.length > 0 ? operations : [...fallbackOps] };
}

/** The rail's honest not-connected error code. */
export const PHOTO_ENHANCE_NOT_CONNECTED_CODE = "photo_enhance_not_connected";

/* ─── Headshot ───────────────────────────────────────────────── */

export const HEADSHOT_PATH = "/api/generate-headshot";

/** POST /api/generate-headshot — registry 100. */
export function headshotCost(): number {
  const entry = getCreditCost(HEADSHOT_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${HEADSHOT_PATH}`);
  return entry.cost;
}

export const HEADSHOT_FLOWS = ["autopilot", "preset", "manual"] as const;
export type HeadshotFlow = (typeof HEADSHOT_FLOWS)[number];

export const HEADSHOT_PRESETS = ["studio", "stage", "street", "luxury"] as const;
export type HeadshotPreset = (typeof HEADSHOT_PRESETS)[number];

export const HEADSHOT_MODELS = ["nano-banana-2.1", "ideogram-4.0"] as const;
export type HeadshotModel = (typeof HEADSHOT_MODELS)[number];

export interface HeadshotInput {
  flow: HeadshotFlow;
  preset: HeadshotPreset;
  promptText: string;
  model: HeadshotModel;
  referenceImageUrl: string;
}

/** HeadshotStudio's own post body: preset rides only on the
 *  preset flow, promptText only on manual, the reference URL is
 *  null when the member gave none. */
export function buildHeadshotPayload(input: HeadshotInput) {
  return {
    mode: input.flow,
    preset: input.flow === "preset" ? input.preset : undefined,
    promptText: input.flow === "manual" ? input.promptText.trim() : undefined,
    model: input.model,
    referenceImageUrl: input.referenceImageUrl.trim() || null,
  };
}

/** The studio's provider-down verdict: HTTP 503 or the body's
 *  provider_not_connected code. */
export function isHeadshotProviderDown(status: number, data: unknown): boolean {
  return status === 503 || photoErrorCodeOf(data) === "provider_not_connected";
}

/* ─── Product Photo ──────────────────────────────────────────── */

export const PRODUCT_PHOTO_PATH = "/api/generate-product-photo";

/** The packshot price — registry 100. */
export function productPhotoPackshotCost(): number {
  const entry = getCreditCost(PRODUCT_PHOTO_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${PRODUCT_PHOTO_PATH}`);
  return entry.cost;
}

/** The lifestyle price — owner-ratified Nov 7, 2026 (product photo
 *  100 / lifestyle 150), read from the registry's own explicit
 *  lifestyle row (A-07 — owner ruling 2026-11-11), the same row
 *  ProductPhotoStudio's LIFESTYLE_CREDITS reads; the literal is
 *  only the fallback for a missing registry row. The lifestyle
 *  shot rides overrideCost exactly as the page does. */
export const PRODUCT_PHOTO_LIFESTYLE_COST = getCreditCost("/api/generate-product-photo?shotType=lifestyle")?.cost ?? 150;

export type ProductShotType = "packshot" | "lifestyle";

export function productPhotoCost(shotType: ProductShotType): number {
  return shotType === "lifestyle" ? PRODUCT_PHOTO_LIFESTYLE_COST : productPhotoPackshotCost();
}

export const PRODUCT_STYLE_MODES = ["autopilot", "presets", "custom"] as const;
export type ProductStyleMode = (typeof PRODUCT_STYLE_MODES)[number];

export const PRODUCT_MODELS = ["nano-banana-2.1", "ideogram-4.0"] as const;
export type ProductModel = (typeof PRODUCT_MODELS)[number];

export const PRODUCT_RATIOS = ["1080:1080", "1080:1920"] as const;
export type ProductRatio = (typeof PRODUCT_RATIOS)[number];

export const PRODUCT_KINDS = ["apparel", "drinkware", "jewelry", "poster", "accessory", "home", "other"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PACKSHOT_PRESETS = ["studio-white", "light-grey", "infinity-white"] as const;
export const LIFESTYLE_PRESETS = ["marble-luxe", "street-style", "golden-hour", "cozy-home"] as const;
export type ProductScenePreset = (typeof PACKSHOT_PRESETS)[number] | (typeof LIFESTYLE_PRESETS)[number];

export function productScenePresets(shotType: ProductShotType): readonly ProductScenePreset[] {
  return shotType === "lifestyle" ? LIFESTYLE_PRESETS : PACKSHOT_PRESETS;
}

export interface ProductPhotoInput {
  productImageUrl: string;
  productName: string;
  productKind: ProductKind;
  shotType: ProductShotType;
  styleMode: ProductStyleMode;
  scenePreset: ProductScenePreset;
  customPrompt: string;
  model: ProductModel;
  ratio: ProductRatio;
}

/** ProductPhotoStudio's own post body: kind rides only on
 *  autopilot, scenePreset only on presets, customPrompt only on
 *  custom — nulls exactly where the page sends nulls. */
export function buildProductPhotoPayload(input: ProductPhotoInput) {
  return {
    productImageUrl: input.productImageUrl.trim(),
    productName: input.productName.trim() || null,
    productKind: input.styleMode === "autopilot" ? input.productKind : null,
    shotType: input.shotType,
    styleMode: input.styleMode,
    scenePreset: input.styleMode === "presets" ? input.scenePreset : null,
    customPrompt: input.styleMode === "custom" ? input.customPrompt.trim() : null,
    model: input.model,
    ratio: input.ratio,
  };
}

export interface ProductPhotoResult {
  url: string;
  path: string | null;
}

/** The studio counts a shot landed only when the rail says
 *  status "succeeded" AND hands back a url. */
export function productPhotoResultOf(data: unknown): ProductPhotoResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { status?: unknown; url?: unknown; path?: unknown };
  if (d.status !== "succeeded") return null;
  const url = photoResultUrlOf(data);
  if (!url) return null;
  return { url, path: typeof d.path === "string" ? d.path : null };
}

/* ─── B-23: Cartoonize (the Cover Art bench's photo mode) ────── */

export const ARTIST_IMAGE_PATH = "/api/generate-artist-image";

/** POST /api/generate-artist-image — registry 200, the price the
 *  cartoonize confirmation shows (the page's IMAGE_COST). */
export function cartoonizeCost(): number {
  const entry = getCreditCost(ARTIST_IMAGE_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${ARTIST_IMAGE_PATH}`);
  return entry.cost;
}

/** The Cartoonize tab's fixed render model. */
export const CARTOONIZE_MODEL = "gen4_image";

/** The Cartoonize tab's own ceiling: 10 MB. */
export const CARTOONIZE_MAX_BYTES = 10 * 1024 * 1024;

export type CartoonizeFileVerdict = "ok" | "not-image" | "too-large";

/** The Cartoonize tab's pick rules: an image file, ≤ 10 MB. */
export function cartoonizeFileVerdict(file: { type: string; size: number }): CartoonizeFileVerdict {
  if (!file.type.startsWith("image/")) return "not-image";
  if (file.size > CARTOONIZE_MAX_BYTES) return "too-large";
  return "ok";
}

/** The Cartoonize tab's R2 key for the source photo, byte for
 *  byte (timestamp first, filename sanitized to [a-zA-Z0-9._-]). */
export function cartoonizeUploadKey(fileName: string, now: number): string {
  return `cartoon-studio-refs/${now}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

/** THE redraw prompt — verbatim from cartoon-studio.tsx's
 *  Cartoonize tab. The style direction comes from the picked
 *  STYLE_PRESETS entry; nothing else about the photo may change. */
export function cartoonizePrompt(styleDirection: string): string {
  return (
    `Redraw the attached photo as a cartoon in ${styleDirection}. ` +
    `Keep the same subject, pose, composition and likeness — only the art style changes. ` +
    `Clean bold cartoon finish, no photorealistic remnants.`
  );
}

/** The Cartoonize tab's own post body, byte for byte: the
 *  redraw prompt, the fixed gen4_image model, and the uploaded
 *  photo as the reference image. */
export function buildCartoonizePayload(referenceImageUrl: string, styleDirection: string) {
  return {
    promptText: cartoonizePrompt(styleDirection),
    model: CARTOONIZE_MODEL,
    referenceImageUrl,
  };
}
