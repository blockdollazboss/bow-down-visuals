/**
 * ShowFinder (find shows/venues to pitch) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An action panel with no mount load:
 * - THE FORM validates itself out loud, one missing piece
 *   at a time — location, show types, genre each have their
 *   own error line, checked before any call or charge.
 * - THE FIND call gives credits their own branch (402
 *   status or the body's out_of_credits code), then gates
 *   the results on the proven payload shape —
 *   `!res.ok || !Array.isArray(data.opportunities)` — so an
 *   opportunities wall renders only from a real finder
 *   result.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ShowFinder.tsx");

describe("validation speaks first; results require the proven shape", () => {
  it("the three validation lines, the taxonomy, and the gate are pinned", () => {
    expect(src).toContain('setError(t("shows.errorNeedLocation"));');
    expect(src).toContain('setError(t("shows.errorNeedTypes"));');
    expect(src).toContain('setError(t("shows.errorNeedGenre"));');
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain("if (!res.ok || !Array.isArray(data.opportunities)) {");
  });
});
