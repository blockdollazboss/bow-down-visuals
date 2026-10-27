/**
 * coach-panels.ts — the Coach's two full panels, finished in-world
 * (World parity P3, lane par-coach-depth; the `coach-full-page-depth`
 * entry in BUSINESS_NATIVE_FOLLOW_ONS graduates on this seam).
 *
 * Stack-100 #75 graduated the coach ASK itself (real inputs + the real
 * Money Tracker snapshot driving the plan). What stayed on the bench
 * was the /coach page's sibling tabs as FULL panels:
 *
 *   1. The NICHE ANALYZER — POST /api/analyze-niche (150 Visual Bucs,
 *      the credit registry's own figure) for the deep read: audience
 *      profile, underserved content gaps, monetization paths ranked
 *      by fit, a competition score, 5 starter pillars and a 30-day
 *      roadmap; the inline idea validator (POST /api/validate-idea,
 *      75 Bucs); and the roadmap's save into the Action Tracker
 *      (POST /api/coach/action-items, source "niche").
 *   2. The MONEY + ACTION TRACKERS — the free ledger on /api/money
 *      (GET/POST/DELETE + the release-link PATCH) rendered as the full
 *      month view the page carries (month P&L, category breakdowns,
 *      running totals, the entry form, release linking), and the
 *      Action Tracker on /api/coach/plan-numbers (server sums over
 *      the creator's OWN ledger + platform state), /api/coach/goal
 *      and /api/coach/action-items.
 *
 * This module is the testable half: payload builders that mirror the
 * website panels' bodies in shape, tolerant parsers for every
 * response the panels read, the costs exactly as the registry quotes
 * them (shown BEFORE anything runs — house law). NO number is
 * computed here from anything but the rails' own rows: the ledger
 * math is the Money Tracker panel's own reduce over GET /api/money
 * entries; the plan numbers are the server's DTO, parsed, never
 * re-derived. Empty stays empty — an honest "nothing tracked yet"
 * beats an invented figure, every time.
 *
 * Naming law: no provider names anywhere in copy.
 */
import type { CoachActionItemDto, PlanNumbersDto } from "@/lib/coach-tracker";

/* ─── tiny tolerant readers (the desks' shared habit) ─────────────── */
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** The panels' shared out-of-credits read: the page's rule — a 402 or
 *  the rail's own `out_of_credits` error word. */
export function isOutOfCreditsResponse(status: number, data: unknown): boolean {
  return status === 402 || asRecord(data)["error"] === "out_of_credits";
}

/* ═══ 1. NICHE ANALYZER ═════════════════════════════════════════════ */

/** The credit registry's own figures (lib/credit-costs):
 *  /api/analyze-niche 150, /api/validate-idea 75. Quoted up front. */
export const NICHE_ANALYZER_COST_VISUAL_BUCS = 150;
export const IDEA_VALIDATOR_COST_VISUAL_BUCS = 75;

/** The page's platform options, keys exactly as the rail takes them. */
export const NICHE_PLATFORMS = [
  { key: "all", label: "All platforms" },
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X / Twitter" },
] as const;
export type NichePlatformKey = (typeof NICHE_PLATFORMS)[number]["key"];

/** The validator's platform options — the page never offers "all". */
export const IDEA_PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X / Twitter" },
] as const;
export type IdeaPlatformKey = (typeof IDEA_PLATFORMS)[number]["key"];

/** The page's experience options, keys exactly as the rail takes them. */
export const NICHE_EXPERIENCE_LEVELS = [
  { key: "beginner", label: "Beginner (0–10k)" },
  { key: "intermediate", label: "Intermediate (10k–100k)" },
  { key: "advanced", label: "Advanced (100k+)" },
] as const;
export type NicheExperienceKey = (typeof NICHE_EXPERIENCE_LEVELS)[number]["key"];

export interface NicheInputs {
  niche: string;
  platform: NichePlatformKey;
  experience: NicheExperienceKey;
  /** Ground the read in the creator's own profile + catalog. */
  useMyData: boolean;
}

export function defaultNicheInputs(): NicheInputs {
  return { niche: "", platform: "all", experience: "beginner", useMyData: false };
}

/** The page's refusals, in its words, or null when the ask can run. */
export function validateNicheInputs(inputs: NicheInputs): string | null {
  const finalNiche = inputs.niche.trim().slice(0, 120);
  if (!inputs.useMyData && finalNiche.length < 2) {
    return "Enter a niche first — e.g. fitness, indie music production, skincare.";
  }
  if (inputs.useMyData && finalNiche.length === 1) {
    return "That niche is too short — type at least 2 characters, or clear it and let your catalog speak.";
  }
  return null;
}

