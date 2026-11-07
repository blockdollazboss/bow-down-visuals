/**
 * coach-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 42): per-tab render-error isolation on /coach.
 *
 * The defect: the four tab branches (Plan, Money Tracker, Action
 * Tracker, Niche Analyzer) rendered as one bare ternary chain — a
 * throw in any branch (the money tab reads the earnings summary;
 * the plan branch renders AI plan output) blanked the whole Coach,
 * MONEY step included.
 *
 * The fix wraps each branch in its own SectionBoundary. The tab
 * branches mount per active tab, so switching tabs always lands on
 * a fresh boundary. (The "More money tools" directory below the
 * ternary renders static constant data — Links over a literal
 * registry — and carries no payload deref.)
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./coach.tsx");
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

describe("coach shape — one bad tab branch never blanks the Coach", () => {
  it("a failed money branch degrades alone; plan + actions still render; App-level copy absent", () => {
    const plan = makeBoundary(
      "coach-tab-plan",
      createElement("p", null, "PLAN BRANCH"),
    );
    const money = makeBoundary(
      "coach-tab-money",
      createElement("p", null, "MONEY TRACKER"),
    );
    const actions = makeBoundary(
      "coach-tab-actions",
      createElement("p", null, "ACTION TRACKER"),
    );
    failWith(money, new Error("earnings summary malformed"));

    const html = [
      renderToStaticMarkup(plan.render() as ReactElement),
      renderToStaticMarkup(money.render() as ReactElement),
      renderToStaticMarkup(actions.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("PLAN BRANCH");
    expect(html).toContain("ACTION TRACKER");
    expect(html).toContain('data-testid="section-error-coach-tab-money"');
    expect(html).not.toContain("MONEY TRACKER");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("coach.tsx — census-42 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(pageSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "coach-tab-plan",
    "coach-tab-money",
    "coach-tab-actions",
    "coach-tab-niche",
  ])("wraps tab branch %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 4 boundary usages", () => {
    expect(pageSource.match(/<SectionBoundary name="coach-/g) ?? []).toHaveLength(4);
  });
});
