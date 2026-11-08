/**
 * repurpose-desk-components — stack200 world parity lane B1,
 * census item 4 source-contract pins. The Repurpose desk
 * must sit in the My Studio board stack right after Publish
 * as an ({ isLight }) desk, with:
 * - every charge behind useConfirmedApi with the seam's
 *   route-pinned constants as the override — a decline (null)
 *   runs nothing, a 402 lands in the out-of-Bucs state;
 * - the page's flow: analyze → poll both jobs at the page's
 *   cadence → finished clips/thumbnails flow into the hub
 *   project once per job; a lost-jobs cap instead of an
 *   endless spinner;
 * - the page's own copy (repurpose.*) for everything but the
 *   desk's framing;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/RepurposeDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the board mount", () => {
  it("is an ({ isLight }) desk rooted at its testid", () => {
    expect(desk).toContain("export function RepurposeDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-repurpose-desk"');
  });

  it("StationPanel stacks it at the board right after PublishDesk", () => {
    expect(panel).toContain('const RepurposeDesk = lazy(() => import("@/components/world/native/RepurposeDesk")');
    expect(panel).toContain("<RepurposeDesk isLight={isLight} />");
    expect(panel.indexOf("<RepurposeDesk")).toBeGreaterThan(panel.indexOf("<PublishDesk"));
    expect(panel.indexOf("<RepurposeDesk")).toBeLessThan(panel.indexOf("<TemplatesDesk"));
  });
});

describe("charges — confirmed, route-priced, decline runs nothing", () => {
  it("analyze and both rerolls ride confirmedFetch with the seam constants as override", () => {
    expect(desk).toContain("overrideCost: REPURPOSE_PACK_COST_VB");
    expect(desk).toContain("overrideCost: REPURPOSE_REROLL_COST_VB");
    expect(desk).toContain("confirmedFetch(REPURPOSE_ANALYZE_PATH");
    expect(desk).toContain("confirmedFetch(REPURPOSE_REROLL_PATH");
    expect(desk).toContain("confirmedFetch(REPURPOSE_REROLL_THUMBNAIL_PATH");
    expect(desk).toContain("if (res === null) return;");
  });

  it("a 402 or the route's out_of_credits body lands in the out-of-Bucs state", () => {
    expect(desk).toContain('res.status === 402 || data?.["error"] === "out_of_credits"');
    expect(desk).toContain('data-testid="world-repurpose-desk-outofbucs"');
    expect(desk).toContain('t("worldRepurposeDesk.outOfBucs")');
  });

  it("the price the member confirms is the price the copy states", () => {
    expect(desk).toContain('t("repurpose.repurposeButton", { credits: REPURPOSE_PACK_COST_VB })');
    expect(desk).toContain('t("repurpose.costNote", { pack: REPURPOSE_PACK_COST_VB, reroll: REPURPOSE_REROLL_COST_VB })');
  });
});

describe("the page's flow — poll, flow into the project, cap the wait", () => {
  it("polls both jobs on an interval and flows finished work into the hub once per job", () => {
    expect(desk).toContain("window.setInterval");
    expect(desk).toContain("POLL_MS = 5000");
    expect(desk).toContain("flowedRef.current.has(clipJobId)");
    expect(desk).toContain("flowedRef.current.has(thumbJobId)");
    expect(desk).toContain('addAsset({\n            kind: "clip"');
    expect(desk).toContain('kind: "thumbnail"');
  });

  it("a job that never settles lands on the page's lost-jobs copy, not an endless spinner", () => {
    expect(desk).toContain("MAX_POLL_ATTEMPTS");
    expect(desk).toContain('t("repurpose.error.lostJobs")');
  });

  it("sources mirror the page: project videos, an upload, or a project-storage URL", () => {
    expect(desk).toContain("projectVideos");
    expect(desk).toContain('t("worldRepurposeDesk.fromProject")');
    expect(desk).toContain('t("repurpose.step1.chooseFile")');
    expect(desk).toContain("JSON.stringify({ videoUrl: source.url })");
    expect(desk).toContain('fd.append("video", source.file)');
  });
});

describe("copy — the page's catalog keys", () => {
  it("sections, states and errors ride repurpose.*", () => {
    for (const key of [
      't("repurpose.hero")',
      't("repurpose.building")',
      't("repurpose.clips.title")',
      't("repurpose.clips.cutting")',
      't("repurpose.clips.cutFailed")',
      't("repurpose.thumbs.title")',
      't("repurpose.thumbs.painting")',
      't("repurpose.captions.title")',
      't("repurpose.platforms.title")',
      't("repurpose.platforms.noDesc")',
      't("repurpose.error.repurposeFailed")',
      't("repurpose.error.rerollFailed")',
      't("repurpose.error.thumbRerollFailed")',
      't("repurpose.error.clipCuttingFailed")',
      't("repurpose.error.thumbFailed")',
      't("repurpose.error.noSource")',
      't("repurpose.error.copyFailed")',
      't("repurpose.renderingNote")',
    ]) {
      expect(desk, key).toContain(key);
    }
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});

/* ════════════════════════════════════════════════════════════
   Stack 300 items 94/95/118 — the desk's other two modes and
   the Check again action, pinned as source contracts.
   ════════════════════════════════════════════════════════════ */

