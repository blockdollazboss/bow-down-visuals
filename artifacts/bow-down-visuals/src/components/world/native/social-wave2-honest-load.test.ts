/**
 * SocialWave2 (the in-World social wave-2 surface) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A large native surface held to the shared doctrine: its
 * api helper throws on non-ok with the status in the
 * fallback message, and its sections render through the
 * shared native states (NativeLoadingState /
 * NativeEmptyState / NativeErrorState imported at its head)
 * — each section's data exists only from its proven
 * payload, and a section's failure lands on that section's
 * error state rather than dressing as its empty state.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SocialWave2.tsx");

describe("the surface rides the shared helper and the native states", () => {
  it("the throw and the states import are pinned", () => {
    expect(src).toContain("NativeCard, NativeLoadingState, NativeEmptyState, NativeErrorState,");
    expect(src).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));");
    expect(src).toContain('t("worldSocialDesk.exploreLoading")');
  });
});
