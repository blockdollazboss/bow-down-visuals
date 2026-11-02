/**
 * coach-panels — World parity P3 (lane par-coach-depth) pure-logic
 * pins: the Coach's niche analyzer + money/action trackers finished
 * as full in-world panels on the /coach page's own rails.
 *
 * Costs are the credit registry's own figures; payloads mirror the
 * website panels' bodies; parsers are tolerant of the real wire
 * (missing fields degrade, never invent); the ledger math is the
 * Money Tracker panel's reduce over the rail's rows; the plan
 * numbers are the server's DTO, parsed — never re-derived.
 */
import { describe, it, expect } from "vitest";
import {
  IDEA_PLATFORMS,
  IDEA_VALIDATOR_COST_VISUAL_BUCS,
  LEDGER_EXPENSE_CATEGORIES,
  LEDGER_INCOME_CATEGORIES,
  NICHE_ANALYZER_COST_VISUAL_BUCS,
  NICHE_EXPERIENCE_LEVELS,
  NICHE_PLATFORMS,
  actionItemSourceLabel,
  buildActionItemPayload,
  buildActionItemTogglePayload,
  buildGoalPayload,
  buildIdeaValidatePayload,
  buildLedgerEntryPayload,
  buildNicheAnalyzePayload,
  buildReleaseLinkPayload,
  buildRoadmapSavePayload,
  defaultNicheInputs,
  isOutOfCreditsResponse,
  ledgerCategoryBarWidth,
  ledgerEntriesForMonth,
  ledgerMonthKeyOf,
  ledgerMonthLabel,
  ledgerStats,
  ledgerTodayYmd,
  moneyCategoryLabel,
  nicheFitBand,
  nicheScoreBand,
  nicheScoreBarWidth,
  parseActionItem,
  parseActionItems,
  parseIdeaVerdictResponse,
  parseLedgerEntries,
  parseNicheAnalysisResponse,
  parsePlanNumbers,
  ROYALTY_INSIGHTS_COST_VISUAL_BUCS,
  SPLIT_SHEET_PDF_COST_VISUAL_BUCS,
  buildPublishingAmendPayload,
  buildPublishingDisputePayload,
  buildPublishingRegisterPayload,
  buildRoyaltyPayoutPayload,
  buildSplitLedgerPostBody,
  buildWave8SheetPayload,
  parseFinalizedSheet,
  parsePublishingMine,
  parseRoyaltyInsights,
  parseSplitsOverview,
  parseWave8Sheets,
  publishingWritersFromRows,
  royaltyBarPct,
  royaltyMoneyLabel,
  royaltyMonthlyBarHeight,
  splitCentsLargestRemainder,
  splitSheetSlug,
  validateRoyaltyPayoutDraft,
  validateWave8Draft,
  wave8DraftTotalPct,
  shiftLedgerMonthKey,
  validateIdeaInput,
  validateLedgerEntryDraft,
  validateNicheInputs,
  type LedgerEntryDraft,
  type NicheAnalysis,
  type RoyaltyPayoutDraft,
  type Wave8DraftRow,
} from "./coach-panels";

const ANALYSIS: NicheAnalysis = {
  niche: "Gospel drill",
  summary: "A lane with room.",
  audienceDemographics: "18–34, church-adjacent drill fans",
  audienceInterests: ["choir flips", "testimony"],
  contentGaps: [{ angle: "Choir-sample breakdowns", whyUnderserved: "Nobody teaches it", opportunity: "Own the tutorial seat" }],
  monetizationPaths: [{ path: "Beat sales", fitScore: 90, why: "Catalog fits", firstStep: "List three beats" }],
  competitionScore: 30,
  competitionLabel: "Roomy",
  contentPillars: [{ name: "Sample Sundays", description: "Weekly flip", exampleIdeas: ["Flip a hymn"] }],
  roadmap30Day: [
    { week: 1, focus: "Foundations", angles: ["Intro post"] },
    { week: 2, focus: "Proof", angles: ["First flip"] },
  ],
};

describe("niche analyzer — costs + option lists are the page's own", () => {
  it("quotes the registry: 150 to analyze, 75 to validate an idea", () => {
    expect(NICHE_ANALYZER_COST_VISUAL_BUCS).toBe(150);
    expect(IDEA_VALIDATOR_COST_VISUAL_BUCS).toBe(75);
  });

  it("platform + experience keys are the rail's", () => {
    expect(NICHE_PLATFORMS.map((p) => p.key)).toEqual(["all", "tiktok", "instagram", "youtube", "x"]);
    expect(IDEA_PLATFORMS.map((p) => p.key)).toEqual(["tiktok", "instagram", "youtube", "x"]);
    expect(NICHE_EXPERIENCE_LEVELS.map((e) => e.key)).toEqual(["beginner", "intermediate", "advanced"]);
    expect(defaultNicheInputs()).toEqual({ niche: "", platform: "all", experience: "beginner", useMyData: false });
  });
});

