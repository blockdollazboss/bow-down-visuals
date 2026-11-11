/**
 * AnalyticsDesk — honest load standard (deep-pins tranche 4,
 * batch E). Two load shapes live here. The free connected
 * overview auto-loads: a non-ok answer and an unparseable one
 * both throw into the failed phase, and OverviewCard renders
 * loading → failed-with-retry → honestly-empty (no platforms)
 * → loaded, with a partial read named as partial — a failed
 * read never becomes zero stats. Every paid tool runs through
 * the one usePaidTool helper, whose endings are the standard:
 * each section's form gate sets its error BEFORE run() is ever
 * called (a gate refusal never reaches the spend confirm), a
 * cancelled confirm returns null and changes nothing, 402 is
 * the out-of-credits state checked before the generic non-ok,
 * a non-ok answer is the server's error line, an unparseable ok
 * answer is the failed line, and the result is set only from
 * the parsed answer — a failed run is an error with the run
 * button still live as the retry, never an empty success.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AnalyticsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("usePaidTool — the one run shape every paid tool inherits", () => {
  it("decline / out-of-credits / non-ok / unparseable are four endings, and the result sets only from the parse", () => {
    const body = slice(src, "async function run(path: string, body: unknown) {", "return { busy, error, setError, outOfCredits, result, run };");
    expect(body).toContain("if (res === null) return; /* confirm cancelled — nothing charged, nothing changed */");
    expect(body.indexOf("if (analyticsOutOfCredits(res.status, data)) {")).toBeLessThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain("setError(apiErrorMessage(data, failedLine));");
    expect(body).toContain("const parsed = normalize(data);");
    expect(body).toContain("if (parsed === null) {");
    expect(body.indexOf("setResult(parsed);")).toBeGreaterThan(body.indexOf("if (parsed === null) {"));
    expect(body).toContain("setError(failedLine);");
  });

  it("the gates fire before run(): the connected-AI body, the growth-plan body, and the audit form", () => {
    const gate = slice(src, "function bodyOrGate(tool: { setError: (e: string | null) => void }) {", "return (\n    <div data-testid=\"world-analytics-desk-connected-ai\">");
    expect(gate).toContain("if (!body) {");
    expect(gate).toContain("tool.setError(t(\"worldDeskRemainder.anlNoConnected\"));");
    const growth = slice(src, "const body = buildGrowthPlanBody(hubState);", "void plan.run(GROWTH_PLAN_PATH, body);");
    expect(growth).toContain("plan.setError(t(\"worldDeskRemainder.anlGrowthPlanNoData\"));");
    expect(src).toContain("if (!channelAuditReady(form)) {");
    expect(src).toContain("if (!viralityReady(form)) {");
    expect(src).toContain("if (!competitorReady(form)) {");
    expect(src).toContain("if (!aiCoachReady(posts)) {");
  });
});

describe("the free overview — a failed read is the error state, never zero stats", () => {
  it("non-ok and unparseable answers throw into the failed phase; ready is set only from the parse", () => {
    const body = slice(src, "/* The free overview read — auto-loads with the desk, exactly", "function saveHubPlatform(");
    expect(body).toContain("if (!res.ok) throw new Error(`overview ${res.status}`);");
    expect(body).toContain("if (!parsed) throw new Error(\"overview shape\");");
    expect(body.indexOf("setOverviewPhase(\"ready\");")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(body).toContain("setOverviewPhase(\"failed\");");
  });

  it("OverviewCard renders loading → failed+retry → empty → platforms, and names a partial read", () => {
    const body = slice(src, "{phase === \"loading\" ? (", "function OverviewPlatformRow({");
    expect(body.indexOf("{phase === \"loading\" ? (")).toBeLessThan(body.indexOf(") : phase === \"failed\" || !overview ? ("));
    expect(body.indexOf(") : phase === \"failed\" || !overview ? (")).toBeLessThan(
      body.indexOf(") : overview.platforms.length === 0 ? ("),
    );
    expect(body).toContain("onRetry={onRetry}");
    expect(body).toContain("{overview.partial ? (");
    expect(body).toContain('t("worldDeskRemainder.anlPartialNote")');
  });
});
