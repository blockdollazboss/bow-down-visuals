/**
 * Pure pricing/plan resolution for the Runway clip generator.
 * Kept dependency-free so it can be unit-tested without the server.
 */

export type ClipModel = "gen4.5" | "seedance2_5" | "veo3_1";
export type ClipResolution = "720p" | "1080p";
/** The Seedance 2.5 ratios this route ever requests (incl. 480p drafts and
 *  the feed-format ratios: native square + nearest-3:4 for 4:5 delivery). */
export type SeedanceRatio =
  | "1280:720" | "720:1280" | "1920:1080" | "1080:1920" | "854:480" | "480:854"
  | "640:640" | "960:960" | "1440:1440"
  | "560:752" | "834:1112" | "1248:1664";
export const GEN45_CREDIT_COST = 400;
/* Resolution-aware Seedance 2.5 site-credit rates (credits per output second).
   Grounded in the Runway Dev API rate card (docs.dev.runwayml.com/guides/pricing):
   seedance2_5 bills 30 credits/sec at 720p and 68 credits/sec at 1080p, with API
   credits at $0.01 each, so provider cost is $0.30/sec (720p) / $0.68/sec (1080p).
   Reference images and audio are free on this route, and the site's pipeline
   uses image references only, so there is no input-video surcharge. At ~$0.50
   per site credit: 3/sec at 720p retails $1.50/sec = 5.0x margin; 6/sec at
   1080p retails $3.00/sec = ~4.4x margin. */
export const SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT = 300;
export const SEEDANCE_1080P_CREDITS_PER_SEC_DEFAULT = 600;
/* Draft mode: cheap 480p preview for iterating on a shot before committing to
   a full-res render. Mirrors Runway's own draft rate card (20 credits/sec for
   draft vs 30/sec at 720p and 68/sec at 1080p): draft is 2/3 the 720p rate,
   so 200/sec keeps the same ~5x margin as the 720p tier. The enhance step is
   just a re-submission at 1080p with the draft's seed, charged at the 1080p
   rate — no separate enhance tier needed. */
export const SEEDANCE_DRAFT_CREDITS_PER_SEC_DEFAULT = 200;
/** Legacy flat fallback (pre-resolution-aware pricing). Kept exported so old
    imports keep compiling; do not use for new code. */
export const SEEDANCE_CREDITS_PER_SEC_FALLBACK = 150;
export const SEEDANCE_MIN_DURATION_SEC = 3;
export const SEEDANCE_MAX_DURATION_SEC = 30;

/* ── Explicit approval gate ─────────────────────────────────────────────────
   The per-scene Seedance price above is a PROPOSAL until the user approves it.
   While SEEDANCE_PRICING_APPROVED is false, the server refuses every
   seedance2_5 submission BEFORE any Runway task is created, any credit is
   checked, or any pending task is tracked: nothing generates and nothing
   moves. Flip to true only after explicit user approval, in a reviewed commit
   — never as a drive-by. */
export const SEEDANCE_PRICING_APPROVED = true; // flipped 2026-09-25 after explicit user approval of 3/6 credits/sec
/** Bump when the proposed rates change, so an approval is tied to a version. */
export const SEEDANCE_PRICING_VERSION = "2026-09-25-resolution-aware";

/* ── Veo 3.1 (Google) — cinematic clips with native audio ───────────────────
   Provider cost is $0.40/sec at 720p (Standard). At ~$0.50 per site credit,
   400/sec retails $2.00/sec = 5.0x margin. Clips are fixed 8s (Veo's max and
   the only length allowed with reference images), so one clip = 3200 credits.
   Same GEMINI_API_KEY as Nano Banana — no separate credential. */
export const VEO_CREDITS_PER_SEC_DEFAULT = 400;
export const VEO_CLIP_DURATION_SEC = 8;
/* Explicit approval gate (same pattern as Seedance): the Veo price is a
   PROPOSAL until the user approves it. Flip to true only after explicit user
   approval, in a reviewed commit — never as a drive-by. */
