/**
 * customer-3d-prices.test.ts — customer 3D conversion = 1,500 VB
 * (owner ruling, Oct 27, 2026, by delegation).
 *
 * The ruling prices a product that does not exist yet: this tree has
 * no 3D conversion surface, route, or rail (the vault manages
 * characters; conversion is internal proof tooling). These pins hold
 * BOTH halves of that truth — the ruled figure recorded in
 * customer-3d-prices.ts, and the absence it was recorded against —
 * so the commit that builds the conversion desk must reconcile the
 * two here instead of inventing a second price at the surface.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "./credit-costs";
import { CUSTOMER_3D_CONVERSION_COST } from "./customer-3d-prices";

function readPage(rel: string): string {
  const url = new URL(`../pages/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

describe("customer 3D conversion — ruled 1,500 VB, product not built", () => {
  it("the ruled price is recorded at 1,500 Visual Bucs", () => {
    expect(CUSTOMER_3D_CONVERSION_COST).toBe(1500);
  });

  it("no registry endpoint sells a 3D conversion yet (the named gap)", () => {
    const keys = Object.keys(CREDIT_COSTS);
    expect(keys.filter((k) => /3d|three-d/i.test(k))).toEqual([]);
    const features = Object.values(CREDIT_COSTS).map((v) => v.feature);
    expect(features.filter((f) => /3d conversion/i.test(f))).toEqual([]);
  });

  it("the Artist Vault offers no 3D conversion purchase yet", () => {
    const vault = readPage("artist-vault.tsx");
    expect(vault).not.toMatch(/convert[^<]{0,40}3D/i);
    expect(vault).not.toMatch(/3D[^<]{0,40}conversion/i);
  });
});
