/**
 * Figure/mouth decoupling (owner's live report, 2026-10-25: a gold
 * capsule in a settled session — the fallback body standing long
 * after the figure art itself was reachable).
 *
 * The defect: every figure path (guard art, vault still portrait,
 * vault video still) swapped a presence off its fallback ONLY inside
 * locatePortraitMouth().then(). That locator pulls a MediaPipe
 * bundle + wasm + face model over the network; a slow or stalled
 * fetch left the figure unbuilt for the whole session even though
 * the image had long since loaded.
 *
 * The fix: figures stand the moment their image lands (mouth null);
 * the located mouth attaches IN PLACE when it resolves — the
 * portrait draw reads portrait.mouth live every frame, so lips
 * start working with no rebuild. These pins lock that ordering in
 * the scene source: the ready/stand step must precede the locator
 * call on each path, and the in-place attach must exist.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const scene = read("./hall-scene.ts");

describe("guard art: the figure stands on image load, not on the mouth locator", () => {
  const start = scene.indexOf("private loadGuardArt");
  const end = scene.indexOf("img.src = guardCharacterUrl", start);
  const loader = scene.slice(start, end);

  it("the loader exists and resolves its image URL", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("art is marked ready BEFORE the locator is invoked", () => {
    const readyAt = loader.indexOf('status: "ready", image: img, mouth: null');
    const locatorAt = loader.indexOf("locatePortraitMouth(img)");
    expect(readyAt).toBeGreaterThan(-1);
    expect(locatorAt).toBeGreaterThan(-1);
    expect(readyAt).toBeLessThan(locatorAt);
  });

  it("waiting rigs are stood up before the locator is invoked", () => {
    const standAt = loader.indexOf("this.standWaitingGuards(variant)");
    const locatorAt = loader.indexOf("locatePortraitMouth(img)");
    expect(standAt).toBeGreaterThan(-1);
    expect(standAt).toBeLessThan(locatorAt);
  });

  it("the resolved mouth attaches in place to the shared art record", () => {
    expect(loader).toContain("this.guardArt[variant].mouth = mouth");
  });
});

describe("the late mouth attaches in place (no rebuild)", () => {
  it("guard figures wearing the variant receive the mouth on their portrait state", () => {
    expect(scene).toContain("rig.portrait.mouth = mouth");
  });

  it("the portrait draw reads the mouth live (why in-place attach works)", () => {
    expect(scene).toContain("const mouth = portrait.mouth;");
  });
});

describe("vault portraits: the figure builds with a null mouth, then refines", () => {
  it("both portrait builds construct the figure before locating the mouth", () => {
    const builds = scene.match(/buildPortraitFigure\(img, null\)/g) ?? [];
    /* The still-portrait path and the video-still path. */
    expect(builds.length).toBe(2);
  });

  it("the locator still runs after the build (lips are a refinement, not removed)", () => {
    const firstBuild = scene.indexOf("buildPortraitFigure(img, null)");
    const locatorAfter = scene.indexOf("locatePortraitMouth(img)", firstBuild);
    expect(firstBuild).toBeGreaterThan(-1);
    expect(locatorAfter).toBeGreaterThan(firstBuild);
  });
});
