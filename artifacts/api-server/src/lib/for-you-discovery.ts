/* ── For-You discovery-feed ranking v1 (Wave 3 #19) ─────────────────────
   The releases wire (GET /discovery/feed) with personalization ON.
   Sibling of lib/for-you.ts (the posts feed) — same TRANSPARENCY LAW:
   the ranking factors are named right here, and every item whose
   position or presence is owed to a personal signal carries the
   reason derived from the ACTUAL signal that scored it — never a
   fabricated one.

   Factors (all from behavior the member themselves already recorded
   on this platform — nothing is bought, inferred from third parties,
   or read from anyone else's activity):
     1. follow   — the backbone: releases from followed creators.
                   Worth FOLLOW_BOOST points (≈ 48h of freshness), so
                   recency still rules inside the follow graph.
     2. affinity — the viewer's recorded engagement with the item's
                   creator: plays (play_events), likes (likes), saves
                   (saves), reactions (reactions), reposts (reposts)
                   on that creator's tracks/videos, weighted by
                   DISCOVERY_AFFINITY_WEIGHTS and capped at
                   CREATOR_AFFINITY_CAP points (≈ 2 days of freshness)
                   so history can pull a drop forward but never bury
                   the new behind the old forever.
     3. genre    — the same engagement aggregated by the item's genre,
                   at half weight, capped small (GENRE_AFFINITY_CAP):
                   a taste nudge, never the driver.
     4. recency  — score falls 1 point per hour of age; the window is
                   the feed's usual 30 days.
   There is NO paid boosting and NO crowd-engagement term in v1: no
   factor reads payments, credits, sponsorships, spend, or other
   members' behavior, and none may be added without changing this
   comment and the "why" copy together.

   Discovery surfacing: a NON-followed creator's release may enter
   the feed only when the viewer's own affinity clears a threshold —
   creator affinity ≥ DISCOVERY_CREATOR_THRESHOLD, or the item's
   genre affinity ≥ DISCOVERY_GENRE_THRESHOLD — the member's own
   profile is never surfaced, and surfaced items are capped at
   DISCOVERY_SHARE of the returned list and always labeled
   (source: "discovery" + a why line). Nothing is silently mixed.

   Cold start: a member with zero recorded engagement events gets
   the legacy feed untouched — the route short-circuits before any
   of this math runs. */

export const DISCOVERY_AFFINITY_WEIGHTS = {
  play: 1, // a play of the creator's track/video (play_events)
  like: 2, // a like on the creator's track/video (likes)
  save: 3, // a save of the creator's track/video (saves)
  reaction: 3, // a reaction on the creator's track/video (reactions)
  repost: 3, // a repost of the creator's track (reposts)
} as const;

export type DiscoverySignalKind = keyof typeof DISCOVERY_AFFINITY_WEIGHTS;

export interface DiscoveryAffinityCounts {
  play: number;
  like: number;
  save: number;
  reaction: number;
  repost: number;
}

export const EMPTY_AFFINITY_COUNTS: DiscoveryAffinityCounts = {
  play: 0,
  like: 0,
  save: 0,
  reaction: 0,
  repost: 0,
};

/** Weighted affinity for one creator (or, fed genre-aggregated counts,
 *  for one genre). Pure weighted sum — the caps live in the score. */
export function discoveryAffinityScore(counts: DiscoveryAffinityCounts): number {
  return (
    counts.play * DISCOVERY_AFFINITY_WEIGHTS.play +
    counts.like * DISCOVERY_AFFINITY_WEIGHTS.like +
    counts.save * DISCOVERY_AFFINITY_WEIGHTS.save +
    counts.reaction * DISCOVERY_AFFINITY_WEIGHTS.reaction +
    counts.repost * DISCOVERY_AFFINITY_WEIGHTS.repost
  );
}

/** Total raw engagement events behind a set of counts — the cold-start
 *  probe. Zero events = no signals = legacy feed. */
export function discoveryEventTotal(counts: DiscoveryAffinityCounts): number {
  return counts.play + counts.like + counts.save + counts.reaction + counts.repost;
}

/** The signal that contributed most to a creator's affinity — the one
 *  the why line names. Ties break toward the stronger-commitment
 *  signal (repost > save > reaction > like > play). Null when the
 *  viewer never engaged with the creator at all. */
