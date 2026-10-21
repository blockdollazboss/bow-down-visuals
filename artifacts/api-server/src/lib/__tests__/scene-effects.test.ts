/**
 * Viral Effects library pins (lib/scene-effects.ts):
 *  - the starter library is a real library (20–30 recipes), every recipe
 *    carries a real prompt construction — never a label over nothing;
 *  - weaving a recipe changes the generation prompt with the recipe's own
 *    construction, and NO effects leaves the prompt byte-identical;
 *  - the camera-conflict rule fires on known-bad pairings and stays silent
 *    on compatible ones;
 *  - the trend matcher only cites trends the creator actually supplied,
 *    and every proposal carries its reasons (approval happens client-side;
 *    the matcher itself applies nothing).
 */
import { describe, it, expect } from "vitest";
import {
  EFFECT_RECIPES,
  MAX_STACKED_EFFECTS,
  EFFECT_STARTER_IDS,
  getEffectRecipe,
  resolveEffectRecipes,
  weaveEffectsBlock,
  normalizeCameraMoves,
  effectConflictsFor,
  matchEffects,
} from "../scene-effects";

describe("recipe library", () => {
  it("ships a starter library of 20–30 recipes", () => {
    expect(EFFECT_RECIPES.length).toBeGreaterThanOrEqual(20);
    expect(EFFECT_RECIPES.length).toBeLessThanOrEqual(30);
  });

  it("has unique ids and unique names", () => {
    expect(new Set(EFFECT_RECIPES.map((r) => r.id)).size).toBe(EFFECT_RECIPES.length);
    expect(new Set(EFFECT_RECIPES.map((r) => r.name)).size).toBe(EFFECT_RECIPES.length);
  });

  it("every recipe is a real construction, honestly labelled", () => {
    for (const r of EFFECT_RECIPES) {
      /* A real prompt construction: a full paragraph of direction, not a tag. */
      expect(r.weave.length, r.id).toBeGreaterThanOrEqual(120);
      expect(r.weave, r.id).not.toMatch(/TODO|lorem|placeholder/i);
      /* Plain-language best-for line for the card. */
      expect(r.bestFor.length, r.id).toBeGreaterThanOrEqual(30);
      expect(r.category.length, r.id).toBeGreaterThan(0);
      expect(r.trendTags.length, r.id).toBeGreaterThanOrEqual(3);
      expect(["none", "start-frame", "end-frame", "both"], r.id).toContain(r.needs);
      /* Conflict explanations must exist wherever a conflict can fire. */
      if (r.conflictsWithMoves.length > 0) {
        expect(r.cameraNeed, r.id).toBeTruthy();
      }
    }
  });

  it("covers the brief's named effect families", () => {
    const names = EFFECT_RECIPES.map((r) => r.name).join(" | ");
    for (const needle of [
      "Bullet-Time",
      "Glitch",
      "Morph",
      "Kaleidoscope",
      "Speed-Ramp",
      "Light Trails",
      "Halftone",
      "VHS",
      "Underwater",
      "Fire",
      "Rain|Storm",
      "Neon Outline",
      "Miniature",
      "Clone",
      "Earth Zoom",
    ]) {
      expect(names).toMatch(new RegExp(needle, "i"));
    }
  });

  it("starter trio ids all exist in the library", () => {
    for (const id of EFFECT_STARTER_IDS) expect(getEffectRecipe(id)).not.toBeNull();
  });
});

describe("resolveEffectRecipes", () => {
  it("dedupes and caps at MAX_STACKED_EFFECTS", () => {
    const { recipes, unknownIds } = resolveEffectRecipes([
      "earth-zoom-out",
      "earth-zoom-out",
      "beat-drop-freeze",
      "clone-multiply",
    ]);
    expect(recipes.map((r) => r.id)).toEqual(["earth-zoom-out", "beat-drop-freeze"]);
    expect(recipes.length).toBe(MAX_STACKED_EFFECTS);
    expect(unknownIds).toEqual([]);
  });

  it("reports unknown ids instead of silently dropping them", () => {
    const { recipes, unknownIds } = resolveEffectRecipes(["not-a-real-effect"]);
    expect(recipes).toEqual([]);
    expect(unknownIds).toEqual(["not-a-real-effect"]);
  });

  it("empty input resolves to nothing", () => {
    expect(resolveEffectRecipes(undefined)).toEqual({ recipes: [], unknownIds: [] });
    expect(resolveEffectRecipes([])).toEqual({ recipes: [], unknownIds: [] });
  });
});

