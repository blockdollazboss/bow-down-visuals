import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./async-pool";

describe("mapWithConcurrency (stack300 #70)", () => {
  it("preserves input order even when workers finish out of order", async () => {
    const delays = [40, 5, 25, 1, 15];
    const out = await mapWithConcurrency(delays, 3, async (d, i) => {
      await new Promise((r) => setTimeout(r, d));
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40]);
  });

  it("never runs more than `limit` workers at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(3);
  });

  it("actually parallelizes: 6 slow items at limit 3 beat sequential time", async () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    const started = Date.now();
    await mapWithConcurrency(items, 3, async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    // Sequential would take ~180ms; two waves of three take ~60ms.
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("handles empty input and a limit larger than the input", async () => {
    expect(await mapWithConcurrency([], 3, async (x: number) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (x) => x + 1)).toEqual([2, 3]);
  });

  it("propagates the first rejection like the old sequential loops", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });
});
