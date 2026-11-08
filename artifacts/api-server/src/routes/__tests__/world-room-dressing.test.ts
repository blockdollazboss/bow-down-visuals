/**
 * Creator Room dressing choices (THE-GAME Ring 4) — the pure
 * catalog / gate / resolution / write-decision contract.
 *
 * Pinned:
 * - the catalog is 6 bands × 5 template variants, named with the
 *   ladder's own rung names (lib/creator-rank STAR_TITLES — the
 *   single source), and every band's "classic" carries exactly
 *   the Phase 5 dressing parameters (house / bar / flank), so an
 *   unpicked room renders precisely as it does today;
 * - gating is the earned-rank build's grandfather rule — gate =
 *   max(earned, saved dial), clamped to the ladder — locking only
 *   what stands ABOVE the gate, with an honest reason naming the
 *   rung that opens the variant;
 * - resolution is the server's word: a stored pick resolves for
 *   every visitor, garbage in theme_config reads as no pick, and
 *   an unmeasured room with no pick resolves null (no fabricated
 *   tier) — while a stored pick still resolves then, because it
 *   is recorded state, not a rank claim;
 * - the write decision enforces room authority: only the profile's
 *   owner can pick, everyone else gets the closed door.
 */
import { describe, it, expect } from "vitest";
import { STAR_TITLES } from "../../lib/creator-rank";
import {
  ROOM_DRESSING_VARIANTS,
  ROOM_DRESSING_CONFIG_KEY,
  roomDressingVariantById,
  defaultRoomDressingVariant,
  storedRoomDressingVariant,
  roomDressingGateStars,
  roomDressingSelectable,
  roomDressingLockReason,
  resolveRoomDressing,
  decideRoomDressingWrite,
} from "../../lib/world-room-dressing";

describe("the dressing catalog", () => {
  it("offers exactly five template variants per rung, thirty in all", () => {
    expect(ROOM_DRESSING_VARIANTS).toHaveLength(30);
    for (let band = 1; band <= 6; band++) {
      const inBand = ROOM_DRESSING_VARIANTS.filter((v) => v.band === band);
      expect(inBand.map((v) => v.id)).toEqual([
        `t${band}-classic`,
        `t${band}-bold`,
        `t${band}-regal`,
        `t${band}-shadow`,
        `t${band}-gallery`,
      ]);
    }
  });

  it("names every variant with the ladder's own rung names", () => {
    for (const v of ROOM_DRESSING_VARIANTS) {
      expect(v.name.startsWith(STAR_TITLES[v.band - 1]!)).toBe(true);
    }
    expect(roomDressingVariantById("t1-classic")?.name).toBe("Street Punk Classic");
    expect(roomDressingVariantById("t4-regal")?.name).toBe("Shot Caller Regal");
    expect(roomDressingVariantById("t6-bold")?.name).toBe("Kingpin Bold");
    expect(roomDressingVariantById("t1-shadow")?.name).toBe("Street Punk Shadow");
    expect(roomDressingVariantById("t6-shadow")?.name).toBe("Kingpin Shadow");
    expect(roomDressingVariantById("t1-gallery")?.name).toBe("Street Punk Gallery");
    expect(roomDressingVariantById("t6-gallery")?.name).toBe("Kingpin Gallery");
  });

  it("the classic of every band IS the Phase 5 dressing (default-equivalence)", () => {
    for (let band = 1; band <= 6; band++) {
      const classic = roomDressingVariantById(`t${band}-classic`)!;
      expect(classic.palette).toBe("house");
      expect(classic.trimStyle).toBe("bar");
      expect(classic.bannerStyle).toBe("flank");
      expect(defaultRoomDressingVariant(band)).toBe(classic);
    }
    /* The other styles genuinely differ in the dressing
     * system's own parameters — no new art, no freeform. */
    const bold = roomDressingVariantById("t3-bold")!;
    expect(bold.palette).toBe("inverted");
    expect(bold.trimStyle).toBe("double");
    const regal = roomDressingVariantById("t3-regal")!;
    expect(regal.palette).toBe("gilded");
    expect(regal.trimStyle).toBe("crown");
    expect(regal.bannerStyle).toBe("trio");
    /* Shadow is the bare-walls style: swapped hues, the single
     * bar, and no banners at all — the "none" the vocabulary
     * always carried, finally worn. */
    const shadow = roomDressingVariantById("t3-shadow")!;
    expect(shadow.palette).toBe("inverted");
    expect(shadow.trimStyle).toBe("bar");
    expect(shadow.bannerStyle).toBe("none");
    /* Gallery is the full-wall look without going regal: the
     * house hues and the single classic bar, wearing the third
     * banner regal reserves for gilded gold. */
    const gallery = roomDressingVariantById("t3-gallery")!;
    expect(gallery.palette).toBe("house");
    expect(gallery.trimStyle).toBe("bar");
    expect(gallery.bannerStyle).toBe("trio");
  });

  it("the default clamps out-of-range stars to the ladder", () => {
    expect(defaultRoomDressingVariant(0).id).toBe("t1-classic");
    expect(defaultRoomDressingVariant(99).id).toBe("t6-classic");
  });

  it("unknown ids are not variants, from any source", () => {
    expect(roomDressingVariantById("t7-classic")).toBeNull();
    expect(roomDressingVariantById("classic")).toBeNull();
    expect(roomDressingVariantById(42)).toBeNull();
    expect(roomDressingVariantById(null)).toBeNull();
    expect(roomDressingVariantById(undefined)).toBeNull();
  });
});

