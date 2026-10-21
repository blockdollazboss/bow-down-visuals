import { describe, expect, it } from "vitest";
import { sortSpotlightVaults, splitSpotlightVaults } from "./spotlight";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

function vaultRow(id: string, partial: Record<string, unknown> = {}): ArtistVault {
  return {
    id,
    artist_name: `Character ${id}`,
    created_at: "2026-01-01T00:00:00.000Z",
    spotlight_order: 0,
    ...partial,
  } as unknown as ArtistVault;
}

function roster(n: number): ArtistVault[] {
  return Array.from({ length: n }, (_, i) =>
    vaultRow(`v-${i + 1}`, {
      spotlight_order: i,
      created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    }),
  );
}

describe("sortSpotlightVaults", () => {
  it("orders by spotlight_order first, then most recent", () => {
    const rows = [
      vaultRow("late-order", { spotlight_order: 5, created_at: "2026-03-01T00:00:00.000Z" }),
      vaultRow("first", { spotlight_order: 0, created_at: "2026-01-01T00:00:00.000Z" }),
      vaultRow("same-order-newer", { spotlight_order: 0, created_at: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(sortSpotlightVaults(rows).map((v) => v.id)).toEqual([
      "same-order-newer",
      "first",
      "late-order",
    ]);
  });

  it("does not mutate the input list", () => {
    const rows = roster(4);
    const copy = [...rows];
    sortSpotlightVaults(rows);
    expect(rows).toEqual(copy);
  });
});

describe("splitSpotlightVaults", () => {
  it("small rosters: everyone is featured or nobody is stranded", () => {
    expect(splitSpotlightVaults(roster(0))).toEqual({ featured: [], remaining: [] });
    const two = splitSpotlightVaults(roster(2));
    expect(two.featured).toHaveLength(2);
    expect(two.remaining).toHaveLength(0);
    const three = splitSpotlightVaults(roster(3));
    expect(three.featured).toHaveLength(3);
    expect(three.remaining).toHaveLength(0);
  });

  it("a ten-character roster shows all ten", () => {
    const split = splitSpotlightVaults(sortSpotlightVaults(roster(10)));
    expect(split.featured).toHaveLength(3);
    expect(split.remaining).toHaveLength(7);
  });

  it("characters past the tenth are all in the grid — the G5 fix", () => {
    const sorted = sortSpotlightVaults(roster(14));
    const split = splitSpotlightVaults(sorted);
    expect(split.featured.map((v) => v.id)).toEqual(["v-1", "v-2", "v-3"]);
    expect(split.remaining).toHaveLength(11);
    /* Featured + remaining reconstruct the full roster, in order —
       every character the picker holds is one the page renders. */
    expect([...split.featured, ...split.remaining].map((v) => v.id)).toEqual(
      sorted.map((v) => v.id),
    );
  });
});
