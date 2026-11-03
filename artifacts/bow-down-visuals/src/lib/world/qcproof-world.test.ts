/**
 * QC-200 PRE-PROOF — WORLD CLUSTER, FE half (Q167, Q168, Q170-FE,
 * Q171, Q173, Q174-FE, Q175, Q176).
 *
 * The ledger marks these points BLOCKED-signed-in: the rendered
 * walk is the owner's verdict and is NOT claimed here. This file
 * pins the CODE CORE each point stands on, at the exact claim
 * level the ledger states, where the standing suites
 * (spawn-integrity, guard-fixtures, quality, stations,
 * drop-spectacle, palace-layout, walked-into-feed, website-switch,
 * enter-world-button, world-client, admin-locks) do not already
 * pin that exact fact. Where a standing suite already pins a
 * fact, this file says so in a comment instead of re-asserting it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  PALACE_LAYOUT,
  palaceRoomLayout,
  groundHeightAt,
  crossingIsFlap,
  ROOM_FLAP_WINDOW_MS,
  ROOM_FLAP_RADIUS_M,
  HALL_ROOM_ID,
  COURTYARD_ID,
  STAGE_GROUNDS_ID,
  LISTENING_GARDENS_ID,
  CREATION_ROW_ID,
  ATELIERS_ID,
  BOARDWALK_ID,
  HEIGHTS_ID,
  type CrossingRecord,
} from "./palace-layout";
import { transferNeedsReseat, TRANSFER_RESEAT_DISTANCE_M } from "./world-client";
import { FIXTURE_BODIES, bodyTexturesLanded } from "./guard-fixtures";
import { FRAME_MONITOR, QUALITY_RUNGS } from "./quality";
import { PALACE_STATIONS, STATION_BY_ID, creatorRoomStations } from "./stations";
import { resolveStationPanel } from "./station-panel";
import {
  GUEST_SIGN_IN_HREF,
  GUEST_SPEAK_PITCH,
  GUEST_EMOTE_PITCH,
  memberControlsVisible,
  stripSlotsFor,
} from "./guest-honest";
import {
  WORLD_LOCK_DEFAULT_MINUTES,
  WORLD_LOCK_MAX_MINUTES,
  worldLockMinutes,
} from "./admin-locks";
import {
  WORLD_LOCKED_OUT_CLOSE_CODE as FE_LOCKED_OUT,
  WORLD_DOOR_LOCKED_CLOSE_CODE as FE_DOOR_LOCKED,
} from "./world-client";
import {
  DROP_WEEKLY_POOL_VB,
  EMPTY_DROP_BOOK,
  dropBookClaimSent,
  dropBookClaimed,
  dropBookDenied,
  dropClaimView,
  dropDeniedLine,
  type DropClaimBook,
} from "./drop-spectacle";
import type { WorldDropState } from "./world-client";
import { isWorldRoute, shouldShowWorldEntry } from "../world-entry";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const hallSceneSrc = read("./hall-scene.ts");
const worldPageSrc = read("../../pages/world.tsx");
const appSrc = read("../../App.tsx");

/* ─── Q167 — spawn ────────────────────────────────────────────────
 * Already pinned by spawn-integrity.test.ts (15 tests): every
 * authored spawn standable / claimed by its room / clamps to
 * itself / at its authored ground height, the membership half of
 * the reseat rule at the three proven seams + the full disc sweep,
 * and spawn-to-spawn min distance 4.70 m > the reseat distance.
 * NOT pinned there: the eight districts' exact spawn coordinates
 * by name, the distance-only boundary at exactly 2.5 m, and the
 * setSpawn ground-height line itself. Pinned here. */