describe("the stored pick (theme_config)", () => {
  it("reads a valid pick out of the room's state store", () => {
    const cfg = { colors: { primary: "#aa2244" }, [ROOM_DRESSING_CONFIG_KEY]: "t2-regal" };
    expect(storedRoomDressingVariant(cfg)?.id).toBe("t2-regal");
  });

  it("garbage in the store reads as NO pick, never as a variant", () => {
    expect(storedRoomDressingVariant({ [ROOM_DRESSING_CONFIG_KEY]: "solid-gold-everything" })).toBeNull();
    expect(storedRoomDressingVariant({ [ROOM_DRESSING_CONFIG_KEY]: 7 })).toBeNull();
    expect(storedRoomDressingVariant({})).toBeNull();
    expect(storedRoomDressingVariant(null)).toBeNull();
    expect(storedRoomDressingVariant(undefined)).toBeNull();
  });
});

describe("the gate — max(earned, saved dial), the grandfather rule", () => {
  it("earned stars alone open their own band and everything below", () => {
    expect(roomDressingGateStars(3, undefined)).toBe(3);
    expect(roomDressingSelectable(roomDressingVariantById("t3-regal")!, 3)).toBe(true);
    expect(roomDressingSelectable(roomDressingVariantById("t1-bold")!, 3)).toBe(true);
    expect(roomDressingSelectable(roomDressingVariantById("t4-classic")!, 3)).toBe(false);
  });

  it("a saved dial above the earned rank floors the gate (grandfather)", () => {
    expect(roomDressingGateStars(2, 5)).toBe(5);
    expect(roomDressingSelectable(roomDressingVariantById("t5-bold")!, roomDressingGateStars(2, 5))).toBe(true);
    expect(roomDressingSelectable(roomDressingVariantById("t6-classic")!, roomDressingGateStars(2, 5))).toBe(false);
  });

  it("earned stars take over as soon as they pass the dial", () => {
    expect(roomDressingGateStars(6, 2)).toBe(6);
  });

  it("both terms clamp to the ladder; a missing dial is no floor at all", () => {
    expect(roomDressingGateStars(0, null)).toBe(1);
    expect(roomDressingGateStars(99, 99)).toBe(6);
    expect(roomDressingGateStars(4, "six")).toBe(4);
    expect(roomDressingGateStars(4, Number.NaN)).toBe(4);
  });

  it("the locked reason names the rung that opens the variant", () => {
    expect(roomDressingLockReason(roomDressingVariantById("t4-regal")!)).toContain("★4 Shot Caller");
    expect(roomDressingLockReason(roomDressingVariantById("t6-classic")!)).toContain("★6 Kingpin");
  });
});

