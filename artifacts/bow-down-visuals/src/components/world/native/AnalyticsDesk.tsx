import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage } from "@/lib/api-error";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "./CreateDeskLeaf";
import {
  AI_COACH_FEATURE,
  AI_COACH_PATH,
  AI_COACH_COST_VB,
  ANALYTICS_HUB_STORAGE_KEY,
  ANALYTICS_INSIGHTS_FEATURE,
  ANALYTICS_INSIGHTS_PATH,
  ANALYTICS_INSIGHTS_COST_VB,
  ANALYTICS_OVERVIEW_PATH,
  ANALYTICS_PLATFORM_LABELS,
  ANALYTICS_SUGGESTIONS_FEATURE,
  ANALYTICS_SUGGESTIONS_PATH,
  ANALYTICS_SUGGESTIONS_COST_VB,
  AUDIT_PLATFORMS,
  CHANNEL_AUDIT_COST_VB,
  CHANNEL_AUDIT_FEATURE,
  CHANNEL_AUDIT_PATH,
  COACH_MAX_POSTS,
  COACH_PLATFORMS,
  COMPETITOR_ANALYSIS_PATH,
  COMPETITOR_COST_VB,
  COMPETITOR_FEATURE,
  GROWTH_PLAN_COST_VB,
  GROWTH_PLAN_FAILED_LINE,
  GROWTH_PLAN_FEATURE,
  GROWTH_PLAN_PATH,
  GROWTH_PLATFORMS,
  VIRALITY_CHECK_COST_VB,
  VIRALITY_CHECK_FEATURE,
  VIRALITY_CHECK_PATH,
  VIRALITY_PLATFORMS,
  aiCoachReady,
  analyticsOutOfCredits,
  analyticsTimeAgo,
  blankCoachPost,
  buildAiCoachBody,
  buildAnalyticsAiBody,
  buildChannelAuditBody,
  buildCompetitorBody,
  buildGrowthPlanBody,
  buildViralityBody,
  channelAuditReady,
  competitorReady,
  connectedAnalyticsPlatforms,
  emptyAnalyticsHubState,
  formatAnalyticsCount,
  hubStateHasData,
  normalizeAiCoach,
  normalizeAnalyticsInsights,
  normalizeAnalyticsOverview,
  normalizeAnalyticsSuggestions,
  normalizeChannelAudit,
  normalizeCompetitorAnalysis,
  normalizeGrowthPlan,
  normalizeViralityCheck,
  parseAnalyticsHubState,
  viralityReady,
  withPlatformStats,
} from "@/lib/world/analytics-desk";
import type {
  AiCoachResult,
  AnalyticsHubState,
  AnalyticsInsights,
  AnalyticsOverview,
  AnalyticsPlatformRow,
  AnalyticsSuggestion,
  AuditPlatformKey,
  ChannelAuditForm,
  ChannelAuditResult,
  CoachPlatformKey,
  CoachPost,
  CompetitorForm,
  CompetitorResult,
  GrowthPlatformKey,
  GrowthPlan,
  HubStats,
  ViralityForm,
  ViralityPlatformKey,
  ViralityResult,
} from "@/lib/world/analytics-desk";

/* ─── Analytics depth desk (stack100 wave 4, item 24, desk #98) ──
   The Analytics Hub's depth tools native at the My Studio board,
   one card per tool on its own rail (lib/world/analytics-desk.ts
   carries every contract): the free connected overview, AI
   Insights + What to make next over the connected numbers, the
   Growth Plan over the creator's own hub stats (the SAME
   localStorage store the website page keeps), Channel Audit,
   Virality Pre-Flight, Competitor Tracker and the AI Coach.
   Every paid run rides confirmedFetch with NO price override —
   the confirm prices itself from the registry row, so the popup,
   the button copy and the rail can never disagree. A cancelled
   confirm changes nothing; a 402 speaks the house not-enough-
   Bucs line; a failed run is an error with a retry, never an
   empty result dressed as success. */

function strongCls(isLight: boolean): string {
  return isLight ? "text-[#2a1e07]" : "text-white";
}
function mutedCls(isLight: boolean): string {
  return isLight ? "text-[#6B5B36]" : "text-white/55";
}
function faintCls(isLight: boolean): string {
  return isLight ? "text-[#6B5B36]/80" : "text-white/40";
}

function goldButtonCls(disabled: boolean): string {
  return `rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition bdv-touch-target ${
    disabled ? "cursor-not-allowed opacity-50" : "hover:scale-105"
  }`;
}

function ghostButtonCls(isLight: boolean): string {
  return `rounded-full border px-4 py-1.5 text-xs font-bold transition hover:scale-105 bdv-touch-target ${
    isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-white/15 text-white/80"
  }`;
}

function fieldLabelCls(isLight: boolean): string {
  return `mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${
    isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
  }`;
}

/** One paid tool's run state, the Academy desk's readPaid shape
 *  per section: busy / inline error / the house out-of-credits
 *  line / the parsed result. The gate error is set by the section
 *  itself before run() is ever called — a gate refusal never
 *  reaches the spend confirm. */
function usePaidTool<T>(normalize: (data: unknown) => T | null, failedLine: string) {
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<T | null>(null);

  async function run(path: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res === null) return; /* confirm cancelled — nothing charged, nothing changed */
      const data: unknown = await res.json().catch(() => null);
      if (analyticsOutOfCredits(res.status, data)) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        setError(apiErrorMessage(data, failedLine));
        return;
      }
      const parsed = normalize(data);
      if (parsed === null) {
        setError(failedLine);
        return;
      }
      setResult(parsed);
      refreshProfile();
    } catch {
      setError(failedLine);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, outOfCredits, result, run };
}

/** The status strip under a paid tool's run button: working,
 *  failed (the run button above stays live as the retry), or
 *  out of Bucs — always spoken, never silent. */
function ToolStatus({
  isLight,
  busy,
  busyLabel,
  error,
  outOfCredits,
}: {
  isLight: boolean;
  busy: boolean;
  busyLabel: string;
  error: string | null;
  outOfCredits: boolean;
}) {
  const { t } = useTranslation();
  if (busy) return <NativeLoadingState isLight={isLight} message={busyLabel} />;
  return (
    <>
      {error ? (
        <p role="alert" className={`text-xs font-semibold ${strongCls(isLight)}`}>
          {error}
        </p>
      ) : null}
      {outOfCredits ? (
        <p role="alert" className={`text-xs font-semibold ${strongCls(isLight)}`}>
          {t("worldDeskRemainder.anlOutOfCredits")}
        </p>
      ) : null}
    </>
  );
}

