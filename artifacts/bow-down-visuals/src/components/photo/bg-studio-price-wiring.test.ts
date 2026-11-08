/**
 * bg-studio-price-wiring.test.ts — Stack 400 lane 1 pins (A-01 + A-07
 * for the BgStudio surface, A-02 + A-03 copy truth).
 *
 * A-07: BgStudio used to carry two twice-typed price constants
 * (REMOVE_COST = 200, BACKDROP_COST = 100) hand-mirroring the registry.
 * Both now derive from the FE credit registry (credit-costs.ts) via
 * getCreditCost — the same entries the confirmation dialog itself
 * prices from — with the rail-truth figures as ?? fallbacks (the house
 * pattern, cf. PostDealPanel). These pins hold displayed cost ==
 * registry for the surface so the constants can never drift again.
 *
 * A-01: the backdrop panel rendered bgStudio.priceTbdNote — "Draft
 * price — not final" — under a Generate button whose 100 VB charge is
 * final and ratified (owner ruling 2026-11-07). The note is retired:
 * the key is dead in all 10 catalogs, and the panel keeps only the
 * truthful free-colors line (bgStudio.freeColorsNote).
 *
 * A-02 / A-03 (money-copy lane treatment): the homepage Distribute
 * step and the Analytics Hub description/hero strings are carried
 * English-source-verbatim in every catalog (never agent-translated;
 * non-en values are UNREVIEWED English by design). The pins below hold
 * the verbatim carriage and the honest claims.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, getCreditCost } from "../../lib/credit-costs";

const SRC = new URL("../../", import.meta.url).pathname;
const studio = readFileSync(new URL("./BgStudio.tsx", import.meta.url), "utf8");

const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
type Json = Record<string, unknown>;
const catalog = (l: string): Json =>
  JSON.parse(readFileSync(join(SRC, "locales", `${l}.json`), "utf8")) as Json;
const dig = (o: Json, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc as Json)?.[k], o);

describe("BgStudio prices — displayed == registry (A-07)", () => {
  it("the registry records the ratified backdrop cost, 100", () => {
    expect(CREDIT_COSTS["/api/photo-backdrop"]?.cost).toBe(100);
    expect(getCreditCost("/api/photo-backdrop")?.cost).toBe(100);
  });

  it("the registry records the background-removal cost, 200", () => {
    expect(CREDIT_COSTS["/api/remove-background"]?.cost).toBe(200);
    expect(getCreditCost("/api/remove-background")?.cost).toBe(200);
  });

  it("BgStudio derives both costs from the registry, not typed copies", () => {
    expect(studio).toContain('import { getCreditCost } from "@/lib/credit-costs";');
    expect(studio).toContain(
      'const BACKDROP_COST = getCreditCost("/api/photo-backdrop")?.cost ?? 100;',
    );
    expect(studio).toContain(
      'const REMOVE_COST = getCreditCost("/api/remove-background")?.cost ?? 200;',
    );
    expect(studio).not.toContain("const BACKDROP_COST = 100");
    expect(studio).not.toContain("const REMOVE_COST = 200");
  });

  it("the displayed badge and the confirm charge both ride BACKDROP_COST", () => {
    expect(studio).toContain("<CostBadge cost={BACKDROP_COST}");
    expect(studio).toContain("overrideCost: BACKDROP_COST,");
  });
});

describe("A-01 — the draft-price note is retired everywhere", () => {
  it("BgStudio no longer renders the TBD note or its wording", () => {
    expect(studio).not.toContain("priceTbdNote");
    expect(studio).not.toContain("Draft price");
    expect(studio).toContain('t("bgStudio.freeColorsNote"');
  });

  it("bgStudio.priceTbdNote is dead in all 10 catalogs (dead-key retirement check)", () => {
    for (const l of LOCALES) {
      const raw = readFileSync(join(SRC, "locales", `${l}.json`), "utf8");
      expect(raw.includes("priceTbdNote"), `${l}: priceTbdNote retired`).toBe(false);
    }
  });

  it("the free-colors line is carried English-verbatim in all 10 catalogs", () => {
    const en = dig(catalog("en"), "bgStudio.freeColorsNote");
    expect(en).toBe("Free colors and gradients never cost anything.");
    for (const l of LOCALES) {
      expect(dig(catalog(l), "bgStudio.freeColorsNote"), l).toBe(en);
    }
  });
});

describe("A-02 — homepage Distribute step tells the truth, verbatim ×10", () => {
  it("en no longer calls distribution 'coming soon' and names the one unbuyable plan", () => {
    const body = dig(catalog("en"), "home.bizPipeline") as { body: string }[];
    const dist = body[1]!.body;
    expect(dist).not.toContain("coming soon");
    expect(dist).toContain("live now, priced per release");
    expect(dist).toContain("Distribute Unlimited plan ($399/yr)");
  });

  it("every catalog carries the en Distribute body verbatim (money copy, UNREVIEWED)", () => {
    const en = (dig(catalog("en"), "home.bizPipeline") as { body: string }[])[1]!.body;
    for (const l of LOCALES) {
      const body = (dig(catalog(l), "home.bizPipeline") as { body: string }[])[1]!.body;
      expect(body, l).toBe(en);
    }
  });
});

describe("A-03 — Analytics Hub copy matches the manual/CSV intake, verbatim ×10", () => {
  it("en description + hero name the real intake and keep the {{cost}} price line", () => {
    const desc = dig(catalog("en"), "analyticsHub.pageDescription") as string;
    const hero = dig(catalog("en"), "analyticsHub.heroSubtitle") as string;
    expect(desc).toContain("entered by you or imported from a CSV");
    expect(desc).not.toContain("Track TikTok, Instagram, YouTube, and X in one dashboard");
    expect(hero).toContain("platform connections are coming soon");
    expect(hero).toContain("{{cost}} Visual Bucs");
  });

  it("every catalog carries both en strings verbatim (money copy, UNREVIEWED)", () => {
    for (const key of ["analyticsHub.pageDescription", "analyticsHub.heroSubtitle"]) {
      const en = dig(catalog("en"), key);
      for (const l of LOCALES) {
        expect(dig(catalog(l), key), `${l}: ${key}`).toBe(en);
      }
    }
  });
});
