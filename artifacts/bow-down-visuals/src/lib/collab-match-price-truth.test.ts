/**
 * collab-match-price-truth.test.ts — the Collab Finder AI match report
 * displays the same 100 Visual Bucs the rail charges.
 *
 * The rail (COLLAB_MATCH_CREDITS in api-server routes/generate/collabs.ts,
 * env COLLAB_MATCH_CREDIT_COST) defaults to 100 and chargeOr402 takes it on
 * every POST /api/collabs/match. The displays never caught up with the ×100
 * repricing: the page carried a dead MATCH_CREDIT_COST = 1 constant that
 * nothing referenced, and both buttons (the match tab's Score button — the
 * charge point — and the browse card's AI Match button) rendered locale
 * strings quoting "1cr". These pins re-derive the rail constant from the
 * server source and hold the registry, the page's display constant, the
 * button wiring, and every locale catalog to it, so display and charge
 * cannot drift apart silently again. Display only — no charge moved.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, getCreditCost } from "./credit-costs";

function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
}

function readPage(rel: string): string {
  return readFileSync(new URL(`../pages/${rel}`, import.meta.url), "utf8");
}

function readLocale(code: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`../locales/${code}.json`, import.meta.url), "utf8"));
}

/** Re-derive a server cost constant from source — same approach as
 *  sponsor-ai-price-truth.test.ts (env-default and plain-literal shapes). */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const envDefault = src.match(
    new RegExp(
      `const\\s+${constant}\\s*=\\s*Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\]\\)\\s*\\|\\|\\s*(\\d+)\\b`,
    ),
  );
  if (envDefault) return Number(envDefault[1]);
  const plain = src.match(
    new RegExp(`const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(\\d+)\\b`),
  );
  expect(plain, `${constant} in ${rel}`).toBeTruthy();
  return Number(plain![1]);
}

function derivePageConstant(rel: string, constant: string): number {
  const src = readPage(rel);
  const m = src.match(new RegExp(`const\\s+${constant}\\s*=\\s*(\\d+)\\b`));
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1]);
}

describe("collab match report — charged == displayed == 100", () => {
  it("the rail charges 100 (COLLAB_MATCH_CREDITS default)", () => {
    expect(deriveServerConstant("routes/generate/collabs.ts", "COLLAB_MATCH_CREDITS")).toBe(100);
  });

  it("the registry quotes 100 for the match endpoint", () => {
    expect(CREDIT_COSTS["/api/collabs/match"]?.cost).toBe(100);
    expect(getCreditCost("/api/collabs/match")?.cost).toBe(100);
  });

  it("the page display constant mirrors the rail (MATCH_CREDIT_COST)", () => {
    expect(derivePageConstant("collabs.tsx", "MATCH_CREDIT_COST")).toBe(100);
  });

  it("both buttons render their price from the shared constant", () => {
    const src = readPage("collabs.tsx");
    expect(src).toContain('t("collabs.scoreBtn", { cost: MATCH_CREDIT_COST })');
    expect(src).toContain('t("collabs.aiMatchBtn", { cost: MATCH_CREDIT_COST })');
  });

  it("en copy interpolates the cost instead of quoting 1cr", () => {
    const en = readLocale("en");
    expect(en.collabs.scoreBtn).toBe("Score · {{cost}} credits");
    expect(en.collabs.aiMatchBtn).toBe("Match · {{cost}} credits");
  });

  it("every catalog interpolates the cost — no hardcoded numeral can go stale", () => {
    for (const code of ["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const loc = readLocale(code);
      expect(loc.collabs.scoreBtn, code).toContain("{{cost}}");
      expect(loc.collabs.aiMatchBtn, code).toContain("{{cost}}");
      expect(loc.collabs.scoreBtn, code).not.toMatch(/1\s?cr\b/);
      expect(loc.collabs.aiMatchBtn, code).not.toMatch(/1\s?cr\b/);
    }
  });
});
