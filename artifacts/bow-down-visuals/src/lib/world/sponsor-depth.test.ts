import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMPTY_SPONSOR_POST_FORM,
  SPONSOR_PITCH_COST_VB,
  SPONSOR_PLATFORM_FEE_BPS_DEFAULT,
  SPONSOR_POST_COST_VB,
  buildSponsorApplyPayload,
  buildSponsorPitchPayload,
  buildSponsorPostPayload,
  buildSponsorReviewPayload,
  isSponsorSpendingPaused,
  normalizeSponsorApplications,
  normalizeSponsorCanSpend,
  normalizeSponsorDashboard,
  normalizeSponsorDealDetail,
  normalizeSponsorFundResult,
  normalizeSponsorPitchResult,
  normalizeSponsorPostResult,
  sponsorApplicationPath,
  sponsorDealActionPath,
  sponsorDealApplicationsPath,
  sponsorDealApplyPath,
  sponsorDealPath,
  sponsorDealStepIndex,
  sponsorErrorMessage,
  sponsorFundAmountCents,
  sponsorMoneyCents,
  sponsorPostFormError,
  sponsorReleasePreview,
  type SponsorPostForm,
} from "./sponsor-depth";

/* ─── Sponsor depth desk (stack1400 world parity wave 1, item 5) ───
   The sponsor marketplace at full depth in-World: post a deal,
   the dashboard, and deal detail + escrow actions, on the sponsors
   router's own rails. These tests pin the seam: the paths against
   the router, the post/pitch prices against the rail constants and
   the credit registry, the fee split against the rail's default,
   the payload builders against the rail's zod schemas, and the
   desk's presence in the StudioBoard composition. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const FULL_DEAL = {
  id: "deal-1",
  brandName: "Goldline Headphones",
  budgetMin: 500,
  budgetMax: 2000,
  niche: "Music gear",
  deliverables: "One 60s review video",
  description: "Review our new headphones.",
  deadline: "2027-01-01T00:00:00.000Z",
  status: "active",
  createdAt: "2026-11-01T00:00:00.000Z",
  postedBy: "brand-1",
  agreedAmountCents: null,
  escrowStatus: "unfunded",
  platformFeeCents: null,
  creatorPayoutCents: null,
  acceptedApplicationId: null,
  acceptedUserId: null,
  paidAt: null,
  applicationCount: 2,
  myApplicationStatus: null,
};

describe("rails + prices", () => {
  it("the paths are the sponsors router's own endpoints", () => {
    expect(sponsorDealPath("deal-1")).toBe("/api/sponsors/deals/deal-1");
    expect(sponsorDealApplicationsPath("deal-1")).toBe("/api/sponsors/deals/deal-1/applications");
    expect(sponsorDealApplyPath("deal-1")).toBe("/api/sponsors/deals/deal-1/apply");
    expect(sponsorApplicationPath("app-1")).toBe("/api/sponsors/applications/app-1");
    expect(sponsorDealActionPath("deal-1", "fund")).toBe("/api/sponsors/deals/deal-1/fund");
    expect(sponsorDealActionPath("deal-1", "start")).toBe("/api/sponsors/deals/deal-1/start");
    expect(sponsorDealActionPath("deal-1", "complete")).toBe("/api/sponsors/deals/deal-1/complete");
    expect(sponsorDealActionPath("deal-1", "release")).toBe("/api/sponsors/deals/deal-1/release");
    const rail = read("../../../../api-server/src/routes/generate/sponsors.ts");
    for (const route of [
      'router.post("/sponsors/deals"',
      'router.get("/sponsors/dashboard"',
      'router.get("/sponsors/deals/:id"',
      'router.get("/sponsors/deals/:id/applications"',
      'router.post("/sponsors/deals/:id/apply"',
      'router.post("/sponsors/pitch"',
      'router.patch("/sponsors/applications/:id"',
      'router.post("/sponsors/deals/:id/fund"',
      'router.post("/sponsors/escrow/confirm"',
      'router.post("/sponsors/deals/:id/start"',
      'router.post("/sponsors/deals/:id/complete"',
      'router.post("/sponsors/deals/:id/release"',
      'router.get("/sponsors/can-spend"',
    ]) {
      expect(rail).toContain(route);
    }
  });

  it("posting is the rail's 500 and the pitch writer its 100 — registry-pinned both", () => {
    expect(SPONSOR_POST_COST_VB).toBe(500);
    expect(SPONSOR_PITCH_COST_VB).toBe(100);
    const rail = read("../../../../api-server/src/routes/generate/sponsors.ts");
    expect(rail).toContain('Number(process.env["SPONSOR_POST_CREDIT_COST"]) || 500');
    expect(rail).toContain('Number(process.env["SPONSOR_AI_CREDIT_COST"]) || 100');
    const costs = read("../credit-costs.ts");
    expect(costs).toContain('"/api/sponsors/deals": { cost: 500, feature: "Sponsor Deals" }');
    expect(costs).toContain('"/api/sponsors/pitch": { cost: 100, feature: "Sponsor Pitch" }');
    /* C-21: the posting form lives in the Brand Deals Post a Deal tab
       panel now — the 500 pin follows the form. */
    const postPage = read("../../components/sponsors/PostDealPanel.tsx");
    /* Stack-300 A6: the form's quote reads the registry entry pinned
       just above, instead of a second typed copy of the 500. */
    expect(postPage).toContain('const POST_COST = getCreditCost("/api/sponsors/deals")?.cost ?? 500;');
  });

  it("the fee preview mirrors the rail's default 1500 bps (15% / 85%) split", () => {
    expect(SPONSOR_PLATFORM_FEE_BPS_DEFAULT).toBe(1500);
    const rail = read("../../../../api-server/src/routes/generate/sponsors.ts");
    expect(rail).toContain('Number(process.env["SPONSOR_PLATFORM_FEE_BPS"]) || 1500');
    expect(rail).toContain("export function sponsorFeeSplit");
    expect(sponsorReleasePreview(50000)).toEqual({ feeCents: 7500, netCents: 42500 });
    expect(sponsorReleasePreview(0)).toEqual({ feeCents: 0, netCents: 0 });
  });
});

