/**
 * Living-loop decision tests (lib/world/figure-loop): guards
 * resolve by variant with their sheet-exact source crops and the
 * still-alpha mask; the King resolves by his vault name; everyone
 * else stands as their still. Plus the playback budget, the mask
 * levels remap, and the mouth-drift speech rule.
 */
import { describe, it, expect } from "vitest";
import {
  loopForGuardVariant,
  loopForCharacterRef,
  loopVideoUrl,
  normalizeCharacterName,
  mouthDriftPercent,
  stillWhileSpeakingForDrift,
  loopSuspendedForSpeech,
  selectLiveLoops,
  remapMaskAlpha,
  MAX_LIVE_LOOPS,
  MASK_INSET_PX,
  MOUTH_DRIFT_RIDE_LIMIT_PERCENT,
  KING_LOOP_MOUTH_DRIFT_PERCENT,
  type FigureLoopDef,
} from "./figure-loop";
import type { MouthBox } from "./lips";
import { HOUSE_GUARD_ID, HOUSE_GUARD_FEMALE_ID } from "./figure";

describe("guard loops", () => {
  it("each guard's loop is its own approved generation, masked through the still's alpha", () => {
    const male = loopForGuardVariant("male");
    expect(male.key).toBe("guard-male");
    expect(male.videoPath).toBe("/world/loops/palace-guard-male-idle-loop.mp4");
    expect(male.posterPath).toBe("/world/loops/palace-guard-male-idle-poster.png");
    expect(male.masked).toBe(true);
    expect(male.stillWhileSpeaking).toBe(false);
    const female = loopForGuardVariant("female");
    expect(female.key).toBe("guard-female");
    expect(female.videoPath).toBe("/world/loops/palace-guard-female-idle-loop.mp4");
    expect(female.masked).toBe(true);
  });

  it("source crops are the mattes' measured sheet boxes (male 36,53 979×2167 / female 44,49 1003×2171 of 1120×2240)", () => {
    const male = loopForGuardVariant("male").sourceCrop!;
    expect(male.x).toBeCloseTo(36 / 1120);
    expect(male.y).toBeCloseTo(53 / 2240);
    expect(male.w).toBeCloseTo(979 / 1120);
    expect(male.h).toBeCloseTo(2167 / 2240);
    const female = loopForGuardVariant("female").sourceCrop!;
    expect(female.x).toBeCloseTo(44 / 1120);
    expect(female.y).toBeCloseTo(49 / 2240);
    expect(female.w).toBeCloseTo(1003 / 1120);
    expect(female.h).toBeCloseTo(2171 / 2240);
  });

  it("loop URLs resolve BASE_URL-aware like the hall's textures", () => {
    expect(loopVideoUrl("/", loopForGuardVariant("male"))).toBe("/world/loops/palace-guard-male-idle-loop.mp4");
    expect(loopVideoUrl("/app/", loopForGuardVariant("female"))).toBe("/app/world/loops/palace-guard-female-idle-loop.mp4");
  });
});

describe("character-ref resolution", () => {
  it("the King resolves by his vault name — case and whitespace forgiving", () => {
    const def = loopForCharacterRef({ id: "vault-123", name: "Shark King" });
    expect(def?.key).toBe("king");
    expect(def?.videoPath).toBe("/world/loops/shark-king-idle-loop.mp4");
    expect(def?.posterPath).toBe("/world/loops/shark-king-idle-poster.png");
    expect(def?.masked).toBe(false);
    expect(def?.sourceCrop).toBeNull();
    expect(loopForCharacterRef({ id: "vault-123", name: "  shark   KING " })?.key).toBe("king");
  });

  it("the King never suspends for speech — measured: no landmarked mouth exists on his still or his loop", () => {
    const def = loopForCharacterRef({ id: "vault-123", name: "Shark King" })!;
    expect(KING_LOOP_MOUTH_DRIFT_PERCENT).toBe(0);
    expect(def.stillWhileSpeaking).toBe(false);
    expect(loopSuspendedForSpeech(def, true)).toBe(false);
  });

  it("any other vault character has no loop — they stand as their still", () => {
    expect(loopForCharacterRef({ id: "vault-9", name: "Nova Vale" })).toBeNull();
    expect(loopForCharacterRef({ id: "vault-9", name: "Shark" })).toBeNull();
    expect(loopForCharacterRef({ id: "vault-9", name: "" })).toBeNull();
  });

  it("house guard picks never resolve here — a picked guard stands as the guard figure, by variant", () => {
    expect(loopForCharacterRef({ id: HOUSE_GUARD_ID, name: "Palace Guard" })).toBeNull();
    expect(loopForCharacterRef({ id: HOUSE_GUARD_FEMALE_ID, name: "Palace Guard — Female" })).toBeNull();
  });

  it("a future vault loop field drops straight in", () => {
    const def = loopForCharacterRef({
      id: "char-77",
      name: "Anyone",
      loopUrl: "https://storage.example/loops/anyone.mp4",
      loopPosterUrl: "https://storage.example/loops/anyone.png",
    });
    expect(def?.key).toBe("vault-char-77");
    expect(def?.masked).toBe(false);
    expect(def && loopVideoUrl("/", def)).toBe("https://storage.example/loops/anyone.mp4");
    // …but never overrides a house guard pick, and blank means absent
    expect(loopForCharacterRef({ id: HOUSE_GUARD_ID, name: "X", loopUrl: "https://e/x.mp4" })).toBeNull();
    expect(loopForCharacterRef({ id: "vault-1", name: "Y", loopUrl: "  " })).toBeNull();
  });

  it("name normalization forgives case and stray whitespace only", () => {
    expect(normalizeCharacterName("  Shark   King ")).toBe("shark king");
    expect(normalizeCharacterName("Shark King")).toBe("shark king");
    expect(normalizeCharacterName("Shark  King!")).not.toBe("shark king");
  });
});