export function dominantSignal(counts: DiscoveryAffinityCounts): DiscoverySignalKind | null {
  const order: DiscoverySignalKind[] = ["repost", "save", "reaction", "like", "play"];
  let best: DiscoverySignalKind | null = null;
  let bestValue = 0;
  for (const kind of order) {
    const value = counts[kind] * DISCOVERY_AFFINITY_WEIGHTS[kind];
    if (value > bestValue) {
      bestValue = value;
      best = kind;
    }
  }
  return best;
}

export const FOLLOW_BOOST = 48;
export const CREATOR_AFFINITY_CAP = 48;
export const GENRE_AFFINITY_CAP = 20;
export const GENRE_WEIGHT = 0.5;
export const DISCOVERY_CREATOR_THRESHOLD = 3;
export const DISCOVERY_GENRE_THRESHOLD = 12;
export const DISCOVERY_SHARE = 0.25;

export interface DiscoveryRankSignals {
  isFollowed: boolean;
  /** Viewer's weighted affinity for the item's creator (uncapped). */
  creatorAffinity: number;
  /** Viewer's weighted affinity for the item's genre (uncapped). */
  genreAffinity: number;
  createdAtMs: number;
}

export function discoveryFeedScore(s: DiscoveryRankSignals, nowMs: number): number {
  const ageH = Math.max(0, (nowMs - s.createdAtMs) / 3600_000);
  return (
    (s.isFollowed ? FOLLOW_BOOST : 0) +
    Math.min(s.creatorAffinity, CREATOR_AFFINITY_CAP) +
    Math.min(s.genreAffinity, GENRE_AFFINITY_CAP) * GENRE_WEIGHT -
    ageH
  );
}

/** Does this non-followed candidate qualify to surface, and on which
 *  leg? Creator affinity is the direct leg; genre affinity is the
 *  taste leg and needs a deeper habit. Followed items never need to
 *  qualify — they are the feed. */
export function discoveryQualifies(s: { creatorAffinity: number; genreAffinity: number }): "creator" | "genre" | null {
  if (s.creatorAffinity >= DISCOVERY_CREATOR_THRESHOLD) return "creator";
  if (s.genreAffinity >= DISCOVERY_GENRE_THRESHOLD) return "genre";
  return null;
}

/** Max discovery (non-followed) items in a returned list of `limit`:
 *  a bounded share, floored — at limit 40 that's 10, at limit 20
 *  that's 5. */
export function discoveryCap(limit: number): number {
  return Math.floor(limit * DISCOVERY_SHARE);
}

export type DiscoveryWhyKind = "affinity-creator" | "affinity-genre";

export interface DiscoveryWhy {
  kind: DiscoveryWhyKind;
  label: string;
}

export interface DiscoveryWhyInput {
  /** Surfaced non-followed item — always explained. */
  isDiscovery: boolean;
  /** Followed item whose final rank beat its pure-recency rank —
   *  explained because affinity is why it sits higher. */
  movedUp: boolean;
  /** The viewer's dominant engagement with this creator, if any. */
  dominant: DiscoverySignalKind | null;
  creatorName: string;
  /** The item's genre (display form), when the genre leg explains it. */
  genre: string | null;
  /** Discovery qualified via genre affinity, not this creator. */
  viaGenre: boolean;
}

const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The honest per-item reason, or null when no personal signal owes
 *  the member an explanation (an ordinary followed drop sitting in
 *  its recency place). Labels name the ACTUAL dominant signal. */
export function discoveryWhy(input: DiscoveryWhyInput): DiscoveryWhy | null {
  if (!input.isDiscovery && !input.movedUp) return null;
  if (input.viaGenre && input.genre) {
    return { kind: "affinity-genre", label: `Because you play a lot of ${input.genre}` };
  }
  switch (input.dominant) {
    case "play":
      return { kind: "affinity-creator", label: `Because you play ${input.creatorName}` };
    case "like":
      return { kind: "affinity-creator", label: `Because you like ${possessive(input.creatorName)} drops` };
    case "save":
      return { kind: "affinity-creator", label: `Because you save ${possessive(input.creatorName)} drops` };
    case "reaction":
      return { kind: "affinity-creator", label: `Because you react to ${input.creatorName}` };
    case "repost":
      return { kind: "affinity-creator", label: `Because you repost ${input.creatorName}` };
    default:
      return null;
  }
}
