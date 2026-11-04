import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Flag,
  Lightbulb,
  Link2,
  Link2Off,
  ListChecks,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  InnerBlock,
  SubHead,
  chipBtn,
  goldBtn,
  inputCls,
  smallBtn,
  useCoachAuthHeaders,
} from "./CoachPanelBits";
import {
  CoachRoyaltiesSection,
  CoachSplitSheetsSection,
  CoachSplitsSection,
} from "./CoachMoneySubViews";
import { fmtPlanMoney, fmtPlanMoneyShort, parseGoalCents, trackerProgress } from "@/lib/coach-tracker";
import { fetchReleaseOptions } from "@/components/coach/SplitsOverview";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
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
  type IdeaPlatformKey,
  type IdeaVerdict,
  type LedgerEntry,
  type LedgerEntryDraft,
  type NicheAnalysisResult,
  type NicheScoreBand,
} from "@/lib/world/coach-panels";
import type { CoachActionItemDto, PlanNumbersDto } from "@/lib/coach-tracker";

/* ─── The Coach's full panels, finished in-world (parity P3) ───────
   Stack-100 #75 graduated the coach ASK (real inputs + the Money
   Tracker snapshot) into the Promote Desk. These two sections finish
   the /coach page's remaining tabs as FULL native panels on the
   page's own rails — no numbers invented, every figure from a rail
   or an honest empty state:
     · NicheAnalyzerSection — POST /api/analyze-niche (150 Visual
       Bucs, the registry's figure) + the idea validator
       (POST /api/validate-idea, 75) + the roadmap's save into the
       Action Tracker. Paid calls ride the credit confirmation.
     · MoneyActionTrackerSection — the free ledger on /api/money as
       the full month view (P&L, category breakdowns, entry form,
       release linking) and the Action Tracker on
       /api/coach/plan-numbers + /api/coach/goal +
       /api/coach/action-items.
   The Money Tracker's splits / split-sheets / royalties sub-views
   ride the same card under its view switcher, finished in
   CoachMoneySubViews.tsx (Ring 4 #6) on the page's own rails —
   the last 2D-only pocket of the coach is closed. */

/* Seam label lists read through the catalog by key (the seam's
   own lists keep the wire keys + the English source); a key the
   map doesn't know keeps the seam's label. Platform brand names
   (TikTok / Instagram / YouTube) stay with the seam verbatim. */
const CP_PLATFORM_KEYS: Record<string, string> = {
  all: "worldCoachMoney.cpPlatformAll",
  x: "worldCoachMoney.cpPlatformX",
};
const CP_EXPERIENCE_KEYS: Record<string, string> = {
  beginner: "worldCoachMoney.cpExpBeginner",
  intermediate: "worldCoachMoney.cpExpIntermediate",
  advanced: "worldCoachMoney.cpExpAdvanced",
};
const CP_CATEGORY_KEYS: Record<string, string> = {
  sponsor_deals: "worldCoachMoney.cpCatSponsorDeals",
  merch_sales: "worldCoachMoney.cpCatMerchSales",
  streaming_royalties: "worldCoachMoney.cpCatStreamingRoyalties",
  ad_revenue: "worldCoachMoney.cpCatAdRevenue",
  subscriptions: "worldCoachMoney.cpCatSubscriptions",
  affiliate: "worldCoachMoney.cpCatAffiliate",
  invoice_payout: "worldCoachMoney.cpCatInvoicePayout",
  other_income: "worldCoachMoney.cpCatOtherIncome",
  equipment: "worldCoachMoney.cpCatEquipment",
  software: "worldCoachMoney.cpCatSoftware",
  ads: "worldCoachMoney.cpCatAds",
  travel: "worldCoachMoney.cpCatTravel",
  contractors: "worldCoachMoney.cpCatContractors",
  production: "worldCoachMoney.cpCatProduction",
  other_expense: "worldCoachMoney.cpCatOtherExpense",
};
const CP_SOURCE_KEYS: Record<string, string> = {
  plan: "worldCoachMoney.cpSourcePlan",
  niche: "worldCoachMoney.cpSourceNiche",
  custom: "worldCoachMoney.cpSourceCustom",
};
const CP_VIEW_KEYS: Record<string, string> = {
  ledger: "worldCoachMoney.cpViewLedger",
  splits: "worldCoachMoney.cpViewSplits",
  splitSheets: "worldCoachMoney.cpViewSplitSheets",
  royalties: "worldCoachMoney.cpViewRoyalties",
};

const bandBarCls = (band: NicheScoreBand, isLight: boolean) =>
  band === "open"
    ? isLight ? "bg-emerald-600" : "bg-emerald-400"
    : band === "roomy"
      ? isLight ? "bg-lime-600" : "bg-lime-400"
      : band === "contested"
        ? isLight ? "bg-amber-500" : "bg-amber-400"
        : isLight ? "bg-red-600" : "bg-red-400";

const bandTextCls = (band: NicheScoreBand, isLight: boolean) =>
  band === "open"
    ? isLight ? "text-emerald-700" : "text-emerald-300"
    : band === "roomy"
      ? isLight ? "text-lime-700" : "text-lime-300"
      : band === "contested"
        ? isLight ? "text-amber-700" : "text-amber-300"
        : isLight ? "text-red-700" : "text-red-300";

/* ═══ 1. NICHE ANALYZER ═════════════════════════════════════════════ */