/** POST /api/analyze-niche — the page's body: the niche rides only
 *  when it carries at least 2 characters (blank + useMyData lets the
 *  server read the niche from the creator's real work). */
export function buildNicheAnalyzePayload(inputs: NicheInputs): Record<string, unknown> {
  const finalNiche = inputs.niche.trim().slice(0, 120);
  return {
    ...(finalNiche.length >= 2 ? { niche: finalNiche } : {}),
    targetPlatform: inputs.platform,
    experienceLevel: inputs.experience,
    useMyData: inputs.useMyData,
  };
}

export interface NicheAnalysis {
  niche: string;
  summary: string;
  audienceDemographics: string;
  audienceInterests: string[];
  contentGaps: { angle: string; whyUnderserved: string; opportunity: string }[];
  monetizationPaths: { path: string; fitScore: number; why: string; firstStep: string }[];
  competitionScore: number;
  competitionLabel: string;
  contentPillars: { name: string; description: string; exampleIdeas: string[] }[];
  roadmap30Day: { week: number; focus: string; angles: string[] }[];
}

export interface NicheGroundedIn {
  derivedNiche: string | null;
  songs: number;
  releases: number;
  topGenres: string[];
  signals: string[];
}

export interface NicheAnalysisResult {
  analysis: NicheAnalysis;
  groundedIn: NicheGroundedIn | null;
  creditsRemaining: number | null;
}

/** The analyze response, tolerated the way every desk parser is.
 *  The page's acceptance rule stands: no analysis — or an analysis
 *  with no content pillars — is a failure, never a render. */
export function parseNicheAnalysisResponse(data: unknown): NicheAnalysisResult | null {
  const d = asRecord(data);
  const a = asRecord(d["analysis"]);
  if (Object.keys(a).length === 0) return null;
  const pillars = (Array.isArray(a["contentPillars"]) ? (a["contentPillars"] as unknown[]) : [])
    .map(asRecord)
    .filter((p) => str(p["name"]))
    .map((p) => ({
      name: str(p["name"])!,
      description: str(p["description"]) ?? "",
      exampleIdeas: strList(p["exampleIdeas"]),
    }));
  if (pillars.length === 0) return null;
  const audience = asRecord(a["audienceProfile"]);
  const competition = asRecord(a["competitionLevel"]);
  const gaps = (Array.isArray(a["contentGaps"]) ? (a["contentGaps"] as unknown[]) : [])
    .map(asRecord)
    .filter((g) => str(g["angle"]))
    .map((g) => ({
      angle: str(g["angle"])!,
      whyUnderserved: str(g["whyUnderserved"]) ?? "",
      opportunity: str(g["opportunity"]) ?? "",
    }));
  const paths = (Array.isArray(a["monetizationPaths"]) ? (a["monetizationPaths"] as unknown[]) : [])
    .map(asRecord)
    .filter((p) => str(p["path"]))
    .map((p) => ({
      path: str(p["path"])!,
      fitScore: num(p["fitScore"]) ?? 0,
      why: str(p["why"]) ?? "",
      firstStep: str(p["firstStep"]) ?? "",
    }));
  const roadmap = (Array.isArray(a["roadmap30Day"]) ? (a["roadmap30Day"] as unknown[]) : [])
    .map(asRecord)
    .map((w, i) => ({
      week: num(w["week"]) ?? i + 1,
      focus: str(w["focus"]) ?? "",
      angles: strList(w["angles"]),
    }))
    .filter((w) => w.focus.length > 0);
  const g = asRecord(d["groundedIn"]);
  const groundedIn: NicheGroundedIn | null =
    Object.keys(g).length === 0
      ? null
      : {
          derivedNiche: str(g["derivedNiche"]),
          songs: num(g["songs"]) ?? 0,
          releases: num(g["releases"]) ?? 0,
          topGenres: strList(g["topGenres"]),
          signals: strList(g["signals"]),
        };
  return {
    analysis: {
      niche: str(a["niche"]) ?? "",
      summary: str(a["summary"]) ?? "",
      audienceDemographics: str(audience["demographics"]) ?? "",
      audienceInterests: strList(audience["interests"]),
      contentGaps: gaps,
      monetizationPaths: paths,
      competitionScore: num(competition["score"]) ?? 0,
      competitionLabel: str(competition["label"]) ?? "",
      contentPillars: pillars,
      roadmap30Day: roadmap,
    },
    groundedIn,
    creditsRemaining: num(d["creditsRemaining"]),
  };
}

