/**
 * creator-pricing-plans-load.test.ts — a FAILED plans load must never
 * dress up as "price coming soon" (stack1300 staging-gate-api lane).
 *
 * The defect (proven live on staging, stack1200 build): the page
 * seeds its plans from the shared static catalog with paid tiers at
 * priceConfigured:false, then overlays the server's answer from
 * GET /api/creator-tiers/plans. ANY failure of that fetch — non-ok
 * (including the staging gate's 401) or a thrown network error — was
 * swallowed silently, leaving the fallback in place forever: Pro and
 * Elite rendered "price coming soon" even with their prices fully
 * configured server-side. A load failure and an unconfigured price
 * are different facts and must render differently.
 *
 * The derivation the page renders through:
 *   configured            → "buy"          (Go / Switch label)
 *   not configured, load
 *     never failed        → "coming-soon"  (the honest configured fact)
 *   load failed           → "retry-load"   (honest failure + a working
 *                                           retry that re-runs the load)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { paidPlanCta } from "../lib/pricing-card-state";

describe("paidPlanCta — the /creator-pricing paid-card derivation", () => {
  it("a configured price is buyable, whatever the load history", () => {
    expect(paidPlanCta(true, false)).toBe("buy");
    expect(paidPlanCta(true, true)).toBe("buy");
  });

  it("an unconfigured price with a clean load is the honest coming-soon", () => {
    expect(paidPlanCta(false, false)).toBe("coming-soon");
  });

  it("an unconfigured price after a FAILED load is a retry, never coming-soon", () => {
    expect(paidPlanCta(false, true)).toBe("retry-load");
  });
});

describe("/creator-pricing page wiring — the load failure is tracked and rendered honestly", () => {
  const page = readFileSync(new URL("./creator-pricing.tsx", import.meta.url), "utf8");

  it("the page derives the paid CTA through paidPlanCta", () => {
    expect(page).toContain("paidPlanCta(");
  });

  it("the plans load records failure on BOTH failure shapes: non-ok and thrown", () => {
    expect(page).toContain("setPlansLoadFailed(true)");
    expect(page.match(/setPlansLoadFailed\(true\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("a successful load clears the failure state", () => {
    expect(page).toContain("setPlansLoadFailed(false)");
  });

  it('"price coming soon" renders only in the coming-soon state', () => {
    expect(page).toContain('"coming-soon"');
    // The rendered label (not the explanatory comments): it must sit
    // downstream of a paidPlanCta "coming-soon" comparison, i.e. inside
    // the derivation's branch — never as an unconditional fallback.
    const soonAt = page.indexOf("— price coming soon");
    expect(soonAt).toBeGreaterThan(-1);
    const branchAt = page.lastIndexOf('"coming-soon"', soonAt);
    expect(branchAt).toBeGreaterThan(-1);
  });

  it("the retry state re-runs the plans load instead of opening checkout", () => {
    expect(page).toContain('"retry-load"');
    const retryAt = page.indexOf('"retry-load"');
    const window_ = page.slice(Math.max(0, retryAt - 400), retryAt + 400);
    expect(window_).toContain("loadPlans");
  });
});
