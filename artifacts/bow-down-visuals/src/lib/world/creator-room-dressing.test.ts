/**
 * Creator Room dressing choices (THE-GAME Ring 4) — the client
 * seam's tests.
 *
 * Pinned:
 * - the mirror catalog matches the server's list exactly (ids,
 *   bands, names, parameter tuples — the server's own test file
 *   pins the same literals from its side, so the two can only
 *   drift by failing a suite);
 * - the picker's gate is the house gate: at or below it a variant
 *   can be worn (dressing down included), above it the variant
 *   stands visible but locked with the honest reason — and the
 *   grandfather rule flows through gateStarsFor(earned, saved
 *   dial), the earned-rank build's own function;
 * - scene parameters default to the classic tuple (the Phase 5
 *   rendering) for a null dressing — default-equivalence — and
 *   follow the resolved DTO otherwise;
 * - the DTO parser accepts only the catalog's own words;
 * - the wiring is really hung: the page feeds the scene from the
 *   DTO, the scene honors all three parameter axes, and the
 *   picker hangs only in the host's own room (source pins).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gateStarsFor } from "../creator-rank";
import {
  CREATOR_ROOM_DRESSING_VARIANTS,
  DEFAULT_ROOM_DRESSING_PARAMS,
  creatorRoomDressingSceneParams,
  creatorRoomDressingVariantById,
  roomDressingBandName,
  roomDressingLockReason,
  roomDressingOptions,
  roomDressingStyleWords,
} from "./creator-room-dressing";
import {
  parseCreatorRoomDetail,
  parseCreatorRoomDressing,
  type CreatorRoomDressing,
} from "./creator-rooms";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("the mirror catalog", () => {
  it("is the server's list: eighteen variants, three per rung, classic first", () => {
    expect(CREATOR_ROOM_DRESSING_VARIANTS.map((v) => v.id)).toEqual([
      "t1-classic", "t1-bold", "t1-regal",
      "t2-classic", "t2-bold", "t2-regal",
      "t3-classic", "t3-bold", "t3-regal",
      "t4-classic", "t4-bold", "t4-regal",
      "t5-classic", "t5-bold", "t5-regal",
      "t6-classic", "t6-bold", "t6-regal",
    ]);
    expect(creatorRoomDressingVariantById("t4-regal")).toEqual({
      id: "t4-regal",
      band: 4,
      name: "Shot Caller Regal",
      palette: "gilded",
      trimStyle: "crown",
      bannerStyle: "trio",
    });
    expect(creatorRoomDressingVariantById("t2-bold")).toEqual({
      id: "t2-bold",
      band: 2,
      name: "Hustler Bold",
      palette: "inverted",
      trimStyle: "double",
      bannerStyle: "flank",
    });
    expect(creatorRoomDressingVariantById("nope")).toBeNull();
    expect(roomDressingBandName(5)).toBe("Crime Boss");
  });

  it("every classic is the Phase 5 tuple (default-equivalence)", () => {
    for (const v of CREATOR_ROOM_DRESSING_VARIANTS.filter((x) => x.id.endsWith("-classic"))) {
      expect({
        palette: v.palette,
        trimStyle: v.trimStyle,
        bannerStyle: v.bannerStyle,
      }).toEqual(DEFAULT_ROOM_DRESSING_PARAMS);
    }
    expect(DEFAULT_ROOM_DRESSING_PARAMS).toEqual({
      palette: "house",
      trimStyle: "bar",
      bannerStyle: "flank",
    });
  });

  it("the style words name the three parameters in plain language", () => {
    expect(roomDressingStyleWords(creatorRoomDressingVariantById("t1-classic")!)).toBe(
      "House hues · Single trim · Flank banners",
    );
    expect(roomDressingStyleWords(creatorRoomDressingVariantById("t6-regal")!)).toBe(
      "Gilded banners · Crown trim · Three banners",
    );
  });
});

describe("the picker gate", () => {
  it("at ★1 only the first band can be worn; the rest stand locked with reasons", () => {
    const options = roomDressingOptions(1);
    expect(options.filter((o) => !o.locked).map((o) => o.variant.id)).toEqual([
      "t1-classic",
      "t1-bold",
      "t1-regal",
    ]);
    const locked = options.filter((o) => o.locked);
    expect(locked).toHaveLength(15);
    expect(locked[0]!.lockReason).toContain("★2 Hustler");
    expect(options.find((o) => o.variant.id === "t6-regal")!.lockReason).toContain("★6 Kingpin");
  });

  it("the gate opens its own band and everything below it (dressing down is a choice)", () => {
    const open = roomDressingOptions(4).filter((o) => !o.locked).map((o) => o.variant.id);
    expect(open).toContain("t4-regal");
    expect(open).toContain("t1-classic");
    expect(open).toHaveLength(12);
  });

  it("the grandfather rule flows through the house gate: max(earned, saved dial)", () => {
    /* Earned ★2 with a saved ★5 dial gates at ★5 (gateStarsFor
     * is the earned-rank build's own function — the picker feeds
     * its result in, exactly as UserModeContext does). */
    const gate = gateStarsFor(2, 5);
    expect(gate).toBe(5);
    const open = roomDressingOptions(gate).filter((o) => !o.locked).map((o) => o.variant.id);
    expect(open).toContain("t5-bold");
    expect(open).not.toContain("t6-classic");
    /* And with no dial to grandfather, earned ★2 stops at band 2. */
    const earnedOnly = roomDressingOptions(gateStarsFor(2, 1));
    expect(earnedOnly.find((o) => o.variant.id === "t3-classic")!.locked).toBe(true);
  });

  it("the lock reason is the server's sentence", () => {
    expect(roomDressingLockReason(creatorRoomDressingVariantById("t5-regal")!)).toBe(
      "Unlocks at ★5 Crime Boss — dressing from a higher rung.",
    );
  });

  it("an out-of-range gate clamps to the ladder", () => {
    expect(roomDressingOptions(99).every((o) => !o.locked)).toBe(true);
    expect(roomDressingOptions(0).filter((o) => !o.locked)).toHaveLength(3);
  });
});

