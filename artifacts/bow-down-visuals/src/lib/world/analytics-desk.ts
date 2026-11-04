import { getCreditCost } from "../credit-costs";

/* ─── Analytics Hub depth desk seam (stack100 wave 4, item 24,
   desk #98) ──────────────────────────────────────────────────────
   The Analytics Hub's DEPTH tools native at the My Studio board —
   the website's /analytics-hub page (pages/analytics-hub.tsx and
   its two tab panels) carries them today; the World had none of
   the seven rails (the census greps for every endpoint over World
   paths came back zero). The desk rides the page's own rails end
   to end, one tool per section:

   - Connected overview: GET /api/analytics/overview — FREE (the
     rail never charges; there is deliberately no registry row).
     Live Instagram / TikTok / Facebook figures + top content.
   - AI Insights: POST /api/analytics/insights — 100 Bucs
     (registry "Analytics Insights"; rail ANALYTICS_INSIGHTS_
     CREDITS in routes/analytics.ts). Plain-English momentum read
     over the CONNECTED accounts' numbers.
   - What to make next: POST /api/analytics/suggestions — 100
     Bucs (registry "Analytics Content Suggestions"; rail
     ANALYTICS_SUGGESTIONS_CREDITS). Five grounded content ideas
     from the same connected numbers.
   - Growth Plan: POST /api/analytics-hub/insights — 200 Bucs
     (registry "Growth Plan"; rail ANALYTICS_HUB_CREDITS in
     routes/generate/analytics-hub.ts). Reads the creator's OWN
     hub stats — the manual per-platform numbers the page keeps
     in localStorage "analytics-hub-v1". The desk reads and writes
     THE SAME store with the page's own load/save discipline, so
     numbers typed on the website are here, and numbers typed
     here are on the website. Same store, same shape.
   - Channel Audit: POST /api/channel-audit — 300 Bucs (registry
     "Channel Audit"; rail CHANNEL_AUDIT_CREDITS). Six graded
     dimensions with fixes, an overall grade, top-3 priorities.
   - Virality Pre-Flight: POST /api/virality-check — 200 Bucs
     (registry "Virality Pre-Flight Check"; rail VIRALITY_CHECK_
     CREDITS). A readiness scorecard for one post — never a
     virality guarantee, exactly as the panel frames it.
   - Competitor Tracker: POST /api/competitor-analysis — 200
     Bucs (registry "Competitor Tracker"; rail COMPETITOR_
     CREDITS). Pillars, cadence, gaps, exactly 3 takeaways.
   - AI Coach: POST /api/ai-coach — 100 Bucs (registry "AI
     Performance Coach"; rail AI_COACH_CREDITS). WHY posts won
     or lost, from per-post numbers the creator fills in.

   PRICES ARE THE REGISTRY'S: every cost below is read out of
   lib/credit-costs.ts at module load via registryCost(), which
   THROWS if a row ever goes missing — a desk can never silently
   show (or charge against) an invented price. The component
   passes NO overrideCost / overrideFeature: confirmedFetch
   prices every confirm from the registry row itself, so the
   popup, the desk copy and the rail can never disagree.

   CHARGE SEMANTICS ARE THE RAILS' OWN: every paid rail charges
   before the model call and refunds on failure server-side; a
   402 / out_of_credits answer is spoken as the house not-enough-
   Bucs state, and a failed generation reads as a failure with a
   retry — never dressed as an empty result, never as zero stats.

   QUICK ACTIONS LOSE THEIR HREFS HERE: the audit and competitor
   rails return quickActions with website hrefs. The World never
   navigates on a payload's say-so and never pulls a page up —
   the normalizers keep label + hint and DROP the href; the desk
   names the surface in words instead.

   Parsers are strict the house way: a broken or incomplete rail
   answer normalizes to null and reads as a failed read, never
   painted-over content. List rows inside an otherwise sound
   answer are dropped row-by-row, never zero-filled.
   ─────────────────────────────────────────────────────────────── */

/** Registry cost for an endpoint; throws if unregistered so a desk
 *  can never silently show (or charge against) an invented price. */
function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

/** Registry feature name for an endpoint; throws on the same terms. */
function registryFeature(endpoint: string): string {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.feature;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A rail string list: only real, non-empty strings survive. */
function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
}

/** A nullable count from a rail: a finite number floors to a
 *  non-negative integer; anything else is honestly unknown (null),
 *  never zero-filled. */
function nullableCount(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.floor(v));
}

/** A bounded score: finite numbers clamp to 0..100 and round;
 *  anything else is null (the block is absent, not zero). */