describe("niche analyzer — validation + payload", () => {
  it("refuses a blank typed niche, allows a blank grounded one", () => {
    expect(validateNicheInputs({ ...defaultNicheInputs(), niche: " " })).toContain("Enter a niche first");
    expect(validateNicheInputs({ ...defaultNicheInputs(), niche: "x" })).toContain("Enter a niche first");
    expect(validateNicheInputs({ ...defaultNicheInputs(), niche: "", useMyData: true })).toBeNull();
    expect(validateNicheInputs({ ...defaultNicheInputs(), niche: "x", useMyData: true })).toContain("too short");
    expect(validateNicheInputs({ ...defaultNicheInputs(), niche: "fitness" })).toBeNull();
  });

  it("the payload carries the niche only at 2+ characters, capped at 120", () => {
    expect(buildNicheAnalyzePayload({ niche: "  gospel drill ", platform: "tiktok", experience: "advanced", useMyData: false })).toEqual({
      niche: "gospel drill",
      targetPlatform: "tiktok",
      experienceLevel: "advanced",
      useMyData: false,
    });
    const blank = buildNicheAnalyzePayload({ niche: "", platform: "all", experience: "beginner", useMyData: true });
    expect(blank).not.toHaveProperty("niche");
    expect(blank).toMatchObject({ targetPlatform: "all", experienceLevel: "beginner", useMyData: true });
    const long = buildNicheAnalyzePayload({ niche: "n".repeat(200), platform: "all", experience: "beginner", useMyData: false });
    expect((long["niche"] as string).length).toBe(120);
  });
});

