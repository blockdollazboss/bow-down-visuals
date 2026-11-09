/**
 * money-pages-isolation.test.ts — Stack 400 wave, census C-26:
 * the money/store pages (creator-pricing, shop, storefront-product,
 * website-builder, my-projects, pitch-fix) carried ZERO
 * SectionBoundary wraps, so one money-bearing section's render throw
 * reached the App-level RouteErrorBoundary and replaced the whole
 * page — pricing, checkout, cart and all.
 *
 * Each independent section/panel of the six pages now renders inside
 * the house SectionBoundary (section variant for panels, compact for
 * items inside lists), following the dashboard/editor pattern: a
 * throwing section degrades to its own contained fallback while every
 * sibling keeps rendering.
 *
 * Idiom follows the editor/earnings isolation suites: real-class
 * compositions + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const creatorPricingSource = read("./creator-pricing.tsx");
const shopSource = read("./shop.tsx");
const storefrontProductSource = read("./storefront-product.tsx");
const websiteBuilderSource = read("./website-builder.tsx");
const myProjectsSource = read("./my-projects.tsx");
const pitchFixSource = read("./pitch-fix.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
  retryLabel: "Try again",
};

function makeBoundary(
  name: string,
  variant: "section" | "compact" | "silent",
  child: ReactElement,
) {
  return new SectionBoundaryCore({
    name,
    variant,
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

/* The server renderer escapes apostrophes in text (&#x27;) — decode
   before copy assertions so the pins read as the copy reads. */
