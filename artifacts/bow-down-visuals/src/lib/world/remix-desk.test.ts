/**
 * remix-desk — stack200 world parity lane B1, census item 2
 * pins. The Remix Trends desk renders the page's OWN catalog
 * (imported, never copied) with the page's own filter/sort,
 * and its one action must be an honest handoff: the payload a
 * card sends reproduces the preset's OWN 2D deep link exactly
 * (the step-through seed equals the page's query string),
 * carried by the channel kind that speaks that param; the
 * channel parses remix-preset ONLY for the editor station;
 * and the editor's remix reader consumes the seeded router
 * search, not just window.location — inside the palace there
 * is no real URL.
 *
 * TRANSLATION STATUS: the desk's framing (worldRemixDesk.*)
 * is en-source; the other nine catalogs carry the English
 * VERBATIM, flagged UNREVIEWED here and in the components
 * pin. Preset names/descriptions are catalog DATA (the
 * TREND_NICHES precedent), not extracted copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TRENDING_PRESETS, getTrendingPreset } from "@/data/trending-presets";
import {
  REMIX_CATEGORIES,
  REMIX_EDITOR_STATION_ID,
  remixParamFor,
  remixPayloadFor,
  remixPresetsFor,
  remixSeedFor,
} from "./remix-desk";
import {
  parsePanelPayloadFor,
  remixPresetPayload,
} from "./panel-payload";
import { editorStepthroughSearch } from "./station-panel";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("the feed — the page's catalog, the page's order", () => {
  it("imports the catalog module — the seam holds no copy of the list", () => {
    const seam = read("./remix-desk.ts");
    expect(seam).toContain('from "@/data/trending-presets"');
    expect(seam).not.toContain("bullet-time-hero");
  });

  it("categories are the page's five; All shows every preset, hottest first", () => {
    expect(REMIX_CATEGORIES).toEqual(["All", "Motion", "Style", "Transition", "Effect"]);
    const all = remixPresetsFor("All");
    expect(all).toHaveLength(TRENDING_PRESETS.length);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.trendScore).toBeGreaterThanOrEqual(all[i]!.trendScore);
    }
    /* The catalog module's own order is never mutated. */
    expect(TRENDING_PRESETS[0]!.slug).toBe("bullet-time-hero");
  });

  it("a category filter keeps only that category, still hottest first", () => {
    for (const cat of ["Motion", "Style", "Transition", "Effect"] as const) {
      const list = remixPresetsFor(cat);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((p) => p.category === cat)).toBe(true);
    }
  });
});

describe("the handoff — each preset's OWN deep link, exactly", () => {
  it("every catalog preset carries exactly one param, and the seed reproduces its 2D query", () => {
    for (const preset of TRENDING_PRESETS) {
      const entries = Object.entries(preset.remixParams);
      expect(entries, preset.slug).toHaveLength(1);
      const seed = remixSeedFor(preset);
      expect(seed, preset.slug).not.toBeNull();
      const expected = new URLSearchParams(preset.remixParams).toString();
      expect(editorStepthroughSearch(null, seed), preset.slug).toBe(expected);
    }
  });

  it("fx and transition presets ride the library-preset kind; remix presets ride remix-preset", () => {
    const fx = getTrendingPreset("gold-luxury-grade")!;
    expect(remixPayloadFor(fx)).toEqual({ kind: "library-preset", param: "fx", slug: "fx-gold-hour" });
    const tr = getTrendingPreset("match-cut-snap")!;
    expect(remixPayloadFor(tr)).toEqual({ kind: "library-preset", param: "transition", slug: "tr-morph-zoom" });
    const motion = getTrendingPreset("bullet-time-hero")!;
    expect(remixPayloadFor(motion)).toEqual({ kind: "remix-preset", slug: "bullet-time-hero" });
    expect(remixParamFor(motion)).toEqual({ param: "remix", slug: "bullet-time-hero" });
  });
});

describe("the channel — remix-preset speaks only to the editor", () => {
  it("parses for visual-vibes-editor and nowhere else", () => {
    expect(parsePanelPayloadFor(REMIX_EDITOR_STATION_ID, remixPresetPayload("bullet-time-hero"))).toEqual({
      kind: "remix-preset",
      slug: "bullet-time-hero",
    });
    for (const other of ["hook-desk", "thumbnail-desk", "video-desk", "song-desk"]) {
      expect(parsePanelPayloadFor(other, remixPresetPayload("bullet-time-hero"))).toBeNull();
    }
  });

  it("shape drift parses to null — the desk opens blank, never guessed", () => {
    expect(parsePanelPayloadFor(REMIX_EDITOR_STATION_ID, { kind: "remix-preset" })).toBeNull();
    expect(parsePanelPayloadFor(REMIX_EDITOR_STATION_ID, { kind: "remix-preset", slug: "  " })).toBeNull();
    expect(parsePanelPayloadFor(REMIX_EDITOR_STATION_ID, { kind: "remix-preset", slug: 42 })).toBeNull();
    expect(parsePanelPayloadFor(REMIX_EDITOR_STATION_ID, null)).toBeNull();
  });
});

describe("the editor side — the seeded search is what the reader reads", () => {
  it("StationPanel maps a remix-preset payload to the ?remix= seed", () => {
    const panel = read("../../components/world/StationPanel.tsx");
    expect(panel).toContain('stepPayload?.kind === "remix-preset"');
    expect(panel).toContain('{ param: "remix" as const, slug: stepPayload.slug }');
    expect(panel).toContain('preset?: { param: "fx" | "textstyle" | "transition" | "remix"; slug: string } | null');
  });

  it("the remix reader consumes the router search, window.location as fallback", () => {
    const hook = read("../../hooks/use-remix-deeplink.ts");
    expect(hook).toContain('new URLSearchParams(search).get("remix")');
    expect(hook).toContain('new URLSearchParams(window.location.search).get("remix")');
    const page = read("../../pages/video-editor.tsx");
    expect(page).toContain("useRemixDeeplink({ setSettings, setTab, search })");
  });

  it("the desk's framing copy is en-source, English verbatim UNREVIEWED in the other nine", () => {
    const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    expect(en.worldRemixDesk.title).toBe("Remix Trends");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      expect(readJson(`../../locales/${loc}.json`).worldRemixDesk, loc).toEqual(en.worldRemixDesk);
    }
  });
});
