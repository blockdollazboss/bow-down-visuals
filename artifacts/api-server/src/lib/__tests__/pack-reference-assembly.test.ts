/**
 * Pack-lock reference assembly — Turbo Reference Casting tests.
 *
 * The finalize route loads every source with owner-scoped queries and
 * passes ONLY the caller's own material in; these tests pin the pure
 * matching on top of that: character from the pack's vault, location
 * matched to the shot, product from the shot's imaged hero props, style
 * from the brand-kit logo — plus plain-language gaps when a role is
 * missing. A vault that isn't the caller's never reaches this function
 * (the route passes null), and the null case is pinned here: no
 * character reference appears, and the gap says why.
 */
import { describe, it, expect } from "vitest";
import {
  assembleShotReferenceSet,
  type ReferenceAssemblySources,
} from "../pack-reference-assembly";
import type { PackAsset, PackProp } from "@workspace/db";

const VAULT_URL = "https://img.example/vault-photo.jpg";
const THRONE_URL = "https://img.example/throne-room.jpg";
const ROOFTOP_URL = "https://img.example/rooftop.jpg";
const CROWN_URL = "https://img.example/gold-crown.jpg";
const LOGO_URL = "https://img.example/brand-logo.png";

const props: PackProp[] = [
  { name: "Gold Crown", description: "gold crown", shots: [1, 2], assetImageUrl: CROWN_URL },
  { name: "Silk Robe", description: "silk robe", shots: [2], assetImageUrl: null },
];
const assets: PackAsset[] = [
  { id: "a1", category: "Location", label: "Throne Room", prompt: "", imageUrl: THRONE_URL, createdAt: "2026-01-01T00:00:00Z" },
  { id: "a2", category: "Prop", label: "Crown Plate", prompt: "", imageUrl: CROWN_URL, createdAt: "2026-01-01T00:00:00Z" },
];

function sources(over: Partial<ReferenceAssemblySources> = {}): ReferenceAssemblySources {
  return {
    vault: { artistName: "King Test", referenceImageUrl: VAULT_URL },
    assets,
    locations: [{ label: "Rooftop Studio", imageUrl: ROOFTOP_URL }],
    brandLogoUrl: LOGO_URL,
    bibleLocations: "Throne Room, Rooftop Studio",
    ...over,
  };
}

describe("assembleShotReferenceSet", () => {
  it("assembles all four roles in priority order for a matched shot", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 1,
      shotDescription: "The king enters the throne room wearing the crown",
      props,
      namedPropRefs: ["Gold Crown"],
      sources: sources(),
    });
    expect(out.referenceSet.map((r) => r.role)).toEqual(["character", "location", "product", "style"]);
    expect(out.referenceSet.map((r) => r.url)).toEqual([VAULT_URL, THRONE_URL, CROWN_URL, LOGO_URL]);
    expect(out.referenceSet[0]!.source).toBe("artist_vault");
    expect(out.referenceSet[0]!.label).toMatch(/King Test/);
    expect(out.referenceSet[2]!.source).toBe("pack_prop");
    expect(out.referenceSet[3]!.source).toBe("brand_kit");
    expect(out.referenceGaps).toEqual([]);
  });

  it("matches a library location by label words in the shot description", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 2,
      shotDescription: "Performance on the rooftop at night",
      props,
      namedPropRefs: [],
      sources: sources({ assets: [] }),
    });
    const loc = out.referenceSet.find((r) => r.role === "location");
    expect(loc?.url).toBe(ROOFTOP_URL);
    expect(loc?.source).toBe("location_library");
  });

  it("flags a character gap when the pack has no usable vault photo (incl. another member's vault, which the route never loads)", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 1,
      shotDescription: "Throne room entrance",
      props,
      namedPropRefs: [],
      sources: sources({ vault: null }),
    });
    expect(out.referenceSet.find((r) => r.role === "character")).toBeUndefined();
    expect(out.referenceSet.some((r) => r.source === "artist_vault")).toBe(false);
    expect(out.referenceGaps.join(" ")).toMatch(/No character reference/);
  });

  it("flags a location gap when nothing matches and the bible names locations", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 1,
      shotDescription: "Abstract light play, no place visible",
      props,
      namedPropRefs: [],
      sources: sources({ assets: [], locations: [] }),
    });
    expect(out.referenceSet.find((r) => r.role === "location")).toBeUndefined();
    expect(out.referenceGaps).toContain("No location reference for this scene.");
  });

  it("does not flag a location gap when the production names no locations", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 1,
      shotDescription: "Abstract light play",
      props,
      namedPropRefs: [],
      sources: sources({ assets: [], locations: [], bibleLocations: "" }),
    });
    expect(out.referenceGaps).not.toContain("No location reference for this scene.");
  });

  it("uses a single Location plate as the hero location when no label matches", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 1,
      shotDescription: "Slow push-in on the artist",
      props,
      namedPropRefs: [],
      sources: sources({ locations: [] }),
    });
    expect(out.referenceSet.find((r) => r.role === "location")?.url).toBe(THRONE_URL);
  });

  it("flags a named prop that has no plate image, and excludes imageless props from the set", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 2,
      shotDescription: "The king adjusts his robe in the throne room",
      props,
      namedPropRefs: ["Silk Robe"],
      sources: sources(),
    });
    expect(out.referenceSet.some((r) => r.label === "Silk Robe")).toBe(false);
    expect(out.referenceGaps.join(" ")).toMatch(/No product reference image for "Silk Robe"/);
  });

  it("omits the style reference (without a gap) when the brand kit has no logo", () => {
    const out = assembleShotReferenceSet({
      shotNumber: 1,
      shotDescription: "Throne room entrance with crown",
      props,
      namedPropRefs: ["Gold Crown"],
      sources: sources({ brandLogoUrl: null }),
    });
    expect(out.referenceSet.find((r) => r.role === "style")).toBeUndefined();
    expect(out.referenceGaps).toEqual([]);
  });
});
