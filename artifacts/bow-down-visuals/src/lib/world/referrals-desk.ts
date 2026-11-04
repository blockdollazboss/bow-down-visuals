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

/* ── i18n string bundles (stack100 locale unit 44) ─────────────────
   The composed lines below take an optional strings bundle whose
   defaults are the original English, byte-identical; the desk
   builds the bundle from the worldLivePromo catalog keys so the
   words render in the walker's language. Templates carry
   {{token}} slots the seam fills itself. The next-tier templates
   state share rates and Buc milestone amounts — MONEY lines: the
   catalog carries the English verbatim in every locale. */

function fillToken(template: string, token: string, value: string): string {
  return template.split(token).join(value);
}

export interface ReferralNextTierStrings {
  /** Template: {{title}} + {{ratePct}} tokens. */
  yoursAtSync: string;
  /** Template: {{remaining}} + {{title}} + {{ratePct}} + {{bonus}} tokens. */
  moreOne: string;
  /** Template: {{remaining}} + {{title}} + {{ratePct}} + {{bonus}} tokens. */
  moreMany: string;
  /** Template: one {{bonus}} token — the milestone amount. */
  bonusSuffix: string;
}

export const REFERRAL_NEXT_TIER_STRINGS_EN: ReferralNextTierStrings = {
  yoursAtSync: "{{title}} is yours at your next sync — {{ratePct}}% share.",
  moreOne: "{{remaining}} more signup to {{title}} — {{ratePct}}% share{{bonus}}.",
  moreMany: "{{remaining}} more signups to {{title}} — {{ratePct}}% share{{bonus}}.",
  bonusSuffix: " + a {{bonus}} Buc milestone",
};

/** Build the bundle from a translate function (the desk's `t`):
 *  every field reads its worldLivePromo catalog key. */
export function referralNextTierStrings(translate: (key: string) => string): ReferralNextTierStrings {
  return {
    yoursAtSync: translate("worldLivePromo.referralNextTierYours"),
    moreOne: translate("worldLivePromo.referralNextTierMoreOne"),
    moreMany: translate("worldLivePromo.referralNextTierMoreMany"),
    bonusSuffix: translate("worldLivePromo.referralNextTierBonus"),
  };
}

/** "3 more signups to The Don (40% share)" — from the rail's own
 *  next-tier fields; null at the top of the ladder. */
export function nextTierLine(summary: ReferralSummary, strings: ReferralNextTierStrings = REFERRAL_NEXT_TIER_STRINGS_EN): string | null {
  const next = summary.nextTier;
  if (!next) return null;
  const remaining = Math.max(0, next.minReferrals - summary.totalReferrals);
  if (remaining === 0) {
    return fillToken(fillToken(strings.yoursAtSync, "{{title}}", next.title), "{{ratePct}}", String(next.ratePct));
  }
  const bonus = next.milestoneBonus > 0 ? fillToken(strings.bonusSuffix, "{{bonus}}", String(next.milestoneBonus)) : "";
  const template = remaining === 1 ? strings.moreOne : strings.moreMany;
  return fillToken(
    fillToken(
      fillToken(fillToken(template, "{{remaining}}", String(remaining)), "{{title}}", next.title),
      "{{ratePct}}", String(next.ratePct),
    ),
    "{{bonus}}", bonus,
  );
}

export interface ReferralRankStrings {
  weeklyRanked: string;
  weeklyUnranked: string;
  monthlyRanked: string;
  monthlyUnranked: string;
  allTimeRanked: string;
  allTimeUnranked: string;
}

export const REFERRAL_RANK_STRINGS_EN: ReferralRankStrings = {
  weeklyRanked: "Weekly #{{rank}}",
  weeklyUnranked: "Weekly unranked",
  monthlyRanked: "Monthly #{{rank}}",
  monthlyUnranked: "Monthly unranked",
  allTimeRanked: "All-time #{{rank}}",
  allTimeUnranked: "All-time unranked",
};

/** Build the bundle from a translate function (the desk's `t`):
 *  every field reads its worldLivePromo catalog key. */
export function referralRankStrings(translate: (key: string) => string): ReferralRankStrings {
  return {
    weeklyRanked: translate("worldLivePromo.referralRankWeekly"),
    weeklyUnranked: translate("worldLivePromo.referralRankWeeklyUnranked"),
    monthlyRanked: translate("worldLivePromo.referralRankMonthly"),
    monthlyUnranked: translate("worldLivePromo.referralRankMonthlyUnranked"),
    allTimeRanked: translate("worldLivePromo.referralRankAllTime"),
    allTimeUnranked: translate("worldLivePromo.referralRankAllTimeUnranked"),
  };
}

/** The ranks strip: a window the rail left null reads "unranked",
 *  never a fabricated placing. */
export function rankLine(summary: ReferralSummary, strings: ReferralRankStrings = REFERRAL_RANK_STRINGS_EN): string {
  const one = (ranked: string, unranked: string, rank: number | null) =>
    rank !== null ? fillToken(ranked, "{{rank}}", String(rank)) : unranked;
  return [
    one(strings.weeklyRanked, strings.weeklyUnranked, summary.ranks.weekly),
    one(strings.monthlyRanked, strings.monthlyUnranked, summary.ranks.monthly),
    one(strings.allTimeRanked, strings.allTimeUnranked, summary.ranks.alltime),
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

export function normalizeReferralContest(payload: unknown, fallbackName = "Anonymous Recruiter"): ReferralContest | null {
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
      out.push({ rank: num(r["rank"]), name: str(r["name"], fallbackName), signups: num(r["signups"]) });
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
