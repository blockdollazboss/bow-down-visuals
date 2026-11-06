/**
 * brand-deals-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 33): per-tab render-error isolation on /brand-deals.
 *
 * The defect: all five tab panels (Finder, Pitch Kit, Marketplace,
 * Manage Deals, Post a Deal — the last three folded in by C-21)
 * mounted as bare siblings, and inside Pitch Kit the SponsorRead,
 * InvoiceGenerator and Pipeline panels stacked bare. A throw in the
 * active panel replaced the whole hub INCLUDING its tab bar — the
 * user couldn't even switch to a healthy tab.
 *
 * The fix wraps each tab panel in its own SectionBoundary and each
 * Pitch Kit sub-panel in its own. Each tab's boundary mounts only
 * while its tab is active, so switching tabs always lands on a fresh
 * boundary — the census's "reset key = mainTab" by construction.
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./brand-deals.tsx");
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

describe("brand deals shape — one bad tab panel never takes the hub down", () => {
  it("a failed Manage Deals panel shows its own fallback; the tab bar and a sibling panel are unaffected; App-level copy absent", () => {
    const tabBar = createElement("nav", null, "TAB BAR");
    const manage = makeBoundary(
      "brand-deals-tab-manage",
      createElement("p", null, "MANAGE DEALS PANEL"),
    );
    const invoice = makeBoundary(
      "brand-deals-invoice",
      createElement("p", null, "INVOICE PANEL"),
    );
    failWith(manage, new Error("manage panel malformed"));

    const html = [
      renderToStaticMarkup(tabBar),
      renderToStaticMarkup(manage.render() as ReactElement),
      renderToStaticMarkup(invoice.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("TAB BAR");
    expect(html).toContain("INVOICE PANEL");
    expect(html).toContain('data-testid="section-error-brand-deals-tab-manage"');
    expect(html).not.toContain("MANAGE DEALS PANEL");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("brand-deals.tsx — census-33 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(pageSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "brand-deals-tab-finder",
    "brand-deals-tab-pitch",
    "brand-deals-tab-marketplace",
    "brand-deals-tab-manage",
    "brand-deals-tab-post",
    "brand-deals-sponsor-read",
    "brand-deals-invoice",
    "brand-deals-pipeline",
  ])("wraps panel %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 8 boundary usages (5 tabs + 3 Pitch Kit sub-panels)", () => {
    expect(pageSource.match(/<SectionBoundary name="brand-deals-/g) ?? []).toHaveLength(8);
  });
});
