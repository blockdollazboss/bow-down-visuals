/**
 * B-25 (owner ruling, Nov 11, 2026): a presence count is never
 * labeled "people" whole — member peers are exact people, guest
 * peers are per-tab connections, and the label says which is
 * which. These pins hold the split and the wording the palace
 * directory (world page bar + Kingdom Board) renders.
 */
import { describe, expect, it } from "vitest";
import { presenceBreakdown, presenceCountText } from "./presence-label";

describe("presenceBreakdown — the people/connections split", () => {
  it("counts everyone as people when there are no guest connections", () => {
    expect(presenceBreakdown(5, 0)).toEqual({ people: 5, connections: 0 });
  });

  it("splits a mixed room: members are people, guests are connections", () => {
    expect(presenceBreakdown(5, 2)).toEqual({ people: 3, connections: 2 });
  });

  it("an all-guest room is all connections, no people", () => {
    expect(presenceBreakdown(3, 3)).toEqual({ people: 0, connections: 3 });
  });

  it("treats a missing breakdown as no guest connections (older frames)", () => {
    expect(presenceBreakdown(4)).toEqual({ people: 4, connections: 0 });
    expect(presenceBreakdown(4, null)).toEqual({ people: 4, connections: 0 });
  });

  it("clamps a malformed breakdown so the parts never disagree with the count", () => {
    expect(presenceBreakdown(2, 9)).toEqual({ people: 0, connections: 2 });
    expect(presenceBreakdown(2, -1)).toEqual({ people: 2, connections: 0 });
    expect(presenceBreakdown(0, 0)).toEqual({ people: 0, connections: 0 });
  });
});

describe("presenceCountText — the label the directory renders", () => {
  it("labels a members-only room as people, singular and plural", () => {
    expect(presenceCountText(1, 0)).toBe("1 person");
    expect(presenceCountText(5, 0)).toBe("5 people");
  });

  it("labels guest connections as connections, never people", () => {
    expect(presenceCountText(1, 1)).toBe("1 connection");
    expect(presenceCountText(12, 12)).toBe("12 connections");
  });

  it("composes a mixed room: people first, then connections", () => {
    expect(presenceCountText(5, 2)).toBe("3 people · 2 connections");
    expect(presenceCountText(2, 1)).toBe("1 person · 1 connection");
  });

  it("an empty room reads 0 people, as before", () => {
    expect(presenceCountText(0, 0)).toBe("0 people");
  });
});
