/**
 * CoachPlanLadder (the in-World coaching plan ladder +
 * embedded checkout) — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * - THE PLANS LOAD renders through the shared native states
 *   (NativeLoadingState while loading, the error surface on
 *   failure) — the ladder never paints plan cards from an
 *   unproven response; the loader branches on !res.ok
 *   before reading tiers.
 * - THE CHECKOUT VERIFY is the money exemplar inside the
 *   World: a subscription is claimed active only when the
 *   verify call is ok AND its payload says success === true
 *   (`!res.ok || data.success !== true` fails the claim) —
 *   the wallet's word alone never activates a plan, and the
 *   checkout failure copy comes from the failure itself
 *   (checkoutFailureCopy).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CoachPlanLadder.tsx");

describe("plans load through the native states; activation requires server verify", () => {
  it("the shared states and the verify gate are pinned", () => {
    expect(src).toContain('import { NativeErrorState, NativeLoadingState } from "./NativeStates";');
    expect(src).toContain("if (!res.ok || data.success !== true) {");
    expect(src).toContain("setError(checkoutFailureCopy(err));");
  });
});
