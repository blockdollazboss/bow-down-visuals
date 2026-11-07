/**
 * repurpose-desk — the seam behind the My Studio board's
 * native Repurpose desk (stack200 world parity lane B1,
 * census item 4; the census counted the feature ABSENT — the
 * World's only "repurpose" hit was a promo-room order row).
 *
 * Source of truth: pages/repurpose.tsx (its Content Pack
 * mode) over artifacts/api-server/src/routes/generate/
 * repurpose.ts:
 *   POST /api/repurpose/analyze          multipart "video" (≤80 MB)
 *                                        or JSON { videoUrl }
 *   GET  /api/repurpose/jobs/:jobId      clips | thumbnails job
 *   POST /api/repurpose/reroll          { transcript, kind, durationSec }
 *   POST /api/repurpose/reroll-thumbnail { prompt }
 *
 * PRICES: the rails are NOT in the credit-cost registry — the
 * route's own env-overridable defaults are the price truth
 * (REPURPOSE_PACK_CREDITS 500, REPURPOSE_REROLL_CREDITS 100),
 * so the desk confirms through useConfirmedApi with these
 * constants as the override, and the tests pin the constants
 * to the route source (the create-desks pin idiom). The
 * page's own cost note interpolates the same two figures.
 *
 * Honesty rules, mirrored from the page:
 * - an analyze response without its analysis block is NOT a
 *   result — it parses to null and the desk shows the
 *   failure copy, never a half-built pack;
 * - malformed moments/captions inside a real analysis drop
 *   row by row; nothing is estimated or invented;
 * - a job is settled only at done/failed; clips and
 *   thumbnails flow into the hub project only from a DONE
 *   job, exactly like the page.
 *
 * Copy rides the page's own repurpose.* catalog keys; the
 * desk's few framing strings live in worldRepurposeDesk.*.
 */

export const REPURPOSE_ANALYZE_PATH = "/api/repurpose/analyze";
export const REPURPOSE_REROLL_PATH = "/api/repurpose/reroll";
export const REPURPOSE_REROLL_THUMBNAIL_PATH = "/api/repurpose/reroll-thumbnail";
export const REPURPOSE_MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const REPURPOSE_PACK_COST_VB = 500;
export const REPURPOSE_REROLL_COST_VB = 100;

export function repurposeJobPath(jobId: string): string {
  return `/api/repurpose/jobs/${encodeURIComponent(jobId)}`;
}

export type RepurposeRerollKind = "captions" | "descriptions" | "moments" | "thumbnailPrompts";

export interface RepurposeMoment {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
}

export interface RepurposeCaption {
  caption: string;
  hashtags: string[];
}

export interface RepurposeAnalysis {
  videoTitle: string;
  summary: string;
  moments: RepurposeMoment[];
  captions: RepurposeCaption[];
  descriptions: Record<string, string>;
  thumbnailPrompts: string[];
}

export interface RepurposePack {
  analysis: RepurposeAnalysis;
  videoRef: string | null;
  durationSec: number | null;
  transcript: string;
  clipJobId: string | null;
  thumbnailJobId: string | null;
}

export interface RepurposeClip {
  title: string;
  startSec: number;
  endSec: number;
  outputUrl: string;
}

export interface RepurposeThumb {
  imageUrl: string;
  prompt: string;
}