function scoreOf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** The house not-enough-Bucs line (the Books desk's words): a 402
 *  means the rail refused BEFORE charging — nothing was taken. */
export const ANALYTICS_OUT_OF_CREDITS_LINE =
  "Not enough Visual Bucs for that — nothing was charged. Top up at the Treasury and try again.";

/** True when a paid rail refused for balance: HTTP 402 or the
 *  rails' shared out_of_credits error body. */
export function analyticsOutOfCredits(status: number, data: unknown): boolean {
  return status === 402 || (isRecord(data) && data.error === "out_of_credits");
}

/** Compact figure formatting, the connected tab's own (connFmt):
 *  null reads "—" (unknown), never 0. */
export function formatAnalyticsCount(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

/** "just now / Nm ago / Nh ago / Nd ago" for the overview's
 *  fetchedAt stamp — the page's connTimeAgo, in desk English. */
export function analyticsTimeAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ─── Connected overview (FREE) ────────────────────────────────── */

export const ANALYTICS_OVERVIEW_PATH = "/api/analytics/overview";

/** The overview is free: the rail never charges and the registry
 *  deliberately carries no row for the path. Recorded as a
 *  constant so the desk's copy and its tests pin the same fact. */
export const ANALYTICS_OVERVIEW_COST_VB = 0;

export const ANALYTICS_OVERVIEW_FAILED_LINE =
  "Couldn't load your analytics overview — try again.";

export type AnalyticsPlatformKey = "instagram" | "tiktok" | "facebook";

export const ANALYTICS_PLATFORM_LABELS: Record<AnalyticsPlatformKey, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

export type AnalyticsPlatformStatus = "ok" | "not_connected" | "expired" | "error";

const ANALYTICS_PLATFORM_KEYS: readonly string[] = ["instagram", "tiktok", "facebook"];
const ANALYTICS_PLATFORM_STATUSES: readonly string[] = [
  "ok",
  "not_connected",
  "expired",
  "error",
];

export interface AnalyticsTopContent {
  caption: string;
  likes: number | null;
  comments: number | null;
}

export interface AnalyticsPlatformStats {
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  totalLikes: number | null;
}

export interface AnalyticsPlatformRow {
  platform: AnalyticsPlatformKey;
  status: AnalyticsPlatformStatus;
  username: string | null;
  pageName: string | null;
  /** The rail's own words for a non-ok row (why it isn't reporting). */
  message: string | null;
  stats: AnalyticsPlatformStats | null;
  topContent: AnalyticsTopContent[];
}

export interface AnalyticsOverview {
  platforms: AnalyticsPlatformRow[];
  snapshots: { platform: string; followers: number | null }[];
  fetchedAt: string;
  /** The rail degraded: some sources failed; what shows is real
   *  but partial — the desk says so rather than hiding it. */
  partial: boolean;
}

function normalizePlatformStats(v: unknown): AnalyticsPlatformStats | null {
  if (!isRecord(v)) return null;
  return {
    followers: nullableCount(v.followers),
    following: nullableCount(v.following),
    mediaCount: nullableCount(v.mediaCount),
    totalLikes: nullableCount(v.totalLikes),
  };
}

function normalizeTopContent(v: unknown): AnalyticsTopContent[] {
  if (!Array.isArray(v)) return [];
  const rows: AnalyticsTopContent[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item.caption !== "string") continue;
    rows.push({
      caption: item.caption,
      likes: nullableCount(item.likes),
      comments: nullableCount(item.comments),
    });
  }
  return rows;
}

/** One overview answer, normalized. A non-object answer or a
 *  missing platforms list is unusable (null → the failed state);
 *  individual broken rows drop out, never zero-fill. */
export function normalizeAnalyticsOverview(data: unknown): AnalyticsOverview | null {
  if (!isRecord(data) || !Array.isArray(data.platforms)) return null;
  const platforms: AnalyticsPlatformRow[] = [];
  for (const raw of data.platforms) {
    if (!isRecord(raw)) continue;
    if (
      typeof raw.platform !== "string" ||
      !ANALYTICS_PLATFORM_KEYS.includes(raw.platform) ||
      typeof raw.status !== "string" ||
      !ANALYTICS_PLATFORM_STATUSES.includes(raw.status)
    ) {
      continue;
    }
    platforms.push({
      platform: raw.platform as AnalyticsPlatformKey,
      status: raw.status as AnalyticsPlatformStatus,
      username: typeof raw.username === "string" ? raw.username : null,
      pageName: typeof raw.pageName === "string" ? raw.pageName : null,
      message: typeof raw.message === "string" ? raw.message : null,
      stats: normalizePlatformStats(raw.stats),
      topContent: normalizeTopContent(raw.topContent),
    });
  }
  const snapshots: AnalyticsOverview["snapshots"] = [];
  if (Array.isArray(data.snapshots)) {
    for (const raw of data.snapshots) {
      if (!isRecord(raw) || typeof raw.platform !== "string") continue;
      snapshots.push({ platform: raw.platform, followers: nullableCount(raw.followers) });
    }
  }
  return {
    platforms,
    snapshots,
    fetchedAt: str(data.fetchedAt),
    partial: data.partial === true,
  };
}

/** The platforms actually reporting — the AI layer's only inputs,
 *  exactly the page's filter. */
export function connectedAnalyticsPlatforms(
  overview: AnalyticsOverview,
): AnalyticsPlatformRow[] {
  return overview.platforms.filter((p) => p.status === "ok");
}

export const ANALYTICS_NO_CONNECTED_LINE =
  "Connect an account first — AI Insights and What to make next read your connected accounts, and none is reporting yet.";

/** The AI layer's request body, built the page's exact way
 *  (aiPayload in the connected tab): ok platforms only, top
 *  content trimmed to 5 posts with captions capped at the rail
 *  schema's 200, niche trimmed to its 80. Null when nothing is
 *  connected — the desk refuses BEFORE any spend confirm, the
 *  page's own gate. */
export function buildAnalyticsAiBody(
  overview: AnalyticsOverview,
  niche: string,
): { platforms: unknown[]; niche: string } | null {
  const ok = connectedAnalyticsPlatforms(overview);
  if (ok.length === 0) return null;
  return {
    platforms: ok.map((p) => ({
      platform: p.platform,
      username: p.username,
      pageName: p.pageName,
      stats: p.stats,
      topContent: p.topContent.slice(0, 5).map((tc) => ({
        caption: tc.caption.slice(0, 200),
        likes: tc.likes,
        comments: tc.comments,
      })),
    })),
    niche: niche.trim().slice(0, 80),
  };
}

/* ─── AI Insights (100 Bucs) ───────────────────────────────────── */

export const ANALYTICS_INSIGHTS_PATH = "/api/analytics/insights";
export const ANALYTICS_INSIGHTS_COST_VB = registryCost(ANALYTICS_INSIGHTS_PATH);
export const ANALYTICS_INSIGHTS_FEATURE = registryFeature(ANALYTICS_INSIGHTS_PATH);
export const ANALYTICS_INSIGHTS_FAILED_LINE =
  "The AI couldn't analyze your stats right now — try again in a bit.";

export interface AnalyticsInsightMover {
  platform: string;
  observation: string;
  why: string;
}

export interface AnalyticsInsights {
  headline: string;
  movers: AnalyticsInsightMover[];
  bestWindow: string;
  recommendations: string[];
}

/** The insights answer. The rail always answers with an insights
 *  object on success; anything else — or an object with nothing
 *  in it — is unusable (null → failed state). */
export function normalizeAnalyticsInsights(data: unknown): AnalyticsInsights | null {
  if (!isRecord(data) || !isRecord(data.insights)) return null;
  const raw = data.insights;
  const movers: AnalyticsInsightMover[] = [];
  if (Array.isArray(raw.movers)) {
    for (const m of raw.movers) {
      if (!isRecord(m)) continue;
      const observation = str(m.observation);
      const why = str(m.why);
      if (!observation && !why) continue;
      movers.push({ platform: str(m.platform), observation, why });
    }
  }
  const insights: AnalyticsInsights = {
    headline: str(raw.headline),
    movers,
    bestWindow: str(raw.bestWindow),
    recommendations: stringList(raw.recommendations),
  };
  if (
    !insights.headline &&
    insights.movers.length === 0 &&
    !insights.bestWindow &&
    insights.recommendations.length === 0
  ) {
    return null;
  }
  return insights;
}

/* ─── What to make next (100 Bucs) ─────────────────────────────── */

export const ANALYTICS_SUGGESTIONS_PATH = "/api/analytics/suggestions";
export const ANALYTICS_SUGGESTIONS_COST_VB = registryCost(ANALYTICS_SUGGESTIONS_PATH);
export const ANALYTICS_SUGGESTIONS_FEATURE = registryFeature(ANALYTICS_SUGGESTIONS_PATH);
export const ANALYTICS_SUGGESTIONS_FAILED_LINE =
  "The AI couldn't cook up ideas right now — try again in a bit.";

export interface AnalyticsSuggestion {
  title: string;
  format: string;
  why: string;
  hook: string;
}

/** The suggestions answer: the rail's array, rows without a title
 *  dropped. A non-array answer is unusable (null); an empty array
 *  is a real, empty answer and passes through as one. */
export function normalizeAnalyticsSuggestions(data: unknown): AnalyticsSuggestion[] | null {
  if (!isRecord(data) || !Array.isArray(data.suggestions)) return null;
  const rows: AnalyticsSuggestion[] = [];
  for (const s of data.suggestions) {
    if (!isRecord(s)) continue;
    const title = str(s.title);
    if (!title) continue;
    rows.push({
      title,
      format: str(s.format) || "video",
      why: str(s.why),
      hook: str(s.hook),
    });
  }
  return rows;
}

/* ─── The hub stats store (shared with the page) ───────────────── */

export type GrowthPlatformKey = "tiktok" | "instagram" | "youtube" | "x";

export const GROWTH_PLATFORMS: readonly { key: GrowthPlatformKey; label: string }[] = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X" },
] as const;

