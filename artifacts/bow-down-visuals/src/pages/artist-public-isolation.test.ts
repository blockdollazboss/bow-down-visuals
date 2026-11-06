/**
 * artist-public-isolation.test.ts — Stack-200 hardening wave,
 * section C (census item 32): per-section render-error isolation on
 * the artist public profile (/artist/:slug).
 *
 * The defect: every layout block rendered through the block map and
 * the six trailing sections (KingDuet, SupporterBoard, Tutorials,
 * SponsorCreator, BookArtist, ProfileActions) were bare siblings —
 * each an independent data-fetching section, none bounded. One
 * section throw blanked a creator's entire public storefront for
 * every visitor.
 *
 * The fix wraps each block in a SectionBoundary keyed by block type
 * (the identity badges riding under the masthead ride inside the
 * first block's boundary) and each trailing section in its own.
 * Idiom follows lane D3: real-class composition + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const pageSource = read("./artist-public.tsx");
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

describe("artist profile shape — one bad block never blanks the storefront", () => {
  it("a failed store block degrades alone; the music block, supporters and booking sections still render; App-level copy absent", () => {
    const store = makeBoundary(
      "artist-block-store",
      createElement("p", null, "STORE BLOCK"),
    );
    const music = makeBoundary(
      "artist-block-music",
      createElement("p", null, "MUSIC BLOCK"),
    );
    const book = makeBoundary(
      "artist-book",
      createElement("p", null, "BOOK ARTIST"),
    );
    failWith(store, new Error("store block payload malformed"));

    const html = [
      renderToStaticMarkup(store.render() as ReactElement),
      renderToStaticMarkup(music.render() as ReactElement),
      renderToStaticMarkup(book.render() as ReactElement),
    ].join("\n");

    expect(html).toContain("MUSIC BLOCK");
    expect(html).toContain("BOOK ARTIST");
    expect(html).toContain('data-testid="section-error-artist-block-store"');
    expect(html).not.toContain("STORE BLOCK");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("artist-public.tsx — census-32 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(pageSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it("wraps every layout block in a boundary keyed by block type", () => {
    expect(pageSource).toContain(
      "<SectionBoundary name={`artist-block-${block.type}`}>",
    );
  });

  it.each([
    "artist-king-duet",
    "artist-supporters",
    "artist-tutorials",
    "artist-sponsor",
    "artist-book",
    "artist-actions",
  ])("wraps trailing section %s in its own boundary", (slug) => {
    expect(pageSource).toContain(`<SectionBoundary name="${slug}">`);
  });
});
