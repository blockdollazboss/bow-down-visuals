/* ─── Detector Desk in-world (stack1500 world parity wave #3, item 12) ──
   The AI Media Detector, native in the Create Wing, on the 2D
   /detector page's OWN rail — the exact endpoint pages/media-detector.tsx
   posts to (artifacts/api-server/src/routes/generate/media-detector.ts,
   mounted at /detect):

     POST /api/detect/media — 200 Visual Bucs (DETECTION_CREDITS in
       the route AND the page's CREDIT_COST badge agree at 200;
       registry row added by this wave, pinned by test to both).
       Four payload variants, exactly the page's four:
         · image file        → multipart FormData { file }
         · audio file        → multipart FormData { file,
                               audioMetadata: JSON { durationSec } }
         · video file        → JSON { frames: [3 JPEG data URLs
                               extracted client-side], fileName }
         · image URL         → JSON { mediaUrl }
       → { detection: { verdict: "likely_ai" | "likely_human" |
             "uncertain", confidence: 0–100, summary,
             signals: [{ name, description, severity:
             "low"|"medium"|"high", supportsAi }],
             frameNotes?: string[] },
           mediaKind, label, creditsCharged, disclaimer }

   The route charges before the analysis and refunds on failure
   server-side; a 402 reads as out-of-Visual-Bucs, never a mystery.

   SCOPE, HONESTLY: the page runs a multi-file batch queue; the
   desk runs ONE check at a time and keeps this sitting's results
   in a session history strip, labelled as such. Every rail
   variant the page offers is here — nothing about the analysis
   itself is reduced. The rails persist nothing (no history
   endpoint exists on either surface), so session-only is the
   truthful shape, same as the Movies Desk.

   Confirmation law: every run rides useConfirmedApi's
   confirmedFetch with the registry cost as the explicit override
   (the page rides the same override with its own constant, which
   the registry row now mirrors) — the spend confirmation stands
   BEFORE anything runs; a decline runs nothing. Members only —
   the route is requireAuth and the station is membersOnly,
   exactly the 2D boundary. */

export const DETECTOR_DESK_STATION_ID = "detector-desk";
export const DETECTOR_PATH = "/api/detect/media";

/* ─── Price — the registry row, verified against the page's +
 *  the route's constants; never invented ── */

import { getCreditCost } from "../credit-costs";

/** Registry cost for an endpoint; throws if unregistered so a desk
 *  can never silently show (or charge against) an invented price. */
function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

/** POST /api/detect/media — 200 VB (route DETECTION_CREDITS and
 *  the page's CREDIT_COST agree; env-overridable server-side as
 *  MEDIA_DETECTION_CREDIT_COST). */
export const DETECTOR_COST_VISUAL_BUCS = registryCost(DETECTOR_PATH);

/** The feature name the confirmation shows — the route's own
 *  charge-ledger action name, which the 2D page also passes as
 *  overrideFeature. */
export const DETECTOR_FEATURE = "AI Media Detection";

/* ─── The page's own kinds + bounds (verbatim) ───────────────────── */

export type DetectorMediaKind = "image" | "video" | "audio";
export type DetectorVerdict = "likely_ai" | "likely_human" | "uncertain";
export type DetectorSeverity = "low" | "medium" | "high";

/** media-detector.ts MAX_FILE_BYTES — the page skips bigger files
 *  before they ever reach the rail; the desk refuses them with
 *  the same limit, before any charge. */
export const DETECTOR_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** media-detector.ts MAX_FRAMES — the rail reads at most 3
 *  frames; the page extracts exactly FRAME_COUNT = 3. */
export const DETECTOR_FRAME_COUNT = 3;

/** The page's kindOf(file): mime-family decides the rail variant. */
export function detectorKindOfFile(file: { type: string }): DetectorMediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

/** The page's kindOfUrl: only image URLs ride the URL variant
 *  (the rail fetches the URL server-side and requires an image). */
export function detectorUrlIsImage(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(url);
}

/** A URL the desk will send: http(s) and image-shaped, the page's
 *  two gates (URL parse + kindOfUrl) in one. */
export function detectorUrlReady(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
  } catch {
    return false;
  }
  return detectorUrlIsImage(url);
}

/* ─── Payload shaping — the page's four posts, verbatim ──────────── */

/** The URL variant's body: { mediaUrl }. */
export function buildDetectUrlPayload(mediaUrl: string): Record<string, unknown> {
  return { mediaUrl: mediaUrl.trim() };
}

/** The video variant's body: { frames, fileName } — frames are
 *  the page's client-side JPEG extractions (start/middle/end). */