describe("normalizers", () => {
  it("the deal detail maps the full DTO field-for-field; a broken payload fails the read", () => {
    const deal = normalizeSponsorDealDetail({ deal: FULL_DEAL })!;
    expect(deal).toEqual({
      id: "deal-1",
      brandName: "Goldline Headphones",
      budgetMin: 500,
      budgetMax: 2000,
      niche: "Music gear",
      deliverables: "One 60s review video",
      description: "Review our new headphones.",
      deadline: "2027-01-01T00:00:00.000Z",
      status: "active",
      createdAt: "2026-11-01T00:00:00.000Z",
      postedBy: "brand-1",
      agreedAmountCents: null,
      escrowStatus: "unfunded",
      platformFeeCents: null,
      creatorPayoutCents: null,
      acceptedApplicationId: null,
      acceptedUserId: null,
      paidAt: null,
      applicationCount: 2,
      myApplicationStatus: null,
    });
    expect(normalizeSponsorDealDetail({ deal: { id: "x" } })).toBeNull();
    expect(normalizeSponsorDealDetail({})).toBeNull();
  });

  it("the dashboard maps posted deals (DTO) + applications/payouts (snake_case rows)", () => {
    const data = normalizeSponsorDashboard({
      postedDeals: [FULL_DEAL],
      applications: [
        {
          id: "app-1", deal_id: "deal-1", application_status: "accepted", pitch: "I review gear weekly.",
          created_at: "2026-11-02T00:00:00.000Z", brand_name: "Goldline Headphones", budget_min: 500,
          budget_max: 2000, niche: "Music gear", deal_status: "active", agreed_amount_cents: 100000,
          escrow_status: "unfunded",
        },
      ],
      payouts: [
        {
          id: "pay-1", deal_id: "deal-9", gross_cents: 50000, fee_cents: 7500, net_cents: 42500,
          created_at: "2026-10-01T00:00:00.000Z", brand_name: "Goldline Headphones",
        },
      ],
      totalEarnedCents: 42500,
    })!;
    expect(data.postedDeals).toHaveLength(1);
    expect(data.applications[0]).toMatchObject({
      id: "app-1", dealId: "deal-1", applicationStatus: "accepted", agreedAmountCents: 100000,
    });
    expect(data.payouts[0]).toMatchObject({ grossCents: 50000, feeCents: 7500, netCents: 42500 });
    expect(data.totalEarnedCents).toBe(42500);
    expect(normalizeSponsorDashboard({ postedDeals: [] })).toBeNull();
    expect(normalizeSponsorDashboard(null)).toBeNull();
  });

  it("the brand's application list maps snake_case rows; empty is a real empty", () => {
    const apps = normalizeSponsorApplications({
      applications: [
        {
          id: "app-1", deal_id: "deal-1", user_id: "creator-1", pitch: "Pick me.",
          status: "pending", portfolio_url: "https://example.com/work", decided_at: null,
          created_at: "2026-11-02T00:00:00.000Z",
        },
      ],
    })!;
    expect(apps[0]).toMatchObject({ id: "app-1", userId: "creator-1", portfolioUrl: "https://example.com/work" });
    expect(normalizeSponsorApplications({ applications: [] })).toEqual([]);
    expect(normalizeSponsorApplications({ applications: [{ id: "x" }] })).toBeNull();
  });

  it("post result, pitch result, fund result and can-spend read their own shapes", () => {
    expect(normalizeSponsorPostResult({ deal: { id: "deal-2" }, creditsUsed: 500, creditsRemaining: 1200 }))
      .toEqual({ dealId: "deal-2", creditsUsed: 500, creditsRemaining: 1200 });
    expect(normalizeSponsorPostResult({})).toBeNull();
    expect(normalizeSponsorPitchResult({ pitch: "Hello brand…" })).toBe("Hello brand…");
    expect(normalizeSponsorPitchResult({})).toBeNull();
    expect(normalizeSponsorFundResult({ sandbox: true, sessionId: "sess-1" }))
      .toEqual({ sandbox: true, sessionId: "sess-1", clientSecret: null, checkoutUrl: null });
    expect(normalizeSponsorFundResult({ clientSecret: "cs_1" }))
      .toEqual({ sandbox: false, sessionId: null, clientSecret: "cs_1", checkoutUrl: null });
    expect(normalizeSponsorCanSpend({ canSpend: false })).toBe(false);
    expect(normalizeSponsorCanSpend({})).toBeNull();
  });
});

