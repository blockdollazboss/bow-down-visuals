/**
 * UnlockGatesPanel (fan unlock-gate management) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE SHARED API HELPER throws on non-ok with the server's
 *   message before any caller may read a payload — no gate
 *   list or gate state is ever built from an error body.
 * - THE WRITES report per action: create and deactivate
 *   each land failures on the panel's error line with their
 *   own fallback copy ("Couldn't create the gate." /
 *   "Couldn't deactivate the gate.") — a gate is never shown
 *   created or deactivated on an unproven write.
 * - THE PROFILE prefill read is catch-guarded: it decorates
 *   the form and its failure blocks nothing it doesn't own.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./UnlockGatesPanel.tsx");

describe("the helper throws on non-ok; writes report per action", () => {
  it("the gate and both action fallbacks are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(json, "Something went wrong."));');
    expect(src).toContain('setErr(plainErrorText(e, "Couldn\'t create the gate."));');
    expect(src).toContain('setErr(plainErrorText(e, "Couldn\'t deactivate the gate."));');
  });
});
