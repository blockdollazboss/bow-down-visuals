/**
 * world-perf (stack1200) — the World load/performance lane's pins.
 *
 * Three behaviour-preserving fixes, each pinned at the source so
 * the waste cannot quietly grow back:
 *
 *  A. The station panel universe loads on FIRST OPEN, not with
 *     the room: world.tsx reaches StationPanel through a lazy
 *     door (type-only static import), behind a Suspense fallback
 *     that carries the sheet's own frame.
 *  B. A video-only character's snapshot probe stops FETCHING
 *     when its figure is superseded: the probe is tracked on the
 *     rig and cancelled on pick change, peer removal and self
 *     teardown; removals also bump swapSeq so pending portrait
 *     callbacks land as no-ops.
 *  C. Creator-room host portraits load once per scene, not per
 *     room hop: a URL-keyed cache in the plate-cache pattern,
 *     retired at scene dispose.
 *
 * Plus the two "stayed cut" proofs the lane re-verified: the
 * presence guard art walks the SAME CDN-first plan as the
 * fixture stand-ins (no second, origin-only download of the two
 * guard PNGs), and the fixture stand-ins still share ONE walk
 * per art per build (sharedStandins).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

const worldPage = read("../../pages/world.tsx");
const scene = read("./hall-scene.ts");
const fixturesScene = read("./guard-fixtures-scene.ts");

/** The source slice of one method: from its signature to the
 * next method-shaped line at the same indent. */
function methodSlice(src: string, signature: string, span = 2600): string {
  const start = src.indexOf(signature);
  expect(start, `expected to find ${signature}`).toBeGreaterThan(-1);
  return src.slice(start, start + span);
}

describe("world-perf A — the desk universe rides its own chunk", () => {
  it("world.tsx imports StationPanel type-only, never statically", () => {
    expect(worldPage).toContain(
      'import type { StationPanelTarget } from "@/components/world/StationPanel";',
    );
    expect(worldPage).not.toContain(
      'import StationPanel, { type StationPanelTarget }',
    );
    expect(worldPage).not.toMatch(
      /^import StationPanel from /m,
    );
  });

  it("the panel sits behind a lazy dynamic import", () => {
    expect(worldPage).toContain(
      'const StationPanel = lazy(() => import("@/components/world/StationPanel"));',
    );
  });

  it("the mount stays conditional on an open station, wrapped in Suspense", () => {
    expect(worldPage).toContain("{panelTarget && status === \"inside\" && (");
    const mount = methodSlice(worldPage, "{panelTarget && status === \"inside\" && (", 400);
    expect(mount).toContain("<Suspense");
    expect(mount).toContain("StationPanelFallback");
    expect(mount).toContain("<StationPanel");
  });

  it("the fallback is the sheet's own frame, not a blank hole", () => {
    const fallback = methodSlice(worldPage, "function StationPanelFallback", 1400);
    expect(fallback).toContain('data-testid="world-station-panel-loading"');
    expect(fallback).toContain("animate-spin");
    expect(fallback).toContain("max-h-[86dvh]");
  });
});

describe("world-perf B — superseded figure probes stop fetching", () => {
  it("the rig tracks its in-flight probe", () => {
    expect(scene).toContain("figureProbe: HTMLVideoElement | null;");
    expect(scene).toContain("figureProbe: null,");
  });

  it("cancelFigureProbe releases the fetch the loop-feed way", () => {
    const cancel = methodSlice(scene, "private cancelFigureProbe", 700);
    expect(cancel).toContain('probe.removeAttribute("src")');
    expect(cancel).toContain("probe.load()");
    expect(cancel).toContain("probe.pause()");
  });

  it("a pick change cancels the old probe and the new probe is tracked", () => {
    const reconcile = methodSlice(scene, "private reconcileFigure", 7000);
    expect(reconcile).toContain("this.cancelFigureProbe(rig);");
    expect(reconcile).toContain("rig.figureProbe = probe;");
    expect(reconcile).toContain("probe.src = loopUrl;");
    /* The cancel rides the change path only: the same-id early
     * return above it must still exist, so a standing figure's
     * probe is never disturbed by the upsert cadence. */
    expect(reconcile).toContain("if (wantId === rig.requestedId) {");
  });

  it("peer removal retires in-flight figure work", () => {
    const remove = methodSlice(scene, "removePeer(peerId: string)", 900);
    expect(remove).toContain("rig.swapSeq++;");
    expect(remove).toContain("this.cancelFigureProbe(rig);");
  });

  it("self teardown retires in-flight figure work the same way", () => {
    const self = methodSlice(scene, "setSelfFigure(peer: WorldPeer | null)", 700);
    expect(self).toContain("this.selfRig.swapSeq++;");
    expect(self).toContain("this.cancelFigureProbe(this.selfRig);");
  });
});

describe("world-perf C — creator-room portraits load once per scene", () => {
  it("the portrait cache exists with loaded/waiter entries", () => {
    expect(scene).toContain("const creatorPortraitCache = new Map<");
    expect(scene).toContain("function creatorPortraitTexture(");
  });

  it("the dressing asks the cache — no bare per-rebuild TextureLoader load of the portrait", () => {
    expect(scene).toContain("creatorPortraitTexture(d.portraitUrl, portraitMat);");
    expect(scene).not.toContain("new THREE.TextureLoader().load(\n        d.portraitUrl,");
  });

  it("a failed portrait drops its entry so a later visit retries", () => {
    const loader = methodSlice(scene, "function creatorPortraitTexture(", 2400);
    expect(loader).toContain("creatorPortraitCache.delete(url)");
    expect(loader).toContain("entry.waiters");
  });

  it("scene dispose retires every cached portrait texture", () => {
    const dispose = methodSlice(scene, "for (const entry of creatorPortraitCache.values())", 200);
    expect(dispose).toContain("entry.tex.dispose()");
    expect(dispose).toContain("creatorPortraitCache.clear()");
  });
});

describe("world-perf — the earlier cuts stayed cut", () => {
  it("presence guard art walks the shared CDN-first stand-in plan", () => {
    const load = methodSlice(scene, "private loadGuardArt", 1500);
    expect(load).toContain("fixtureStandinArtPlan(");
    expect(load).toContain("guardCharacterUrl(import.meta.env.BASE_URL, variant)");
    /* guardCharacterUrl resolves through the media CDN (figure.ts),
     * so the first plan leg IS the CDN — the same URL the fixture
     * stand-ins request, one download for both. */
    const figure = read("./figure.ts");
    expect(figure).toContain("return mediaUrl(GUARD_CHARACTER_PATHS[variant]);");
  });

  it("fixture stand-ins still share one walk per art per build", () => {
    expect(fixturesScene).toContain("const sharedStandins = new Map<string, Promise<THREE.Texture>>();");
    expect(fixturesScene).toContain("buildStandin(def, shadowTex, sharedStandins)");
  });

  it("fixture bodies still load once and clone to their posts", () => {
    expect(fixturesScene).toContain("const bodyGroup = template.clone(true);");
  });
});
