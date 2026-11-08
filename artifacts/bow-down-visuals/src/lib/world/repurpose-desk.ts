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
 *
 * ── Stack 300 (items 94/95): the page's other two modes ──
 * The desk now carries all three of the page's modes. Stream
 * VOD (item 94) rides streamer-clips.ts:
 *   POST /api/streamer-clips/analyze   multipart "video" (≤80 MB)
 *                                      or JSON { videoUrl, clipLength,
 *                                      maxClips, vibe }
 *   POST /api/streamer-clips/cut       { videoRef, clips[] } → 202 jobId
 *   GET  /api/streamer-clips/cut/:id   the background cut job
 * Smart Clips (item 95) rides video-to-shorts.ts:
 *   POST /api/smart-clips/propose      { videoUrl, count, durationSec,
 *                                      query? } — FREE, renders nothing
 *   POST /api/smart-clips              { videoUrl, clips[] } — renders
 *                                      ONLY creator-approved windows
 * PRICES, read off the rails (never invented): analyze 300 VB
 * (STREAMER_CLIPS_ANALYZE_CREDITS env default — the rail is
 * ALSO in the credit registry at 300, so the desk's analyze
 * confirms through the registry exactly like the page's, no
 * override), cut 200 VB per clip (STREAMER_CLIPS_CUT_CREDITS
 * env default — the registry's flat 200 is per call, so the
 * desk confirms the page's per-clip total as the override,
 * exactly like the page), smart render 200 VB per clip
 * (SMART_CLIPS_PER_CLIP route constant — not in the registry,
 * override like the page). The tests pin these constants to
 * the route + registry sources. Smart propose is free, so it
 * rides a plain authed fetch exactly like the page.
 *
 * Honesty rules, mirrored from the page + rails:
 * - a stream analyze response with no usable highlights is a
 *   failure, never an empty success (the page throws the same
 *   way); malformed highlight rows drop one by one;
 * - a smart proposal's score is the model's or null — an
 *   energy pick NEVER gains a score here (the rail nulls it);
 * - NOTHING renders from a proposal the creator didn't keep:
 *   the render body is built only from kept, valid windows,
 *   and a kept window whose typed times don't parse or fall
 *   outside 5–120s is refused before anything is sent;
 * - a cut/render job is settled only at done/failed; cut
 *   clips flow into the hub project only from a DONE job.
 *
 * Copy rides the page's clipMaker.* / smartClips.* keys; the
 * desk's mode framing lives in worldRepurposeDesk.*.
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

/* ════════════════════════════════════════════════════════════
   Stream VOD mode (item 94) — the page's StreamVodClips over
   /api/streamer-clips. Same honesty discipline as the pack:
   strict parsers, finished work claimed only off a real done.
   ════════════════════════════════════════════════════════════ */

export const STREAM_ANALYZE_PATH = "/api/streamer-clips/analyze";
export const STREAM_CUT_PATH = "/api/streamer-clips/cut";
export const STREAM_ANALYZE_COST_VB = 300;
export const STREAM_CUT_COST_PER_CLIP_VB = 200;
export const STREAM_CLIP_LENGTHS = [15, 30, 60] as const;
export const STREAM_MAX_CLIPS = 8;

export type StreamVibe = "funny" | "hype" | "wholesome";
export const STREAM_VIBES: readonly StreamVibe[] = ["funny", "hype", "wholesome"];

export function streamCutJobPath(jobId: string): string {
  return `/api/streamer-clips/cut/${encodeURIComponent(jobId)}`;
}

export interface StreamHighlight {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
}

export interface StreamAnalysis {
  videoRef: string;
  durationSec: number | null;
  highlights: StreamHighlight[];
}

export interface StreamCutClip {
  title: string;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
}

export interface StreamCutJob {
  jobId: string | null;
  status: "queued" | "processing" | "done" | "failed";
  clips: StreamCutClip[];
  error: string | null;
}

function highlightOf(row: unknown): StreamHighlight | null {
  if (!isRecord(row)) return null;
  if (typeof row["id"] !== "string" || !row["id"]) return null;
  if (typeof row["title"] !== "string" || !row["title"]) return null;
  if (typeof row["startSec"] !== "number" || !Number.isFinite(row["startSec"])) return null;
  if (typeof row["endSec"] !== "number" || !Number.isFinite(row["endSec"])) return null;
  return {
    id: row["id"],
    startSec: row["startSec"],
    endSec: row["endSec"],
    title: row["title"],
    reason: str(row["reason"]),
    quote: str(row["quote"]),
  };
}

