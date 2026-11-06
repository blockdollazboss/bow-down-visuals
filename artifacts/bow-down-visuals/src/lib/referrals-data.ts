/* ── Referrals payload guards (Stack-200 hardening C, item 35) ──────
 * Same pattern as lib/earnings-data.ts. pages/referrals.tsx stored
 * both payloads raw (`setInfo(data)`, `setContest(cdata)`) and the
 * render dereferenced info.referrals.filter, info.ranks.*,
 * info.tierLadder.map, info.claimedMilestones.includes and — in
 * ContestSection, which renders ABOVE the page's loading/error
 * gates — contest.prizes.reduce, contest.standings.*, contest.rules
 * .map unconditionally. A partial/malformed 200 threw during render
 * and blanked the whole promoter page. These normalizers run at the
 * fetch boundary:
 *   • /api/referrals/me without a usable referral code is not a
 *     payload the page can render → null → the page's honest
 *     load-failed state with retry;
 *   • the contest is a bonus section: a non-object payload → null
 *     (section simply doesn't render, exactly like a failed fetch
 *     today), and any object payload is coerced field-by-field so
 *     ContestSection can dereference it safely;
 *   • inside a payload, arrays default to [] and numbers to 0 —
 *     the earnings normalizer's degrade discipline. */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const num = (v: unknown): number => finite(v) ?? 0;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

export interface ReferralEntry {
  joinedAt: string;
  creditsEarned: number;
  shareExpiresAt: string | null;
  daysLeft: number;
  active: boolean;
}

export interface TierInfo {
  stars: number;
  title: string;
  ratePct: number;
}

export interface TierLadderEntry extends TierInfo {
  minReferrals: number;
  milestoneBonus: number;
}

export interface WindowRanks {
  weekly: number | null;
  monthly: number | null;
  alltime: number | null;
}

export interface ReferralInfo {
  code: string;
  totalReferrals: number;
  activeReferrals: number;
  creditsEarned: number;
  revenueSharePct: number;
  shareWindowDays: number;
  refereeReward: number;
  referrals: ReferralEntry[];
  tier: TierInfo | null;
  nextTier: (TierInfo & { minReferrals: number; milestoneBonus: number }) | null;
  claimedMilestones: number[];
  tierLadder: TierLadderEntry[];
  ranks: WindowRanks;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  slug: string | null;
  signups: number;
  revenue: number;
  badge: { stars: number; title: string } | null;
}

export interface ContestPrize {
  rank: number;
  prizeCredits: number;
}

export interface ContestWinner {
  rank: number;
  name: string;
  slug: string | null;
  signups: number;
  prizeCredits: number;
  badge: { stars: number; title: string } | null;
}

export interface ContestData {
  period: string;
  endsAt: string;
  rules: string[];
  prizes: ContestPrize[];
  minSignupsToQualify: number;
  standings: LeaderboardEntry[];
  lastWinners: ContestWinner[];
  lastWinnerPeriod: string | null;
}

function badge(v: unknown): { stars: number; title: string } | null {
  if (!isObj(v)) return null;
  return { stars: num(v.stars), title: str(v.title) };
}

function tierInfo(v: unknown): TierInfo | null {
  if (!isObj(v)) return null;
  return { stars: num(v.stars), title: str(v.title), ratePct: num(v.ratePct) };
}

function leaderboardEntry(v: Record<string, unknown>): LeaderboardEntry {
  return {
    rank: num(v.rank),
    name: str(v.name),
    slug: strOrNull(v.slug),
    signups: num(v.signups),
    revenue: num(v.revenue),
    badge: badge(v.badge),
  };
}

export function normalizeReferralInfo(payload: unknown): ReferralInfo | null {
  if (!isObj(payload)) return null;
  const code = str(payload.code);
  if (!code) return null;
  const ranks = isObj(payload.ranks) ? payload.ranks : {};
  const next = isObj(payload.nextTier) ? payload.nextTier : null;
  return {
    code,
    totalReferrals: num(payload.totalReferrals),
    activeReferrals: num(payload.activeReferrals),
    creditsEarned: num(payload.creditsEarned),
    revenueSharePct: num(payload.revenueSharePct),
    shareWindowDays: num(payload.shareWindowDays),
    refereeReward: num(payload.refereeReward),
    referrals: (Array.isArray(payload.referrals) ? payload.referrals : [])
      .filter(isObj)
      .map((r) => ({
        joinedAt: str(r.joinedAt),
        creditsEarned: num(r.creditsEarned),
        shareExpiresAt: strOrNull(r.shareExpiresAt),
        daysLeft: num(r.daysLeft),
        active: r.active === true,
      })),
    tier: tierInfo(payload.tier),
    nextTier: next
      ? {
          stars: num(next.stars),
          title: str(next.title),
          ratePct: num(next.ratePct),
          minReferrals: num(next.minReferrals),
          milestoneBonus: num(next.milestoneBonus),
        }
      : null,
    claimedMilestones: (Array.isArray(payload.claimedMilestones)
      ? payload.claimedMilestones
      : []
    )
      .map(finite)
      .filter((n): n is number => n !== null),
    tierLadder: (Array.isArray(payload.tierLadder) ? payload.tierLadder : [])
      .filter(isObj)
      .map((t) => ({
        stars: num(t.stars),
        title: str(t.title),
        ratePct: num(t.ratePct),
        minReferrals: num(t.minReferrals),
        milestoneBonus: num(t.milestoneBonus),
      })),
    ranks: {
      weekly: finite(ranks.weekly),
      monthly: finite(ranks.monthly),
      alltime: finite(ranks.alltime),
    },
  };
}

export function normalizeContestData(payload: unknown): ContestData | null {
  if (!isObj(payload)) return null;
  return {
    period: str(payload.period),
    endsAt: str(payload.endsAt),
    rules: (Array.isArray(payload.rules) ? payload.rules : []).filter(
      (r): r is string => typeof r === "string",
    ),
    prizes: (Array.isArray(payload.prizes) ? payload.prizes : [])
      .filter(isObj)
      .map((p) => ({ rank: num(p.rank), prizeCredits: num(p.prizeCredits) })),
    minSignupsToQualify: num(payload.minSignupsToQualify),
    standings: (Array.isArray(payload.standings) ? payload.standings : [])
      .filter(isObj)
      .map(leaderboardEntry),
    lastWinners: (Array.isArray(payload.lastWinners) ? payload.lastWinners : [])
      .filter(isObj)
      .map((w) => ({
        rank: num(w.rank),
        name: str(w.name),
        slug: strOrNull(w.slug),
        signups: num(w.signups),
        prizeCredits: num(w.prizeCredits),
        badge: badge(w.badge),
      })),
    lastWinnerPeriod: strOrNull(payload.lastWinnerPeriod),
  };
}
