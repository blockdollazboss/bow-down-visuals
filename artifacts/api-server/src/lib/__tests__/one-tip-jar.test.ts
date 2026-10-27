import { describe, it, expect } from "vitest";
import {
  canonicalJarUrl,
  jarQrTarget,
  jarTotals,
  mergeJarActivity,
  type JarActivityEntry,
} from "../one-tip-jar";

const entry = (over: Partial<JarActivityEntry>): JarActivityEntry => ({
  door: "tip_page",
  unit: "USD",
  amount: 500,
  fromLabel: "Fan",
  message: null,
  at: "2026-10-27T10:00:00.000Z",
  ...over,
});

describe("one tip jar", () => {
  it("every door points at the one canonical address", () => {
    expect(canonicalJarUrl("sharkking")).toBe("/tips/sharkking");
    expect(jarQrTarget("sharkking")).toBe(canonicalJarUrl("sharkking"));
  });

  it("merges the three doors newest-first and caps the feed", () => {
    const merged = mergeJarActivity([
      entry({ door: "tip_page", at: "2026-10-27T09:00:00.000Z" }),
      entry({ door: "live_stream", unit: "VB", amount: 250, at: "2026-10-27T11:00:00.000Z" }),
      entry({ door: "world_stage", unit: "VB", amount: 100, at: "2026-10-27T10:00:00.000Z" }),
    ]);
    expect(merged.map((e) => e.door)).toEqual(["live_stream", "world_stage", "tip_page"]);
    const capped = mergeJarActivity(
      Array.from({ length: 30 }, (_, i) => entry({ at: `2026-10-27T10:${String(i).padStart(2, "0")}:00.000Z` })),
      5,
    );
    expect(capped.length).toBe(5);
  });

  it("totals keep dollars and Visual Bucs in separate lanes — never summed", () => {
    const totals = jarTotals([
      entry({ door: "tip_page", unit: "USD", amount: 500 }),
      entry({ door: "tip_page", unit: "USD", amount: 1500 }),
      entry({ door: "live_stream", unit: "VB", amount: 250 }),
      entry({ door: "world_stage", unit: "VB", amount: 1000 }),
    ]);
    expect(totals.usdCentsPaid).toBe(2000);
    expect(totals.usdTipsCount).toBe(2);
    expect(totals.vbLive).toBe(250);
    expect(totals.vbStage).toBe(1000);
    expect(totals.vbTotal).toBe(1250);
  });

  it("a mismatched unit on a door counts nowhere (no silent currency mixing)", () => {
    const totals = jarTotals([entry({ door: "live_stream", unit: "USD", amount: 999 })]);
    expect(totals.vbLive).toBe(0);
    expect(totals.usdCentsPaid).toBe(0);
  });
});