/** The stream analyze result — null when the response carries
 *  no usable videoRef or no usable highlights: the page treats
 *  an empty highlight list as a failed analysis, and so does
 *  the desk (never an empty success). */
export function streamAnalysisOf(data: unknown): StreamAnalysis | null {
  if (!isRecord(data)) return null;
  if (typeof data["videoRef"] !== "string" || !data["videoRef"]) return null;
  const highlights = Array.isArray(data["highlights"])
    ? data["highlights"].map(highlightOf).filter((h): h is StreamHighlight => h !== null)
    : [];
  if (highlights.length === 0) return null;
  return {
    videoRef: data["videoRef"],
    durationSec:
      typeof data["durationSec"] === "number" && Number.isFinite(data["durationSec"])
        ? data["durationSec"]
        : null,
    highlights,
  };
}

/** The cut body — the page's exact shape: the ref plus the
 *  selected highlights' windows and titles, in list order. */
export function buildStreamCutBody(
  videoRef: string,
  picks: StreamHighlight[],
): { videoRef: string; clips: Array<{ startSec: number; endSec: number; title: string }> } {
  return {
    videoRef,
    clips: picks.map((h) => ({ startSec: h.startSec, endSec: h.endSec, title: h.title })),
  };
}

/** One background cut job — the same settle discipline as the
 *  pack jobs: a garbled status reads as still working, clips
 *  without a rendered file stay null-output rows. */
export function streamCutJobOf(data: unknown): StreamCutJob {
  const empty: StreamCutJob = { jobId: null, status: "queued", clips: [], error: null };
  if (!isRecord(data)) return empty;
  const status =
    data["status"] === "done" || data["status"] === "failed" || data["status"] === "processing"
      ? data["status"]
      : "queued";
  const clips: StreamCutClip[] = [];
  if (Array.isArray(data["clips"])) {
    for (const row of data["clips"]) {
      if (!isRecord(row)) continue;
      clips.push({
        title: str(row["title"]),
        startSec: num(row["startSec"]),
        endSec: num(row["endSec"]),
        outputUrl: typeof row["outputUrl"] === "string" && row["outputUrl"] ? row["outputUrl"] : null,
      });
    }
  }
  return {
    jobId: typeof data["jobId"] === "string" ? data["jobId"] : null,
    status,
    clips,
    error: typeof data["error"] === "string" && data["error"] ? data["error"] : null,
  };
}

export function isStreamCutJobSettled(status: StreamCutJob["status"]): boolean {
  return status === "done" || status === "failed";
}

/* ════════════════════════════════════════════════════════════
   Smart Clips mode (item 95) — the page's SmartClipFinder over
   /api/smart-clips. Propose is free and renders nothing; the
   render body is built ONLY from windows the creator kept.
   ════════════════════════════════════════════════════════════ */

export const SMART_PROPOSE_PATH = "/api/smart-clips/propose";
export const SMART_RENDER_PATH = "/api/smart-clips";
export const SMART_RENDER_COST_PER_CLIP_VB = 200;
export const SMART_CLIP_LENGTHS = [15, 30, 45, 60] as const;
export const SMART_CLIP_COUNTS = [1, 2, 3, 4, 5] as const;
export const SMART_CLIP_MIN_SEC = 5;
export const SMART_CLIP_MAX_SEC = 120;

export type SmartMethod = "semantic" | "energy";
export type SmartAnalysisMethod = "semantic" | "mixed" | "energy";

export interface SmartProposal {
  startTime: number;
  endTime: number;
  title: string;
  score: number | null;
  reason: string;
  quote: string;
  method: SmartMethod;
}

/** A proposal as the creator edits it — the page's draft shape:
 *  kept or not, with start/end as mm:ss text (typing, not sliders). */
export interface SmartDraft extends SmartProposal {
  keep: boolean;
  startText: string;
  endText: string;
}

export interface SmartProposals {
  proposals: SmartProposal[];
  analysisMethod: SmartAnalysisMethod | null;
  durationSec: number | null;
}

export interface SmartClip {
  url: string;
  startTime: number;
  endTime: number;
  title: string;
  score: number | null;
  reason: string;
  quote: string;
  method: SmartMethod;
}

