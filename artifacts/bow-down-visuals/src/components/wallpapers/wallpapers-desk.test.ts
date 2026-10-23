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

/** The makePack() function body. */
function makePackBody(): string {
  const start = desk.indexOf("async function makePack()");
  expect(start, "makePack exists").toBeGreaterThan(-1);
  const end = desk.indexOf("async function applyPack()", start);
  expect(end, "applyPack follows makePack").toBeGreaterThan(start);
  return desk.slice(start, end);
}

describe("Stack-28 item 14 — clean theme pack: one up-front confirmation, no discarded paid render", () => {
  it("confirms ONCE for the whole pack (2 × clean render) before any render runs", () => {
    const body = makePackBody();
    expect(body).toContain("confirmSpend({");
    // The pack total is the derived WALLPAPER_CLEAN_PACK_COST (item 15:
    // 2 × the registry-mapped clean render — pinned == 800 in
    // wallpapers-prices.test.ts), never a desk-side literal.
    expect(body).toContain("cost: WALLPAPER_CLEAN_PACK_COST");
    expect(body).toContain('feature: "Clean Theme Pack"');
    // The confirmation precedes the first render call.
    expect(body.indexOf("confirmSpend({")).toBeLessThan(body.indexOf("renderOne("));
    // Exactly one confirmation site in the pack flow.
    expect(body.match(/confirmSpend/g)).toHaveLength(1);
  });

  it("both pack renders ride the up-front confirmation (skipConfirm) — no second prompt exists to cancel", () => {
    const body = makePackBody();
    const renders = body.match(/renderOne\(THEME_PACK_PRESET_KEYS\.(phone|desktop), currentArt, \{ skipConfirm: true \}\)/g) ?? [];
    expect(renders).toHaveLength(2);
  });

  it("a failed desktop render keeps the paid phone render in desk state", () => {
    const body = makePackBody();
    // The catch path re-adds the phone render instead of discarding it.
    expect(body).toContain("if (phone) setRenders((prev) => [phone!, ...prev]);");
  });

  it("the single-render path keeps its own per-render confirmation (renderOne without skipConfirm)", () => {
    const start = desk.indexOf("async function renderSelected()");
    const slice = desk.slice(start, desk.indexOf("/* ── Theme pack", start));
    expect(slice).toContain("renderOne(presetKey, currentArt)");
    expect(slice).not.toContain("skipConfirm");
  });
});

describe("Stack-28 item 16 — store listing attaches the full set it promises", () => {
  it("listPack posts mediaUrls [phoneUrl, desktopUrl]", () => {
    const start = desk.indexOf("async function listPack()");
    expect(start, "listPack exists").toBeGreaterThan(-1);
    const slice = desk.slice(start, desk.indexOf("async function downloadZip(", start));
    expect(slice).toContain("mediaUrls: [pack.phoneUrl, pack.desktopUrl]");
    expect(slice).not.toContain("mediaUrls: [pack.phoneUrl]");
  });
});

describe("Stack-28 item 13 — King's Set selections are absolutified for the rails", () => {
  it("both selection buttons absolutify: Use this art (still) and Use as screensaver (loop)", () => {
    expect(desk).toContain("setCurrentArt(absoluteKingsSetUrl(piece.stillUrl))");
    expect(desk).toContain("setVideoUrl(absoluteKingsSetUrl(piece.loopUrl))");
  });

  it("no bare relative King's Set URL reaches desk state", () => {
    expect(desk).not.toContain("setCurrentArt(piece.stillUrl)");
    expect(desk).not.toContain("setVideoUrl(piece.loopUrl)");
  });
});