export interface HubStats {
  followers: number;
  views7d: number;
  views30d: number;
  engagementRate: number;
  topPostViews: number;
}

export interface HubSnapshot {
  t: number;
  views30d: number;
}

export interface HubPlatformData {
  stats: HubStats;
  history: HubSnapshot[];
}

export type AnalyticsHubState = Record<GrowthPlatformKey, HubPlatformData>;

/** The page's own store key — the desk and the website keep ONE
 *  set of hub numbers between them. */
export const ANALYTICS_HUB_STORAGE_KEY = "analytics-hub-v1";
export const ANALYTICS_HUB_MAX_HISTORY = 24;

const EMPTY_HUB_STATS: HubStats = {
  followers: 0,
  views7d: 0,
  views30d: 0,
  engagementRate: 0,
  topPostViews: 0,
};

export function emptyAnalyticsHubState(): AnalyticsHubState {
  return {
    tiktok: { stats: { ...EMPTY_HUB_STATS }, history: [] },
    instagram: { stats: { ...EMPTY_HUB_STATS }, history: [] },
    youtube: { stats: { ...EMPTY_HUB_STATS }, history: [] },
    x: { stats: { ...EMPTY_HUB_STATS }, history: [] },
  };
}

function hubStatNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** The page's loadState discipline, verbatim in effect: stored
 *  stats merge over the empty defaults, history keeps only rows
 *  with real numbers and caps at the newest 24, and ANY parse
 *  failure reads as the honest empty state — never a throw. */
