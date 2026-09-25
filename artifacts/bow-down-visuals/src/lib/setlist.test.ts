import { describe, expect, it } from "vitest";
import {
  newSongId,
  formatDuration,
  parseDurationInput,
  totalRuntime,
  knownDurationCount,
  moveSong,
  applyFlowOrder,
  clearFlowAnnotations,
  type SetSong,
} from "./setlist";

function song(partial: Partial<SetSong> = {}): SetSong {
  return {
    id: newSongId(),
    title: "Test Song",
    artist: "",
    durationSec: 0,
    energy: 0,
    stageNote: "",
    ...partial,
  };
}

describe("newSongId", () => {
  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSongId()));
    expect(ids.size).toBe(50);
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(210)).toBe("3:30");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3600)).toBe("60:00");
  });

  it("shows an em dash for unknown durations", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("parseDurationInput", () => {
  it("parses m:ss", () => {
    expect(parseDurationInput("3:30")).toBe(210);
    expect(parseDurationInput("1:05")).toBe(65);
  });

  it("treats bare numbers under 60 as minutes", () => {
    expect(parseDurationInput("3.5")).toBe(210);
    expect(parseDurationInput("4")).toBe(240);
  });

  it("treats bare numbers 60+ as seconds", () => {
    expect(parseDurationInput("210")).toBe(210);
  });

  it("returns 0 for garbage", () => {
    expect(parseDurationInput("")).toBe(0);
    expect(parseDurationInput("abc")).toBe(0);
    expect(parseDurationInput("-3")).toBe(0);
  });
});

describe("totalRuntime / knownDurationCount", () => {
  it("sums known durations, ignores unknowns", () => {
    const songs = [song({ durationSec: 210 }), song({ durationSec: 0 }), song({ durationSec: 180 })];
    expect(totalRuntime(songs)).toBe(390);
    expect(knownDurationCount(songs)).toBe(2);
  });
});

describe("moveSong", () => {
  it("moves a song from one position to another", () => {
    const songs = [song({ title: "A" }), song({ title: "B" }), song({ title: "C" })];
    const next = moveSong(songs, 0, 2);
    expect(next.map((s) => s.title)).toEqual(["B", "C", "A"]);
  });

  it("clamps out-of-range indexes", () => {
    const songs = [song({ title: "A" }), song({ title: "B" })];
    const next = moveSong(songs, 0, 99);
    expect(next.map((s) => s.title)).toEqual(["B", "A"]);
  });

  it("does not mutate the original array", () => {
    const songs = [song({ title: "A" }), song({ title: "B" })];
    moveSong(songs, 0, 1);
    expect(songs.map((s) => s.title)).toEqual(["A", "B"]);
  });
});

describe("applyFlowOrder", () => {
  it("reorders songs and attaches slot badges + AI notes", () => {
    const songs = [song({ title: "A" }), song({ title: "B" }), song({ title: "C" })];
    const next = applyFlowOrder(songs, [
      { index: 2, slot: "opener", note: "Start soft." },
      { index: 0, slot: "peak", note: "Drop it here." },
      { index: 1, slot: "closer", note: "End big." },
    ]);
    expect(next.map((s) => s.title)).toEqual(["C", "A", "B"]);
    expect(next[0]!.slot).toBe("opener");
    expect(next[0]!.aiNote).toBe("Start soft.");
  });

  it("appends songs the AI missed instead of dropping them", () => {
    const songs = [song({ title: "A" }), song({ title: "B" })];
    const next = applyFlowOrder(songs, [{ index: 1, slot: "opener", note: "Only one." }]);
    expect(next.map((s) => s.title)).toEqual(["B", "A"]);
    expect(next[1]!.slot).toBeUndefined();
  });

  it("ignores invalid indexes defensively", () => {
    const songs = [song({ title: "A" })];
    const next = applyFlowOrder(songs, [
      { index: 7, slot: "opener", note: "Bogus." },
      { index: 0, slot: "opener", note: "Real." },
    ]);
    expect(next).toHaveLength(1);
    expect(next[0]!.title).toBe("A");
  });
});

describe("clearFlowAnnotations", () => {
  it("strips slot + aiNote while keeping everything else", () => {
    const songs = [song({ title: "A", slot: "peak", aiNote: "Big." })];
    const next = clearFlowAnnotations(songs);
    expect(next[0]!.slot).toBeUndefined();
    expect(next[0]!.aiNote).toBeUndefined();
    expect(next[0]!.title).toBe("A");
  });
});
