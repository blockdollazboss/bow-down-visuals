import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Stack-28 #55 (A5-M3) — the three clipping tables get overflow-x-auto escapes. */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("table scroll wrappers (Stack-28 #55)", () => {
  it("live-shopping revenue table is wrapped", () => {
    const s = read("../pages/live-shopping.tsx");
    const at = s.indexOf("liveShopping.thStream");
    expect(s.slice(Math.max(0, at - 2500), at)).toContain("overflow-x-auto");
  });
  it("SplitCalculator collaborators table is wrapped", () => {
    const s = read("../components/wave8/SplitCalculator.tsx");
    const at = s.indexOf("wave8.splits.name");
    expect(s.slice(Math.max(0, at - 2500), at)).toContain("overflow-x-auto");
  });
  it("llc-guide fee table container scrolls both ways", () => {
    const s = read("../pages/llc-guide.tsx");
    const at = s.indexOf("llcGuide.thState");
    expect(s.slice(Math.max(0, at - 2500), at)).toContain("overflow-x-auto");
  });
});