export function parseAnalyticsHubState(raw: string | null): AnalyticsHubState {
  const base = emptyAnalyticsHubState();
  if (!raw) return base;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return base;
    for (const { key } of GROWTH_PLATFORMS) {
      const p = parsed[key];
      if (!isRecord(p)) continue;
      if (isRecord(p.stats)) {
        base[key].stats = {
          followers: hubStatNumber(p.stats.followers),
          views7d: hubStatNumber(p.stats.views7d),
          views30d: hubStatNumber(p.stats.views30d),
          engagementRate: Math.min(100, Math.max(0, hubStatNumber(p.stats.engagementRate))),
          topPostViews: hubStatNumber(p.stats.topPostViews),
        };
      }
      if (Array.isArray(p.history)) {
        base[key].history = p.history
          .filter(
            (s): s is HubSnapshot =>
              isRecord(s) && typeof s.t === "number" && typeof s.views30d === "number",
          )
          .slice(-ANALYTICS_HUB_MAX_HISTORY);
      }
    }
    return base;
  } catch {
    return base;
  }
}

/** The page's hasData: any platform carrying a real audience or
 *  view figure. The Growth Plan refuses before this is true. */
export function hubStateHasData(state: AnalyticsHubState): boolean {
  return GROWTH_PLATFORMS.some(({ key }) => {
    const s = state[key].stats;
    return s.followers > 0 || s.views30d > 0 || s.views7d > 0;
  });
}

/** The page's parseNumber: digits (and one dot) only, floored,
 *  never negative, garbage reads 0. */
