/**
 * Dashboard — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit).
 *
 * The dashboard's sections settle independently through the shared
 * section machine (settleDashboardSection +
 * dashboardSectionStatusFromSettled): a section's data is applied
 * only on an ok response, but its STATUS is computed from the
 * settled fetch either way — a rejection or a non-ok answer settles
 * the section "failed", and each list section renders its
 * SectionFailureNote (retry wired to retrySection for that section)
 * BEFORE the loading skeleton and before any empty state. A failed
 * projects/deals/usage load therefore never renders as "no projects
 * yet" / an empty pipeline / no activity. What was missing is the
 * PIN; this file pins the shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./dashboard.tsx");

describe("section settlement — failure is a status, not an empty list", () => {
  it("each section's status settles from the settled fetch, ok or not", () => {
    expect(page).toContain('settleDashboardSection(prev, key, dashboardSectionStatusFromSettled(settled) === "ok")');
    expect(page).toContain("const [settled] = await Promise.allSettled([run()]);");
  });

  it("a missing token fails every asked-for section instead of leaving skeletons", () => {
    expect(page).toContain("keys.reduce((s, k) => settleDashboardSection(s, k, false), prev)");
  });

  it("section data is applied only on an ok response", () => {
    expect(page).toContain("if (mountedRef.current) setProjects(d.projects ?? []);");
    expect(page).toContain("if (mountedRef.current) setDeals(d.deals ?? []);");
    expect(page).toContain("if (mountedRef.current) setUsage((d.usage ?? []).slice(0, 6));");
  });
});

describe("render — the failure note precedes loading and empty in every list section", () => {
  it("projects: failed, then loading, then the empty CTA", () => {
    const failedAt = page.indexOf('sectionStates.projects === "failed" ? (');
    const loadingAt = page.indexOf('sectionStates.projects === "loading" ? (');
    const emptyAt = page.indexOf(") : projects.length === 0 ? (");
    expect(failedAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failedAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(page).toContain('testId="dashboard-projects-failure"');
    expect(page).toContain('onRetry={() => retrySection("projects")}');
  });

  it("deals: loading, then failed, then the pipeline content", () => {
    const loadingAt = page.indexOf('sectionStates.deals === "loading" ? (');
    const failedAt = page.indexOf('sectionStates.deals === "failed" ? (');
    const contentAt = page.indexOf(") : money.activeCount > 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(loadingAt);
    expect(contentAt).toBeGreaterThan(failedAt);
    expect(page).toContain('testId="dashboard-deals-failure"');
    expect(page).toContain('onRetry={() => retrySection("deals")}');
  });

  it("usage: failed, then loading, then the empty state", () => {
    const failedAt = page.indexOf('sectionStates.usage === "failed" ? (');
    const loadingAt = page.indexOf('sectionStates.usage === "loading" ? (');
    const emptyAt = page.indexOf(") : usage.length === 0 ? (");
    expect(failedAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failedAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(page).toContain('testId="dashboard-usage-failure"');
    expect(page).toContain('onRetry={() => retrySection("usage")}');
  });
});