function smartScore(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function proposalOf(row: unknown): SmartProposal | null {
  if (!isRecord(row)) return null;
  if (typeof row["startTime"] !== "number" || !Number.isFinite(row["startTime"])) return null;
  if (typeof row["endTime"] !== "number" || !Number.isFinite(row["endTime"])) return null;
  return {
    startTime: row["startTime"],
    endTime: row["endTime"],
    title: str(row["title"]),
    /* The rail's honesty pin, kept: an energy pick's score is
       null — it never gains one on this side of the wire. */
    score: row["method"] === "energy" ? null : smartScore(row["score"]),
    reason: str(row["reason"]),
    quote: str(row["quote"]),
    method: row["method"] === "energy" ? "energy" : "semantic",
  };
}

/** The propose result — null when the response isn't a propose
 *  body at all. An EMPTY proposals list is a real answer (the
 *  rail found nothing readable) and parses to an empty set —
 *  the desk shows the page's no-proposals copy for it. */
export function smartProposalsOf(data: unknown): SmartProposals | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data["proposals"])) return null;
  const proposals = data["proposals"]
    .map(proposalOf)
    .filter((p): p is SmartProposal => p !== null);
  return {
    proposals,
    analysisMethod:
      data["analysisMethod"] === "semantic" ||
      data["analysisMethod"] === "mixed" ||
      data["analysisMethod"] === "energy"
        ? data["analysisMethod"]
        : null,
    durationSec:
      typeof data["durationSec"] === "number" && Number.isFinite(data["durationSec"])
        ? data["durationSec"]
        : null,
  };
}

/** A proposal fresh off the wire as an editable draft — kept,
 *  with its times in the page's mm:ss text form. */
export function smartDraftOf(p: SmartProposal): SmartDraft {
  return {
    ...p,
    keep: true,
    startText: formatRepurposeTime(p.startTime),
    endText: formatRepurposeTime(p.endTime),
  };
}

/** Parse "mm:ss" (or bare seconds) the creator typed; null when
 *  unreadable — the page's parser, verbatim semantics. */
export function parseSmartTimeText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const n = Number(parts[0]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (Number.isFinite(m) && Number.isFinite(s) && m >= 0 && s >= 0 && s < 60) {
      return m * 60 + s;
    }
  }
  return null;
}

/** The window a draft describes, or null when its times can't
 *  render (unreadable, or outside the rail's 5–120s window). */
export function smartDraftWindow(d: SmartDraft): { start: number; end: number } | null {
  const start = parseSmartTimeText(d.startText);
  const end = parseSmartTimeText(d.endText);
  if (start == null || end == null) return null;
  const len = end - start;
  if (len < SMART_CLIP_MIN_SEC || len > SMART_CLIP_MAX_SEC) return null;
  return { start, end };
}

/** The drafts that will actually render: kept AND valid. An
 *  unkept or invalid draft never reaches the render body —
 *  the server renders only what the creator approved. */
export function keptSmartDrafts(
  drafts: SmartDraft[],
): Array<{ draft: SmartDraft; window: { start: number; end: number } }> {
  const out: Array<{ draft: SmartDraft; window: { start: number; end: number } }> = [];
  for (const d of drafts) {
    if (!d.keep) continue;
    const w = smartDraftWindow(d);
    if (w) out.push({ draft: d, window: w });
  }
  return out;
}

/** The render body — the page's exact shape: the kept windows
 *  (rounded to tenths) with their approved labels riding along. */
export function buildSmartRenderBody(
  videoUrl: string,
  kept: Array<{ draft: SmartDraft; window: { start: number; end: number } }>,
): {
  videoUrl: string;
  clips: Array<{
    startTime: number;
    endTime: number;
    title: string;
    reason: string;
    quote: string;
    score: number | null;
    method: SmartMethod;
  }>;
} {
  return {
    videoUrl,
    clips: kept.map(({ draft, window }) => ({
      startTime: Math.round(window.start * 10) / 10,
      endTime: Math.round(window.end * 10) / 10,
      title: draft.title,
      reason: draft.reason,
      quote: draft.quote,
      score: draft.score,
      method: draft.method,
    })),
  };
}

function smartClipOf(row: unknown): SmartClip | null {
  if (!isRecord(row)) return null;
  if (typeof row["url"] !== "string" || !row["url"]) return null;
  return {
    url: row["url"],
    startTime: num(row["startTime"]),
    endTime: num(row["endTime"]),
    title: str(row["title"]),
    score: row["method"] === "energy" ? null : smartScore(row["score"]),
    reason: str(row["reason"]),
    quote: str(row["quote"]),
    method: row["method"] === "energy" ? "energy" : "semantic",
  };
}

/** The render result's clips — rows without a file drop; an
 *  absent clips list parses to an empty set (a failure body). */
export function smartClipsOf(data: unknown): SmartClip[] {
  if (!isRecord(data) || !Array.isArray(data["clips"])) return [];
  return data["clips"].map(smartClipOf).filter((c): c is SmartClip => c !== null);
}
