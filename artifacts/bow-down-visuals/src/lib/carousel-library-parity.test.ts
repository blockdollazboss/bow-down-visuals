/* carousel-library-parity.test.ts — Stack 100 wave 2, item 11 (A10).
 *
 * The defect: Thy Library's carousel shelf carries 20 seeds that
 * deep-link /carousel-maker?template=<slug>, but CAROUSEL_TEMPLATES
 * held only 8 templates and the maker's matcher was a fuzzy prefix
 * chain. 13 seeds (myth-buster, vs-battle, mistakes, tools-roundup,
 * day-in-life, faq-answers, testimonial-wall, beginner-guide,
 * hot-take-thread, checklist, behind-scenes, price-breakdown,
 * mini-course) matched nothing and silently landed on the default
 * template — a customer picked one promised look and got another,
 * with no signal. Same family as the fake cover-art "cinematic" chip.
 *
 * The repaired contract, pinned here:
 *  - every Library seed slug, minus the "carousel-" prefix, IS a real
 *    template id, and resolveCarouselTemplate resolves it exactly;
 *  - the 20 seeds resolve to 20 DISTINCT templates (no sharing, no
 *    silent landing on the default);
 *  - resolution is exact — near-miss and retired slugs return null so
 *    the maker can say so out loud (templateLinkMissed toast) instead
 *    of substituting in silence;
 *  - every template in the registry is reachable: seed-resolved, or
 *    the one maker-native extra (minimal-luxe), and both pickers (the
 *    maker gallery and the World Carousel Desk) render the whole
 *    registry from CAROUSEL_TEMPLATES;
 *  - every template is complete: a real painter, a distinct
 *    composition, and name/desc keys present in all 10 catalogs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAROUSEL_TEMPLATES, resolveCarouselTemplate } from "./carousel-renderer";
import { CAROUSEL_SEEDS, LIBRARY_TEMPLATES } from "../data/library-templates";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const makerSrc = read("../pages/carousel-maker.tsx");
const deskSrc = read("../components/world/native/CarouselDesk.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function carouselMakerBlock(locale: string): Record<string, string> {
  const raw = JSON.parse(read(`../locales/${locale}.json`)) as Record<string, unknown>;
  return raw.carouselMaker as Record<string, string>;
}

const stripPrefix = (slug: string) => slug.replace(/^carousel-/, "");
const PAINTERS = ["gold-glow", "midnight", "split", "framed", "gradient-wash", "bold-band", "paper", "neon-edge"];

describe("every Library carousel seed resolves to a real, distinct template", () => {
  it("the shelf still promises 20 carousels", () => {
    expect(CAROUSEL_SEEDS).toHaveLength(20);
  });

  it("each seed resolves EXACTLY to the template its slug names", () => {
    for (const seed of CAROUSEL_SEEDS) {
      const tpl = resolveCarouselTemplate(seed.slug);
      expect(tpl, seed.slug).not.toBeNull();
      expect(tpl!.id, seed.slug).toBe(stripPrefix(seed.slug));
    }
  });

  it("the 20 seeds land on 20 distinct templates — none silently on the default", () => {
    const ids = CAROUSEL_SEEDS.map((s) => resolveCarouselTemplate(s.slug)!.id);
    expect(new Set(ids).size).toBe(20);
    const onDefault = CAROUSEL_SEEDS.filter(
      (s) => resolveCarouselTemplate(s.slug)!.id === "bold-statement",
    ).map((s) => s.slug);
    expect(onDefault).toEqual(["carousel-bold-statement"]); // only its own seed
  });

  it("the Library cards deep-link the very slugs the resolver is fed", () => {
    const cards = LIBRARY_TEMPLATES.filter((t) => t.category === "Carousels");
    expect(cards).toHaveLength(20);
    for (const seed of CAROUSEL_SEEDS) {
      const card = cards.find((c) => c.slug === seed.slug);
      expect(card, seed.slug).toBeDefined();
      expect(card!.useUrl).toBe(`/carousel-maker?template=${seed.slug}`);
    }
  });
});

describe("resolution is exact — the fuzzy fallback is dead", () => {
  it("near-miss prefixes the old matcher would have caught now resolve to null", () => {
    for (const slug of [
      "carousel-list", "carousel-bold", "carousel-myth", "carousel-stat",
      "carousel-story-arc", "carousel-carousel", "carousel-nope",
    ]) {
      expect(resolveCarouselTemplate(slug), slug).toBeNull();
    }
  });

  it("the retired pre-alignment slugs no longer resolve (they were never template ids)", () => {
    for (const slug of ["carousel-listicle-5", "carousel-tutorial-steps", "carousel-quote-pack", "carousel-stat-drop"]) {
      expect(resolveCarouselTemplate(slug), slug).toBeNull();
    }
  });

  it("empty and missing references resolve to null, bare ids resolve exactly", () => {
    expect(resolveCarouselTemplate(null)).toBeNull();
    expect(resolveCarouselTemplate(undefined)).toBeNull();
    expect(resolveCarouselTemplate("")).toBeNull();
    expect(resolveCarouselTemplate("carousel-")).toBeNull();
    expect(resolveCarouselTemplate("quote")!.id).toBe("quote");
    expect(resolveCarouselTemplate("carousel-quote")!.id).toBe("quote");
  });

  it("the maker resolves through the shared resolver and says so on a miss", () => {
    expect(makerSrc).toContain("resolveCarouselTemplate");
    expect(makerSrc).toContain("carouselMaker.templateLinkMissed");
    expect(makerSrc).not.toContain("startsWith(needle");
    expect(makerSrc).not.toContain("needle.startsWith");
  });
});

describe("every template is reachable and complete", () => {
  it("the registry is the 8 originals + the 13 Library completions", () => {
    expect(CAROUSEL_TEMPLATES).toHaveLength(21);
    expect(new Set(CAROUSEL_TEMPLATES.map((t) => t.id)).size).toBe(21);
    expect(CAROUSEL_TEMPLATES[0]!.id).toBe("bold-statement"); // default unchanged
  });

  it("every template is seed-reachable, except the one maker-native extra", () => {
    const seeded = new Set(CAROUSEL_SEEDS.map((s) => stripPrefix(s.slug)));
    const unseeded = CAROUSEL_TEMPLATES.map((t) => t.id).filter((id) => !seeded.has(id));
    expect(unseeded).toEqual(["minimal-luxe"]);
  });

  it("both pickers render the whole registry — nothing is maker-only by hiding", () => {
    expect(makerSrc).toContain("CAROUSEL_TEMPLATES.map");
    expect(deskSrc).toContain("CAROUSEL_TEMPLATES.map");
  });

  it("each template is a distinct composition on a real painter", () => {
    const compositions = new Set<string>();
    for (const tpl of CAROUSEL_TEMPLATES) {
      expect(PAINTERS, tpl.id).toContain(tpl.bgStyle);
      const key = `${tpl.bgStyle}|${tpl.accent}|${tpl.numberStyle}`;
      expect(compositions.has(key), `${tpl.id} duplicates ${key}`).toBe(false);
      compositions.add(key);
    }
  });

  it("every template's name/desc keys exist, non-empty, in all 10 catalogs", () => {
    for (const locale of LOCALES) {
      const block = carouselMakerBlock(locale);
      for (const tpl of CAROUSEL_TEMPLATES) {
        for (const key of [tpl.nameKey, tpl.descKey]) {
          const leaf = key.replace(/^carouselMaker\./, "");
          expect(typeof block[leaf], `${locale}:${key}`).toBe("string");
          expect(block[leaf]!.length, `${locale}:${key}`).toBeGreaterThan(0);
        }
      }
      expect(block.templateLinkMissed, `${locale}:templateLinkMissed`).toBeTruthy();
    }
  });
});
