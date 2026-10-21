import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coerceCooldownSeconds, isUsableSeconds } from "./cooldown";

const crateSource = readFileSync(
  new URL("../components/MysteryCrate.tsx", import.meta.url),
  "utf8",
);

describe("cooldown coercion (Lane V4 item 4 — the NaNs chip)", () => {
  it("finite non-negative numbers pass through (floored)", () => {
    expect(coerceCooldownSeconds(75)).toBe(75);
    expect(coerceCooldownSeconds(75.9)).toBe(75);
    expect(coerceCooldownSeconds(0)).toBe(0);
  });
  it("missing/garbage values become the fallback, never NaN", () => {
    expect(coerceCooldownSeconds(undefined)).toBe(0);
    expect(coerceCooldownSeconds(null)).toBe(0);
    expect(coerceCooldownSeconds("soon")).toBe(0);
    expect(coerceCooldownSeconds(NaN)).toBe(0);
    expect(coerceCooldownSeconds(Infinity)).toBe(0);
    expect(coerceCooldownSeconds(-5)).toBe(0);
    expect(coerceCooldownSeconds(undefined, 3600)).toBe(3600);
    expect(coerceCooldownSeconds(NaN, 3600)).toBe(3600);
  });
  it("isUsableSeconds rejects exactly the values that produced NaN", () => {
    expect(isUsableSeconds(12)).toBe(true);
    expect(isUsableSeconds(NaN)).toBe(false);
    expect(isUsableSeconds(undefined)).toBe(false);
    expect(isUsableSeconds(-1)).toBe(false);
  });
  it("the crate coerces at intake and in the 429 fallback chain", () => {
    expect(crateSource).toContain("coerceCooldownSeconds(s.wheelCooldownSeconds)");
    expect(crateSource).toContain("coerceCooldownSeconds(r.nextHourIn,");
    expect(crateSource).not.toContain("setCooldown(s.wheelCooldownSeconds);");
  });
});
