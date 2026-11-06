/**
 * library-isolation.test.ts — Stack-200 hardening wave, section C
 * (census item 40): per-panel render-error isolation on /library.
 *
 * The defect: seven tab panels (templates, presets, fonts,
 * wishlist, saved, feature orders, purchases), the recently-used
 * strip and the gifts strip all rendered bare in one tree — one
 * panel's throw (a malformed catalog row, a bad panel payload)
 * replaced the entire Library, tab bar included.
 *
 * The fix wraps each tab panel and strip in its own
 * SectionBoundary. Idiom follows lane D3: real-class composition +
 * source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./library.tsx");
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

describe("library shape — one bad panel never blanks the Library", () => {
  it("a failed templates panel degrades alone; gifts + purchases still render; App-level copy absent", () => {
    const gifts = makeBoundary(
      "library-gifts",
      createElement("p", null, "GIFTS STRIP"),
    );
    const templates = makeBoundary(
      "library-tab-templates",
      createElement("p", null, "TEMPLATES PANEL"),
    );
    const purchases = makeBoundary(
      "library-tab-purchases",
      createElement("p", null, "PURCHASES PANEL"),
    );
    failWith(templates, new Error("template row malformed"));

    const html = [
      renderToStaticMarkup(gifts.render() as ReactElement),
      renderToStaticMarkup(templates.render() as ReactElement),
      renderToStaticMarkup(purchases.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("GIFTS STRIP");
    expect(html).toContain("PURCHASES PANEL");
    expect(html).toContain('data-testid="section-error-library-tab-templates"');
    expect(html).not.toContain("TEMPLATES PANEL");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("library.tsx — census-40 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(pageSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "library-gifts",
    "library-recent",
    "library-tab-templates",
    "library-tab-presets",
    "library-tab-fonts",
    "library-tab-wishlist",
    "library-tab-saved",
    "library-tab-features",
    "library-tab-purchases",
  ])("wraps panel %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("carries exactly 9 boundary usages", () => {
    expect(pageSource.match(/<SectionBoundary name="library-/g) ?? []).toHaveLength(9);
  });
});
