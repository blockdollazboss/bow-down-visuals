/**
 * final-video-export-pro-finish.test.ts — Pro Finishing Door wiring pins.
 *
 * The render/JSX behavior can't mount in this node-only harness, so the
 * component contract is pinned by source (the pattern established by
 * site-mode-theme.test.ts / enter-world-button.test.ts):
 *  (a) the Quality panel offers the two pro codecs beside H.264 and
 *      forces MOV when one is picked;
 *  (b) the chosen codec rides the quality export request and the estimate;
 *  (c) the FCPXML download is docked in the export surface and built from
 *      the editor's timeline model (scene timings / manual placements,
 *      ClipEdit trims, Pro Tools speed) via lib/fcpxml-export.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(join(__dirname, "FinalVideoExport.tsx"), "utf8");

describe("FinalVideoExport — Pro Finishing Door", () => {
  it("offers H.264 / ProRes / DNxHR in the Quality panel", () => {
    expect(component).toContain("data-testid={`quality-codec-${c}`}");
    expect(component).toContain(`(["h264", "prores", "dnxhr"] as const)`);
    expect(component).toContain(`codecDisplayLabel`);
    expect(component).toContain("ProRes 422 HQ");
    expect(component).toContain("DNxHR HQ");
  });

  it("forces MOV when a pro codec is picked, and disables MP4", () => {
    expect(component).toContain(`if (c !== "h264") setQContainer("mov");`);
    expect(component).toContain(`disabled={qCodec !== "h264" && c === "mp4"}`);
    expect(component).toContain("Pro codecs deliver as MOV.");
  });

  it("sends the codec on the quality export and the live estimate", () => {
    expect(component).toContain("codec: qualityOpts.codec,");
    expect(component).toContain("codec: qCodec,");
    expect(component).toContain("qContainer, qCodec, hasAudio, aspectRatio, estimateDurationSec");
  });

  it("docks the FCPXML download in the export surface", () => {
    expect(component).toContain(`data-testid="btn-download-fcpxml"`);
    expect(component).toContain("Finish in Final Cut Pro");
    expect(component).toContain("onClick={handleDownloadFcpxml}");
  });

  it("builds the FCPXML from the editor's own timeline model", () => {
    expect(component).toContain(`from "@/lib/fcpxml-export"`);
    expect(component).toContain("computeSceneTimings(scenes, audioDurationSec ?? null)");
    expect(component).toContain("manualResult.timings[sceneIdx]");
    // Trims and speed come from the per-clip edit records, not constants.
    expect(component).toContain("sourceStartSec: trimStart");
    expect(component).toContain("sourceDurationSec: durationSec + trimStart + trimEnd");
    expect(component).toContain("hasSpeedRamp");
    expect(component).toContain("buildFcpxml(buildFcpxmlTimeline())");
  });
});