export const VEO_PRICING_APPROVED = false;
export const VEO_PRICING_VERSION = "2026-10-11-veo3_1";

/* ── End-frame (last-frame) keyframe support, per model ────────────────────
   Grounded in the provider request builders vendored in this tree:
   - gen4.5 (@runwayml/sdk ImageToVideoCreateParams.Gen4_5): PromptImage
     `position` is 'first' ONLY — the model takes no last frame.
   - seedance2_5 (same SDK, Seedance2_5.PromptImage): `position` is
     'first' | 'last' — keyframe mode (positioned entries cannot be mixed
     with unpositioned reference images).
   - veo3_1 (lib/veo-client, Gemini predictLongRunning): the instance
     accepts a `lastFrame` next to the first-frame `image` — Veo 3.1's
     first/last-frame interpolation. A lone last frame is never accepted.
   The Scene Studio UI hides the end-frame control for unsupported models
   and the server never sends them the parameter. */
export const CLIP_END_FRAME_SUPPORT: Record<ClipModel, boolean> = {
  "gen4.5": false,
  seedance2_5: true,
  veo3_1: true,
};

export function modelSupportsEndFrame(model: ClipModel): boolean {
  return CLIP_END_FRAME_SUPPORT[model] === true;
}

/* ── Feed formats: square (1:1) + portrait feed (4:5) ──────────────────────
   Per-model native support, verified 2026-10-23 from the provider parameter
   shapes vendored in this tree (@runwayml/sdk 4.20.0 image-to-video.d.ts /
   text-to-video.d.ts, and lib/veo-client.ts):
   - gen4.5 image-to-video: ratio union includes "960:960" (native 1:1) and
     "832:1104" (3:4 — nearest to 4:5, NOT 4:5 itself).
   - gen4.5 text-to-video: ratio union is ONLY "1280:720" | "720:1280" —
     no square, no 4:5.
   - seedance2_5 (both modes, one union): native 1:1 at every tier
     (draft "640:640", 720p "960:960", 1080p "1440:1440"); NO exact 4:5 —
     nearest is 3:4 (draft "560:752", 720p "834:1112", 1080p "1248:1664").
   - veo3_1: aspectRatio is "16:9" | "9:16" only — neither feed format.
   HONEST FALLBACK (hard rule): where a model cannot emit the requested
   format natively, generation runs at the nearest supported ratio and the
   delivered clip is Smart-Reframed to the target; the delivery is labelled
   with an exact notice ("Generated wide, reframed to square") — never a
   silent crop, never labelled native. Format NEVER changes the price:
   credit cost is computed exactly as before for every ratio. */
export type ClipFormat = "16:9" | "9:16" | "1:1" | "4:5";
export type FormatDelivery = "native" | "reframe";

export const CLIP_FORMATS: { format: ClipFormat; label: string; blurb: string }[] = [
  { format: "16:9", label: "Wide", blurb: "YouTube, TV, widescreen players" },
  { format: "9:16", label: "Vertical", blurb: "TikTok, Reels, Shorts" },
  { format: "1:1", label: "Square", blurb: "Instagram / Facebook feed posts" },
  { format: "4:5", label: "Feed portrait", blurb: "Instagram / Facebook portrait feed" },
];

/** Client-facing pixel ratio for a format (720p-tier naming, as before). */
export const FORMAT_TO_RATIO: Record<ClipFormat, string> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1": "960:960",
  "4:5": "1080:1350",
};

/** Derive the requested format from a legacy/client ratio string. */
export function formatFromRatio(ratio?: string | null): ClipFormat {
  switch (ratio) {
    case "1280:720": case "1920:1080": return "16:9";
    case "960:960": case "1440:1440": case "640:640": return "1:1";
    case "1080:1350": case "864:1080": return "4:5";
    default: return "9:16";
  }
}

export interface FormatSupport {
  /** Exact provider ratio when the model emits the format natively, else null. */
  nativeRatio: string | null;
}

