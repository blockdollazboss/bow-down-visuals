import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Smart Reframe — Subject Tracking: editor wiring pins.
 *
 * The card docks in the Export tab directly under Multi-Ratio Export —
 * the editor's reframe neighbourhood — WITHOUT touching the two
 * neighbouring features it must stay unambiguous beside:
 *   - the Pro Tools "✨ Smart Reframe — one tap" chip (an export-
 *     settings crop preset — a different feature, name and all), and
 *   - Multi-Ratio Export (pad/centre-crop to many ratios at once).
 * These pins fail if the card is moved, renamed into a collision, the
 * charge stops riding the confirmed-fetch rail, or the neighbours get
 * renamed/broken in the process.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("../components/editor/SubjectReframeCard.tsx");
const exportSection = read("../components/editor/sections/ExportSection.tsx");
const proTools = read("../components/editor/sections/ProToolsSection.tsx");
const page = read("../pages/video-editor.tsx");

describe("subject reframe editor wiring", () => {
  it("the card submits through the confirmed-charge rail to the registry endpoint", () => {
    expect(card).toContain("confirmedFetch(SUBJECT_REFRAME_ENDPOINT");
    expect(card).toContain("buildSubjectReframeBody(");
    // Price is confirmed from the registry copy, never a card-local number.
    expect(card).toContain("subjectReframeCost()");
    expect(card).toContain("overrideCost: cost");
    expect(card).toContain("overrideFeature:");
    expect(card).not.toMatch(/=\s*200\b/);
  });

  it("the card is named for what it does and reads its price from the catalog + registry", () => {
    expect(card).toContain('t("videoEditor.subjectReframe.title")');
    expect(card).toContain('t("videoEditor.subjectReframe.costLabel", { cost })');
    expect(card).toContain('t("videoEditor.subjectReframe.renderButton", { cost })');
    expect(card).toContain('t("videoEditor.subjectReframe.costSuffix")');
  });

  it("renders the honest fallback state: centre crop says so, with the server's reason", () => {
    expect(card).toContain('t("videoEditor.subjectReframe.doneCentre")');
    expect(card).toContain('t("videoEditor.subjectReframe.centreDesc")');
    expect(card).toContain("subjectReframeReasonKey(result.reframe.reason)");
    expect(card).toContain('t("videoEditor.subjectReframe.doneTracked")');
    expect(card).toContain('t("videoEditor.subjectReframe.trackedDetail"');
  });

  it("failure states carry the refund note and the out-of-credits path", () => {
    expect(card).toContain('t("videoEditor.subjectReframe.failedRefunded", { cost })');
    expect(card).toContain('t("videoEditor.subjectReframe.outOfCredits")');
    expect(card).toContain('t("videoEditor.subjectReframe.failedNetwork")');
  });

  it("results land back in the project: timeline replace + use-as-export doors exist", () => {
    expect(card).toContain("onReplaceClipVideo(resultSource.sceneId, result.url)");
    expect(card).toContain('t("videoEditor.subjectReframe.useInTimeline")');
    expect(card).toContain('t("videoEditor.subjectReframe.useAsExport")');
  });

  it("docks in the Export tab immediately after Multi-Ratio Export, wired to the page", () => {
    const multiIdx = exportSection.indexOf("<MultiRatioExportCard");
    const cardIdx = exportSection.indexOf("<SubjectReframeCard");
    expect(multiIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(multiIdx);
    expect(exportSection).toContain("onUseAsExport={(url) => setFinalVideoUrl(url)}");
    expect(exportSection).toContain("onReplaceClipVideo={onReplaceClipVideo}");
    expect(page).toContain("onReplaceClipVideo={(sceneId, url) =>");
  });

  it("the neighbouring features are untouched: Pro Tools chip keeps its name, Multi-Ratio stays its own card", () => {
    expect(proTools).toContain("✨ Smart Reframe — one tap");
    expect(proTools).not.toContain("auto-reframe");
    expect(proTools).not.toContain("SubjectReframeCard");
    expect(exportSection).toContain("MultiRatioExportCard");
  });
});
