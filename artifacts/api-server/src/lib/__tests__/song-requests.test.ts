/**
 * Pure rule-gate tests for the Song Requests service (N18): every
 * decline that can be known before money moves is decided by
 * checkSongAgainstRules, so these cases are the "charged nothing"
 * guarantee's foundation. No DB: the gate is a pure function.
 */
import { describe, it, expect } from "vitest";
import {
  checkSongAgainstRules,
  streamIsLive,
  DEFAULT_REQUEST_RULES,
  SONG_REQUEST_REFUND_COPY,
  type CreatorRequestRules,
} from "../song-requests";

const CREATOR = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000cc";
const SONG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ownSong = { id: SONG_ID, user_id: CREATOR };
const foreignSong = { id: SONG_ID, user_id: OTHER };
const rules = (patch: Partial<CreatorRequestRules>): CreatorRequestRules => ({ ...DEFAULT_REQUEST_RULES, ...patch });

describe("checkSongAgainstRules", () => {
  it("defaults: open, catalog-only, no exclusions, no creator minimum", () => {
    expect(DEFAULT_REQUEST_RULES).toEqual({
      requestsOpen: true,
      catalogOnly: true,
      excludedSongIds: [],
      minTipVb: null,
    });
    expect(checkSongAgainstRules(DEFAULT_REQUEST_RULES, ownSong, CREATOR, 100)).toEqual({ ok: true });
  });

  it("closed requests decline everything", () => {
    const r = checkSongAgainstRules(rules({ requestsOpen: false }), ownSong, CREATOR, 500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REQUESTS_CLOSED");
  });

  it("catalog-only declines another creator's song; turning it off allows it", () => {
    const denied = checkSongAgainstRules(DEFAULT_REQUEST_RULES, foreignSong, CREATOR, 500);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("NOT_IN_CATALOG");
    expect(checkSongAgainstRules(rules({ catalogOnly: false }), foreignSong, CREATOR, 500)).toEqual({ ok: true });
  });

  it("an excluded song declines even from the creator's own catalog", () => {
    const r = checkSongAgainstRules(rules({ excludedSongIds: [SONG_ID] }), ownSong, CREATOR, 500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SONG_EXCLUDED");
  });

  it("the creator's minimum is the creator's number — below declines, at/above passes", () => {
    const below = checkSongAgainstRules(rules({ minTipVb: 1000 }), ownSong, CREATOR, 999);
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.code).toBe("BELOW_CREATOR_MINIMUM");
    expect(checkSongAgainstRules(rules({ minTipVb: 1000 }), ownSong, CREATOR, 1000)).toEqual({ ok: true });
    // No creator minimum set = no platform-invented floor in the gate.
    expect(checkSongAgainstRules(rules({ minTipVb: null }), ownSong, CREATOR, 100)).toEqual({ ok: true });
  });
});

describe("streamIsLive", () => {
  it("a fresh live row is live; an ended row is not; a stale live row is not", () => {
    expect(streamIsLive({ status: "live", started_at: new Date() })).toBe(true);
    expect(streamIsLive({ status: "ended", started_at: new Date() })).toBe(false);
    expect(streamIsLive({ status: "live", started_at: new Date(Date.now() - 13 * 60 * 60 * 1000) })).toBe(false);
  });
});

describe("the up-front refund copy", () => {
  it("states the play-or-refund deal in plain words", () => {
    expect(SONG_REQUEST_REFUND_COPY).toContain("refunded in full");
    expect(SONG_REQUEST_REFUND_COPY).toContain("stream ends");
  });
});
