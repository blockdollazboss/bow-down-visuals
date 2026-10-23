import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Stack-28 #45 (A1-04) — WantedMeter stars must not hardcode aria-checked=false. */
const src = readFileSync(new URL("../pages/pricing.tsx", import.meta.url), "utf8");

describe("WantedMeter aria (Stack-28 #45)", () => {
  it("aria-checked is bound to selection state", () => {
    expect(src).not.toContain("aria-checked={false}");
    expect(src).toContain("aria-checked={selected === s}");
    expect(src).toContain("setSelected(s); onSelect(s)");
  });
});
