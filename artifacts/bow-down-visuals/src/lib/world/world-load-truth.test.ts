/**
 * World load truth (stack1000/world-load-truth) — the entry-burst
 * pins. The census behind them (report: stack1000-world-load-truth
 * -report.md) traced everything the World requests before the
 * palace appears; these pins lock the two load-shape fixes the
 * census produced, in the house source-pin style (the scene's
 * behaviour contract lives in its source — three.js + DOM make
 * direct unit construction impractical, and the perf-census /
 * figure-mouth-decouple pins set the precedent).
 *
 * A — fixture stand-ins share one load per source per build: the
 *     two posts of a body wear the same art, and each post used
 *     to walk the source plan with its own loader (the guard
 *     mattes ≈1.9 MB + ≈1.7 MB and the King portrait ≈0.8 MB,
 *     each fetched twice in the entry burst).
 * D — loop feeds fetch nothing until the playback budget selects
 *     them: attach used preload "metadata", so every loop-wearing
 *     figure in a room pulled its video head at swap time though
 *     at most MAX_LIVE_LOOPS ever play.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const fixturesScene = read("./guard-fixtures-scene.ts");
const scene = read("./hall-scene.ts");

describe("A: fixture stand-in loads are shared per build", () => {
  it("the build creates one shared map for its stand-in walks", () => {
    expect(fixturesScene).toContain(
      "const sharedStandins = new Map<string, Promise<THREE.Texture>>();",
    );
    expect(fixturesScene).toContain("buildStandin(def, shadowTex, sharedStandins)");
  });

  it("the loader consults the shared map before walking the plan", () => {
    const start = fixturesScene.indexOf("function loadStandinTexture");
    const end = fixturesScene.indexOf("let textureRepairGate", start);
    const loader = fixturesScene.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const getAt = loader.indexOf("shared.get(src)");
    const planAt = loader.indexOf("attemptLoadPlan(");
    expect(getAt).toBeGreaterThan(-1);
    expect(planAt).toBeGreaterThan(getAt);
    expect(loader).toContain("shared.set(src, walk)");
  });

  it("a spent walk is evicted (a failure is never cached)", () => {
    expect(fixturesScene).toContain("if (shared.get(src) === walk) shared.delete(src);");
  });

  it("both stand-in kinds route through the shared loader", () => {
    /* The guard matte path and the King portrait path. */
    const calls = fixturesScene.match(/loadStandinTexture\(\s*\S+,\s*sharedStandins,/g) ?? [];
    expect(calls.length).toBe(2);
  });
});

describe("D: loop feeds fetch nothing until selected", () => {
  it("feeds attach with preload none, never metadata", () => {
    const start = scene.indexOf("private attachLoopFeed");
    const end = scene.indexOf("private teardownLoopFeed", start);
    const attach = scene.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(attach).toContain('video.preload = "none";');
    expect(attach).not.toContain('video.preload = "metadata";');
  });

  it("the feed record tracks whether its load was kicked", () => {
    expect(scene).toContain("loadKicked: boolean;");
    expect(scene).toContain("loadKicked: false,");
  });

  it("the budget pass kicks the load for a selected, unkicked feed", () => {
    const start = scene.indexOf("private serviceLoopFeeds");
    const end = scene.indexOf("private hookLoopVisibility", start);
    const service = scene.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(service).toContain("!d.feed.loadKicked");
    expect(service).toContain("d.feed.loadKicked = true;");
    expect(service).toContain("d.feed.video.load();");
  });

  it("readiness still gates playback (canplay before play)", () => {
    const start = scene.indexOf("private serviceLoopFeeds");
    const end = scene.indexOf("private hookLoopVisibility", start);
    const service = scene.slice(start, end);
    expect(service).toContain("const shouldLive = live.has(d.key) && d.feed.ready;");
  });
});
