/**
 * pitch-fix.test.ts — UPGRADES 196: Pitch Board ordering.
 * Top = most votes first, ties broken newest-first; Newest = pure
 * createdAt descending. The sorter is pure and never mutates its input.
 */
import { describe, expect, it } from "vitest";
import { sortPitches, type PitchFixSubmission } from "./pitch-fix";

function pitch(id: string, upvoteCount: number, createdAt: string): PitchFixSubmission {
  return {
    id, kind: "pitch", source: "door", submitterUserId: "u", submitterName: "Maya",
    title: id, body: "", why: null, category: "create", page: null, severity: null,
    rating: null, status: "reviewing", moderationStatus: "approved", upvoteCount,
    shippedAt: null, createdAt, updatedAt: createdAt,
  };
}

describe("sortPitches", () => {
  const a = pitch("a", 10, "2026-10-20T00:00:00Z");
  const b = pitch("b", 30, "2026-10-21T00:00:00Z");
  const c = pitch("c", 30, "2026-10-22T00:00:00Z");
  const d = pitch("d", 5, "2026-10-23T00:00:00Z");

  it("top: votes descending, ties newest first", () => {
    expect(sortPitches([a, b, c, d], "top").map((p) => p.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("newest: createdAt descending regardless of votes", () => {
    expect(sortPitches([a, b, c, d], "newest").map((p) => p.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("does not mutate the input array", () => {
    const list = [a, b, c, d];
    sortPitches(list, "top");
    expect(list.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });
});
