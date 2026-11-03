/**
 * money-desks-2 — Stack-100 Money wave II (items 65–70) pure-logic
 * pins. Every expectation is traced to the 2D surface that owns the
 * rail (named in money-desks-2.ts's header): the beats page, the
 * tip page + Tip Jar page, TrustPanels (permanence + claims), the
 * creator-pricing page, and the credit-history page's endpoints.
 */
import { describe, expect, it } from "vitest";
import {
  BEAT_AI_TAGS_COST_VB,
  BEAT_AI_TAGS_FEATURE,
  BEATS_COMMISSION_LINE,
  BEATS_PAGE_SIZE,
  beatAiTagApplyPayload,
  beatAiTagsOutcome,
  beatAiTagsPath,
  beatCheckoutSessionId,
  beatCheckoutUrl,
  beatLicensePayload,
  beatLicensePath,
  beatListingProblem,
  beatPatchPath,
  beatSaleStatusLabel,
  beatSelectedOfferUnavailable,
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
  parseBeatAiTagSuggestion,
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
    /* beatWire has no stems on file, so under ruling #2 the stems
       Exclusive tier is unavailable while Basic/Premium stay open —
       the all-open case is pinned with has_stems in the ruling-#2
       test below. */
    expect(offers[0]!.soldOut).toBe(false);
    expect(offers[1]!.soldOut).toBe(false);
    expect(offers[2]!.soldOut).toBe(true);
    const sold = parseBeat({ ...beatWire, exclusive_sold: true })!;
    expect(beatTierOffers(sold)[2]!.soldOut).toBe(true);
    const exclTpl = { ...sold.licenseTemplates[0]!, isExclusive: true };
    expect(beatTemplateOffer(sold, exclTpl).soldOut).toBe(true);
  });

  /* Stack1100 X4 (C1) superseded the old sold-out rule above: an
     exclusive sale closes the WHOLE market — the server 409s every
     offer on a sold beat and the offers rail marks every offer
     unavailable — so the non-exclusive template pin that used to
     read soldOut=false now reads true, and every tier does too.
     The pre-X4 pin is replaced, not relaxed: the exclusive tier
     assertions above still hold under the wider rule. */
  it("an exclusive sale closes the whole market — every offer sold out (X4 C1)", () => {
    const sold = parseBeat({ ...beatWire, exclusive_sold: true })!;
    expect(beatTierOffers(sold).every((o) => o.soldOut)).toBe(true);
    expect(beatTemplateOffer(sold, sold.licenseTemplates[0]!).soldOut).toBe(true);
    const open = parseBeat(beatWire)!;
    expect(beatTemplateOffer(open, open.licenseTemplates[0]!).soldOut).toBe(false);
  });

  /* Stack1400 ruling #2 (Beats OD2): the desk mirrors the server's
     available flag — a stems-format offer (the Exclusive tier is
     ownership_stems; a wav_mp3_stems template likewise) is
     unavailable when the beat has no stems on file, while non-stems
     offers stay buyable. beatWire carries no has_stems, so its beat
     has none on file. */
  it("stems guard: stems offers unavailable with no stems on file, non-stems unaffected (ruling #2)", () => {
    const noStems = parseBeat(beatWire)!;
    expect(noStems.hasStems).toBe(false);
    const offers = beatTierOffers(noStems);
    expect(offers.find((o) => o.key === "basic")!.soldOut).toBe(false);
    expect(offers.find((o) => o.key === "premium")!.soldOut).toBe(false);
    const exclusive = offers.find((o) => o.key === "exclusive")!;
    expect(exclusive.soldOut).toBe(true);
    expect(exclusive.stemsBlocked).toBe(true);

    const stemsTpl = { ...noStems.licenseTemplates[0]!, format: "wav_mp3_stems" as const };
    expect(beatTemplateOffer(noStems, stemsTpl).soldOut).toBe(true);
    expect(beatTemplateOffer(noStems, stemsTpl).stemsBlocked).toBe(true);
    /* The wire's own template is wav_mp3 — not a stems offer. */
    expect(beatTemplateOffer(noStems, noStems.licenseTemplates[0]!).soldOut).toBe(false);

    expect(beatSelectedOfferUnavailable(noStems, "basic")).toBe(false);
    expect(beatSelectedOfferUnavailable(noStems, "exclusive")).toBe(true);
    /* The selected-offer lookup reads the beat's OWN templates, so
       the tpl: case needs a beat whose template is the stems one. */
    const stemsBeat = parseBeat({
      ...beatWire,
      license_templates: [{ ...beatWire.license_templates[0]!, format: "wav_mp3_stems" }],
    })!;
    expect(beatSelectedOfferUnavailable(stemsBeat, `tpl:${stemsTpl.id}`)).toBe(true);
    expect(beatSelectedOfferUnavailable(noStems, `tpl:${stemsTpl.id}`)).toBe(false);

    const withStems = parseBeat({ ...beatWire, has_stems: true })!;
    expect(withStems.hasStems).toBe(true);
    expect(beatTierOffers(withStems).every((o) => !o.soldOut)).toBe(true);
    expect(beatTemplateOffer(withStems, stemsTpl).soldOut).toBe(false);
    expect(beatSelectedOfferUnavailable(withStems, "exclusive")).toBe(false);
    /* An unmasked stems_url (producer dashboard rows) also proves it. */
    expect(parseBeat({ ...beatWire, stems_url: "https://cdn.example/stems.zip" })!.hasStems).toBe(true);
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
      previewUrl: undefined,
      stemsUrl: undefined,
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

  /* The page's preview + stems slots ride the payload in the page's
     own shape (stack1100 X4): trimmed, and present whenever the
     seller filled them — the fields the marketplace needs so a
     form-listed beat's public preview is not silently the master
     and a stems license can actually deliver stems. */
  it("sell payload carries preview + stems URLs exactly as the page sends them (X4)", () => {
    const form = emptyBeatListingForm();
    form.title = "New Beat";
    form.audioUrl = "https://cdn.example/new.mp3";
    form.previewUrl = "  https://cdn.example/preview.mp3  ";
    form.stemsUrl = "https://cdn.example/stems.zip";
    const payload = buildBeatListingPayload(form)!;
    expect(payload["previewUrl"]).toBe("https://cdn.example/preview.mp3");
    expect(payload["stemsUrl"]).toBe("https://cdn.example/stems.zip");
    form.previewUrl = "   ";
    expect(buildBeatListingPayload(form)["previewUrl"]).toBeUndefined();
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

  /* Stack1100 X4 (C5): licenses/mine rows name their beat and carry
     the delivery URLs on completed licenses — the buyer library
     renders both, so the parser must carry them through verbatim
     (and read null where the rail sends none, e.g. a pending row
     or a dashboard sales row, which has no buyer entitlement). */
  it("buyer licenses carry the beat title + delivery URLs the rail hands over (X4 C5)", () => {
    const mine = parseMyLicenses({
      licenses: [
        {
          id: "l2", tier: "exclusive", terms: null, priceCents: 49999, status: "completed", createdAt: "2026-01-04",
          beatTitle: "Midnight Trap", downloadUrl: "https://cdn.example/master.mp3", stemsUrl: "https://cdn.example/stems.zip",
        },
        {
          id: "l3", tier: "basic", terms: null, priceCents: 2999, status: "pending_payment", createdAt: "2026-01-05",
          beatTitle: "Other Beat", downloadUrl: null, stemsUrl: null,
        },
      ],
    });
    expect(mine[0]).toMatchObject({
      beatTitle: "Midnight Trap",
      downloadUrl: "https://cdn.example/master.mp3",
      stemsUrl: "https://cdn.example/stems.zip",
    });
    expect(mine[1]).toMatchObject({ beatTitle: "Other Beat", downloadUrl: null, stemsUrl: null });
    const dash = parseBeatDashboard({
      beats: [],
      sales: [{ id: "s9", tier: "basic", terms_snapshot: null, price_cents: 2999, status: "completed", created_at: "2026-01-06" }],
      stats: null,
    });
    expect(dash.sales[0]).toMatchObject({ beatTitle: null, downloadUrl: null, stemsUrl: null });
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

/* Stack1200 Y1-gap parity: the dashboard BeatRow's AI-tags
   affordance, mirrored on the page's own rails — POST
   /api/beats/:id/ai-tags (the charged suggester) and the Apply
   PATCH /api/beats/:id { genre, moodTags }. */
describe("#65 beats AI-tags parity (stack1200)", () => {
  it("the pinned price + feature name the server's own charge (100 VB, its ledger action)", () => {
    /* beats-pricing.ts: BEAT_AI_TAGS_CREDIT_COST = 100, charged as
       "Beat AI Tag Suggester". The 2D button's "1cr" label is stale;
       the desk names the rail's true charge and changes nothing. */
    expect(BEAT_AI_TAGS_COST_VB).toBe(100);
    expect(BEAT_AI_TAGS_FEATURE).toBe("Beat AI Tag Suggester");
    expect(beatAiTagsPath("b 1")).toBe("/api/beats/b%201/ai-tags");
    expect(beatPatchPath("b 1")).toBe("/api/beats/b%201");
  });

  it("a suggestion parses the page's way — genre falls back to the beat's own, tags default empty", () => {
    expect(parseBeatAiTagSuggestion({ genre: " drill ", moodTags: ["dark", "bouncy"] }, "trap"))
      .toEqual({ genre: "drill", moodTags: ["dark", "bouncy"] });
    expect(parseBeatAiTagSuggestion({ moodTags: ["chill"] }, "lofi"))
      .toEqual({ genre: "lofi", moodTags: ["chill"] });
    expect(parseBeatAiTagSuggestion({ genre: "pop" }, "trap"))
      .toEqual({ genre: "pop", moodTags: [] });
    expect(parseBeatAiTagSuggestion(null, "trap")).toBeNull();
    expect(parseBeatAiTagSuggestion("drill", "trap")).toBeNull();
  });

  it("the outcome verdict: 402 is credits, an OK answer is the suggestion, failures stop honestly", () => {
    expect(beatAiTagsOutcome({ status: 402, data: { error: "out_of_credits" } }, "trap"))
      .toEqual({ kind: "credits" });
    expect(beatAiTagsOutcome({ status: 200, data: { genre: "drill", moodTags: ["dark"] } }, "trap"))
      .toEqual({ kind: "ok", suggestion: { genre: "drill", moodTags: ["dark"] } });
    /* The server's 500 line already carries its refund note — the
       desk surfaces it verbatim rather than inventing its own. */
    expect(beatAiTagsOutcome({ status: 500, data: { error: "AI returned no usable tags — Visual Bucs refunded." } }, "trap"))
      .toEqual({ kind: "error", message: "AI returned no usable tags — Visual Bucs refunded." });
    const shapeless = beatAiTagsOutcome({ status: 200, data: null }, "trap");
    expect(shapeless.kind).toBe("error");
    const bare = beatAiTagsOutcome({ status: 500, data: {} }, "trap");
    expect(bare).toEqual({ kind: "error", message: "The tag suggester couldn't run — try again." });
  });

  it("the Apply payload is the BeatRow's exact PATCH body — genre + moodTags, nothing else", () => {
    expect(beatAiTagApplyPayload({ genre: "drill", moodTags: ["dark", "bouncy"] }))
      .toEqual({ genre: "drill", moodTags: ["dark", "bouncy"] });
    expect(Object.keys(beatAiTagApplyPayload({ genre: "pop", moodTags: [] }))).toEqual(["genre", "moodTags"]);
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
    /* stack800 lane 3: a settled tip reads "Received" — the old
       expectation pinned the raw "paid" token as display text. */
    expect(tipFeedStatusLabel("paid")).toBe("Received");
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
