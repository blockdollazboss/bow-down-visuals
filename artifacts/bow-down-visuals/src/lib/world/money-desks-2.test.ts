/**
 * money-desks-2 — Stack-100 Money wave II (items 65–70) pure-logic
 * pins. Every expectation is traced to the 2D surface that owns the
 * rail (named in money-desks-2.ts's header): the beats page, the
 * tip page + Tip Jar page, TrustPanels (permanence + claims), the
 * creator-pricing page, and the credit-history page's endpoints.
 */
import { describe, expect, it } from "vitest";
import {
  BEATS_COMMISSION_LINE,
  BEATS_PAGE_SIZE,
  beatCheckoutSessionId,
  beatCheckoutUrl,
  beatLicensePayload,
  beatLicensePath,
  beatListingProblem,
  beatSaleStatusLabel,
  beatTemplateFormFromDto,
  beatTemplateProblem,
  beatTierOffers,
  beatTemplateOffer,
  beatsBrowsePath,
  buildBeatListingPayload,
  buildBeatTemplatePayload,
  buildTipSettingsPayload,
  catalogPermanencePath,
  claimActionPayload,
  claimActionPath,
  claimActionProblem,
  claimActionsFor,
  emptyBeatListingForm,
  emptyBeatTemplateForm,
  ledgerPage,
  moneyCents,
  otherElection,
  parseBeat,
  parseBeatDashboard,
  parseClaimRows,
  parseMyLicenses,
  parseMyTemplates,
  parsePermanenceState,
  parseSitePlanMe,
  parseSitePlans,
  parseTipJarDashboard,
  parseTipPage,
  permanencePayload,
  planCheckoutPayload,
  planHostedUrl,
  planPriceLabel,
  plansNote,
  releasePermanencePath,
  tipAmountProblem,
  tipCheckoutPath,
  tipCheckoutUrl,
  tipFeedStatusLabel,
  tipIntentPath,
  tipPagePath,
  tipSendPayload,
  tipSettingsFormFrom,
  type BeatDto,
  type ClaimRow,
} from "./money-desks-2";
import type { LedgerEntry } from "./earnings-board";

const beatWire = {
  id: "b1",
  user_id: "producer-1",
  title: "Midnight Trap",
  audio_url: "https://cdn.example/beat.mp3",
  preview_url: null,
  genre: "trap",
  bpm: 140,
  musical_key: "F#m",
  mood_tags: ["dark", "bouncy"],
  description: null,
  basic_price_cents: 2999,
  premium_price_cents: 9999,
  exclusive_price_cents: 49999,
  exclusive_sold: false,
  plays: 42,
  license_templates: [
    {
      id: "t1", producerId: "producer-1", name: "Lease Plus", priceCents: 4999,
      isExclusive: false, format: "wav_mp3", streamsCap: 100000, salesCap: null,
      musicVideosCap: 1, radioTvAllowed: false, livePerformancesCap: null,
      termYears: 2, territory: "Worldwide", creditLine: null, termsNote: null,
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    },
  ],
};

