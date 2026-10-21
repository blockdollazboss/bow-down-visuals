/**
 * Unit tests for the Identity Set selection + coverage lib
 * (lib/identity-set.ts) — the explainable label-fit pick and the
 * coverage coaching behind Vault Identity Sets (Higgsfield G4).
 * Pure functions, no DB: the pool is built by hand here.
 */
import { describe, it, expect } from "vitest";
import {
  deriveShotNeeds,
  scoreIdentityCandidate,
  selectIdentityPhoto,
  identityCoverage,
  type IdentityCandidate,
} from "../identity-set";

const cand = (over: Partial<IdentityCandidate>): IdentityCandidate => ({
  id: "p1",
  imageUrl: "https://cdn.example/p1.jpg",
  angle: "front",
  expression: "neutral",
  wardrobe: null,
  source: "upload",
  isMain: false,
  ...over,
});

const main = cand({ id: "main", imageUrl: "https://cdn.example/main.jpg", isMain: true });

describe("deriveShotNeeds", () => {
  it("defaults to front-family angles and no expression", () => {
    const needs = deriveShotNeeds({ promptText: "artist performs in a warehouse" });
    expect(needs.angles[0]).toBe("front");
    expect(needs.expression).toBeNull();
    expect(needs.wardrobe).toBeNull();
  });

  it("orbit camera movement wants profile angles", () => {
    const needs = deriveShotNeeds({ cameraMovement: "slow orbit around the artist" });
    expect(needs.angles).toContain("left_profile");
    expect(needs.angles).toContain("right_profile");
  });

  it("close-up wording wants the close-up angle", () => {
    const needs = deriveShotNeeds({ promptText: "extreme close-up on her face" });
    expect(needs.angles[0]).toBe("close_up");
  });

  it("full-body wording wants the full-body angle", () => {
    const needs = deriveShotNeeds({ actionText: "full body wide shot, head to toe" });
    expect(needs.angles[0]).toBe("full_body");
  });

  it("performance wording wants the singing expression", () => {
    const needs = deriveShotNeeds({ promptText: "singing into a vintage mic on stage" });
    expect(needs.expression).toBe("singing");
  });

  it("mood wording feeds the expression need", () => {
    const needs = deriveShotNeeds({ mood: "serious and dramatic" });
    expect(needs.expression).toBe("serious");
  });

  it("passes the wardrobe hint through, trimmed", () => {
    const needs = deriveShotNeeds({ wardrobeHint: "  stage outfit  " });
    expect(needs.wardrobe).toBe("stage outfit");
  });
});

describe("scoreIdentityCandidate", () => {
  const needs = { angles: ["left_profile", "right_profile"] as const, expression: null, wardrobe: null };

  it("exact angle scores highest", () => {
    const s = scoreIdentityCandidate(cand({ angle: "left_profile" }), { ...needs, angles: [...needs.angles] });
    expect(s.score).toBe(50);
    expect(s.matchedAngle).toBe(true);
  });

  it("a neighboring angle scores partial credit", () => {
    const s = scoreIdentityCandidate(cand({ angle: "three_quarter_left" }), { ...needs, angles: [...needs.angles] });
    expect(s.score).toBe(20);
    expect(s.nearAngle).toBe(true);
    expect(s.matchedAngle).toBe(false);
  });

  it("exact expression beats same-family expression", () => {
    const exact = scoreIdentityCandidate(cand({ expression: "smile" }), {
      angles: ["front"], expression: "smile", wardrobe: null,
    });
    const family = scoreIdentityCandidate(cand({ expression: "laughing" }), {
      angles: ["front"], expression: "smile", wardrobe: null,
    });
    expect(exact.matchedExpression).toBe(true);
    expect(family.nearExpression).toBe(true);
    expect(exact.score).toBeGreaterThan(family.score);
  });

  it("wardrobe label match adds credit", () => {
    const s = scoreIdentityCandidate(cand({ wardrobe: "Red stage outfit" }), {
      angles: ["front"], expression: null, wardrobe: "stage outfit",
    });
    expect(s.matchedWardrobe).toBe(true);
    expect(s.score).toBe(70);
  });
});

