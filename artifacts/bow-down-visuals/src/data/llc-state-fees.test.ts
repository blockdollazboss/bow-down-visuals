/**
 * Basic tests for the LLC guide's frontend data + estimator math.
 *
 * Covers: 50-state table integrity, state lookup, registered-agent
 * tiers, and the first-year cost math the estimator displays.
 */
import { describe, it, expect } from "vitest";
import {
  LLC_STATES,
  getLlcState,
  REGISTERED_AGENT_TIERS,
  getAgentTier,
} from "./llc-state-fees";

describe("LLC_STATES", () => {
  it("covers all 50 states with unique codes", () => {
    expect(LLC_STATES).toHaveLength(50);
    expect(new Set(LLC_STATES.map((s) => s.code)).size).toBe(50);
  });

  it("has sane, positive fees for every state", () => {
    for (const s of LLC_STATES) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.filingFee).toBeGreaterThan(0);
      expect(s.ongoingYearly).toBeGreaterThanOrEqual(0);
      expect(s.ongoing.length).toBeGreaterThan(0);
      expect(s.processing.length).toBeGreaterThan(0);
    }
  });

  it("matches the researched 2026 numbers for spot-checked states", () => {
    expect(getLlcState("CA")?.filingFee).toBe(70);
    expect(getLlcState("CA")?.ongoingYearly).toBe(800);
    expect(getLlcState("TX")?.filingFee).toBe(300);
    expect(getLlcState("TX")?.ongoingYearly).toBe(0);
    expect(getLlcState("WY")?.filingFee).toBe(100);
    expect(getLlcState("NM")?.filingFee).toBe(50);
    expect(getLlcState("MA")?.filingFee).toBe(500);
    expect(getLlcState("NV")?.filingFee).toBe(425);
  });
});

describe("getLlcState", () => {
  it("finds states case-insensitively", () => {
    expect(getLlcState("ny")?.name).toBe("New York");
  });

  it("returns undefined for unknown codes", () => {
    expect(getLlcState("XX")).toBeUndefined();
  });
});

describe("registered agent tiers", () => {
  it("offers DIY, budget, and premium tiers", () => {
    expect(REGISTERED_AGENT_TIERS.map((t) => t.key)).toEqual([
      "diy",
      "budget",
      "premium",
    ]);
  });

  it("DIY is free", () => {
    expect(getAgentTier("diy").yearly).toBe(0);
  });

  it("falls back to DIY for unknown keys", () => {
    expect(getAgentTier("nope").key).toBe("diy");
  });
});

describe("estimator math (mirrors the page)", () => {
  function yearOne(stateCode: string, tierKey: string): number {
    const st = getLlcState(stateCode)!;
    return st.filingFee + getAgentTier(tierKey).yearly;
  }

  it("California DIY totals $70 + $800/yr ongoing", () => {
    expect(yearOne("CA", "diy")).toBe(70);
    expect(getLlcState("CA")!.ongoingYearly).toBe(800);
  });

  it("Texas with a budget agent totals $400 year one", () => {
    expect(yearOne("TX", "budget")).toBe(400);
  });

  it("Montana DIY is the cheapest path at $35", () => {
    const cheapest = Math.min(
      ...LLC_STATES.map((s) => s.filingFee + getAgentTier("diy").yearly),
    );
    expect(cheapest).toBe(35);
    expect(getLlcState("MT")?.filingFee).toBe(35);
  });
});
