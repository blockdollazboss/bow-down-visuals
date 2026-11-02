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
 *
 * Round 2 (stack1200) adds:
 *  D. The Screen panel's seven Go-Live desks ride their own
 *     chunk behind a lazy door (LiveDesksPanel), with the
 *     desks'-frame Suspense fallback — they render only inside
 *     that panel, so they load on first open, not with the room.
 *  E. Inside the station panel, the heavy desks ride PER-DESK
 *     chunks behind DeskDoor (Suspense + the house loading
 *     state): opening one station fetches only its desk plus
 *     the shared frame, not the whole desk universe.
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

describe("world-perf round 2 D — the Live desks ride their own chunk", () => {
  const livePanel = read("../../components/world/native/LiveDesksPanel.tsx");

  it("world.tsx no longer imports LiveDesk statically", () => {
    expect(worldPage).not.toContain('from "@/components/world/native/LiveDesk"');
    expect(worldPage).not.toContain("<LiveStudioDesk");
    expect(worldPage).not.toContain("<LivePremiereDesk");
  });

  it("the desks sit behind a lazy dynamic import of the wrapper", () => {
    expect(worldPage).toContain(
      'const LiveDesksPanel = lazy(() => import("@/components/world/native/LiveDesksPanel"));',
    );
  });

  it("the mount stays inside the members-only Screen panel, wrapped in Suspense", () => {
    expect(worldPage).toContain("screenPanelOpen && inHall && !isGuest");
    const mount = methodSlice(worldPage, "<LiveDesksPanel", 400);
    expect(mount).toContain("streamId: stageScreen.streamId");
    expect(mount).toContain("onStreamChange={() => void loadStageTools()}");
    expect(worldPage).toContain("<LiveDesksFallback");
  });

  it("the fallback carries the desks' own frame, not a blank hole", () => {
    const fallback = methodSlice(worldPage, "function LiveDesksFallback", 900);
    expect(fallback).toContain('data-testid="world-live-desks-loading"');
    expect(fallback).toContain("animate-spin");
    expect(fallback).toContain("border-t");
  });

  it("the wrapper renders the seven desks, in order, under the old testid", () => {
    expect(livePanel).toContain('data-testid="world-live-desks"');
    const order = [
      "<LiveStudioDesk",
      "<LiveBackstageDesk",
      "<LiveGuestJoinDesk",
      "<LiveScheduleDesk",
      "<LiveControllerDesk",
      "<LiveWatchDesk",
      "<LivePremiereDesk",
    ];
    let at = -1;
    for (const desk of order) {
      const next = livePanel.indexOf(desk);
      expect(next, `expected ${desk} in LiveDesksPanel`).toBeGreaterThan(at);
      at = next;
    }
  });
});

describe("world-perf round 2 E — desks inside the panel ride per-desk chunks", () => {
  const panel = read("../../components/world/StationPanel.tsx");

  /* The split set: the round-1 panel chunk's heavy modules that
   * serve one station (or one station stack) each. */
  const splitDoors: Array<[string, string]> = [
    ["SocialDesk", "PostOfficeDesk"],
    ["SocialDesk", "CommunityHallBoard"],
    ["SocialWave2", "ExploreDesk"],
    ["SocialWave2", "MyProfileDesk"],
    ["GroupsDesk", "GroupsDesk"],
    ["EventsDesk", "EventsDesk"],
    ["CollabsDesk", "CollabsDesk"],
    ["GamesPanels", "GamesPanel"],
    ["CreatorRooms", "CreatorRoomsDirectory"],
    ["CreatorRooms", "CreatorRoomStation"],
    ["boards/ChartsBoard", "ChartsBoard"],
    ["boards/EarningsBoard", "EarningsBoard"],
    ["boards/StudioBoard", "StudioBoard"],
    ["JewelryBench", "JewelryBench"],
    ["SmartCardsStand", "SmartCardsStand"],
    ["MerchBench", "MerchBench"],
    ["TailDesks", "AccountDesk"],
    ["TailDesks", "GiveawayContestsDesk"],
    ["TailDesks", "JackpotDesk"],
    ["WinnersCirclePanel", "WinnersCirclePanel"],
    ["BeatsDesk", "BeatsDesk"],
  ];

  it("every split desk is a lazy door and no static import of it survives", () => {
    for (const [mod, name] of splitDoors) {
      expect(panel, `${name} lazy door`).toContain(
        `const ${name} = lazy(() => import("@/components/world/native/${mod}")`,
      );
      expect(panel, `${name} static import gone`).not.toMatch(
        new RegExp(`^import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/components/world/native/${mod}";$`, "m"),
      );
    }
  });

  it("lazy desks render behind DeskDoor — the house loading state, never a blank hole", () => {
    const door = methodSlice(panel, "function DeskDoor", 300);
    expect(door).toContain("<Suspense");
    expect(door).toContain("<NativeLoadingState");
    const wraps = panel.split("<DeskDoor").length - 1;
    expect(wraps).toBeGreaterThanOrEqual(20);
  });

  it("representative render sites kept their desks, now doored", () => {
    expect(panel).toContain("<PostOfficeDesk");
    expect(panel).toContain("<BeatsDesk");
    expect(panel).toContain("<CreatorRoomStation");
    expect(panel).toContain("<EarningsBoard");
  });

  it("the stay-static calls hold: small doors and world-chunk families are not lazied", () => {
    expect(panel).not.toContain('from "@/components/world/native/boards";');
    expect(panel).toContain('import { PacksDesk } from "@/components/world/native/PacksDesk";');
    expect(panel).toContain(
      'import { BrandingKitDesk, PressKitDesk, PromoteDesk } from "@/components/world/native/BusinessDesks";',
    );
    expect(panel).not.toContain('lazy(() => import("@/components/world/native/BusinessDesks")');
    expect(panel).not.toContain('lazy(() => import("@/components/world/native/PacksDesk")');
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
