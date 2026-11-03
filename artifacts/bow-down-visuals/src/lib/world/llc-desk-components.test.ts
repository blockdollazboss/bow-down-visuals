/**
 * llc-desk-components — stack1500 world parity wave #3
 * item 24 source-contract pins. The LLC Guide desk must sit
 * in the Get Paid board stack as a ({ isLight, isGuest })
 * desk with the house GuestGate, with:
 * - the ask thread + the filing plan in-panel, both riding
 *   the confirmed-spend seam at the registry prices with a
 *   decline running nothing and a 402 landing in the
 *   out-of-Bucs state;
 * - the plan rendered whole (steps with cost + timing,
 *   total estimate, notes);
 * - the page's disclaimer verbatim at the foot;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/LlcDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the Get Paid mount", () => {
  it("is a named ({ isLight, isGuest }) desk rooted at its testid, guests gated", () => {
    expect(desk).toContain("export function LlcDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-llc-desk"');
    expect(desk).toContain("if (isGuest) return <GuestGate isLight={isLight} />;");
    expect(desk).toContain('data-testid="world-llc-desk-signin"');
  });

  it("StationPanel stacks it at the Get Paid board behind a DeskDoor", () => {
    expect(panel).toContain('const LlcDesk = lazy(() => import("@/components/world/native/LlcDesk")');
    expect(panel).toContain("<LlcDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("the runs ride the confirmed-spend seam", () => {
  it("both rails go through confirmedFetch with registry overrides", () => {
    expect(desk).toContain("confirmedFetch(LLC_ASK_PATH, {");
    expect(desk).toContain("overrideCost: LLC_ASK_COST");
    expect(desk).toContain("overrideFeature: LLC_FEATURE_ASK");
    expect(desk).toContain("confirmedFetch(LLC_PLAN_PATH, {");
    expect(desk).toContain("overrideCost: LLC_PLAN_COST");
    expect(desk).toContain("overrideFeature: LLC_FEATURE_PLAN");
    expect(desk).toContain("res.status === 402");
    expect(desk).toContain("Treasury");
  });

  it("the plan renders whole: steps, estimate, notes", () => {
    expect(desk).toContain('data-testid="world-llc-desk-plan-result"');
    expect(desk).toContain("plan.steps.map");
    expect(desk).toContain("plan.totalEstimate");
    expect(desk).toContain("plan.notes.map");
  });

  it("the disclaimer sits at the foot, verbatim from the seam", () => {
    expect(desk).toContain('data-testid="world-llc-desk-disclaimer"');
    expect(desk).toContain("{LLC_DISCLAIMER_TITLE}");
    expect(desk).toContain("{LLC_DISCLAIMER_BODY}");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
