import { describe, it, expect } from "vitest";
import {
  jukeboxPlaybackNow,
  jukeboxNeedsSeek,
  jukeboxDeniedCopy,
} from "./jukebox-sync";
import type { WorldJukeboxState } from "./world-client";

function state(
  playback: { playing: boolean; positionSec: number } | null,
  entryId = "j1",
): WorldJukeboxState {
  return {
    current: playback
      ? {
          entry: {
            entryId,
            track: {
              id: "track:abc",
              title: "Gold Hour",
              url: "https://cdn.example/gold-hour.mp3",
              durationSec: 200,
              creatorName: "Nova",
              artworkUrl: null,
            },
            addedByPeerId: "p1",
            addedByName: "Nova",
          },
          playback,
        }
      : null,
    queue: [],
  };
}

describe("jukeboxPlaybackNow", () => {
  it("is null when the jukebox is idle or absent", () => {
    expect(jukeboxPlaybackNow(null, 1000, 5000)).toBeNull();
    expect(jukeboxPlaybackNow(state(null), 1000, 5000)).toBeNull();
  });

  it("advances a playing song by the time since receipt", () => {
    const now = jukeboxPlaybackNow(state({ playing: true, positionSec: 30 }), 10_000, 14_500);
    expect(now).toMatchObject({ playing: true, positionSec: 34.5, entryId: "j1" });
    expect(now?.url).toContain("gold-hour.mp3");
  });

  it("holds a paused song at its stamp, however long ago it landed", () => {
    const now = jukeboxPlaybackNow(state({ playing: false, positionSec: 42 }), 10_000, 99_000);
    expect(now).toMatchObject({ playing: false, positionSec: 42 });
  });

  it("never runs backwards when the clock reads earlier than receipt", () => {
    const now = jukeboxPlaybackNow(state({ playing: true, positionSec: 10 }), 10_000, 9_000);
    expect(now?.positionSec).toBe(10);
  });
});

describe("jukeboxNeedsSeek", () => {
  const desired = { url: "u", playing: true, positionSec: 60, entryId: "j1" };
  it("tolerates a breath of drift", () => {
    expect(jukeboxNeedsSeek(desired, 61.5)).toBe(false);
    expect(jukeboxNeedsSeek(desired, 58.2)).toBe(false);
  });
  it("pulls a wandered element back into step", () => {
    expect(jukeboxNeedsSeek(desired, 63)).toBe(true);
    expect(jukeboxNeedsSeek(desired, 55)).toBe(true);
  });
});

describe("jukeboxDeniedCopy", () => {
  it("speaks every refusal the room can send", () => {
    for (const reason of ["guests", "unplayable", "queue-full", "not-yours", "listening-party"]) {
      expect(jukeboxDeniedCopy(reason)).not.toContain(reason);
      expect(jukeboxDeniedCopy(reason).length).toBeGreaterThan(10);
    }
  });
  it("names the party when a party owns the queue", () => {
    expect(jukeboxDeniedCopy("listening-party")).toContain("listening party");
  });
  it("shrugs honestly at an unknown reason", () => {
    expect(jukeboxDeniedCopy("???")).toContain("said no");
  });
});
