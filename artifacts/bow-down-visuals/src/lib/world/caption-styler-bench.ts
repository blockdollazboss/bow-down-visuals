/* ─── Caption Styler bench in-world (Stack 300 world parity,
   census Lane B item 7 / manifest item 100) ─────────────────────
   The /caption-styler page's own rail, native at the Hook Desk —
   the Hooks page's "styler" tab (pages/hooks.tsx) cross-links
   here as the burned-in captions home, and the page's rail is:

     POST /api/caption-styler  (multipart: video + style +
       position + fontSize + withEmoji)
       → { jobId, status, creditsRemaining }
       300 Visual Bucs — the credit registry's
       "/api/caption-styler" entry (the route's own charge and
       the 2D page's CREDIT_COST agree); the bench reads the
       registry, so the shown price can never drift from the
       confirmation's price.
     GET  /api/caption-styler/:jobId
       → { status, outputUrl, error, message }
       The server-owned job: queued → transcribing → rendering
       → done | failed. A failed job is refunded server-side —
       the page's own error copy says so (captionStyler.
       errorJobFailed) and the bench renders that same copy.

   Confirmation law: the start post rides useConfirmedApi's
   confirmedFetch — the registry-priced spend confirmation
   shows BEFORE anything uploads, a declined confirmation
   runs nothing, and polling the job afterwards is free.
   The finished video flows into the hub project exactly as
   the page's does (addAsset on done).

   Copy rides the page's own catalog namespace (captionStyler.*)
   so the bench's labels can never drift from the page's. */
import { getCreditCost } from "../credit-costs";

export const CAPTION_STYLER_PATH = "/api/caption-styler";

/** The job-status poll path for a started job. */
export function captionStylerJobPath(jobId: string): string {
  return `${CAPTION_STYLER_PATH}/${encodeURIComponent(jobId)}`;
}

/** POST /api/caption-styler — registry 300, the route's charge
 *  and the 2D page's CREDIT_COST agree. */
export function captionStylerCost(): number {
  const entry = getCreditCost(CAPTION_STYLER_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${CAPTION_STYLER_PATH}`);
  return entry.cost;
}

/* ─── The page's own enums (verbatim from caption-styler.tsx) ── */

export const CAPTION_STYLER_STYLES = ["hormozi", "minimal", "karaoke", "neon", "luxury-gold"] as const;
export type CaptionStylerStyle = (typeof CAPTION_STYLER_STYLES)[number];

/** The catalog label key segment per style (the page's
 *  STYLE_LABEL_KEYS — "luxury-gold" labels under luxuryGold). */
export const CAPTION_STYLER_STYLE_LABEL_KEYS: Record<CaptionStylerStyle, string> = {
  hormozi: "hormozi",
  minimal: "minimal",
  karaoke: "karaoke",
  neon: "neon",
  "luxury-gold": "luxuryGold",
};

export const CAPTION_STYLER_POSITIONS = ["top", "middle", "bottom"] as const;
export type CaptionStylerPosition = (typeof CAPTION_STYLER_POSITIONS)[number];

export const CAPTION_STYLER_FONT_SIZES = ["small", "medium", "large"] as const;
export type CaptionStylerFontSize = (typeof CAPTION_STYLER_FONT_SIZES)[number];

/** The page's upload ceiling: 80 MB, member and admin alike on
 *  this rail (captionStyler.errorTooLarge states it). */
export const CAPTION_STYLER_MAX_BYTES = 80 * 1024 * 1024;

export type CaptionStylerFileVerdict = "ok" | "not-video" | "too-large";

/** The page's pickFile rules, shared: a video file, ≤ 80 MB. */
export function captionStylerFileVerdict(file: { type: string; size: number }): CaptionStylerFileVerdict {
  if (!file.type.startsWith("video/")) return "not-video";
  if (file.size > CAPTION_STYLER_MAX_BYTES) return "too-large";
  return "ok";
}

/* ─── Form shaping — mirrors the page's startStyling post ────── */

export interface CaptionStylerInput {
  style: CaptionStylerStyle;
  position: CaptionStylerPosition;
  fontSize: CaptionStylerFontSize;
  withEmoji: boolean;
}

/** The multipart fields after the video itself, in the page's
 *  own append order. */
export function captionStylerFormFields(input: CaptionStylerInput): Array<[string, string]> {
  return [
    ["style", input.style],
    ["position", input.position],
    ["fontSize", input.fontSize],
    ["withEmoji", input.withEmoji ? "true" : "false"],
  ];
}

/* ─── Job states + response guards ───────────────────────────────
   A payload that drifts is a failure state, never a dressed-up
   status: the parsers return null and the bench shows its
   error copy — the same discipline as the radar seam. */

export const CAPTION_STYLER_POLL_STATUSES = ["queued", "transcribing", "rendering"] as const;
export type CaptionStylerBusyStatus = (typeof CAPTION_STYLER_POLL_STATUSES)[number];
export type CaptionStylerJobStatus = CaptionStylerBusyStatus | "done" | "failed";

export function isCaptionStylerBusyStatus(status: string): status is CaptionStylerBusyStatus {
  return (CAPTION_STYLER_POLL_STATUSES as readonly string[]).includes(status);
}

export interface CaptionStylerStartedJob {
  jobId: string;
  status: string;
  creditsRemaining: number | null;
}

/** The POST answer: a job id or it didn't start. */
export function captionStylerStartedOf(data: unknown): CaptionStylerStartedJob | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.jobId !== "string" || d.jobId.length === 0) return null;
  return {
    jobId: d.jobId,
    status: typeof d.status === "string" ? d.status : "queued",
    creditsRemaining: typeof d.creditsRemaining === "number" ? d.creditsRemaining : null,
  };
}

export interface CaptionStylerJob {
  status: CaptionStylerJobStatus;
  outputUrl: string | null;
}

/** The poll answer: one of the job's real statuses, with the
 *  finished video's URL on done. Unknown statuses parse to
 *  null — the bench fails honestly instead of spinning. */
export function captionStylerJobOf(data: unknown): CaptionStylerJob | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.status !== "string") return null;
  if (d.status === "done") {
    return { status: "done", outputUrl: typeof d.outputUrl === "string" ? d.outputUrl : null };
  }
  if (d.status === "failed") return { status: "failed", outputUrl: null };
  if (isCaptionStylerBusyStatus(d.status)) return { status: d.status, outputUrl: null };
  return null;
}