describe("resolution — what a visitor's room read carries", () => {
  it("an unpicked room resolves the default of its owner's earned band", () => {
    const dto = resolveRoomDressing({ themeConfig: {}, earnedStars: 3 });
    expect(dto).toEqual({
      variantId: "t3-classic",
      band: 3,
      name: "Gangster Classic",
      palette: "house",
      trimStyle: "bar",
      bannerStyle: "flank",
      picked: false,
    });
  });

  it("a stored pick resolves as picked — the owner's choice, not a default", () => {
    const dto = resolveRoomDressing({
      themeConfig: { [ROOM_DRESSING_CONFIG_KEY]: "t2-regal" },
      earnedStars: 5,
    });
    expect(dto?.variantId).toBe("t2-regal");
    expect(dto?.picked).toBe(true);
    expect(dto?.palette).toBe("gilded");
  });

  it("a stored shadow pick resolves with its bare-walls tuple", () => {
    const dto = resolveRoomDressing({
      themeConfig: { [ROOM_DRESSING_CONFIG_KEY]: "t4-shadow" },
      earnedStars: 4,
    });
    expect(dto?.variantId).toBe("t4-shadow");
    expect(dto?.name).toBe("Shot Caller Shadow");
    expect(dto?.picked).toBe(true);
    expect(dto?.palette).toBe("inverted");
    expect(dto?.trimStyle).toBe("bar");
    expect(dto?.bannerStyle).toBe("none");
  });

  it("a stored gallery pick resolves with its full-wall tuple", () => {
    const dto = resolveRoomDressing({
      themeConfig: { [ROOM_DRESSING_CONFIG_KEY]: "t4-gallery" },
      earnedStars: 4,
    });
    expect(dto?.variantId).toBe("t4-gallery");
    expect(dto?.name).toBe("Shot Caller Gallery");
    expect(dto?.picked).toBe(true);
    expect(dto?.palette).toBe("house");
    expect(dto?.trimStyle).toBe("bar");
    expect(dto?.bannerStyle).toBe("trio");
  });

  it("an unmeasured room with no pick resolves null — no fabricated tier", () => {
    expect(resolveRoomDressing({ themeConfig: {}, earnedStars: null })).toBeNull();
    expect(resolveRoomDressing({ themeConfig: null, earnedStars: null })).toBeNull();
  });

  it("a stored pick still resolves when the rank read failed — recorded state, not a rank claim", () => {
    const dto = resolveRoomDressing({
      themeConfig: { [ROOM_DRESSING_CONFIG_KEY]: "t4-bold" },
      earnedStars: null,
    });
    expect(dto?.variantId).toBe("t4-bold");
    expect(dto?.picked).toBe(true);
  });

  it("a garbage stored value falls back to the band default", () => {
    const dto = resolveRoomDressing({
      themeConfig: { [ROOM_DRESSING_CONFIG_KEY]: "everything-gold" },
      earnedStars: 2,
    });
    expect(dto?.variantId).toBe("t2-classic");
    expect(dto?.picked).toBe(false);
  });
});

describe("the write decision — room authority", () => {
  const OWNER = "user-owner";
  const profile = { userId: OWNER };

  it("the owner may pick inside their gate", () => {
    const d = decideRoomDressingWrite({
      profile,
      callerUserId: OWNER,
      variantId: "t3-bold",
      earnedStars: 3,
      savedDial: undefined,
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.variant.id).toBe("t3-bold");
  });

  it("a member who doesn't own the room gets the closed door — and so does a guest's slug probe", () => {
    const d = decideRoomDressingWrite({
      profile,
      callerUserId: "user-stranger",
      variantId: "t1-classic",
      earnedStars: 6,
      savedDial: 6,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(404);
  });

  it("a missing profile is the same closed door", () => {
    const d = decideRoomDressingWrite({
      profile: null,
      callerUserId: OWNER,
      variantId: "t1-classic",
      earnedStars: 6,
      savedDial: 6,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(404);
  });

  it("an unknown variant is a 400, even for the owner", () => {
    const d = decideRoomDressingWrite({
      profile,
      callerUserId: OWNER,
      variantId: "wall-to-wall-gold",
      earnedStars: 6,
      savedDial: undefined,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(400);
  });

  it("a variant above the gate is refused with the honest unlock reason", () => {
    const d = decideRoomDressingWrite({
      profile,
      callerUserId: OWNER,
      variantId: "t5-regal",
      earnedStars: 3,
      savedDial: undefined,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.status).toBe(403);
      expect(d.error).toContain("★5 Crime Boss");
    }
  });

  it("the grandfather floor opens what the earned rank alone would lock", () => {
    const d = decideRoomDressingWrite({
      profile,
      callerUserId: OWNER,
      variantId: "t4-bold",
      earnedStars: 2,
      savedDial: 5,
    });
    expect(d.ok).toBe(true);
  });

  it("ownership is ruled before the gate — a stranger's rank is never consulted into a leak", () => {
    const d = decideRoomDressingWrite({
      profile,
      callerUserId: "user-stranger",
      variantId: "t6-regal",
      earnedStars: 1,
      savedDial: 1,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(404);
  });
});
