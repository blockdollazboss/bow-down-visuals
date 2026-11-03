/**
 * lip-sync-cost-tier.test.ts — stack1400, owner ruled 2026-11-02.
 *
 * The FE mirror of the server lip-sync duration tier: the spend
 * confirmation must quote the amount the server will actually charge
 * for the clip's real duration — ≤50s → 300 VB, 50–60s → 600 VB,
 * over 60s → 300 VB (existing behaviour). Server source of truth:
 * lipSyncChargeForDurationSec in
 * artifacts/api-server/src/lib/lip-sync-jobs.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getCreditCost, lipSyncCostForDurationSec } from "./credit-costs";

describe("lipSyncCostForDurationSec — FE mirror of the server tier", () => {
  it("≤50s stays 300 VB", () => {
    for (const d of [1, 5, 25, 49.999, 50]) {
      expect(lipSyncCostForDurationSec(d)).toBe(300);
    }
  });

  it("50–60s costs 600 VB", () => {
    for (const d of [50.001, 55, 59.999, 60]) {
      expect(lipSyncCostForDurationSec(d)).toBe(600);
    }
  });

  it("over 60s and invalid durations keep the base price", () => {
    for (const d of [60.001, 120, Number.NaN, undefined, null]) {
      expect(lipSyncCostForDurationSec(d)).toBe(300);
    }
  });

  it("the registry still records the base price the helper tiers from", () => {
    expect(getCreditCost("/api/lip-sync")?.cost).toBe(300);
    expect(getCreditCost("/api/lip-sync/run-all")?.cost).toBe(300);
  });
});

describe("LipSyncSection — confirmations quote the tiered price", () => {
  const src = readFileSync(
    fileURLToPath(
      new URL("../components/editor/sections/LipSyncSection.tsx", import.meta.url),
    ),
    "utf8",
  );

  it("the single-clip call passes the tiered price as overrideCost", () => {
    expect(src).toContain(
      "overrideCost: lipSyncCostForDurationSec(req.sceneEndSec - req.sceneStartSec)",
    );
  });

  it("the batch confirmation sums the tier over each scene's real window", () => {
    expect(src).toContain("lipSyncCostForDurationSec(dur)");
    expect(src).not.toContain("eligible.length * 3");
  });
});