export function buildDetectFramesPayload(input: {
  frames: string[];
  fileName: string;
}): Record<string, unknown> {
  return {
    frames: input.frames.filter((f) => f.startsWith("data:image/")).slice(0, DETECTOR_FRAME_COUNT),
    fileName: input.fileName,
  };
}

/** The image variant's multipart body: the file alone. FormData
 *  is constructed here (not in the component) so the shape the
 *  desk sends is one pure, testable seam. */
export function buildDetectImageForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

/** The audio variant's multipart body: the file + the metadata
 *  JSON string field the rail parses ({ durationSec } — the only
 *  field the page's client-side reader produces). */
export function buildDetectAudioForm(file: File, audioMetadata: { durationSec?: number }): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("audioMetadata", JSON.stringify({ durationSec: audioMetadata.durationSec }));
  return form;
}

/* ─── Response guard — a payload that drifts is a failure state,
       never rows dressed as a result (the route refunds failures;
       an unusable body is treated as one by the desk). ─────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export interface DetectorSignal {
  name: string;
  description: string;
  severity: DetectorSeverity;
  supportsAi: boolean;
}

export interface DetectorResult {
  verdict: DetectorVerdict;
  confidence: number;
  summary: string;
  signals: DetectorSignal[];
  frameNotes: string[];
  mediaKind: DetectorMediaKind | "";
  label: string;
  disclaimer: string;
}

const VERDICTS: readonly string[] = ["likely_ai", "likely_human", "uncertain"];
const SEVERITIES: readonly string[] = ["low", "medium", "high"];
const KINDS: readonly string[] = ["image", "video", "audio"];

/** The detection out of a POST /api/detect/media answer
 *  ({ detection, mediaKind, label, creditsCharged, disclaimer }).
 *  The route itself rejects an invalid verdict before answering,
 *  so a drifted body here means the answer is unusable: verdict
 *  must be one of the three and a summary must exist, or the
 *  whole read is null. Signals missing their name are dropped,
 *  not dressed up; severity rides the rail's enum or "low". */
export function detectionResultOfResponse(raw: unknown): DetectorResult | null {
  if (!isRecord(raw)) return null;
  const d = raw["detection"];
  if (!isRecord(d)) return null;
  const verdict = str(d["verdict"]);
  if (!VERDICTS.includes(verdict)) return null;
  const summary = str(d["summary"]);
  if (!summary) return null;
  const signals: DetectorSignal[] = [];
  if (Array.isArray(d["signals"])) {
    for (const s of d["signals"]) {
      if (!isRecord(s)) continue;
      const name = str(s["name"]);
      if (!name) continue;
      const severity = str(s["severity"]);
      signals.push({
        name,
        description: str(s["description"]),
        severity: (SEVERITIES.includes(severity) ? severity : "low") as DetectorSeverity,
        supportsAi: s["supportsAi"] === true,
      });
    }
  }
  const frameNotes: string[] = [];
  if (Array.isArray(d["frameNotes"])) {
    for (const n of d["frameNotes"]) {
      const note = str(n);
      if (note) frameNotes.push(note);
    }
  }
  const mediaKind = str(raw["mediaKind"]);
  return {
    verdict: verdict as DetectorVerdict,
    confidence: Math.min(100, Math.max(0, Math.round(num(d["confidence"])))),
    summary,
    signals,
    frameNotes,
    mediaKind: (KINDS.includes(mediaKind) ? mediaKind : "") as DetectorMediaKind | "",
    label: str(raw["label"]),
    disclaimer: str(raw["disclaimer"]),
  };
}

/** The verdict's plain-words label — the page's three verdict
 *  lines (mediaDetector.verdictAi / verdictHuman /
 *  verdictUncertain) in the desk's own copy. */
export const DETECTOR_VERDICT_LABELS: Record<DetectorVerdict, string> = {
  likely_ai: "Likely AI-generated",
  likely_human: "Likely human-made",
  uncertain: "Uncertain — mixed evidence",
};

/* ─── Session history — this sitting's checks, newest first ──────── */

export interface DetectorHistoryEntry {
  /** The row's label: the file name or the URL checked. */
  label: string;
  kind: DetectorMediaKind | "";
  result: DetectorResult;
}

export const DETECTOR_HISTORY_LIMIT = 8;

/** Prepend a landed check, deduped on label, capped — the desk's
 *  "this session" strip. Session-only by design: the rail
 *  persists nothing (see the gap note at the top of this file),
 *  and the strip never claims otherwise. */
export function pushDetectorHistory(
  history: readonly DetectorHistoryEntry[],
  entry: DetectorHistoryEntry,
): DetectorHistoryEntry[] {
  return [entry, ...history.filter((e) => e.label !== entry.label)].slice(0, DETECTOR_HISTORY_LIMIT);
}
