/**
 * detector-desk — stack1500 world parity wave #3 item 12 pins.
 *
 * The Detector Desk is the AI Media Detector's native form. These
 * pins hold: the station is wired into the Create Wing dispatch;
 * the price is the registry row AND the route's DETECTION_CREDITS
 * AND the page's CREDIT_COST (three sources, one number — a drift
 * in any one fails here first); the payload builders produce the
 * page's four rail variants exactly; the response guard accepts
 * only the rail's real success shape and treats drift as failure;
 * the session history dedupes and caps like the desk claims.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DETECTOR_COST_VISUAL_BUCS,
  DETECTOR_DESK_STATION_ID,
  DETECTOR_FEATURE,
  DETECTOR_FRAME_COUNT,
  DETECTOR_HISTORY_LIMIT,
  DETECTOR_MAX_FILE_BYTES,
  DETECTOR_PATH,
  DETECTOR_VERDICT_LABELS,
  buildDetectAudioForm,
  buildDetectFramesPayload,
  buildDetectImageForm,
  buildDetectUrlPayload,
  detectionResultOfResponse,
  detectorKindOfFile,
  detectorUrlIsImage,
  detectorUrlReady,
  pushDetectorHistory,
  type DetectorHistoryEntry,
  type DetectorResult,
} from "./detector-desk";
import { getCreditCost } from "../credit-costs";
import { STATION_BY_ID } from "./stations";
import { isCreateDeskId } from "./create-desks";

const routeSrc = readFileSync(
  new URL("../../../../api-server/src/routes/generate/media-detector.ts", import.meta.url),
  "utf8",
);
const pageSrc = readFileSync(
  new URL("../../pages/media-detector.tsx", import.meta.url),
  "utf8",
);

function deriveConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const ${name}[^=]*=\\s*(?:Number\\([^)]*\\)\\s*\\|\\|\\s*)?(?:getCreditCost\\([^)]*\\)\\s*\\?\\.\\s*cost\\s*\\?\\?\\s*)?(\\d+)`));
  if (!m) throw new Error(`could not derive ${name}`);
  return Number(m[1]);
}

describe("station wiring", () => {
  it("the station exists, native create pattern, members-only, /detector path", () => {
    const station = STATION_BY_ID.get(DETECTOR_DESK_STATION_ID);
    expect(station).toBeDefined();
    expect(station!.panel).toEqual({ kind: "native", pattern: "create" });
    expect(station!.membersOnly).toBe(true);
    expect(station!.websitePath).toBe("/detector");
    expect(isCreateDeskId(DETECTOR_DESK_STATION_ID)).toBe(true);
  });
});

describe("price — registry == route == page", () => {
  it("the registry row is the desk's cost", () => {
    expect(getCreditCost(DETECTOR_PATH)?.cost).toBe(DETECTOR_COST_VISUAL_BUCS);
  });

  it("route DETECTION_CREDITS and page CREDIT_COST agree at 200", () => {
    expect(deriveConst(routeSrc, "DETECTION_CREDITS")).toBe(200);
    expect(deriveConst(pageSrc, "CREDIT_COST")).toBe(200);
    expect(DETECTOR_COST_VISUAL_BUCS).toBe(200);
  });

  it("the feature label is the route's charge-ledger action", () => {
    expect(DETECTOR_FEATURE).toBe("AI Media Detection");
    expect(routeSrc).toContain('action: "AI Media Detection"');
  });

  it("the file bound matches the route's MAX_FILE_BYTES (25 MB)", () => {
    expect(DETECTOR_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(routeSrc).toContain("const MAX_FILE_BYTES = 25 * 1024 * 1024");
  });
});

describe("kind + URL gates (the page's own rules)", () => {
  it("mime family decides the kind; anything else is refused", () => {
    expect(detectorKindOfFile({ type: "image/png" })).toBe("image");
    expect(detectorKindOfFile({ type: "video/mp4" })).toBe("video");
    expect(detectorKindOfFile({ type: "audio/mpeg" })).toBe("audio");
    expect(detectorKindOfFile({ type: "application/pdf" })).toBeNull();
    expect(detectorKindOfFile({ type: "" })).toBeNull();
  });

  it("only image-shaped http(s) URLs are ready", () => {
    expect(detectorUrlIsImage("https://x.com/a.JPG")).toBe(true);
    expect(detectorUrlIsImage("https://x.com/a.webp?w=10")).toBe(true);
    expect(detectorUrlIsImage("https://x.com/a.mp4")).toBe(false);
    expect(detectorUrlReady(" https://x.com/a.png ")).toBe(true);
    expect(detectorUrlReady("https://x.com/a.mp4")).toBe(false);
    expect(detectorUrlReady("ftp://x.com/a.png")).toBe(false);
    expect(detectorUrlReady("not a url")).toBe(false);
    expect(detectorUrlReady("")).toBe(false);
  });
});

describe("payload builders — the page's four variants", () => {
  it("URL variant: { mediaUrl } trimmed", () => {
    expect(buildDetectUrlPayload("  https://x.com/a.png ")).toEqual({
      mediaUrl: "https://x.com/a.png",
    });
  });

  it("frames variant: data-image frames only, capped at the frame count", () => {
    const body = buildDetectFramesPayload({
      frames: [
        "data:image/jpeg;base64,a",
        "blob:nope",
        "data:image/png;base64,b",
        "data:image/jpeg;base64,c",
        "data:image/jpeg;base64,d",
      ],
      fileName: "clip.mp4",
    });
    expect(body).toEqual({
      frames: ["data:image/jpeg;base64,a", "data:image/png;base64,b", "data:image/jpeg;base64,c"],
      fileName: "clip.mp4",
    });
    expect(DETECTOR_FRAME_COUNT).toBe(3);
  });

  it("image variant: the file alone in the form", () => {
    const file = new File(["x"], "pic.png", { type: "image/png" });
    const form = buildDetectImageForm(file);
    expect(form.get("file")).toBe(file);
    expect(form.get("audioMetadata")).toBeNull();
  });

  it("audio variant: file + the audioMetadata JSON string the rail parses", () => {
    const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });
    const form = buildDetectAudioForm(file, { durationSec: 187.5 });
    expect(form.get("file")).toBe(file);
    expect(form.get("audioMetadata")).toBe(JSON.stringify({ durationSec: 187.5 }));
    expect(pageSrc).toContain("audioMetadata");
  });
});

const RESULT: DetectorResult = {
  verdict: "likely_ai",
  confidence: 87,
  summary: "Reads synthetic.",
  signals: [],
  frameNotes: [],
  mediaKind: "image",
  label: "pic.png",
  disclaimer: "A guide, not proof.",
};

function entry(label: string): DetectorHistoryEntry {
  return { label, kind: "image", result: RESULT };
}

describe("response guard — drift is failure, never a dressed-up result", () => {
  const good = {
    detection: {
      verdict: "likely_ai",
      confidence: 87.6,
      summary: "Reads synthetic.",
      signals: [
        { name: "Skin texture", description: "Too smooth.", severity: "high", supportsAi: true },
        { description: "nameless — dropped", severity: "high", supportsAi: true },
        { name: "Lighting", description: "", severity: "weird", supportsAi: false },
      ],
      frameNotes: ["Frame 2 warps.", 42, ""],
    },
    mediaKind: "image",
    label: "pic.png",
    creditsCharged: 200,
    disclaimer: "A guide, not proof.",
  };

  it("accepts the rail's shape; clamps confidence; drops nameless signals; severity falls back", () => {
    const r = detectionResultOfResponse(good);
    expect(r).not.toBeNull();
    expect(r!.confidence).toBe(88);
    expect(r!.signals).toHaveLength(2);
    expect(r!.signals[1]!.severity).toBe("low");
    expect(r!.signals[0]!.supportsAi).toBe(true);
    expect(r!.frameNotes).toEqual(["Frame 2 warps."]);
    expect(r!.mediaKind).toBe("image");
  });

  it("rejects a drifted verdict, a missing summary, a missing detection, non-objects", () => {
    expect(detectionResultOfResponse({ ...good, detection: { ...good.detection, verdict: "ai" } })).toBeNull();
    expect(detectionResultOfResponse({ ...good, detection: { ...good.detection, summary: "" } })).toBeNull();
    expect(detectionResultOfResponse({ mediaKind: "image" })).toBeNull();
    expect(detectionResultOfResponse(null)).toBeNull();
    expect(detectionResultOfResponse("likely_ai")).toBeNull();
  });

  it("an unknown mediaKind reads as the empty kind, not an invented one", () => {
    const r = detectionResultOfResponse({ ...good, mediaKind: "hologram" });
    expect(r!.mediaKind).toBe("");
  });

  it("the verdict labels are the desk's three plain lines", () => {
    expect(DETECTOR_VERDICT_LABELS).toEqual({
      likely_ai: "Likely AI-generated",
      likely_human: "Likely human-made",
      uncertain: "Uncertain — mixed evidence",
    });
  });
});

describe("session history", () => {
  it("prepends, dedupes on label, caps at the limit", () => {
    let h: DetectorHistoryEntry[] = [];
    h = pushDetectorHistory(h, entry("a.png"));
    h = pushDetectorHistory(h, entry("b.png"));
    h = pushDetectorHistory(h, entry("a.png"));
    expect(h.map((e) => e.label)).toEqual(["a.png", "b.png"]);
    for (let i = 0; i < 12; i++) h = pushDetectorHistory(h, entry(`f${i}.png`));
    expect(h).toHaveLength(DETECTOR_HISTORY_LIMIT);
    expect(DETECTOR_HISTORY_LIMIT).toBe(8);
  });
});
