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
 *
 * stack1000/world-load-truth: the guard path's locator call moved
 * OUT of the art loader entirely. The landmarker chain (≈17.8 MB)
 * rode every World entry for two stills a mouth is never read on
 * until a figure wearing the variant speaks (and which the
 * pipeline's own measurement finds faceless). ensureGuardMouth
 * now asks lazily, once per variant, from the first speech — the
 * decoupling law is unchanged and strengthened: stand on art,
 * lips whenever they honestly arrive, and don't buy the arrival
 * machinery until somebody talks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const scene = read("./hall-scene.ts");

describe("guard art: the figure stands on image load, not on the mouth locator", () => {
  const start = scene.indexOf("private loadGuardArt");
  const end = scene.indexOf("private ensureGuardMouth", start);
  const loader = scene.slice(start, end);

  it("the loader exists and walks the standin source plan", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(loader).toContain("attemptLoadPlan");
    expect(loader).toContain("fixtureStandinArtPlan");
  });

  it("art is marked ready and waiting rigs stand inside the loader", () => {
    expect(loader).toContain('status: "ready", image: img, mouth: null');
    expect(loader).toContain("this.standWaitingGuards(variant)");
  });

  it("the loader never invokes the locator — location is lazy now", () => {
    expect(loader).not.toContain("locatePortraitMouth");
  });
});

describe("guard mouths: located lazily, attached in place", () => {
  const start = scene.indexOf("private ensureGuardMouth");
  const end = scene.indexOf("private swapFigure", start);
  const asker = scene.slice(start, end);

  it("the asker exists and invokes the locator", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(asker).toContain("locatePortraitMouth(art.image)");
  });

  it("the asker is once-per-variant (the requested set gates it)", () => {
    expect(asker).toContain("this.guardMouthRequested.has(variant)");
    expect(asker).toContain("this.guardMouthRequested.add(variant)");
  });

  it("the resolved mouth attaches in place to the shared art record", () => {
    expect(asker).toContain("this.guardArt[variant].mouth = mouth");
  });

  it("guard figures wearing the variant receive the mouth on their portrait state", () => {
    expect(asker).toContain("rig.portrait.mouth = mouth");
  });

  it("first speech is the trigger (setSpeechLevel asks)", () => {
    const speech = scene.slice(
      scene.indexOf("setSpeechLevel(peerId"),
      scene.indexOf("setPeerTarget(peerId"),
    );
    expect(speech).toContain("this.ensureGuardMouth(rig.guardVariant)");
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
