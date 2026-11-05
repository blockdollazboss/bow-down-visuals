/**
 * analytics-desk-components — stack100 wave 4 item 24 (desk #98)
 * source-contract pins. The Analytics depth desk must sit in the
 * My Studio stack as a board desk ({ isLight }), with:
 * - every depth tool in-desk on its own rail: the free connected
 *   overview read, AI Insights + What-to-make-next, the hub-stats
 *   editor + Growth Plan, Channel Audit, Virality Pre-Flight,
 *   Competitor Tracker and the AI Coach;
 * - every paid run on the standing CreditConfirm path
 *   (confirmedFetch) with NO desk-local price override — the
 *   confirm prices itself from the registry row;
 * - honest states: the failed overview read is an error state
 *   with a retry (never zero stats), a 402 speaks the house
 *   not-enough-Bucs line, gates refuse BEFORE the confirm;
 * - no page pull-ups: no links, no router, no website paths —
 *   the desk names surfaces in words, exactly the World law.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/AnalyticsDesk.tsx");
const seam = read("./analytics-desk.ts");
const panel = read("../../components/world/StationPanel.tsx");
const registry = read("../credit-costs.ts");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid, one testid per tool", () => {
    expect(desk).toContain(
      "export function AnalyticsDesk({ isLight }: { isLight: boolean })",
    );
    for (const id of [
      'data-testid="world-analytics-desk"',
      'data-testid="world-analytics-desk-overview"',
      'data-testid="world-analytics-desk-connected-ai"',
      'data-testid="world-analytics-desk-growth"',
      'data-testid="world-analytics-desk-audit"',
      'data-testid="world-analytics-desk-virality"',
      'data-testid="world-analytics-desk-competitor"',
      'data-testid="world-analytics-desk-coach"',
    ]) {
      expect(desk, id).toContain(id);
    }
  });

  it("StationPanel lazy-loads it and stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain(
      'const AnalyticsDesk = lazy(() => import("@/components/world/native/AnalyticsDesk")',
    );
    expect(panel).toContain("<AnalyticsDesk isLight={isLight} />");
    expect(panel).toContain("Analytics Desk (stack100 wave 4, item 24, desk");
    expect(panel).toContain("#98): the Analytics Hub's DEPTH tools");
  });
});

describe("every tool drives its own rail", () => {
  it("the overview is a plain authed fetch of the free rail, auto-loaded on mount", () => {
    expect(desk).toContain("fetch(ANALYTICS_OVERVIEW_PATH");
    expect(desk).toContain("useDeskAuthHeaders");
    expect(desk).toContain("useEffect");
    expect(desk).toContain("normalizeAnalyticsOverview");
  });

  it("each paid tool runs its rail through the seam's body builder", () => {
    for (const needle of [
      "insights.run(ANALYTICS_INSIGHTS_PATH, body)",
      "suggestions.run(ANALYTICS_SUGGESTIONS_PATH, body)",
      "plan.run(GROWTH_PLAN_PATH, body)",
      "audit.run(CHANNEL_AUDIT_PATH, buildChannelAuditBody(form))",
      "check.run(VIRALITY_CHECK_PATH, buildViralityBody(form))",
      "look.run(COMPETITOR_ANALYSIS_PATH, buildCompetitorBody(form))",
      "AI_COACH_PATH,",
      "buildAiCoachBody({ platform, posts, niche })",
      "buildAnalyticsAiBody(overview, niche)",
      "buildGrowthPlanBody(hubState)",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the registry carries the seven priced rows the seam derives from", () => {
    for (const needle of [
      '"/api/virality-check": { cost: 200, feature: "Virality Pre-Flight Check" }',
      '"/api/analytics-hub/insights": { cost: 200, feature: "Growth Plan" }',
      '"/api/analytics/insights": { cost: 100, feature: "Analytics Insights" }',
      '"/api/analytics/suggestions": { cost: 100, feature: "Analytics Content Suggestions" }',
      '"/api/ai-coach": { cost: 100, feature: "AI Performance Coach" }',
      '"/api/competitor-analysis": { cost: 200, feature: "Competitor Tracker" }',
      '"/api/channel-audit": { cost: 300, feature: "Channel Audit" }',
    ]) {
      expect(registry, needle).toContain(needle);
    }
    /* the free overview deliberately has NO row */
    expect(registry).not.toContain('"/api/analytics/overview"');
  });

  it("the seam derives every price from the registry and throws on a missing row", () => {
    expect(seam).toContain("registryCost(CHANNEL_AUDIT_PATH)");
    expect(seam).toContain("registryCost(VIRALITY_CHECK_PATH)");
    expect(seam).toContain("registryCost(GROWTH_PLAN_PATH)");
    expect(seam).toContain("registryCost(ANALYTICS_INSIGHTS_PATH)");
    expect(seam).toContain("registryCost(ANALYTICS_SUGGESTIONS_PATH)");
    expect(seam).toContain("registryCost(COMPETITOR_ANALYSIS_PATH)");
    expect(seam).toContain("registryCost(AI_COACH_PATH)");
    expect(seam).toContain("throw new Error");
    expect(seam).toContain('getCreditCost(endpoint)');
  });
});