describe("the playback budget", () => {
  const cand = (key: string, distance: number, visible = true) => ({ key, distance, visible });

  it("caps at MAX_LIVE_LOOPS, nearest first", () => {
    const crowd = Array.from({ length: 12 }, (_, i) => cand(`p${i}`, 12 - i));
    const live = selectLiveLoops(crowd);
    expect(live.size).toBe(MAX_LIVE_LOOPS);
    expect(live.has("p11")).toBe(true); // nearest (distance 1)
    expect(live.has("p0")).toBe(false); // farthest (distance 12)
  });

  it("invisible figures never take a slot, however near", () => {
    const live = selectLiveLoops([cand("near-hidden", 0.5, false), cand("far", 9)]);
    expect(live.has("near-hidden")).toBe(false);
    expect(live.has("far")).toBe(true);
  });

  it("honors a smaller cap and breaks distance ties by key, deterministically", () => {
    const cs = [cand("b", 3), cand("a", 3), cand("c", 3)];
    expect([...selectLiveLoops(cs, 2)].sort()).toEqual(["a", "b"]);
    expect(selectLiveLoops(cs, 0).size).toBe(0);
  });
});

describe("the mask levels remap", () => {
  it("kills the faint skirt, saturates the core, ramps between", () => {
    expect(remapMaskAlpha(0)).toBe(0);
    expect(remapMaskAlpha(48)).toBe(0);
    expect(remapMaskAlpha(49)).toBe(2); // (49-48)*1.5 = 1.5 → 2
    expect(remapMaskAlpha(133)).toBe(128); // mid-ramp
    expect(remapMaskAlpha(218)).toBe(255);
    expect(remapMaskAlpha(255)).toBe(255);
    expect(remapMaskAlpha(Number.NaN)).toBe(0);
  });

  it("the mask sits inset a couple of px inside the figure's own edge", () => {
    expect(MASK_INSET_PX).toBe(2);
  });
});

describe("the mouth-drift speech rule", () => {
  const box = (cx: number, cy: number): MouthBox => ({ cx, cy, w: 0.1 });

  it("drift is the max center travel vs the still, in % of frame height (x through the aspect)", () => {
    const still = box(0.5, 0.4);
    // square frame: 0.01 right + 0.01 down → ~1.41%
    expect(mouthDriftPercent([box(0.51, 0.41)], still, 1)).toBeCloseTo(Math.SQRT2, 1);
    // wide frame (aspect 2): a 1%-of-width x travel is 2% of height
    expect(mouthDriftPercent([box(0.51, 0.4)], still, 2)).toBeCloseTo(2, 5);
    // the max across frames wins; nulls are skipped, a null reference means no overlay to drift
    expect(mouthDriftPercent([box(0.5, 0.4), null, box(0.53, 0.4)], still, 1)).toBeCloseTo(3, 5);
    expect(mouthDriftPercent([box(0.9, 0.9)], null, 1)).toBe(0);
    expect(mouthDriftPercent([], still, 1)).toBe(0);
  });

  it("at or under the ride limit the overlay rides; beyond it, speech takes the still", () => {
    expect(MOUTH_DRIFT_RIDE_LIMIT_PERCENT).toBe(2);
    expect(stillWhileSpeakingForDrift(0)).toBe(false);
    expect(stillWhileSpeakingForDrift(2)).toBe(false);
    expect(stillWhileSpeakingForDrift(2.01)).toBe(true);
    expect(stillWhileSpeakingForDrift(7.5)).toBe(true);
  });

  it("suspension needs both the rule and actual speech", () => {
    const def: FigureLoopDef = {
      key: "t", videoPath: "/v.mp4", posterPath: "", sourceCrop: null,
      masked: false, stillWhileSpeaking: true,
    };
    expect(loopSuspendedForSpeech(def, true)).toBe(true);
    expect(loopSuspendedForSpeech(def, false)).toBe(false);
    expect(loopSuspendedForSpeech({ ...def, stillWhileSpeaking: false }, true)).toBe(false);
  });
});
