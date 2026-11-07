/**
 * referrals-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 35): /referrals payload guards + per-section
 * render-error isolation.
 *
 * The defect: both payloads were stored raw (setInfo(data),
 * setContest(cdata)) and the render dereferenced info.referrals
 * .filter, info.ranks.weekly/.monthly/.alltime, info.tierLadder.map,
 * info.claimedMilestones.includes — and ContestSection, rendered
 * ABOVE the page's loading/error gates, dereferenced
 * contest.prizes.reduce, contest.standings.*, contest.lastWinners.*
 * and contest.rules.map. A partial payload threw during render and
 * blanked the whole promoter page.
 *
 * The fix: lib/referrals-data normalizers at the fetch boundary (a
 * /me payload without a usable code → the page's honest load-failed
 * state; a partial contest coerces field-by-field), plus a
 * SectionBoundary per section. Idiom follows lane D3: real-class
 * compositions + normalizer unit tests + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";
import {
  normalizeContestData,
  normalizeReferralInfo,
} from "../lib/referrals-data";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./referrals.tsx");
const appSource = read("../App.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
  retryLabel: "Try again",
};

function makeBoundary(name: string, child: ReactElement) {
  return new SectionBoundaryCore({
    name,
    variant: "section",
    isLight: false,
    title: LABELS.title,
    description: LABELS.description,
    retryLabel: LABELS.retryLabel,
    children: child,
  });
}

function failWith(boundary: SectionBoundaryCore, error: Error) {
  Object.assign(
    boundary.state,
    SectionBoundaryCore.getDerivedStateFromError(error),
  );
}

describe("referrals shape — one bad section never blanks the promoter page", () => {
  it("a failed tracker card degrades alone; contest, rank and ladder still render; App-level copy absent", () => {
    const contest = makeBoundary(
      "referrals-contest",
      createElement("p", null, "CONTEST SECTION"),
    );
    const tracker = makeBoundary(
      "referrals-tracker",
      createElement("p", null, "TRACKER CARD"),
    );
    const ladder = makeBoundary(
      "referrals-ladder",
      createElement("p", null, "LADDER CARD"),
    );
    failWith(tracker, new Error("tracker row malformed"));

    const html = [
      renderToStaticMarkup(contest.render() as ReactElement),
      renderToStaticMarkup(tracker.render() as ReactElement),
      renderToStaticMarkup(ladder.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("CONTEST SECTION");
    expect(html).toContain("LADDER CARD");
    expect(html).toContain('data-testid="section-error-referrals-tracker"');
    expect(html).not.toContain("TRACKER CARD");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("referrals normalizers (census item 35)", () => {
  const FULL_INFO = {
    code: "KING123",
    totalReferrals: 7,
    activeReferrals: 5,
    creditsEarned: 4200,
    revenueSharePct: 25,
    shareWindowDays: 90,
    refereeReward: 1000,
    referrals: [
      { joinedAt: "2026-11-01T00:00:00Z", creditsEarned: 100, shareExpiresAt: null, daysLeft: 80, active: true },
    ],
    tier: { stars: 3, title: "Gold Promoter", ratePct: 25 },
    nextTier: { stars: 4, title: "Platinum", ratePct: 30, minReferrals: 10, milestoneBonus: 500 },
    claimedMilestones: [1, 2],
    tierLadder: [{ stars: 1, title: "Bronze", ratePct: 10, minReferrals: 1, milestoneBonus: 100 }],
    ranks: { weekly: 4, monthly: 9, alltime: null },
  };

  it("passes a well-formed /me payload through with values intact", () => {
    const info = normalizeReferralInfo(FULL_INFO);
    expect(info).not.toBeNull();
    expect(info!.code).toBe("KING123");
    expect(info!.referrals).toHaveLength(1);
    expect(info!.ranks.weekly).toBe(4);
    expect(info!.ranks.alltime).toBeNull();
    expect(info!.tierLadder[0]!.minReferrals).toBe(1);
    expect(info!.claimedMilestones).toEqual([1, 2]);
  });

  it("returns null when the payload is not an object or carries no usable code — the page shows its load-failed state", () => {
    expect(normalizeReferralInfo(null)).toBeNull();
    expect(normalizeReferralInfo("x")).toBeNull();
    expect(normalizeReferralInfo({})).toBeNull();
    expect(normalizeReferralInfo({ code: "" })).toBeNull();
    expect(normalizeReferralInfo({ code: 42 })).toBeNull();
  });

  it("coerces a partial /me payload: arrays default, ranks default to unranked, junk entries dropped", () => {
    const info = normalizeReferralInfo({
      code: "ABC",
      referrals: "nope",
      tierLadder: [{ stars: "x" }, null],
      claimedMilestones: [1, "two", 3],
      ranks: { weekly: "4" },
    });
    expect(info).not.toBeNull();
    expect(info!.referrals).toEqual([]);
    expect(info!.tierLadder).toHaveLength(1);
    expect(info!.tierLadder[0]!.stars).toBe(0);
    expect(info!.claimedMilestones).toEqual([1, 3]);
    expect(info!.ranks).toEqual({ weekly: null, monthly: null, alltime: null });
    expect(info!.tier).toBeNull();
    expect(info!.nextTier).toBeNull();
    /* The exact derefs the census named are now unconditionally safe: */
    expect(() => info!.referrals.filter(() => true)).not.toThrow();
    expect(() => info!.tierLadder.map((t) => t.stars)).not.toThrow();
    expect(() => info!.claimedMilestones.includes(1)).not.toThrow();
  });

  it("contest: non-object → null (section stays hidden, like a failed fetch); partial object coerces so prizes.reduce can never throw", () => {
    expect(normalizeContestData(null)).toBeNull();
    expect(normalizeContestData(42)).toBeNull();
    const contest = normalizeContestData({ prizes: "nope", standings: [null, { name: "A" }], rules: ["r1", 5] });
    expect(contest).not.toBeNull();
    expect(contest!.prizes).toEqual([]);
    expect(() =>
      contest!.prizes.reduce((sum, p) => sum + p.prizeCredits, 0),
    ).not.toThrow();
    expect(contest!.standings).toHaveLength(1);
    expect(contest!.rules).toEqual(["r1"]);
    expect(contest!.lastWinners).toEqual([]);
  });
});

describe("referrals.tsx — census-35 structure (source pins)", () => {
  it("wires both normalizers at the fetch boundary — no raw setInfo/setContest of unparsed data", () => {
    expect(pageSource).toContain("normalizeReferralInfo(data)");
    expect(pageSource).toContain("normalizeContestData(cdata)");
    expect(pageSource).not.toContain("setInfo(data)");
    expect(pageSource).not.toContain("setContest(cdata)");
  });

  it.each([
    "referrals-contest",
    "referrals-rank",
    "referrals-stats",
    "referrals-leaderboard",
    "referrals-link",
    "referrals-share-kit",
    "referrals-share",
    "referrals-tracker",
    "referrals-ladder",
    "referrals-fan-links",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 10 boundary usages", () => {
    expect(pageSource.match(/<SectionBoundary name="referrals-/g) ?? []).toHaveLength(10);
  });
});