const unescapeHtml = (html: string) => html.replace(/&#x27;/g, "'");

describe("money pages — one bad section never takes the page down", () => {
  it("a throwing checkout panel degrades alone; the price box and reviews keep rendering", () => {
    const price = makeBoundary(
      "storefront-product-price",
      "section",
      createElement("p", null, "YOUR PRICE BOX"),
    );
    const checkout = makeBoundary(
      "shop-checkout",
      "section",
      createElement("p", null, "CHECKOUT FORM"),
    );
    const reviews = makeBoundary(
      "storefront-product-reviews",
      "section",
      createElement("p", null, "VERIFIED REVIEWS"),
    );
    failWith(checkout, new Error("malformed checkout session"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(price.render() as ReactElement),
        renderToStaticMarkup(checkout.render() as ReactElement),
        renderToStaticMarkup(reviews.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("YOUR PRICE BOX");
    expect(html).toContain("VERIFIED REVIEWS");
    expect(html).not.toContain("CHECKOUT FORM");
    expect(html).toContain('data-testid="section-error-shop-checkout"');
    expect(html).toContain("This section hit a snag");
  });

  it("a throwing card degrades to the compact row; its sibling cards survive", () => {
    const bad = makeBoundary(
      "my-projects-project-card",
      "compact",
      createElement("p", null, "MALFORMED PROJECT CARD"),
    );
    const good = makeBoundary(
      "shop-product-card",
      "compact",
      createElement("p", null, "HEALTHY PRODUCT CARD"),
    );
    failWith(bad, new Error("unparseable project record"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(good.render() as ReactElement),
        renderToStaticMarkup(bad.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("HEALTHY PRODUCT CARD");
    expect(html).not.toContain("MALFORMED PROJECT CARD");
    expect(html).toContain(
      'data-testid="section-error-my-projects-project-card"',
    );
  });

  it("a throwing tab body degrades alone; the other tabs' content is untouched", () => {
    const projectsTab = makeBoundary(
      "my-projects-tab-projects",
      "section",
      createElement("p", null, "PROJECTS TAB BODY"),
    );
    const pitchBoard = makeBoundary(
      "pitch-fix-pitch-board",
      "section",
      createElement("p", null, "PITCH BOARD"),
    );
    failWith(projectsTab, new Error("corrupt tab payload"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(projectsTab.render() as ReactElement),
        renderToStaticMarkup(pitchBoard.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("PITCH BOARD");
    expect(html).not.toContain("PROJECTS TAB BODY");
    expect(html).toContain(
      'data-testid="section-error-my-projects-tab-projects"',
    );
  });
});

const SOURCES: Array<[string, string]> = [
  ["creator-pricing.tsx", creatorPricingSource],
  ["shop.tsx", shopSource],
  ["storefront-product.tsx", storefrontProductSource],
  ["website-builder.tsx", websiteBuilderSource],
  ["my-projects.tsx", myProjectsSource],
  ["pitch-fix.tsx", pitchFixSource],
];

describe("money pages — C-26 structure (shared pins)", () => {
  it.each(SOURCES)("%s imports the shared SectionBoundary", (_file, source) => {
    expect(source).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each(SOURCES)(
    "%s has balanced open/close boundary tags (no orphan wraps)",
    (_file, source) => {
      const opens = source.match(/<SectionBoundary[\s>]/g) ?? [];
      const closes = source.match(/<\/SectionBoundary>/g) ?? [];
      expect(opens.length).toBeGreaterThan(0);
      expect(opens.length).toBe(closes.length);
    },
  );
});

describe("creator-pricing.tsx — C-26 structure (source pins)", () => {
  it.each([
    "creator-pricing-hero",
    "creator-pricing-proof",
    "creator-pricing-money-math",
    "creator-pricing-gift",
    "creator-pricing-hosting",
    "creator-pricing-change-confirm",
    "creator-pricing-checkout",
    "creator-pricing-stars",
    "creator-pricing-features",
    "creator-pricing-faq",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(creatorPricingSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps each tier card in a compact boundary keyed per tier", () => {
    expect(creatorPricingSource).toContain('variant="compact"');
    expect(creatorPricingSource).toContain(
      "name={`creator-pricing-tier-${p.tier}`}",
    );
  });
});

describe("shop.tsx — C-26 structure (source pins)", () => {
  it.each([
    "shop-offer-panel",
    "shop-reviews",
    "shop-checkout",
    "shop-embedded-checkout",
    "shop-order-done",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(shopSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it.each(["shop-product-card", "shop-hero-card", "shop-cart-line"])(
    "wraps list item %s in a compact boundary",
    (slug) => {
      expect(shopSource).toContain(`variant="compact" name="${slug}"`);
    },
  );
});

describe("storefront-product.tsx — C-26 structure (source pins)", () => {
  it.each([
    "storefront-product-drop",
    "storefront-product-price",
    "storefront-product-offer",
    "storefront-product-buy-box",
    "storefront-product-gift",
    "storefront-product-reviews",
    "storefront-product-course",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(storefrontProductSource).toContain(
      `<SectionBoundary name="${slug}">`,
    );
  });
});

describe("website-builder.tsx — C-26 structure (source pins)", () => {
  it.each([
    "website-builder-saved-sites",
    "website-builder-gallery",
    "website-builder-templates",
    "website-builder-brief",
    "website-builder-result",
    "website-builder-edits",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(websiteBuilderSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it.each(["website-builder-saved-card", "website-builder-gallery-card"])(
    "wraps list item %s in a compact boundary",
    (slug) => {
      expect(websiteBuilderSource).toContain(`variant="compact" name="${slug}"`);
    },
  );
});

describe("my-projects.tsx — C-26 structure (source pins)", () => {
  it.each([
    "my-projects-result-modal",
    "my-projects-tab-projects",
    "my-projects-hub-section",
    "my-projects-tab-drafts",
    "my-projects-tab-clips",
    "my-projects-tab-websites",
    "my-projects-tab-history",
    "my-projects-tab-myclips",
    "my-projects-tab-songs",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(myProjectsSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it.each([
    "my-projects-project-card",
    "my-projects-draft-card",
    "my-projects-clip-card",
    "my-projects-website-card",
    "my-projects-history-row",
  ])("wraps list item %s in a compact boundary", (slug) => {
    expect(myProjectsSource).toContain(`variant="compact" name="${slug}"`);
  });

  /* Serialization pin: my-projects.tsx is a three-holder file. This
     lane is FIRST (structure only); the four delete-failure alert()
     call sites belong to the D-44 failure-copy lane that builds on
     this wrapped file — they must still be here, untouched. */
  it("leaves the four D-44 alert() call sites in place for the next lane", () => {
    const alerts = myProjectsSource.match(/alert\(/g) ?? [];
    expect(alerts).toHaveLength(4);
  });
});

describe("pitch-fix.tsx — C-26 structure (source pins)", () => {
  it.each([
    "pitch-fix-pitch-door",
    "pitch-fix-fix-door",
    "pitch-fix-mine",
    "pitch-fix-pitch-board",
    "pitch-fix-fix-board",
    "pitch-fix-shipped",
    "pitch-fix-team-note",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(pitchFixSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it.each(["pitch-fix-pitch-card", "pitch-fix-fix-card"])(
    "wraps list item %s in a compact boundary",
    (slug) => {
      expect(pitchFixSource).toContain(`variant="compact" name="${slug}"`);
    },
  );
});