describe("the spend path is the standing CreditConfirm, priced by the registry", () => {
  it("all paid runs ride confirmedFetch — and no desk-local price override exists", () => {
    expect(desk).toContain("useConfirmedApi");
    expect(desk).toContain("await confirmedFetch(path, {");
    expect(desk).not.toContain("overrideCost");
    expect(desk).not.toContain("overrideFeature");
  });

  it("button copy names the registry feature + cost, never a re-typed price", () => {
    for (const needle of [
      "anlFeatureCost\", { feature: ANALYTICS_INSIGHTS_FEATURE, cost: ANALYTICS_INSIGHTS_COST_VB }",
      "anlFeatureCost\", { feature: ANALYTICS_SUGGESTIONS_FEATURE, cost: ANALYTICS_SUGGESTIONS_COST_VB }",
      "anlFeatureCost\", { feature: GROWTH_PLAN_FEATURE, cost: GROWTH_PLAN_COST_VB }",
      "anlFeatureCost\", { feature: CHANNEL_AUDIT_FEATURE, cost: CHANNEL_AUDIT_COST_VB }",
      "anlFeatureCost\", { feature: VIRALITY_CHECK_FEATURE, cost: VIRALITY_CHECK_COST_VB }",
      "anlFeatureCost\", { feature: COMPETITOR_FEATURE, cost: COMPETITOR_COST_VB }",
      "anlCoachTitle\", { cost: AI_COACH_COST_VB }",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("a cancelled confirm is a silent no-op; success refreshes the balance", () => {
    expect(desk).toContain("if (res === null) return;");
    expect(desk).toContain("refreshProfile()");
  });

  it("a 402 speaks the house not-enough-Bucs line through the shared helper", () => {
    expect(desk).toContain("analyticsOutOfCredits(res.status, data)");
    expect(desk).toContain("worldDeskRemainder.anlOutOfCredits");
    expect(seam).toContain("nothing was charged");
  });
});

describe("the honest states stay honest", () => {
  it("a failed overview read is the error state with a retry — never zero stats", () => {
    expect(desk).toContain("NativeErrorState");
    expect(desk).toContain("worldDeskRemainder.anlOverviewFailedTitle");
    expect(desk).toContain("onRetry={() => setReloadTick((t) => t + 1)}");
    expect(desk).toContain("worldDeskRemainder.anlPartialNote");
    expect(desk).toContain("worldDeskRemainder.anlNoDataDetail");
  });

  it("paid failures surface the rail's own words or the tool's failure line", () => {
    expect(desk).toContain("apiErrorMessage(data, failedLine)");
    for (const needle of [
      "worldDeskRemainder.anlInsightsFailed",
      "worldDeskRemainder.anlSuggestionsFailed",
      "GROWTH_PLAN_FAILED_LINE",
      "worldDeskRemainder.anlAuditFailed",
      "worldDeskRemainder.anlViralityFailed",
      "worldDeskRemainder.anlCompetitorFailed",
      "worldDeskRemainder.anlCoachFailed",
    ]) {
      expect(desk, needle).toContain(needle);
    }
    expect(desk).toContain('role="alert"');
  });

  it("gates refuse before the confirm: no connected account, no hub data, no titled post", () => {
    expect(desk).toContain("worldDeskRemainder.anlNoConnected");
    expect(desk).toContain("worldDeskRemainder.anlGrowthPlanNoData");
    expect(desk).toContain("worldDeskRemainder.anlCoachNeedPost");
    expect(desk).toContain("channelAuditReady(form)");
    expect(desk).toContain("viralityReady(form)");
    expect(desk).toContain("competitorReady");
  });

  it("a partial overview says so out loud", () => {
    expect(desk).toContain("overview.partial");
    expect(desk).toContain("worldDeskRemainder.anlPartialNote");
  });
});

describe("the hub store is shared with the website page", () => {
  it("the desk reads and writes the page's own localStorage key through the seam", () => {
    expect(seam).toContain('ANALYTICS_HUB_STORAGE_KEY = "analytics-hub-v1"');
    expect(desk).toContain("window.localStorage.getItem(ANALYTICS_HUB_STORAGE_KEY)");
    expect(desk).toContain("window.localStorage.setItem(ANALYTICS_HUB_STORAGE_KEY");
    expect(desk).toContain("parseAnalyticsHubState");
    expect(desk).toContain("withPlatformStats");
  });
});

describe("no page pull-ups — the desk never navigates on a payload's say-so", () => {
  it("the component carries no links, no router and no website paths", () => {
    expect(desk).not.toContain("href=");
    expect(desk).not.toContain("wouter");
    expect(desk).not.toContain("window.location");
    expect(desk).not.toContain('"/analytics-hub"');
    expect(desk).not.toContain('"/settings"');
  });

  it("the seam drops rail quick-action hrefs at normalization", () => {
    expect(seam).toContain("Label + hint only — the rail's hrefs are dropped by design.");
    expect(seam).not.toContain("href: str(a.href)");
  });
});

describe("light/dark parity rides the desk's isLight branches", () => {
  it("every card is a NativeCard and the desk threads isLight through", () => {
    expect(desk).toContain("NativeCard");
    expect(desk).toContain("deskInputCls(isLight)");
    expect(desk).toContain("NativeLoadingState");
    expect(desk).toContain("NativeEmptyState");
  });
});
