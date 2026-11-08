/**
 * video-studio-desk-components — stack200 world parity lane
 * B1, census item 5 source-contract pins. The Video Studio
 * desk must sit in the My Studio board stack as an
 * ({ isLight }) desk, with:
 * - the hub surface whole: camera-movement picker over the
 *   shared catalog, one-click presets, duration/aspect
 *   pickers, text/image modes, project picks, the one-shot
 *   winner anchor;
 * - the generate on confirmedFetch with the registry price —
 *   a decline (null) runs nothing; the poll loop is the
 *   seam's verdicts to the seam's deadline; a finished clip
 *   lands in the hub project through the seam's record;
 * - a picked reference photo uploaded to storage first (the
 *   page's rule), never sent as a data URL;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/VideoStudioDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the board mount", () => {
  it("is an ({ isLight }) desk rooted at its testid", () => {
    expect(desk).toContain("export function VideoStudioDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-video-studio-desk"');
  });

  it("StationPanel stacks it at the board after the Repurpose desk", () => {
    expect(panel).toContain('const VideoStudioDesk = lazy(() => import("@/components/world/native/VideoStudioDesk")');
    expect(panel).toContain("<VideoStudioDesk isLight={isLight} />");
    expect(panel.indexOf("<VideoStudioDesk")).toBeGreaterThan(panel.indexOf("<RepurposeDesk"));
    expect(panel.indexOf("<VideoStudioDesk")).toBeLessThan(panel.indexOf("<TemplatesDesk"));
  });

  it("imports the shared data module — never the unrouted page", () => {
    expect(desk).toContain('from "@/data/video-studio"');
    expect(desk).not.toContain('from "@/pages/video-studio"');
    expect(desk).not.toContain('import VideoStudio');
  });
});

describe("the hub surface — pickers, presets, modes, spine", () => {
  it("renders the camera grid, presets, duration/aspect pickers and both modes", () => {
    for (const needle of [
      'data-testid="world-video-studio-desk-cameras"',
      "CAMERA_MOVEMENTS.map",
      'data-testid="world-video-studio-desk-presets"',
      "ONE_CLICK_PRESETS.map",
      "VIDEO_STUDIO_DURATIONS.map",
      "VIDEO_STUDIO_ASPECTS.map",
      'data-testid="world-video-studio-desk-mode"',
      'data-testid="world-video-studio-desk-picks"',
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the spine runs both ways: project picks in, winner anchor, finished clips into the project", () => {
    expect(desk).toContain("studioProjectPick(asset, prompt)");
    expect(desk).toContain("takeThumbnailWinner(localStorage)");
    expect(desk).toContain("addAsset(");
    expect(desk).toContain("studioClipAsset({");
    expect(desk).toContain("refreshProfile()");
  });
});

describe("the generate — confirmed, polled, honestly finished", () => {
  it("submits through confirmedFetch at the registry price; a decline runs nothing", () => {
    expect(desk).toContain("confirmedFetch(VIDEO_STUDIO_CLIP_PATH");
    expect(desk).toContain("overrideCost: videoClipCost()");
    expect(desk).toContain("buildStudioClipBody({");
    expect(desk).toContain("if (submitRes === null) return;");
  });

  it("polls the seam's task path to the seam's deadline and reads verdicts through the seam", () => {
    expect(desk).toContain("videoStudioTaskPath(submit.taskId)");
    expect(desk).toContain("VIDEO_STUDIO_POLL_DEADLINE_MS");
    expect(desk).toContain("interpretStudioPoll(");
    expect(desk).toContain('t("worldVideoStudio.emptySuccess")');
    expect(desk).toContain('t("worldVideoStudio.timedOut")');
  });

  it("a poll failure speaks two kinds (stack300 item 117): the server's plain message when the job carries one, the catalog's no-detail words otherwise", () => {
    expect(desk).toContain('apiErrorMessage(pollBody, t("worldVideoStudio.failedNoDetail"))');
    /* The bare catalog-only failure throw is gone from the poll path. */
    expect(desk).not.toContain('throw new Error(t("worldVideoStudio.failed"));');
  });

  it("a picked photo uploads to storage first — never a data URL in the body", () => {
    expect(desk).toContain("r2UploadFile(key, referenceFile, referenceFile.type, token)");
    expect(desk).toContain("video-studio-refs/");
    expect(desk).toContain("VIDEO_STUDIO_REFERENCE_MAX_BYTES");
    expect(desk).toContain('t("worldVideoStudio.errorNotImage")');
    expect(desk).toContain('t("worldVideoStudio.errorImageTooLarge")');
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