/** Native 1:1 / 4:5 support per model + mode (see verification note above). */
export function formatSupport(
  model: ClipModel,
  format: ClipFormat,
  opts: { hasImageRef?: boolean; resolution?: string; draft?: boolean } = {},
): FormatSupport {
  if (format === "16:9" || format === "9:16") return { nativeRatio: FORMAT_TO_RATIO[format] };
  if (model === "seedance2_5") {
    if (format === "1:1") {
      return { nativeRatio: opts.draft ? "640:640" : opts.resolution === "1080p" ? "1440:1440" : "960:960" };
    }
    return { nativeRatio: null }; // 4:5: nearest is 3:4, handled as reframe source
  }
  if (model === "gen4.5") {
    if (format === "1:1" && opts.hasImageRef) return { nativeRatio: "960:960" };
    return { nativeRatio: null };
  }
  return { nativeRatio: null }; // veo3_1
}

export interface FormatResolution {
  format: ClipFormat;
  delivery: FormatDelivery;
  /** Ratio actually sent to the provider (Runway pixel ratio, or Veo aspect). */
  providerRatio: string;
  /** Target aspect for the reframe step, when delivery is "reframe". */
  reframeTarget: "1:1" | "4:5" | null;
  /** Exact honest label for reframe deliveries; null when native. */
  notice: string | null;
}

function sourceWord(providerRatio: string): string {
  if (providerRatio === "1280:720" || providerRatio === "1920:1080" || providerRatio === "16:9") return "wide";
  if (providerRatio === "720:1280" || providerRatio === "1080:1920" || providerRatio === "9:16") return "vertical";
  return "in 3:4"; // 832:1104 / 834:1112 / 1248:1664 / 560:752 family
}

/**
 * Resolve how a requested format will actually be produced for a model.
 * Pure + unit-tested; the route uses this for the provider call, the POST
 * response, and the poll-time reframe decision — one source of truth.
 */
export function resolveFormatDelivery(opts: {
  model: ClipModel;
  format: ClipFormat;
  hasImageRef?: boolean;
  resolution?: string;
  draft?: boolean;
}): FormatResolution {
  const { model, format } = opts;
  if (format === "16:9" || format === "9:16") {
    return {
      format,
      delivery: "native",
      providerRatio: model === "veo3_1" ? format : FORMAT_TO_RATIO[format],
      reframeTarget: null,
      notice: null,
    };
  }
  const support = formatSupport(model, format, opts);
  if (support.nativeRatio) {
    return { format, delivery: "native", providerRatio: support.nativeRatio, reframeTarget: null, notice: null };
  }
  /* Fallback: nearest supported ratio, then Smart Reframe to the target. */
  let providerRatio: string;
  if (model === "seedance2_5") {
    providerRatio = opts.draft ? "560:752" : opts.resolution === "1080p" ? "1248:1664" : "834:1112";
  } else if (model === "gen4.5") {
    providerRatio = opts.hasImageRef ? "832:1104" : format === "4:5" ? "720:1280" : "1280:720";
  } else {
    providerRatio = format === "4:5" ? "9:16" : "16:9";
  }
  const targetWord = format === "1:1" ? "square" : "4:5";
  return {
    format,
    delivery: "reframe",
    providerRatio,
    reframeTarget: format,
    notice: `Generated ${sourceWord(providerRatio)}, reframed to ${targetWord}`,
  };
}

