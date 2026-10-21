/**
 * Scene reference sets — client planning mirror tests.
 *
 * Pins the per-model truth the Scene Studio picker states out loud:
 * Premium (Seedance 2.5) uses the whole set as reference images;
 * Standard (Gen-4.5) and Cinematic (Veo 3.1) use ONE — the highest
 * priority reference (character → location → product → style) — and the
 * plan says the reduction plainly instead of dropping silently.
 */
import { describe, it, expect } from "vitest";
import {
  buildProposedReferenceSet,
  normalizeReferenceSet,
  planSceneReferences,
  sortReferenceSet,
  type SceneReference,
} from "./scene-references";

const CHAR = "https://img.example/character.jpg";
const CHAR2 = "https://img.example/costar.jpg";
const LOC = "https://img.example/location.jpg";
const PROD = "https://img.example/product.jpg";
const STYLE = "https://img.example/logo.png";

const ref = (role: SceneReference["role"], url: string): SceneReference => ({
  role,
  url,
  label: `${role} ref`,
  source: "upload",
});

describe("buildProposedReferenceSet", () => {
  it("assembles character, location, and style from the creator's own sources, in priority order", () => {
    const set = buildProposedReferenceSet({
      characterPhotoUrl: CHAR,
      characterName: "King Test",
      coStars: [{ name: "Co Star", imageUrl: CHAR2 }],
      locationImageUrl: LOC,
      locationLabel: "Throne Room",
      brandLogoUrl: STYLE,
    });
    expect(set.map((r) => r.url)).toEqual([CHAR, CHAR2, LOC, STYLE]);
    expect(set.map((r) => r.role)).toEqual(["character", "character", "location", "style"]);
    expect(set[0]?.label).toBe("King Test — Artist Vault photo");
    expect(set[0]?.source).toBe("artist_vault");
    expect(set[2]?.source).toBe("location_library");
    expect(set[3]?.source).toBe("brand_kit");
  });

  it("skips missing sources and non-HTTPS URLs — nothing is invented", () => {
    const set = buildProposedReferenceSet({
      characterPhotoUrl: null,
      coStars: [{ name: "No Photo", imageUrl: "" }],
      locationImageUrl: "http://insecure.example/x.jpg",
      brandLogoUrl: null,
    });
    expect(set).toEqual([]);
  });

  it("dedupes when the same image would enter twice", () => {
    const set = buildProposedReferenceSet({
      characterPhotoUrl: CHAR,
      coStars: [{ name: "Same", imageUrl: CHAR }],
    });
    expect(set).toHaveLength(1);
  });
});

describe("normalizeReferenceSet", () => {
  it("drops invalid entries, dedupes, and sorts by role priority", () => {
    const out = normalizeReferenceSet([
      ref("style", STYLE),
      ref("character", CHAR),
      ref("character", CHAR),
      { role: "bogus", url: PROD },
      { role: "product", url: "http://insecure.example/p.jpg" },
      ref("location", LOC),
      "junk",
      null,
    ]);
    expect(out.map((r) => r.url)).toEqual([CHAR, LOC, STYLE]);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeReferenceSet(undefined)).toEqual([]);
    expect(normalizeReferenceSet("nope")).toEqual([]);
  });
});

describe("planSceneReferences — per-model truth", () => {
  const fullSet = [ref("style", STYLE), ref("product", PROD), ref("location", LOC), ref("character", CHAR)];

  it("Premium (Seedance) uses the whole set as reference images", () => {
    const plan = planSceneReferences("seedance2_5", fullSet);
    expect(plan.submittedCount).toBe(4);
    expect(plan.reduced).toBe(false);
    expect(plan.summary).toBe("Premium uses all 4 references.");
  });

  it("Standard (Gen-4.5) uses 1 of N — the character — and says so", () => {
    const plan = planSceneReferences("gen4.5", fullSet);
    expect(plan.submittedCount).toBe(1);
    expect(plan.reduced).toBe(true);
    expect(plan.summary).toMatch(/Standard uses 1 of 4 references/);
    expect(plan.summary).toMatch(/character reference goes first/);
    expect(sortReferenceSet(fullSet)[0]?.url).toBe(CHAR);
  });

  it("Cinematic (Veo) is also single-reference, honestly labeled", () => {
    const plan = planSceneReferences("veo3_1", fullSet);
    expect(plan.submittedCount).toBe(1);
    expect(plan.reduced).toBe(true);
    expect(plan.summary).toMatch(/Cinematic uses 1 of 4 references/);
  });

  it("single-reference model with a one-image set is not a reduction", () => {
    const plan = planSceneReferences("gen4.5", [ref("character", CHAR)]);
    expect(plan.reduced).toBe(false);
    expect(plan.summary).toBe("Standard uses your 1 reference.");
  });

  it("empty set plans nothing and says nothing", () => {
    const plan = planSceneReferences("seedance2_5", []);
    expect(plan).toEqual({ submittedCount: 0, setSize: 0, reduced: false, summary: null });
  });
});
