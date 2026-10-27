/* ─── Collab Match — house-suggested pairings (#175) ────────────────────────
   The house (not a creator) initiates pairings between collab profiles,
   scored DETERMINISTICALLY from niche + audience size + shared platforms
   + stated interests. No AI call, no credits: the scorer is pure
   arithmetic over profile facts, so the same pair always scores the same
   and every score can be explained by its `reasons`.

   Contact is brokered ONLY through a suggestion: neither side can reach
   the other until BOTH mark `interested` — at that moment the route
   writes a normal collab_requests intro row and the existing inbox flow
   takes over. A `passed` mark from EITHER side closes the pair forever:
   the pair already has a collab_suggestions row, and the scorer skips
   any pair that has one, so a passed pairing can never be re-nagged.

   This module is the pure core (scoring, pair identity, the side-mark
   state machine, the generation cadence). The route owns the DB. */

export interface CollabProfileFacts {
  userId: string;
  displayName: string;
  niche: string;
  platforms: { platform: string; followers: number }[];
  collabInterests: string;
  isPublic: boolean;
}

/* Niches whose audiences overlap enough to pair across. Symmetric;
   a niche always pairs with itself best. */
const COMPLEMENTARY_NICHES: Record<string, string[]> = {
  music: ["gaming", "vlogging", "podcasting", "fashion"],
  gaming: ["music", "tech", "comedy"],
  vlogging: ["travel", "cooking", "fashion", "comedy"],
  comedy: ["vlogging", "gaming", "education"],
  education: ["tech", "comedy", "fitness"],
  fitness: ["education", "cooking", "vlogging"],
  beauty: ["fashion", "vlogging"],
  tech: ["gaming", "education", "podcasting"],
  cooking: ["fitness", "vlogging", "travel"],
  travel: ["vlogging", "cooking", "fashion"],
  fashion: ["beauty", "music", "travel", "vlogging"],
  podcasting: ["music", "tech", "education"],
  other: [],
};

export function totalFollowers(p: CollabProfileFacts): number {
  return (p.platforms ?? []).reduce((sum, pl) => sum + (Number(pl.followers) || 0), 0);
}

const INTEREST_STOPWORDS = new Set([
  "and", "the", "for", "with", "want", "wants", "looking", "look", "to", "a", "an",
  "of", "in", "on", "my", "i", "im", "i'm", "do", "does", "any", "some", "more",
]);