export interface RepurposeJob {
  jobId: string | null;
  kind: "clips" | "thumbnails" | null;
  status: "queued" | "processing" | "done" | "failed";
  clips: RepurposeClip[];
  thumbnails: RepurposeThumb[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function momentOf(row: unknown): RepurposeMoment | null {
  if (!isRecord(row)) return null;
  if (typeof row["id"] !== "string" || !row["id"]) return null;
  if (typeof row["title"] !== "string" || !row["title"]) return null;
  return {
    id: row["id"],
    startSec: num(row["startSec"]),
    endSec: num(row["endSec"]),
    title: row["title"],
    reason: str(row["reason"]),
    quote: str(row["quote"]),
  };
}

function captionOf(row: unknown): RepurposeCaption | null {
  if (!isRecord(row)) return null;
  if (typeof row["caption"] !== "string" || !row["caption"]) return null;
  const tags = Array.isArray(row["hashtags"])
    ? row["hashtags"].filter((h): h is string => typeof h === "string")
    : [];
  return { caption: row["caption"], hashtags: tags };
}

function analysisOf(raw: unknown): RepurposeAnalysis | null {
  if (!isRecord(raw)) return null;
  if (typeof raw["videoTitle"] !== "string" || typeof raw["summary"] !== "string") return null;
  const moments = Array.isArray(raw["moments"])
    ? raw["moments"].map(momentOf).filter((m): m is RepurposeMoment => m !== null)
    : [];
  const captions = Array.isArray(raw["captions"])
    ? raw["captions"].map(captionOf).filter((c): c is RepurposeCaption => c !== null)
    : [];
  const descriptions: Record<string, string> = {};
  if (isRecord(raw["descriptions"])) {
    for (const [k, v] of Object.entries(raw["descriptions"])) {
      if (typeof v === "string") descriptions[k] = v;
    }
  }
  const thumbnailPrompts = Array.isArray(raw["thumbnailPrompts"])
    ? raw["thumbnailPrompts"].filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  return {
    videoTitle: raw["videoTitle"],
    summary: raw["summary"],
    moments,
    captions,
    descriptions,
    thumbnailPrompts,
  };
}

/** The analyze result — null when the response carries no
 *  analysis block (an error body, a partial echo): the desk
 *  reads null as "the repurpose failed", never a half pack. */
export function repurposePackOf(data: unknown): RepurposePack | null {
  if (!isRecord(data)) return null;
  const analysis = analysisOf(data["analysis"]);
  if (!analysis) return null;
  return {
    analysis,
    videoRef: typeof data["videoRef"] === "string" ? data["videoRef"] : null,
    durationSec:
      typeof data["durationSec"] === "number" && Number.isFinite(data["durationSec"])
        ? data["durationSec"]
        : null,
    transcript: str(data["transcript"]),
    clipJobId: typeof data["clipJobId"] === "string" ? data["clipJobId"] : null,
    thumbnailJobId: typeof data["thumbnailJobId"] === "string" ? data["thumbnailJobId"] : null,
  };
}

/** One background job — a missing/garbled status reads as
 *  queued (still working), never as done: finished work is
 *  only ever claimed off a real "done". */
export function repurposeJobOf(data: unknown): RepurposeJob {
  const empty: RepurposeJob = { jobId: null, kind: null, status: "queued", clips: [], thumbnails: [] };
  if (!isRecord(data)) return empty;
  const status =
    data["status"] === "done" || data["status"] === "failed" || data["status"] === "processing"
      ? data["status"]
      : "queued";
  const clips: RepurposeClip[] = [];
  if (Array.isArray(data["clips"])) {
    for (const row of data["clips"]) {
      if (!isRecord(row)) continue;
      if (typeof row["outputUrl"] !== "string" || !row["outputUrl"]) continue;
      clips.push({
        title: str(row["title"]),
        startSec: num(row["startSec"]),
        endSec: num(row["endSec"]),
        outputUrl: row["outputUrl"],
      });
    }
  }
  const thumbnails: RepurposeThumb[] = [];
  if (Array.isArray(data["thumbnails"])) {
    for (const row of data["thumbnails"]) {
      if (!isRecord(row)) continue;
      if (typeof row["imageUrl"] !== "string" || !row["imageUrl"]) continue;
      thumbnails.push({ imageUrl: row["imageUrl"], prompt: str(row["prompt"]) });
    }
  }
  return {
    jobId: typeof data["jobId"] === "string" ? data["jobId"] : null,
    kind: data["kind"] === "clips" || data["kind"] === "thumbnails" ? data["kind"] : null,
    status,
    clips,
    thumbnails,
  };
}

export function isRepurposeJobSettled(status: RepurposeJob["status"]): boolean {
  return status === "done" || status === "failed";
}

/** The reroll body — the page's exact shape. */
export function buildRerollBody(
  kind: RepurposeRerollKind,
  transcript: string,
  durationSec: number | null,
): { transcript: string; kind: RepurposeRerollKind; durationSec: number } {
  return { transcript, kind, durationSec: durationSec ?? 0 };
}

/** The rerolled section off a reroll response — the page
 *  replaces the matching section with `result`; a kind whose
 *  result shape doesn't match parses to null (keep the old
 *  section, show the failure copy). */
export function rerollResultOf(
  kind: RepurposeRerollKind,
  data: unknown,
): RepurposeMoment[] | RepurposeCaption[] | Record<string, string> | string[] | null {
  if (!isRecord(data)) return null;
  const result = data["result"];
  if (kind === "moments") {
    if (!Array.isArray(result)) return null;
    return result.map(momentOf).filter((m): m is RepurposeMoment => m !== null);
  }
  if (kind === "captions") {
    if (!Array.isArray(result)) return null;
    return result.map(captionOf).filter((c): c is RepurposeCaption => c !== null);
  }
  if (kind === "descriptions") {
    if (!isRecord(result)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(result)) if (typeof v === "string") out[k] = v;
    return out;
  }
  if (!Array.isArray(result)) return null;
  return result.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** One re-rolled thumbnail's image off its response. */
export function rerolledThumbnailOf(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return typeof data["imageUrl"] === "string" && data["imageUrl"] ? data["imageUrl"] : null;
}

/** m:ss, the page's clip-range format. */
export function formatRepurposeTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
