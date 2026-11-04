/**
 * gamers-prices.test.ts — QC-200 fix queue #5: the Gamers page showed
 * a hero stat of "1 Visual Buc per idea pack" while its Generate
 * button said 100 Visual Bucs. The charging rail is the truth:
 * GAMERS_CREDIT_COST (api-server routes/generate/gamers.ts) defaults
 * to 100, the central registry row for /api/gamers/ideas records 100,
 * and every figure the page displays must be that one number, derived
 * from the registry via lib/gamers-prices — never a page-local literal
 * that can drift again (the wallpapers-prices.test.ts pattern).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, getCreditCost } from "./credit-costs";
import { GAMERS_IDEAS_COST } from "./gamers-prices";

function readApi(rel: string): string {
  const url = new URL(`../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

function readFe(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

/** Re-derive a server constant's default from its API source file. */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[[\"'][A-Z0-9_]+[\"']\\]\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1]);
}

const RAIL_FILE = "routes/generate/gamers.ts";
const railSrc = readApi(RAIL_FILE);
const page = readFe("pages/gamers.tsx");

describe("QC fix #5 — Gamers idea-pack price: display == registry == rail", () => {
  it("the rail charges 100 (GAMERS_CREDIT_COST default, re-derived from API source)", () => {
    expect(deriveServerConstant(RAIL_FILE, "GAMERS_CREDIT_COST")).toBe(100);
  });

  it("the registry row for /api/gamers/ideas records the rail's 100", () => {
    expect(CREDIT_COSTS["/api/gamers/ideas"]?.cost).toBe(100);
    expect(getCreditCost("/api/gamers/ideas")?.cost).toBe(
      deriveServerConstant(RAIL_FILE, "GAMERS_CREDIT_COST"),
    );
  });

  it("the derived display price equals the registry and the rail", () => {
    expect(GAMERS_IDEAS_COST).toBe(100);
    expect(GAMERS_IDEAS_COST).toBe(CREDIT_COSTS["/api/gamers/ideas"]?.cost);
  });

  it("the page renders its price from the derived constant — no page-local price literal", () => {
    expect(page).toContain("GAMERS_IDEAS_COST");
    expect(page).not.toMatch(/const\s+CREDIT_COST\s*=\s*\d+/);
    // pill + generate button + hero stat all quote the one constant
    expect(page.match(/GAMERS_IDEAS_COST/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("the lying hero stat is gone — no '1 Visual Buc per idea pack' anywhere on the page", () => {
    expect(page).not.toContain("Visual Buc per idea pack");
    expect(page).not.toMatch(/\{\s*n:\s*"1",\s*l:\s*"Visual Buc/);
  });

  it("the rail's failure copy no longer claims a single Buc was refunded", () => {
    expect(railSrc).not.toContain("Your Visual Buc was refunded");
  });
});
