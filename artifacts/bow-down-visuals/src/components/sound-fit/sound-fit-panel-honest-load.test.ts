/**
 * SoundFitPanel (find sounds that fit a BPM/key) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE PICKER LOADS settle per source, pinned as-is: the DJ
 *   library and the beats list each set ONLY from their own
 *   ok response, and a failed leg leaves just that picker
 *   empty (the source comment: "pickers just stay empty;
 *   errors surface on search"). The pickers are source
 *   SELECTORS for the panel's real calls, not data views —
 *   and the panel stays fully usable without them through
 *   the custom BPM/key entry.
 * - THE FIT / STACK CALLS are the load-bearing surface and
 *   narrate honestly: non-ok lands on the error line with
 *   the server's message, results render only from a proven
 *   response, and the loading flag clears in finally on
 *   every path.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SoundFitPanel.tsx");

describe("the picker loads settle per source from ok responses only", () => {
  it("each picker sets only from its own ok leg", () => {
    expect(src).toContain("if (djRes.ok) {");
    expect(src).toContain("if (beatsRes.ok) {");
    expect(src).toContain("} catch { /* pickers just stay empty; errors surface on search */ }");
  });
});

describe("the fit/stack calls narrate from their checked responses", () => {
  it("non-ok lands on the error line and the flag always clears", () => {
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain('setError(plainErrorText(e, t("soundFit.errorGeneric", { defaultValue: "Sound-fit hit a snag. Please try again." })));');
    expect(src).toContain("setLoading(null);");
  });
});
