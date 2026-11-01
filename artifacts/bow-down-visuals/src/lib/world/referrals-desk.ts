/* ─── Referrals desk seam (stack1100 world parity) ─────────────────
   Your referral hub, native at the Earnings Board — on the
   referrals router's own rails, the same endpoints
   pages/referrals.tsx calls:

     GET /api/referrals/me       → the caller's code + stats: totals,
                                   per-person rows, promoter tier +
                                   next tier, claimed milestones,
                                   leaderboard ranks, the tier ladder
     GET /api/referrals/contest  → this month's contest: standings,
                                   prize table, last month's winners

   The share link is the page's own construction
   (`${origin}/?ref=${code}` — pages/referrals.tsx); attribution
   lands through App.tsx's capture + POST /api/referrals/apply at
   signup, unchanged. Numbers render only from the rail's fields —
   a payload without the caller's code is a failed read, never a
   hub painted over a broken answer. */

export const REFERRALS_ME_PATH = "/api/referrals/me";
export const REFERRALS_CONTEST_PATH = "/api/referrals/contest";

/** The page's own link shape: the site root carrying the code. */
export function referralLink(origin: string, code: string): string {
  return `${origin}/?ref=${code}`;
}

interface ReferralPerson {
  joinedAt: string;
  creditsEarned: number;
  shareExpiresAt: string | null;
  daysLeft: number;
  active: boolean;
}

interface PromoterTierInfo {
  stars: number;
  title: string;
  ratePct: number;
}

interface NextTierInfo extends PromoterTierInfo {
  minReferrals: number;
  milestoneBonus: number;
}

export interface ReferralSummary {
  code: string;
  totalReferrals: number;
  activeReferrals: number;
  creditsEarned: number;
  revenueSharePct: number;
  shareWindowDays: number;
  refereeReward: number;
  referrals: ReferralPerson[];
  tier: PromoterTierInfo | null;
  nextTier: NextTierInfo | null;
  claimedMilestones: number[];
  ranks: { weekly: number | null; monthly: number | null; alltime: number | null };
  tierLadder: NextTierInfo[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function tierInfo(v: unknown): PromoterTierInfo | null {
  const r = asRecord(v);
  if (!r) return null;
  return { stars: num(r["stars"]), title: str(r["title"]), ratePct: num(r["ratePct"]) };
}

function nextTierInfo(v: unknown): NextTierInfo | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    stars: num(r["stars"]),
    title: str(r["title"]),
    ratePct: num(r["ratePct"]),
    minReferrals: num(r["minReferrals"]),
    milestoneBonus: num(r["milestoneBonus"]),
  };
}

export function normalizeReferralSummary(payload: unknown): ReferralSummary | null {
  const root = asRecord(payload);
  if (!root) return null;
  const code = str(root["code"]);
  if (!code) return null;
  const people: ReferralPerson[] = [];
  const rows = root["referrals"];
  if (Array.isArray(rows)) {
    for (const raw of rows) {
      const r = asRecord(raw);
      if (!r) return null;
      people.push({
        joinedAt: str(r["joinedAt"]),
        creditsEarned: num(r["creditsEarned"]),
        shareExpiresAt: typeof r["shareExpiresAt"] === "string" ? r["shareExpiresAt"] : null,
        daysLeft: num(r["daysLeft"]),
        active: r["active"] === true,
      });
    }
  }
  const ranksRaw = asRecord(root["ranks"]);
  const ladderRaw = root["tierLadder"];
  return {
    code,
    totalReferrals: num(root["totalReferrals"]),
    activeReferrals: num(root["activeReferrals"]),
    creditsEarned: num(root["creditsEarned"]),
    revenueSharePct: num(root["revenueSharePct"]),
    shareWindowDays: num(root["shareWindowDays"]),
    refereeReward: num(root["refereeReward"]),
    referrals: people,
    tier: tierInfo(root["tier"]),
    nextTier: nextTierInfo(root["nextTier"]),
    claimedMilestones: Array.isArray(root["claimedMilestones"])
      ? root["claimedMilestones"].filter((x): x is number => typeof x === "number")
      : [],
    ranks: {
      weekly: ranksRaw ? numOrNull(ranksRaw["weekly"]) : null,
      monthly: ranksRaw ? numOrNull(ranksRaw["monthly"]) : null,
      alltime: ranksRaw ? numOrNull(ranksRaw["alltime"]) : null,
    },
    tierLadder: Array.isArray(ladderRaw)
      ? ladderRaw.map(nextTierInfo).filter((t): t is NextTierInfo => t !== null)
      : [],
  };
}

/** "3 more signups to The Don (40% share)" — from the rail's own
 *  next-tier fields; null at the top of the ladder. */
export function nextTierLine(summary: ReferralSummary): string | null {
  const next = summary.nextTier;
  if (!next) return null;
  const remaining = Math.max(0, next.minReferrals - summary.totalReferrals);
  if (remaining === 0) return `${next.title} is yours at your next sync — ${next.ratePct}% share.`;
  return `${remaining} more signup${remaining === 1 ? "" : "s"} to ${next.title} — ${next.ratePct}% share${
    next.milestoneBonus > 0 ? ` + a ${next.milestoneBonus} Buc milestone` : ""
  }.`;
}

/** The ranks strip: a window the rail left null reads "unranked",
 *  never a fabricated placing. */
export function rankLine(summary: ReferralSummary): string {
  const one = (label: string, rank: number | null) =>
    `${label} ${rank !== null ? `#${rank}` : "unranked"}`;
  return [
    one("Weekly", summary.ranks.weekly),
    one("Monthly", summary.ranks.monthly),
    one("All-time", summary.ranks.alltime),
  ].join(" · ");
}

/* ─── The monthly contest ────────────────────────────────────────── */

export interface ContestStanding {
  rank: number;
  name: string;
  signups: number;
}

export interface ReferralContest {
  period: string;
  endsAt: string;
  prizePool: number;
  minSignupsToQualify: number;
  standings: ContestStanding[];
  lastWinners: ContestStanding[];
  lastWinnerPeriod: string | null;
}

export function normalizeReferralContest(payload: unknown): ReferralContest | null {
  const root = asRecord(payload);
  if (!root) return null;
  const period = str(root["period"]);
  if (!period) return null;
  const prizes = root["prizes"];
  const prizePool = Array.isArray(prizes)
    ? prizes.reduce((sum, p) => sum + num(asRecord(p)?.["prizeCredits"]), 0)
    : 0;
  const readRows = (v: unknown): ContestStanding[] => {
    if (!Array.isArray(v)) return [];
    const out: ContestStanding[] = [];
    for (const raw of v) {
      const r = asRecord(raw);
      if (!r) continue;
      out.push({ rank: num(r["rank"]), name: str(r["name"], "Anonymous Recruiter"), signups: num(r["signups"]) });
    }
    return out;
  };
  return {
    period,
    endsAt: str(root["endsAt"]),
    prizePool,
    minSignupsToQualify: num(root["minSignupsToQualify"]),
    standings: readRows(root["standings"]),
    lastWinners: readRows(root["lastWinners"]),
    lastWinnerPeriod: typeof root["lastWinnerPeriod"] === "string" ? root["lastWinnerPeriod"] : null,
  };
}
