import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SECTION_KEYS,
  allDashboardSectionsFailed,
  anyDashboardSectionLoading,
  dashboardSectionStatusFromSettled,
  dashboardSectionsToRefetch,
  initialDashboardSectionStates,
  markDashboardSectionLoading,
  settleDashboardSection,
  type DashboardSectionStates,
} from "./dashboard-sections";

/**
 * Dashboard section resilience (owner-approved fix, Oct 19 2026).
 *
 * The old dashboard loader flipped ONE page-wide error flag if any of
 * its four section fetches failed, replacing the whole page with a
 * "Couldn't load your dashboard." card. These tests pin the new law:
 * sections settle and retry independently, a failed section is never
 * an empty section, and the full-page card is reserved for the case
 * where ALL FOUR sections failed.
 */

const ALL_OK: DashboardSectionStates = { projects: "ok", deals: "ok", usage: "ok", streak: "ok" };
const ALL_FAILED: DashboardSectionStates = {
  projects: "failed",
  deals: "failed",
  usage: "failed",
  streak: "failed",
};

describe("dashboard section states", () => {
  it("starts with every section in flight", () => {
    const s = initialDashboardSectionStates();
    expect(s).toEqual({ projects: "loading", deals: "loading", usage: "loading", streak: "loading" });
    expect(anyDashboardSectionLoading(s)).toBe(true);
    expect(allDashboardSectionsFailed(s)).toBe(false);
  });

  it("(a) one section failing leaves the others settled — only that section is failed", () => {
    let s = initialDashboardSectionStates();
    s = settleDashboardSection(s, "projects", true);
    s = settleDashboardSection(s, "deals", true);
    s = settleDashboardSection(s, "usage", false);
    s = settleDashboardSection(s, "streak", true);
    expect(s).toEqual({ projects: "ok", deals: "ok", usage: "failed", streak: "ok" });
    /* The page renders: NOT a total failure, and nothing left loading. */
    expect(allDashboardSectionsFailed(s)).toBe(false);
    expect(anyDashboardSectionLoading(s)).toBe(false);
  });

  it("settling one section never rewrites a sibling (immutable fold)", () => {
    const before = { ...ALL_OK, usage: "failed" as const };
    const after = settleDashboardSection(before, "usage", true);
    expect(after).toEqual(ALL_OK);
    expect(before.usage).toBe("failed");
  });

  it("(b) the full-page failure verdict requires ALL FOUR sections failed", () => {
    expect(allDashboardSectionsFailed(ALL_FAILED)).toBe(true);
    /* Three failures + one success still renders the page. */
    expect(allDashboardSectionsFailed({ ...ALL_FAILED, streak: "ok" })).toBe(false);
    expect(allDashboardSectionsFailed({ ...ALL_FAILED, projects: "ok" })).toBe(false);
    /* A section still in flight is not a failure. */
    expect(allDashboardSectionsFailed({ ...ALL_FAILED, deals: "loading" })).toBe(false);
    expect(allDashboardSectionsFailed(ALL_OK)).toBe(false);
  });

  it("the settled-fetch verdict matches the old page-wide check, per section", () => {
    expect(dashboardSectionStatusFromSettled({ status: "fulfilled", value: { ok: true } })).toBe("ok");
    expect(dashboardSectionStatusFromSettled({ status: "fulfilled", value: { ok: false } })).toBe("failed");
    expect(
      dashboardSectionStatusFromSettled({ status: "rejected", reason: new Error("box waking") }),
    ).toBe("failed");
  });
});