export function parseHubStatNumber(value: string): number {
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** The page's savePlatform, as a pure step: parse the editor's
 *  strings into stats (engagement clamps to 0..100 instead of
 *  flooring), append the views30d snapshot, cap history at 24. */
export function withPlatformStats(
  state: AnalyticsHubState,
  key: GrowthPlatformKey,
  raw: Record<keyof HubStats, string>,
  now: number,
): AnalyticsHubState {
  const stats: HubStats = {
    followers: parseHubStatNumber(raw.followers),
    views7d: parseHubStatNumber(raw.views7d),
    views30d: parseHubStatNumber(raw.views30d),
    engagementRate: Math.min(100, Math.max(0, Number(raw.engagementRate) || 0)),
    topPostViews: parseHubStatNumber(raw.topPostViews),
  };
  return {
    ...state,
    [key]: {
      stats,
      history: [...state[key].history, { t: now, views30d: stats.views30d }].slice(
        -ANALYTICS_HUB_MAX_HISTORY,
      ),
    },
  };
}

/* ─── Growth Plan (200 Bucs) ───────────────────────────────────── */

export const GROWTH_PLAN_PATH = "/api/analytics-hub/insights";
export const GROWTH_PLAN_COST_VB = registryCost(GROWTH_PLAN_PATH);
export const GROWTH_PLAN_FEATURE = registryFeature(GROWTH_PLAN_PATH);
export const GROWTH_PLAN_NO_DATA_LINE =
  "Add your numbers for at least one platform first — the Growth Plan reads the stats you keep here.";
export const GROWTH_PLAN_FAILED_LINE =
  "The Growth Plan couldn't be written — if the rail took your Bucs they come back on failure. Try again.";

export interface GrowthPlan {
  summary: string;
  recommendations: string[];
  bestPlatform: string;
  focusArea: string;
}

/** The Growth Plan body, the page's exact payload: every platform
 *  with data, in the page's platform order, stats verbatim. The
 *  rail wants 1..4 unique platforms — the store's four keys are
 *  unique by construction. Null when nothing is filled in. */
export function buildGrowthPlanBody(
  state: AnalyticsHubState,
): { platforms: ({ platform: GrowthPlatformKey } & HubStats)[] } | null {
  const platforms = GROWTH_PLATFORMS.filter(({ key }) => {
    const s = state[key].stats;
    return s.followers > 0 || s.views30d > 0 || s.views7d > 0;
  }).map(({ key }) => ({ platform: key, ...state[key].stats }));
  if (platforms.length === 0) return null;
  return { platforms };
}

/** The Growth Plan answer — the page's own usability gate: a
 *  summary and at least one recommendation, or it didn't happen. */
export function normalizeGrowthPlan(data: unknown): GrowthPlan | null {
  if (!isRecord(data)) return null;
  const summary = str(data.summary);
  const recommendations = stringList(data.recommendations);
  if (!summary || recommendations.length === 0) return null;
  return {
    summary,
    recommendations,
    bestPlatform: str(data.bestPlatform),
    focusArea: str(data.focusArea),
  };
}

/* ─── Channel Audit (300 Bucs) ─────────────────────────────────── */

export const CHANNEL_AUDIT_PATH = "/api/channel-audit";
export const CHANNEL_AUDIT_COST_VB = registryCost(CHANNEL_AUDIT_PATH);
export const CHANNEL_AUDIT_FEATURE = registryFeature(CHANNEL_AUDIT_PATH);
export const CHANNEL_AUDIT_FAILED_LINE =
  "The audit couldn't be run — if the rail took your Bucs they come back on failure. Try again.";

/** The rail's platform enum (auditSchema) — "multi" included,
 *  unlike the virality rail's. */
export const AUDIT_PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "multi", label: "Multiple platforms" },
] as const;
export type AuditPlatformKey = (typeof AUDIT_PLATFORMS)[number]["key"];

/** The rail's dimension labels (DIMENSION_LABELS in the route),
 *  the fallback when an answer row arrives without its label. */
export const AUDIT_DIMENSION_LABELS: Record<string, string> = {
  "posting-consistency": "Posting Consistency",
  "hook-strength": "Hook Strength",
  branding: "Branding & Visual Identity",
  "caption-quality": "Caption Quality",
  "cta-usage": "Calls to Action",
  "profile-bio": "Profile & Bio",
};

const AUDIT_GRADES: readonly string[] = ["A", "B", "C", "D", "F"];

export interface ChannelAuditForm {
  niche: string;
  handle: string;
  platform: AuditPlatformKey;
  bio: string;
  postsPerWeek: string;
  /** One recent post per line — the panel's textarea, verbatim. */
  recentPostsText: string;
}

/** The panel's gate: a niche of at least 2 characters. */
export function channelAuditReady(form: ChannelAuditForm): boolean {
  return form.niche.trim().length >= 2;
}

/** The panel's exact body: trimmed fields capped at the rail
 *  schema's own maxima (niche 120, handle 80, bio 500, cadence
 *  40), recent posts split by line, trimmed, emptied dropped,
 *  capped at the rail's 10 posts of 1200 characters. */
