import { getCreditCost } from "@/lib/credit-costs";

/* ─── Smart Reframe — Subject Tracking (client contract) ───────────────
   Pure helpers for the editor card that docks POST /api/auto-reframe
   into the Export tab. The route samples the clip with a person-matte
   detector and renders a crop path that follows the subject; when no
   subject can be followed it renders the plain centre crop and SAYS
   so in the response's `reframe` block. Everything the card renders
   about the outcome comes from that block — the labels here only map
   the server's reason codes onto i18n keys, never invent a cause. */

export const SUBJECT_REFRAME_ENDPOINT = "/api/auto-reframe";

export type SubjectReframeAspect = "16:9" | "9:16" | "1:1" | "4:5";

export interface SubjectReframeAspectSpec {
  key: SubjectReframeAspect;
  /** Output canvas — mirrors OUTPUT_SIZE in routes/generate/auto-reframe.ts. */
  width: number;
  height: number;
}

export const SUBJECT_REFRAME_ASPECTS: SubjectReframeAspectSpec[] = [
  { key: "16:9", width: 1920, height: 1080 },
  { key: "9:16", width: 1080, height: 1920 },
  { key: "1:1", width: 1080, height: 1080 },
  { key: "4:5", width: 1080, height: 1350 },
];

export function subjectReframeAspectSpec(
  key: SubjectReframeAspect,
): SubjectReframeAspectSpec {
  return SUBJECT_REFRAME_ASPECTS.find((a) => a.key === key) ?? SUBJECT_REFRAME_ASPECTS[1]!;
}

/**
 * The price the card shows and the confirmation dialog charges from —
 * read out of the central credit-cost registry (the client's single
 * copy of the number), never a second hardcoded copy here.
 */
export function subjectReframeCost(): number {
  return getCreditCost(SUBJECT_REFRAME_ENDPOINT)?.cost ?? 0;
}

/** Request body — matches the route's zod contract exactly. */
export function buildSubjectReframeBody(
  videoUrl: string,
  aspect: SubjectReframeAspect,
): { videoUrl: string; aspect: SubjectReframeAspect; trackSubject: true } {
  return { videoUrl, aspect, trackSubject: true };
}

export interface SubjectReframeInfo {
  mode: "subject-tracked" | "centre-crop";
  /** Server reason code when mode is "centre-crop"; null when tracked. */
  reason: string | null;
  samples: number;
  trackedSamples: number;
}

export interface SubjectReframeResult {
  url: string;
  storageRef: string;
  aspect: SubjectReframeAspect;
  creditsRemaining: number;
  reframe: SubjectReframeInfo;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Parse the route's success payload; null on anything malformed. */
export function parseSubjectReframeResult(data: unknown): SubjectReframeResult | null {
  if (!isRecord(data) || typeof data.url !== "string" || !data.url) return null;
  const rf = data.reframe;
  if (!isRecord(rf) || (rf.mode !== "subject-tracked" && rf.mode !== "centre-crop")) {
    return null;
  }
  const aspect = SUBJECT_REFRAME_ASPECTS.some((a) => a.key === data.aspect)
    ? (data.aspect as SubjectReframeAspect)
    : "9:16";
  return {
    url: data.url,
    storageRef: typeof data.storageRef === "string" ? data.storageRef : "",
    aspect,
    creditsRemaining: typeof data.creditsRemaining === "number" ? data.creditsRemaining : 0,
    reframe: {
      mode: rf.mode,
      reason: typeof rf.reason === "string" ? rf.reason : null,
      samples: typeof rf.samples === "number" ? rf.samples : 0,
      trackedSamples: typeof rf.trackedSamples === "number" ? rf.trackedSamples : 0,
    },
  };
}

/**
 * i18n key suffix for a centre-crop reason code, under
 * `videoEditor.subjectReframe.*`. Unknown codes return null — the card
 * then shows the generic centre-crop line with no specific cause
 * rather than guessing at one.
 */
export function subjectReframeReasonKey(reason: string | null): string | null {
  switch (reason) {
    case "no-subject":
      return "reasonNoSubject";
    case "no-samples":
      return "reasonNoSamples";
    case "low-confidence":
      return "reasonLowConfidence";
    case "low-coverage":
      return "reasonLowCoverage";
    case "tracker-unavailable":
      return "reasonTrackerUnavailable";
    case "tracking-off":
      return "reasonTrackingOff";
    default:
      return null;
  }
}