describe("prompt weaving", () => {
  it("no effects → empty block, prompt byte-identical", () => {
    expect(weaveEffectsBlock([])).toBe("");
    const base = "A singer performs under neon rain, cinematic";
    const composed = `${base} Real moving video.${weaveEffectsBlock([])}`;
    expect(composed).toBe(`${base} Real moving video.`);
  });

  it("weaves each picked recipe's own construction into the block", () => {
    const { recipes } = resolveEffectRecipes(["bullet-time-freeze", "neon-outline"]);
    const block = weaveEffectsBlock(recipes);
    for (const r of recipes) {
      expect(block).toContain(`Viral effect — ${r.name}:`);
      expect(block).toContain(r.weave);
    }
    expect(block.startsWith(" ")).toBe(true);
  });
});

describe("camera-conflict rule", () => {
  const bullet = getEffectRecipe("bullet-time-freeze")!;
  const earthZoom = getEffectRecipe("earth-zoom-out")!;
  const lightTrails = getEffectRecipe("light-trails")!;

  it("normalizes free-text camera directions to canonical moves", () => {
    expect([...normalizeCameraMoves("Static locked-off tripod shot")]).toEqual(["static-wide"]);
    expect([...normalizeCameraMoves("Slow dolly-in toward the singer")]).toEqual(["dolly-in"]);
    expect([...normalizeCameraMoves("Smooth orbital arc, gentle crane up")].sort()).toEqual(
      ["crane-up", "orbit"].sort(),
    );
    expect(normalizeCameraMoves("").size).toBe(0);
    expect(normalizeCameraMoves(undefined).size).toBe(0);
  });

  it("fires on the known-bad pairing: bullet-time vs a locked-off static camera", () => {
    const conflicts = effectConflictsFor("Static wide shot, locked off on a tripod", [bullet]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.effectId).toBe("bullet-time-freeze");
    expect(conflicts[0]!.move).toBe("static-wide");
    expect(conflicts[0]!.message).toContain("Bullet-Time Freeze Arc");
    expect(conflicts[0]!.message).toContain("locked-off static camera");
  });

  it("fires on earth-zoom-out vs dolly-in (opposite directions)", () => {
    const conflicts = effectConflictsFor("Slow push-in toward the stage", [earthZoom]);
    expect(conflicts.map((c) => c.move)).toEqual(["dolly-in"]);
  });

  it("fires on light-trails vs a locked-off camera (nothing moves, no trails)", () => {
    const conflicts = effectConflictsFor("Fixed camera, no camera movement", [lightTrails]);
    expect(conflicts).toHaveLength(1);
  });

  it("stays silent on compatible pairings", () => {
    /* Bullet-time WANTS an orbiting camera. */
    expect(effectConflictsFor("Slow orbit around the performer", [bullet])).toEqual([]);
    /* A tracking shot fights nothing in the library. */
    expect(effectConflictsFor("Tracking shot following the singer", [bullet, earthZoom])).toEqual([]);
    /* No camera text → no opinion. */
    expect(effectConflictsFor("", [bullet])).toEqual([]);
    expect(effectConflictsFor(null, [bullet])).toEqual([]);
  });
});

describe("trend matcher", () => {
  it("a supplied trend drives the top proposal and is cited in its trend reason", () => {
    const proposals = matchEffects(
      { promptText: "Singer performs on a rooftop at night", mood: "epic" },
      [
        {
          trend: "Earth zoom-out reveals",
          confidence: 82,
          timeframe: "2-4 weeks",
          reasoning: "Creators open on a face, then reveal the whole city — the scale flip stops thumbs.",
          earlySignals: ["#earthzoom", "drone reveals"],
        },
      ],
    );
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    const top = proposals[0]!;
    expect(top.effectId).toBe("earth-zoom-out");
    expect(top.source).toBe("trend");
    expect(top.trendReason).toContain("Earth zoom-out reveals");
    expect(top.trendReason).toContain("82% confidence");
    expect(top.fitReason.length).toBeGreaterThan(0);
  });

  it("never invents a trend: no supplied trends → trendReason is null", () => {
    const proposals = matchEffects({
      promptText: "A glitchy EDM performance, the performer breaks apart on the drop",
      mood: "intense drop energy",
    });
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0]!.effectId).toBe("glitch-disintegration");
    for (const p of proposals) {
      expect(p.trendReason).toBeNull();
      expect(p.source).toBe("scene");
      expect(p.fitReason.length).toBeGreaterThan(0);
    }
  });

  it("returns at most the requested number of proposals, best first", () => {
    const proposals = matchEffects(
      { promptText: "freeze glitch morph clone spin zoom reveal fire neon rain", mood: "hype" },
      [],
      3,
    );
    expect(proposals.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < proposals.length; i++) {
      expect(proposals[i - 1]!.score).toBeGreaterThanOrEqual(proposals[i]!.score);
    }
  });

  it("an unrelated scene with no signals scores nothing (route falls back to starters)", () => {
    const proposals = matchEffects({ promptText: "A quiet interview in a plain room" }, []);
    expect(proposals).toEqual([]);
  });
});