export function buildChannelAuditBody(form: ChannelAuditForm): Record<string, unknown> {
  return {
    niche: form.niche.trim().slice(0, 120),
    handle: form.handle.trim().slice(0, 80),
    platform: form.platform,
    bio: form.bio.trim().slice(0, 500),
    postsPerWeek: form.postsPerWeek.trim().slice(0, 40),
    recentPosts: form.recentPostsText
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, 10)
      .map((p) => p.slice(0, 1200)),
  };
}

export interface AuditDimension {
  key: string;
  label: string;
  grade: string;
  score: number;
  finding: string;
  fix: string;
  /** The rail's own grade color class (gradeColorFor in the
   *  route); "" when the answer didn't carry one. */
  gradeColor: string;
}

export interface ChannelAuditResult {
  overallGrade: string;
  overallScore: number;
  verdict: string;
  disclaimer: string;
  dimensions: AuditDimension[];
  topPriorities: string[];
  /** Label + hint only — the rail's hrefs are dropped by design. */
  quickActions: { label: string; hint: string }[];
}

/** The audit answer: a real grade, a real score, and at least
 *  one dimension row, or it's unusable. Quick-action hrefs never
 *  survive normalization (see the header). */
export function normalizeChannelAudit(data: unknown): ChannelAuditResult | null {
  if (!isRecord(data)) return null;
  const grade = str(data.overallGrade).toUpperCase();
  const overallScore = scoreOf(data.overallScore);
  if (!AUDIT_GRADES.includes(grade) || overallScore === null) return null;
  if (!Array.isArray(data.dimensions)) return null;
  const dimensions: AuditDimension[] = [];
  for (const d of data.dimensions) {
    if (!isRecord(d)) continue;
    const key = str(d.key);
    const dGrade = str(d.grade).toUpperCase();
    const dScore = scoreOf(d.score);
    if (!key || !AUDIT_GRADES.includes(dGrade) || dScore === null) continue;
    dimensions.push({
      key,
      label: str(d.label) || AUDIT_DIMENSION_LABELS[key] || key,
      grade: dGrade,
      score: dScore,
      finding: str(d.finding),
      fix: str(d.fix),
      gradeColor: str(d.gradeColor),
    });
  }
  if (dimensions.length === 0) return null;
  const quickActions: ChannelAuditResult["quickActions"] = [];
  if (Array.isArray(data.quickActions)) {
    for (const a of data.quickActions) {
      if (!isRecord(a)) continue;
      const label = str(a.label);
      if (!label) continue;
      quickActions.push({ label, hint: str(a.hint) });
    }
  }
  return {
    overallGrade: grade,
    overallScore,
    verdict: str(data.verdict),
    disclaimer: str(data.disclaimer),
    dimensions,
    topPriorities: stringList(data.topPriorities),
    quickActions,
  };
}

/* ─── Virality Pre-Flight (200 Bucs) ───────────────────────────── */

export const VIRALITY_CHECK_PATH = "/api/virality-check";
export const VIRALITY_CHECK_COST_VB = registryCost(VIRALITY_CHECK_PATH);
export const VIRALITY_CHECK_FEATURE = registryFeature(VIRALITY_CHECK_PATH);
export const VIRALITY_CHECK_FAILED_LINE =
  "The pre-flight check couldn't be scored — if the rail took your Bucs they come back on failure. Try again.";

/** The rail's platform enum (viralityCheckSchema) — X included,
 *  "multi" not. */
export const VIRALITY_PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X" },
] as const;
export type ViralityPlatformKey = (typeof VIRALITY_PLATFORMS)[number]["key"];

export interface ViralityForm {
  platform: ViralityPlatformKey;
  caption: string;
  hashtags: string;
  hookLine: string;
}

/** The panel's gate: a caption is the one required input. */
export function viralityReady(form: ViralityForm): boolean {
  return form.caption.trim().length >= 1;
}

/** The panel's exact body: trimmed fields capped at the rail
 *  schema's maxima (caption 2000, hashtags 500, hook 300). */
export function buildViralityBody(form: ViralityForm): Record<string, unknown> {
  return {
    caption: form.caption.trim().slice(0, 2000),
    hashtags: form.hashtags.trim().slice(0, 500),
    hookLine: form.hookLine.trim().slice(0, 300),
    platform: form.platform,
  };
}

export interface ViralityScoreBlock {
  score: number;
  feedback: string;
}

export interface ViralityResult {
  overallScore: number;
  hookStrength: ViralityScoreBlock | null;
  captionScore: ViralityScoreBlock | null;
  hashtagAnalysis: (ViralityScoreBlock & { suggestedHashtags: string[] }) | null;
  postingTime: { bestTime: string; reason: string } | null;
  fixes: string[];
}