export function NicheAnalyzerSection({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [inputs, setInputs] = useState(defaultNicheInputs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<NicheAnalysisResult | null>(null);

  const [idea, setIdea] = useState("");
  const [ideaPlatform, setIdeaPlatform] = useState<IdeaPlatformKey>("tiktok");
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [ideaOut, setIdeaOut] = useState(false);
  const [verdict, setVerdict] = useState<IdeaVerdict | null>(null);

  const [roadmapBusy, setRoadmapBusy] = useState(false);
  const [roadmapMsg, setRoadmapMsg] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const analyze = async () => {
    if (busy) return;
    const problem = validateNicheInputs(inputs, {
      enterNiche: t("worldCoachMoney.cpNicheEnterFirst"),
      tooShort: t("worldCoachMoney.cpNicheTooShort"),
    });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/analyze-niche", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildNicheAnalyzePayload(inputs)),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (isOutOfCreditsResponse(res.status, data)) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const parsed = parseNicheAnalysisResponse(data);
      if (!res.ok || !parsed) {
        setError(t("worldCoachMoney.cpAnalyzeFailed"));
        return;
      }
      setResult(parsed);
      setVerdict(null);
      setIdeaError(null);
      setIdeaOut(false);
      setRoadmapMsg(null);
      refreshProfile();
    } catch {
      setError(t("worldCoachMoney.cpAnalyzerNoAnswer"));
    } finally {
      setBusy(false);
    }
  };

  const validateIdea = async () => {
    if (ideaBusy || !result) return;
    const problem = validateIdeaInput(idea, t("worldCoachMoney.cpIdeaTooShort"));
    if (problem) {
      setIdeaError(problem);
      return;
    }
    setIdeaBusy(true);
    setIdeaError(null);
    setIdeaOut(false);
    try {
      const res = await confirmedFetch("/api/validate-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildIdeaValidatePayload({ idea, niche: result.analysis.niche, platform: ideaPlatform })),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (isOutOfCreditsResponse(res.status, data)) {
        setIdeaOut(true);
        refreshProfile();
        return;
      }
      const parsed = parseIdeaVerdictResponse(data);
      if (!res.ok || !parsed) {
        setIdeaError(t("worldCoachMoney.cpIdeaFailed"));
        return;
      }
      setVerdict(parsed);
      refreshProfile();
    } catch {
      setIdeaError(t("worldCoachMoney.cpValidatorNoAnswer"));
    } finally {
      setIdeaBusy(false);
    }
  };

  const saveRoadmap = async () => {
    if (roadmapBusy || !result) return;
    setRoadmapBusy(true);
    setRoadmapMsg(null);
    try {
      const res = await confirmedFetch("/api/coach/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRoadmapSavePayload(result.analysis)),
        skipConfirm: true,
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRoadmapMsg(t("worldCoachMoney.cpRoadmapFailed"));
        return;
      }
      const added = parseActionItems(data).length;
      setRoadmapMsg(
        added > 0
          ? t(added === 1 ? "worldCoachMoney.cpRoadmapSavedOne" : "worldCoachMoney.cpRoadmapSavedMany", { count: added })
          : t("worldCoachMoney.cpRoadmapAlready"),
      );
    } catch {
      setRoadmapMsg(t("worldCoachMoney.cpRoadmapFailed"));
    } finally {
      setRoadmapBusy(false);
    }
  };

  const analysis = result?.analysis ?? null;
  const verdictBadge =
    verdict?.verdict === "go"
      ? isLight ? "bg-emerald-600 text-white" : "bg-emerald-500 text-black"
      : verdict?.verdict === "pivot"
        ? isLight ? "bg-amber-500 text-black" : "bg-amber-400 text-black"
        : isLight ? "bg-red-600 text-white" : "bg-red-500 text-white";

  return (
    <NativeCard isLight={isLight} title={t("worldCoachMoney.cpNicheTitle")}>
      <div className="space-y-3" data-testid="world-coach-niche-form">
        <p className={`text-sm ${muted}`}>{t("worldCoachMoney.cpNicheIntro", { cost: NICHE_ANALYZER_COST_VISUAL_BUCS })}</p>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpYourNiche")}</span>
            <input
              data-testid="world-coach-niche-input"
              className={inputCls(isLight)}
              value={inputs.niche}
              maxLength={120}
              onChange={(e) => setInputs({ ...inputs, niche: e.target.value })}
              placeholder={t("worldCoachMoney.cpNichePlaceholder")}
            />
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpPlatform")}</span>
            <select
              data-testid="world-coach-niche-platform"
              className={inputCls(isLight)}
              style={{ colorScheme: isLight ? "light" : "dark" }}
              value={inputs.platform}
              onChange={(e) => setInputs({ ...inputs, platform: e.target.value as typeof inputs.platform })}
            >
              {NICHE_PLATFORMS.map((p) => (
                <option key={p.key} value={p.key}>{CP_PLATFORM_KEYS[p.key] ? t(CP_PLATFORM_KEYS[p.key]!) : p.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpExperience")}</span>
            <select
              data-testid="world-coach-niche-experience"
              className={inputCls(isLight)}
              style={{ colorScheme: isLight ? "light" : "dark" }}
              value={inputs.experience}
              onChange={(e) => setInputs({ ...inputs, experience: e.target.value as typeof inputs.experience })}
            >
              {NICHE_EXPERIENCE_LEVELS.map((lvl) => (
                <option key={lvl.key} value={lvl.key}>{CP_EXPERIENCE_KEYS[lvl.key] ? t(CP_EXPERIENCE_KEYS[lvl.key]!) : lvl.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="world-coach-niche-use-my-data"
            aria-pressed={inputs.useMyData}
            className={chipBtn(isLight, inputs.useMyData)}
            onClick={() => setInputs({ ...inputs, useMyData: !inputs.useMyData })}
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("worldCoachMoney.cpUseMyData")}
          </button>
          <span className={`text-xs ${muted}`}>
            {inputs.useMyData
              ? t("worldCoachMoney.cpUseMyDataOn")
              : t("worldCoachMoney.cpUseMyDataOff")}
          </span>
        </div>

        <div>
          <button
            type="button"
            data-testid="world-coach-niche-analyze"
            className={goldBtn}
            disabled={busy}
            onClick={() => void analyze()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
            {busy ? t("worldCoachMoney.cpAnalyzing") : t("worldCoachMoney.cpAnalyzeButton", { cost: NICHE_ANALYZER_COST_VISUAL_BUCS })}
          </button>
        </div>

        {outOfCredits ? (
          <p data-testid="world-coach-niche-out" className={`text-sm font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
            {t("worldCoachMoney.cpNicheOut")}
          </p>
        ) : null}
        {error ? (
          <p data-testid="world-coach-niche-error" className={`text-sm font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
            {error}
          </p>
        ) : null}

        {analysis ? (
          <div className="space-y-3" data-testid="world-coach-niche-results">
            <div>
              <p className={`text-base font-black ${strong}`}>
                {analysis.niche}
                <span className={`ml-2 align-middle text-xs font-bold ${muted}`}>{t("worldCoachMoney.cpTheRead")}</span>
              </p>
              {analysis.summary ? <p className={`mt-1 text-sm ${muted}`}>{analysis.summary}</p> : null}
              {result?.groundedIn ? (
                <p data-testid="world-coach-niche-grounded" className={`mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"}`}>
                  <Sparkles className="h-3 w-3" />
                  {t("worldCoachMoney.cpGroundedIn", { songs: result.groundedIn.songs, releases: result.groundedIn.releases })}
                  {result.groundedIn.topGenres.length > 0 ? t("worldCoachMoney.cpTopGenres", { genres: result.groundedIn.topGenres.join(", ") }) : ""}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <InnerBlock isLight={isLight}>
                <SubHead isLight={isLight}><Users className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.cpYourAudience")}</SubHead>
                {analysis.audienceDemographics ? (
                  <p className={`mt-1.5 text-sm ${strong}`}>{analysis.audienceDemographics}</p>
                ) : (
                  <p className={`mt-1.5 text-sm ${muted}`}>{t("worldCoachMoney.cpNoAudience")}</p>
                )}
                {analysis.audienceInterests.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {analysis.audienceInterests.map((interest) => (
                      <span key={interest} className={chipBtn(isLight, false)}>{interest}</span>
                    ))}
                  </div>
                ) : null}
              </InnerBlock>

              <InnerBlock isLight={isLight}>
                <SubHead isLight={isLight}><TrendingUp className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.cpCompetition")}</SubHead>
                <p className={`mt-1.5 text-2xl font-black ${bandTextCls(nicheScoreBand(analysis.competitionScore), isLight)}`}>
                  {analysis.competitionScore}
                  <span className={`text-sm font-bold ${muted}`}> / 100</span>
                </p>
                <div className={`mt-1 h-2 overflow-hidden rounded-full ${isLight ? "bg-[#C9A84C]/20" : "bg-white/10"}`}>
                  <div
                    className={`h-full rounded-full ${bandBarCls(nicheScoreBand(analysis.competitionScore), isLight)}`}
                    style={{ width: `${nicheScoreBarWidth(analysis.competitionScore)}%` }}
                  />
                </div>
                <p className={`mt-1.5 text-xs ${muted}`}>
                  {analysis.competitionLabel ? `${analysis.competitionLabel} — ` : ""}{t("worldCoachMoney.cpCompetitionNote")}
                </p>
              </InnerBlock>
            </div>

            {analysis.contentGaps.length > 0 ? (
              <InnerBlock isLight={isLight}>
                <SubHead isLight={isLight}>{t("worldCoachMoney.cpGapsTitle")}</SubHead>
                <div className="mt-2 space-y-2.5">
                  {analysis.contentGaps.map((gap) => (
                    <div key={gap.angle}>
                      <p className={`text-sm font-bold ${strong}`}>{gap.angle}</p>
                      {gap.whyUnderserved ? <p className={`text-xs ${muted}`}>{t("worldCoachMoney.cpWhyOpenLabel")} {gap.whyUnderserved}</p> : null}
                      {gap.opportunity ? <p className={`text-xs ${muted}`}>{t("worldCoachMoney.cpThePlayLabel")} {gap.opportunity}</p> : null}
                    </div>
                  ))}
                </div>
              </InnerBlock>
            ) : null}

            {analysis.monetizationPaths.length > 0 ? (
              <InnerBlock isLight={isLight}>
                <SubHead isLight={isLight}>{t("worldCoachMoney.cpMoneyPathsTitle")}</SubHead>
                <div className="mt-2 space-y-2.5">
                  {analysis.monetizationPaths.map((path) => (
                    <div key={path.path} className="flex items-start gap-3">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${bandTextCls(nicheFitBand(path.fitScore), isLight)} ${isLight ? "bg-black/5" : "bg-white/10"}`}>
                        {t("worldCoachMoney.cpFitLabel", { score: path.fitScore })}
                      </span>
                      <div>
                        <p className={`text-sm font-bold ${strong}`}>{path.path}</p>
                        {path.why ? <p className={`text-xs ${muted}`}>{path.why}</p> : null}
                        {path.firstStep ? <p className={`text-xs ${muted}`}>{t("worldCoachMoney.cpFirstStepLabel")} {path.firstStep}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </InnerBlock>
            ) : null}

            <InnerBlock isLight={isLight}>
              <SubHead isLight={isLight}>{t("worldCoachMoney.cpPillarsTitle")}</SubHead>
              <div className="mt-2 space-y-2.5">
                {analysis.contentPillars.map((pillar) => (
                  <div key={pillar.name}>
                    <p className={`text-sm font-bold ${strong}`}>{pillar.name}</p>
                    {pillar.description ? <p className={`text-xs ${muted}`}>{pillar.description}</p> : null}
                    {pillar.exampleIdeas.length > 0 ? (
                      <ul className={`mt-1 list-inside list-disc text-xs ${muted}`}>
                        {pillar.exampleIdeas.map((ideaText) => (
                          <li key={ideaText}>{ideaText}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </InnerBlock>

            {analysis.roadmap30Day.length > 0 ? (
              <InnerBlock isLight={isLight}>
                <SubHead isLight={isLight}>{t("worldCoachMoney.cpRoadmapTitle")}</SubHead>
                <div className="mt-2 space-y-2.5">
                  {analysis.roadmap30Day.map((week) => (
                    <div key={week.week}>
                      <p className={`text-sm font-bold ${strong}`}>{t("worldCoachMoney.cpWeekPrefix", { week: week.week })} {week.focus}</p>
                      {week.angles.length > 0 ? (
                        <ul className={`mt-1 list-inside list-disc text-xs ${muted}`}>
                          {week.angles.map((angle) => (
                            <li key={angle}>{angle}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    data-testid="world-coach-niche-save-roadmap"
                    className={goldBtn}
                    disabled={roadmapBusy}
                    onClick={() => void saveRoadmap()}
                  >
                    {roadmapBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                    {t("worldCoachMoney.cpSaveRoadmap")}
                  </button>
                  {roadmapMsg ? (
                    <p data-testid="world-coach-niche-roadmap-msg" className={`mt-2 text-xs font-semibold ${muted}`}>{roadmapMsg}</p>
                  ) : null}
                </div>
              </InnerBlock>
            ) : null}

            <InnerBlock isLight={isLight}>
              <SubHead isLight={isLight}><Lightbulb className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.cpIdeaTitle")}</SubHead>
              <p className={`mt-1.5 text-xs ${muted}`}>
                {t("worldCoachMoney.cpIdeaIntro", { niche: analysis.niche, cost: IDEA_VALIDATOR_COST_VISUAL_BUCS })}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px]">
                <input
                  data-testid="world-coach-niche-idea"
                  aria-label={t("worldCoachMoney.cpIdeaAria")}
                  className={inputCls(isLight)}
                  value={idea}
                  maxLength={500}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder={t("worldCoachMoney.cpIdeaPlaceholder")}
                />
                <select
                  data-testid="world-coach-niche-idea-platform"
                  aria-label={t("worldCoachMoney.cpIdeaPlatformAria")}
                  className={inputCls(isLight)}
                  style={{ colorScheme: isLight ? "light" : "dark" }}
                  value={ideaPlatform}
                  onChange={(e) => setIdeaPlatform(e.target.value as IdeaPlatformKey)}
                >
                  {IDEA_PLATFORMS.map((p) => (
                    <option key={p.key} value={p.key}>{CP_PLATFORM_KEYS[p.key] ? t(CP_PLATFORM_KEYS[p.key]!) : p.label}</option>
                  ))}
                </select>
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  data-testid="world-coach-niche-validate"
                  className={goldBtn}
                  disabled={ideaBusy}
                  onClick={() => void validateIdea()}
                >
                  {ideaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                  {ideaBusy ? t("worldCoachMoney.cpScoring") : t("worldCoachMoney.cpValidateButton", { cost: IDEA_VALIDATOR_COST_VISUAL_BUCS })}
                </button>
              </div>
              {ideaOut ? (
                <p className={`mt-2 text-sm font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  {t("worldCoachMoney.cpIdeaOut")}
                </p>
              ) : null}
              {ideaError ? (
                <p className={`mt-2 text-sm font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>{ideaError}</p>
              ) : null}
              {verdict ? (
                <div data-testid="world-coach-niche-verdict" className="mt-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${verdictBadge}`}>
                      {verdict.verdict}
                    </span>
                    <span className={`text-sm font-black ${strong}`}>{verdict.overallScore} / 100</span>
                  </p>
                  {verdict.summary ? <p className={`mt-1.5 text-sm ${muted}`}>{verdict.summary}</p> : null}
                </div>
              ) : null}
            </InnerBlock>

            <p className={`text-[11px] ${muted}`}>{t("worldCoachMoney.cpAiDisclaimer")}</p>
          </div>
        ) : null}
      </div>
    </NativeCard>
  );
}

/* ═══ 2. MONEY + ACTION TRACKERS ════════════════════════════════════ */

function shortDay(ymd: string, lang = "en-US"): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(lang, { month: "short", day: "numeric" });
}

function shortIso(iso: string | null, lang = "en-US"): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(lang, { month: "short", day: "numeric" });
}

/** "October 2026" for a ledger month key, in the walker's
 *  language — the Intl twin of the seam's ledgerMonthLabel. */
function monthLabelFor(monthKey: string, lang: string): string {
  const [y, m] = monthKey.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

type ReleaseOption = Awaited<ReturnType<typeof fetchReleaseOptions>>[number];

type MoneyView = "ledger" | "splits" | "splitSheets" | "royalties";

/** The Money Tracker card's views — the /coach page's own tab words. */
const MONEY_VIEWS: { key: MoneyView; label: string }[] = [
  { key: "ledger", label: "Income & Expenses" },
  { key: "splits", label: "Split Payouts" },
  { key: "splitSheets", label: "Split Agreements" },
  { key: "royalties", label: "Royalties" },
];

export function MoneyActionTrackerSection({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useCoachAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const [moneyView, setMoneyView] = useState<MoneyView>("ledger");

  /* ── the ledger ── */
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [releaseOptions, setReleaseOptions] = useState<ReleaseOption[]>([]);
  const [monthKey, setMonthKey] = useState(() => ledgerMonthKeyOf(new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<LedgerEntryDraft>(() => ({
    type: "income",
    category: "sponsor_deals",
    amount: "",
    note: "",
    source: "",
    date: ledgerTodayYmd(),
    releaseId: "",
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  /* ── the plan numbers + action items ── */
  const [numbers, setNumbers] = useState<PlanNumbersDto | null>(null);
  const [numbersFailed, setNumbersFailed] = useState(false);
  const [items, setItems] = useState<CoachActionItemDto[] | null>(null);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [goalInput, setGoalInput] = useState("");
  const [goalMsg, setGoalMsg] = useState<string | null>(null);
  const [goalBusy, setGoalBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [itemBusyId, setItemBusyId] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/money", { headers: await authHeaders() });
        if (!res.ok) throw new Error("money");
        const parsed = parseLedgerEntries(await res.json().catch(() => ({})));
        if (!cancelled) {
          setEntries(parsed);
          setLoadFailed(false);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const options = await fetchReleaseOptions(confirmedFetch);
      if (!cancelled) setReleaseOptions(options);
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmedFetch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [nRes, iRes] = await Promise.allSettled([
        confirmedFetch("/api/coach/plan-numbers", { skipConfirm: true }),
        confirmedFetch("/api/coach/action-items", { skipConfirm: true }),
      ]);
      if (cancelled) return;
      if (nRes.status === "fulfilled" && nRes.value && nRes.value.ok) {
        const parsed = parsePlanNumbers(await nRes.value.json().catch(() => ({})));
        if (cancelled) return;
        if (parsed) {
          setNumbers(parsed);
          setNumbersFailed(false);
        } else {
          setNumbersFailed(true);
        }
      } else {
        setNumbersFailed(true);
      }
      if (iRes.status === "fulfilled" && iRes.value && iRes.value.ok) {
        const parsedItems = parseActionItems(await iRes.value.json().catch(() => ({})));
        if (cancelled) return;
        setItems(parsedItems);
        setItemsFailed(false);
      } else {
        setItemsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick, confirmedFetch]);

  const stats = entries ? ledgerStats(entries, monthKey) : null;
  const monthEntries = entries ? ledgerEntriesForMonth(entries, monthKey) : [];
  const releaseTitle = (id: string) => releaseOptions.find((r) => r.id === id)?.title ?? t("worldCoachMoney.cpLinkedReleaseFallback");
  const catLabel = (cat: string) => (CP_CATEGORY_KEYS[cat] ? t(CP_CATEGORY_KEYS[cat]!) : moneyCategoryLabel(cat));
  const monthLabel = (key: string) => monthLabelFor(key, i18n.language);

  const setDraftType = (type: LedgerEntryDraft["type"]) =>
    setDraft((d) => ({
      ...d,
      type,
      category: type === "income" ? LEDGER_INCOME_CATEGORIES[0] : LEDGER_EXPENSE_CATEGORIES[0],
    }));

  const saveEntry = async () => {
    if (saving) return;
    const problem = validateLedgerEntryDraft(draft, {
      amount: t("worldCoachMoney.cpLedgerAmountProblem"),
      date: t("worldCoachMoney.cpLedgerDateProblem"),
    });
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await confirmedFetch("/api/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLedgerEntryPayload(draft)),
        skipConfirm: true,
      });
      if (!res) return;
      if (!res.ok) {
        setFormError(t("worldCoachMoney.cpEntrySaveFailed"));
        return;
      }
      setMonthKey(draft.date.slice(0, 7));
      setDraft((d) => ({ ...d, amount: "", note: "", source: "", releaseId: "" }));
      setFormOpen(false);
      setReloadTick((n) => n + 1);
      setTick((n) => n + 1);
    } catch {
      setFormError(t("worldCoachMoney.cpEntrySaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entry: LedgerEntry) => {
    setRowBusyId(entry.id);
    try {
      const res = await confirmedFetch(`/api/money/${entry.id}`, { method: "DELETE", skipConfirm: true });
      if (res && res.ok) {
        setEntries((prev) => (prev ?? []).filter((e) => e.id !== entry.id));
        setConfirmDeleteId(null);
        setTick((t) => t + 1);
      }
    } catch {
      /* the row stays — nothing was removed */
    } finally {
      setRowBusyId(null);
    }
  };

  const linkRelease = async (entry: LedgerEntry, releaseId: string | null) => {
    setRowBusyId(entry.id);
    try {
      const res = await confirmedFetch(`/api/money/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildReleaseLinkPayload(releaseId)),
        skipConfirm: true,
      });
      if (res && res.ok) {
        setEntries((prev) => (prev ?? []).map((e) => (e.id === entry.id ? { ...e, releaseId } : e)));
        setLinkingId(null);
      }
    } catch {
      /* the link stands as it was */
    } finally {
      setRowBusyId(null);
    }
  };

  const saveGoal = async (clear: boolean) => {
    if (goalBusy) return;
    const cents = clear ? null : parseGoalCents(goalInput);
    if (!clear && cents === null) {
      setGoalMsg(t("worldCoachMoney.cpGoalTypeProblem"));
      return;
    }
    setGoalBusy(true);
    setGoalMsg(null);
    try {
      const res = await confirmedFetch("/api/coach/goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGoalPayload(cents)),
        skipConfirm: true,
      });
      if (!res) return;
      if (!res.ok) {
        setGoalMsg(t("worldCoachMoney.cpGoalSaveFailed"));
        return;
      }
      setGoalMsg(clear ? t("worldCoachMoney.cpGoalCleared") : t("worldCoachMoney.cpGoalSet"));
      if (clear) setGoalInput("");
      setTick((n) => n + 1);
    } catch {
      setGoalMsg(t("worldCoachMoney.cpGoalSaveFailed"));
    } finally {
      setGoalBusy(false);
    }
  };

  const toggleItem = async (item: CoachActionItemDto) => {
    setItemBusyId(item.id);
    try {
      const res = await confirmedFetch(`/api/coach/action-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildActionItemTogglePayload(item)),
        skipConfirm: true,
      });
      if (res && res.ok) {
        const updated = parseActionItem(await res.json().catch(() => ({})));
        setItems((prev) =>
          (prev ?? []).map((i) =>
            i.id === item.id
              ? (updated ?? { ...i, done: !i.done, completedAt: !i.done ? new Date().toISOString() : null })
              : i,
          ),
        );
      }
    } catch {
      /* the check stands as it was */
    } finally {
      setItemBusyId(null);
    }
  };

  const addItem = async () => {
    const title = newTitle.trim();
    if (!title || addBusy) return;
    setAddBusy(true);
    try {
      const res = await confirmedFetch("/api/coach/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildActionItemPayload(title)),
        skipConfirm: true,
      });
      if (res && res.ok) {
        const created = parseActionItems(await res.json().catch(() => ({})));
        if (created.length > 0) {
          setItems((prev) => [...(prev ?? []), ...created]);
          setNewTitle("");
        }
      }
    } catch {
      /* the input keeps its words */
    } finally {
      setAddBusy(false);
    }
  };

  const deleteItem = async (item: CoachActionItemDto) => {
    setItemBusyId(item.id);
    try {
      const res = await confirmedFetch(`/api/coach/action-items/${item.id}`, { method: "DELETE", skipConfirm: true });
      if (res && res.ok) {
        setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
        setConfirmDeleteItemId(null);
      }
    } catch {
      /* the item stays on the board */
    } finally {
      setItemBusyId(null);
    }
  };

  const progress = items ? trackerProgress(items) : null;
  const goal = numbers?.goal ?? null;

  return (
    <div className="space-y-3">
      {/* ── The Money Tracker: the full month view ─────────────────── */}
      <NativeCard isLight={isLight} title={t("worldCoachMoney.cpMoneyTitle")}>
        <div className="space-y-3" data-testid="world-coach-money-panel">
          {/* The page's four views, one card (Ring 4 #6): the ledger
              below, and the splits / split-sheets / royalties views
              finished in CoachMoneySubViews on the same rails. */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("worldCoachMoney.cpViewsAria")} data-testid="world-coach-money-views">
            {MONEY_VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={moneyView === v.key}
                data-testid={`world-coach-money-view-${v.key}`}
                className={chipBtn(isLight, moneyView === v.key)}
                onClick={() => setMoneyView(v.key)}
              >
                {CP_VIEW_KEYS[v.key] ? t(CP_VIEW_KEYS[v.key]!) : v.label}
              </button>
            ))}
          </div>

          {moneyView === "ledger" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5" data-testid="world-coach-money-month">
              <button
                type="button"
                aria-label={t("worldCoachMoney.cpPrevMonth")}
                data-testid="world-coach-money-prev"
                className={smallBtn(isLight)}
                onClick={() => setMonthKey((k) => shiftLedgerMonthKey(k, -1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className={`min-w-[8.5rem] text-center text-sm font-black ${strong}`}>{monthLabel(monthKey)}</span>
              <button
                type="button"
                aria-label={t("worldCoachMoney.cpNextMonth")}
                data-testid="world-coach-money-next"
                className={smallBtn(isLight)}
                onClick={() => setMonthKey((k) => shiftLedgerMonthKey(k, 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              data-testid="world-coach-money-add-toggle"
              className={goldBtn}
              onClick={() => setFormOpen((o) => !o)}
              aria-expanded={formOpen}
            >
              {formOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {formOpen ? t("worldCoachMoney.cpClose") : t("worldCoachMoney.cpAddEntry")}
            </button>
          </div>
          ) : null}

          {moneyView !== "ledger" ? null : entries === null && !loadFailed ? (
            <NativeLoadingState isLight={isLight} message={t("worldCoachMoney.cpLedgerLoading")} />
          ) : loadFailed ? (
            <NativeErrorState
              isLight={isLight}
              message={t("worldCoachMoney.cpLedgerError")}
              onRetry={() => {
                setLoadFailed(false);
                setEntries(null);
                setReloadTick((t) => t + 1);
              }}
            />
          ) : stats ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3" data-testid="world-coach-money-stats">
                <InnerBlock isLight={isLight}>
                  <SubHead isLight={isLight}>{t("worldCoachMoney.cpInThisMonth")}</SubHead>
                  <p className={`mt-1 text-xl font-black ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
                    {fmtPlanMoney(stats.monthIncomeCents)}
                  </p>
                </InnerBlock>
                <InnerBlock isLight={isLight}>
                  <SubHead isLight={isLight}>{t("worldCoachMoney.cpOutThisMonth")}</SubHead>
                  <p className={`mt-1 text-xl font-black ${isLight ? "text-red-700" : "text-red-300"}`}>
                    {fmtPlanMoney(stats.monthExpenseCents)}
                  </p>
                </InnerBlock>
                <InnerBlock isLight={isLight}>
                  <SubHead isLight={isLight}>{t("worldCoachMoney.cpNet")}</SubHead>
                  <p className={`mt-1 text-xl font-black ${stats.monthNetCents < 0 ? (isLight ? "text-red-700" : "text-red-300") : strong}`}>
                    {fmtPlanMoney(stats.monthNetCents)}
                  </p>
                </InnerBlock>
              </div>
              <p className={`text-xs ${muted}`} data-testid="world-coach-money-alltime">
                {t("worldCoachMoney.cpAllTime", {
                  income: fmtPlanMoney(stats.allTimeIncomeCents),
                  expense: fmtPlanMoney(stats.allTimeExpenseCents),
                  net: fmtPlanMoney(stats.allTimeNetCents),
                  count: (entries ?? []).length,
                })}
              </p>

              {stats.incomeByCategory.length > 0 || stats.expenseByCategory.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2" data-testid="world-coach-money-breakdown">
                  <InnerBlock isLight={isLight}>
                    <SubHead isLight={isLight}>{t("worldCoachMoney.cpWhereFrom")}</SubHead>
                    <div className="mt-2 space-y-2">
                      {stats.incomeByCategory.map(([cat, cents]) => (
                        <div key={cat}>
                          <p className={`flex items-baseline justify-between text-xs ${muted}`}>
                            <span className="capitalize">{catLabel(cat)}</span>
                            <span className={`font-bold ${strong}`}>{fmtPlanMoney(cents)}</span>
                          </p>
                          <div className={`mt-0.5 h-1.5 overflow-hidden rounded-full ${isLight ? "bg-black/5" : "bg-white/10"}`}>
                            <div className={`h-full rounded-full ${isLight ? "bg-emerald-600" : "bg-emerald-400"}`} style={{ width: `${ledgerCategoryBarWidth(cents, stats.monthIncomeCents)}%` }} />
                          </div>
                        </div>
                      ))}
                      {stats.incomeByCategory.length === 0 ? <p className={`text-xs ${muted}`}>{t("worldCoachMoney.cpNoIncomeMonth")}</p> : null}
                    </div>
                  </InnerBlock>
                  <InnerBlock isLight={isLight}>
                    <SubHead isLight={isLight}>{t("worldCoachMoney.cpWhereWent")}</SubHead>
                    <div className="mt-2 space-y-2">
                      {stats.expenseByCategory.map(([cat, cents]) => (
                        <div key={cat}>
                          <p className={`flex items-baseline justify-between text-xs ${muted}`}>
                            <span className="capitalize">{catLabel(cat)}</span>
                            <span className={`font-bold ${strong}`}>{fmtPlanMoney(cents)}</span>
                          </p>
                          <div className={`mt-0.5 h-1.5 overflow-hidden rounded-full ${isLight ? "bg-black/5" : "bg-white/10"}`}>
                            <div className={`h-full rounded-full ${isLight ? "bg-red-500" : "bg-red-400"}`} style={{ width: `${ledgerCategoryBarWidth(cents, stats.monthExpenseCents)}%` }} />
                          </div>
                        </div>
                      ))}
                      {stats.expenseByCategory.length === 0 ? <p className={`text-xs ${muted}`}>{t("worldCoachMoney.cpNoSpendingMonth")}</p> : null}
                    </div>
                  </InnerBlock>
                </div>
              ) : null}

              {formOpen ? (
                <InnerBlock isLight={isLight}>
                  <div className="space-y-2" data-testid="world-coach-money-form">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" aria-pressed={draft.type === "income"} className={chipBtn(isLight, draft.type === "income")} onClick={() => setDraftType("income")}>
                        <ArrowDownLeft className="h-3.5 w-3.5" /> {t("worldCoachMoney.cpMoneyIn")}
                      </button>
                      <button type="button" aria-pressed={draft.type === "expense"} className={chipBtn(isLight, draft.type === "expense")} onClick={() => setDraftType("expense")}>
                        <ArrowUpRight className="h-3.5 w-3.5" /> {t("worldCoachMoney.cpMoneyOut")}
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpCategory")}</span>
                        <select
                          data-testid="world-coach-money-category"
                          className={inputCls(isLight)}
                          style={{ colorScheme: isLight ? "light" : "dark" }}
                          value={draft.category}
                          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                        >
                          {(draft.type === "income" ? LEDGER_INCOME_CATEGORIES : LEDGER_EXPENSE_CATEGORIES).map((c) => (
                            <option key={c} value={c}>{catLabel(c)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpAmountLabel")}</span>
                        <input
                          data-testid="world-coach-money-amount"
                          className={inputCls(isLight)}
                          inputMode="decimal"
                          value={draft.amount}
                          onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^0-9.]/g, "") })}
                          placeholder="0.00"
                        />
                      </label>
                      <label className="block">
                        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpDate")}</span>
                        <input
                          data-testid="world-coach-money-date"
                          type="date"
                          className={inputCls(isLight)}
                          style={{ colorScheme: isLight ? "light" : "dark" }}
                          value={draft.date}
                          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                        />
                      </label>
                      <label className="block">
                        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpSourceOptional")}</span>
                        <input
                          data-testid="world-coach-money-source"
                          className={inputCls(isLight)}
                          value={draft.source}
                          maxLength={120}
                          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                          placeholder={t("worldCoachMoney.cpSourcePlaceholder")}
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpNoteOptional")}</span>
                        <input
                          data-testid="world-coach-money-note"
                          className={inputCls(isLight)}
                          value={draft.note}
                          maxLength={280}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                          placeholder={t("worldCoachMoney.cpNotePlaceholder")}
                        />
                      </label>
                      {draft.type === "income" && releaseOptions.length > 0 ? (
                        <label className="block sm:col-span-2">
                          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldCoachMoney.cpLinkRelease")}</span>
                          <select
                            data-testid="world-coach-money-release"
                            className={inputCls(isLight)}
                            style={{ colorScheme: isLight ? "light" : "dark" }}
                            value={draft.releaseId}
                            onChange={(e) => setDraft({ ...draft, releaseId: e.target.value })}
                          >
                            <option value="">{t("worldCoachMoney.cpNoReleaseLinked")}</option>
                            {releaseOptions.map((r) => (
                              <option key={r.id} value={r.id}>{r.title}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                    {formError ? (
                      <p className={`text-sm font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>{formError}</p>
                    ) : null}
                    <button type="button" data-testid="world-coach-money-save" className={goldBtn} disabled={saving} onClick={() => void saveEntry()}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                      {saving ? t("worldCoachMoney.cpSaving") : t("worldCoachMoney.cpSaveEntry")}
                    </button>
                  </div>
                </InnerBlock>
              ) : null}

              {monthEntries.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message={t("worldCoachMoney.cpNothingTracked", { month: monthLabel(monthKey) })}
                  detail={
                    (entries ?? []).length === 0
                      ? t("worldCoachMoney.cpEmptyDetailNone")
                      : t("worldCoachMoney.cpEmptyDetailMonths")
                  }
                />
              ) : (
                <div className="space-y-2" data-testid="world-coach-money-entries">
                  {monthEntries.map((entry) => {
                    const isIncome = entry.entry_type === "income";
                    return (
                      <div
                        key={entry.id}
                        data-testid="world-coach-money-entry"
                        className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}
                      >
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isIncome ? (isLight ? "bg-emerald-100 text-emerald-700" : "bg-emerald-500/15 text-emerald-300") : (isLight ? "bg-red-100 text-red-700" : "bg-red-500/15 text-red-300")}`}>
                          {isIncome ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-bold ${strong}`}>{entry.note || catLabel(entry.category)}</p>
                          <p className={`text-xs capitalize ${muted}`}>
                            {catLabel(entry.category)}
                            {entry.source ? ` · ${entry.source}` : ""} · {shortDay(entry.entry_date, i18n.language)}
                          </p>
                          {isIncome ? (
                            <div className="mt-1.5">
                              {entry.releaseId ? (
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${isLight ? "bg-[#C9A84C]/20 text-[#7A5A12]" : "bg-[#d4af37]/15 text-[#e8c86a]"}`}>
                                    <Link2 className="h-3 w-3" /> {releaseTitle(entry.releaseId)}
                                  </span>
                                  <button type="button" data-testid="world-coach-money-unlink" className={smallBtn(isLight)} disabled={rowBusyId === entry.id} onClick={() => void linkRelease(entry, null)}>
                                    <Link2Off className="h-3 w-3" /> {t("worldCoachMoney.cpUnlink")}
                                  </button>
                                </span>
                              ) : linkingId === entry.id ? (
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  <select
                                    data-testid="world-coach-money-link-select"
                                    aria-label={t("worldCoachMoney.cpLinkAria")}
                                    className={`${inputCls(isLight)} w-auto py-1 text-xs`}
                                    style={{ colorScheme: isLight ? "light" : "dark" }}
                                    defaultValue=""
                                    onChange={(e) => {
                                      if (e.target.value) void linkRelease(entry, e.target.value);
                                    }}
                                  >
                                    <option value="" disabled>{t("worldCoachMoney.cpPickRelease")}</option>
                                    {releaseOptions.map((r) => (
                                      <option key={r.id} value={r.id}>{r.title}</option>
                                    ))}
                                  </select>
                                  <button type="button" className={smallBtn(isLight)} onClick={() => setLinkingId(null)}>{t("worldCoachMoney.cpCancel")}</button>
                                </span>
                              ) : releaseOptions.length > 0 ? (
                                <button type="button" data-testid="world-coach-money-link" className={smallBtn(isLight)} onClick={() => setLinkingId(entry.id)}>
                                  <Link2 className="h-3 w-3" /> {t("worldCoachMoney.cpLinkButton")}
                                </button>
                              ) : (
                                <span className={`text-[11px] ${muted}`}>{t("worldCoachMoney.cpNoReleasesToLink")}</span>
                              )}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className={`text-sm font-black ${isIncome ? (isLight ? "text-emerald-700" : "text-emerald-300") : (isLight ? "text-red-700" : "text-red-300")}`}>
                            {isIncome ? "+" : "−"}{fmtPlanMoney(entry.amount_cents)}
                          </span>
                          {confirmDeleteId === entry.id ? (
                            <span className="inline-flex gap-1">
                              <button type="button" data-testid="world-coach-money-delete-confirm" className={smallBtn(isLight)} disabled={rowBusyId === entry.id} onClick={() => void deleteEntry(entry)}>
                                {t("worldCoachMoney.cpConfirmDelete")}
                              </button>
                              <button type="button" className={smallBtn(isLight)} onClick={() => setConfirmDeleteId(null)}>{t("worldCoachMoney.cpKeep")}</button>
                            </span>
                          ) : (
                            <button type="button" data-testid="world-coach-money-delete" className={smallBtn(isLight)} onClick={() => setConfirmDeleteId(entry.id)}>
                              <Trash2 className="h-3 w-3" /> {t("worldCoachMoney.cpDelete")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}

          {moneyView === "splits" ? <CoachSplitsSection isLight={isLight} /> : null}
          {moneyView === "splitSheets" ? (
            <CoachSplitSheetsSection
              isLight={isLight}
              onLedgerPosted={() => {
                setReloadTick((t) => t + 1);
                setTick((t) => t + 1);
              }}
            />
          ) : null}
          {moneyView === "royalties" ? <CoachRoyaltiesSection isLight={isLight} /> : null}
        </div>
      </NativeCard>

      {/* ── The Action Tracker: the plan, checked off ──────────────── */}
      <NativeCard isLight={isLight} title={t("worldCoachMoney.cpTrackerTitle")}>
        <div className="space-y-3" data-testid="world-coach-tracker-panel">
          {numbersFailed ? (
            <NativeErrorState
              isLight={isLight}
              message={t("worldCoachMoney.cpNumbersError")}
              onRetry={() => {
                setNumbersFailed(false);
                setNumbers(null);
                setTick((t) => t + 1);
              }}
            />
          ) : numbers === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldCoachMoney.cpNumbersLoading")} />
          ) : !numbers.hasData ? (
            <InnerBlock isLight={isLight}>
              <p className={`text-sm font-bold ${strong}`}>{t("worldCoachMoney.cpNotEnoughData")}</p>
              <p className={`mt-1 text-sm ${muted}`}>{t("worldCoachMoney.cpNotEnoughDataBody")}</p>
              <p className={`mt-2 text-xs ${muted}`} data-testid="world-coach-tracker-sees">
                {t("worldCoachMoney.cpCoachSees", {
                  songs: numbers.platform.songs,
                  releases: numbers.platform.releases,
                  products: numbers.platform.storeProducts,
                  tiers: numbers.platform.membershipTiers,
                })}
              </p>
            </InnerBlock>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3" data-testid="world-coach-tracker-numbers">
                <InnerBlock isLight={isLight}>
                  <SubHead isLight={isLight}>{t("worldCoachMoney.cpThisMonthTracked")}</SubHead>
                  <p className={`mt-1 text-xl font-black ${strong}`}>{fmtPlanMoney(numbers.currentMonth.incomeCents)}</p>
                  <p className={`text-xs ${muted}`}>
                    {t("worldCoachMoney.cpNetAfter", { net: fmtPlanMoney(numbers.currentMonth.netCents), expense: fmtPlanMoney(numbers.currentMonth.expenseCents) })}
                  </p>
                </InnerBlock>
                <InnerBlock isLight={isLight}>
                  <SubHead isLight={isLight}>{t("worldCoachMoney.cpAverageMonth")}</SubHead>
                  <p className={`mt-1 text-xl font-black ${strong}`}>
                    {numbers.trailing.avgMonthlyIncomeCents !== null ? fmtPlanMoney(numbers.trailing.avgMonthlyIncomeCents) : "—"}
                  </p>
                  <p className={`text-xs ${muted}`}>
                    {numbers.trailing.avgMonthlyIncomeCents === null
                      ? t("worldCoachMoney.cpNoCompleteMonth")
                      : `${t(numbers.trailing.monthsCounted === 1 ? "worldCoachMoney.cpAcrossMonthsOne" : "worldCoachMoney.cpAcrossMonthsMany", { count: numbers.trailing.monthsCounted })}${numbers.trailing.avgMonthlyNetCents !== null ? t("worldCoachMoney.cpNetSuffix", { net: fmtPlanMoney(numbers.trailing.avgMonthlyNetCents) }) : ""}`}
                  </p>
                </InnerBlock>
                <InnerBlock isLight={isLight}>
                  <SubHead isLight={isLight}>{t("worldCoachMoney.cpEarnedOn")}</SubHead>
                  <p className={`mt-1 text-xl font-black ${strong}`}>{fmtPlanMoney(numbers.platform.earningsCents)}</p>
                  <p className={`text-xs ${muted}`}>
                    {numbers.platform.tipsVb > 0
                      ? t("worldCoachMoney.cpPlusTips", { amount: numbers.platform.tipsVb })
                      : t("worldCoachMoney.cpPlatformEarnings")}
                  </p>
                </InnerBlock>
              </div>

              <InnerBlock isLight={isLight}>
                <div data-testid="world-coach-tracker-goal">
                  <SubHead isLight={isLight}><Flag className="mr-1 inline h-3.5 w-3.5" />{t("worldCoachMoney.cpMonthlyGoal")}</SubHead>
                  {goal ? (
                    <>
                      <p className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className={`text-lg font-black ${strong}`}>{fmtPlanMoneyShort(goal.monthlyGoalCents)}{t("worldCoachMoney.cpPerMonth")}</span>
                        {goal.met ? (
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${isLight ? "bg-emerald-600 text-white" : "bg-emerald-500 text-black"}`}>
                            {t("worldCoachMoney.cpGoalMet")}
                          </span>
                        ) : goal.percentOfGoal !== null ? (
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${isLight ? "bg-black/5 text-[#7A5A12]" : "bg-white/10 text-[#e8c86a]"}`}>
                            {t("worldCoachMoney.cpPctOfGoal", { pct: goal.percentOfGoal })}
                          </span>
                        ) : null}
                      </p>
                      <div className={`mt-2 h-2 overflow-hidden rounded-full ${isLight ? "bg-black/5" : "bg-white/10"}`}>
                        <div
                          className="h-full rounded-full bg-[#d4af37]"
                          style={{ width: `${Math.max(0, Math.min(100, goal.percentOfGoal ?? 0))}%` }}
                        />
                      </div>
                      <p className={`mt-1.5 text-xs ${muted}`}>
                        {goal.met
                          ? t("worldCoachMoney.cpGoalMetBody")
                          : goal.monthlyGapCents !== null && goal.monthlyGapCents > 0
                            ? `${t("worldCoachMoney.cpGoalShort", { amount: fmtPlanMoney(goal.monthlyGapCents) })}${goal.monthsOfNetToBankGoalMonth !== null ? t(goal.monthsOfNetToBankGoalMonth === 1 ? "worldCoachMoney.cpGoalShortBankOne" : "worldCoachMoney.cpGoalShortBankMany", { months: goal.monthsOfNetToBankGoalMonth }) : ""}.`
                            : t("worldCoachMoney.cpGoalPacing")}
                      </p>
                    </>
                  ) : (
                    <p className={`mt-1.5 text-sm ${muted}`}>{t("worldCoachMoney.cpNoGoalYet")}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      data-testid="world-coach-tracker-goal-input"
                      aria-label={t("worldCoachMoney.cpGoalAria")}
                      className={`${inputCls(isLight)} w-36`}
                      inputMode="decimal"
                      value={goalInput}
                      onChange={(e) => setGoalInput(e.target.value)}
                      placeholder={t("worldCoachMoney.cpGoalPlaceholder")}
                    />
                    <button type="button" data-testid="world-coach-tracker-goal-save" className={goldBtn} disabled={goalBusy} onClick={() => void saveGoal(false)}>
                      {goalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                      {goal ? t("worldCoachMoney.cpUpdateGoal") : t("worldCoachMoney.cpSetGoal")}
                    </button>
                    {goal ? (
                      <button type="button" data-testid="world-coach-tracker-goal-clear" className={smallBtn(isLight)} disabled={goalBusy} onClick={() => void saveGoal(true)}>
                        {t("worldCoachMoney.cpClear")}
                      </button>
                    ) : null}
                  </div>
                  {goalMsg ? <p className={`mt-2 text-xs font-semibold ${muted}`}>{goalMsg}</p> : null}
                </div>
              </InnerBlock>
            </>
          )}

          {/* the moves themselves — their own load, their own truth */}
          {itemsFailed ? (
            <NativeErrorState
              isLight={isLight}
              message={t("worldCoachMoney.cpItemsError")}
              onRetry={() => {
                setItemsFailed(false);
                setItems(null);
                setTick((t) => t + 1);
              }}
            />
          ) : items === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldCoachMoney.cpItemsLoading")} />
          ) : (
            <div data-testid="world-coach-tracker-items">
              {progress && progress.total > 0 ? (
                <div className="mb-2">
                  <p className={`text-xs font-bold ${muted}`}>
                    {t("worldCoachMoney.cpProgressLine", { done: progress.done, total: progress.total, pct: progress.pct })}
                  </p>
                  <div className={`mt-1 h-2 overflow-hidden rounded-full ${isLight ? "bg-black/5" : "bg-white/10"}`}>
                    <div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${progress.pct}%` }} />
                  </div>
                </div>
              ) : null}
              {items.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message={t("worldCoachMoney.cpNoMoves")}
                  detail={t("worldCoachMoney.cpNoMovesDetail")}
                />
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      data-testid="world-coach-tracker-item"
                      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}
                    >
                      <button
                        type="button"
                        aria-pressed={item.done}
                        aria-label={item.done ? t("worldCoachMoney.cpMarkNotDone") : t("worldCoachMoney.cpMarkDone")}
                        data-testid="world-coach-tracker-toggle"
                        disabled={itemBusyId === item.id}
                        onClick={() => void toggleItem(item)}
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition bdv-touch-box ${
                          item.done
                            ? "border-[#d4af37] bg-[#d4af37] text-black"
                            : isLight
                              ? "border-[#7A5A12]/40 text-transparent hover:text-[#7A5A12]"
                              : "border-white/25 text-transparent hover:text-white"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-bold ${item.done ? `${muted} line-through` : strong}`}>{item.title}</p>
                        <p className={`text-xs ${muted}`}>
                          {CP_SOURCE_KEYS[item.source] ? t(CP_SOURCE_KEYS[item.source]!) : actionItemSourceLabel(item.source)}
                          {item.done && item.completedAt ? t("worldCoachMoney.cpDoneSuffix", { date: shortIso(item.completedAt, i18n.language) }) : ""}
                        </p>
                      </div>
                      {confirmDeleteItemId === item.id ? (
                        <span className="inline-flex shrink-0 gap-1">
                          <button type="button" data-testid="world-coach-tracker-delete-confirm" className={smallBtn(isLight)} disabled={itemBusyId === item.id} onClick={() => void deleteItem(item)}>
                            {t("worldCoachMoney.cpConfirmDelete")}
                          </button>
                          <button type="button" className={smallBtn(isLight)} onClick={() => setConfirmDeleteItemId(null)}>{t("worldCoachMoney.cpKeep")}</button>
                        </span>
                      ) : (
                        <button type="button" data-testid="world-coach-tracker-delete" className={smallBtn(isLight)} onClick={() => setConfirmDeleteItemId(item.id)}>
                          <Trash2 className="h-3 w-3" /> {t("worldCoachMoney.cpDelete")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  data-testid="world-coach-tracker-add-input"
                  aria-label={t("worldCoachMoney.cpAddMoveAria")}
                  className={`${inputCls(isLight)} min-w-0 flex-1`}
                  value={newTitle}
                  maxLength={300}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addItem();
                  }}
                  placeholder={t("worldCoachMoney.cpAddMovePlaceholder")}
                />
                <button type="button" data-testid="world-coach-tracker-add" className={goldBtn} disabled={addBusy || newTitle.trim().length === 0} onClick={() => void addItem()}>
                  {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {t("worldCoachMoney.cpAdd")}
                </button>
              </div>
            </div>
          )}
        </div>
      </NativeCard>
    </div>
  );
}
