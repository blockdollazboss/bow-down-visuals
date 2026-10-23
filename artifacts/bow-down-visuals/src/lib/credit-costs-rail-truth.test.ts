/**
 * credit-costs-rail-truth.test.ts — the displayed registry must equal
 * the charge on the rail.
 *
 * The Stack-25 accuracy audit proved six CREDIT_COSTS entries
 * misrecorded what their rails charge (the pre-spend confirmation and
 * the operator both quote the registry): jewelry STL showed 200
 * against a 400 charge, auto-grade showed 200 against a 1 charge,
 * sample packs showed 100 against a 500 base charge, and the jewelry
 * estimate / music export / preview render showed prices for rails
 * that charge nothing. The price-registry correction moved every
 * DISPLAY to the rail truth — charges never moved — and these pins
 * re-derive both sides from the source files so display and charge
 * cannot drift apart silently again. (The operator-knowledge suite
 * pins the same six from the knowledge base's side.) One follow-up
 * did move a charge, by owner ruling (Oct 22, 2026): auto-grade's
 * rail default went from its pre-x100 leftover of 1 to 100 VB, and
 * its display moved in lockstep — the pin below now holds both
 * sides at 100.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "./credit-costs";
import { DISTRIBUTION_TIERS, tierCredits } from "./distribution";

function readApi(rel: string): string {
  const url = new URL(`../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

/** Independent re-derivation of a server cost constant — plain literal,
    env-overridable default, and nullish-env forms — parsed from the
    named server file itself (mirrors the KB suite's derivation). */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\](?:\\s*\\?\\?\\s*\\d+)?\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1]);
}

describe("CREDIT_COSTS displayed prices equal the rails' charges (Stack-25 six)", () => {
  it("jewelry STL export: registry == JEWELRY_STL_CREDIT_COST (400)", () => {
    const rail = deriveServerConstant("routes/generate/jewelry-pricing.ts", "JEWELRY_STL_CREDIT_COST");
    expect(rail).toBe(400);
    expect(CREDIT_COSTS["/api/jewelry/export-stl"]?.cost).toBe(rail);
  });

  it("auto grade: registry == PRO_TOOLS_AI_CREDITS (100)", () => {
    const rail = deriveServerConstant("routes/generate/pro-tools-ai.ts", "PRO_TOOLS_AI_CREDITS");
    expect(rail).toBe(100);
    expect(CREDIT_COSTS["/api/pro-tools/auto-grade"]?.cost).toBe(rail);
  });

  it("sample pack generate: registry base == SAMPLE_PACK_10_CREDITS (500), tiers 1200 / 2000 on the rail", () => {
    const base = deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_10_CREDITS");
    expect(base).toBe(500);
    expect(deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_25_CREDITS")).toBe(1200);
    expect(deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_50_CREDITS")).toBe(2000);
    expect(CREDIT_COSTS["/api/sample-pack/generate"]?.cost).toBe(base);
  });

  const FREE_RAILS = [
    { endpoint: "/api/jewelry/estimate", file: "routes/generate/jewelry.ts", handler: "/jewelry/estimate" },
    { endpoint: "/api/music/export", file: "routes/music-export.ts", handler: "/music/export" },
    { endpoint: "/api/music/preview-render", file: "routes/music-export.ts", handler: "/music/preview-render" },
  ] as const;

  // Stack-28 item 1 (A2-01): the FE distribution fallback constants are a
  // LIVE display path (initial paint + any pricing-fetch failure, including
  // the pre-spend confirmation). They displayed 10/20/30 while the rail
  // charges 1,000/2,000/3,000 — a 100× understatement. The fallback now
  // equals RELEASE_TIER_CREDITS; the rail never reads the FE constants, so
  // no charge moved. Pin re-derives the rail side from the server source:
  // single falls back to DISTRIBUTION_RELEASE_CREDITS, ep/album are
  // env-overridable literals in RELEASE_TIER_CREDITS.
  it("distribution fallback tiers == RELEASE_TIER_CREDITS (1000/2000/3000)", () => {
    const single = deriveServerConstant("routes/generate/distribution.ts", "DISTRIBUTION_RELEASE_CREDITS");
    expect(single).toBe(1000);
    const src = readApi("routes/generate/distribution.ts");
    const ep = src.match(/ep:\s*Number\(process\.env\[["'][A-Z0-9_]+["']\]\)\s*\|\|\s*(\d+)/);
    const album = src.match(/album:\s*Number\(process\.env\[["'][A-Z0-9_]+["']\]\)\s*\|\|\s*(\d+)/);
    expect(ep, "RELEASE_TIER_CREDITS.ep").toBeTruthy();
    expect(album, "RELEASE_TIER_CREDITS.album").toBeTruthy();
    const rail = { single, ep: Number(ep![1]), album: Number(album![1]) };
    expect(rail).toEqual({ single: 1000, ep: 2000, album: 3000 });
    for (const tier of DISTRIBUTION_TIERS) {
      expect(tier.credits).toBe(rail[tier.type]);
      expect(tierCredits(tier.type)).toBe(rail[tier.type]);
    }
    expect(tierCredits("unknown-type")).toBe(rail.single);
  });

  // Stack-28 item 2 (A2-05): all 13 Export Doctor endpoints were quoted
  // 100–400 VB in the registry (and therefore in the spend confirmation),
  // but routes/generate/export-doctor.ts contains ZERO credit logic —
  // the rails charge nothing. Registry now records 0/free for all 13.
  const EXPORT_DOCTOR_ENDPOINTS = [
    "/api/export-doctor/export",
    "/api/export-doctor/export-all",
    "/api/export-doctor/export-audio",
    "/api/export-doctor/export-all-audio",
    "/api/export-doctor/export-all-captions",
    "/api/export-doctor/export-all-effects",
    "/api/export-doctor/export-all-overlays",
    "/api/export-doctor/export-overlays-range",
    "/api/export-doctor/export-effects-range",
    "/api/export-doctor/export-effects-transitions",
    "/api/export-doctor/export-audio-sync-short",
    "/api/export-doctor/repair-normalize",
    "/api/export-doctor/repair-clip",
  ] as const;

  it("export-doctor rail charges nothing anywhere and registry displays 0 for all 13", () => {
    const src = readApi("routes/generate/export-doctor.ts");
    expect(src).not.toMatch(/chargeCredits\s*\(|deductCredits\s*\(/);
    for (const ep of EXPORT_DOCTOR_ENDPOINTS) {
      expect(CREDIT_COSTS[ep]?.cost, ep).toBe(0);
    }
  });

  for (const spec of FREE_RAILS) {
    it(`${spec.endpoint}: handler charges nothing and the registry displays 0`, () => {
      const src = readApi(spec.file);
      const start = src.indexOf(`router.post("${spec.handler}"`);
      expect(start, `${spec.handler} in ${spec.file}`).toBeGreaterThanOrEqual(0);
      const rest = src.slice(start);
      const next = rest.slice(1).search(/\n\s*router\.(get|post|put|patch|delete)\(/);
      const slice = next < 0 ? rest : rest.slice(0, next + 1);
      expect(slice).not.toMatch(/chargeCredits\s*\(|deductCredits\s*\(/);
      expect(CREDIT_COSTS[spec.endpoint]?.cost).toBe(0);
    });
  }
});
