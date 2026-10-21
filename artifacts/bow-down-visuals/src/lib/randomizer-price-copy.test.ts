/**
 * randomizer-price-copy.test.ts — the Randomizer hero prose must agree
 * with the rail's real price.
 *
 * The rail charges 100 Visual Bucs (routes/generate/randomizer.ts
 * RANDOMIZER_CREDITS; the priced registry carries the same figure for
 * /api/randomizer). The hero copy in every locale catalog still quoted
 * the stale pre-x100 "a single Visual Buc" — the page (hooks.tsx)
 * renders randomizer.hero live, so the displayed price disagreed with
 * the charge. Same rule as the Post Assist ruling: the charge site and
 * every copied/displayed price must agree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "./credit-costs";

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

type Catalog = { randomizer?: { hero?: string } };

function readLocale(code: string): Catalog {
  const url = new URL(`../locales/${code}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Catalog;
}

describe("randomizer hero copy names the rail's real price in every locale", () => {
  const railPrice = CREDIT_COSTS["/api/randomizer"]?.cost;

  it("the registry carries the Randomizer at 100 Visual Bucs", () => {
    expect(railPrice).toBe(100);
  });

  for (const code of LOCALES) {
    it(`${code}: randomizer.hero says 100 Visual Bucs, never the stale single-Buc price`, () => {
      const hero = readLocale(code).randomizer?.hero ?? "";
      expect(hero).toContain(`${railPrice} Visual Bucs`);
      expect(hero).not.toMatch(/single Visual Buc/i);
    });
  }
});
