/**
 * brand-calculator-desk-components — stack1500 world parity
 * wave #3 item 21 source-contract pins. The Brand Deal
 * Calculator desk must sit in the Get Paid board stack as a
 * ({ isLight, isGuest }) desk with the house GuestGate, with:
 * - the full form in-panel (platform + deliverable chips,
 *   the three numbers, the niche) and the run riding the
 *   confirmed-spend seam at the registry price with a
 *   decline running nothing and a 402 landing in the
 *   out-of-Bucs state;
 * - the rate card rendered whole (range, per-post, package,
 *   breakdown, usage rights, tips) with the rail's own
 *   disclaimer on it;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/BrandCalculatorDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the Get Paid mount", () => {
  it("is a named ({ isLight, isGuest }) desk rooted at its testid, guests gated", () => {
    expect(desk).toContain("export function BrandCalculatorDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-brand-calc-desk"');
    expect(desk).toContain("if (isGuest) return <GuestGate isLight={isLight} />;");
    expect(desk).toContain('data-testid="world-brand-calc-desk-signin"');
  });

  it("StationPanel stacks it at the Get Paid board behind a DeskDoor", () => {
    expect(panel).toContain('const BrandCalculatorDesk = lazy(() => import("@/components/world/native/BrandCalculatorDesk")');
    expect(panel).toContain("<BrandCalculatorDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("the run rides the confirmed-spend seam", () => {
  it("the calculate rail goes through confirmedFetch with the registry override", () => {
    expect(desk).toContain("confirmedFetch(BRAND_CALC_PATH, {");
    expect(desk).toContain("overrideCost: BRAND_CALC_COST");
    expect(desk).toContain("overrideFeature: BRAND_CALC_FEATURE");
    expect(desk).toContain("res.status === 402");
    expect(desk).toContain("Treasury");
    expect(desk).toContain("buildBrandCalcPayload(form)");
  });

  it("the form and the card are whole", () => {
    for (const needle of [
      "BRAND_CALC_PLATFORMS.map",
      "BRAND_CALC_CONTENT_TYPES.map",
      'data-testid="world-brand-calc-desk-followers"',
      'data-testid="world-brand-calc-desk-niche"',
      'data-testid="world-brand-calc-desk-result"',
      "result.breakdown.map",
      "result.usageRights.map",
      "result.negotiationTips.map",
      'data-testid="world-brand-calc-desk-disclaimer"',
      "result.disclaimer",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
