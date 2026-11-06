/**
 * ugc-ads-escrow.test.ts — the Briefs Board escrow seam (C-25).
 *
 * The seam's money rules, pinned without a server:
 * - a PRICED brief's DTO normalizes with its money fields and the
 *   escrow note; a FREE brief normalizes with every money field null
 *   and the off-site note (its v1 shape);
 * - the fund action is offered only to the brand, only on a priced
 *   brief a creator has claimed (or delivered), only while the
 *   escrow is unfunded/funding — never at post, never after funding
 *   lands, never to the claimer or a stranger;
 * - the net preview splits with the server's rounding at the brief's
 *   own feeBps (odd cents: $100.01 at 500 bps → 500 fee / 9501 net);
 * - escrow states read in plain words;
 * - the fund result normalizes defensively;
 * - the money NOTE is conditional on the brief's priced state
 *   (C-25 follow-up): priced → escrow note, free → off-site note —
 *   per brief via ugcBriefMoneyNote, and on the general surfaces
 *   (board header, /charts, World outreach) via the combined
 *   UGC_BRIEFS_MONEY_NOTE, whose brand name is never lowercased.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  UGC_BRIEFS_MONEY_NOTE,
  UGC_ESCROW_NOTE,
  UGC_PAYMENT_NOTE,
  briefActionsFor,
  escrowStatusLabel,
  normalizeUgcBrief,
  normalizeUgcBriefFundResult,
  ugcBriefMoneyNote,
  ugcBriefNetPreview,
  type UgcBrief,
} from "./ugc-ads";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const BRAND = "brand-1";
const CREATOR = "creator-1";
const THIRD = "third-1";

const RAW_FREE = {
  id: "99999999-9999-4999-8999-0000000000bb",
  brandUserId: BRAND,
  productName: "Trail Boots",
  productImageUrl: null,
  productUrl: null,
  details: "Show the boots surviving a rainy festival weekend.",
  style: "problem-fix",
  deadline: null,
  status: "open",
  claimedByUserId: null,
  deliveredAdId: null,
  paymentNote: UGC_PAYMENT_NOTE,
  createdAt: "2026-11-05T12:00:00.000Z",
  updatedAt: "2026-11-05T12:00:00.000Z",
};

const RAW_PRICED = {
  ...RAW_FREE,
  status: "claimed",
  claimedByUserId: CREATOR,
  paymentNote: UGC_ESCROW_NOTE,
  priceCents: 10001,
  escrowStatus: "unfunded",
  feeBps: 500,
  platformFeeCents: null,
  creatorPayoutCents: null,
  releasedAmountCents: null,
  releasedAt: null,
};

const brief = (over: Partial<UgcBrief>): UgcBrief => ({
  ...(normalizeUgcBrief(RAW_PRICED) as UgcBrief),
  ...over,
});

describe("normalizeUgcBrief — money fields", () => {
  it("a priced brief carries its money fields and the escrow note", () => {
    const b = normalizeUgcBrief(RAW_PRICED)!;
    expect(b.priceCents).toBe(10001);
    expect(b.escrowStatus).toBe("unfunded");
    expect(b.feeBps).toBe(500);
    expect(b.platformFeeCents).toBeNull();
    expect(b.paymentNote).toBe(UGC_ESCROW_NOTE);
  });

  it("a free brief carries NO money — every money field null, off-site note intact", () => {
    const b = normalizeUgcBrief(RAW_FREE)!;
    expect(b.priceCents).toBeNull();
    expect(b.escrowStatus).toBeNull();
    expect(b.feeBps).toBeNull();
    expect(b.platformFeeCents).toBeNull();
    expect(b.creatorPayoutCents).toBeNull();
    expect(b.releasedAmountCents).toBeNull();
    expect(b.releasedAt).toBeNull();
    expect(b.paymentNote).toBe(UGC_PAYMENT_NOTE);
  });

  it("a released brief carries its release stamps", () => {
    const b = normalizeUgcBrief({
      ...RAW_PRICED,
      status: "approved",
      escrowStatus: "released",
      platformFeeCents: 500,
      creatorPayoutCents: 9501,
      releasedAmountCents: 10001,
      releasedAt: "2026-11-05T13:00:00.000Z",
    })!;
    expect(b.escrowStatus).toBe("released");
    expect(b.creatorPayoutCents).toBe(9501);
    expect(b.releasedAt).toBe("2026-11-05T13:00:00.000Z");
  });
});

describe("briefActionsFor — the fund gate", () => {
  it("the brand can fund a claimed priced brief (unfunded or funding)", () => {
    expect(briefActionsFor(brief({}), BRAND)).toContain("fund");
    expect(briefActionsFor(brief({ escrowStatus: "funding" }), BRAND)).toContain("fund");
    expect(briefActionsFor(brief({ status: "delivered" }), BRAND)).toContain("fund");
  });

  it("no fund at post, none after the money lands, none for anyone else", () => {
    /* Open (unclaimed) brief: money never locks before a claim. */
    expect(briefActionsFor(brief({ status: "open", claimedByUserId: null }), BRAND)).not.toContain("fund");
    /* Funded / released / refunded: the door is closed. */
    expect(briefActionsFor(brief({ escrowStatus: "funded" }), BRAND)).not.toContain("fund");
    expect(briefActionsFor(brief({ status: "approved", escrowStatus: "released" }), BRAND)).not.toContain("fund");
    expect(briefActionsFor(brief({ status: "closed", escrowStatus: "refunded" }), BRAND)).not.toContain("fund");
    /* The claimer and a stranger never see it. */
    expect(briefActionsFor(brief({}), CREATOR)).not.toContain("fund");
    expect(briefActionsFor(brief({}), THIRD)).not.toContain("fund");
    /* A free brief has no fund door at all. */
    const free = normalizeUgcBrief({ ...RAW_FREE, status: "claimed", claimedByUserId: CREATOR })!;
    expect(briefActionsFor(free, BRAND)).not.toContain("fund");
  });
});