function normalizeScoreBlock(v: unknown): ViralityScoreBlock | null {
  if (!isRecord(v)) return null;
  const score = scoreOf(v.score);
  if (score === null) return null;
  return { score, feedback: str(v.feedback) };
}

/** The pre-flight answer — the panel's own usability gate: a
 *  numeric overall score and a fixes array, or it didn't happen.
 *  Individual score blocks may be absent (null), never faked. */
export function normalizeViralityCheck(data: unknown): ViralityResult | null {
  if (!isRecord(data)) return null;
  const overallScore = scoreOf(data.overallScore);
  if (overallScore === null || !Array.isArray(data.fixes)) return null;
  const hashtagBlock = normalizeScoreBlock(data.hashtagAnalysis);
  const posting = isRecord(data.postingTime) ? data.postingTime : null;
  return {
    overallScore,
    hookStrength: normalizeScoreBlock(data.hookStrength),
    captionScore: normalizeScoreBlock(data.captionScore),
    hashtagAnalysis: hashtagBlock
      ? {
          ...hashtagBlock,
          suggestedHashtags: stringList(
            isRecord(data.hashtagAnalysis) ? data.hashtagAnalysis.suggestedHashtags : undefined,
          ),
        }
      : null,
    postingTime:
      posting && str(posting.bestTime)
        ? { bestTime: str(posting.bestTime), reason: str(posting.reason) }
        : null,
    fixes: stringList(data.fixes),
  };
}

/* ─── Competitor Tracker (200 Bucs) ────────────────────────────── */

export const COMPETITOR_ANALYSIS_PATH = "/api/competitor-analysis";
export const COMPETITOR_COST_VB = registryCost(COMPETITOR_ANALYSIS_PATH);
export const COMPETITOR_FEATURE = registryFeature(COMPETITOR_ANALYSIS_PATH);
export const COMPETITOR_FAILED_LINE =
  "The competitor read couldn't be built — if the rail took your Bucs they come back on failure. Try again.";

export interface CompetitorForm {
  name: string;
  url: string;
  niche: string;
  notes: string;
}

/** The rail's refine + the page's gates: a name of 2+ characters
 *  OR a channel URL of 4+, and a niche of 2+. */
export function competitorReady(form: CompetitorForm): boolean {
  return (
    (form.name.trim().length >= 2 || form.url.trim().length >= 4) &&
    form.niche.trim().length >= 2
  );
}

/** The page's exact body: trimmed fields capped at the rail
 *  schema's maxima (name 120, URL 2048, niche 120, notes 2000). */
export function buildCompetitorBody(form: CompetitorForm): Record<string, unknown> {
  return {
    competitorName: form.name.trim().slice(0, 120),
    channelUrl: form.url.trim().slice(0, 2048),
    niche: form.niche.trim().slice(0, 120),
    notes: form.notes.trim().slice(0, 2000),
  };
}

export interface CompetitorResult {
  competitorName: string;
  niche: string;
  contentPillars: { pillar: string; whatTheyPost: string }[];
  postingCadence: { assessment: string; estimatedPostsPerWeek: number | null } | null;
  topFormats: { format: string; whyItWorks: string }[];
  strengths: string[];
  weaknesses: string[];
  opportunities: { gap: string; howToExploit: string }[];
  takeaways: string[];
  disclaimer: string;
  /** Label + hint only — the rail's hrefs are dropped by design. */
  quickActions: { label: string; hint: string }[];
}

/** The competitor answer — the page's own usability gate:
 *  exactly 3 takeaways and at least one opportunity, or it
 *  didn't happen. */