describe("modes — the page's three, switched in the desk (items 94/95)", () => {
  it("a tablist switches pack / stream / smart on the page's mode keys", () => {
    expect(desk).toContain('role="tablist"');
    expect(desk).toContain('t("repurpose.modeLabel", { defaultValue: "Repurpose mode" })');
    expect(desk).toContain('t("repurpose.modePack", { defaultValue: "Content Pack" })');
    expect(desk).toContain('t("repurpose.modeStreamVod", { defaultValue: "Stream VOD" })');
    expect(desk).toContain('t("repurpose.modeSmart", { defaultValue: "Smart Clips" })');
    expect(desk).toContain('useState<"pack" | "stream" | "smart">("pack")');
    expect(desk).toContain('mode === "pack"');
    expect(desk).toContain("<StreamVodMode isLight={isLight} />");
    expect(desk).toContain("<SmartClipsMode isLight={isLight} />");
  });
});

describe("Stream VOD mode — the page's rails, the page's confirms (item 94)", () => {
  it("analyze rides confirmedFetch on the registry-priced rail (300 — the page's confirm)", () => {
    expect(desk).toContain("confirmedFetch(STREAM_ANALYZE_PATH");
    expect(desk).toContain('t("clipMaker.findHighlights", { cost: STREAM_ANALYZE_COST_VB })');
    expect(desk).toContain('data-testid="world-repurpose-desk-stream"');
    expect(desk).toContain('data-testid="world-repurpose-desk-stream-run"');
  });

  it("cutting confirms the per-clip total as the override, exactly like the page", () => {
    expect(desk).toContain("confirmedFetch(STREAM_CUT_PATH");
    expect(desk).toContain("overrideCost: picks.length * STREAM_CUT_COST_PER_CLIP_VB");
    expect(desk).toContain('overrideFeature: t("clipMaker.cutFeatureName")');
    expect(desk).toContain('t("clipMaker.cutClips", { count: picks.length, cost: picks.length * STREAM_CUT_COST_PER_CLIP_VB })');
    expect(desk).toContain('data-testid="world-repurpose-desk-stream-cut"');
  });

  it("the cut job polls at the pack cadence and flows done clips into the hub", () => {
    expect(desk).toContain("streamCutJobPath(cutJobId)");
    expect(desk).toContain("streamCutJobOf(");
    expect(desk).toContain('data-testid="world-repurpose-desk-stream-outofbucs"');
    expect(desk).toContain('t("worldRepurposeDesk.streamOutOfBucs")');
    expect(desk).toContain('t("clipMaker.errorJobLost")');
  });

  it("mode copy rides the page's clipMaker.* keys", () => {
    for (const key of [
      't("clipMaker.step1Title")',
      't("clipMaker.chooseFile")',
      't("clipMaker.clipLength")',
      't("clipMaker.maxClips")',
      't("clipMaker.vibe")',
      't("clipMaker.analyzing")',
      't("clipMaker.analyzeNote", { vibe })',
      't("clipMaker.highlightsFound", { count: analysis.highlights.length })',
      't("clipMaker.selectAll")',
      't("clipMaker.copyTimestamps")',
      't("clipMaker.selectToCut")',
      't("clipMaker.cutting")',
      't("clipMaker.cuttingBackground")',
      't("clipMaker.step3Title")',
      't("clipMaker.downloadClip")',
      't("clipMaker.errorNoSource")',
      't("clipMaker.errorNoSelection")',
      't("clipMaker.errorAnalysisFailed")',
      't("clipMaker.errorCutStartFailed")',
      't("clipMaker.errorCutFailed")',
      't("clipMaker.errorCutRefunded")',
    ]) {
      expect(desk, key).toContain(key);
    }
  });
});