describe("#65 beats station logic", () => {
  it("browse path carries the page's filter names + the rail's limit/offset", () => {
    expect(beatsBrowsePath({ genre: "trap", mood: "", search: "mid", minBpm: "", maxBpm: "160" }, 24))
      .toBe("/api/beats?genre=trap&search=mid&maxBpm=160&limit=24&offset=24");
    expect(BEATS_PAGE_SIZE).toBe(24);
    expect(beatsBrowsePath({ genre: "", mood: "", search: "", minBpm: "", maxBpm: "" }, 0))
      .toBe("/api/beats?limit=24&offset=0");
  });

  it("parses a browse beat with its producer templates attached", () => {
    const beat = parseBeat(beatWire)!;
    expect(beat.title).toBe("Midnight Trap");
    expect(beat.basicPriceCents).toBe(2999);
    expect(beat.licenseTemplates).toHaveLength(1);
    expect(beat.licenseTemplates[0]!.name).toBe("Lease Plus");
    expect(parseBeat({ title: "no id" })).toBeNull();
    expect(parseBeat(null)).toBeNull();
  });

  it("tier offers carry the page's prices, blurbs and the exclusive sold-out rule", () => {
    const beat = parseBeat(beatWire)!;
    const offers = beatTierOffers(beat);
    expect(offers.map((o) => [o.key, o.priceCents])).toEqual([
      ["basic", 2999], ["premium", 9999], ["exclusive", 49999],
    ]);
    expect(offers[0]!.blurb).toContain("50k streams");
    expect(offers.every((o) => !o.soldOut)).toBe(true);
    const sold = parseBeat({ ...beatWire, exclusive_sold: true })!;
    expect(beatTierOffers(sold)[2]!.soldOut).toBe(true);
    expect(beatTemplateOffer(sold, sold.licenseTemplates[0]!).soldOut).toBe(false);
    const exclTpl = { ...sold.licenseTemplates[0]!, isExclusive: true };
    expect(beatTemplateOffer(sold, exclTpl).soldOut).toBe(true);
  });

  it("license payload names exactly one offer — the page's body", () => {
    expect(beatLicensePayload({ tier: "premium" })).toEqual({ tier: "premium" });
    expect(beatLicensePayload({ templateId: "t1" })).toEqual({ templateId: "t1" });
    expect(beatLicensePath("b 1")).toBe("/api/beats/b%201/license");
  });

  it("reads the checkout hand-off (url + session id) and nothing else", () => {
    const payload = { checkoutUrl: "https://checkout.stripe.com/x", sessionId: "cs_1" };
    expect(beatCheckoutUrl(payload)).toBe("https://checkout.stripe.com/x");
    expect(beatCheckoutSessionId(payload)).toBe("cs_1");
    expect(beatCheckoutUrl({})).toBeNull();
    expect(beatCheckoutUrl(null)).toBeNull();
  });

  it("the commission line is the page's own 15% words", () => {
    expect(BEATS_COMMISSION_LINE).toContain("15% site commission on sales");
  });

  it("sell payload mirrors the page's POST body and gates", () => {
    const form = emptyBeatListingForm();
    expect(beatListingProblem(form)).not.toBeNull();
    form.title = "New Beat";
    form.audioUrl = "https://cdn.example/new.mp3";
    form.moodTags = "dark, chill ,";
    expect(buildBeatListingPayload(form)).toEqual({
      title: "New Beat",
      audioUrl: "https://cdn.example/new.mp3",
      genre: "hip-hop",
      bpm: undefined,
      musicalKey: undefined,
      moodTags: ["dark", "chill"],
      description: undefined,
      basicPriceCents: 2999,
      premiumPriceCents: 9999,
      exclusivePriceCents: 49999,
    });
    form.basicPrice = "-5";
    expect(buildBeatListingPayload(form)).toBeNull();
  });

  it("dashboard parses beats, snake_case sales and gross/net stats", () => {
    const dash = parseBeatDashboard({
      beats: [beatWire],
      sales: [{ id: "s1", tier: "basic", terms_snapshot: null, price_cents: 2999, status: "pending_payment", created_at: "2026-01-02" }],
      stats: { beatCount: 1, saleCount: 1, grossCents: 2999, netCents: 2549 },
    });
    expect(dash.beats).toHaveLength(1);
    expect(dash.sales[0]!.priceCents).toBe(2999);
    expect(dash.stats).toEqual({ beatCount: 1, saleCount: 1, grossCents: 2999, netCents: 2549 });
    expect(beatSaleStatusLabel("pending_payment")).toBe("Pending payment");
    expect(moneyCents(2549)).toBe("$25.49");
  });

  it("buyer licenses parse from licenses/mine's DTO shape", () => {
    const mine = parseMyLicenses({
      licenses: [{ id: "l1", tier: "premium", terms: null, priceCents: 9999, status: "completed", createdAt: "2026-01-03" }],
    });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe("completed");
    expect(parseMyLicenses({})).toEqual([]);
  });

  it("template form round-trips through the page's payload shape", () => {
    const form = emptyBeatTemplateForm();
    expect(beatTemplateProblem(form)).not.toBeNull();
    form.name = "Lease Plus";
    form.priceDollars = "49.99";
    form.streamsCap = "100000";
    const payload = buildBeatTemplatePayload(form);
    expect(payload).toMatchObject({ name: "Lease Plus", priceCents: 4999, streamsCap: 100000, salesCap: null, territory: "Worldwide" });
    const dto = parseMyTemplates({ templates: [beatWire.license_templates[0]] })[0]!;
    const back = beatTemplateFormFromDto(dto);
    expect(back.priceDollars).toBe("49.99");
    expect(back.streamsCap).toBe("100000");
    expect(back.termYears).toBe("2");
  });
});