describe("payload builders — the rail's zod rules", () => {
  const READY: SponsorPostForm = {
    brandName: " Goldline ",
    budgetMin: "500",
    budgetMax: "2000",
    niche: "Music gear",
    deliverables: "One review video",
    description: "Review our headphones.",
    deadline: "2027-01-01",
  };

  it("the post form validates in the 2D page's order and builds the rail's payload", () => {
    expect(sponsorPostFormError(EMPTY_SPONSOR_POST_FORM)).toBe("Add your brand name.");
    expect(sponsorPostFormError({ ...READY, budgetMax: "100" })).toContain("at least the lowest budget");
    expect(sponsorPostFormError({ ...READY, deadline: "" })).toBe("Pick a deadline.");
    expect(sponsorPostFormError(READY)).toBeNull();
    expect(buildSponsorPostPayload(READY)).toEqual({
      brandName: "Goldline",
      budgetMin: 500,
      budgetMax: 2000,
      niche: "Music gear",
      deliverables: "One review video",
      description: "Review our headphones.",
      deadline: new Date("2027-01-01").toISOString(),
    });
    expect(buildSponsorPostPayload(EMPTY_SPONSOR_POST_FORM)).toBeNull();
  });

  it("apply needs a pitch; the portfolio rides only when given", () => {
    expect(buildSponsorApplyPayload("  ", "")).toBeNull();
    expect(buildSponsorApplyPayload(" My pitch ", "")).toEqual({ pitch: "My pitch" });
    expect(buildSponsorApplyPayload("My pitch", " https://example.com "))
      .toEqual({ pitch: "My pitch", portfolioUrl: "https://example.com" });
  });

  it("the pitch writer payload mirrors the 2D page's body", () => {
    expect(buildSponsorPitchPayload("", { creatorName: "A", niche: "Gear", followers: "", achievements: "", tone: "bold" })).toBeNull();
    expect(buildSponsorPitchPayload("deal-1", { creatorName: " A ", niche: " Gear ", followers: "12,500", achievements: " Won ", tone: "bold" }))
      .toEqual({
        dealId: "deal-1", creatorName: "A", niche: "Gear", followers: 12500,
        platforms: [], achievements: "Won", tone: "bold",
      });
  });

  it("review: reject is bare; accept needs an in-budget agreed payout in cents", () => {
    const deal = { budgetMin: 500, budgetMax: 2000 };
    expect(buildSponsorReviewPayload("reject", "", deal)).toEqual({ payload: { action: "reject" } });
    expect(buildSponsorReviewPayload("accept", "", deal)).toEqual({ error: "Add the agreed payout before accepting." });
    expect(buildSponsorReviewPayload("accept", "100", deal)).toMatchObject({ error: expect.stringContaining("within the posted budget") });
    expect(buildSponsorReviewPayload("accept", "1000", deal)).toEqual({ payload: { action: "accept", agreedAmountCents: 100000 } });
  });

  it("the fund amount prefers the deal's agreed cents, else the typed dollars", () => {
    expect(sponsorFundAmountCents({ agreedAmountCents: 100000 }, "5")).toBe(100000);
    expect(sponsorFundAmountCents({ agreedAmountCents: null }, "250")).toBe(25000);
    expect(sponsorFundAmountCents({ agreedAmountCents: null }, "")).toBeNull();
  });
});