/** The competition scale, the page's bands: ≤25 open water, ≤45 roomy,
 *  ≤70 contested, above that saturated. Lower = more room to win. */
export type NicheScoreBand = "open" | "roomy" | "contested" | "saturated";
export function nicheScoreBand(score: number): NicheScoreBand {
  if (score <= 25) return "open";
  if (score <= 45) return "roomy";
  if (score <= 70) return "contested";
  return "saturated";
}

/** A monetization path's fit reads on the same scale the page colors
 *  it with: the band of (100 − fit), so a 90-fit path bands "open". */
export function nicheFitBand(fitScore: number): NicheScoreBand {
  return nicheScoreBand(100 - fitScore);
}

/** A score as a bar width — clamped to the rail, never past it. */
export function nicheScoreBarWidth(score: number): number {
  return Math.max(0, Math.min(100, score));
}

/** POST /api/coach/action-items for the roadmap save — the page's
 *  body: one item per roadmap week, source "niche". The rail dedupes,
 *  so a re-save answers with only the weeks that were new. */
export function buildRoadmapSavePayload(analysis: NicheAnalysis): Record<string, unknown> {
  return {
    titles: analysis.roadmap30Day.map((w) => `Week ${w.week}: ${w.focus}`),
    source: "niche",
  };
}

/** The idea validator's refusal, in the page's words, or null. */
export function validateIdeaInput(idea: string): string | null {
  if (idea.trim().slice(0, 500).length < 5) return "Describe the idea in at least 5 characters.";
  return null;
}

/** POST /api/validate-idea — the page's body: the idea capped at 500,
 *  the niche locked to the analysis on screen. */
export function buildIdeaValidatePayload(input: {
  idea: string;
  niche: string;
  platform: IdeaPlatformKey;
}): Record<string, unknown> {
  return {
    idea: input.idea.trim().slice(0, 500),
    niche: input.niche,
    platform: input.platform,
    targetAudience: "",
  };
}

export interface IdeaVerdict {
  verdict: "go" | "pivot" | "no-go";
  overallScore: number;
  summary: string;
}

/** The validator's verdict, or null when the rail sent none. */
export function parseIdeaVerdictResponse(data: unknown): IdeaVerdict | null {
  const v = asRecord(asRecord(data)["verdict"]);
  const verdict = str(v["verdict"]);
  if (verdict !== "go" && verdict !== "pivot" && verdict !== "no-go") return null;
  return {
    verdict,
    overallScore: num(v["overallScore"]) ?? 0,
    summary: str(v["summary"]) ?? "",
  };
}

/* ═══ 2a. THE MONEY TRACKER (the ledger) ════════════════════════════ */

export type LedgerEntryType = "income" | "expense";

/** The page's category lists, keys exactly as the rail stores them. */
export const LEDGER_INCOME_CATEGORIES = [
  "sponsor_deals", "merch_sales", "streaming_royalties", "ad_revenue",
  "subscriptions", "affiliate", "invoice_payout", "other_income",
] as const;

export const LEDGER_EXPENSE_CATEGORIES = [
  "equipment", "software", "ads", "travel",
  "contractors", "production", "other_expense",
] as const;

/** A category's display words: the page falls back to the key with
 *  its underscores spaced; the in-world panel carries no second
 *  vocabulary, so the fallback IS the label. */
export function moneyCategoryLabel(category: string): string {
  return category.replace(/_/g, " ");
}

export interface LedgerEntry {
  id: string;
  entry_type: LedgerEntryType;
  category: string;
  amount_cents: number;
  note: string;
  source: string | null;
  entry_date: string; // YYYY-MM-DD
  releaseId: string | null;
}

/** GET /api/money's rows, tolerated: a row rides only with an id, a
 *  real date and a finite amount — malformed rows drop, never invent. */
export function parseLedgerEntries(data: unknown): LedgerEntry[] {
  const rows = asRecord(data)["entries"];
  if (!Array.isArray(rows)) return [];
  const out: LedgerEntry[] = [];
  for (const raw of rows) {
    const e = asRecord(raw);
    const id = str(e["id"]);
    const date = str(e["entry_date"]);
    const cents = num(e["amount_cents"]);
    if (!id || !date || cents === null) continue;
    const type: LedgerEntryType = e["entry_type"] === "expense" ? "expense" : "income";
    out.push({
      id,
      entry_type: type,
      category: str(e["category"]) ?? (type === "expense" ? "other_expense" : "other_income"),
      amount_cents: cents,
      note: str(e["note"]) ?? "",
      source: str(e["source"]),
      entry_date: date,
      releaseId: str(e["releaseId"]),
    });
  }
  return out;
}