export interface ClipPlan {
  model: ClipModel;
  useSeedance: boolean;
  /** True for the Google Veo 3.1 path. */
  useVeo: boolean;
  /** True when this plan is a cheap 480p draft preview. */
  isDraft: boolean;
  /** Resolved clip length in seconds (5 for gen4.5, clamped 3–30 for seedance, fixed 8 for Veo). */
  durationSec: number;
  /** Site credits charged on success. */
  creditCost: number;
  /** Runway ratio string for the requested orientation + resolution tier. */
  seedanceRatio: SeedanceRatio;
  /** Requested output format (16:9 / 9:16 / 1:1 square / 4:5 feed portrait). */
  format: ClipFormat;
  /** How the format is produced: emitted natively, or nearest-ratio + reframe. */
  formatDelivery: FormatDelivery;
  /** Provider ratio for the gen4.5 path (seedance uses seedanceRatio, Veo its aspect). */
  gen45Ratio: string;
  /** Exact honest label when formatDelivery is "reframe"; null when native. */
  formatNotice: string | null;
  /** False until the user approves the Seedance price (explicit gate). */
  pricingApproved: boolean;
  /** False until the user approves the Veo price (explicit gate). */
  veoPricingApproved: boolean;
}

export function resolveClipPlan(opts: {
  model?: string;
  durationSec?: number | string;
  resolution?: string;
  ratio?: string;
  creditsPerSec720p?: number;
  creditsPerSec1080p?: number;
  creditsPerSecDraft?: number;
  creditsPerSecVeo?: number;
  /** Draft mode: cheap 480p preview. Only valid for seedance2_5. */
  draft?: boolean;
  /** Requested feed format; wins over `ratio` when present. */
  format?: string;
  /** Whether the generation will carry a reference image (gen4.5 native
   *  square exists only in image-to-video). Callers that resolve references
   *  after planning should re-resolve via resolveFormatDelivery. */
  hasImageRef?: boolean;
}): ClipPlan {
  const useSeedance = opts.model === "seedance2_5";
  const useVeo = opts.model === "veo3_1";
  const isDraft = useSeedance && opts.draft === true;
  const format: ClipFormat =
    opts.format === "1:1" || opts.format === "4:5" || opts.format === "16:9" || opts.format === "9:16"
      ? opts.format
      : formatFromRatio(opts.ratio);
  const landscape = format === "16:9";
  const hiRes = opts.resolution === "1080p" && !isDraft;
  const creditsPerSec = useVeo
    ? Number(opts.creditsPerSecVeo) || VEO_CREDITS_PER_SEC_DEFAULT
    : isDraft
    ? Number(opts.creditsPerSecDraft) || SEEDANCE_DRAFT_CREDITS_PER_SEC_DEFAULT
    : hiRes
    ? Number(opts.creditsPerSec1080p) || SEEDANCE_1080P_CREDITS_PER_SEC_DEFAULT
    : Number(opts.creditsPerSec720p) || SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT;
  const durationSec = useVeo
    ? VEO_CLIP_DURATION_SEC
    : useSeedance
    ? Math.min(
        SEEDANCE_MAX_DURATION_SEC,
        Math.max(SEEDANCE_MIN_DURATION_SEC, Math.round(Number(opts.durationSec) || 5)),
      )
    : 5;
  const creditCost = useVeo || useSeedance ? Math.ceil(durationSec * creditsPerSec) : GEN45_CREDIT_COST;
  const model: ClipModel = useVeo ? "veo3_1" : useSeedance ? "seedance2_5" : "gen4.5";
  const fmt = resolveFormatDelivery({
    model,
    format,
    hasImageRef: opts.hasImageRef,
    resolution: opts.resolution,
    draft: isDraft,
  });
  const seedanceRatio: SeedanceRatio =
    format === "1:1" || format === "4:5"
      ? (fmt.providerRatio as SeedanceRatio)
      : landscape
        ? isDraft ? "854:480" : hiRes ? "1920:1080" : "1280:720"
        : isDraft ? "480:854" : hiRes ? "1080:1920" : "720:1280";
  return {
    model,
    useSeedance,
    useVeo,
    isDraft,
    durationSec,
    creditCost,
    seedanceRatio,
    format,
    formatDelivery: fmt.delivery,
    gen45Ratio: fmt.providerRatio,
    formatNotice: fmt.notice,
    pricingApproved: SEEDANCE_PRICING_APPROVED,
    veoPricingApproved: VEO_PRICING_APPROVED,
  };
}
