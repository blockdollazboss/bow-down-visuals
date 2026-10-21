/**
 * Viral Effects client-seam pins (lib/scene-effects.ts): the conflict
 * rule that warns in Scene Studio before generation, run on the payload
 * shape GET /api/scene-effects/recipes serves.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_STACKED_EFFECTS_CLIENT,
  normalizeCameraMovesClient,
  effectConflictsClient,
  effectNeedsLabel,
  type EffectRecipe,
  type MoveKeywordRule,
} from "../scene-effects";

const KEYWORDS: MoveKeywordRule[] = [
  { move: "whip-pan", keywords: ["whip pan", "whip-pan"] },
  { move: "static-wide", keywords: ["static", "locked-off", "locked off", "tripod", "fixed camera", "no camera movement"] },
  { move: "orbit", keywords: ["orbit", "arc around", "circling"] },
  { move: "dolly-in", keywords: ["dolly in", "dolly-in", "push-in", "push in", "zoom in"] },
];

const bullet: EffectRecipe = {
  id: "bullet-time-freeze",
  name: "Bullet-Time Freeze Arc",
  category: "Camera Energy",
  bestFor: "A big action beat, frozen while the camera orbits it.",
  weave: "At the peak of the action the motion freezes completely…",
  needs: "start-frame",
  conflictsWithMoves: ["static-wide", "handheld", "whip-pan"],
  cameraNeed: "to arc smoothly around the frozen action",
  trendTags: ["freeze", "bullet time", "action"],
  energy: "wild",
};

describe("scene-effects client seam", () => {
  it("stack cap mirrors the server (2)", () => {
    expect(MAX_STACKED_EFFECTS_CLIENT).toBe(2);
  });

  it("normalizes free-text camera direction", () => {
    expect([...normalizeCameraMovesClient("Locked off on a tripod", KEYWORDS)]).toEqual(["static-wide"]);
    expect([...normalizeCameraMovesClient("slow orbit around her", KEYWORDS)]).toEqual(["orbit"]);
    expect(normalizeCameraMovesClient("", KEYWORDS).size).toBe(0);
    expect(normalizeCameraMovesClient(null, KEYWORDS).size).toBe(0);
  });

  it("warns on the known-bad pairing and stays silent on the good one", () => {
    const bad = effectConflictsClient("Static wide, locked-off tripod shot", [bullet], KEYWORDS);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.message).toContain("Bullet-Time Freeze Arc");
    expect(bad[0]!.message).toContain("locked-off static camera");
    expect(effectConflictsClient("Slow orbit around the performer", [bullet], KEYWORDS)).toEqual([]);
  });

  it("needs labels are honest guidance, not fake parameters", () => {
    expect(effectNeedsLabel("none")).toBeNull();
    expect(effectNeedsLabel("start-frame")).toContain("reference photo");
    expect(effectNeedsLabel("end-frame")).toContain("describe it in your prompt");
    expect(effectNeedsLabel("both")).toContain("reference photo");
  });
});