describe("niche analyzer — response parsing", () => {
  it("round-trips a full analysis + grounding", () => {
    const parsed = parseNicheAnalysisResponse({
      analysis: {
        niche: "Gospel drill",
        summary: "A lane with room.",
        audienceProfile: { demographics: "18–34, church-adjacent drill fans", interests: ["choir flips", "testimony"] },
        contentGaps: [{ angle: "Choir-sample breakdowns", whyUnderserved: "Nobody teaches it", opportunity: "Own the tutorial seat" }],
        monetizationPaths: [{ path: "Beat sales", fitScore: 90, why: "Catalog fits", firstStep: "List three beats" }],
        competitionLevel: { score: 30, label: "Roomy" },
        contentPillars: [{ name: "Sample Sundays", description: "Weekly flip", exampleIdeas: ["Flip a hymn"] }],
        roadmap30Day: [
          { week: 1, focus: "Foundations", angles: ["Intro post"] },
          { week: 2, focus: "Proof", angles: ["First flip"] },
        ],
      },
      groundedIn: { derivedNiche: "gospel drill", songs: 12, releases: 2, topGenres: ["gospel", "drill"], signals: ["catalog"] },
      creditsRemaining: 850,
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.analysis).toEqual(ANALYSIS);
    expect(parsed!.groundedIn).toMatchObject({ derivedNiche: "gospel drill", songs: 12, releases: 2, topGenres: ["gospel", "drill"] });
    expect(parsed!.creditsRemaining).toBe(850);
  });

  it("no analysis — or no pillars — is a failure, never a render", () => {
    expect(parseNicheAnalysisResponse({})).toBeNull();
    expect(parseNicheAnalysisResponse({ analysis: null })).toBeNull();
    expect(parseNicheAnalysisResponse({ analysis: { niche: "x", contentPillars: [] } })).toBeNull();
    expect(parseNicheAnalysisResponse(null)).toBeNull();
  });

  it("malformed rows drop; the surviving shape never invents", () => {
    const parsed = parseNicheAnalysisResponse({
      analysis: {
        niche: "Lo-fi",
        contentPillars: [{ name: "Vinyl nights" }, { description: "no name — drops" }],
        contentGaps: [{ whyUnderserved: "no angle — drops" }, { angle: "Tape hiss ASMR" }],
        monetizationPaths: [{ path: "Sync", fitScore: "high" }],
        competitionLevel: { score: "busy" },
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.analysis.contentPillars).toEqual([{ name: "Vinyl nights", description: "", exampleIdeas: [] }]);
    expect(parsed!.analysis.contentGaps).toEqual([{ angle: "Tape hiss ASMR", whyUnderserved: "", opportunity: "" }]);
    expect(parsed!.analysis.monetizationPaths[0]).toMatchObject({ path: "Sync", fitScore: 0 });
    expect(parsed!.analysis.competitionScore).toBe(0);
    expect(parsed!.groundedIn).toBeNull();
    expect(parsed!.creditsRemaining).toBeNull();
  });

  it("score bands are the page's: 25 / 45 / 70, fit reads inverted", () => {
    expect(nicheScoreBand(0)).toBe("open");
    expect(nicheScoreBand(25)).toBe("open");
    expect(nicheScoreBand(26)).toBe("roomy");
    expect(nicheScoreBand(45)).toBe("roomy");
    expect(nicheScoreBand(46)).toBe("contested");
    expect(nicheScoreBand(70)).toBe("contested");
    expect(nicheScoreBand(71)).toBe("saturated");
    expect(nicheFitBand(90)).toBe("open");
    expect(nicheFitBand(10)).toBe("saturated");
    expect(nicheScoreBarWidth(-5)).toBe(0);
    expect(nicheScoreBarWidth(140)).toBe(100);
    expect(nicheScoreBarWidth(42)).toBe(42);
  });

  it("out-of-credits reads the page's way: 402 or the rail's word", () => {
    expect(isOutOfCreditsResponse(402, {})).toBe(true);
    expect(isOutOfCreditsResponse(200, { error: "out_of_credits" })).toBe(true);
    expect(isOutOfCreditsResponse(500, { error: "boom" })).toBe(false);
    expect(isOutOfCreditsResponse(200, {})).toBe(false);
  });
});

describe("niche analyzer — roadmap save + idea validator", () => {
  it("the roadmap saves as one action item per week, source niche", () => {
    expect(buildRoadmapSavePayload(ANALYSIS)).toEqual({
      titles: ["Week 1: Foundations", "Week 2: Proof"],
      source: "niche",
    });
  });

  it("idea input needs 5 real characters; the payload locks the niche", () => {
    expect(validateIdeaInput("  hi ")).toContain("at least 5 characters");
    expect(validateIdeaInput("rank my beats")).toBeNull();
    expect(buildIdeaValidatePayload({ idea: " rank my beats ", niche: "Gospel drill", platform: "tiktok" })).toEqual({
      idea: "rank my beats",
      niche: "Gospel drill",
      platform: "tiktok",
      targetAudience: "",
    });
  });

  it("a verdict parses only in the rail's three words", () => {
    expect(parseIdeaVerdictResponse({ verdict: { verdict: "go", overallScore: 82, summary: "Strong." } })).toEqual({
      verdict: "go",
      overallScore: 82,
      summary: "Strong.",
    });
    expect(parseIdeaVerdictResponse({ verdict: { verdict: "maybe", overallScore: 1 } })).toBeNull();
    expect(parseIdeaVerdictResponse({})).toBeNull();
  });
});

describe("money tracker — categories + parsing", () => {
  it("category lists are the page's own", () => {
    expect(LEDGER_INCOME_CATEGORIES).toContain("sponsor_deals");
    expect(LEDGER_INCOME_CATEGORIES).toContain("invoice_payout");
    expect(LEDGER_EXPENSE_CATEGORIES).toContain("contractors");
    expect(moneyCategoryLabel("streaming_royalties")).toBe("streaming royalties");
  });

  it("rows ride with id + date + real cents; malformed rows drop", () => {
    const entries = parseLedgerEntries({
      entries: [
        { id: "a", entry_type: "income", category: "merch_sales", amount_cents: 5000, note: "Hoodie", source: "Shop", entry_date: "2026-10-03", releaseId: null },
        { id: "b", entry_type: "expense", category: "ads", amount_cents: 1200, entry_date: "2026-10-20" },
        { id: "c", entry_type: "income", category: "merch_sales", amount_cents: "oops", entry_date: "2026-10-01" },
        { entry_type: "income", amount_cents: 100, entry_date: "2026-10-01" },
        { id: "e", entry_type: "income", amount_cents: 100 },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "a", entry_type: "income", amount_cents: 5000, note: "Hoodie", source: "Shop", releaseId: null });
    expect(entries[1]).toMatchObject({ id: "b", entry_type: "expense", note: "", source: null });
    expect(parseLedgerEntries({})).toEqual([]);
    expect(parseLedgerEntries(null)).toEqual([]);
  });
});

describe("money tracker — month math is the panel's reduce", () => {
  const entries = parseLedgerEntries({
    entries: [
      { id: "1", entry_type: "income", category: "merch_sales", amount_cents: 5000, entry_date: "2026-10-03" },
      { id: "2", entry_type: "income", category: "sponsor_deals", amount_cents: 9000, entry_date: "2026-10-11" },
      { id: "3", entry_type: "income", category: "merch_sales", amount_cents: 2500, entry_date: "2026-10-21" },
      { id: "4", entry_type: "expense", category: "ads", amount_cents: 1200, entry_date: "2026-10-20" },
      { id: "5", entry_type: "income", category: "merch_sales", amount_cents: 7000, entry_date: "2026-09-01" },
      { id: "6", entry_type: "expense", category: "software", amount_cents: 999, entry_date: "2026-09-15" },
    ],
  });

  it("month keys walk years cleanly and label in words", () => {
    expect(ledgerMonthKeyOf(new Date(2026, 9, 5))).toBe("2026-10");
    expect(shiftLedgerMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftLedgerMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftLedgerMonthKey("2026-10", -1)).toBe("2026-09");
    expect(ledgerMonthLabel("2026-10")).toBe("October 2026");
    expect(ledgerTodayYmd(new Date(2026, 0, 9))).toBe("2026-01-09");
  });

  it("the month view filters by key; stats split month vs all-time", () => {
    expect(ledgerEntriesForMonth(entries, "2026-10").map((e) => e.id)).toEqual(["1", "2", "3", "4"]);
    const stats = ledgerStats(entries, "2026-10");
    expect(stats).toMatchObject({
      monthIncomeCents: 16500,
      monthExpenseCents: 1200,
      monthNetCents: 15300,
      allTimeIncomeCents: 23500,
      allTimeExpenseCents: 2199,
      allTimeNetCents: 21301,
    });
    expect(stats.incomeByCategory).toEqual([
      ["sponsor_deals", 9000],
      ["merch_sales", 7500],
    ]);
    expect(stats.expenseByCategory).toEqual([["ads", 1200]]);
    expect(ledgerStats([], "2026-10")).toMatchObject({ monthIncomeCents: 0, allTimeNetCents: 0, incomeByCategory: [] });
  });

  it("breakdown bars floor at 4% of their own column", () => {
    expect(ledgerCategoryBarWidth(7500, 16500)).toBe(45);
    expect(ledgerCategoryBarWidth(10, 10000)).toBe(4);
    expect(ledgerCategoryBarWidth(10, 0)).toBe(0);
  });
});

describe("money tracker — entry form", () => {
  const draft = (over: Partial<LedgerEntryDraft> = {}): LedgerEntryDraft => ({
    type: "income",
    category: "sponsor_deals",
    amount: "1250.50",
    note: "  Q4 deal ",
    source: " Brand ",
    date: "2026-10-05",
    releaseId: "",
    ...over,
  });

  it("refuses a dead amount or a fake date, in words", () => {
    expect(validateLedgerEntryDraft(draft())).toBeNull();
    expect(validateLedgerEntryDraft(draft({ amount: "" }))).toContain("above $0");
    expect(validateLedgerEntryDraft(draft({ amount: "0" }))).toContain("above $0");
    expect(validateLedgerEntryDraft(draft({ amount: "-5" }))).toContain("above $0");
    expect(validateLedgerEntryDraft(draft({ date: "10/05/2026" }))).toContain("YYYY-MM-DD");
  });

  it("the payload converts dollars to cents once; release rides income only", () => {
    expect(buildLedgerEntryPayload(draft({ releaseId: "rel-1" }))).toEqual({
      type: "income",
      category: "sponsor_deals",
      amountCents: 125050,
      note: "Q4 deal",
      source: "Brand",
      date: "2026-10-05",
      releaseId: "rel-1",
    });
    expect(buildLedgerEntryPayload(draft({ type: "expense", category: "ads", releaseId: "rel-1" })).releaseId).toBeNull();
    expect(buildLedgerEntryPayload(draft({ source: " " })).source).toBeNull();
    expect(buildReleaseLinkPayload(null)).toEqual({ releaseId: null });
    expect(buildReleaseLinkPayload("rel-9")).toEqual({ releaseId: "rel-9" });
  });
});

describe("action tracker — plan numbers parse, never re-derive", () => {
  const DTO = {
    asOf: "2026-10-27T12:00:00Z",
    currentMonth: { key: "2026-10", incomeCents: 16500, expenseCents: 1200, netCents: 15300 },
    trailing: { monthsCounted: 2, monthKeys: ["2026-08", "2026-09"], avgMonthlyIncomeCents: 11000, avgMonthlyNetCents: 9000 },
    allTimeLedger: { incomeCents: 23500, expenseCents: 2199, netCents: 21301, entryCount: 6 },
    platform: { earningsCents: 4200, tipsVb: 1500, songs: 12, releases: 2, storeProducts: 3, membershipTiers: 1 },
    goal: { monthlyGoalCents: 150000, percentOfGoal: 7, monthlyGapCents: 139000, met: false, monthsOfNetToBankGoalMonth: 16 },
    hasData: true,
  };

  it("a full DTO rides verbatim, goal included", () => {
    const parsed = parsePlanNumbers(DTO);
    expect(parsed).toEqual(DTO);
  });

  it("a missing spine is a failure (null), not invented zeros", () => {
    expect(parsePlanNumbers({})).toBeNull();
    expect(parsePlanNumbers({ currentMonth: {}, trailing: {}, allTimeLedger: {}, platform: {} })).toBeNull(); // no hasData
    expect(parsePlanNumbers(null)).toBeNull();
  });

  it("no goal reads as no goal; a goal with no cents is no goal", () => {
    expect(parsePlanNumbers({ ...DTO, goal: null })!.goal).toBeNull();
    expect(parsePlanNumbers({ ...DTO, goal: { met: false } })!.goal).toBeNull();
    const noAvg = parsePlanNumbers({ ...DTO, trailing: { monthsCounted: 0, monthKeys: [], avgMonthlyIncomeCents: null, avgMonthlyNetCents: null } });
    expect(noAvg!.trailing.avgMonthlyIncomeCents).toBeNull();
    expect(noAvg!.hasData).toBe(true);
  });

  it("items parse with the page's source words; junk rows drop", () => {
    const items = parseActionItems({
      items: [
        { id: "1", title: "Pitch three podcasts", source: "plan", done: true, completedAt: "2026-10-20T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" },
        { id: "2", title: "Week 1: Foundations", source: "niche", done: false, completedAt: null, createdAt: null },
        { id: "3", title: "Typed by hand", source: "weird", done: false },
        { title: "no id — drops" },
      ],
    });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ source: "plan", done: true });
    expect(items[2]!.source).toBe("custom");
    expect(parseActionItems({})).toEqual([]);
    expect(actionItemSourceLabel("plan")).toBe("From your money plan");
    expect(actionItemSourceLabel("niche")).toBe("From your niche analysis");
    expect(actionItemSourceLabel("custom")).toBe("Added by you");
  });

  it("the single-item PATCH response parses through the same door", () => {
    expect(parseActionItem({ item: { id: "9", title: "Done it", source: "custom", done: true } })).toMatchObject({ id: "9", done: true });
    expect(parseActionItem({})).toBeNull();
  });

  it("goal / add / toggle payloads are the rails' bodies", () => {
    expect(buildGoalPayload(150000)).toEqual({ monthlyGoalCents: 150000 });
    expect(buildGoalPayload(null)).toEqual({ monthlyGoalCents: null });
    expect(buildActionItemPayload("  Ship the flip ")).toEqual({ title: "Ship the flip", source: "custom" });
    expect(buildActionItemPayload("Week 1: X", "niche")).toEqual({ title: "Week 1: X", source: "niche" });
    const item = { id: "1", title: "t", source: "custom" as const, done: false, completedAt: null, createdAt: null };
    expect(buildActionItemTogglePayload(item)).toEqual({ done: true });
    expect(buildActionItemTogglePayload({ ...item, done: true })).toEqual({ done: false });
  });
});

/* ─── Ring 4 #6: the Money Tracker's splits / split-sheets /
   royalties sub-views, on the page's own rails ───────────────────── */

describe("splits overview — the server's accounting, parsed never recomputed", () => {
  const WIRE = {
    releases: [
      {
        id: "rel-1",
        title: "Midnight Crown",
        artistName: "Thy Cheat Code",
        totalIncomeCents: 20000,
        collaboratorTotals: [
          { name: "Thy Cheat Code", role: "artist", totalCents: 15000 },
          { name: "Wave Maker", role: "producer", totalCents: 5000 },
        ],
        entries: [
          {
            id: "e-1",
            entryDate: "2026-10-03",
            note: "Sync fee",
            amountCents: 20000,
            agreementVersion: 2,
            shares: [
              { name: "Thy Cheat Code", role: "artist", sharePct: 75, amountCents: 15000 },
              { name: "Wave Maker", role: "producer", sharePct: 25, amountCents: 5000 },
            ],
          },
        ],
        activeSplits: [
          { name: "Thy Cheat Code", role: "artist", sharePct: 75, agreementVersion: 2 },
          { name: "Wave Maker", role: "producer", sharePct: 25, agreementVersion: 2 },
        ],
      },
    ],
    collaboratorTotals: [{ name: "Thy Cheat Code", role: "artist", totalCents: 15000 }],
    unlinkedIncomeCents: 4200,
    unlinkedIncomeCount: 3,
    disclaimer: "Split accounting for your logged income — automatic store payouts need a distribution partner.",
  };

  it("a full payload rides verbatim, disclaimer included", () => {
    const parsed = parseSplitsOverview(WIRE);
    expect(parsed).not.toBeNull();
    expect(parsed!.disclaimer).toBe(WIRE.disclaimer);
    expect(parsed!.releases[0]).toMatchObject({ id: "rel-1", title: "Midnight Crown", totalIncomeCents: 20000 });
    expect(parsed!.releases[0]!.entries[0]!.shares[1]).toEqual({
      name: "Wave Maker", role: "producer", sharePct: 25, amountCents: 5000,
    });
    expect(parsed!.releases[0]!.activeSplits[0]).toMatchObject({ sharePct: 75, agreementVersion: 2 });
    expect(parsed!.collaboratorTotals).toEqual([{ name: "Thy Cheat Code", role: "artist", totalCents: 15000 }]);
    expect(parsed!.unlinkedIncomeCents).toBe(4200);
    expect(parsed!.unlinkedIncomeCount).toBe(3);
  });

  it("an empty releases list is a real empty; a missing spine is a failure", () => {
    expect(parseSplitsOverview({ ...WIRE, releases: [] })).toMatchObject({ releases: [] });
    expect(parseSplitsOverview({ collaboratorTotals: [] })).toBeNull();
    expect(parseSplitsOverview({ releases: [] })).toBeNull(); // no disclaimer — not the rail's shape
    expect(parseSplitsOverview(null)).toBeNull();
  });

  it("nameless rows drop; the survivors never invent", () => {
    const parsed = parseSplitsOverview({
      ...WIRE,
      releases: [
        { title: "no id — drops" },
        {
          id: "rel-2", title: "Second", artistName: "A", totalIncomeCents: 100,
          collaboratorTotals: [{ role: "artist", totalCents: 1 }],
          entries: [{ note: "no id — drops" }, { id: "e-9", entryDate: "2026-10-01", note: "", amountCents: 100, agreementVersion: 1, shares: [{ sharePct: 50 }] }],
          activeSplits: [],
        },
      ],
    });
    expect(parsed!.releases).toHaveLength(1);
    expect(parsed!.releases[0]!.collaboratorTotals).toEqual([]);
    expect(parsed!.releases[0]!.entries).toHaveLength(1);
    expect(parsed!.releases[0]!.entries[0]!.shares).toEqual([]);
  });
});

describe("publishing registry — the shared contract's wire, tolerated", () => {
  const ITEM = {
    id: "reg-1",
    song_kind: "release",
    song_id: "rel-1",
    song_title: "Midnight Crown",
    is_owner: true,
    state: "awaiting_confirmations",
    has_dispute: false,
    collection_status: "registered",
    collection_notice: "Registered — collection activates when publishing administration is connected.",
    my_share_pct: 60,
    my_writer_status: null,
    writers: [
      { name: "Thy Cheat Code", profile_id: null, user_id: "u-1", is_linked: true, is_me: true, share_pct: 60, confirmation_status: "confirmed", dispute_note: null, confirmed_at: "2026-10-01T00:00:00Z", disputed_at: null },
      { name: "Wave Maker", profile_id: null, user_id: null, is_linked: false, is_me: false, share_pct: 40, confirmation_status: "unlinked", dispute_note: null, confirmed_at: null, disputed_at: null },
    ],
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };

  it("registrations ride in the contract's own shape; the ready flag reads true-only", () => {
    const parsed = parsePublishingMine({ registrations: [ITEM], registry_ready: true });
    expect(parsed).not.toBeNull();
    expect(parsed!.registryReady).toBe(true);
    expect(parsed!.registrations[0]).toMatchObject({ id: "reg-1", song_title: "Midnight Crown", my_share_pct: 60 });
    expect(parsed!.registrations[0]!.writers).toHaveLength(2);
    expect(parsePublishingMine({ registrations: [], registry_ready: false })!.registryReady).toBe(false);
    expect(parsePublishingMine({ registrations: [] })!.registryReady).toBe(false);
  });

  it("no registrations list is a failure; id-less or writer-less rows drop", () => {
    expect(parsePublishingMine({})).toBeNull();
    expect(parsePublishingMine(null)).toBeNull();
    const parsed = parsePublishingMine({
      registrations: [{ song_title: "no id" }, { id: "x", writers: "nope" }, ITEM],
      registry_ready: true,
    });
    expect(parsed!.registrations.map((r) => r.id)).toEqual(["reg-1"]);
  });

  it("form rows read the page's way: blanks drop, profile nulls, shares numeric", () => {
    expect(
      publishingWritersFromRows([
        { name: "  Thy Cheat Code ", profileId: " ", sharePct: "60" },
        { name: "", profileId: "", sharePct: "" },
        { name: "Wave Maker", profileId: " prof-2 ", sharePct: "40" },
        { name: "", profileId: "", sharePct: "0" },
      ]),
    ).toEqual([
      { name: "Thy Cheat Code", profile_id: null, share_pct: 60 },
      { name: "Wave Maker", profile_id: "prof-2", share_pct: 40 },
      { name: "", profile_id: null, share_pct: 0 },
    ]);
  });

  it("register / amend / dispute payloads are the rails' bodies", () => {
    const writers = [{ name: "A", profile_id: null, share_pct: 100 }];
    expect(buildPublishingRegisterPayload({ songKind: "song", songId: "s-1", writers })).toEqual({
      song_kind: "song", song_id: "s-1", writers,
    });
    expect(buildPublishingAmendPayload(writers)).toEqual({ writers });
    expect(buildPublishingDisputePayload("not my share")).toEqual({ note: "not my share" });
  });
});

describe("split sheets — parse, validate, and the cent-exact ledger split", () => {
  it("the PDF finalize quotes the registry's 50", () => {
    expect(SPLIT_SHEET_PDF_COST_VISUAL_BUCS).toBe(50);
  });

  it("sheets parse; a missing list is a failure, an empty list is empty", () => {
    const parsed = parseWave8Sheets({
      sheets: [
        { id: "sh-1", songTitle: "Midnight Crown", collaborators: [{ name: "A", role: "Artist", pct: 60 }, { name: "B", pct: 40 }], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" },
        { songTitle: "no id — drops" },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed![0]!.collaborators).toEqual([
      { name: "A", role: "Artist", pct: 60 },
      { name: "B", role: "", pct: 40 },
    ]);
    expect(parseWave8Sheets({ sheets: [] })).toEqual([]);
    expect(parseWave8Sheets({})).toBeNull();
    expect(parseWave8Sheets(null)).toBeNull();
  });

  it("the finalized payload needs its spine — title, collaborators, code", () => {
    expect(
      parseFinalizedSheet({
        songTitle: "Midnight Crown",
        collaborators: [{ name: "A", role: "Artist", pct: 100 }],
        totalPct: 100,
        finalizedAt: "2026-10-05T00:00:00Z",
        sheetCode: "SS-2026-0001",
        creditsRemaining: 950,
      }),
    ).toMatchObject({ songTitle: "Midnight Crown", sheetCode: "SS-2026-0001", creditsRemaining: 950 });
    expect(parseFinalizedSheet({ songTitle: "X", collaborators: [] })).toBeNull();
    expect(parseFinalizedSheet({})).toBeNull();
  });

  it("largest-remainder: floors first, leftovers to the biggest fractions, total exact", () => {
    expect(splitCentsLargestRemainder(100, [50, 50])).toEqual([50, 50]);
    expect(splitCentsLargestRemainder(101, [50, 50])).toEqual([51, 50]);
    const thirds = splitCentsLargestRemainder(1000, [33.33, 33.33, 33.34]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(thirds).toEqual([333, 333, 334]);
    expect(splitCentsLargestRemainder(0, [100])).toEqual([0]);
  });

  it("the draft refuses in the page's words; a clean draft passes", () => {
    const rows = (over: Partial<Wave8DraftRow>[] = []): Wave8DraftRow[] => [
      { name: "A", role: "Artist", pct: "60", ...(over[0] ?? {}) },
      { name: "B", role: "", pct: "40", ...(over[1] ?? {}) },
    ];
    expect(validateWave8Draft("Midnight Crown", rows())).toBeNull();
    expect(wave8DraftTotalPct(rows())).toBe(100);
    expect(validateWave8Draft("  ", rows())).toContain("song title");
    expect(validateWave8Draft("X", [])).toContain("at least one collaborator");
    expect(validateWave8Draft("X", rows([{ name: " " }]))).toContain("needs a name");
    expect(validateWave8Draft("X", rows([{ pct: "140" }]))).toContain("between 0% and 100%");
    expect(validateWave8Draft("X", rows([{ pct: "30" }]))).toContain("add up to exactly 100%");
  });

  it("payload + ledger-post bodies are the page's shapes, caps included", () => {
    expect(
      buildWave8SheetPayload("  Midnight Crown ", [
        { name: " A ", role: " Artist ", pct: "60" },
        { name: "B", role: "", pct: "40" },
      ]),
    ).toEqual({
      songTitle: "Midnight Crown",
      collaborators: [
        { name: "A", role: "Artist", pct: 60 },
        { name: "B", role: "", pct: 40 },
      ],
    });
    const body = buildSplitLedgerPostBody({
      sheetTitle: "Midnight Crown",
      collaborator: { name: "Wave Maker", role: "Producer", pct: 25 },
      amountCents: 5000,
      date: "2026-10-05",
    });
    expect(body).toEqual({
      type: "income",
      category: "Royalties — Midnight Crown",
      amountCents: 5000,
      note: "Wave Maker 25% split",
      date: "2026-10-05",
    });
    const longBody = buildSplitLedgerPostBody({
      sheetTitle: "T".repeat(100),
      collaborator: { name: "N".repeat(300), role: "", pct: 10 },
      amountCents: 1,
      date: "2026-10-05",
    });
    expect((longBody["category"] as string).length).toBe(60);
    expect((longBody["note"] as string).length).toBe(280);
    expect(splitSheetSlug("Midnight Crown (VIP Mix)")).toBe("midnight-crown-vip-mix");
    expect(splitSheetSlug("!!!")).toBe("split-sheet");
  });
});

describe("royalties — insights + payouts on the page's rails", () => {
  it("insights quote the server's 100", () => {
    expect(ROYALTY_INSIGHTS_COST_VISUAL_BUCS).toBe(100);
  });

  it("insights parse with titles; a missing list is a failure", () => {
    expect(
      parseRoyaltyInsights({ insights: [{ title: "Chase the Crown", detail: "It earns." }, { detail: "no title — drops" }] }),
    ).toEqual([{ title: "Chase the Crown", detail: "It earns." }]);
    expect(parseRoyaltyInsights({ insights: [] })).toEqual([]);
    expect(parseRoyaltyInsights({})).toBeNull();
    expect(parseRoyaltyInsights(null)).toBeNull();
  });

  it("amounts print the page's figures: USD as $, other currencies keep their code", () => {
    expect(royaltyMoneyLabel("1234.5")).toBe("$1,234.50");
    expect(royaltyMoneyLabel("99", "EUR")).toBe("EUR 99.00");
    expect(royaltyMoneyLabel("not-a-number")).toBe("$0.00");
  });

  it("bars clamp to the biggest row; the month bar floors at 8px", () => {
    expect(royaltyBarPct(50, 200)).toBe(25);
    expect(royaltyBarPct(300, 200)).toBe(100);
    expect(royaltyBarPct(10, 0)).toBe(0);
    expect(royaltyMonthlyBarHeight(200, 200)).toBe(120);
    expect(royaltyMonthlyBarHeight(1, 10000)).toBe(8);
    expect(royaltyMonthlyBarHeight(0, 0)).toBe(8);
  });

  it("the payout form owes distributor, dates and an expected amount", () => {
    const draft = (over: Partial<RoyaltyPayoutDraft> = {}): RoyaltyPayoutDraft => ({
      distributor: "DistroKid",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      expected: "125.50",
      received: "",
      status: "expected",
      ...over,
    });
    expect(validateRoyaltyPayoutDraft(draft())).toBeNull();
    expect(validateRoyaltyPayoutDraft(draft({ distributor: " " }))).toContain("are required");
    expect(validateRoyaltyPayoutDraft(draft({ periodEnd: "" }))).toContain("are required");
    expect(validateRoyaltyPayoutDraft(draft({ expected: "" }))).toContain("are required");
    expect(buildRoyaltyPayoutPayload(draft())).toEqual({
      distributor: "DistroKid",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      expected_amount: "125.50",
      received_amount: undefined,
      status: "expected",
    });
    expect(buildRoyaltyPayoutPayload(draft({ received: " 100 " })).received_amount).toBe("100");
  });
});