/** "2026-10" for a date — the month key every ledger view keys on. */
export function ledgerMonthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A month key walked by whole months (year-safe). */
export function shiftLedgerMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
  const d = new Date(y, (m - 1) + delta, 1);
  return ledgerMonthKeyOf(d);
}

/** "October 2026" for a month key. */
export function ledgerMonthLabel(key: string): string {
  const [y, m] = key.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function ledgerEntriesForMonth(entries: LedgerEntry[], monthKey: string): LedgerEntry[] {
  return entries.filter((e) => e.entry_date.startsWith(monthKey));
}

export interface LedgerStats {
  monthIncomeCents: number;
  monthExpenseCents: number;
  monthNetCents: number;
  allTimeIncomeCents: number;
  allTimeExpenseCents: number;
  allTimeNetCents: number;
  /** This month's categories, biggest first — the breakdown rows. */
  incomeByCategory: [string, number][];
  expenseByCategory: [string, number][];
}

/** The Money Tracker panel's own reduce, keyed to a chosen month:
 *  the month's P&L + category sums and the all-time running totals,
 *  over the rail's rows and nothing else. */
export function ledgerStats(entries: LedgerEntry[], monthKey: string): LedgerStats {
  let mi = 0, me = 0, ai = 0, ae = 0;
  const incByCat = new Map<string, number>();
  const expByCat = new Map<string, number>();
  for (const e of entries) {
    const inMonth = e.entry_date.startsWith(monthKey);
    if (e.entry_type === "income") {
      ai += e.amount_cents;
      if (inMonth) {
        mi += e.amount_cents;
        incByCat.set(e.category, (incByCat.get(e.category) ?? 0) + e.amount_cents);
      }
    } else {
      ae += e.amount_cents;
      if (inMonth) {
        me += e.amount_cents;
        expByCat.set(e.category, (expByCat.get(e.category) ?? 0) + e.amount_cents);
      }
    }
  }
  const sorted = (m: Map<string, number>): [string, number][] =>
    [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    monthIncomeCents: mi,
    monthExpenseCents: me,
    monthNetCents: mi - me,
    allTimeIncomeCents: ai,
    allTimeExpenseCents: ae,
    allTimeNetCents: ai - ae,
    incomeByCategory: sorted(incByCat),
    expenseByCategory: sorted(expByCat),
  };
}

/** A breakdown bar's width against its own column total — the page's
 *  floor of 4% so a real sliver still shows. */
export function ledgerCategoryBarWidth(cents: number, totalCents: number): number {
  if (totalCents <= 0) return 0;
  return Math.max(4, Math.round((cents / totalCents) * 100));
}

/** Today as YYYY-MM-DD (the entry form's opening date). */
export function ledgerTodayYmd(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export interface LedgerEntryDraft {
  type: LedgerEntryType;
  category: string;
  /** The amount as typed, dollars ("1250.50"). */
  amount: string;
  note: string;
  source: string;
  date: string;
  releaseId: string;
}

/** The form's refusals, in words, or null when the entry can save. */
export function validateLedgerEntryDraft(draft: LedgerEntryDraft): string | null {
  const dollars = parseFloat(draft.amount);
  if (!Number.isFinite(dollars) || dollars <= 0) return "Enter an amount above $0.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return "Use a real date (YYYY-MM-DD).";
  return null;
}

/** POST /api/money — the page's body: dollars become cents once,
 *  here; the release link rides income only. */
export function buildLedgerEntryPayload(draft: LedgerEntryDraft): Record<string, unknown> {
  const dollars = parseFloat(draft.amount);
  return {
    type: draft.type,
    category: draft.category,
    amountCents: Math.round(dollars * 100),
    note: draft.note.trim().slice(0, 280),
    source: draft.source.trim().slice(0, 120) || null,
    date: draft.date,
    releaseId: draft.type === "income" && draft.releaseId ? draft.releaseId : null,
  };
}

/** PATCH /api/money/:id — the release link (or its removal). */
export function buildReleaseLinkPayload(releaseId: string | null): Record<string, unknown> {
  return { releaseId };
}

/* ═══ 2b. THE ACTION TRACKER ════════════════════════════════════════ */

/** GET /api/coach/plan-numbers, tolerated into the page's DTO: the
 *  server's sums ride verbatim; a response missing its spine is a
 *  failure (null), never a set of invented zeros. */
export function parsePlanNumbers(data: unknown): PlanNumbersDto | null {
  const d = asRecord(data);
  const currentMonth = asRecord(d["currentMonth"]);
  const trailing = asRecord(d["trailing"]);
  const allTimeLedger = asRecord(d["allTimeLedger"]);
  const platform = asRecord(d["platform"]);
  if (
    Object.keys(currentMonth).length === 0 ||
    Object.keys(trailing).length === 0 ||
    Object.keys(allTimeLedger).length === 0 ||
    Object.keys(platform).length === 0 ||
    typeof d["hasData"] !== "boolean"
  ) {
    return null;
  }
  const g = asRecord(d["goal"]);
  const goal: PlanNumbersDto["goal"] =
    Object.keys(g).length === 0 || num(g["monthlyGoalCents"]) === null
      ? null
      : {
          monthlyGoalCents: num(g["monthlyGoalCents"])!,
          percentOfGoal: num(g["percentOfGoal"]),
          monthlyGapCents: num(g["monthlyGapCents"]),
          met: g["met"] === true,
          monthsOfNetToBankGoalMonth: num(g["monthsOfNetToBankGoalMonth"]),
        };
  return {
    asOf: str(d["asOf"]) ?? "",
    currentMonth: {
      key: str(currentMonth["key"]) ?? "",
      incomeCents: num(currentMonth["incomeCents"]) ?? 0,
      expenseCents: num(currentMonth["expenseCents"]) ?? 0,
      netCents: num(currentMonth["netCents"]) ?? 0,
    },
    trailing: {
      monthsCounted: num(trailing["monthsCounted"]) ?? 0,
      monthKeys: strList(trailing["monthKeys"]),
      avgMonthlyIncomeCents: num(trailing["avgMonthlyIncomeCents"]),
      avgMonthlyNetCents: num(trailing["avgMonthlyNetCents"]),
    },
    allTimeLedger: {
      incomeCents: num(allTimeLedger["incomeCents"]) ?? 0,
      expenseCents: num(allTimeLedger["expenseCents"]) ?? 0,
      netCents: num(allTimeLedger["netCents"]) ?? 0,
      entryCount: num(allTimeLedger["entryCount"]) ?? 0,
    },
    platform: {
      earningsCents: num(platform["earningsCents"]) ?? 0,
      tipsVb: num(platform["tipsVb"]) ?? 0,
      songs: num(platform["songs"]) ?? 0,
      releases: num(platform["releases"]) ?? 0,
      storeProducts: num(platform["storeProducts"]) ?? 0,
      membershipTiers: num(platform["membershipTiers"]) ?? 0,
    },
    goal,
    hasData: d["hasData"] === true,
  };
}

/** GET (and POST) /api/coach/action-items — the { items } envelope,
 *  rows tolerated: an item rides with an id and a title; its source
 *  reads as the page's three words, anything else as the creator's
 *  own addition. */
export function parseActionItems(data: unknown): CoachActionItemDto[] {
  const rows = asRecord(data)["items"];
  if (!Array.isArray(rows)) return [];
  const out: CoachActionItemDto[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    const id = str(r["id"]);
    const title = str(r["title"]);
    if (!id || !title) continue;
    const source = r["source"];
    out.push({
      id,
      title,
      source: source === "plan" || source === "niche" ? source : "custom",
      done: r["done"] === true,
      completedAt: str(r["completedAt"]),
      createdAt: str(r["createdAt"]),
    });
  }
  return out;
}

/** One item out of a PATCH /api/coach/action-items/:id response. */
export function parseActionItem(data: unknown): CoachActionItemDto | null {
  const items = parseActionItems({ items: [asRecord(data)["item"]] });
  return items[0] ?? null;
}

/** PUT /api/coach/goal — the goal in cents, or null to clear it. */
export function buildGoalPayload(monthlyGoalCents: number | null): Record<string, unknown> {
  return { monthlyGoalCents };
}

/** POST /api/coach/action-items — a hand-typed move (title capped at
 *  the rail's 300, the niche save carries its own source). */
export function buildActionItemPayload(
  title: string,
  source: CoachActionItemDto["source"] = "custom",
): Record<string, unknown> {
  return { title: title.trim().slice(0, 300), source };
}

/** PATCH /api/coach/action-items/:id — the check-off flip. */
export function buildActionItemTogglePayload(item: CoachActionItemDto): Record<string, unknown> {
  return { done: !item.done };
}

/** An item's origin, in the page's words. */
export function actionItemSourceLabel(source: CoachActionItemDto["source"]): string {
  if (source === "plan") return "From your money plan";
  if (source === "niche") return "From your niche analysis";
  return "Added by you";
}