function ScoreBadge({ score, isLight }: { score: number; isLight: boolean }) {
  const tone =
    score >= 75
      ? "text-emerald-500"
      : score >= 50
        ? "text-[#d4af37]"
        : score >= 30
          ? "text-amber-500"
          : "text-rose-500";
  return (
    <span className={`text-2xl font-black ${tone}`}>
      {score}
      <span className={`text-sm font-bold ${faintCls(isLight)}`}>/100</span>
    </span>
  );
}

function readStoredHubState(): AnalyticsHubState {
  try {
    return parseAnalyticsHubState(
      window.localStorage.getItem(ANALYTICS_HUB_STORAGE_KEY),
    );
  } catch {
    return emptyAnalyticsHubState();
  }
}

export function AnalyticsDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [overviewPhase, setOverviewPhase] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [overviewError, setOverviewError] = useState<string>(
    t("worldDeskRemainder.anlOverviewFailed"),
  );
  const [reloadTick, setReloadTick] = useState(0);
  const [hubState, setHubState] = useState<AnalyticsHubState>(readStoredHubState);

  /* The free overview read — auto-loads with the desk, exactly
     the Books desk's mount discipline: a failed read is the
     error state with a retry, never zero stats. */
  useEffect(() => {
    let cancelled = false;
    setOverviewPhase("loading");
    (async () => {
      try {
        const res = await fetch(ANALYTICS_OVERVIEW_PATH, {
          headers: await authHeaders(),
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`overview ${res.status}`);
        const parsed = normalizeAnalyticsOverview(data);
        if (!parsed) throw new Error("overview shape");
        if (!cancelled) {
          setOverview(parsed);
          setOverviewPhase("ready");
        }
      } catch {
        if (!cancelled) {
          setOverviewError(t("worldDeskRemainder.anlOverviewFailed"));
          setOverviewPhase("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  function saveHubPlatform(key: GrowthPlatformKey, raw: Record<keyof HubStats, string>) {
    setHubState((prev) => {
      const next = withPlatformStats(prev, key, raw, Date.now());
      try {
        window.localStorage.setItem(ANALYTICS_HUB_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage full/blocked — the in-desk state still stands */
      }
      return next;
    });
  }

  return (
    <div data-testid="world-analytics-desk" className="flex flex-col gap-3">
      <NativeCard isLight={isLight} title={t("worldDeskRemainder.anlTitle")}>
        <p className={`text-sm ${mutedCls(isLight)}`}>
          {t("worldDeskRemainder.anlIntro")}
        </p>
      </NativeCard>

      <OverviewCard
        isLight={isLight}
        overview={overview}
        phase={overviewPhase}
        error={overviewError}
        onRetry={() => setReloadTick((t) => t + 1)}
      />

      <ConnectedAiCard isLight={isLight} overview={overview} phase={overviewPhase} />

      <GrowthPlanCard isLight={isLight} hubState={hubState} onSave={saveHubPlatform} />

      <ChannelAuditCard isLight={isLight} />

      <ViralityCard isLight={isLight} />

      <CompetitorCard isLight={isLight} />

      <CoachCard isLight={isLight} hubState={hubState} />
    </div>
  );
}

/* ─── Connected overview (free) ────────────────────────────────── */

function OverviewCard({
  isLight,
  overview,
  phase,
  error,
  onRetry,
}: {
  isLight: boolean;
  overview: AnalyticsOverview | null;
  phase: "loading" | "ready" | "failed";
  error: string;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div data-testid="world-analytics-desk-overview">
      <NativeCard isLight={isLight} title={t("worldDeskRemainder.anlOverviewTitle")}>
        {phase === "loading" ? (
          <NativeLoadingState isLight={isLight} message={t("worldDeskRemainder.anlReadingAccounts")} />
        ) : phase === "failed" || !overview ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldDeskRemainder.anlOverviewFailedTitle")}
            message={error}
            onRetry={onRetry}
          />
        ) : overview.platforms.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldDeskRemainder.anlNoData")}
            detail={t("worldDeskRemainder.anlNoDataDetail")}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {overview.partial ? (
              <p className={`text-xs font-semibold ${strongCls(isLight)}`}>
                {t("worldDeskRemainder.anlPartialNote")}
              </p>
            ) : null}
            {overview.platforms.map((row) => (
              <OverviewPlatformRow
                key={row.platform}
                isLight={isLight}
                row={row}
                snapshots={overview.snapshots}
              />
            ))}
            {overview.fetchedAt ? (
              <p className={`text-xs ${faintCls(isLight)}`}>
                {t("worldDeskRemainder.anlReadAgo", { ago: analyticsTimeAgo(overview.fetchedAt, Date.now(), { justNow: t("worldDeskRemainder.anlAgoJustNow"), minutes: t("worldDeskRemainder.anlAgoMinutes"), hours: t("worldDeskRemainder.anlAgoHours"), days: t("worldDeskRemainder.anlAgoDays") }) })}
                <button
                  type="button"
                  onClick={onRetry}
                  className="font-bold text-[#d4af37] underline-offset-2 hover:underline"
                >
                  {t("worldDeskRemainder.anlRefresh")}
                </button>
              </p>
            ) : null}
          </div>
        )}
      </NativeCard>
    </div>
  );
}

function OverviewPlatformRow({
  isLight,
  row,
  snapshots,
}: {
  isLight: boolean;
  row: AnalyticsPlatformRow;
  snapshots: AnalyticsOverview["snapshots"];
}) {
  const { t, i18n } = useTranslation();
  const label = ANALYTICS_PLATFORM_LABELS[row.platform];
  const series = snapshots
    .filter((s) => s.platform === row.platform && s.followers !== null)
    .map((s) => s.followers as number)
    .reverse();
  const statusLine =
    row.status === "ok"
      ? t("worldDeskRemainder.anlStatusConnected")
      : row.status === "expired"
        ? t("worldDeskRemainder.anlStatusExpired")
        : row.status === "error"
          ? t("worldDeskRemainder.anlStatusDidntAnswer")
          : t("worldDeskRemainder.anlStatusNotConnected");
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={`text-sm font-black ${strongCls(isLight)}`}>
          {label}
          {row.username ? (
            <span className={`ml-2 text-xs font-semibold ${mutedCls(isLight)}`}>
              @{row.username}
            </span>
          ) : row.pageName ? (
            <span className={`ml-2 text-xs font-semibold ${mutedCls(isLight)}`}>
              {row.pageName}
            </span>
          ) : null}
        </p>
        <span
          className={`text-[11px] font-bold uppercase tracking-[0.12em] ${
            row.status === "ok" ? "text-emerald-500" : faintCls(isLight)
          }`}
        >
          {statusLine}
        </span>
      </div>
      {row.status === "ok" && row.stats ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                [t("worldDeskRemainder.anlStatFollowers"), row.stats.followers],
                [t("worldDeskRemainder.anlStatFollowing"), row.stats.following],
                [t("worldDeskRemainder.anlStatPosts"), row.stats.mediaCount],
                [t("worldDeskRemainder.anlStatTotalLikes"), row.stats.totalLikes],
              ] as const
            ).map(([name, value]) => (
              <div key={name}>
                <p className={`text-base font-black ${strongCls(isLight)}`}>
                  {formatAnalyticsCount(value, i18n.language)}
                </p>
                <p className={`text-[11px] ${faintCls(isLight)}`}>{name}</p>
              </div>
            ))}
          </div>
          {series.length >= 2 ? (
            <p className={`mt-2 text-xs ${mutedCls(isLight)}`}>
              {t("worldDeskRemainder.anlFollowersAcross", { from: formatAnalyticsCount(series[0], i18n.language), to: formatAnalyticsCount(series[series.length - 1], i18n.language), count: series.length })}
            </p>
          ) : null}
          {row.topContent.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlTopPosts")}</p>
              {row.topContent.slice(0, 3).map((tc, i) => (
                <p key={i} className={`text-xs ${mutedCls(isLight)}`}>
                  <span className={strongCls(isLight)}>
                    {tc.caption.length > 120 ? `${tc.caption.slice(0, 120)}…` : tc.caption}
                  </span>
                  {tc.likes !== null || tc.comments !== null ? (
                    <span className={faintCls(isLight)}>
                      {" "}
                      · {tc.likes !== null ? t("worldDeskRemainder.anlLikesCount", { count: formatAnalyticsCount(tc.likes, i18n.language) }) : ""}
                      {tc.likes !== null && tc.comments !== null ? " · " : ""}
                      {tc.comments !== null
                        ? t("worldDeskRemainder.anlCommentsCount", { count: formatAnalyticsCount(tc.comments, i18n.language) })
                        : ""}
                    </span>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className={`mt-1.5 text-xs ${mutedCls(isLight)}`}>
          {row.status === "not_connected"
            ? t("worldDeskRemainder.anlNotConnectedBody")
            : row.status === "expired"
              ? t("worldDeskRemainder.anlExpiredBody")
              : (row.message ?? t("worldDeskRemainder.anlDidntAnswerBody"))}
        </p>
      )}
    </div>
  );
}

/* ─── AI Insights + What to make next (100 Bucs each) ──────────── */

function ConnectedAiCard({
  isLight,
  overview,
  phase,
}: {
  isLight: boolean;
  overview: AnalyticsOverview | null;
  phase: "loading" | "ready" | "failed";
}) {
  const { t } = useTranslation();
  const [niche, setNiche] = useState("");
  const insights = usePaidTool<AnalyticsInsights>(
    normalizeAnalyticsInsights,
    t("worldDeskRemainder.anlInsightsFailed"),
  );
  const suggestions = usePaidTool<AnalyticsSuggestion[]>(
    normalizeAnalyticsSuggestions,
    t("worldDeskRemainder.anlSuggestionsFailed"),
  );
  const okCount = overview ? connectedAnalyticsPlatforms(overview).length : 0;

  function bodyOrGate(tool: { setError: (e: string | null) => void }) {
    if (!overview) return null;
    const body = buildAnalyticsAiBody(overview, niche);
    if (!body) {
      tool.setError(t("worldDeskRemainder.anlNoConnected"));
      return null;
    }
    return body;
  }

  return (
    <div data-testid="world-analytics-desk-connected-ai">
      <NativeCard isLight={isLight} title={t("worldDeskRemainder.anlConnectedAiTitle")}>
        <p className={`text-sm ${mutedCls(isLight)}`}>
          {t("worldDeskRemainder.anlConnectedAiIntro")}
        </p>
        <label className="mt-3 block">
          <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlNicheLabel")}</span>
          <input
            className={deskInputCls(isLight)}
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder={t("worldDeskRemainder.anlNichePlaceholder")}
            maxLength={80}
          />
        </label>

        {phase !== "ready" ? (
          <p className={`mt-3 text-xs ${mutedCls(isLight)}`}>
            {phase === "loading"
              ? t("worldDeskRemainder.anlPhaseLoading")
              : t("worldDeskRemainder.anlPhaseFailed")}
          </p>
        ) : okCount === 0 ? (
          <p className={`mt-3 text-xs font-semibold ${strongCls(isLight)}`}>
            {t("worldDeskRemainder.anlNoConnected")}
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={insights.busy}
                  className={goldButtonCls(insights.busy)}
                  onClick={() => {
                    const body = bodyOrGate(insights);
                    if (body) void insights.run(ANALYTICS_INSIGHTS_PATH, body);
                  }}
                >
                  {t("worldDeskRemainder.anlFeatureCost", { feature: ANALYTICS_INSIGHTS_FEATURE, cost: ANALYTICS_INSIGHTS_COST_VB })}
                </button>
                <span className={`text-xs ${faintCls(isLight)}`}>
                  {t("worldDeskRemainder.anlInsightsSide")}
                </span>
              </div>
              <ToolStatus
                isLight={isLight}
                busy={insights.busy}
                busyLabel={t("worldDeskRemainder.anlInsightsBusy")}
                error={insights.error}
                outOfCredits={insights.outOfCredits}
              />
              {insights.result ? <InsightsResult isLight={isLight} result={insights.result} /> : null}
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={suggestions.busy}
                  className={goldButtonCls(suggestions.busy)}
                  onClick={() => {
                    const body = bodyOrGate(suggestions);
                    if (body) void suggestions.run(ANALYTICS_SUGGESTIONS_PATH, body);
                  }}
                >
                  {t("worldDeskRemainder.anlFeatureCost", { feature: ANALYTICS_SUGGESTIONS_FEATURE, cost: ANALYTICS_SUGGESTIONS_COST_VB })}
                </button>
                <span className={`text-xs ${faintCls(isLight)}`}>
                  {t("worldDeskRemainder.anlSuggestionsSide")}
                </span>
              </div>
              <ToolStatus
                isLight={isLight}
                busy={suggestions.busy}
                busyLabel={t("worldDeskRemainder.anlSuggestionsBusy")}
                error={suggestions.error}
                outOfCredits={suggestions.outOfCredits}
              />
              {suggestions.result ? (
                <SuggestionsResult isLight={isLight} result={suggestions.result} />
              ) : null}
            </div>
          </>
        )}
      </NativeCard>
    </div>
  );
}

function InsightsResult({
  isLight,
  result,
}: {
  isLight: boolean;
  result: AnalyticsInsights;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {result.headline ? (
        <p className={`text-sm font-black ${strongCls(isLight)}`}>{result.headline}</p>
      ) : null}
      {result.movers.map((m, i) => (
        <p key={i} className={`text-sm ${mutedCls(isLight)}`}>
          {m.platform ? (
            <span className={`font-bold ${strongCls(isLight)}`}>{m.platform}: </span>
          ) : null}
          {m.observation}
          {m.why ? <span className={faintCls(isLight)}> — {m.why}</span> : null}
        </p>
      ))}
      {result.bestWindow ? (
        <p className={`text-sm ${mutedCls(isLight)}`}>
          <span className={`font-bold ${strongCls(isLight)}`}>{t("worldDeskRemainder.anlBestWindowPrefix")}</span>
          {result.bestWindow}
        </p>
      ) : null}
      {result.recommendations.length > 0 ? (
        <div>
          <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlDoThisNext")}</p>
          <ol className={`list-decimal pl-5 text-sm ${mutedCls(isLight)}`}>
            {result.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function SuggestionsResult({
  isLight,
  result,
}: {
  isLight: boolean;
  result: AnalyticsSuggestion[];
}) {
  const { t } = useTranslation();
  if (result.length === 0) {
    return (
      <NativeEmptyState
        isLight={isLight}
        message={t("worldDeskRemainder.anlSuggestionsEmpty")}
        detail={t("worldDeskRemainder.anlSuggestionsEmptyDetail")}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {result.map((s, i) => (
        <div
          key={i}
          className={`rounded-xl border px-3 py-2.5 ${
            isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"
          }`}
        >
          <p className={`text-sm font-black ${strongCls(isLight)}`}>
            {s.title}
            <span
              className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
                isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-white/15 text-[#e8c86a]"
              }`}
            >
              {s.format}
            </span>
          </p>
          {s.why ? <p className={`mt-1 text-xs ${mutedCls(isLight)}`}>{s.why}</p> : null}
          {s.hook ? (
            <p className={`mt-1 text-xs ${mutedCls(isLight)}`}>
              <span className={`font-bold ${strongCls(isLight)}`}>{t("worldDeskRemainder.anlOpeningHookPrefix")}</span>
              {s.hook}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ─── Your numbers + Growth Plan (200 Bucs) ────────────────────── */

type HubInputs = Record<keyof HubStats, string>;

function statsToInputs(stats: HubStats): HubInputs {
  return {
    followers: stats.followers ? String(stats.followers) : "",
    views7d: stats.views7d ? String(stats.views7d) : "",
    views30d: stats.views30d ? String(stats.views30d) : "",
    engagementRate: stats.engagementRate ? String(stats.engagementRate) : "",
    topPostViews: stats.topPostViews ? String(stats.topPostViews) : "",
  };
}

function GrowthPlanCard({
  isLight,
  hubState,
  onSave,
}: {
  isLight: boolean;
  hubState: AnalyticsHubState;
  onSave: (key: GrowthPlatformKey, raw: HubInputs) => void;
}) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<GrowthPlatformKey>("tiktok");
  const [inputs, setInputs] = useState<HubInputs>(() =>
    statsToInputs(hubState.tiktok.stats),
  );
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const plan = usePaidTool<GrowthPlan>(normalizeGrowthPlan, t("worldDeskRemainder.anlGrowthPlanFailed"));
  const selectedMeta = GROWTH_PLATFORMS.find((p) => p.key === selected)!;
  const history = hubState[selected].history;
  const hasData = hubStateHasData(hubState);

  function pickPlatform(key: GrowthPlatformKey) {
    setSelected(key);
    setInputs(statsToInputs(hubState[key].stats));
    setSavedNote(null);
  }

  function save() {
    onSave(selected, inputs);
    setSavedNote(t("worldDeskRemainder.anlNumbersSaved", { platform: selectedMeta.label }));
  }

  return (
    <div data-testid="world-analytics-desk-growth">
      <NativeCard isLight={isLight} title={t("worldDeskRemainder.anlGrowthTitle")}>
        <p className={`text-sm ${mutedCls(isLight)}`}>
          {t("worldDeskRemainder.anlGrowthIntro", { cost: GROWTH_PLAN_COST_VB })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {GROWTH_PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pickPlatform(p.key)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition bdv-touch-target ${
                selected === p.key
                  ? "border-[#d4af37] bg-[#d4af37] text-black"
                  : isLight
                    ? "border-[#C9A84C]/50 text-[#7A5A12]"
                    : "border-white/15 text-white/70"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(
            [
              ["followers", t("worldDeskRemainder.anlStatFollowers")],
              ["views7d", t("worldDeskRemainder.anlFieldViews7d")],
              ["views30d", t("worldDeskRemainder.anlFieldViews30d")],
              ["engagementRate", t("worldDeskRemainder.anlFieldEngagement")],
              ["topPostViews", t("worldDeskRemainder.anlFieldTopPostViews")],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="block">
              <span className={fieldLabelCls(isLight)}>{label}</span>
              <input
                className={deskInputCls(isLight)}
                inputMode="decimal"
                value={inputs[field]}
                onChange={(e) => {
                  setInputs((prev) => ({ ...prev, [field]: e.target.value }));
                  setSavedNote(null);
                }}
                placeholder="0"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={ghostButtonCls(isLight)} onClick={save}>
            {t("worldDeskRemainder.anlSaveNumbers", { platform: selectedMeta.label })}
          </button>
          {history.length > 0 ? (
            <span className={`text-xs ${faintCls(isLight)}`}>
              {t(history.length === 1 ? "worldDeskRemainder.anlSnapshotOne" : "worldDeskRemainder.anlSnapshotMany", { count: history.length })}
              {history.length >= 2
                ? t("worldDeskRemainder.anlViewsTrendSuffix", { from: formatAnalyticsCount(history[0].views30d, i18n.language), to: formatAnalyticsCount(history[history.length - 1].views30d, i18n.language) })
                : ""}
            </span>
          ) : null}
        </div>
        {savedNote ? (
          <p className={`mt-2 text-xs font-semibold ${strongCls(isLight)}`}>{savedNote}</p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 border-t border-dashed border-[#d4af37]/30 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={plan.busy}
              className={goldButtonCls(plan.busy)}
              onClick={() => {
                const body = buildGrowthPlanBody(hubState);
                if (!body) {
                  plan.setError(t("worldDeskRemainder.anlGrowthPlanNoData"));
                  return;
                }
                void plan.run(GROWTH_PLAN_PATH, body);
              }}
            >
              {t("worldDeskRemainder.anlFeatureCost", { feature: GROWTH_PLAN_FEATURE, cost: GROWTH_PLAN_COST_VB })}
            </button>
            <span className={`text-xs ${faintCls(isLight)}`}>
              {hasData
                ? t("worldDeskRemainder.anlGrowthSideHasData")
                : t("worldDeskRemainder.anlGrowthSideNoData")}
            </span>
          </div>
          <ToolStatus
            isLight={isLight}
            busy={plan.busy}
            busyLabel={t("worldDeskRemainder.anlGrowthBusy")}
            error={plan.error}
            outOfCredits={plan.outOfCredits}
          />
          {plan.result ? (
            <div className="flex flex-col gap-2">
              <p className={`text-sm ${mutedCls(isLight)}`}>{plan.result.summary}</p>
              {plan.result.bestPlatform || plan.result.focusArea ? (
                <p className={`text-sm ${mutedCls(isLight)}`}>
                  {plan.result.bestPlatform ? (
                    <>
                      <span className={`font-bold ${strongCls(isLight)}`}>
                        {t("worldDeskRemainder.anlBestPlatformPrefix")}
                      </span>
                      {plan.result.bestPlatform}{" "}
                    </>
                  ) : null}
                  {plan.result.focusArea ? (
                    <>
                      <span className={`font-bold ${strongCls(isLight)}`}>{t("worldDeskRemainder.anlFocusPrefix")}</span>
                      {plan.result.focusArea}
                    </>
                  ) : null}
                </p>
              ) : null}
              <ol className={`list-decimal pl-5 text-sm ${mutedCls(isLight)}`}>
                {plan.result.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </NativeCard>
    </div>
  );
}

/* ─── Channel Audit (300 Bucs) ─────────────────────────────────── */

const GRADE_TONE: Record<string, string> = {
  A: "text-emerald-500",
  B: "text-lime-500",
  C: "text-amber-500",
  D: "text-orange-500",
  F: "text-rose-500",
};

function ChannelAuditCard({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ChannelAuditForm>({
    niche: "",
    handle: "",
    platform: "multi",
    bio: "",
    postsPerWeek: "",
    recentPostsText: "",
  });
  const audit = usePaidTool<ChannelAuditResult>(
    normalizeChannelAudit,
    t("worldDeskRemainder.anlAuditFailed"),
  );

  function set<K extends keyof ChannelAuditForm>(key: K, value: ChannelAuditForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div data-testid="world-analytics-desk-audit">
      <NativeCard isLight={isLight} title={t("worldDeskRemainder.anlFeatureCost", { feature: CHANNEL_AUDIT_FEATURE, cost: CHANNEL_AUDIT_COST_VB })}>
        <p className={`text-sm ${mutedCls(isLight)}`}>
          {t("worldDeskRemainder.anlAuditIntro")}
        </p>
        <div className="mt-3 grid gap-2">
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlAuditNicheLabel")}</span>
            <input
              className={deskInputCls(isLight)}
              value={form.niche}
              onChange={(e) => set("niche", e.target.value)}
              placeholder={t("worldDeskRemainder.anlAuditNichePlaceholder")}
              maxLength={120}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlHandleLabel")}</span>
              <input
                className={deskInputCls(isLight)}
                value={form.handle}
                onChange={(e) => set("handle", e.target.value)}
                placeholder={t("worldDeskRemainder.anlHandlePlaceholder")}
                maxLength={80}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlMainPlatformLabel")}</span>
              <select
                className={deskInputCls(isLight)}
                value={form.platform}
                onChange={(e) => set("platform", e.target.value as AuditPlatformKey)}
              >
                {AUDIT_PLATFORMS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.key === "multi" ? t("worldDeskRemainder.anlAuditPlatformMulti") : p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlBioLabel")}</span>
            <textarea
              className={deskInputCls(isLight)}
              rows={2}
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
              placeholder={t("worldDeskRemainder.anlBioPlaceholder")}
              maxLength={500}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlPostFreqLabel")}</span>
            <input
              className={deskInputCls(isLight)}
              value={form.postsPerWeek}
              onChange={(e) => set("postsPerWeek", e.target.value)}
              placeholder={t("worldDeskRemainder.anlPostFreqPlaceholder")}
              maxLength={40}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>
              {t("worldDeskRemainder.anlRecentPostsLabel")}
            </span>
            <textarea
              className={deskInputCls(isLight)}
              rows={4}
              value={form.recentPostsText}
              onChange={(e) => set("recentPostsText", e.target.value)}
              placeholder={t("worldDeskRemainder.anlRecentPostsPlaceholder")}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <button
              type="button"
              disabled={audit.busy}
              className={goldButtonCls(audit.busy)}
              onClick={() => {
                if (!channelAuditReady(form)) {
                  audit.setError(t("worldDeskRemainder.anlAuditGate"));
                  return;
                }
                void audit.run(CHANNEL_AUDIT_PATH, buildChannelAuditBody(form));
              }}
            >
              {t("worldDeskRemainder.anlAuditButton", { cost: CHANNEL_AUDIT_COST_VB })}
            </button>
          </div>
          <ToolStatus
            isLight={isLight}
            busy={audit.busy}
            busyLabel={t("worldDeskRemainder.anlAuditBusy")}
            error={audit.error}
            outOfCredits={audit.outOfCredits}
          />
          {audit.result ? <AuditResultView isLight={isLight} result={audit.result} /> : null}
        </div>
      </NativeCard>
    </div>
  );
}

function AuditResultView({
  isLight,
  result,
}: {
  isLight: boolean;
  result: ChannelAuditResult;
}) {
  const { t } = useTranslation();
  const DIM_KEY: Record<string, string> = {
    "posting-consistency": "worldDeskRemainder.anlDimPosting",
    "hook-strength": "worldDeskRemainder.anlDimHook",
    branding: "worldDeskRemainder.anlDimBranding",
    "caption-quality": "worldDeskRemainder.anlDimCaption",
    "cta-usage": "worldDeskRemainder.anlDimCta",
    "profile-bio": "worldDeskRemainder.anlDimBio",
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <span className={`text-5xl font-black ${GRADE_TONE[result.overallGrade] ?? ""}`}>
          {result.overallGrade}
        </span>
        <div>
          <p className={`text-sm font-black ${strongCls(isLight)}`}>
            {t("worldDeskRemainder.anlOverallScore", { score: result.overallScore })}
          </p>
          {result.verdict ? (
            <p className={`text-sm ${mutedCls(isLight)}`}>{result.verdict}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {result.dimensions.map((d) => (
          <div
            key={d.key}
            className={`rounded-xl border px-3 py-2.5 ${
              isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <p className={`text-sm font-bold ${strongCls(isLight)}`}>
              <span className={d.gradeColor || GRADE_TONE[d.grade] || ""}>{d.grade}</span>
              {" · "}
              {DIM_KEY[d.key] ? t(DIM_KEY[d.key]) : d.label}
              <span className={`ml-2 text-xs font-semibold ${faintCls(isLight)}`}>
                {d.score}/100
              </span>
            </p>
            {d.finding ? (
              <p className={`mt-1 text-xs ${mutedCls(isLight)}`}>{d.finding}</p>
            ) : null}
            {d.fix ? (
              <p className={`mt-1 text-xs ${mutedCls(isLight)}`}>
                <span className={`font-bold ${strongCls(isLight)}`}>{t("worldDeskRemainder.anlFixPrefix")}</span>
                {d.fix}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {result.topPriorities.length > 0 ? (
        <div>
          <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlTopPriorities")}</p>
          <ol className={`list-decimal pl-5 text-sm ${mutedCls(isLight)}`}>
            {result.topPriorities.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {result.quickActions.length > 0 ? (
        <div>
          <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlQuickWins")}</p>
          <div className="flex flex-col gap-1">
            {result.quickActions.map((a, i) => (
              <p key={i} className={`text-sm ${mutedCls(isLight)}`}>
                <span className={`font-bold ${strongCls(isLight)}`}>{a.label}</span>
                {a.hint ? <span className={faintCls(isLight)}> — {a.hint}</span> : null}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {result.disclaimer ? (
        <p className={`text-xs ${faintCls(isLight)}`}>{result.disclaimer}</p>
      ) : null}
    </div>
  );
}

/* ─── Virality Pre-Flight (200 Bucs) ───────────────────────────── */

function HashtagChip({ tag, isLight }: { tag: string; isLight: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(tag);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — the tag is on screen to copy by hand */
        }
      }}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition hover:scale-105 bdv-touch-target ${
        isLight
          ? "border-[#C9A84C]/50 text-[#7A5A12]"
          : "border-white/15 text-white/80"
      }`}
    >
      #{tag}
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 opacity-60" />
      )}
    </button>
  );
}

function ViralityCard({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ViralityForm>({
    platform: "tiktok",
    caption: "",
    hashtags: "",
    hookLine: "",
  });
  const check = usePaidTool<ViralityResult>(
    normalizeViralityCheck,
    t("worldDeskRemainder.anlViralityFailed"),
  );

  function set<K extends keyof ViralityForm>(key: K, value: ViralityForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div data-testid="world-analytics-desk-virality">
      <NativeCard
        isLight={isLight}
        title={t("worldDeskRemainder.anlFeatureCost", { feature: VIRALITY_CHECK_FEATURE, cost: VIRALITY_CHECK_COST_VB })}
      >
        <p className={`text-sm ${mutedCls(isLight)}`}>
          {t("worldDeskRemainder.anlViralityIntro")}
        </p>
        <div className="mt-3 grid gap-2">
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlPlatformLabel")}</span>
            <select
              className={deskInputCls(isLight)}
              value={form.platform}
              onChange={(e) => set("platform", e.target.value as ViralityPlatformKey)}
            >
              {VIRALITY_PLATFORMS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlCaptionLabel")}</span>
            <textarea
              className={deskInputCls(isLight)}
              rows={3}
              value={form.caption}
              onChange={(e) => set("caption", e.target.value)}
              placeholder={t("worldDeskRemainder.anlCaptionPlaceholder")}
              maxLength={2000}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlHookLineLabel")}</span>
            <input
              className={deskInputCls(isLight)}
              value={form.hookLine}
              onChange={(e) => set("hookLine", e.target.value)}
              placeholder={t("worldDeskRemainder.anlHookLinePlaceholder")}
              maxLength={300}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlHashtagsLabel")}</span>
            <input
              className={deskInputCls(isLight)}
              value={form.hashtags}
              onChange={(e) => set("hashtags", e.target.value)}
              placeholder={t("worldDeskRemainder.anlHashtagsPlaceholder")}
              maxLength={500}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <button
              type="button"
              disabled={check.busy}
              className={goldButtonCls(check.busy)}
              onClick={() => {
                if (!viralityReady(form)) {
                  check.setError(t("worldDeskRemainder.anlViralityGate"));
                  return;
                }
                void check.run(VIRALITY_CHECK_PATH, buildViralityBody(form));
              }}
            >
              {t("worldDeskRemainder.anlViralityButton", { cost: VIRALITY_CHECK_COST_VB })}
            </button>
          </div>
          <ToolStatus
            isLight={isLight}
            busy={check.busy}
            busyLabel={t("worldDeskRemainder.anlViralityBusy")}
            error={check.error}
            outOfCredits={check.outOfCredits}
          />
          {check.result ? <ViralityResultView isLight={isLight} result={check.result} /> : null}
        </div>
      </NativeCard>
    </div>
  );
}

function ViralityResultView({
  isLight,
  result,
}: {
  isLight: boolean;
  result: ViralityResult;
}) {
  const { t } = useTranslation();
  const blocks = [
    { name: t("worldDeskRemainder.anlBlockHook"), block: result.hookStrength },
    { name: t("worldDeskRemainder.anlBlockCaption"), block: result.captionScore },
    { name: t("worldDeskRemainder.anlBlockHashtags"), block: result.hashtagAnalysis },
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <ScoreBadge score={result.overallScore} isLight={isLight} />
        <p className={`text-sm font-bold ${strongCls(isLight)}`}>{t("worldDeskRemainder.anlReadinessScore")}</p>
      </div>
      {blocks.map(({ name, block }) =>
        block ? (
          <div key={name}>
            <p className={`text-sm ${mutedCls(isLight)}`}>
              <span className={`font-bold ${strongCls(isLight)}`}>
                {t("worldDeskRemainder.anlBlockScore", { name, score: block.score })}
              </span>
              {block.feedback ? <> · {block.feedback}</> : null}
            </p>
          </div>
        ) : null,
      )}
      {result.hashtagAnalysis && result.hashtagAnalysis.suggestedHashtags.length > 0 ? (
        <div>
          <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlSuggestedHashtags")}</p>
          <div className="flex flex-wrap gap-1.5">
            {result.hashtagAnalysis.suggestedHashtags.map((tag) => (
              <HashtagChip key={tag} tag={tag} isLight={isLight} />
            ))}
          </div>
        </div>
      ) : null}
      {result.postingTime ? (
        <p className={`text-sm ${mutedCls(isLight)}`}>
          <span className={`font-bold ${strongCls(isLight)}`}>{t("worldDeskRemainder.anlBestTimePrefix")}</span>
          {result.postingTime.bestTime}
          {result.postingTime.reason ? (
            <span className={faintCls(isLight)}> — {result.postingTime.reason}</span>
          ) : null}
        </p>
      ) : null}
      {result.fixes.length > 0 ? (
        <div>
          <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlScoreFixes")}</p>
          <ol className={`list-decimal pl-5 text-sm ${mutedCls(isLight)}`}>
            {result.fixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Competitor Tracker (200 Bucs) ────────────────────────────── */

function CompetitorCard({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CompetitorForm>({
    name: "",
    url: "",
    niche: "",
    notes: "",
  });
  const look = usePaidTool<CompetitorResult>(
    normalizeCompetitorAnalysis,
    t("worldDeskRemainder.anlCompetitorFailed"),
  );

  function set<K extends keyof CompetitorForm>(key: K, value: CompetitorForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div data-testid="world-analytics-desk-competitor">
      <NativeCard isLight={isLight} title={t("worldDeskRemainder.anlFeatureCost", { feature: COMPETITOR_FEATURE, cost: COMPETITOR_COST_VB })}>
        <p className={`text-sm ${mutedCls(isLight)}`}>
          {t("worldDeskRemainder.anlCompetitorIntro")}
        </p>
        <div className="mt-3 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlCompetitorNameLabel")}</span>
              <input
                className={deskInputCls(isLight)}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("worldDeskRemainder.anlCompetitorNamePlaceholder")}
                maxLength={120}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlChannelUrlLabel")}</span>
              <input
                className={deskInputCls(isLight)}
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder={t("worldDeskRemainder.anlChannelUrlPlaceholder")}
                maxLength={2048}
              />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlSharedNicheLabel")}</span>
            <input
              className={deskInputCls(isLight)}
              value={form.niche}
              onChange={(e) => set("niche", e.target.value)}
              placeholder={t("worldDeskRemainder.anlSharedNichePlaceholder")}
              maxLength={120}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>
              {t("worldDeskRemainder.anlCompetitorNotesLabel")}
            </span>
            <textarea
              className={deskInputCls(isLight)}
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              maxLength={2000}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <button
              type="button"
              disabled={look.busy}
              className={goldButtonCls(look.busy)}
              onClick={() => {
                if (!competitorReady(form)) {
                  look.setError(
                    form.niche.trim().length < 2
                      ? t("worldDeskRemainder.anlCompetitorGateNiche")
                      : t("worldDeskRemainder.anlCompetitorGateName"),
                  );
                  return;
                }
                void look.run(COMPETITOR_ANALYSIS_PATH, buildCompetitorBody(form));
              }}
            >
              {t("worldDeskRemainder.anlCompetitorButton", { cost: COMPETITOR_COST_VB })}
            </button>
          </div>
          <ToolStatus
            isLight={isLight}
            busy={look.busy}
            busyLabel={t("worldDeskRemainder.anlCompetitorBusy")}
            error={look.error}
            outOfCredits={look.outOfCredits}
          />
          {look.result ? <CompetitorResultView isLight={isLight} result={look.result} /> : null}
        </div>
      </NativeCard>
    </div>
  );
}

function CompetitorResultView({
  isLight,
  result,
}: {
  isLight: boolean;
  result: CompetitorResult;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className={`text-sm font-black ${strongCls(isLight)}`}>
        {result.competitorName || t("worldDeskRemainder.anlYourCompetitor")}
        {result.niche ? (
          <span className={`ml-2 text-xs font-semibold ${mutedCls(isLight)}`}>
            {result.niche}
          </span>
        ) : null}
      </p>
      {result.contentPillars.length > 0 ? (
        <div>
          <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlWhatTheyPost")}</p>
          <div className="flex flex-col gap-1">
            {result.contentPillars.map((p, i) => (
              <p key={i} className={`text-sm ${mutedCls(isLight)}`}>
                <span className={`font-bold ${strongCls(isLight)}`}>{p.pillar}</span>
                {p.whatTheyPost ? <> — {p.whatTheyPost}</> : null}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {result.postingCadence ? (
        <p className={`text-sm ${mutedCls(isLight)}`}>
          <span className={`font-bold ${strongCls(isLight)}`}>{t("worldDeskRemainder.anlCadencePrefix")}</span>
          {result.postingCadence.assessment}
          {result.postingCadence.estimatedPostsPerWeek !== null
            ? t("worldDeskRemainder.anlCadencePerWeek", { count: result.postingCadence.estimatedPostsPerWeek })
            : ""}
        </p>
      ) : null}
      {result.topFormats.length > 0 ? (
        <div>
          <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlFormatsThatWork")}</p>
          <div className="flex flex-col gap-1">
            {result.topFormats.map((f, i) => (
              <p key={i} className={`text-sm ${mutedCls(isLight)}`}>
                <span className={`font-bold ${strongCls(isLight)}`}>{f.format}</span>
                {f.whyItWorks ? <> — {f.whyItWorks}</> : null}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {result.strengths.length > 0 || result.weaknesses.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {result.strengths.length > 0 ? (
            <div>
              <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlTheirStrengths")}</p>
              <ul className={`list-disc pl-5 text-sm ${mutedCls(isLight)}`}>
                {result.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.weaknesses.length > 0 ? (
            <div>
              <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlDoorOpen")}</p>
              <ul className={`list-disc pl-5 text-sm ${mutedCls(isLight)}`}>
                {result.weaknesses.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlYourOpenings")}</p>
        <div className="flex flex-col gap-1.5">
          {result.opportunities.map((o, i) => (
            <p key={i} className={`text-sm ${mutedCls(isLight)}`}>
              <span className={`font-bold ${strongCls(isLight)}`}>{o.gap}</span>
              {o.howToExploit ? <> — {t("worldDeskRemainder.anlPlaySuffix")}{o.howToExploit}</> : null}
            </p>
          ))}
        </div>
      </div>
      <div>
        <p className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlTakeaways")}</p>
        <ol className={`list-decimal pl-5 text-sm font-semibold ${strongCls(isLight)}`}>
          {result.takeaways.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </div>
      {result.quickActions.length > 0 ? (
        <div className="flex flex-col gap-1">
          {result.quickActions.map((a, i) => (
            <p key={i} className={`text-sm ${mutedCls(isLight)}`}>
              <span className={`font-bold ${strongCls(isLight)}`}>{a.label}</span>
              {a.hint ? <span className={faintCls(isLight)}> — {a.hint}</span> : null}
            </p>
          ))}
        </div>
      ) : null}
      {result.disclaimer ? (
        <p className={`text-xs ${faintCls(isLight)}`}>{result.disclaimer}</p>
      ) : null}
    </div>
  );
}

/* ─── AI Coach (100 Bucs) ──────────────────────────────────────── */

function CoachCard({
  isLight,
  hubState,
}: {
  isLight: boolean;
  hubState: AnalyticsHubState;
}) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<CoachPlatformKey>("tiktok");
  const [niche, setNiche] = useState("");
  const [posts, setPosts] = useState<CoachPost[]>([blankCoachPost()]);
  const coach = usePaidTool<AiCoachResult>(normalizeAiCoach, t("worldDeskRemainder.anlCoachFailed"));
  const platformLabel = COACH_PLATFORMS.find((p) => p.key === platform)!.label;

  function setPost(i: number, patch: Partial<CoachPost>) {
    setPosts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function importFromStats() {
    const stats = hubState[platform].stats;
    setPosts((prev) => {
      if (prev.length >= COACH_MAX_POSTS) return prev;
      const kept = prev.filter((p) => p.title.trim().length > 0);
      return [
        ...kept,
        {
          title: t("worldDeskRemainder.anlImportedPostTitle", { platform: platformLabel }),
          views: stats.topPostViews,
          likes: 0,
          comments: 0,
          shares: 0,
          watchTimeSec: 0,
          postedAt: "",
        },
      ].slice(0, COACH_MAX_POSTS);
    });
  }

  return (
    <div data-testid="world-analytics-desk-coach">
      <NativeCard isLight={isLight} title={t("worldDeskRemainder.anlCoachTitle", { cost: AI_COACH_COST_VB })}>
        <p className={`text-sm ${mutedCls(isLight)}`}>
          {t("worldDeskRemainder.anlCoachIntro")}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlPlatformLabel")}</span>
            <select
              className={deskInputCls(isLight)}
              value={platform}
              onChange={(e) => setPlatform(e.target.value as CoachPlatformKey)}
            >
              {COACH_PLATFORMS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls(isLight)}>{t("worldDeskRemainder.anlNicheLabel")}</span>
            <input
              className={deskInputCls(isLight)}
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              maxLength={80}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {posts.map((p, i) => (
            <div
              key={i}
              className={`rounded-xl border px-3 py-2.5 ${
                isLight
                  ? "border-[#C9A84C]/30 bg-white/40"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  className={deskInputCls(isLight)}
                  value={p.title}
                  onChange={(e) => setPost(i, { title: e.target.value })}
                  placeholder={t("worldDeskRemainder.anlPostTitle", { n: i + 1 })}
                  aria-label={t("worldDeskRemainder.anlPostTitle", { n: i + 1 })}
                  maxLength={200}
                />
                {posts.length > 1 ? (
                  <button
                    type="button"
                    className={ghostButtonCls(isLight)}
                    onClick={() =>
                      setPosts((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    {t("worldDeskRemainder.anlRemove")}
                  </button>
                ) : null}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {(
                  [
                    ["views", t("worldDeskRemainder.anlStatViews")],
                    ["likes", t("worldDeskRemainder.anlStatLikes")],
                    ["comments", t("worldDeskRemainder.anlStatComments")],
                    ["shares", t("worldDeskRemainder.anlStatShares")],
                    ["watchTimeSec", t("worldDeskRemainder.anlStatWatchSec")],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="block">
                    <span className={fieldLabelCls(isLight)}>{label}</span>
                    <input
                      className={deskInputCls(isLight)}
                      inputMode="numeric"
                      value={p[field] === 0 ? "" : String(p[field])}
                      onChange={(e) =>
                        setPost(i, {
                          [field]:
                            field === "watchTimeSec"
                              ? Math.max(0, Number(e.target.value) || 0)
                              : Math.max(
                                  0,
                                  Math.floor(Number(e.target.value) || 0),
                                ),
                        })
                      }
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={ghostButtonCls(isLight)}
            disabled={posts.length >= COACH_MAX_POSTS}
            onClick={() =>
              setPosts((prev) =>
                prev.length >= COACH_MAX_POSTS ? prev : [...prev, blankCoachPost()],
              )
            }
          >
            {t("worldDeskRemainder.anlAddPost")}
          </button>
          <button type="button" className={ghostButtonCls(isLight)} onClick={importFromStats}>
            {t("worldDeskRemainder.anlImportTopPost", { platform: platformLabel })}
          </button>
        </div>
        <p className={`mt-2 text-xs ${faintCls(isLight)}`}>
          {t("worldDeskRemainder.anlCoachMaxNote", { max: COACH_MAX_POSTS })}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <button
              type="button"
              disabled={coach.busy}
              className={goldButtonCls(coach.busy)}
              onClick={() => {
                if (!aiCoachReady(posts)) {
                  coach.setError(t("worldDeskRemainder.anlCoachNeedPost"));
                  return;
                }
                void coach.run(
                  AI_COACH_PATH,
                  buildAiCoachBody({ platform, posts, niche }),
                );
              }}
            >
              {t("worldDeskRemainder.anlFeatureCost", { feature: AI_COACH_FEATURE, cost: AI_COACH_COST_VB })}
            </button>
          </div>
          <ToolStatus
            isLight={isLight}
            busy={coach.busy}
            busyLabel={t("worldDeskRemainder.anlCoachBusy")}
            error={coach.error}
            outOfCredits={coach.outOfCredits}
          />
          {coach.result ? <CoachResultView isLight={isLight} result={coach.result} /> : null}
        </div>
      </NativeCard>
    </div>
  );
}

function CoachResultView({
  isLight,
  result,
}: {
  isLight: boolean;
  result: AiCoachResult;
}) {
  const { t } = useTranslation();
  const lists = [
    { name: t("worldDeskRemainder.anlWhatsWorking"), rows: result.patterns },
    { name: t("worldDeskRemainder.anlWhatsHolding"), rows: result.mistakes },
    { name: t("worldDeskRemainder.anlNextPosts"), rows: result.nextSteps },
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      {result.insights ? (
        <p className={`text-sm ${mutedCls(isLight)}`}>{result.insights}</p>
      ) : null}
      {lists.map(({ name, rows }) =>
        rows.length > 0 ? (
          <div key={name}>
            <p className={fieldLabelCls(isLight)}>{name}</p>
            <ul className={`list-disc pl-5 text-sm ${mutedCls(isLight)}`}>
              {rows.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
