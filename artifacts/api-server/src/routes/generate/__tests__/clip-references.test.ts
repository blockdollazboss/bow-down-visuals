/**
 * Multi-reference planning — per-model truth tests.
 *
 * Pins the contract from clip-references.ts: Seedance 2.5 receives the
 * reference SET as unpositioned reference images (SDK: positioned entries
 * are keyframe mode and cannot be mixed with references); Gen-4.5 and
 * Veo 3.1 receive ONE first-frame image — the anchor when one exists,
 * else the highest-priority set member (character → location → product
 * → style) — and every reduction is reported, never silent.
 */
import { describe, it, expect } from "vitest";
import {
  CLIP_REFERENCE_SUPPORT,
  MAX_SCENE_REFERENCES,
  normalizeReferenceSet,
  planClipReferences,
  type SceneReference,
} from "../clip-references";

const CHAR = "https://img.example/character.jpg";
const LOC = "https://img.example/location.jpg";
const PROD = "https://img.example/product.jpg";
const STYLE = "https://img.example/style.jpg";
const CHAIN = "https://img.example/chain-frame.jpg";

const fullSet: SceneReference[] = [
  { role: "style", url: STYLE, label: "Style", source: "brand_kit" },
  { role: "product", url: PROD, label: "Product", source: "pack_prop" },
  { role: "character", url: CHAR, label: "Character", source: "artist_vault" },
  { role: "location", url: LOC, label: "Location", source: "location_library" },
];

describe("per-model support truth", () => {
  it("seedance2_5 is the multi-reference model; gen4.5 and veo3_1 take one first frame", () => {
    expect(CLIP_REFERENCE_SUPPORT.seedance2_5.mode).toBe("reference_images");
    expect(CLIP_REFERENCE_SUPPORT.seedance2_5.maxSubmitted).toBe(MAX_SCENE_REFERENCES);
    expect(CLIP_REFERENCE_SUPPORT["gen4.5"].mode).toBe("single_first_frame");
    expect(CLIP_REFERENCE_SUPPORT["gen4.5"].maxSubmitted).toBe(1);
    expect(CLIP_REFERENCE_SUPPORT.veo3_1.mode).toBe("single_first_frame");
    expect(CLIP_REFERENCE_SUPPORT.veo3_1.maxSubmitted).toBe(1);
  });
});

describe("normalizeReferenceSet", () => {
  it("drops non-HTTPS entries, dedupes by URL, sorts by role priority, caps the set", () => {
    const raw = [
      { role: "style", url: STYLE },
      { role: "character", url: "http://insecure.example/x.jpg" },
      { role: "character", url: CHAR },
      { role: "character", url: CHAR },
      { role: "location", url: LOC },
      { role: "bogus", url: "https://img.example/bogus.jpg" },
      { role: "product", url: PROD },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: "product",
        url: `https://img.example/extra-${i}.jpg`,
      })),
    ];
    const out = normalizeReferenceSet(raw);
    expect(out.length).toBe(MAX_SCENE_REFERENCES);
    expect(out[0]!.url).toBe(CHAR);
    expect(out[1]!.url).toBe(LOC);
    expect(out.every((r) => r.url.startsWith("https://"))).toBe(true);
    expect(new Set(out.map((r) => r.url)).size).toBe(out.length);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeReferenceSet(null)).toEqual([]);
    expect(normalizeReferenceSet("nope")).toEqual([]);
  });
});

