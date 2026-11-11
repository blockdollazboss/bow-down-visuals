/**
 * GroupOnboarding (group join questions / requests) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE SHARED HELPER throws on non-ok with the server's
 *   message before any caller reads a payload.
 * - THE LOAD lands failures on a rendered loadError state,
 *   and the panel's guidance copy is gated on the proven
 *   load: the "direct joins" line renders only when
 *   `loaded && !loadError` with a proven role/questions
 *   state — the panel never tells a member how joining
 *   works from a load that failed.
 * - THE WRITES (join request, save questions) land failures
 *   on their own message lines with plain copy.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GroupOnboarding.tsx");

describe("guidance renders only from a proven load", () => {
  it("the helper throw, the error state, and the loaded gate are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(j, "Something went wrong."));');
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain("{loaded && !loadError && !myRole && user && questions.length === 0 &&");
    expect(src).toContain('setMsg(plainErrorText(e, "Could not send your request."));');
  });
});