describe("dashboard section retries", () => {
  it("(c) a named retry refetches ONLY that section", () => {
    const s = { ...ALL_OK, usage: "failed" as const };
    expect(dashboardSectionsToRefetch(s, "usage")).toEqual(["usage"]);
    expect(dashboardSectionsToRefetch(ALL_FAILED, "streak")).toEqual(["streak"]);
    expect(dashboardSectionsToRefetch(ALL_OK, "projects")).toEqual(["projects"]);
  });

  it("an unnamed retry refetches exactly the failed set — all four on the total-failure path", () => {
    expect(dashboardSectionsToRefetch(ALL_FAILED)).toEqual([...DASHBOARD_SECTION_KEYS]);
    expect(dashboardSectionsToRefetch({ ...ALL_OK, deals: "failed", streak: "failed" })).toEqual([
      "deals",
      "streak",
    ]);
    expect(dashboardSectionsToRefetch(ALL_OK)).toEqual([]);
  });

  it("marking a retry touches only that section's state", () => {
    const s = { ...ALL_OK, usage: "failed" as const };
    const next = markDashboardSectionLoading(s, "usage");
    expect(next).toEqual({ ...ALL_OK, usage: "loading" });
    expect(s.usage).toBe("failed");
  });

  it("full walk: partial failure → retry that section → page whole again", () => {
    let s = initialDashboardSectionStates();
    s = settleDashboardSection(s, "projects", true);
    s = settleDashboardSection(s, "deals", false);
    s = settleDashboardSection(s, "usage", true);
    s = settleDashboardSection(s, "streak", true);
    expect(allDashboardSectionsFailed(s)).toBe(false);
    const plan = dashboardSectionsToRefetch(s, "deals");
    expect(plan).toEqual(["deals"]);
    s = markDashboardSectionLoading(s, "deals");
    expect(s.deals).toBe("loading");
    expect(s.projects).toBe("ok");
    s = settleDashboardSection(s, "deals", true);
    expect(s).toEqual(ALL_OK);
  });
});

/* ── Source pins: the wiring in pages/dashboard.tsx ─────────────────
   The render rules themselves (which branch shows what) live in the
   page; these pins keep the seam actually wired the way the law
   requires, in the style of the other honesty pin suites. */
const pageSource = readFileSync(new URL("../pages/dashboard.tsx", import.meta.url), "utf8");

describe("dashboard.tsx wiring (source pins)", () => {
  it("drives the page off the per-section seam", () => {
    expect(pageSource).toContain('from "@/lib/dashboard-sections"');
    expect(pageSource).toContain("initialDashboardSectionStates");
    expect(pageSource).toContain("settleDashboardSection");
    expect(pageSource).toContain("dashboardSectionStatusFromSettled");
  });

  it("the page-wide loadError flag is gone — no single flag can nuke the page", () => {
    expect(pageSource).not.toContain("loadError");
    expect(pageSource).not.toContain("setLoadError");
    expect(pageSource).not.toContain("Promise.allSettled([\n        fetch(\"/api/projects\"");
  });

  it("(b) the full-page card renders ONLY on the all-four-failed verdict, and its retry refetches all", () => {
    expect(pageSource).toContain("allDashboardSectionsFailed(sectionStates) ? (");
    expect(pageSource).toContain("Couldn't load your dashboard.");
    expect(pageSource).toContain("onClick={retryAllSections}");
  });

  it("(c) each section carries its own failure note with its own retry", () => {
    /* The note component stamps the testid it is handed. */
    expect(pageSource).toContain("data-testid={testId}");
    for (const key of DASHBOARD_SECTION_KEYS) {
      expect(pageSource).toContain(`testId="dashboard-${key}-failure"`);
      expect(pageSource).toContain(`retrySection("${key}")`);
    }
  });

  it("(d) failed sections are gated BEFORE their empty states — a failure can never render as empty", () => {
    const failedAt = pageSource.indexOf('testId="dashboard-projects-failure"');
    const emptyAt = pageSource.indexOf('t("dashboard.no_projects_cta")');
    expect(failedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failedAt);
    const usageFailedAt = pageSource.indexOf('testId="dashboard-usage-failure"');
    const usageEmptyAt = pageSource.indexOf('t("dashboard.activity_empty")');
    expect(usageFailedAt).toBeGreaterThan(-1);
    expect(usageEmptyAt).toBeGreaterThan(usageFailedAt);
  });

  it("all four section endpoints are still the ones being fetched", () => {
    expect(pageSource).toContain('fetch("/api/projects"');
    expect(pageSource).toContain('fetch("/api/wave8/sponsors/deals"');
    expect(pageSource).toContain('fetch("/api/credits/history"');
    expect(pageSource).toContain('fetch("/api/bonus/status"');
  });

  it("the sections that sit above the fold keep working independently of the fetch states", () => {
    expect(pageSource).toContain("<CreationStreakWidget");
    expect(pageSource).toContain("<QuestsWidget");
    expect(pageSource).toContain("<ContestHubWidget />");
    expect(pageSource).toContain("<DailyDropCard />");
  });
});
