/**
 * wallpapers-desk.test.ts — Stack-28 items 12–16: the Wallpapers desk's
 * wiring to its rails, pinned at the source-shape level (the pattern
 * video-studio.test.ts uses for the same dead-path class).
 *
 * Item 12 — the screensaver "Generate video" button POSTed
 * /api/generate-video, an endpoint that never existed (pinned dead by
 * S27-73): every click failed, and with no registry entry the spend
 * confirmation never appeared despite the 400 VB label. The desk now
 * drives the real rail, /api/generate-runway-clip (gen4.5, flat 400,
 * charged server-side only on success), with that rail's own
 * request/poll shapes — the same mapping MusicVideoTimeline,
 * SceneStudio and Video Studio use.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCreditCost } from "../../lib/credit-costs";

const desk = readFileSync(new URL("./WallpapersDesk.tsx", import.meta.url), "utf8");

/** The generateVideo() function body, sliced out so pins judge the
    screensaver flow itself, not unrelated desk code. */
function generateVideoBody(): string {
  const start = desk.indexOf("async function generateVideo()");
  expect(start, "generateVideo exists").toBeGreaterThan(-1);
  const end = desk.indexOf("async function renderScreensaver()", start);
  expect(end, "renderScreensaver follows generateVideo").toBeGreaterThan(start);
  return desk.slice(start, end);
}

describe("Stack-28 item 12 — screensaver Generate video drives the real runway rail", () => {
  it("never calls the dead /api/generate-video endpoint anywhere in the desk", () => {
    expect(desk).not.toContain('"/api/generate-video"');
    expect(desk).not.toContain("/api/generate-video/");
    expect(desk).not.toContain("/api/generate-video`");
  });

  it("submits through the confirmed-charge rail to /api/generate-runway-clip", () => {
    const body = generateVideoBody();
    expect(body).toContain('confirmedFetch("/api/generate-runway-clip"');
    // The rail's request shape (runwayClipSchema): promptText, not the
    // dead endpoint's { prompt, duration, aspectRatio }.
    expect(body).toContain("promptText: videoPrompt.trim()");
    expect(body).toContain('ratio: "1280:720"');
    expect(body).toContain('model: "gen4.5"');
    expect(body).not.toContain("aspectRatio");
  });

  it("polls the submitted task on the same rail, with the rail's status vocabulary", () => {
    const body = generateVideoBody();
    expect(body).toContain("/api/generate-runway-clip/${data.taskId}");
    expect(body).toContain('pdata.status === "succeeded"');
    expect(body).toContain('pdata.status === "failed"');
    expect(body).toContain('pdata.status === "cancelled"');
    expect(body).toContain("setVideoUrl(pdata.url)");
  });

  it("the confirmation is real: the rail is in the registry at the labelled 400", () => {
    // confirmedFetch only confirms when getCreditCost finds a cost > 0 —
    // the dead endpoint had no entry, so no confirmation ever showed.
    expect(getCreditCost("/api/generate-runway-clip")?.cost).toBe(400);
  });
});
