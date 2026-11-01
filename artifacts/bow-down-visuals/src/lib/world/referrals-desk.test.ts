import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  REFERRALS_CONTEST_PATH,
  REFERRALS_ME_PATH,
  nextTierLine,
  normalizeReferralContest,
  normalizeReferralSummary,
  rankLine,
  referralLink,
} from "./referrals-desk";

/* ─── Referrals desk (stack1100 world parity) ──────────────────────
   Your referral hub native at the Earnings Board, on the referrals
   router's own rails. These tests pin the seam: the /me payload
   normalized field-for-field, the share link in the page's own
   construction, tier/rank lines spoken only from the rail's fields
   (an unranked window reads "unranked"), and the contest strip's
   prize pool summed from the rail's prize table. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ME = {
  code: "QRBCBEVG",
  totalReferrals: 7,
  activeReferrals: 3,
  creditsEarned: 1250,
  revenueSharePct: 25,
  shareWindowDays: 90,
  refereeReward: 100,
  referrals: [
    { joinedAt: "2026-10-01T00:00:00.000Z", creditsEarned: 500, shareExpiresAt: "2026-12-30T00:00:00.000Z", daysLeft: 60, active: true },
    { joinedAt: "2026-06-01T00:00:00.000Z", creditsEarned: 750, shareExpiresAt: "2025-08-30T00:00:00.000Z", daysLeft: 0, active: false },
  ],
  tier: { stars: 2, title: "Hustler", ratePct: 25 },
  nextTier: { stars: 3, title: "The Don", minReferrals: 10, ratePct: 40, milestoneBonus: 5000 },
  claimedMilestones: [1, 2],
  ranks: { weekly: 4, monthly: null, alltime: 12 },
  tierLadder: [
    { stars: 1, title: "Starter", minReferrals: 1, ratePct: 20, milestoneBonus: 500 },
    { stars: 3, title: "The Don", minReferrals: 10, ratePct: 40, milestoneBonus: 5000 },
  ],
};

describe("rails + link", () => {
  it("the paths are the referrals page's own endpoints; the link is the page's own construction", () => {
    expect(REFERRALS_ME_PATH).toBe("/api/referrals/me");
    expect(REFERRALS_CONTEST_PATH).toBe("/api/referrals/contest");
    expect(referralLink("https://bowdownvisuals.com", "QRBCBEVG")).toBe(
      "https://bowdownvisuals.com/?ref=QRBCBEVG",
    );
    const page = read("../../pages/referrals.tsx");
    expect(page).toContain("`${window.location.origin}/?ref=${info.code}`");
  });
});

describe("normalizeReferralSummary", () => {
  it("maps the /me payload field-for-field", () => {
    const s = normalizeReferralSummary(ME)!;
    expect(s.code).toBe("QRBCBEVG");
    expect(s.totalReferrals).toBe(7);
    expect(s.creditsEarned).toBe(1250);
    expect(s.referrals).toHaveLength(2);
    expect(s.referrals[0]?.active).toBe(true);
    expect(s.tier?.title).toBe("Hustler");
    expect(s.nextTier?.title).toBe("The Don");
    expect(s.claimedMilestones).toEqual([1, 2]);
    expect(s.ranks).toEqual({ weekly: 4, monthly: null, alltime: 12 });
    expect(s.tierLadder).toHaveLength(2);
  });

  it("no code, no hub — a codeless payload is a failed read", () => {
    expect(normalizeReferralSummary({ ...ME, code: "" })).toBeNull();
    expect(normalizeReferralSummary(null)).toBeNull();
    expect(normalizeReferralSummary({ referrals: [] })).toBeNull();
  });

  it("a fresh member (code, zeros, no tier) is a valid ready state", () => {
    const s = normalizeReferralSummary({
      code: "NEWCODE1",
      totalReferrals: 0,
      activeReferrals: 0,
      creditsEarned: 0,
      revenueSharePct: 20,
      shareWindowDays: 90,
      refereeReward: 100,
      referrals: [],
      tier: null,
      nextTier: { stars: 1, title: "Starter", minReferrals: 1, ratePct: 20, milestoneBonus: 500 },
      claimedMilestones: [],
      ranks: { weekly: null, monthly: null, alltime: null },
      tierLadder: [],
    });
    expect(s).not.toBeNull();
    expect(s?.tier).toBeNull();
  });
});

describe("the spoken lines", () => {
  it("the next-tier line counts from the rail's own fields", () => {
    const s = normalizeReferralSummary(ME)!;
    expect(nextTierLine(s)).toBe("3 more signups to The Don — 40% share + a 5000 Buc milestone.");
    const top = normalizeReferralSummary({ ...ME, nextTier: null })!;
    expect(nextTierLine(top)).toBeNull();
  });

  it("an unranked window reads unranked — never a fabricated placing", () => {
    const s = normalizeReferralSummary(ME)!;
    expect(rankLine(s)).toBe("Weekly #4 · Monthly unranked · All-time #12");
  });
});

describe("normalizeReferralContest", () => {
  it("sums the prize pool from the rail's prize table and reads the boards", () => {
    const c = normalizeReferralContest({
      period: "2026-10",
      endsAt: "2026-11-01T00:00:00.000Z",
      prizes: [
        { rank: 1, prizeCredits: 20000 },
        { rank: 2, prizeCredits: 12000 },
        { rank: 3, prizeCredits: 8000 },
      ],
      minSignupsToQualify: 5,
      standings: [{ rank: 1, name: "Thy Cheat Code", slug: "thy", signups: 21, revenue: 900, badge: null }],
      lastWinners: [{ rank: 1, name: "Anonymous Recruiter", slug: null, signups: 18, prizeCredits: 20000, badge: null }],
      lastWinnerPeriod: "2026-09",
    });
    expect(c?.prizePool).toBe(40000);
    expect(c?.standings[0]?.name).toBe("Thy Cheat Code");
    expect(c?.lastWinnerPeriod).toBe("2026-09");
    expect(normalizeReferralContest({})).toBeNull();
  });
});

describe("the desk stands in the EarningsBoard stack", () => {
  const deskSrc = read("../../components/world/native/ReferralsDesk.tsx");
  const boardSrc = read("../../components/world/native/boards/EarningsBoard.tsx");

  it("EarningsBoard mounts it with the money desks (the controller path)", () => {
    expect(boardSrc).toContain('import { ReferralsDesk } from "@/components/world/native/ReferralsDesk"');
    expect(boardSrc).toContain("<ReferralsDesk isLight={isLight} />");
  });

  it("the desk lands on the seam's rails and renders honest states", () => {
    expect(deskSrc).toContain('data-testid="world-referrals-desk"');
    expect(deskSrc).toContain("REFERRALS_ME_PATH");
    expect(deskSrc).toContain("REFERRALS_CONTEST_PATH");
    expect(deskSrc).toContain("NativeErrorState");
    expect(deskSrc).toContain("referralLink(window.location.origin, summary.code)");
  });
});
