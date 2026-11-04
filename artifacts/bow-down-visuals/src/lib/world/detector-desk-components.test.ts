/**
 * detector-desk-components — stack1500 world parity wave #3 item 12
 * source-contract pins. The Detector Desk (the census's ABSENT
 * `detector`) must exist as ONE native desk in the Create Wing:
 * - both input modes are present as focusable tabs (Image URL /
 *   Upload a file) with the file picker a real button + input,
 *   controller/keyboard navigable as native controls like every
 *   Create Wing desk;
 * - the verdict renders IN the panel — verdict + confidence,
 *   summary, the found signals, frame notes and the rail's own
 *   disclaimer — never a website pull-up of /detector;
 * - light/dark parity rides the desk's isLight branches like its
 *   sibling desks (every surface class pair is theme-switched).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/DetectorDesk.tsx");
const seam = read("./detector-desk.ts");

describe("both modes, focusable and complete", () => {
  it("mode tabs are real buttons with testids in a tablist", () => {
    expect(desk).toContain('data-testid={`world-detector-desk-mode-${key}`}');
    expect(desk).toContain('role="tablist"');
    expect(desk).toContain('"worldIdentityMisc.detModeUrl"');
    expect(desk).toContain('"worldIdentityMisc.detModeFile"');
  });

  it("the file picker is a hidden input + a real button, gated by the seam's kind/size gates", () => {
    expect(desk).toContain('data-testid="world-detector-desk-file-input"');
    expect(desk).toContain('data-testid="world-detector-desk-pick"');
    expect(desk).toContain('accept="image/*,video/*,audio/*"');
    expect(desk).toContain("detectorKindOfFile(picked)");
    expect(desk).toContain("DETECTOR_MAX_FILE_BYTES");
  });

  it("the run button is gated on the seam's readiness per mode", () => {
    expect(desk).toContain('data-testid="world-detector-desk-run"');
    expect(desk).toContain("disabled={busy || !ready}");
    expect(desk).toContain("detectorUrlReady(mediaUrl)");
    expect(desk).toContain("worldIdentityMisc.detRun");
  });

  it("video frames are extracted in-panel the page's way (3 frames, 640px, JPEG)", () => {
    expect(desk).toContain("extractVideoFrames");
    expect(desk).toContain("DETECTOR_FRAME_COUNT");
    expect(desk).toContain('canvas.toDataURL("image/jpeg", 0.8)');
    expect(desk).toContain("readAudioDuration");
  });
});

describe("results render in-panel — the full verdict package", () => {
  it("verdict, confidence bar, summary, signals, frame notes, disclaimer", () => {
    for (const needle of [
      'data-testid="world-detector-desk-result"',
      "t(VERDICT_LABEL_KEYS[result.verdict])",
      "worldIdentityMisc.detConfidence",
      "worldIdentityMisc.detSignalsTitle",
      "mediaDetector.pointsToAi",
      "mediaDetector.pointsToHuman",
      "worldIdentityMisc.detFrameNotes",
      "result.disclaimer",
      "worldIdentityMisc.detCheckAnother",
      "worldIdentityMisc.detSessionTitle",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the cost line prints the registry price before the run", () => {
    expect(desk).toContain('data-testid="world-detector-desk-cost"');
    expect(desk).toContain("DETECTOR_COST_VISUAL_BUCS.toLocaleString");
    expect(seam).toContain("registryCost(DETECTOR_PATH)");
  });

  it("402 reads as out-of-Visual-Bucs with the Treasury pointer, like its sibling desks", () => {
    expect(desk).toContain("out_of_credits");
    expect(desk).toContain("worldIdentityMisc.detOutOfCredits");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
