/* ─── Play counting — what one listener may add to the charts ─────────
   The charts' raw material is the play: one play_events row + the
   counter columns (play_count / view_count / total_plays), written by
   the two public play doors (POST /media/:kind/:id/play and
   POST /discovery/play). Both doors are unauthenticated by design —
   listening is public — and the counting was wide open: the
   discovery door counted EVERY post (one script at its own
   120/min/IP load limiter could mint 7,200 plays an hour from a
   single address), the media door's per-IP gap still allowed
   1,440 counted plays a day per address with no daily bound, the
   owner's plays of their own upload counted toward their own
   chart position, and unpublished uploads accrued counters. Any
   of it puts a track at #1 on Today / This week, permanently
   inflates the all-time counters, and trips the Trend Radar's
   ≥25-plays-in-24h qualification in seconds. The live presence
   cap (stack1100 W4) settled the shape for streams: the
   action stays free and unlimited; what one source may COUNT is
   bounded. This module is that bound for plays, shared by both doors
   so the twins can never drift apart:

   - GAP: the same source's plays of the same media count at most
     once per minute. A play POST is a "someone pressed play" ping,
     not a verified listen — double-fires, client retries and
     scripted bursts inside the minute are one listen, not sixty.
   - CAP: at most 10 counted plays per source per media per rolling
     24 hours. A fan looping a favourite all day is real listening,
     and the first ten count; one listener's loop is not a crowd,
     and a chart that claims "what's popping" must not let it pose
     as one. Minting 100 counted plays now takes ≥10 distinct
     sources over ≥10 minutes each — bounded, not eliminated (the
     same honest posture as W4's presence cap).

   A "source" is the signed-in user when the door knows one (both
   doors resolve the optional session), else the client IP (the app
   sets trust proxy, so req.ip is the real client behind Render).
   Plays that don't count still PLAY — the listener hears the song;
   the response just reports counted:false and no chart input moves:
   no play_events row, no counter bump, no total_plays bump. The
   three writes always move together or not at all, so the windowed
   charts (play_events) and the all-time charts (counter columns)
   can never disagree about a play.

   State is process-local (one Render instance), kept in a
   timestamp-array map pruned to the rolling day on every claim and
   swept/capped with the house sweep-map helpers (the creator-rank
   cache discipline) so client-mintable keys can't grow the heap.
   A restart forgets the pacing — the safe direction is bounded by
   the doors' rate limiter for the first minute after boot. */

import { capMapSize, sweepTtlIfLarge } from "./sweep-map";

export const PLAY_COUNT_GAP_MS = 60_000;
export const PLAY_COUNT_DAILY_CAP = 10;
export const PLAY_COUNT_WINDOW_MS = 24 * 3600_000;

const SWEEP_THRESHOLD = 1000;
const MAX_KEYS = 5000;

/** The pacing key's source half: the account when known, else the
 *  client address. User keys and IP keys live in separate namespaces
 *  so an id can never collide with an address. */
export function playSourceKey(
  userId: string | null | undefined,
  ip: string | null | undefined,
): string {
  if (userId) return `u:${userId}`;
  return `ip:${ip ?? "unknown"}`;
}

export class PlayCounter {
  /* key → ascending counted-play timestamps inside the rolling day.
     The newest element is the key's recency (the sweep-map atOf
     contract for hit-window arrays). */
  private hits = new Map<string, number[]>();

  /**
   * Claim one play: returns true when this play COUNTS (and records
   * it), false when the source is over its gap or its daily cap for
   * this media (and records nothing). Check-and-record is one
   * synchronous step — two concurrent posts can never both slip
   * through the gap the way a check-then-await race would allow.
   */
  claim(sourceKey: string, kind: string, mediaId: string, now: number = Date.now()): boolean {
    const key = `${sourceKey}|${kind}:${mediaId}`;
    const floor = now - PLAY_COUNT_WINDOW_MS;
    const prior = (this.hits.get(key) ?? []).filter((t) => t > floor);
    const last = prior[prior.length - 1];
    if (last !== undefined && now - last < PLAY_COUNT_GAP_MS) return false;
    if (prior.length >= PLAY_COUNT_DAILY_CAP) return false;
    prior.push(now);
    this.hits.set(key, prior);
    sweepTtlIfLarge(this.hits, SWEEP_THRESHOLD, PLAY_COUNT_WINDOW_MS, (arr) => arr[arr.length - 1] ?? 0, now);
    capMapSize(this.hits, MAX_KEYS, (arr) => arr[arr.length - 1] ?? 0);
    return true;
  }

  /** Counted plays currently inside the window for one key — the
   *  read side the tests (and only the tests) need. */
  counted(sourceKey: string, kind: string, mediaId: string, now: number = Date.now()): number {
    const floor = now - PLAY_COUNT_WINDOW_MS;
    return (this.hits.get(`${sourceKey}|${kind}:${mediaId}`) ?? []).filter((t) => t > floor).length;
  }

  reset(): void {
    this.hits.clear();
  }
}

/** The one counter both play doors share — two instances would be
 *  two budgets, and the doors must never disagree. */
export const playCounter = new PlayCounter();

/** Test seam — never used outside tests. */
export function __resetPlayCounterForTests(): void {
  playCounter.reset();
}
