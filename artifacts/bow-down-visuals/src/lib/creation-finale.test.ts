/**
 * creation-finale.test.ts — org wave #2, rank 6a.
 *
 * Pins the Get Paid finale wiring: every creation surface in the
 * registry renders the CreationFinale, the publish door speaks the
 * /publish deep-link protocol publish.tsx consumes (?from= must be a
 * local path, fromLabel names the surface, type pre-selects the
 * media kind), and the finale's four doors are the money chain
 * (publish → store pricing → promote → earnings). Also pins the
 * publish success panel closing in the player-side GetPaidFinale.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREATION_FINALE_SURFACES,
  buildCreationPublishHref,
  creationFinaleSteps,
  creationSurface,
} from "./creation-finale";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** Surface id → the file that must render its finale, and how. */
const SURFACE_FILES: Record<string, { file: string; needle: string }> = {
  create: { file: "../pages/create.tsx", needle: '<CreationFinale surfaceId="create" />' },
  "video-editor": { file: "../components/editor/sections/ExportSection.tsx", needle: 'label: "Video Editor"' },
  "audio-studio": { file: "../pages/audio-studio.tsx", needle: '<CreationFinale surfaceId="audio-studio" />' },
  "thumbnail-studio": { file: "../pages/thumbnail-studio.tsx", needle: '<CreationFinale surfaceId="thumbnail-studio" />' },
  "carousel-maker": { file: "../pages/carousel-maker.tsx", needle: '<CreationFinale surfaceId="carousel-maker" />' },
  books: { file: "../pages/books.tsx", needle: '<CreationFinale surfaceId="books" />' },
  movies: { file: "../pages/movies.tsx", needle: '<CreationFinale surfaceId="movies" />' },
  hooks: { file: "../pages/hooks.tsx", needle: '<CreationFinale surfaceId="hooks" />' },
  "go-live": { file: "../pages/go-live.tsx", needle: '<CreationFinale surfaceId="go-live" />' },
};

describe("the creation-surface registry", () => {
  it("covers every editor/studio desk in the rank-6 census", () => {
    expect(CREATION_FINALE_SURFACES.map((s) => s.id).sort()).toEqual(
      Object.keys(SURFACE_FILES).sort(),
    );
  });

  it("every surface path is a local route (publish's `from` protocol rejects anything else)", () => {
    for (const s of CREATION_FINALE_SURFACES) {
      expect(s.path.startsWith("/")).toBe(true);
      expect(s.path.startsWith("//")).toBe(false);
    }
  });
});

describe("the pre-wired publish door", () => {
  it("carries from, fromLabel and the surface's media type", () => {
    const href = buildCreationPublishHref(creationSurface("video-editor"));
    const params = new URLSearchParams(href.slice("/publish?".length));
    expect(href.startsWith("/publish?")).toBe(true);
    expect(params.get("from")).toBe("/video-editor");
    expect(params.get("fromLabel")).toBe("Video Editor");
    expect(params.get("type")).toBe("video");
  });

  it("omits type for surfaces with no single media kind", () => {
    const href = buildCreationPublishHref(creationSurface("books"));
    const params = new URLSearchParams(href.slice("/publish?".length));
    expect(params.get("from")).toBe("/books");
    expect(params.get("type")).toBeNull();
  });
});

describe("the finale's four doors", () => {
  it("walks the money chain in order: publish → price → promote → earn", () => {
    const steps = creationFinaleSteps(creationSurface("audio-studio"));
    expect(steps.map((s) => s.key)).toEqual(["publish", "price", "promote", "earn"]);
    expect(steps[0]!.href).toContain("/publish?");
    expect(steps[1]!.href).toBe("/store/dashboard?view=digital");
    expect(steps[2]!.href).toBe("/promote");
    expect(steps[3]!.href).toBe("/earnings");
  });
});

describe("finale reachability — one pin per surface", () => {
  for (const [id, pin] of Object.entries(SURFACE_FILES)) {
    it(`${id} renders the CreationFinale`, () => {
      const src = read(pin.file);
      expect(src).toContain("CreationFinale");
      expect(src).toContain(pin.needle);
    });
  }

  it("the component itself renders all four chain doors from the seam", () => {
    const src = read("../components/player/CreationFinale.tsx");
    expect(src).toContain("creationFinaleSteps");
    expect(src).toContain('data-testid="creation-finale"');
    // Both themes are designed, not remapped accidents.
    expect(src).toContain("useIsLightTheme");
  });

  it("the publish success panel closes in the GetPaidFinale", () => {
    const src = read("../pages/publish.tsx");
    expect(src).toContain('import { GetPaidFinale } from "@/components/player/GetPaidFinale"');
    expect(src).toContain("<GetPaidFinale");
    expect(src).toContain("publishedItem.title");
  });
});
