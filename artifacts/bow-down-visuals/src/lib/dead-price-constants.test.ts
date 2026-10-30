/**
 * dead-price-constants.test.ts — two price constants that no surface
 * spends, displays, or charges through are gone, and stay gone.
 *
 * Grep proof at removal time (whole repo, stack900 lane A3):
 * - clip-maker's cutCostFor + CUT_CREDITS_PER_CLIP: referenced ONLY by
 *   lib/clip-maker.test.ts. There is no /clip-maker page (the brief's
 *   "no page exists" — the surviving clip-maker consumers, e.g.
 *   pages/repurpose.tsx, import formatClipTimestamp /
 *   buildTimestampExport only). Same shape as ANALYZE_CREDITS, removed
 *   2026-10-10 as "dead (zero non-test imports)" in this very file.
 * - distribution's DISTRIBUTION_PACKAGING_CREDITS: referenced ONLY by
 *   lib/distribution.test.ts and a dead alias in pages/distribute.tsx
 *   whose own comment admitted it was "kept for any surface that still
 *   references the legacy flat packaging fee" — no surface did; the
 *   alias itself was never read. No server rail charges a packaging
 *   fee (distribution pricing is the release tiers + the AI cost).
 *
 * These pins hold the names out of the sources so the dead prices
 * cannot creep back in as stale display truth.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readLib(rel: string): string {
  return readFileSync(new URL(`./${rel}`, import.meta.url), "utf8");
}

function readPage(rel: string): string {
  return readFileSync(new URL(`../pages/${rel}`, import.meta.url), "utf8");
}

describe("dead price constants stay removed", () => {
  it("clip-maker no longer carries the unreferenced cut pricing", () => {
    const src = readLib("clip-maker.ts");
    expect(src).not.toContain("cutCostFor");
    expect(src).not.toContain("CUT_CREDITS_PER_CLIP");
  });

  it("clip-maker's live helpers survive", () => {
    const src = readLib("clip-maker.ts");
    expect(src).toContain("export function formatClipTimestamp");
    expect(src).toContain("export function buildTimestampExport");
  });

  it("distribution no longer carries the unreferenced packaging fee", () => {
    const src = readLib("distribution.ts");
    expect(src).not.toContain("DISTRIBUTION_PACKAGING_CREDITS");
    expect(src).toContain("DISTRIBUTION_AI_CREDIT_COST");
  });

  it("the distribute page no longer imports the dead packaging alias", () => {
    const src = readPage("distribute.tsx");
    expect(src).not.toContain("PACKAGING_CREDITS");
  });
});
