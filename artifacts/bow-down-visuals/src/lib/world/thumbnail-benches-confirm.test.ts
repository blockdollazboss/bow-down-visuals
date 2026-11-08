/**
 * thumbnail-benches-confirm — Stack 400 B-03 pins.
 *
 * The Thumbnail Desk's four pro benches used to charge by BARE
 * fetch — no CreditConfirm in-World, while their 2D twins
 * (thumbnail-studio.tsx) confirm every spend through
 * useConfirmedApi. These pins fail if any of the four rails
 * goes back to a bare fetch, if the confirm stops gating the
 * spend in the shared hook, or if the registry prices the
 * confirm shows (200 / 75 / 200 / 200) drift.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const thumbBenches = read("../../components/world/native/ThumbnailBenches.tsx");
const confirmedApi = read("../../hooks/use-confirmed-api.ts");
const creditCosts = read("../credit-costs.ts");
const createDesks = read("./create-desks.ts");

const RAILS = [
  "/api/thumbnail-generator",
  "/api/wave8/thumbnail-ab/variants",
  "/api/thumbnail-test",
  "/api/thumbnail-test/improve",
] as const;

describe("stack400 B-03 — thumbnail benches confirm before they charge", () => {
  it("all four rails ride confirmedFetch — no bare fetch to any /api/ route remains", () => {
    expect(thumbBenches).toContain("useConfirmedApi");
    for (const rail of RAILS) {
      expect(thumbBenches).toContain(`confirmedFetch("${rail}"`);
    }
    expect(thumbBenches).not.toContain('await fetch("/api/');
    expect(thumbBenches).not.toContain("useDeskAuthHeaders");
  });

  it("a cancelled confirm stops every run — each call site null-checks the response", () => {
    const nullChecks = thumbBenches.match(/if \(!res\) return;/g) ?? [];
    expect(nullChecks.length).toBe(RAILS.length);
  });

  it("the shared hook presents the CreditConfirm BEFORE the network call", () => {
    const confirmAt = confirmedApi.indexOf("await confirmSpend({ cost, feature })");
    const fetchAt = confirmedApi.indexOf("await fetch(endpoint");
    expect(confirmAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeLessThan(fetchAt);
    /* A declined confirm returns null — the charge never fires. */
    expect(confirmedApi).toContain("if (!confirmed) return null;");
    /* The cost the member confirms is the registry's own. */
    expect(confirmedApi).toContain("getCreditCost(endpoint)");
  });

  it("the registry costs the confirm shows are 200 / 75 / 200 / 200", () => {
    expect(creditCosts).toContain('"/api/thumbnail-generator": { cost: 200');
    expect(creditCosts).toContain('"/api/wave8/thumbnail-ab/variants": { cost: 75');
    expect(creditCosts).toContain('"/api/thumbnail-test": { cost: 200');
    expect(creditCosts).toContain('"/api/thumbnail-test/improve": { cost: 200');
    /* The prices the bench BUTTONS display come from the same
       registry (create-desks' cost helpers read registryCost),
       so the shown price and the confirmed price cannot drift. */
    expect(thumbBenches).toContain("thumbnailGeneratorCost()");
    expect(thumbBenches).toContain("thumbnailVariantsCost()");
    expect(thumbBenches).toContain("thumbnailTestCost()");
    expect(thumbBenches).toContain("thumbnailImproveCost()");
    expect(createDesks).toContain('registryCost("/api/thumbnail-generator")');
    expect(createDesks).toContain('registryCost("/api/wave8/thumbnail-ab/variants")');
    expect(createDesks).toContain('registryCost("/api/thumbnail-test")');
    expect(createDesks).toContain('registryCost("/api/thumbnail-test/improve")');
  });
});
