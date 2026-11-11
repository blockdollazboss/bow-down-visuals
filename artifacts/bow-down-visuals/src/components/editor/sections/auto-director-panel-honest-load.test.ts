/**
 * AutoDirectorPanel (the auto video-plan director) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor panel with no mount load:
 * - THE PLAN call throws on non-ok into the error line; the
 *   plan state is set only from the proven response.
 * - THE APPLY step validates its own precondition out loud
 *   ("Add at least one scene with a video prompt before
 *   applying.") instead of failing silently or applying an
 *   empty plan — an honest refusal at the exact step that
 *   can't proceed.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AutoDirectorPanel.tsx");

describe("the plan applies only from an ok response", () => {
  it("the gate and the apply precondition are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Plan generation failed"));');
    expect(src).toContain('setError("Add at least one scene with a video prompt before applying.");');
  });
});
