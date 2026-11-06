/**
 * analytics-hub-isolation.test.ts — Stack-200 hardening wave,
 * section C (census item 36): render-error isolation on the
 * Analytics Hub.
 *
 * The defect: the hub's tab doors were Suspense-only — Suspense
 * catches a lazy panel still LOADING, never one that THROWS — so as
 * the hub kept absorbing whole tools (channel audit, virality,
 * milestone tracker, fan decoder…), any absorbed panel's render
 * throw, and any dashboard chart block's throw, took the entire hub
 * (and its tab bar) down to the App fallback.
 *
 * The fix: TabDoor is now a Suspense + SectionBoundary pair whose
 * boundary remounts on every tab switch (reset key = hubTab); the
 * competitor panel and ConnectedAccountsTab get their own
 * boundaries; each dashboard chart block gets its own.
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./analytics-hub.tsx");
const appSource = read("../App.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
  retryLabel: "Try again",
};

function makeBoundary(name: string, child: ReactElement) {
  return new SectionBoundaryCore({
    name,
    variant: "section",
    isLight: false,
    title: LABELS.title,
    description: LABELS.description,
    retryLabel: LABELS.retryLabel,
    children: child,
  });
}

function failWith(boundary: SectionBoundaryCore, error: Error) {
  Object.assign(
    boundary.state,
    SectionBoundaryCore.getDerivedStateFromError(error),
  );
}

describe("analytics hub shape — one bad panel never takes the hub down", () => {
  it("a failed chart block degrades alone; the tab bar and other blocks still render; App-level copy absent", () => {
    const tabBar = createElement("nav", null, "HUB TAB BAR");
    const growth = makeBoundary(
      "analytics-growth-chart",
      createElement("p", null, "GROWTH CHART"),
    );
    const insights = makeBoundary(
      "analytics-insights",
      createElement("p", null, "AI INSIGHTS"),
    );
    failWith(growth, new Error("chart data malformed"));

    const html = [
      renderToStaticMarkup(tabBar),
      renderToStaticMarkup(growth.render() as ReactElement),
      renderToStaticMarkup(insights.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("HUB TAB BAR");
    expect(html).toContain("AI INSIGHTS");
    expect(html).toContain('data-testid="section-error-analytics-growth-chart"');
    expect(html).not.toContain("GROWTH CHART");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("analytics-hub.tsx — census-36 structure (source pins)", () => {
  it("TabDoor is a Suspense + SectionBoundary pair keyed by the reset key", () => {
    expect(pageSource).toContain(
      "function TabDoor({ name, resetKey, children }: { name: string; resetKey: string; children: ReactNode })",
    );
    expect(pageSource).toContain("<SectionBoundary key={resetKey} name={name}>");
    expect(pageSource).toContain(
      "<Suspense fallback={<AnalyticsTabFallback />}>{children}</Suspense>",
    );
  });

  it.each([
    "analytics-tab-intelligence",
    "analytics-tab-contentid",
    "analytics-tab-milestones",
    "analytics-tab-channelaudit",
    "analytics-tab-virality",
    "analytics-tab-fandecoder",
    "analytics-tab-audience",
  ])("tab door %s is fed hubTab as its reset key", (slug) => {
    expect(pageSource).toContain(`<TabDoor name="${slug}" resetKey={hubTab}>`);
  });

  it.each([
    "analytics-month-wrapped",
    "analytics-overview",
    "analytics-growth-chart",
    "analytics-platform-cards",
    "analytics-insights",
    "analytics-coach",
    "analytics-competitor",
    "analytics-connected",
  ])("wraps block %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });
});