describe("#66 tip logic", () => {
  it("parses the public tip page with its API notice verbatim", () => {
    const page = parseTipPage({
      page: { handle: "nova", displayName: "Nova", message: "Thanks!", suggestedAmounts: [5, 10, 25], goalAmount: 500, goalLabel: "New mic" },
      stats: { total: 120, count: 4, average: 30, goalProgress: 0.24 },
      paymentsLive: false,
      notice: "Tips are recorded as intent only.",
    })!;
    expect(page.displayName).toBe("Nova");
    expect(page.notice).toBe("Tips are recorded as intent only.");
    expect(page.goalProgress).toBe(0.24);
    expect(parseTipPage({})).toBeNull();
    expect(tipPagePath("no va")).toBe("/api/tips/page/no%20va");
  });

  it("send payload + checkout/intent paths match the tip page", () => {
    expect(tipSendPayload(10, " Fan ", " hi ")).toEqual({ amount: 10, fanName: "Fan", message: "hi" });
    expect(tipCheckoutPath("nova")).toBe("/api/tips/nova/checkout");
    expect(tipIntentPath("nova")).toBe("/api/tips/nova/tip");
    expect(tipCheckoutUrl({ checkoutUrl: "https://x" })).toBe("https://x");
    expect(tipCheckoutUrl({})).toBeNull();
  });

  it("amount gates mirror the rail's $1–$10,000 schema", () => {
    expect(tipAmountProblem(null)).not.toBeNull();
    expect(tipAmountProblem(0)).not.toBeNull();
    expect(tipAmountProblem(0.5)).toContain("$1");
    expect(tipAmountProblem(10001)).toContain("10,000");
    expect(tipAmountProblem(25)).toBeNull();
  });

  it("settings form + save payload mirror the Tip Jar page, fallback included", () => {
    const form = tipSettingsFormFrom({
      settings: { handle: "nova", displayName: "Nova", message: "", suggestedAmounts: [5, 15], goalAmount: null, goalLabel: "" },
    })!;
    expect(form.suggested).toBe("5, 15");
    expect(buildTipSettingsPayload(form).suggestedAmounts).toEqual([5, 15]);
    form.suggested = "abc";
    expect(buildTipSettingsPayload(form).suggestedAmounts).toEqual([5, 10, 25]);
    form.goalAmount = "250";
    expect(buildTipSettingsPayload(form).goalAmount).toBe(250);
  });

  it("dashboard parses totals + feed; pending reads as intent, never received", () => {
    const dash = parseTipJarDashboard({
      hasPage: true, handle: "nova", total: 120, count: 4, average: 30,
      goalAmount: 500, goalLabel: "Mic", goalProgress: 0.24, paymentsLive: true,
      feed: [{ id: "f1", amount: 25, fanName: "Sam", message: "", status: "pending_payment", createdAt: "2026-01-01" }],
    })!;
    expect(dash.total).toBe(120);
    expect(dash.feed[0]!.fanName).toBe("Sam");
    expect(tipFeedStatusLabel("pending_payment")).toBe("Intent recorded");
    expect(tipFeedStatusLabel("paid")).toBe("paid");
  });
});

describe("#67 permanence + claims logic", () => {
  it("permanence state keeps release ids for the write rail", () => {
    const state = parsePermanenceState({
      catalog: { election: "permanent" },
      releases: [{ id: "row1", releaseId: "rel1", releaseTitle: "First Album", election: "standard" }],
      covers: ["Your release page stays live"],
      excludes: ["Stores outside this platform"],
    })!;
    expect(state.catalogElection).toBe("permanent");
    expect(state.releases[0]).toEqual({ rowId: "row1", releaseId: "rel1", title: "First Album", election: "standard" });
    expect(catalogPermanencePath()).toBe("/api/distribution/permanence/catalog");
    expect(releasePermanencePath("rel1")).toBe("/api/distribution/releases/rel1/permanence");
    expect(permanencePayload("permanent")).toEqual({ election: "permanent" });
    expect(otherElection("permanent")).toBe("standard");
    expect(otherElection("standard")).toBe("permanent");
  });

  it("claim actions gate exactly like the ClaimsPanel (role × status)", () => {
    const mk = (youAre: string, status: string): ClaimRow => ({
      id: "c1", label: "Upload", youAre, status, detail: "", disputeNote: null, resolutionNote: null,
    });
    expect(claimActionsFor(mk("uploader", "pending"))).toEqual(["dispute"]);
    expect(claimActionsFor(mk("owner", "pending"))).toEqual(["accept"]);
    expect(claimActionsFor(mk("owner", "disputed"))).toEqual(["resolve"]);
    expect(claimActionsFor(mk("owner", "accepted"))).toEqual(["resolve"]);
    expect(claimActionsFor(mk("uploader", "disputed"))).toEqual([]);
    expect(claimActionsFor(mk("owner", "resolved"))).toEqual([]);
  });

  it("resolve requires a note; the payload is the panel's { action, note }", () => {
    expect(claimActionProblem("resolve", "  ")).not.toBeNull();
    expect(claimActionProblem("resolve", "Lease verified")).toBeNull();
    expect(claimActionProblem("dispute", "")).toBeNull();
    expect(claimActionPayload("dispute", "mine")).toEqual({ action: "dispute", note: "mine" });
    expect(claimActionPath("c 1")).toBe("/api/content-id/claims/c%201");
  });

  it("claim rows parse with evidence + notes", () => {
    const rows = parseClaimRows({
      claims: [{ id: "c1", sourceLabel: "My Song", youAre: "owner", status: "disputed", offsetSeconds: 12, confidence: 0.9, matchedLandmarks: 8, totalLandmarks: 10, disputeNote: "Licensed", resolutionNote: null }],
    });
    expect(rows[0]!.detail).toContain("8 of 10 landmarks");
    expect(rows[0]!.disputeNote).toBe("Licensed");
  });
});

