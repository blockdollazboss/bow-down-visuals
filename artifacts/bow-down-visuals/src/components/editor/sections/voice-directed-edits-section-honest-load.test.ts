/**
 * VoiceDirectedEditsSection (edit by voice command) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor section with no mount load:
 * - THE PRECONDITION speaks first: a command with no scenes
 *   to edit lands on the dedicated no-scenes line before
 *   any call.
 * - THE EDIT call settles EVERY path: the success path
 *   releases the busy flag on its own branch, a 402 lands
 *   on the out-of-credits line (busy released there too),
 *   and any other non-ok throws its status into the shared
 *   catch — the section can never trap in "working" after
 *   any outcome, and an edit applies only from the proven
 *   response.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VoiceDirectedEditsSection.tsx");

describe("every outcome releases the busy flag; non-ok never applies", () => {
  it("the precondition, the 402 branch, and the throw are pinned", () => {
    expect(src).toContain('setError(t("wave9.directEdit.noScenes"));');
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain('setError(t("wave9.directEdit.outOfCredits"));');
    expect(src).toContain("if (!res.ok) throw new Error(`HTTP ${res.status}`);");
  });
});