describe("steps, money + errors", () => {
  it("the lifecycle steps index like the 2D timeline; cancelled is off-lifecycle", () => {
    expect(sponsorDealStepIndex("active")).toBe(0);
    expect(sponsorDealStepIndex("in_progress")).toBe(2);
    expect(sponsorDealStepIndex("paid")).toBe(4);
    expect(sponsorDealStepIndex("cancelled")).toBe(-1);
    expect(sponsorMoneyCents(42500)).toBe("$425.00");
    expect(sponsorMoneyCents(null)).toBe("—");
  });

  it("errors speak plainly: server sentence wins, 402 and paused keep their words", () => {
    expect(sponsorErrorMessage({ error: "Deal not found." }, 404, "fb")).toBe("Deal not found.");
    expect(sponsorErrorMessage({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to post your deal." }, 402, "fb"))
      .toContain("out of Visual Bucs");
    expect(sponsorErrorMessage({}, 402, "fb")).toContain("out of Visual Bucs");
    const paused = { error: "Credit spending is paused on this account right now — nothing was charged.", code: "CREDITS_DISABLED" };
    expect(isSponsorSpendingPaused(paused, 403)).toBe(true);
    expect(sponsorErrorMessage(paused, 403, "fb")).toContain("paused");
    expect(sponsorErrorMessage(null, 500, "fb")).toBe("fb");
  });
});

describe("the desk in the World", () => {
  const deskSrc = read("../../components/world/native/SponsorDepthDesk.tsx");
  const boardSrc = read("../../components/world/native/boards/StudioBoard.tsx");

  it("StudioBoard mounts the desk beside the sponsor pipeline summary", () => {
    expect(boardSrc).toContain('import { SponsorDepthDesk } from "@/components/world/native/SponsorDepthDesk";');
    expect(boardSrc).toContain("<SponsorDepthDesk isLight={isLight} />");
  });

  it("the desk rides confirmedFetch for both charged rails and plain fetch for the free ones", () => {
    expect(deskSrc).toContain("confirmedFetch(SPONSOR_DEALS_PATH");
    expect(deskSrc).toContain("confirmedFetch(SPONSOR_PITCH_PATH");
    expect(deskSrc).toContain("fetch(SPONSOR_DASHBOARD_PATH");
    expect(deskSrc).toContain("fetch(SPONSOR_CAN_SPEND_PATH");
    expect(deskSrc).toContain("sponsorDealApplicationsPath(id)");
    expect(deskSrc).toContain('sponsorDealActionPath(openId, "fund")');
    expect(deskSrc).toContain("SPONSOR_ESCROW_CONFIRM_PATH");
  });

  it("funding stays in-World: embedded checkout mounts in the desk; the hosted URL is only the rail's fallback", () => {
    expect(deskSrc).toContain("<EmbeddedSessionCheckout clientSecret={fundSecret} />");
    expect(deskSrc).toContain('data-testid="world-sponsor-fund-embedded"');
    expect(deskSrc).toContain("window.location.href = fund.checkoutUrl");
  });

  it("the desk carries the full surface: post form, three dashboard boards, detail actions", () => {
    for (const id of [
      "world-sponsor-depth-desk",
      "world-sponsor-post-form",
      "world-sponsor-post-submit",
      "world-sponsor-depth-summary",
      "world-sponsor-open-deal",
      "world-sponsor-open-application",
      "world-sponsor-open-payout",
      "world-sponsor-depth-escrow",
      "world-sponsor-depth-steps",
      "world-sponsor-apply",
      "world-sponsor-write-pitch",
      "world-sponsor-accept",
      "world-sponsor-reject",
      "world-sponsor-fund",
      "world-sponsor-release",
      "world-sponsor-start",
      "world-sponsor-complete",
      "world-sponsor-depth-back",
    ]) {
      expect(deskSrc).toContain(`data-testid="${id}"`);
    }
    /* No doors out: the desk never links to the 2D sponsor pages. */
    expect(deskSrc).not.toContain('href="/sponsors');
    expect(deskSrc).not.toContain('"/sponsors/post"');
    expect(deskSrc).not.toContain('"/sponsors/dashboard"');
  });
});