describe("#69 site plan logic", () => {
  it("plans parse from the rail's DTO — prices ride the payload, note included", () => {
    const payload = {
      plans: [
        { tier: "free", name: "Free", tagline: "", priceUsdPerMonth: null, priceConfigured: true, feeBps: 1000, feePct: 10, aiBoostsPerMonth: 3, features: [{ label: "Subdomain site" }] },
        { tier: "pro", name: "Pro", tagline: "Go pro", priceUsdPerMonth: 12, priceConfigured: true, feeBps: 700, feePct: 7, aiBoostsPerMonth: 25, features: [{ label: "Custom domain" }] },
        { tier: "elite", name: "Elite", tagline: "", priceUsdPerMonth: 29, priceConfigured: false, feeBps: 500, feePct: 5, aiBoostsPerMonth: 100, features: [] },
      ],
      note: "Prices and fee rates are proposed and pending owner approval. Stripe TEST mode only.",
    };
    const plans = parseSitePlans(payload)!;
    expect(plans.map((p) => planPriceLabel(p))).toEqual(["Free", "$12/mo", "$29/mo"]);
    expect(plans[1]!.feePct).toBe(7);
    expect(plans[2]!.purchasable).toBe(false);
    expect(plansNote(payload)).toContain("TEST mode");
    expect(parseSitePlans({})).toBeNull();
  });

  it("me + checkout payload + hosted url mirror the pricing page", () => {
    const me = parseSitePlanMe({ tier: "pro", status: "active", feeBps: 700, feePct: 7, aiBoostsPerMonth: 25, currentPeriodEnd: null })!;
    expect(me.tier).toBe("pro");
    expect(planCheckoutPayload("elite")).toEqual({ tier: "elite", returnTo: "/world" });
    expect(planHostedUrl({ url: "https://billing.stripe.com/x" })).toBe("https://billing.stripe.com/x");
    expect(planHostedUrl({})).toBeNull();
  });
});

describe("#70 full ledger pagination", () => {
  const entries: LedgerEntry[] = Array.from({ length: 45 }, (_, i) => ({
    id: `e${i}`, kind: "usage", title: `Row ${i}`, detail: "", amount: "−1", unit: "VB", dateIso: null,
  }));

  it("pages the whole history — no recent-rows cap", () => {
    const p0 = ledgerPage(entries, 0);
    expect(p0.total).toBe(45);
    expect(p0.pageCount).toBe(3);
    expect(p0.rows).toHaveLength(20);
    const p2 = ledgerPage(entries, 2);
    expect(p2.rows).toHaveLength(5);
    expect(p2.rows[0]!.id).toBe("e40");
  });

  it("clamps an out-of-range page instead of stranding the walker", () => {
    expect(ledgerPage(entries, 99).page).toBe(2);
    expect(ledgerPage(entries, -3).page).toBe(0);
    expect(ledgerPage([], 0)).toEqual({ rows: [], page: 0, pageCount: 1, total: 0 });
  });
});

describe("type-only guard: BeatDto shape stays importable", () => {
  it("parseBeat output satisfies the DTO", () => {
    const beat: BeatDto | null = parseBeat(beatWire);
    expect(beat?.producerId).toBe("producer-1");
  });
});
