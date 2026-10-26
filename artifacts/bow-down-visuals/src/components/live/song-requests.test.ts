/**
 * Pure-helper tests for the Song Requests surfaces (N18): the up-front
 * rule lines are built ONLY from server-sent facts (no invented
 * minimums or suggested amounts), and queue status labels state the
 * refund outcome honestly.
 */
import { describe, it, expect } from "vitest";
import { upfrontRuleLines, requestStatusLabel, type RequestRulesDto, type SongRequestDto } from "@/lib/song-requests";

const bounds = { minVb: 100, maxVb: 1_000_000 };
const baseRules: RequestRulesDto = { requestsOpen: true, catalogOnly: true, excludedSongIds: [], minTipVb: null };

describe("upfrontRuleLines", () => {
  it("catalog-only is stated when the rule is on, house-catalog when off", () => {
    expect(upfrontRuleLines(baseRules, bounds)[0]).toContain("own catalog");
    expect(upfrontRuleLines({ ...baseRules, catalogOnly: false }, bounds)[0]).toContain("house catalog");
  });

  it("no creator minimum set → no minimum line is invented", () => {
    const lines = upfrontRuleLines(baseRules, bounds);
    expect(lines.some((l) => l.includes("minimum tip"))).toBe(false);
    expect(lines.some((l) => l.includes("Request tips run"))).toBe(true);
  });

  it("a creator-set minimum is stated in the creator's own number", () => {
    const lines = upfrontRuleLines({ ...baseRules, minTipVb: 2500 }, bounds);
    expect(lines.some((l) => l.includes("minimum tip") && l.includes("2,500"))).toBe(true);
  });

  it("excluded songs are flagged only when the creator excluded some", () => {
    expect(upfrontRuleLines(baseRules, bounds).some((l) => l.includes("not requestable"))).toBe(false);
    expect(
      upfrontRuleLines({ ...baseRules, excludedSongIds: ["s1"] }, bounds).some((l) => l.includes("not requestable")),
    ).toBe(true);
  });
});

const dto = (patch: Partial<SongRequestDto>): SongRequestDto => ({
  id: "r1",
  streamId: "s1",
  songId: "song1",
  songTitle: "Golden Hour",
  amountVb: 500,
  status: "queued",
  position: 2,
  fanUserId: "fan1",
  fan: { displayName: "Front Row Fan", avatarUrl: null, slug: null },
  refunded: false,
  createdAt: new Date(0).toISOString(),
  playedAt: null,
  ...patch,
});

describe("requestStatusLabel", () => {
  it("queued shows the real position", () => {
    expect(requestStatusLabel(dto({}))).toBe("#2 in line");
  });
  it("playing and played read plainly", () => {
    expect(requestStatusLabel(dto({ status: "playing", position: null }))).toBe("Now playing");
    expect(requestStatusLabel(dto({ status: "played", position: null }))).toBe("Played");
  });
  it("skipped/expired state the refund when it landed", () => {
    expect(requestStatusLabel(dto({ status: "skipped", position: null, refunded: true }))).toContain("tip refunded");
    expect(requestStatusLabel(dto({ status: "expired", position: null, refunded: true }))).toContain("tip refunded");
    expect(requestStatusLabel(dto({ status: "skipped", position: null, refunded: false }))).not.toContain("refunded");
  });
});