describe("ugcBriefNetPreview + escrowStatusLabel", () => {
  it("splits odd cents with the server's rounding at the brief's feeBps", () => {
    expect(ugcBriefNetPreview(brief({}))).toEqual({ feeCents: 500, netCents: 9501 });
    expect(ugcBriefNetPreview(brief({ priceCents: 100, feeBps: 500 }))).toEqual({ feeCents: 5, netCents: 95 });
    expect(ugcBriefNetPreview(brief({ priceCents: 999, feeBps: null }))).toEqual({ feeCents: 50, netCents: 949 });
  });

  it("a free brief previews nothing", () => {
    const free = normalizeUgcBrief(RAW_FREE)!;
    expect(ugcBriefNetPreview(free)).toBeNull();
  });

  it("escrow states read in plain words", () => {
    expect(escrowStatusLabel("unfunded")).toBe("Not funded");
    expect(escrowStatusLabel("funding")).toBe("Funding started");
    expect(escrowStatusLabel("funded")).toBe("Funded — held safely");
    expect(escrowStatusLabel("released")).toBe("Released to the creator");
    expect(escrowStatusLabel("refunded")).toBe("Refunded");
    expect(escrowStatusLabel(null)).toBe("");
  });
});

describe("the money note — conditional on the brief's priced state (C-25 follow-up)", () => {
  it("priced → the escrow note; free → the off-site note", () => {
    expect(ugcBriefMoneyNote({ priceCents: 10001 })).toBe(UGC_ESCROW_NOTE);
    expect(ugcBriefMoneyNote({ priceCents: null })).toBe(UGC_PAYMENT_NOTE);
    expect(ugcBriefMoneyNote({})).toBe(UGC_PAYMENT_NOTE);
    expect(ugcBriefMoneyNote({ priceCents: undefined })).toBe(UGC_PAYMENT_NOTE);
  });

  it("a brief that arrives without a note falls back through the same conditional", () => {
    expect(normalizeUgcBrief({ ...RAW_PRICED, paymentNote: "" })!.paymentNote).toBe(UGC_ESCROW_NOTE);
    expect(normalizeUgcBrief({ ...RAW_FREE, paymentNote: "" })!.paymentNote).toBe(UGC_PAYMENT_NOTE);
  });

  it("the combined general note carries BOTH branches, brand name correctly cased", () => {
    expect(UGC_BRIEFS_MONEY_NOTE).toBe(
      "Bow Down Visuals holds this brief's payment safely and releases it to the creator when the brand approves the delivery. " +
        "For a brief with no price, Bow Down Visuals doesn't hold or move money for briefs — payment is arranged between the brand and the creator directly.",
    );
    expect(UGC_BRIEFS_MONEY_NOTE.startsWith(UGC_ESCROW_NOTE)).toBe(true);
    expect(UGC_BRIEFS_MONEY_NOTE.endsWith(UGC_PAYMENT_NOTE)).toBe(true);
    expect(UGC_BRIEFS_MONEY_NOTE).toContain("For a brief with no price, Bow Down Visuals");
    /* The casing defect: the brand name is never lowercase. */
    expect(UGC_BRIEFS_MONEY_NOTE).not.toContain("bow Down Visuals");
  });

  it("the general surfaces render the combined note — the blanket note stands alone nowhere", () => {
    const surfaces: Array<[string, string]> = [
      ["the briefs board header", read("../components/hub/UgcAdsPanel.tsx")],
      ["the /charts For Brands tab", read("../pages/discovery/charts.tsx")],
      ["the World outreach panel", read("../components/world/native/boards/BrandOutreachPanel.tsx")],
    ];
    for (const [name, src] of surfaces) {
      expect(src, name).toContain("UGC_BRIEFS_MONEY_NOTE");
      expect(src, name).not.toContain("UGC_PAYMENT_NOTE");
      expect(src, name).not.toContain("bow Down");
    }
    /* The board header no longer lowercases the seam note inline. */
    expect(read("../components/hub/UgcAdsPanel.tsx")).not.toContain("charAt(0).toLowerCase()");
  });
});

describe("normalizeUgcBriefFundResult", () => {
  it("shapes sandbox + embedded + hosted answers; junk becomes null", () => {
    expect(normalizeUgcBriefFundResult({ sandbox: true, sessionId: "sandbox_x", amountCents: 5000 })).toMatchObject({
      sandbox: true,
      sessionId: "sandbox_x",
      amountCents: 5000,
      clientSecret: null,
    });
    expect(
      normalizeUgcBriefFundResult({ sandbox: false, sessionId: "cs_1", clientSecret: "sec_1", uiMode: "embedded" }),
    ).toMatchObject({ sandbox: false, clientSecret: "sec_1", uiMode: "embedded", checkoutUrl: null });
    expect(normalizeUgcBriefFundResult({ sandbox: false, sessionId: "cs_2", checkoutUrl: "https://checkout.example/x" }))
      .toMatchObject({ checkoutUrl: "https://checkout.example/x" });
    expect(normalizeUgcBriefFundResult(null)).toBeNull();
    expect(normalizeUgcBriefFundResult("nope")).toBeNull();
  });
});
