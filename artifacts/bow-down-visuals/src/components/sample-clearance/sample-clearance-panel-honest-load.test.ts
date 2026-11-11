/**
 * SampleClearancePanel (sample-use declarations) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE DECLARATION SAVE throws on non-ok with the server's
 *   message ("Couldn't save that declaration.") — a legal
 *   declaration is never shown as filed on an unproven
 *   write.
 * - THE SECONDARY read leg is ok-gated at the door
 *   (`if (!res.ok) return;`): it decorates the panel only
 *   from a proven payload and its failure leaves the
 *   panel's proven state untouched.
 * - THE LOAD runs through the panel's loading flag with its
 *   failure landing in the shared catch — declarations are
 *   never painted from an error body.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SampleClearancePanel.tsx");

describe("a declaration files only on a proven write", () => {
  it("the save throw and the gated read are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t save that declaration."));');
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain("setLoading(false);");
  });
});
