/**
 * my-shop-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 37): per-section render-error isolation on /my-shop.
 *
 * The defect: the manager stacked its sections bare — shop details
 * (with the domain manager inside), tracking pixels, POS mode, the
 * products section, reviews, discount codes and analytics — so one
 * section throw (a malformed product row, a starter payload) blanked
 * the whole shop manager.
 *
 * The fix wraps each manager section in its own SectionBoundary.
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./my-shop.tsx");
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

describe("my shop shape — one bad section never blanks the manager", () => {
  it("a failed products section degrades alone; details + analytics still render; App-level copy absent", () => {
    const details = makeBoundary(
      "myshop-details",
      createElement("p", null, "SHOP DETAILS"),
    );
    const products = makeBoundary(
      "myshop-products",
      createElement("p", null, "PRODUCTS SECTION"),
    );
    const analytics = makeBoundary(
      "myshop-analytics",
      createElement("p", null, "ANALYTICS CARD"),
    );
    failWith(products, new Error("product row malformed"));

    const html = [
      renderToStaticMarkup(details.render() as ReactElement),
      renderToStaticMarkup(products.render() as ReactElement),
      renderToStaticMarkup(analytics.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("SHOP DETAILS");
    expect(html).toContain("ANALYTICS CARD");
    expect(html).toContain('data-testid="section-error-myshop-products"');
    expect(html).not.toContain("PRODUCTS SECTION");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("my-shop.tsx — census-37 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(pageSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "myshop-details",
    "myshop-pixels",
    "myshop-pos",
    "myshop-products",
    "myshop-reviews",
    "myshop-discounts",
    "myshop-analytics",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 7 boundary usages", () => {
    expect(pageSource.match(/<SectionBoundary name="myshop-/g) ?? []).toHaveLength(7);
  });
});
