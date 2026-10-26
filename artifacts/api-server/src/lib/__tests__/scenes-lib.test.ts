/**
 * Local Scenes (Stack-200 N10) — city identity + directory rule.
 *
 * Pins:
 * - cityKey normalizes ONLY what a creator declared (name part before
 *   the comma, case/spacing-insensitive); it never invents a city.
 * - A declaration with no name part keys to null (declares nothing).
 * - THE DIRECTORY RULE: a city is listed only when ≥1 real creator
 *   declared it — zero-creator aggregates never produce an entry.
 * - Display name = the form the most creators actually wrote.
 * - New York (the launch scene) lists first when it exists.
 */
import { describe, it, expect } from "vitest";
import {
  cityKey,
  cityNamePart,
  citySlug,
  slugToCityKey,
  aggregateSceneDirectory,
  aggregateShowCounts,
} from "../scenes";

describe("cityKey — normalization of declared text only", () => {
  it("takes the name part before the comma, lowercased and collapsed", () => {
    expect(cityKey("New York, NY")).toBe("new york");
    expect(cityKey("  new   york ")).toBe("new york");
    expect(cityKey("ATLANTA, GA")).toBe("atlanta");
    expect(cityKey("Chicago")).toBe("chicago");
  });

  it("keys nothing for empty or nameless declarations", () => {
    expect(cityKey(null)).toBeNull();
    expect(cityKey(undefined)).toBeNull();
    expect(cityKey("")).toBeNull();
    expect(cityKey("   ")).toBeNull();
    expect(cityKey(", NY")).toBeNull();
  });

  it("cityNamePart preserves the creator's own casing", () => {
    expect(cityNamePart("New York, NY")).toBe("New York");
    expect(cityNamePart("bronx, new york")).toBe("bronx");
    expect(cityNamePart("")).toBeNull();
  });

  it("slug round-trips through slugToCityKey", () => {
    expect(citySlug("new york")).toBe("new-york");
    expect(slugToCityKey("new-york")).toBe("new york");
    expect(slugToCityKey(citySlug("los angeles"))).toBe("los angeles");
  });
});

describe("aggregateSceneDirectory — the directory rule", () => {
  it("lists only cities with at least one real declared creator", () => {
    const entries = aggregateSceneDirectory(
      [
        { declared_city: "New York, NY", creator_count: 2 },
        { declared_city: "new york", creator_count: 1 },
        { declared_city: "Atlanta, GA", creator_count: 1 },
        { declared_city: "", creator_count: 5 },
        { declared_city: null, creator_count: 3 },
        { declared_city: ", TX", creator_count: 2 },
      ],
      new Map(),
    );
    expect(entries.map((e) => e.slug)).toEqual(["new-york", "atlanta"]);
    expect(entries[0]).toMatchObject({ name: "New York", creator_count: 3 });
    expect(entries[1]).toMatchObject({ name: "Atlanta", creator_count: 1 });
  });

  it("an all-empty declaration set yields an empty directory — no seeded cities", () => {
    expect(aggregateSceneDirectory([], new Map())).toEqual([]);
    expect(
      aggregateSceneDirectory([{ declared_city: null, creator_count: 0 }], new Map()),
    ).toEqual([]);
  });

  it("New York lists first; the rest order by creator count", () => {
    const entries = aggregateSceneDirectory(
      [
        { declared_city: "Atlanta", creator_count: 9 },
        { declared_city: "New York", creator_count: 1 },
        { declared_city: "Chicago", creator_count: 4 },
      ],
      new Map(),
    );
    expect(entries.map((e) => e.slug)).toEqual(["new-york", "atlanta", "chicago"]);
  });

  it("show counts join by normalized key; a city with shows but no creators is NOT listed", () => {
    const showCounts = aggregateShowCounts([
      { city: "Chicago, IL", show_count: 7 },
      { city: "New York, NY", show_count: 2 },
    ]);
    const entries = aggregateSceneDirectory(
      [{ declared_city: "New York", creator_count: 1 }],
      showCounts,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ slug: "new-york", show_count: 2 });
  });
});
