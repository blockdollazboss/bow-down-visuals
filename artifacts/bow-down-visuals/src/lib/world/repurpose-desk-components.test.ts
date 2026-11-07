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