describe("scene parameters", () => {
  it("a null dressing wears the classic tuple — the pre-choice rendering", () => {
    expect(creatorRoomDressingSceneParams(null)).toEqual(DEFAULT_ROOM_DRESSING_PARAMS);
    expect(creatorRoomDressingSceneParams(undefined)).toEqual(DEFAULT_ROOM_DRESSING_PARAMS);
  });

  it("a resolved dressing's parameters ride through untouched", () => {
    const dressing: CreatorRoomDressing = {
      variantId: "t6-regal",
      band: 6,
      name: "Kingpin Regal",
      palette: "gilded",
      trimStyle: "crown",
      bannerStyle: "trio",
      picked: true,
    };
    expect(creatorRoomDressingSceneParams(dressing)).toEqual({
      palette: "gilded",
      trimStyle: "crown",
      bannerStyle: "trio",
    });
  });
});

describe("the dressing DTO at the boundary", () => {
  const good = {
    variantId: "t3-bold",
    band: 3,
    name: "Gangster Bold",
    palette: "inverted",
    trimStyle: "double",
    bannerStyle: "flank",
    picked: true,
  };

  it("parses a real dressing whole", () => {
    expect(parseCreatorRoomDressing(good)).toEqual(good);
    expect(parseCreatorRoomDressing({ ...good, picked: 1 })?.picked).toBe(false);
  });

  it("anything off-catalog reads as no dressing, never a half-trusted style", () => {
    expect(parseCreatorRoomDressing(null)).toBeNull();
    expect(parseCreatorRoomDressing({ ...good, palette: "neon" })).toBeNull();
    expect(parseCreatorRoomDressing({ ...good, trimStyle: "triple" })).toBeNull();
    expect(parseCreatorRoomDressing({ ...good, bannerStyle: "curtain" })).toBeNull();
    expect(parseCreatorRoomDressing({ ...good, band: 7 })).toBeNull();
    expect(parseCreatorRoomDressing({ ...good, variantId: "" })).toBeNull();
  });

  it("the room detail carries its dressing through the parser", () => {
    const detail = parseCreatorRoomDetail({
      room: { slug: "nova-reyes", displayName: "Nova Reyes", dressing: good },
    });
    expect(detail?.dressing).toEqual(good);
    const bare = parseCreatorRoomDetail({
      room: { slug: "nova-reyes", displayName: "Nova Reyes" },
    });
    expect(bare?.dressing).toBeNull();
  });
});

describe("the wiring (source pins)", () => {
  it("the page dresses the scene from the room DTO's dressing", () => {
    const page = read("../../pages/world.tsx");
    expect(page).toContain("creatorRoomDressingSceneParams(detail.dressing)");
    expect(page).toContain("onRoomDressingChanged={refreshCreatorRoomDressing}");
  });

  it("the scene honors all three parameter axes, defaulting to classic", () => {
    const scene = read("./hall-scene.ts");
    expect(scene).toContain('d.trimStyle === "crown"');
    expect(scene).toContain('d.trimStyle === "double"');
    expect(scene).toContain('palette === "gilded"');
    expect(scene).toContain('palette === "inverted"');
    expect(scene).toContain('bannerStyle === "trio"');
    expect(scene).toContain('bannerStyle !== "none"');
    expect(scene).toContain('d.bannerStyle ?? "flank"');
  });

  it("the picker hangs only in the host's own room, off the walker's slug", () => {
    const rooms = read("../../components/world/native/CreatorRooms.tsx");
    expect(rooms).toContain('data-testid="world-creator-room-dressing-desk"');
    expect(rooms).toContain("isOwnRoom ? (");
    expect(rooms).toContain("putCreatorRoomDressing(slug, variantId, gateStars, token)");
    const panel = read("../../components/world/StationPanel.tsx");
    expect(panel).toContain("isOwnRoom={(props.mySlug ?? null) === slug}");
    expect(panel).toContain("onDressingChanged={props.onRoomDressingChanged}");
  });
});
