/**
 * trend-radar-outside-heat — C-30 source-contract pins.
 *
 * The "Heating up outside" section (YouTube's most-popular music
 * chart, served as the trend feed's additive `outsideHeat` block)
 * must:
 *  - exist ONLY when the API sent real chart rows — dormant (null)
 *    renders nothing: no placeholder, no error, no empty shell;
 *  - keep YouTube's name on the section AND on every card's numbers
 *    (the views line is YouTube's count, labeled as YouTube's);
 *  - click through to the video on YouTube in a new tab;
 *  - never leak into the on-site lanes (their rows, pace text and
 *    the honest note are untouched by the outside family);
 *  - carry its copy in all 10 catalogs. The 9 non-English value sets
 *    are agent-drafted and UNREVIEWED (standing practice — English
 *    is final; this is not money copy).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const radar = read("../components/TrendRadar.tsx");
/* Stack300 item 107 moved the fetch seam into the shared strict
   parser (lib/world/trends-radar) — the dormancy mechanism lives
   there now; the contract below pins it at its new home with the
   same strength. */
const seam = read("./world/trends-radar.ts");

const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
const OUTSIDE_KEYS = ["outsideTitle", "outsideSubtitle", "outsideBadge", "outsideViews", "outsideNote"] as const;

function radarCatalog(locale: string): Record<string, string> {
  const data = JSON.parse(read(`../locales/${locale}.json`)) as {
    trends: { radar: Record<string, string> };
  };
  return data.trends.radar;
}

describe("dormancy — the section exists only when real chart rows arrive", () => {
  it("normalizes an absent/empty outsideHeat to null at the fetch seam", () => {
    /* Item 107: the component routes the body through the shared
       strict parser; the parser keeps only labelable videos and
       an outside family with none left is null — dormant. */
    expect(radar).toContain("trendRadarFeedOf(");
    expect(seam).toContain("function outsideHeatOf(raw: unknown): OutsideHeat | null");
    expect(seam).toContain("if (videos.length === 0) return null;");
  });

  it("gates the whole section on showOutside (videos actually present)", () => {
    expect(radar).toContain("const showOutside = outsideVideos.length > 0;");
    expect(radar).toContain("{showOutside && (");
    expect(radar).toContain('data-testid="trend-radar-outside-heat"');
  });

  it("a dormant outside family never triggers the all-empty message by itself", () => {
    /* allEmpty alone shows the quiet-platform note; allEmpty WITH
       outside heat falls through to the lanes + the outside panel. */
    expect(radar).toContain("allEmpty && !showOutside");
  });
});

describe("label honesty — YouTube's numbers wear YouTube's name", () => {
  it("renders the section heading, badge, subtitle and honesty note from the catalog", () => {
    for (const key of OUTSIDE_KEYS) {
      expect(radar).toContain(`t("trends.radar.${key}"`);
    }
  });

  it("every card's view count is labeled as a YouTube count", () => {
    expect(radar).toContain('t("trends.radar.outsideViews", { count: formatOutsideViews(v.viewCount) })');
    expect(radarCatalog("en").outsideViews).toContain("on YouTube");
  });

  it("cards click through to the video on YouTube, in a new tab", () => {
    expect(radar).toContain("href={v.url}");
    expect(radar).toContain('target="_blank"');
    expect(radar).toContain('rel="noreferrer"');
  });

  it("the outside family never enters the on-site lanes", () => {
    /* The on-site families render from feed.sounds/topics/formats
       with paceText; the outside block is a separate map over
       outsideVideos placed AFTER the honest note. */
    const honestNoteAt = radar.indexOf('t("trends.radar.honestNote")');
    const outsideAt = radar.indexOf('data-testid="trend-radar-outside-heat"');
    expect(honestNoteAt).toBeGreaterThan(0);
    expect(outsideAt).toBeGreaterThan(honestNoteAt);
    expect(radar).not.toContain("paceText(v.");
    /* No create-into-Create link is built from a YouTube row. */
    expect(radar).not.toContain("createLink: v.");
  });
});

describe("catalogs — all 10 carry the outside copy", () => {
  it("every key resolves to a non-empty string in every catalog", () => {
    for (const locale of LOCALES) {
      const cat = radarCatalog(locale);
      for (const key of OUTSIDE_KEYS) {
        expect(typeof cat[key] === "string" && cat[key]!.trim() !== "", `${locale}: trends.radar.${key}`).toBe(true);
      }
    }
  });

  it("outsideViews keeps its {{count}} interpolation in every catalog", () => {
    for (const locale of LOCALES) {
      expect(radarCatalog(locale).outsideViews, locale).toContain("{{count}}");
    }
  });

  it("the English values name YouTube plainly (title section + note)", () => {
    const en = radarCatalog("en");
    expect(en.outsideBadge).toBe("YouTube");
    expect(en.outsideNote).toContain("YouTube's own");
    expect(en.outsideNote).toContain("never mixes");
    expect(en.outsideSubtitle).toContain("YouTube");
  });
});
