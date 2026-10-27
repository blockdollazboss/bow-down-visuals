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
  shiftLedgerMonthKey,
  validateIdeaInput,
  validateLedgerEntryDraft,
  validateNicheInputs,
  type LedgerEntryDraft,
  type NicheAnalysis,
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
