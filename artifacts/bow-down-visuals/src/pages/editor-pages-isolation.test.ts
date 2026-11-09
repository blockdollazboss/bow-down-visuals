/**
 * editor-pages-isolation.test.ts — Stack 400 wave, census C-25:
 * the editor/creation pages (video-editor, song-and-video,
 * audio-studio, thumbnail-studio) carried ZERO SectionBoundary wraps,
 * so one section's render throw reached the App-level
 * RouteErrorBoundary and replaced the whole editor mid-work.
 *
 * Each independent section/panel of the four pages now renders inside
 * the house SectionBoundary (section variant for panels, compact for
 * items inside the song-and-video result lists), following the
 * dashboard/promote pattern: a throwing section degrades to its own
 * contained fallback while every sibling keeps rendering.
 *
 * Idiom follows the earnings/dashboard isolation suites: real-class
 * compositions + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const videoEditorSource = read("./video-editor.tsx");
const songAndVideoSource = read("./song-and-video.tsx");
const audioStudioSource = read("./audio-studio.tsx");
const thumbnailStudioSource = read("./thumbnail-studio.tsx");

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

describe("editor pages — one bad section never takes the editor down", () => {
  it("a throwing editor panel degrades alone; the stage and sibling panels keep rendering", () => {
    const stage = makeBoundary(
      "video-editor-stage",
      "section",
      createElement("p", null, "MASTER PLAYER"),
    );
    const panel = makeBoundary(
      "video-editor-left-effects",
      "section",
      createElement("p", null, "EFFECTS PANEL"),
    );
    const finale = makeBoundary(
      "audio-studio-finale",
      "section",
      createElement("p", null, "GET PAID FINALE"),
    );
    failWith(panel, new Error("malformed preset record"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(stage.render() as ReactElement),
        renderToStaticMarkup(panel.render() as ReactElement),
        renderToStaticMarkup(finale.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("MASTER PLAYER");
    expect(html).toContain("GET PAID FINALE");
    expect(html).not.toContain("EFFECTS PANEL");
    expect(html).toContain(
      'data-testid="section-error-video-editor-left-effects"',
    );
    expect(html).toContain("This section hit a snag");
  });

  it("a throwing result card degrades to the compact row; its sibling cards survive", () => {
    const bad = makeBoundary(
      "song-and-video-song-section-1",
      "compact",
      createElement("p", null, "MALFORMED SECTION CARD"),
    );
    const good = makeBoundary(
      "song-and-video-song-section-0",
      "compact",
      createElement("p", null, "LYRICS CARD"),
    );
    failWith(bad, new Error("unparseable section"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(good.render() as ReactElement),
        renderToStaticMarkup(bad.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("LYRICS CARD");
    expect(html).not.toContain("MALFORMED SECTION CARD");
    expect(html).toContain(
      'data-testid="section-error-song-and-video-song-section-1"',
    );
  });
});

describe("thumbnail-studio.tsx — C-25 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(thumbnailStudioSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "thumbnail-studio-generate",
    "thumbnail-studio-abtest",
    "thumbnail-studio-enhance",
    "thumbnail-studio-background",
    "thumbnail-studio-editor",
    "thumbnail-studio-library",
    "thumbnail-studio-finale",
    "thumbnail-studio-cover-art",
    "thumbnail-studio-duel",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(thumbnailStudioSource).toContain(
      `<SectionBoundary name="${slug}">`,
    );
  });
});

describe("song-and-video.tsx — C-25 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(songAndVideoSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "song-and-video-simple-intake",
    "song-and-video-step-song-setup",
    "song-and-video-step-artist",
    "song-and-video-step-video",
    "song-and-video-step-review",
    "song-and-video-step-results",
    "song-and-video-results-timeline",
    "song-and-video-results-actions",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(songAndVideoSource).toContain(`<SectionBoundary name="${slug}">`);
  });

  it("wraps each result card in a compact boundary inside the lists", () => {
    expect(songAndVideoSource).toContain(
      "name={`song-and-video-song-section-${i}`} variant=\"compact\"",
    );
    expect(songAndVideoSource).toContain(
      "name={`song-and-video-video-section-${i}`} variant=\"compact\"",
    );
  });
});

describe("audio-studio.tsx — C-25 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(audioStudioSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it.each([
    "audio-studio-arrange",
    "audio-studio-cleanup",
    "audio-studio-deverb",
    "audio-studio-loudness",
    "audio-studio-stems",
    "audio-studio-mix-master",
    "audio-studio-tune",
    "audio-studio-ai-audio",
    "audio-studio-voiceover",
    "audio-studio-podcast",
    "audio-studio-podcast-publish",
    "audio-studio-podcast-transcript",
    "audio-studio-hum",
    "audio-studio-finish",
    "audio-studio-rate-mix",
    "audio-studio-sounds",
    "audio-studio-finale",
    "audio-studio-master-full",
    "audio-studio-master-quick",
    "audio-studio-master-mix",
  ])("wraps panel %s in its own boundary", (slug) => {
    expect(audioStudioSource).toContain(`<SectionBoundary name="${slug}">`);
  });
});

describe("video-editor.tsx — C-25 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(videoEditorSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it("wraps each panel body in a per-tab keyed boundary (tab switch remounts it)", () => {
    expect(videoEditorSource).toContain(
      "name={`video-editor-left-${activeTab}`}",
    );
    expect(videoEditorSource).toContain(
      "name={`video-editor-right-${activeTab}`}",
    );
    const keyed = videoEditorSource.match(/<SectionBoundary key={activeTab}/g) ?? [];
    expect(keyed).toHaveLength(2);
  });

  it.each([
    "video-editor-pro-tools-main",
    "video-editor-pro-tools-keyframes",
    "video-editor-pro-tools-background-replace",
    "video-editor-pro-tools-stabilize",
    "video-editor-pro-tools-speed-ramp",
    "video-editor-export-canvas",
    "video-editor-stage",
    "video-editor-locations-door",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(videoEditorSource).toContain(`<SectionBoundary name="${slug}">`);
  });
});