export function normalizeCompetitorAnalysis(data: unknown): CompetitorResult | null {
  if (!isRecord(data)) return null;
  const takeaways = stringList(data.takeaways);
  const opportunities: CompetitorResult["opportunities"] = [];
  if (Array.isArray(data.opportunities)) {
    for (const o of data.opportunities) {
      if (!isRecord(o)) continue;
      const gap = str(o.gap);
      if (!gap) continue;
      opportunities.push({ gap, howToExploit: str(o.howToExploit) });
    }
  }
  if (takeaways.length !== 3 || opportunities.length === 0) return null;
  const contentPillars: CompetitorResult["contentPillars"] = [];
  if (Array.isArray(data.contentPillars)) {
    for (const p of data.contentPillars) {
      if (!isRecord(p)) continue;
      const pillar = str(p.pillar);
      if (!pillar) continue;
      contentPillars.push({ pillar, whatTheyPost: str(p.whatTheyPost) });
    }
  }
  const topFormats: CompetitorResult["topFormats"] = [];
  if (Array.isArray(data.topFormats)) {
    for (const f of data.topFormats) {
      if (!isRecord(f)) continue;
      const format = str(f.format);
      if (!format) continue;
      topFormats.push({ format, whyItWorks: str(f.whyItWorks) });
    }
  }
  const quickActions: CompetitorResult["quickActions"] = [];
  if (Array.isArray(data.quickActions)) {
    for (const a of data.quickActions) {
      if (!isRecord(a)) continue;
      const label = str(a.label);
      if (!label) continue;
      quickActions.push({ label, hint: str(a.hint) });
    }
  }
  const cadence = isRecord(data.postingCadence) ? data.postingCadence : null;
  return {
    competitorName: str(data.competitorName),
    niche: str(data.niche),
    contentPillars,
    postingCadence: cadence
      ? {
          assessment: str(cadence.assessment),
          estimatedPostsPerWeek:
            typeof cadence.estimatedPostsPerWeek === "number" &&
            Number.isFinite(cadence.estimatedPostsPerWeek)
              ? cadence.estimatedPostsPerWeek
              : null,
        }
      : null,
    topFormats,
    strengths: stringList(data.strengths),
    weaknesses: stringList(data.weaknesses),
    opportunities,
    takeaways,
    disclaimer: str(data.disclaimer),
    quickActions,
  };
}

/* ─── AI Coach (100 Bucs) ──────────────────────────────────────── */

export const AI_COACH_PATH = "/api/ai-coach";
export const AI_COACH_COST_VB = registryCost(AI_COACH_PATH);
export const AI_COACH_FEATURE = registryFeature(AI_COACH_PATH);
export const AI_COACH_FAILED_LINE =
  "The coach couldn't read your numbers — if the rail took your Bucs they come back on failure. Try again.";
export const AI_COACH_NEED_POST_LINE =
  "Add at least one post with a title first — that's what the coach breaks down.";

/** The rail's platform enum (aiCoachSchema): youtube, tiktok,
 *  instagram — no X on this rail. */
export const COACH_PLATFORMS = [
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
] as const;
export type CoachPlatformKey = (typeof COACH_PLATFORMS)[number]["key"];

/** The page's row cap (MAX_COACH_POSTS) — the rail allows 20,
 *  the surface works with the strongest 8. */
export const COACH_MAX_POSTS = 8;

export interface CoachPost {
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSec: number;
  postedAt: string;
}

export function blankCoachPost(): CoachPost {
  return {
    title: "",
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    watchTimeSec: 0,
    postedAt: "",
  };
}

/** The page's gate: at least one post with a title. */
export function aiCoachReady(posts: CoachPost[]): boolean {
  return posts.some((p) => p.title.trim().length > 0);
}

function coachCount(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** The page's exact body: titled posts only (titles trimmed),
 *  capped at the page's 8 rows, fields capped at the rail
 *  schema's maxima (title 200, postedAt 40), niche trimmed to
 *  the page's 80. Counts floor to non-negative integers, the
 *  rail's own shape. */
export function buildAiCoachBody(input: {
  platform: CoachPlatformKey;
  posts: CoachPost[];
  niche: string;
}): Record<string, unknown> {
  return {
    platform: input.platform,
    posts: input.posts
      .filter((p) => p.title.trim().length > 0)
      .slice(0, COACH_MAX_POSTS)
      .map((p) => ({
        title: p.title.trim().slice(0, 200),
        views: coachCount(p.views),
        likes: coachCount(p.likes),
        comments: coachCount(p.comments),
        shares: coachCount(p.shares),
        watchTimeSec: Number.isFinite(p.watchTimeSec) && p.watchTimeSec > 0 ? p.watchTimeSec : 0,
        postedAt: p.postedAt.slice(0, 40),
      })),
    niche: input.niche.trim().slice(0, 80),
  };
}

export interface AiCoachResult {
  insights: string;
  patterns: string[];
  mistakes: string[];
  nextSteps: string[];
}

/** The coach's answer — the page's own usability gate: an
 *  insights paragraph or at least one pattern, or it didn't
 *  happen. */
export function normalizeAiCoach(data: unknown): AiCoachResult | null {
  if (!isRecord(data)) return null;
  const insights = str(data.insights);
  const patterns = stringList(data.patterns);
  if (!insights && patterns.length === 0) return null;
  return {
    insights,
    patterns,
    mistakes: stringList(data.mistakes),
    nextSteps: stringList(data.nextSteps),
  };
}
