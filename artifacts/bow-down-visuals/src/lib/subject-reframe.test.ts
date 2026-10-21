import { describe, expect, it } from "vitest";
import { getCreditCost } from "./credit-costs";
import {
  SUBJECT_REFRAME_ASPECTS,
  SUBJECT_REFRAME_ENDPOINT,
  buildSubjectReframeBody,
  parseSubjectReframeResult,
  subjectReframeAspectSpec,
  subjectReframeCost,
  subjectReframeReasonKey,
} from "./subject-reframe";

/**
 * Smart Reframe — Subject Tracking (POST /api/auto-reframe), client
 * contract pins. The route's own contract (verified in
 * routes/generate/auto-reframe.ts): body { videoUrl, aspect,
 * trackSubject? }, aspects 16:9 / 9:16 / 1:1 / 4:5, charge 200 VB via
 * the REFRAME_CREDITS rail, success payload carries the `reframe`
 * honesty block. These tests pin the client side of that contract so
 * the card can never drift from the route it calls.
 */
describe("subject reframe client contract", () => {
  it("targets the auto-reframe route the API actually mounts", () => {
    expect(SUBJECT_REFRAME_ENDPOINT).toBe("/api/auto-reframe");
  });

  it("offers exactly the four aspects the route accepts, with the route's output sizes", () => {
    expect(SUBJECT_REFRAME_ASPECTS.map((a) => a.key)).toEqual(["16:9", "9:16", "1:1", "4:5"]);
    expect(SUBJECT_REFRAME_ASPECTS.map((a) => [a.width, a.height])).toEqual([
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [1080, 1350],
    ]);
    expect(subjectReframeAspectSpec("4:5")).toEqual({ key: "4:5", width: 1080, height: 1350 });
  });

  it("reads the price from the central registry — one copy of the number, matching the route's 200 VB", () => {
    const entry = getCreditCost(SUBJECT_REFRAME_ENDPOINT);
    expect(entry).not.toBeNull();
    expect(entry!.cost).toBe(200);
    expect(subjectReframeCost()).toBe(200);
  });

  it("builds the exact request body the route's schema expects, tracking always on", () => {
    expect(buildSubjectReframeBody("https://cdn.example/clip.mp4", "9:16")).toEqual({
      videoUrl: "https://cdn.example/clip.mp4",
      aspect: "9:16",
      trackSubject: true,
    });
  });

  it("parses a subject-tracked success payload", () => {
    const parsed = parseSubjectReframeResult({
      url: "https://cdn.example/out.mp4",
      storageRef: "generated-clips/out.mp4",
      aspect: "9:16",
      creditsRemaining: 86085,
      reframe: { mode: "subject-tracked", reason: null, samples: 36, trackedSamples: 34 },
    });
    expect(parsed).toEqual({
      url: "https://cdn.example/out.mp4",
      storageRef: "generated-clips/out.mp4",
      aspect: "9:16",
      creditsRemaining: 86085,
      reframe: { mode: "subject-tracked", reason: null, samples: 36, trackedSamples: 34 },
    });
  });

  it("parses a centre-crop fallback payload keeping the server's reason code", () => {
    const parsed = parseSubjectReframeResult({
      url: "https://cdn.example/out.mp4",
      storageRef: "generated-clips/out.mp4",
      aspect: "1:1",
      creditsRemaining: 86085,
      reframe: { mode: "centre-crop", reason: "no-subject", samples: 36, trackedSamples: 0 },
    });
    expect(parsed?.reframe.mode).toBe("centre-crop");
    expect(parsed?.reframe.reason).toBe("no-subject");
  });

  it("rejects malformed payloads instead of rendering a fake result", () => {
    expect(parseSubjectReframeResult(null)).toBeNull();
    expect(parseSubjectReframeResult({})).toBeNull();
    expect(parseSubjectReframeResult({ url: "" })).toBeNull();
    expect(
      parseSubjectReframeResult({ url: "https://x/y.mp4", reframe: { mode: "magic" } }),
    ).toBeNull();
    expect(parseSubjectReframeResult({ url: "https://x/y.mp4" })).toBeNull();
  });

  it("maps every server reason code to its i18n key — and unknown codes to no invented cause", () => {
    expect(subjectReframeReasonKey("no-subject")).toBe("reasonNoSubject");
    expect(subjectReframeReasonKey("no-samples")).toBe("reasonNoSamples");
    expect(subjectReframeReasonKey("low-confidence")).toBe("reasonLowConfidence");
    expect(subjectReframeReasonKey("low-coverage")).toBe("reasonLowCoverage");
    expect(subjectReframeReasonKey("tracker-unavailable")).toBe("reasonTrackerUnavailable");
    expect(subjectReframeReasonKey("tracking-off")).toBe("reasonTrackingOff");
    expect(subjectReframeReasonKey("some-future-code")).toBeNull();
    expect(subjectReframeReasonKey(null)).toBeNull();
  });
});
