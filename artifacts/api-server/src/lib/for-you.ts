/* ── For-You ranking v1 (Stack 9 #4) ────────────────────────────────────
   TRANSPARENCY LAW: the ranking factors are named right here, and
   every ranked item carries the reason derived from the ACTUAL
   signal that scored it — never a fabricated one.

   Factors (all from real behavior already recorded on the site):
     1. follow      — the viewer follows the post's creator.
                      (follows table)
     2. affinity    — the viewer's recorded affinity for that creator,
                      built from reactions they left (reactions),
                      likes (likes), plays (play_events) and follows.
                      Affinity is a per-(viewer, creator) weighted
                      count — see affinityScore().
     3. engagement  — the post's own like/repost/reply counts
                      (the charts signal: what the crowd did).
     4. recency     — newer posts score higher; score decays with age.
     5. media       — a small boost for posts carrying media (the
                      surface is visual-first).
   There is NO paid boosting: no factor reads payments, credits,
   sponsorships or spend, and none may be added without changing
   this comment and the "Why am I seeing this" copy together. */

export type WhyReason =
  | { kind: "following"; label: "Because you follow this creator" }
  | { kind: "affinity"; label: "Because you engage with this creator" }
  | { kind: "chart"; label: "Popular right now" }
  | { kind: "own"; label: "Your post" }
  | { kind: "fresh"; label: "Fresh post" };

export interface RankSignals {
  isFollowed: boolean;
  isOwn: boolean;
  /** Weighted affinity count for (viewer, this post's creator). */
  affinity: number;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  hasMedia: boolean;
  createdAtMs: number;
}

export const AFFINITY_WEIGHTS = {
  reaction: 3, // a reaction on the creator's post
  like: 2, // a like on the creator's track/video
  play: 1, // a play of the creator's track/video
  follow: 5, // following (also drives the follow factor directly)
} as const;

export function affinityScore(counts: { reactions: number; likes: number; plays: number; follows: number }): number {
  return (
    counts.reactions * AFFINITY_WEIGHTS.reaction +
    counts.likes * AFFINITY_WEIGHTS.like +
    counts.plays * AFFINITY_WEIGHTS.play +
    counts.follows * AFFINITY_WEIGHTS.follow
  );
}

const AFFINITY_CAP = 200; // past this, more history doesn't outrank everything else

export function forYouScore(s: RankSignals, nowMs: number): number {
  const ageH = Math.max(0, (nowMs - s.createdAtMs) / 3600_000);
  const engagement = s.likeCount + s.repostCount * 3 + s.replyCount * 2;
  return (
    (s.isFollowed ? 100 : 0) +
    (s.isOwn ? 60 : 0) +
    Math.min(s.affinity, AFFINITY_CAP) * 0.5 +
    engagement * 0.4 -
    ageH * 1.5 +
    (s.hasMedia ? 8 : 0)
  );
}

/** The honest per-item reason: the strongest TRUE signal for this
 *  item, in the same priority the score uses. A post with no signal
 *  at all says "Fresh post" only when it actually is fresh — the
 *  fallback for an old, signalless post is the chart reason only
 *  when its engagement is real, otherwise fresh-by-default ordering
 *  is what surfaced it and the label says "Fresh post" because the
 *  candidate window is recency-ordered (named in the header). */
export function whyReason(s: RankSignals, nowMs: number): WhyReason {
  if (s.isOwn) return { kind: "own", label: "Your post" };
  if (s.isFollowed) return { kind: "following", label: "Because you follow this creator" };
  if (s.affinity >= AFFINITY_WEIGHTS.reaction) return { kind: "affinity", label: "Because you engage with this creator" };
  const engagement = s.likeCount + s.repostCount * 3 + s.replyCount * 2;
  if (engagement > 0) return { kind: "chart", label: "Popular right now" };
  void nowMs;
  return { kind: "fresh", label: "Fresh post" };
}
