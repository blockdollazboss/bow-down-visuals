/**
 * dashboard-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 28): per-widget render-error isolation on /dashboard.
 *
 * The defect: the dashboard's core sections had per-section DATA
 * isolation, but the widget stack around them — CommandCenter,
 * CreationStreak/Quests, FomoFeed, MoveHome, First100Fans,
 * DailyDropCard/Slate, ContestHub, Leaderboard, ExtensionPromo, the
 * active-artist strip, and the inline Continue / Money / Next-Move /
 * Quick-Create / Activity sections — rendered bare. Any widget
 * render throw escaped to the one App-level RouteErrorBoundary and
 * replaced the whole dashboard: the owner's "one bad section" law
 * on the most-visited signed-in page.
 *
 * The fix wraps each widget/section in the shared SectionBoundary.
 * This suite follows the D3 idiom: (a) a composition in the
 * dashboard's shape — one failed widget's own fallback renders
 * alongside its healthy neighbours, with the App-level boundary's
 * fallback copy proven ABSENT; (b) source pins that dashboard.tsx
 * wraps every surface census item 28 named.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const dashSource = read("./dashboard.tsx");
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

const WRAPS: Array<[string, string]> = [
  ["CommandCenter", "dashboard-command-center"],
  ["CreationStreakWidget", "dashboard-streak"],
  ["QuestsWidget", "dashboard-quests"],
  ["FomoFeed", "dashboard-fomo"],
  ["MoveHomeCard", "dashboard-move-home"],
  ["First100FansCard", "dashboard-first-100-fans"],
  ["DailyDropCard", "dashboard-daily-drop"],
  ["DailyDropSlate", "dashboard-drop-slate"],
  ["ContestHubWidget", "dashboard-contest-hub"],
  ["LeaderboardWidget", "dashboard-leaderboard"],
  ["ExtensionPromoBanner", "dashboard-extension-promo"],
];

const INLINE = [
  "dashboard-artist-strip",
  "dashboard-continue",
  "dashboard-money",
  "dashboard-next-move",
  "dashboard-quick-create",
  "dashboard-activity",
];

describe("dashboard shape — one bad widget never takes the dashboard down", () => {
  it("a failed widget's fallback renders alongside healthy widgets and sections; the App-level fallback copy is absent", () => {
    const command = makeBoundary(
      "dashboard-command-center",
      createElement("p", null, "COMMAND CENTER"),
    );
    const fomo = makeBoundary(
      "dashboard-fomo",
      createElement("p", null, "FOMO FEED"),
    );
    const money = makeBoundary(
      "dashboard-money",
      createElement("p", null, "MONEY PIPELINE"),
    );
    failWith(fomo, new Error("fomo payload malformed"));

    const html = [
      renderToStaticMarkup(command.render() as ReactElement),
      renderToStaticMarkup(fomo.render() as ReactElement),
      renderToStaticMarkup(money.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("COMMAND CENTER");
    expect(html).toContain("MONEY PIPELINE");
    expect(html).toContain('data-testid="section-error-dashboard-fomo"');
    expect(html).toContain(LABELS.title);
    expect(html).not.toContain("FOMO FEED");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("dashboard.tsx — every census-28 surface is wrapped (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(dashSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each(WRAPS)("wraps %s in its own boundary", (component, slug) => {
    expect(dashSource).toContain(`<SectionBoundary name="${slug}">`);
    expect(dashSource).toContain(`<${component}`);
  });

  it.each(INLINE)("wraps the inline section %s", (slug) => {
    expect(dashSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 17 boundary usages (11 widgets + artist strip + 5 core sections)", () => {
    const usages = dashSource.match(/<SectionBoundary name="dashboard-/g) ?? [];
    expect(usages).toHaveLength(17);
  });
});
