/**
 * live-pages-isolation.test.ts — Stack 400 wave, census C-27:
 * the live/social pages (go-live, shorts, live-shopping, publish,
 * shoutouts, songs, my-clips, review, scheduler, tour, live-watch)
 * carried ZERO SectionBoundary wraps, so one section's render throw
 * reached the App-level RouteErrorBoundary and replaced the whole
 * page — a live console, a watch page, or a scheduler mid-work.
 *
 * Each independent section/panel of the eleven pages now renders
 * inside the house SectionBoundary (section variant for panels,
 * compact inside lists, per-tab keyed boundaries where tabs share
 * one body), following the dashboard/promote/editor pattern: a
 * throwing section degrades to its own contained fallback while
 * every sibling keeps rendering.
 *
 * Idiom follows the earnings/dashboard/editor isolation suites:
 * real-class compositions + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const goLiveSource = read("./go-live.tsx");
const reviewSource = read("./review.tsx");
const liveWatchSource = read("./live-watch.tsx");
const shoutoutsSource = read("./shoutouts.tsx");
const tourSource = read("./tour.tsx");
const liveShoppingSource = read("./live-shopping.tsx");
const songsSource = read("./songs.tsx");
const myClipsSource = read("./my-clips.tsx");
const shortsSource = read("./shorts.tsx");
const publishSource = read("./publish.tsx");
const schedulerSource = read("./scheduler.tsx");

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

describe("live pages — one bad section never takes the page down", () => {
  it("a throwing watch-page panel degrades alone; the player and chat keep rendering", () => {
    const player = makeBoundary(
      "live-watch-player",
      "section",
      createElement("p", null, "LIVE PLAYER"),
    );
    const battles = makeBoundary(
      "live-watch-battles",
      "section",
      createElement("p", null, "BATTLES PANEL"),
    );
    const chat = makeBoundary(
      "live-watch-chat",
      "section",
      createElement("p", null, "LIVE CHAT"),
    );
    failWith(battles, new Error("malformed battle record"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(player.render() as ReactElement),
        renderToStaticMarkup(battles.render() as ReactElement),
        renderToStaticMarkup(chat.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("LIVE PLAYER");
    expect(html).toContain("LIVE CHAT");
    expect(html).not.toContain("BATTLES PANEL");
    expect(html).toContain('data-testid="section-error-live-watch-battles"');
    expect(html).toContain("This section hit a snag");
  });

  it("a throwing feed card degrades to the compact row; its sibling cards survive", () => {
    const bad = makeBoundary(
      "shorts-card",
      "compact",
      createElement("p", null, "MALFORMED SHORT"),
    );
    const good = makeBoundary(
      "shorts-card",
      "compact",
      createElement("p", null, "HEALTHY SHORT"),
    );
    failWith(bad, new Error("unparseable short record"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(good.render() as ReactElement),
        renderToStaticMarkup(bad.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("HEALTHY SHORT");
    expect(html).not.toContain("MALFORMED SHORT");
    expect(html).toContain('data-testid="section-error-shorts-card"');
  });
});

describe("go-live.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(goLiveSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "go-live-setup-warning",
    "go-live-announce",
    "go-live-schedule",
    "go-live-recent",
    "go-live-world-entry",
    "go-live-broadcast-studio",
    "go-live-broadcast-channels",
    "go-live-song-requests",
    "go-live-guest-panel",
    "go-live-battles",
    "go-live-ingest-keys",
    "go-live-destination-keys",
    "go-live-loyalty-settings",
    "go-live-stage-rooms",
    "go-live-finale",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(goLiveSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps stream rows in compact boundaries inside the lists", () => {
    expect(goLiveSource).toContain(
      'name="go-live-upcoming-stream" variant="compact"',
    );
    expect(goLiveSource).toContain(
      'name="go-live-recent-stream" variant="compact"',
    );
  });

  it("wraps the tab stage in a per-tab keyed boundary (tab switch remounts it)", () => {
    expect(goLiveSource).toContain("name={`go-live-tab-${tab}`}");
    expect(goLiveSource).toContain("<SectionBoundary key={tab}");
  });
});

describe("review.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(reviewSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "review-brand-bar",
    "review-error",
    "review-locked",
    "review-banner-changes",
    "review-banner-approved",
    "review-creator-controls",
    "review-player",
    "review-comments",
    "review-comment-form",
    "review-footer",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(reviewSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps each comment in a compact boundary inside the list", () => {
    expect(reviewSource).toContain('name="review-comment" variant="compact"');
  });
});

describe("live-watch.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(liveWatchSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "live-watch-player",
    "live-watch-summary",
    "live-watch-reach",
    "live-watch-header",
    "live-watch-on-stage",
    "live-watch-party-table",
    "live-watch-song-requests",
    "live-watch-battles",
    "live-watch-chat",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(liveWatchSource).toContain(`<SectionBoundary name="${slug}">`);
  });
});

describe("shoutouts.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(shoutoutsSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "shoutouts-payments-notice",
    "shoutouts-paid-confirmed",
    "shoutouts-checkout",
    "shoutouts-submitted",
    "shoutouts-request-form",
    "shoutouts-settings",
    "shoutouts-revenue",
    "shoutouts-requests",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(shoutoutsSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps each tab body in a per-tab keyed boundary", () => {
    expect(shoutoutsSource).toContain(
      '<SectionBoundary key="request" name="shoutouts-tab-request">',
    );
    expect(shoutoutsSource).toContain(
      '<SectionBoundary key="creator" name="shoutouts-tab-creator">',
    );
  });

  it("wraps list items in compact boundaries", () => {
    expect(shoutoutsSource).toContain(
      'name="shoutouts-creator-card" variant="compact"',
    );
    expect(shoutoutsSource).toContain(
      'name="shoutouts-request-row" variant="compact"',
    );
  });
});

describe("tour.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(tourSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "tour-hero",
    "tour-sign-in-prompt",
    "tour-composer",
    "tour-date-list",
    "tour-optimizer",
    "tour-plan-routing",
    "tour-plan-budget",
    "tour-promo-checklist",
    "tour-next-steps",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(tourSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps list items in compact boundaries", () => {
    expect(tourSource).toContain('name="tour-date-row" variant="compact"');
    expect(tourSource).toContain('name="tour-promo-city" variant="compact"');
  });
});

describe("live-shopping.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(liveShoppingSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "live-shopping-hero",
    "live-shopping-product-form",
    "live-shopping-overlay-preview",
    "live-shopping-overlay-controls",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(liveShoppingSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps each tab body in a per-tab keyed boundary", () => {
    expect(liveShoppingSource).toContain(
      '<SectionBoundary key="products" name="live-shopping-tab-products">',
    );
    expect(liveShoppingSource).toContain(
      '<SectionBoundary key="overlay" name="live-shopping-tab-overlay">',
    );
    expect(liveShoppingSource).toContain(
      '<SectionBoundary key="dashboard" name="live-shopping-tab-dashboard">',
    );
  });

  it("wraps each product card in a compact boundary inside the grid", () => {
    expect(liveShoppingSource).toContain(
      'name="live-shopping-product-card" variant="compact"',
    );
  });
});

describe("songs.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(songsSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each(["songs-header", "songs-open-verse", "songs-upload"])(
    "wraps section %s in its own boundary",
    (slug) => {
      expect(songsSource).toContain(`<SectionBoundary name="${slug}">`);
    },
  );

  it("wraps each tab body in a per-tab keyed boundary", () => {
    expect(songsSource).toContain(
      '<SectionBoundary key="albums" name="songs-tab-albums">',
    );
    expect(songsSource).toContain(
      '<SectionBoundary key="dj" name="songs-tab-dj">',
    );
    expect(songsSource).toContain(
      '<SectionBoundary key="songs" name="songs-tab-songs">',
    );
  });

  it("wraps each song card in a compact boundary inside the library", () => {
    expect(songsSource).toContain('name="songs-song-card" variant="compact"');
  });
});

describe("my-clips.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(myClipsSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each(["my-clips-header", "my-clips-explainer"])(
    "wraps section %s in its own boundary",
    (slug) => {
      expect(myClipsSource).toContain(`<SectionBoundary name="${slug}">`);
    },
  );

  it("wraps each clip card in a compact boundary inside the grid", () => {
    expect(myClipsSource).toContain(
      'name="my-clips-clip-card" variant="compact"',
    );
  });
});

describe("shorts.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(shortsSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it("wraps the header in its own boundary", () => {
    expect(shortsSource).toContain('<SectionBoundary name="shorts-header">');
  });

  it("wraps each feed card in a compact boundary inside the snap feed", () => {
    expect(shortsSource).toContain('name="shorts-card" variant="compact"');
  });
});

describe("publish.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(publishSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "publish-header",
    "publish-short-intent",
    "publish-profile-status",
    "publish-vertical-picker",
    "publish-media-toggle",
    "publish-dropzone",
    "publish-metadata",
    "publish-actions",
    "publish-success",
    "publish-finale",
    "publish-my-content",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(publishSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps each content row in a compact boundary inside the list", () => {
    expect(publishSource).toContain(
      'name="publish-content-row" variant="compact"',
    );
  });
});

describe("scheduler.tsx — C-27 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(schedulerSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each(["scheduler-hero", "scheduler-accounts-strip", "scheduler-best-time"])(
    "wraps section %s in its own boundary",
    (slug) => {
      expect(schedulerSource).toContain(`<SectionBoundary name="${slug}">`);
    },
  );

  it.each([
    ["calendar", "scheduler-tab-calendar"],
    ["queue", "scheduler-tab-queue"],
    ["drafts", "scheduler-tab-drafts"],
    ["posted", "scheduler-tab-posted"],
    ["community", "scheduler-tab-community"],
    ["trends", "scheduler-tab-trends"],
    ["trend-jacker", "scheduler-tab-trend-jacker"],
    ["vault-drip", "scheduler-tab-vault-drip"],
    ["evergreen", "scheduler-tab-evergreen"],
  ])("wraps tab %s in a per-tab keyed boundary", (key, slug) => {
    expect(schedulerSource).toContain(
      `<SectionBoundary key="${key}" name="${slug}">`,
    );
  });
});
