import { describe, it, expect } from "vitest";
import { formatTime, FALLBACK_TRACKS } from "./featured-songs";

describe("formatTime", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("handles NaN / Infinity / negatives gracefully", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-3)).toBe("0:00");
  });
});

describe("FALLBACK_TRACKS (theme-song default)", () => {
  it("points at the Bow Down Visuals theme song", () => {
    const track = FALLBACK_TRACKS[0]!;
    expect(track.id).toBe("theme-song");
    expect(track.audio_url).toContain("bow-down-visuals-theme.mp3");
    expect(track.title).toContain("Theme Song");
    expect(track.artist).toBe("Bow Down Visuals");
  });
});