describe("Smart Clips mode — free propose, confirmed render (item 95)", () => {
  it("proposing rides a plain authed fetch (free), rendering rides confirmedFetch", () => {
    expect(desk).toContain("fetch(SMART_PROPOSE_PATH");
    expect(desk).toContain("confirmedFetch(SMART_RENDER_PATH");
    expect(desk).toContain("overrideCost: kept.length * SMART_RENDER_COST_PER_CLIP_VB");
    expect(desk).toContain('overrideFeature: t("smartClips.featureName")');
    expect(desk).toContain('data-testid="world-repurpose-desk-smart"');
    expect(desk).toContain('data-testid="world-repurpose-desk-smart-find"');
    expect(desk).toContain('data-testid="world-repurpose-desk-smart-render"');
  });

  it("only kept, valid drafts render; rendered clips flow into the hub", () => {
    expect(desk).toContain("keptSmartDrafts(drafts)");
    expect(desk).toContain("smartDraftWindow(draft)");
    expect(desk).toContain("buildSmartRenderBody(videoUrl.trim(), kept)");
    expect(desk).toContain("smartClipsOf(data)");
    expect(desk).toContain('data-testid="world-repurpose-desk-smart-outofbucs"');
    expect(desk).toContain('t("worldRepurposeDesk.smartOutOfBucs")');
  });

  it("mode copy rides the page's smartClips.* keys", () => {
    for (const key of [
      't("smartClips.title")',
      't("smartClips.urlLabel")',
      't("smartClips.searchLabel")',
      't("smartClips.countLabel")',
      't("smartClips.lengthLabel")',
      't("smartClips.findButton")',
      't("smartClips.finding")',
      't("smartClips.findNote")',
      't("smartClips.errorNoUrl")',
      't("smartClips.errorFailed")',
      't("smartClips.errorNoProposals")',
      't("smartClips.proposalsTitle")',
      't("smartClips.proposalsHint")',
      't("smartClips.keepLabel")',
      't("smartClips.startLabel")',
      't("smartClips.endLabel")',
      't("smartClips.quoteLabel")',
      't("smartClips.invalidTime")',
      't("smartClips.rendering")',
      't("smartClips.resultsTitle")',
      't("smartClips.download")',
      't("smartClips.energyPick")',
      't("smartClips.methodSemantic")',
      't("smartClips.methodMixed")',
      't("smartClips.methodEnergy")',
    ]) {
      expect(desk, key).toContain(key);
    }
  });
});

describe("Check again — the lost-jobs line carries a real action (item 118)", () => {
  it("the poll's give-up keeps the job ids instead of throwing them away", () => {
    expect(desk).toContain("setLostJobIds({ clip: clipJobId, thumb: thumbJobId })");
    expect(desk).toContain("const [lostJobIds, setLostJobIds] = useState");
    expect(desk).toContain("async function checkAgain()");
    expect(desk).toContain("readJob(lostJobIds.clip)");
    expect(desk).toContain("readJob(lostJobIds.thumb)");
  });

  it("the button renders beside the lost-jobs copy with the desk's own keys", () => {
    expect(desk).toContain('data-testid="world-repurpose-desk-check-again"');
    expect(desk).toContain('t("worldRepurposeDesk.checkAgain")');
    expect(desk).toContain('t("worldRepurposeDesk.checkingJobs")');
    expect(desk).toContain("onClick={() => void checkAgain()}");
  });
});