describe("selectIdentityPhoto", () => {
  it("empty pool returns null", () => {
    expect(selectIdentityPhoto([], { angles: ["front"], expression: null, wardrobe: null })).toBeNull();
  });

  it("picks the profile photo for an orbit shot, with a reason naming the angle", () => {
    const profile = cand({ id: "prof", angle: "left_profile", imageUrl: "https://cdn.example/prof.jpg" });
    const sel = selectIdentityPhoto([main, profile], deriveShotNeeds({ cameraMovement: "orbit" }));
    expect(sel!.chosen.id).toBe("prof");
    expect(sel!.overridden).toBe(false);
    expect(sel!.reason).toContain("left profile");
  });

  it("a manual override always wins, even over a better-scoring photo", () => {
    const profile = cand({ id: "prof", angle: "left_profile" });
    const sel = selectIdentityPhoto([main, profile], deriveShotNeeds({ cameraMovement: "orbit" }), "main");
    expect(sel!.chosen.id).toBe("main");
    expect(sel!.overridden).toBe(true);
    expect(sel!.reason).toContain("Your pick");
  });

  it("ties break toward the main photo", () => {
    const twin = cand({ id: "twin", angle: "front", expression: "neutral" });
    const sel = selectIdentityPhoto([twin, main], { angles: ["front"], expression: null, wardrobe: null });
    expect(sel!.chosen.id).toBe("main");
  });

  it("a pool of one explains itself as the single-photo behavior", () => {
    const sel = selectIdentityPhoto([main], { angles: ["front"], expression: null, wardrobe: null });
    expect(sel!.chosen.id).toBe("main");
    expect(sel!.reason).toContain("one identity photo");
  });

  it("scored pool is returned best-first for the override picker", () => {
    const profile = cand({ id: "prof", angle: "left_profile" });
    const sel = selectIdentityPhoto([main, profile], deriveShotNeeds({ cameraMovement: "orbit" }));
    expect(sel!.scored[0]!.candidate.id).toBe("prof");
    expect(sel!.scored[0]!.score).toBeGreaterThan(sel!.scored[1]!.score);
  });
});

describe("identityCoverage", () => {
  it("empty pool reports nothing covered and says so", () => {
    const cov = identityCoverage([]);
    expect(cov.coveredCount).toBe(0);
    expect(cov.summary).toContain("No identity photos yet");
    expect(cov.missingMessages.length).toBe(cov.totalCount);
  });

  it("a main photo alone covers only the front view", () => {
    const cov = identityCoverage([main]);
    const front = cov.items.find((i) => i.key === "front")!;
    expect(front.covered).toBe(true);
    expect(cov.missingMessages.some((m) => m.includes("No profile angle yet"))).toBe(true);
    expect(cov.missingMessages.some((m) => m.includes("No full-body shot yet"))).toBe(true);
  });

  it("coverage reflects the set's actual labels", () => {
    const pool = [
      main,
      cand({ id: "a", angle: "left_profile" }),
      cand({ id: "b", angle: "full_body", expression: "smile" }),
      cand({ id: "c", angle: "close_up" }),
      cand({ id: "d", angle: "three_quarter_right" }),
    ];
    const cov = identityCoverage(pool);
    expect(cov.coveredCount).toBe(cov.totalCount);
    expect(cov.missingMessages).toEqual([]);
    expect(cov.summary).toContain("Full coverage");
  });

  it("a second expression covers the expressions item", () => {
    const cov = identityCoverage([main, cand({ id: "s", expression: "smile" })]);
    expect(cov.items.find((i) => i.key === "expressions")!.covered).toBe(true);
  });
});