describe("seedance2_5 planning", () => {
  it("receives the full set as unpositioned reference images, in priority order", () => {
    const plan = planClipReferences({ model: "seedance2_5", referenceSet: fullSet });
    expect(plan.mode).toBe("reference_images");
    expect(plan.promptImage).toEqual([{ uri: CHAR }, { uri: LOC }, { uri: PROD }, { uri: STYLE }]);
    expect(plan.submittedFromSet).toBe(4);
    expect(plan.setSize).toBe(4);
    expect(plan.reduced).toBe(false);
    expect(plan.note).toBeNull();
  });

  it("puts the continuity anchor first, then the set, deduped", () => {
    const plan = planClipReferences({
      model: "seedance2_5",
      referenceSet: fullSet,
      anchorUrl: CHAIN,
      anchorKind: "previous_scene",
    });
    expect(plan.mode).toBe("reference_images");
    expect(plan.promptImage).toEqual([
      { uri: CHAIN }, { uri: CHAR }, { uri: LOC }, { uri: PROD }, { uri: STYLE },
    ]);
    expect(plan.submittedUrls[0]).toBe(CHAIN);
  });

  it("keeps the legacy string shape for a single reference with no anchor", () => {
    const plan = planClipReferences({
      model: "seedance2_5",
      referenceSet: [{ role: "character", url: CHAR, label: "C", source: "artist_vault" }],
    });
    expect(plan.mode).toBe("single");
    expect(plan.promptImage).toBe(CHAR);
  });

  it("keeps the legacy string shape for an anchor alone (no set)", () => {
    const plan = planClipReferences({ model: "seedance2_5", anchorUrl: CHAR });
    expect(plan.mode).toBe("single");
    expect(plan.promptImage).toBe(CHAR);
    expect(plan.submittedFromSet).toBe(0);
  });

  it("plans text-to-video when there is no anchor and no set", () => {
    const plan = planClipReferences({ model: "seedance2_5" });
    expect(plan.mode).toBe("none");
    expect(plan.promptImage).toBeUndefined();
  });
});

describe("gen4.5 planning (single first frame)", () => {
  it("receives the priority reference — character first — and reports the reduction", () => {
    const plan = planClipReferences({ model: "gen4.5", referenceSet: fullSet });
    expect(plan.mode).toBe("single");
    expect(plan.promptImage).toBe(CHAR);
    expect(plan.singleUrl).toBe(CHAR);
    expect(plan.submittedFromSet).toBe(1);
    expect(plan.reduced).toBe(true);
    expect(plan.note).toMatch(/1 of your 4 references/);
    expect(plan.note).toMatch(/character/);
  });

  it("falls to location when no character is in the set", () => {
    const plan = planClipReferences({
      model: "gen4.5",
      referenceSet: fullSet.filter((r) => r.role !== "character"),
    });
    expect(plan.singleUrl).toBe(LOC);
    expect(plan.note).toMatch(/location/);
  });

  it("the anchor outranks the set, and the note names the chain frame", () => {
    const plan = planClipReferences({
      model: "gen4.5",
      referenceSet: fullSet,
      anchorUrl: CHAIN,
      anchorKind: "previous_scene",
    });
    expect(plan.singleUrl).toBe(CHAIN);
    expect(plan.submittedFromSet).toBe(0);
    expect(plan.reduced).toBe(true);
    expect(plan.note).toMatch(/previous scene's final frame/);
  });

  it("an anchor that IS the set's character counts as 1 of N, not a displacement", () => {
    const plan = planClipReferences({
      model: "gen4.5",
      referenceSet: fullSet,
      anchorUrl: CHAR,
      anchorKind: "single_photo",
    });
    expect(plan.singleUrl).toBe(CHAR);
    expect(plan.submittedFromSet).toBe(1);
    expect(plan.reduced).toBe(true);
    expect(plan.note).toMatch(/1 of your 4 references/);
  });

  it("a one-member set is not a reduction", () => {
    const plan = planClipReferences({
      model: "gen4.5",
      referenceSet: [{ role: "location", url: LOC, label: "L", source: "location_library" }],
    });
    expect(plan.singleUrl).toBe(LOC);
    expect(plan.reduced).toBe(false);
    expect(plan.note).toBeNull();
  });
});

describe("veo3_1 planning (single first frame)", () => {
  it("receives the priority reference and reports the reduction like gen4.5", () => {
    const plan = planClipReferences({ model: "veo3_1", referenceSet: fullSet });
    expect(plan.mode).toBe("single");
    expect(plan.singleUrl).toBe(CHAR);
    expect(plan.reduced).toBe(true);
    expect(plan.note).toMatch(/Cinematic uses 1 of your 4 references/);
  });
});