export function interestTokens(interests: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(interests ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    const tok = raw.trim();
    if (tok.length >= 3 && !INTEREST_STOPWORDS.has(tok)) out.add(tok);
  }
  return out;
}

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${n}`;
}

export interface PairScore {
  score: number; // 0-100
  reasons: string[];
}

/* Deterministic pair score. Components:
   - niche:      same 40 · complementary 25 · unrelated 5
   - size:       up to 30 by follower-ratio closeness (no data → 10 neutral)
   - platforms:  +5 per shared platform, cap 15
   - interests:  +3 per shared meaningful token, cap 15
   Clamped to 0-100. */
export function scorePair(a: CollabProfileFacts, b: CollabProfileFacts): PairScore {
  const reasons: string[] = [];
  let score = 0;

  if (a.niche === b.niche) {
    score += 40;
    reasons.push(`Same niche — you both make ${a.niche} content`);
  } else if ((COMPLEMENTARY_NICHES[a.niche] ?? []).includes(b.niche)) {
    score += 25;
    reasons.push(`Complementary niches — ${a.niche} and ${b.niche} share an audience`);
  } else {
    score += 5;
  }

  const fa = totalFollowers(a);
  const fb = totalFollowers(b);
  if (fa > 0 && fb > 0) {
    const ratio = Math.min(fa, fb) / Math.max(fa, fb);
    score += Math.round(30 * ratio);
    if (ratio >= 0.5) {
      reasons.push(`Similar audience size (${fmtFollowers(fa)} vs ${fmtFollowers(fb)}) — a peer-to-peer pairing`);
    } else {
      reasons.push(`Audience sizes ${fmtFollowers(fa)} and ${fmtFollowers(fb)} — the smaller creator brings the bigger idea`);
    }
  } else {
    score += 10;
  }

  const aPlatforms = new Set((a.platforms ?? []).map((p) => p.platform));
  const shared = (b.platforms ?? []).map((p) => p.platform).filter((p) => aPlatforms.has(p));
  if (shared.length > 0) {
    score += Math.min(15, shared.length * 5);
    reasons.push(`Both active on ${shared.slice(0, 3).join(", ")}`);
  }

  const aTokens = interestTokens(a.collabInterests);
  const sharedTokens = [...interestTokens(b.collabInterests)].filter((t) => aTokens.has(t));
  if (sharedTokens.length > 0) {
    score += Math.min(15, sharedTokens.length * 3);
    reasons.push(`Both want: ${sharedTokens.slice(0, 3).join(", ")}`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/* Canonical unordered pair key: the two user ids in string order, so a
   pair can only ever be keyed one way (matches the schema's
   user_a_id < user_b_id rule and its unique index). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/* ─── Side-mark state machine ───
   A suggestion row carries a_status / b_status (pending | interested |
   passed) and the overall status (open | connected | closed). */
export type SuggestionSideStatus = "pending" | "interested" | "passed";
export type SuggestionStatus = "open" | "connected" | "closed";

export interface SuggestionSides {
  aStatus: SuggestionSideStatus;
  bStatus: SuggestionSideStatus;
  status: SuggestionStatus;
}

export function sideOf(row: { userAId: string; userBId: string }, userId: string): "a" | "b" | null {
  if (row.userAId === userId) return "a";
  if (row.userBId === userId) return "b";
  return null;
}

/* Apply one side's mark. Pure: returns the next row state.
   - Either side passing closes the pair (status closed), whatever the
     other side said — a pass is final and quiet.
   - Both sides interested connects the pair (the route then brokers the
     intro request, exactly once).
   - Marks on a non-open suggestion change nothing. */
export function applySideMark(
  row: SuggestionSides,
  side: "a" | "b",
  mark: "interested" | "passed",
): SuggestionSides {
  if (row.status !== "open") return row;
  const next: SuggestionSides = { ...row };
  if (side === "a") next.aStatus = mark;
  else next.bStatus = mark;
  if (next.aStatus === "passed" || next.bStatus === "passed") {
    next.status = "closed";
  } else if (next.aStatus === "interested" && next.bStatus === "interested") {
    next.status = "connected";
  }
  return next;
}

/* ─── Generation cadence ───
   The house suggests proactively, but on a cadence — not on every page
   load. A fresh batch is due when the creator has fewer than
   OPEN_TARGET open suggestions AND either they have never been
   suggested to, or the newest suggestion row for them is older than
   CADENCE_DAYS. Already-suggested pairs are excluded by the caller via
   pairKey (any existing row — open, connected, or closed — blocks the
   pair forever). */
export const SUGGESTION_OPEN_TARGET = 3;
export const SUGGESTION_CADENCE_DAYS = 7;
export const SUGGESTION_MIN_SCORE = 30;

export function generationDue(facts: {
  openCount: number;
  lastCreatedAt: Date | null;
  now: Date;
}): boolean {
  if (facts.openCount >= SUGGESTION_OPEN_TARGET) return false;
  if (!facts.lastCreatedAt) return true;
  const ageMs = facts.now.getTime() - facts.lastCreatedAt.getTime();
  return ageMs >= SUGGESTION_CADENCE_DAYS * 24 * 60 * 60 * 1000;
}

export interface RankedPair {
  other: CollabProfileFacts;
  score: number;
  reasons: string[];
}

/* Rank candidate partners for `me`: public profiles only, never self,
   never a pair that already has a suggestion row, score floor applied,
   best first. Deterministic tie-break on user id so the same inputs
   always produce the same batch. */
export function rankCandidates(
  me: CollabProfileFacts,
  candidates: CollabProfileFacts[],
  existingPairKeys: Set<string>,
  limit: number,
): RankedPair[] {
  const out: RankedPair[] = [];
  for (const other of candidates) {
    if (!other.isPublic) continue;
    if (other.userId === me.userId) continue;
    if (existingPairKeys.has(pairKey(me.userId, other.userId))) continue;
    const { score, reasons } = scorePair(me, other);
    if (score < SUGGESTION_MIN_SCORE) continue;
    out.push({ other, score, reasons });
  }
  out.sort((x, y) => y.score - x.score || (x.other.userId < y.other.userId ? -1 : 1));
  return out.slice(0, Math.max(0, limit));
}

/* The house intro message written into the brokered collab_requests row
   when both sides opt in. Names the house as the matchmaker — the
   request is house-brokered, not creator-sent, and the copy says so. */
export function houseIntroMessage(aName: string, bName: string, reasons: string[]): string {
  const why = reasons.length > 0 ? ` Why we paired you: ${reasons[0]}.` : "";
  return (
    `👋 The house matched ${aName} and ${bName} — you both said yes to a Collab Match intro.${why} ` +
    `Take it from here: trade ideas, pick a format, and make something neither audience has seen.`
  );
}
