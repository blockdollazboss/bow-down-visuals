/**
 * Now-playing overlay client — pure logic (stack900 lane D3).
 * The defensive parse, the progress math, and the expiry rule the
 * overlay page renders by. No DOM, no fetch: the glue is pinned
 * separately in now-playing-wiring.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  formatClock,
  isNowPlayingExpired,
  nowPlayingElapsedSec,
  nowPlayingProgress,
  parseNowPlayingResponse,
  type NowPlayingData,
} from "./now-playing-client";

const START = "2026-10-30T02:00:00.000Z";
const START_MS = Date.parse(START);

function track(over: Partial<NowPlayingData> = {}): NowPlayingData {
  return {
    title: "Midnight Run",
    artist: "Stage Star",
    durationSec: 200,
    startedAt: START,
    expiresAt: "2026-10-30T02:04:05.000Z",
    ...over,
  };
}

describe("parseNowPlayingResponse", () => {
  it("parses a real track and the honest empty answer", () => {
    expect(parseNowPlayingResponse({ nowPlaying: track() })).toEqual(track());
    expect(parseNowPlayingResponse({ nowPlaying: null })).toBeNull();
  });

  it("parses an unknown-duration track (durationSec null)", () => {
    expect(parseNowPlayingResponse({ nowPlaying: track({ durationSec: null }) })?.durationSec).toBeNull();
  });

  it("junk parses to nothing — never an invented track", () => {
    expect(parseNowPlayingResponse(null)).toBeNull();
    expect(parseNowPlayingResponse("song")).toBeNull();
    expect(parseNowPlayingResponse({})).toBeNull();
    expect(parseNowPlayingResponse({ nowPlaying: { title: "X" } })).toBeNull();
    expect(parseNowPlayingResponse({ nowPlaying: track({ durationSec: "200" as never }) })).toBeNull();
    expect(parseNowPlayingResponse({ nowPlaying: track({ artist: "" }) })).toBeNull();
  });

  it("strips anything beyond the public fields (a stray id never reaches the card)", () => {
    const dto = parseNowPlayingResponse({
      nowPlaying: { ...track(), stream_id: "secret", creator_user_id: "secret" },
    });
    expect(Object.keys(dto!).sort()).toEqual(["artist", "durationSec", "expiresAt", "startedAt", "title"]);
  });
});

describe("progress + clock", () => {
  it("progress follows the server's startedAt, clamped at both ends", () => {
    expect(nowPlayingProgress(track(), START_MS)).toBe(0);
    expect(nowPlayingProgress(track(), START_MS + 100_000)).toBe(50);
    expect(nowPlayingProgress(track(), START_MS + 999_000)).toBe(100);
    expect(nowPlayingProgress(track(), START_MS - 5_000)).toBe(0);
  });

  it("no duration, no bar — progress is null, honestly", () => {
    expect(nowPlayingProgress(track({ durationSec: null }), START_MS + 10_000)).toBeNull();
    expect(nowPlayingProgress(track({ durationSec: 0 }), START_MS)).toBeNull();
  });

  it("elapsed seconds + clock format", () => {
    expect(nowPlayingElapsedSec(track(), START_MS + 65_400)).toBe(65);
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(600)).toBe("10:00");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("expiry", () => {
  it("a track is visible until its bound, and gone at it", () => {
    const np = track();
    const expMs = Date.parse(np.expiresAt);
    expect(isNowPlayingExpired(np, expMs - 1)).toBe(false);
    expect(isNowPlayingExpired(np, expMs)).toBe(true);
    expect(isNowPlayingExpired(np, expMs + 60_000)).toBe(true);
  });

  it("an unreadable expiry reads as expired — never immortal", () => {
    expect(isNowPlayingExpired(track({ expiresAt: "junk" }), START_MS)).toBe(true);
  });
});