describe("Q167 spawn — the eight districts' authored spawns (exact)", () => {
  const DISTRICTS: Array<{
    label: string;
    roomId: string;
    name: string;
    spawn: { x: number; z: number };
    ground: number;
  }> = [
    { label: "Plaza", roomId: COURTYARD_ID, name: "The King's Plaza", spawn: { x: 0, z: 31.5 }, ground: 0 },
    { label: "Stage Grounds", roomId: STAGE_GROUNDS_ID, name: "Stage Grounds", spawn: { x: -30.2, z: 19.5 }, ground: 0 },
    { label: "Listening Gardens", roomId: LISTENING_GARDENS_ID, name: "Listening Gardens", spawn: { x: -26, z: 36.2 }, ground: 0 },
    { label: "Creation Row", roomId: CREATION_ROW_ID, name: "Creation Row", spawn: { x: 30.2, z: 14.5 }, ground: 0 },
    { label: "Ateliers", roomId: ATELIERS_ID, name: "The Ateliers", spawn: { x: 30.2, z: 40.5 }, ground: 0 },
    { label: "Boardwalk", roomId: BOARDWALK_ID, name: "The Boardwalk", spawn: { x: 0, z: 36.2 }, ground: 0.03 },
    { label: "Creator Heights", roomId: HEIGHTS_ID, name: "Creator Heights", spawn: { x: 14.6, z: 24.6 }, ground: 0 },
    { label: "Hall", roomId: HALL_ROOM_ID, name: "The King's Hall", spawn: { x: 0, z: 9.5 }, ground: 0 },
  ];

  it("all eight districts exist in the layout, named, with the ledger's spawn points", () => {
    expect(DISTRICTS).toHaveLength(8);
    for (const d of DISTRICTS) {
      const room = palaceRoomLayout(d.roomId);
      expect(room, d.label).toBeDefined();
      expect(room!.name, d.label).toBe(d.name);
      expect(room!.spawn, d.label).toEqual(d.spawn);
      expect(PALACE_LAYOUT[d.roomId], d.label).toBeDefined();
    }
  });

  it("every district spawn's Y resolves from groundHeightAt — the deck district proves it is not a hard-coded 0", () => {
    for (const d of DISTRICTS) {
      expect(groundHeightAt(d.spawn.x, d.spawn.z), d.label).toBe(d.ground);
    }
    // The Boardwalk spawn stands on its deck (0.03 m): a hard-coded
    // in-floor / floor-0 placement would bury or float the rig
    // there; groundHeightAt is the only height truth setSpawn reads.
    expect(groundHeightAt(0, 36.2)).toBeGreaterThan(0);
  });

  it("setSpawn places the rig at groundHeightAt(x, z) — never a hard-coded Y", () => {
    const start = hallSceneSrc.indexOf("setSpawn(x: number, z: number)");
    expect(start).toBeGreaterThan(-1);
    const body = hallSceneSrc.slice(start, start + 900);
    expect(body).toContain("this.rig.position.set(p.x, groundHeightAt(p.x, p.z), p.z);");
    expect(body).toContain("this.selfGroundY = this.rig.position.y;");
    expect(body).not.toMatch(/position\.set\(p\.x,\s*0\s*,/);
  });
});

describe("Q167 spawn — transferNeedsReseat, the distance half at its boundary", () => {
  it("the constant is 2.5 m", () => {
    expect(TRANSFER_RESEAT_DISTANCE_M).toBe(2.5);
  });

  it("distance-only (no room named): within and AT 2.5 m never reseat; beyond reseats", () => {
    const rig = { x: 0, z: 0 };
    expect(transferNeedsReseat(rig, { x: 0, z: 0 })).toBe(false);
    expect(transferNeedsReseat(rig, { x: 1, z: 1 })).toBe(false);
    // Exactly at the distance: the rule is a strict > — no reseat.
    expect(transferNeedsReseat(rig, { x: 2.5, z: 0 })).toBe(false);
    expect(transferNeedsReseat(rig, { x: 0, z: -2.5 })).toBe(false);
    // Beyond it: reseat.
    expect(transferNeedsReseat(rig, { x: 2.51, z: 0 })).toBe(true);
    expect(transferNeedsReseat(rig, { x: 3, z: 4 })).toBe(true);
  });
});

/* ─── Q168 — textured figures ─────────────────────────────────────
 * Already pinned by guard-fixtures.test.ts (68 tests): the
 * bodyTexturesLanded decision table. NOT pinned anywhere: the
 * actual GLB files' embedded-image facts. Parsed here from the
 * in-tree files the live loader loads (FIXTURE_BODIES glbPaths).
 *
 * REPLACEMENT NOTE (the ledger's Oct 25 file facts are stale for
 * one body): king-gen.glb was 4,497,528 B in the ledger; the file
 * in this tree is 5,957,644 B — the King body was swapped after
 * the ledger (R4 webtex repair, commit 9700e73ad on this lineage).
 * Both guard files are byte-size-identical to the ledger's. */
interface GlbFacts {
  size: number;
  mimeTypes: string[];
  extensionsRequired: unknown;
  extensionsUsed: unknown;
  textureCount: number;
  jsonText: string;
}

function parseGlb(relPath: string): GlbFacts {
  const buf = readFileSync(resolve(__dirname, "../../../public", `.${relPath}`));
  expect(buf.subarray(0, 4).toString("ascii")).toBe("glTF");
  const jsonLen = buf.readUInt32LE(12);
  const jsonText = buf.subarray(20, 20 + jsonLen).toString("utf8");
  const json = JSON.parse(jsonText) as {
    images?: Array<{ mimeType?: string }>;
    textures?: unknown[];
    extensionsRequired?: unknown;
    extensionsUsed?: unknown;
  };
  return {
    size: buf.length,
    mimeTypes: (json.images ?? []).map((i) => i.mimeType ?? ""),
    extensionsRequired: json.extensionsRequired ?? null,
    extensionsUsed: json.extensionsUsed ?? null,
    textureCount: (json.textures ?? []).length,
    jsonText,
  };
}

describe("Q168 textured figures — the live GLB files, parsed", () => {
  const LIVE: Array<{ body: keyof typeof FIXTURE_BODIES; ledgerSize: number | null; size: number }> = [
    { body: "king", ledgerSize: 4_497_528, size: 5_957_644 },
    { body: "guard-male", ledgerSize: 4_670_132, size: 4_670_132 },
    { body: "guard-female", ledgerSize: 3_977_100, size: 3_977_100 },
  ];

  it("FIXTURE_BODIES points at exactly the three ledger files under /world/", () => {
    expect(FIXTURE_BODIES.king.glbPath).toBe("/world/king-gen.glb");
    expect(FIXTURE_BODIES["guard-male"].glbPath).toBe("/world/guard-gen.glb");
    expect(FIXTURE_BODIES["guard-female"].glbPath).toBe("/world/guard-gen-female.glb");
  });

  for (const { body, ledgerSize, size } of LIVE) {
    it(`${body}: embeds 2× image/jpeg, declares NO extensionsRequired and no webp path`, () => {
      const facts = parseGlb(FIXTURE_BODIES[body].glbPath);
      expect(facts.mimeTypes).toEqual(["image/jpeg", "image/jpeg"]);
      expect(facts.textureCount).toBe(2);
      expect(facts.extensionsRequired).toBeNull();
      expect(facts.jsonText).not.toContain("EXT_texture_webp");
      expect(facts.jsonText).not.toContain("image/webp");
      expect(facts.size).toBe(size);
      if (body === "king") {
        // Replaced since the ledger — see the header note.
        expect(facts.size).not.toBe(ledgerSize);
      } else {
        // Guards untouched since the ledger.
        expect(facts.size).toBe(ledgerSize);
      }
    });
  }

  it("the loader gate keeps the fallback standing: a declared-but-texture-less parse is refused, in logic and in the scene's order", () => {
    // The pure gate (full table in guard-fixtures.test.ts).
    expect(bodyTexturesLanded(2, [{}, {}])).toBe(false);
    expect(bodyTexturesLanded(2, [{ map: {} }])).toBe(true);
    expect(bodyTexturesLanded(0, [])).toBe(true);
    // The scene: the gate is judged (and throws) inside loadBody,
    // and the stand-in is only hidden / the post marked live AFTER
    // a body has actually loaded — a refused parse never swaps in.
    const scene = read("./guard-fixtures-scene.ts");
    expect(scene).toContain("if (bodyTexturesLanded(declared, collectMaterials())) return gltf;");
    expect(scene).toContain("textures did not land for ${url}");
    expect(scene.indexOf("textures did not land")).toBeLessThan(scene.indexOf("slot.live = true"));
    expect(scene).toContain("slot.standin.visible = false;");
  });
});

/* ─── Q170 (FE half) — access law words + lock bounds ─────────────
 * Server enforcement is pinned in the API qcproof file; the FE
 * guest pitch + lock bounds live here. admin-locks.test.ts pins
 * worldLockMinutes clamping in its own table; station-panel.test.ts
 * pins resolveStationPanel's guest-pitch branch. This file pins
 * the claim-level constants + the guest-honest seam itself, which
 * had no dedicated suite. */
describe("Q170 access law (FE) — guests get the sign-in pitch, never a dead control", () => {
  it("the pitches are exact and route back into the palace after sign-in", () => {
    expect(GUEST_SIGN_IN_HREF).toBe("/login?next=/world");
    expect(GUEST_SPEAK_PITCH).toBe("Guests can look and listen — sign in to speak");
    expect(GUEST_EMOTE_PITCH).toBe("Guests can look and listen — sign in to join in");
  });

  it("member-act controls are visible to members only; guests keep only the palace strip slot", () => {
    expect(memberControlsVisible(true)).toBe(false);
    expect(memberControlsVisible(false)).toBe(true);
    expect(stripSlotsFor(true)).toEqual({ quest: false, streak: false, palace: true });
    expect(stripSlotsFor(false)).toEqual({ quest: true, streak: true, palace: true });
  });

  it("a members-only station resolves to the guest pitch for a guest, and opens for a member", () => {
    const songDesk = STATION_BY_ID.get("song-desk")!;
    expect(songDesk.membersOnly).toBe(true);
    expect(resolveStationPanel(songDesk, true).type).toBe("guest-pitch");
    expect(resolveStationPanel(songDesk, false).type).toBe("native");
    const board = STATION_BY_ID.get("kingdom-board")!;
    expect(board.membersOnly).toBe(false);
    expect(resolveStationPanel(board, true).type).toBe("custom");
  });

  it("lock bounds: default 60 minutes, max 7 days, clamped the same way the server parses", () => {
    expect(WORLD_LOCK_DEFAULT_MINUTES).toBe(60);
    expect(WORLD_LOCK_MAX_MINUTES).toBe(7 * 24 * 60);
    expect(worldLockMinutes(undefined)).toBe(60);
    expect(worldLockMinutes(0)).toBe(60);
    expect(worldLockMinutes(90)).toBe(90);
    expect(worldLockMinutes(999_999)).toBe(WORLD_LOCK_MAX_MINUTES);
  });

  it("the client's lock close codes mirror the server's: 4415 person / 4416 door", () => {
    expect(FE_LOCKED_OUT).toBe(4415);
    expect(FE_DOOR_LOCKED).toBe(4416);
  });
});

/* ─── Q171 — perf sliver ──────────────────────────────────────────
 * VERDICT STAYS OWNER-WALK: no numeric entry-to-interactive or
 * fps BUDGET exists anywhere in this tree (the ledger's item-198
 * note: budgets are set from the first real-phone measurement),
 * so the point as specified cannot be suite-proven. What CAN be
 * pinned is the ladder's coded behaviour — quality.test.ts (53
 * tests) pins the monitor's step behaviour end to end; this file
 * pins the exact threshold constants + rung scaling the ledger
 * line names, so a silent retune fails loudly. */
describe("Q171 perf sliver — the adaptive ladder's coded thresholds + rung scaling", () => {
  it("step-down at 20 ms sustained, step-up at 12.5 ms, with hysteresis + cooldown constants", () => {
    expect(FRAME_MONITOR.downMs).toBe(20);
    expect(FRAME_MONITOR.upMs).toBe(12.5);
    expect(FRAME_MONITOR.downMs).toBeGreaterThan(FRAME_MONITOR.upMs); // the dead band IS the hysteresis
    expect(FRAME_MONITOR.downSustainSamples).toBe(90);
    expect(FRAME_MONITOR.upSustainSamples).toBe(480); // climbing back is far more reluctant
    expect(FRAME_MONITOR.cooldownMs).toBe(5000);
    expect(FRAME_MONITOR.windowSize).toBe(60);
    expect(FRAME_MONITOR.maxSampleMs).toBe(100); // hitches dropped, never load
  });

  it("per-rung LOD + shadow scaling is monotone down the ladder", () => {
    expect(QUALITY_RUNGS.low.lodDrawDistance).toBe(60);
    expect(QUALITY_RUNGS.medium.lodDrawDistance).toBe(90);
    expect(QUALITY_RUNGS.high.lodDrawDistance).toBe(120);
    expect(QUALITY_RUNGS.low.shadows).toBe(false);
    expect(QUALITY_RUNGS.low.shadowMapSize).toBe(0);
    expect(QUALITY_RUNGS.medium.shadowMapSize).toBe(2048);
    expect(QUALITY_RUNGS.high.shadowMapSize).toBe(4096);
    expect(QUALITY_RUNGS.low.particleScale).toBeLessThan(QUALITY_RUNGS.medium.particleScale);
    expect(QUALITY_RUNGS.medium.particleScale).toBeLessThan(QUALITY_RUNGS.high.particleScale);
    expect(QUALITY_RUNGS.low.reflectorSize).toBe(0);
  });
});

/* ─── Q173 — parity registry ──────────────────────────────────────
 * stations.test.ts pins the count (44), the kinds census
 * (25 native / 18 custom / 1 stepthrough), unique ids, the full
 * websitePath table and per-room coverage. NOT pinned there: the
 * CREATE / BRAND / PROMOTE / MONEY family census the ledger line
 * names, desk by desk. Pinned here. */
describe("Q173 parity registry — 44 stations, no page kind, all four families present", () => {
  it("counts: 43 fixed stations, unique ids, zero panel.kind \"page\" — creator-room doors included", () => {
    expect(PALACE_STATIONS).toHaveLength(44);
    expect(new Set(PALACE_STATIONS.map((s) => s.id)).size).toBe(44);
    for (const s of PALACE_STATIONS) {
      expect(["native", "custom", "stepthrough"], s.id).toContain(s.panel.kind);
      expect(s.panel.kind, s.id).not.toBe("page");
    }
    const creator = creatorRoomStations("creator:proof-act");
    expect(creator).toHaveLength(4);
    for (const s of creator) expect(s.panel.kind).toBe("custom");
    // Two stations share a NAME (the Kingdom Board stands in the
    // hall and on the plaza monument) — 43 unique names over 44 ids.
    expect(new Set(PALACE_STATIONS.map((s) => s.name)).size).toBe(43);
  });

  it("CREATE family: the editor step-through + the eight create desks + Beats", () => {
    expect(STATION_BY_ID.get("visual-vibes-editor")!.panel).toEqual({
      kind: "stepthrough",
      path: "/video-editor",
    });
    for (const id of [
      "song-desk",
      "video-desk",
      "song-video-desk",
      "cover-art-desk",
      "audio-desk",
      "thumbnail-desk",
      "hook-desk",
      "carousel-desk",
    ]) {
      expect(STATION_BY_ID.get(id)!.panel, id).toEqual({ kind: "native", pattern: "create" });
    }
    expect(STATION_BY_ID.get("song-desk")!.name).toBe("Song Desk");
    expect(STATION_BY_ID.get("video-desk")!.name).toBe("Video Desk");
    expect(STATION_BY_ID.get("song-video-desk")!.name).toBe("Song + Video Desk");
    expect(STATION_BY_ID.get("cover-art-desk")!.name).toBe("Cover Art Desk");
    expect(STATION_BY_ID.get("audio-desk")!.name).toBe("Audio Studio Desk");
    expect(STATION_BY_ID.get("thumbnail-desk")!.name).toBe("Thumbnail Desk");
    expect(STATION_BY_ID.get("hook-desk")!.name).toBe("Hook Desk");
    expect(STATION_BY_ID.get("carousel-desk")!.name).toBe("Carousel Desk");
    expect(STATION_BY_ID.get("beats-desk")!.name).toBe("Beat Marketplace");
  });

  it("BRAND family: Branding Kit, Branding Shop, Press Kit, Jewelry Bench (+ Smart Cards, Merch)", () => {
    expect(STATION_BY_ID.get("branding-kit-desk")!.name).toBe("Branding Kit");
    expect(STATION_BY_ID.get("branding-shop-desk")!.name).toBe("Branding Shop");
    expect(STATION_BY_ID.get("press-kit-desk")!.name).toBe("Press Kit");
    expect(STATION_BY_ID.get("jewelry-bench")!.name).toBe("Jewelry Bench");
    expect(STATION_BY_ID.get("smart-cards-stand")!.name).toBe("Smart Cards");
    expect(STATION_BY_ID.get("merch-bench")!.name).toBe("Merch Bench");
  });

  it("PROMOTE family: the Promote Room station (→ /promote) + the Social / Live / Post Assist native desks exist", () => {
    const promote = STATION_BY_ID.get("promote-room")!;
    expect(promote.name).toBe("Promote Room");
    expect(promote.websitePath).toBe("/promote");
    // The ledger's other PROMOTE desks are native panels behind
    // stations, not stations themselves — their modules are the
    // registry's second layer; assert they exist and are non-trivial.
    for (const rel of ["./social-desk.ts", "./live-desk.ts", "./post-assist.ts"]) {
      expect(read(rel).length, rel).toBeGreaterThan(1000);
    }
    expect(STATION_BY_ID.get("community-hall")!.panel).toEqual({
      kind: "native",
      pattern: "social",
    });
  });

  it("MONEY family: Get Paid Room, Marketplace, Visual Buc Packs, Crowns + the Treasury desks (+ Tip Jar / Payout panels)", () => {
    expect(STATION_BY_ID.get("get-paid-room")!.name).toBe("Get Paid Room");
    expect(STATION_BY_ID.get("get-paid-room")!.websitePath).toBe("/earnings");
    expect(STATION_BY_ID.get("marketplace")!.name).toBe("The Marketplace");
    expect(STATION_BY_ID.get("packs-desk")!.name).toBe("Visual Buc Packs");
    expect(STATION_BY_ID.get("crowns-desk")!.name).toBe("Crowns & Memberships");
    for (const id of ["daily-drop", "shark-drops", "quest-board"]) {
      expect(STATION_BY_ID.get(id)!.roomId, id).toBe("world:treasury");
      expect(STATION_BY_ID.get(id)!.panel.kind, id).toBe("custom");
    }
    // Tip Jar + Payout are native money panels (second layer).
    for (const rel of [
      "../../components/world/native/TipJarDesk.tsx",
      "../../components/world/native/PayoutDesk.tsx",
    ]) {
      expect(read(rel).length, rel).toBeGreaterThan(500);
    }
  });
});

/* ─── Q174 (FE half) — drop claim book ────────────────────────────
 * drop-spectacle.test.ts (19 tests) pins the book against the
 * server's claim flow in depth. Pinned here at claim level: the
 * pool constant, the honest second-claim sequence end to end
 * (sent → claimed → denied with the plain line), and the
 * claimed-out line a second claimant reads. */
describe("Q174 drop claim (FE) — the book transitions honestly; a second claim is denied in plain words", () => {
  const drop: WorldDropState = {
    eventId: "evt-qc174",
    title: "QC Drop",
    roomId: "world:courtyard",
    roomName: "Courtyard",
    amountVb: 200,
    claimCap: 1,
    claimsLeft: 1,
  };

  it("the FE pool mirror is 1,000 VB/week", () => {
    expect(DROP_WEEKLY_POOL_VB).toBe(1000);
  });

  it("sent → witnessed-mine → claimed view; another member's witness never claims it for me", () => {
    let book: DropClaimBook = dropBookClaimSent(EMPTY_DROP_BOOK, drop);
    expect(dropClaimView(drop, false, book)).toBe("open");
    book = dropBookClaimed(book, drop, false); // someone else's claim
    expect(book.claimedId).toBeNull();
    book = dropBookClaimed(book, drop, true); // mine
    expect(book).toEqual({ claimedId: drop.eventId, sentId: null });
    expect(dropClaimView(drop, false, book)).toBe("claimed");
    expect(dropClaimView(drop, true, EMPTY_DROP_BOOK)).toBe("guest");
    expect(dropClaimView({ ...drop, claimsLeft: 0 }, false, EMPTY_DROP_BOOK)).toBe("out");
  });

  it("a second claim after mine landed resolves through already-claimed, and the denial lines are plain", () => {
    let book: DropClaimBook = { claimedId: drop.eventId, sentId: null };
    book = dropBookDenied(book, drop, "already-claimed");
    expect(book.claimedId).toBe(drop.eventId);
    expect(dropDeniedLine("already-claimed")).toBe(
      "You've claimed this drop already — one claim per member per drop.",
    );
    expect(dropDeniedLine("claimed-out")).toBe(
      "Every claim on this drop was just taken — first come, and the room was faster.",
    );
    expect(dropDeniedLine("guests")).toBe("Drops are for members — sign in to claim.");
    expect(dropDeniedLine("budget")).toContain("1,000 VB weekly pool");
  });
});

/* ─── Q175 — flap + grammar ───────────────────────────────────────
 * palace-layout.test.ts pins crossingIsFlap's cases; walked-into-
 * feed.test.ts pins the page's guard + single append site. Pinned
 * here: the exact constants at their boundaries, the hall-scene
 * consultation (crossedInto returns BEFORE any room flip/feed),
 * and the composed entry line for the Hall — exactly
 * "You walked into The King's Hall.", no "the The". */
describe("Q175 flap + grammar — an oscillating crossing stays silent; the entry line is exact", () => {
  const last: CrossingRecord = { from: COURTYARD_ID, to: HALL_ROOM_ID, atMs: 10_000, x: 0, z: 12.4 };

  it("constants: 3,000 ms window, 1.5 m radius — boundaries inclusive, beyond is a real crossing", () => {
    expect(ROOM_FLAP_WINDOW_MS).toBe(3000);
    expect(ROOM_FLAP_RADIUS_M).toBe(1.5);
    expect(crossingIsFlap(null, { room: COURTYARD_ID, x: 0, z: 12.4 }, 10_100)).toBe(false);
    // Reversal back to the room just left, at the window + radius edges: flap.
    expect(crossingIsFlap(last, { room: COURTYARD_ID, x: 0, z: 12.4 }, 13_000)).toBe(true);
    expect(crossingIsFlap(last, { room: COURTYARD_ID, x: 1.5, z: 12.4 }, 10_400)).toBe(true);
    // One ms past the window, or one step past the radius: a real crossing.
    expect(crossingIsFlap(last, { room: COURTYARD_ID, x: 0, z: 12.4 }, 13_001)).toBe(false);
    expect(crossingIsFlap(last, { room: COURTYARD_ID, x: 1.51, z: 12.4 }, 10_400)).toBe(false);
    // Continuing INTO the new room is never a flap.
    expect(crossingIsFlap(last, { room: HALL_ROOM_ID, x: 0, z: 12.4 }, 10_400)).toBe(false);
  });

  it("hall-scene crossedInto consults the guard and returns before flipping the room or firing the feed", () => {
    const start = hallSceneSrc.indexOf("private crossedInto(");
    expect(start).toBeGreaterThan(-1);
    const body = hallSceneSrc.slice(start, start + 1100);
    const guardAt = body.indexOf("crossingIsFlap(this.lastCrossing");
    const flipAt = body.indexOf("this.currentRoom = roomId;");
    const feedAt = body.indexOf("this.onRoomEnter?.(roomId);");
    expect(guardAt).toBeGreaterThan(-1);
    expect(body.slice(guardAt, flipAt)).toContain("return;");
    expect(guardAt).toBeLessThan(flipAt);
    expect(flipAt).toBeLessThan(feedAt);
  });

  it('the entry line composes exactly "You walked into The King\'s Hall." — the room name carries its own "The"', () => {
    const hall = PALACE_LAYOUT[HALL_ROOM_ID]!;
    expect(hall.name).toBe("The King's Hall");
    const line = `You walked into ${hall.name}.`;
    expect(line).toBe("You walked into The King's Hall.");
    expect(line).not.toContain("the The");
    // The page's one append site uses exactly this composition.
    expect(worldPageSrc).toContain("body: `You walked into ${room.name}.`");
    expect(worldPageSrc.split("You walked into ${room.name}").length - 1).toBe(1);
  });
});

/* ─── Q176 — reverse doors ────────────────────────────────────────
 * website-switch.test.ts (7 tests) pins the Switch control +
 * header mount; enter-world-button.test.ts pins the shell door's
 * visibility rule, guest access, AppShell mount and profile door.
 * Pinned here at claim level: the Switch mount line carries NO
 * guest/status condition of its own, and the App mount is the
 * single global one beside the theme toggle. */
describe("Q176 reverse doors — Switch in the /world header for everyone; Enter World global, hidden only on /world", () => {
  it("SwitchToWebsite: exact testid, same-tab exit to /, no auth in the component", () => {
    const src = read("../../components/world/SwitchToWebsite.tsx");
    expect(src).toContain('data-testid="world-switch-to-website"');
    expect(src).toContain("href={WEBSITE_HOME_PATH}");
    expect(src).not.toContain("target=");
    expect(src).not.toContain("useAuth");
    expect(src).not.toContain("isGuest");
  });

  it("the /world header mounts the switch on its own unconditional line (guests too)", () => {
    const headerStart = worldPageSrc.indexOf("<header");
    const headerEnd = worldPageSrc.indexOf("</header>");
    const mountLine = worldPageSrc
      .split("\n")
      .find((l) => l.includes("<SwitchToWebsite"));
    expect(mountLine).toBeDefined();
    expect(mountLine!.trim()).toBe("<SwitchToWebsite isLight={isLight} />");
    const mountAt = worldPageSrc.indexOf("<SwitchToWebsite");
    expect(mountAt).toBeGreaterThan(headerStart);
    expect(mountAt).toBeLessThan(headerEnd);
  });

  it("EnterWorldButton is mounted exactly once in App.tsx and hidden ONLY on /world itself", () => {
    expect(appSrc.match(/<EnterWorldButton \/>/g)).toHaveLength(1);
    expect(appSrc).toContain('import { EnterWorldButton } from "@/components/EnterWorldButton";');
    expect(shouldShowWorldEntry("/")).toBe(true);
    expect(shouldShowWorldEntry("/pricing")).toBe(true);
    expect(shouldShowWorldEntry("/artist/thy-cheat-code")).toBe(true);
    expect(shouldShowWorldEntry("/world")).toBe(false);
    expect(shouldShowWorldEntry("/world/")).toBe(false);
    expect(isWorldRoute("/worlds")).toBe(false);
    expect(shouldShowWorldEntry("/worlds")).toBe(true);
  });
});
