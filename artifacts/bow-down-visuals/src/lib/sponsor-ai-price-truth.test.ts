/**
 * sponsor-ai-price-truth.test.ts — the sponsor AI assists (deal matcher +
 * pitch writer) display the same 100 Visual Bucs the rail charges.
 *
 * Owner ruling Oct 29, 2026: the AI deal matcher aligns to 100 VB like its
 * sibling AI actions (Post Assist, Auto-Grade, bio generator, camera
 * planner — all 100). The rail (SPONSOR_AI_CREDIT_COST, env-overridable)
 * already defaulted to 100; the pre-×100 "1" survived in the two client
 * display constants (MATCHER_COST on brand-deals, AI_COST on
 * sponsor-deal-detail — the pitch writer shares the matcher's rail
 * constant) and in the en unit strings, so the buttons quoted 1 while the
 * rail charged 100. These pins re-derive the rail constant from the server
 * source and hold the registry, both display constants, and the en copy
 * to it, so display and charge cannot drift apart silently again.
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

/** Re-derive a server cost constant from source — the source-derivation
 *  approach of honesty-copy-prices.test.ts. Handles both shapes this
 *  codebase uses: a plain literal (`= 100`) and an env-default
 *  (`= Number(process.env["X"]) || 100`, possibly wrapped over two lines). */
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

describe("sponsor AI assists — charged == displayed == 100", () => {
  it("the rail charges 100 (SPONSOR_AI_CREDIT_COST default)", () => {
    expect(deriveServerConstant("routes/generate/sponsors.ts", "SPONSOR_AI_CREDIT_COST")).toBe(100);
  });

  it("the registry quotes 100 for both AI endpoints", () => {
    expect(CREDIT_COSTS["/api/sponsors/match"]?.cost).toBe(100);
    expect(getCreditCost("/api/sponsors/match")?.cost).toBe(100);
    expect(CREDIT_COSTS["/api/sponsors/pitch"]?.cost).toBe(100);
    expect(getCreditCost("/api/sponsors/pitch")?.cost).toBe(100);
  });

  it("the matcher button displays the rail charge (MATCHER_COST)", () => {
    expect(derivePageConstant("brand-deals.tsx", "MATCHER_COST")).toBe(100);
  });

  it("the pitch-writer button displays the rail charge (AI_COST)", () => {
    expect(derivePageConstant("sponsor-deal-detail.tsx", "AI_COST")).toBe(100);
  });

  it("en copy pluralizes the unit at 100", () => {
    const en = readLocale("en");
    expect(en.sponsors.findMatchesButton).toBe("Find my matches · {{cost}} credits");
    expect(en.sponsors.matcherEyebrow).toBe("Deal matcher · {{cost}} Visual Bucs");
    expect(en.sponsorDealDetail.aiPitchWriter).toBe("Pitch writer · {{count}} credits");
  });

  it("every catalog interpolates the cost — no hardcoded numeral can go stale", () => {
    for (const code of ["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const loc = readLocale(code);
      expect(loc.sponsors.findMatchesButton, code).toContain("{{cost}}");
      expect(loc.sponsors.matcherEyebrow, code).toContain("{{cost}}");
      expect(loc.sponsorDealDetail.aiPitchWriter, code).toContain("{{count}}");
    }
  });
});
