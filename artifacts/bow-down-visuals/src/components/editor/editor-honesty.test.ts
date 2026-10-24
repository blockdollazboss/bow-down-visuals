import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-100 #3 Lane D, second pass (N-01…N-06) — honesty pins for defects
 * found by the late FE panel audit and re-verified line-by-line in this
 * lane before fixing. Each pin guards a place where the editor used to
 * claim something false: a fabricated video URL, a fake generation job,
 * un-applied recipe cuts counted as applied, clip-presence presented as
 * face detection, a stale "preview only" status, a "next phase" caption
 * for an export that exists, and a hardcoded 10s keyframe scale.
 */
const studio = readFileSync(new URL("./sections/StudioEditorSection.tsx", import.meta.url), "utf8");
const recipes = readFileSync(new URL("./sections/TimelineTemplatesSection.tsx", import.meta.url), "utf8");
const lipSection = readFileSync(new URL("./sections/LipSyncSection.tsx", import.meta.url), "utf8");
const autoAiEdit = readFileSync(new URL("./sections/AutoAiEditSection.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("./music/PreviewTransport.tsx", import.meta.url), "utf8");
const keyframes = readFileSync(new URL("./sections/KeyframesSection.tsx", import.meta.url), "utf8");
const threeSecondLab = readFileSync(new URL("./sections/ThreeSecondLabSection.tsx", import.meta.url), "utf8");

describe("editor honesty fixes (N-series)", () => {
  it("N-01: Studio Editor never fabricates a placeholder video URL", () => {
    expect(studio).not.toContain("storage.bowdownvisuals.com/placeholders");
    expect(studio).not.toContain("placeholderCreated = true");
    expect(studio).toContain("Placeholder videos aren't generated yet");
  });

  it("N-02: Studio Editor never invents a regeneration job", () => {
    expect(studio).not.toContain("gen_${Math.random()");
    expect(studio).not.toContain("res.regenerateStarted = true");
    expect(studio).toContain("Clip regeneration isn't available in this panel");
  });

  it("N-03: recipe cut ops are planned, not counted as applied", () => {
    const cutCase = recipes.slice(recipes.indexOf('case "cut"'), recipes.indexOf('case "setAudio"'));
    expect(cutCase).toContain("cutTimes.push");
    expect(cutCase).not.toContain("applied++");
  });

  it("N-04: LipSyncSection does not present clip presence as face detection", () => {
    expect(lipSection).not.toContain("high (mock)");
    expect(lipSection).not.toContain("No clear face found");
    expect(lipSection).toContain("video clip attached");
    expect(lipSection).toContain('value={faceCheckNote}');
    expect(lipSection).toContain('"not available"');
  });

  it("N-05: AutoAiEdit no longer claims transitions are preview-only", () => {
    expect(autoAiEdit).not.toContain('"no (preview only)"');
    expect(autoAiEdit).toContain("yes — burned into export");
  });

  it("N-06: PreviewTransport no longer promises export 'in the next phase'", () => {
    expect(transport).not.toContain("comes in the next phase");
    expect(transport).toContain("use the Export tab in this studio");
  });

  it("N-06b: Keyframes scale to the scene's real duration, labelled at start", () => {
    expect(keyframes).not.toContain("const clipDuration = 10;");
    expect(keyframes).toContain("parseRawSceneDuration(activeScene.timestamp)");
    expect(keyframes).not.toContain("Add at playhead");
    expect(keyframes).toContain("Add at start");
  });

  it("N-08: 3-Second Lab never overrides its price — the registry (rail-pinned 200 VB) speaks", () => {
    // The section once passed overrideCost: 2 (pre-x100 figure), so the
    // confirm dialog and the spent toast claimed 2 VB while the rail
    // charged OPENINGS_CREDITS = 200. With no override, useConfirmedApi
    // falls back to the credit-costs registry, whose 200 is pinned to the
    // rail constant by credit-costs-rail-truth.test.ts.
    expect(threeSecondLab).not.toContain("overrideCost");
    expect(threeSecondLab).not.toContain("const COST = 2");
  });
});
