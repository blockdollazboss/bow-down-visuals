/**
 * store-dashboard-isolation.test.ts — Stack-200 hardening wave,
 * section C (census item 34): per-section render-error isolation on
 * /store/dashboard.
 *
 * The defect: the earnings hero, the overview grid, seven tab panels
 * and the two cards stacked above the tabs (offers inbox, payout
 * card) all rendered bare in one tree — a throw in any one replaced
 * the entire money dashboard. Load-time section independence already
 * existed here (the overview failure card); this lane adds the
 * matching RENDER isolation.
 *
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./store-dashboard.tsx");
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

describe("store dashboard shape — one bad panel never blanks the money desk", () => {
  it("a failed Orders tab degrades alone; the payout card and products tab still render; App-level copy absent", () => {
    const payout = makeBoundary(
      "store-connect-payout",
      createElement("p", null, "PAYOUT CARD"),
    );
    const orders = makeBoundary(
      "store-tab-orders",
      createElement("p", null, "ORDERS TAB"),
    );
    const products = makeBoundary(
      "store-tab-products",
      createElement("p", null, "PRODUCTS TAB"),
    );
    failWith(orders, new Error("orders payload malformed"));

    const html = [
      renderToStaticMarkup(payout.render() as ReactElement),
      renderToStaticMarkup(orders.render() as ReactElement),
      renderToStaticMarkup(products.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("PAYOUT CARD");
    expect(html).toContain("PRODUCTS TAB");
    expect(html).toContain('data-testid="section-error-store-tab-orders"');
    expect(html).not.toContain("ORDERS TAB");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("store-dashboard.tsx — census-34 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(pageSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "store-offers-inbox",
    "store-earnings-hero",
    "store-push-prompt",
    "store-connect-payout",
    "store-overview-grid",
    "store-pixels",
    "store-tab-products",
    "store-course-builder",
    "store-shopify-bridge",
    "store-tab-orders",
    "store-tab-discounts",
    "store-tab-reviews",
    "store-tab-giftcards",
    "store-tab-digital",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 14 boundary usages", () => {
    expect(pageSource.match(/<SectionBoundary name="store-/g) ?? []).toHaveLength(14);
  });
});
