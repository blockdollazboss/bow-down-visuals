/**
 * Lane F1 (QC-200 G2) — growth proof for the live-guest pacing maps.
 *
 * The maps' age sweep only removes entries whose newest hit is older
 * than the pacing window, so a flood of FRESH keys (join attempts are
 * keyed by caller IP + invite, watch/chat keys carry client-supplied
 * ids) grows them without bound — every entry is too young to sweep.
 * The contract proven here: a hard cap backstops the sweep, the cap
 * evicts the least-recently-active keys first, and keys that are
 * actively pacing (in-flight) keep their hit history through a flood.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { __guestPacingForTest, __resetGuestPacing } from "../live-guests";

const { joinAttempts, mintAttempts, lastPostAt, windowHit, postTooSoon } =
  __guestPacingForTest;

const PACING_MAX_ENTRIES = 10_000;
const FLOOD = PACING_MAX_ENTRIES + 2_000;
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const JOIN_MAX = 10;

describe("live-guest pacing maps under a fresh-key flood (G2)", () => {
  beforeEach(() => {
    __resetGuestPacing();
  });

  it("joinAttempts: size never exceeds the cap no matter how many fresh keys arrive", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < FLOOD; i++) {
      windowHit(joinAttempts, `203.0.113.${i % 251}:${i}`, JOIN_WINDOW_MS, JOIN_MAX, now);
    }
    expect(joinAttempts.size).toBeLessThanOrEqual(PACING_MAX_ENTRIES);
    // The flood keys that arrived last are the ones still tracked.
    expect(joinAttempts.has(`203.0.113.${(FLOOD - 1) % 251}:${FLOOD - 1}`)).toBe(true);
  });

  it("an actively-pacing key keeps its window through the flood (no torn state)", () => {
    const now = 1_700_000_000_000;
    const hotKey = "198.51.100.7:invite-hot";
    // Nine hits: one below the join cap.
    for (let i = 0; i < JOIN_MAX - 1; i++) {
      expect(windowHit(joinAttempts, hotKey, JOIN_WINDOW_MS, JOIN_MAX, now)).toBe(false);
    }
    // Flood with fresh keys, touching the hot key once more mid-flood
    // so it stays the most-recently-active entry.
    for (let i = 0; i < FLOOD; i++) {
      windowHit(joinAttempts, `203.0.113.${i % 251}:${i}`, JOIN_WINDOW_MS, JOIN_MAX, now);
      if (i === FLOOD / 2) {
        expect(windowHit(joinAttempts, hotKey, JOIN_WINDOW_MS, JOIN_MAX, now)).toBe(false);
      }
    }
    // The hot key's tenth hit landed mid-flood; the eleventh must be refused.
    expect(windowHit(joinAttempts, hotKey, JOIN_WINDOW_MS, JOIN_MAX, now)).toBe(true);
    expect(joinAttempts.get(hotKey)).toHaveLength(JOIN_MAX);
    expect(joinAttempts.size).toBeLessThanOrEqual(PACING_MAX_ENTRIES);
  });

  it("mintAttempts: same cap under flood", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < FLOOD; i++) {
      windowHit(mintAttempts, `host:user-${i}`, 60 * 60 * 1000, 30, now);
    }
    expect(mintAttempts.size).toBeLessThanOrEqual(PACING_MAX_ENTRIES);
  });

  it("lastPostAt: capped under flood, and the freshest key still paces correctly", () => {
    // All writes at the same instant: every entry is brand new, so
    // the 60s age sweep can remove none of them — only a hard cap
    // can bound this map.
    const now = 1_700_000_000_000;
    for (let i = 0; i < FLOOD; i++) {
      expect(postTooSoon(`guest:session-${i}`, now)).toBe(false);
    }
    expect(lastPostAt.size).toBeLessThanOrEqual(PACING_MAX_ENTRIES);
    // The most recent writer is still tracked: an immediate repost is too soon.
    expect(postTooSoon(`guest:session-${FLOOD - 1}`, now + 500)).toBe(true);
  });
});
