/**
 * caption-style-once-wiring.test.ts — stack1400 org/design wave #2, §4.4 #10.
 * Source pins for the styled-once wiring (repo convention for editor
 * surfaces): the Suite must be fed the project caption style by the
 * editor page, must derive + write back through lib/caption-style-once,
 * and its saved VTT must be built with that style. The behavioral pins
 * live in src/lib/caption-style-once.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const suite = read("./sections/AiCaptionSuite.tsx");
const page = read("../../pages/video-editor.tsx");

describe("captions styled once — wiring", () => {
  it("the editor page hands the Suite the ONE project caption style", () => {
    expect(page).toContain("captionSettings={settings.captions}");
    expect(page).toContain("onCaptionSettingsChange={(nextCaptions) => {");
  });

  it("the Suite derives its burn controls from that style (no fresh default re-ask)", () => {
    expect(suite).toContain("suiteBurnStyleFromSettings(captionSettings, \"wordsync\")");
    expect(suite).toContain("suiteBurnStyleFromSettings(captionSettings, burnMode)");
  });

  it("Suite picks write back into the project caption style", () => {
    expect(suite).toContain("settingsWithSuiteBurnStyle(captionSettings, mode, pick)");
    expect(suite).toContain("onClick={() => pickStyle(s.key)}");
    expect(suite).toContain("writeBackStyle({ styleKey, position, fontSize })");
  });

  it("the saved VTT is built with the project caption style", () => {
    expect(suite).toContain('downloadTextFile("captions.vtt", buildVtt(lines, captionSettings), "text/vtt")');
    expect(suite).toContain("captionVttStyleBlock(captions)");
  });
});
