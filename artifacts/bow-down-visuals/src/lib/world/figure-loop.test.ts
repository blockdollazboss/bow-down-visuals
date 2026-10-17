/**
 * Living-loop decision tests (lib/world/figure-loop): guards
 * resolve by variant with their sheet-exact source crops and the
 * still-alpha mask; vault characters resolve by IDENTITY — the
 * loopUrl their row carried in the payload, never by name.
 * Plus the playback budget, the mask levels remap, and the
 * mouth-drift speech rule.
 */
import { describe, it, expect } from "vitest";
import {
  loopForGuardVariant,
  loopForCharacterRef,
  loopVideoUrl,
  mouthDriftPercent,
  stillWhileSpeakingForDrift,
  loopSuspendedForSpeech,
  selectLiveLoops,
  remapMaskAlpha,
  MAX_LIVE_LOOPS,
  MASK_INSET_PX,
  MOUTH_DRIFT_RIDE_LIMIT_PERCENT,
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
  it("a vault character's loop resolves by IDENTITY — the loopUrl its row resolved to, keyed by its id", () => {
    const def = loopForCharacterRef({ id: "char-77", loopUrl: "https://storage.example/loops/anyone.mp4" });
    expect(def?.key).toBe("vault-char-77");
    expect(def?.videoPath).toBe("https://storage.example/loops/anyone.mp4");
    expect(def?.posterPath).toBe("");
    expect(def?.masked).toBe(false);
    expect(def?.sourceCrop).toBeNull();
    expect(def && loopVideoUrl("/", def)).toBe("https://storage.example/loops/anyone.mp4");
  });

  it("payload loops never suspend for speech — the one measured character has no landmarked mouth to protect", () => {
    // Measured (figure-loop.ts header): the King's still and all
    // 10 sampled loop frames yield NO mouth box from the hall's own
    // landmarker — there is no overlay position to drift from.
    const def = loopForCharacterRef({ id: "char-king", loopUrl: "https://storage.example/loops/king.mp4" })!;
    expect(def.stillWhileSpeaking).toBe(false);
    expect(loopSuspendedForSpeech(def, true)).toBe(false);
  });

  it("names are NOT keys: a character with no loopUrl has no loop, whatever it is called", () => {
    // The ref type doesn't even carry a name into resolution —
    // these stand for every display name, "Shark King" included:
    // a renamed impostor gains nothing, the real row renamed loses
    // nothing (its loopUrl rides its id).
    expect(loopForCharacterRef({ id: "char-1", loopUrl: null })).toBeNull();
    expect(loopForCharacterRef({ id: "char-1", loopUrl: "  " })).toBeNull();
    expect(loopForCharacterRef({ id: "char-1" })).toBeNull();
    expect(loopForCharacterRef(null)).toBeNull();
    expect(loopForCharacterRef(undefined)).toBeNull();
  });

  it("house guard picks never resolve here — a picked guard stands as the guard figure, by variant", () => {
    expect(loopForCharacterRef({ id: HOUSE_GUARD_ID, loopUrl: "https://e/x.mp4" })).toBeNull();
    expect(loopForCharacterRef({ id: HOUSE_GUARD_FEMALE_ID, loopUrl: "https://e/x.mp4" })).toBeNull();
    expect(loopForCharacterRef({ id: HOUSE_GUARD_ID, loopUrl: null })).toBeNull();
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
