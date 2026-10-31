/**
 * Unit tests for lib/play-counting — the bound on what one source's
 * plays may add to the charts (stack1100 X3).
 *
 * The disease these pin against: both public play doors counted
 * EVERY post, so one address at the doors' own 120/min limiter
 * could mint 7,200 chart plays an hour. The counter's contract:
 * a play always plays; what one source may COUNT for one media is
 * at most once a minute and at most 10 per rolling 24 hours, and
 * the budgets are per source AND per media — a source's plays of
 * one track never spend its budget for another, and two sources
 * never share a budget.
 */
import { describe, expect, it } from "vitest";
import {
  PLAY_COUNT_DAILY_CAP,
  PLAY_COUNT_GAP_MS,
  PLAY_COUNT_WINDOW_MS,
  PlayCounter,
  playSourceKey,
} from "../play-counting";

const T0 = 1_800_000_000_000;
const FAN = playSourceKey("user-fan", null);
const OTHER_FAN = playSourceKey("user-other", null);
const GUEST = playSourceKey(null, "203.0.113.7");
const TRACK = "22222222-2222-4222-8222-222222222222";
const TRACK_B = "23232323-2323-4232-8232-232323232323";
const VIDEO = "33333333-3333-4333-8333-333333333333";

describe("playSourceKey — identity namespacing", () => {
  it("prefers the account when known, falls back to the client IP", () => {
    expect(playSourceKey("user-1", "203.0.113.7")).toBe("u:user-1");
    expect(playSourceKey(null, "203.0.113.7")).toBe("ip:203.0.113.7");
    expect(playSourceKey(undefined, undefined)).toBe("ip:unknown");
  });

  it("an account id and an IP can never collide into one budget", () => {
    expect(playSourceKey("203.0.113.7", null)).not.toBe(playSourceKey(null, "203.0.113.7"));
  });
});

describe("PlayCounter.claim — the gap", () => {
  it("the first play counts; a burst inside the minute counts once", () => {
    const c = new PlayCounter();
    expect(c.claim(FAN, "track", TRACK, T0)).toBe(true);
    for (let i = 1; i <= 59; i++) {
      expect(c.claim(FAN, "track", TRACK, T0 + i * 1000)).toBe(false);
    }
    expect(c.counted(FAN, "track", TRACK, T0 + 59_000)).toBe(1);
  });

  it("a play a full gap later counts again — repeat listening is real", () => {
    const c = new PlayCounter();
    expect(c.claim(FAN, "track", TRACK, T0)).toBe(true);
    expect(c.claim(FAN, "track", TRACK, T0 + PLAY_COUNT_GAP_MS - 1)).toBe(false);
    expect(c.claim(FAN, "track", TRACK, T0 + PLAY_COUNT_GAP_MS)).toBe(true);
    expect(c.counted(FAN, "track", TRACK, T0 + PLAY_COUNT_GAP_MS)).toBe(2);
  });

  it("a refused claim records nothing — refusing never spends budget", () => {
    const c = new PlayCounter();
    expect(c.claim(FAN, "track", TRACK, T0)).toBe(true);
    expect(c.claim(FAN, "track", TRACK, T0 + 30_000)).toBe(false);
    /* If the refused claim had been recorded, the gap would now be
       measured from T0+30s and this would refuse too. */
    expect(c.claim(FAN, "track", TRACK, T0 + PLAY_COUNT_GAP_MS)).toBe(true);
  });
});

describe("PlayCounter.claim — the daily cap", () => {
  it("at most DAILY_CAP counted plays per source per media per rolling day", () => {
    const c = new PlayCounter();
    for (let i = 0; i < PLAY_COUNT_DAILY_CAP; i++) {
      expect(c.claim(FAN, "track", TRACK, T0 + i * PLAY_COUNT_GAP_MS)).toBe(true);
    }
    const afterCap = T0 + PLAY_COUNT_DAILY_CAP * PLAY_COUNT_GAP_MS;
    expect(c.claim(FAN, "track", TRACK, afterCap)).toBe(false);
    expect(c.counted(FAN, "track", TRACK, afterCap)).toBe(PLAY_COUNT_DAILY_CAP);
  });

  it("the window rolls: yesterday's plays stop spending today's budget", () => {
    const c = new PlayCounter();
    for (let i = 0; i < PLAY_COUNT_DAILY_CAP; i++) {
      c.claim(FAN, "track", TRACK, T0 + i * PLAY_COUNT_GAP_MS);
    }
    const nextDay = T0 + PLAY_COUNT_WINDOW_MS + PLAY_COUNT_GAP_MS;
    expect(c.claim(FAN, "track", TRACK, nextDay)).toBe(true);
    expect(c.counted(FAN, "track", TRACK, nextDay)).toBeLessThanOrEqual(PLAY_COUNT_DAILY_CAP);
  });

  it("a scripted burst of 120 posts counts once, not 120 (the minting shape)", () => {
    const c = new PlayCounter();
    let counted = 0;
    for (let i = 0; i < 120; i++) {
      if (c.claim(GUEST, "track", TRACK, T0 + i * 500)) counted++;
    }
    expect(counted).toBe(1);
  });
});

describe("PlayCounter.claim — budgets are per source and per media", () => {
  it("another source's plays never spend this source's budget", () => {
    const c = new PlayCounter();
    expect(c.claim(FAN, "track", TRACK, T0)).toBe(true);
    expect(c.claim(OTHER_FAN, "track", TRACK, T0)).toBe(true);
    expect(c.claim(GUEST, "track", TRACK, T0)).toBe(true);
  });

  it("one media's budget never spends another's — nor the other kind's", () => {
    const c = new PlayCounter();
    expect(c.claim(FAN, "track", TRACK, T0)).toBe(true);
    expect(c.claim(FAN, "track", TRACK_B, T0)).toBe(true);
    expect(c.claim(FAN, "video", VIDEO, T0)).toBe(true);
    /* …while the original key is still inside its own gap. */
    expect(c.claim(FAN, "track", TRACK, T0)).toBe(false);
  });

  it("a capped-out source can still count plays of a different track", () => {
    const c = new PlayCounter();
    for (let i = 0; i < PLAY_COUNT_DAILY_CAP; i++) {
      c.claim(FAN, "track", TRACK, T0 + i * PLAY_COUNT_GAP_MS);
    }
    const t = T0 + PLAY_COUNT_DAILY_CAP * PLAY_COUNT_GAP_MS;
    expect(c.claim(FAN, "track", TRACK, t)).toBe(false);
    expect(c.claim(FAN, "track", TRACK_B, t)).toBe(true);
  });
});
