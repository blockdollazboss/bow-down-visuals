/**
 * PreProductionSection (bible / storyboard / asset
 * generation) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * An editor section whose generators ride one shared helper
 * that throws on non-ok with the server's message — no
 * generated document is ever built from an error body. Each
 * generator then lands failures on its own error line with
 * its own copy ("Bible generation failed." / "Storyboard
 * generation failed."), so the member always knows WHICH
 * document failed, and a failed bible never poses as a
 * generated one.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PreProductionSection.tsx");

describe("each generator fails on its own line; payloads come only past ok", () => {
  it("the helper throw and the per-tool error lines are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Request failed"));');
    expect(src).toContain('setError(plainErrorText(e, "Bible generation failed."));');
    expect(src).toContain('setError(plainErrorText(e, "Storyboard generation failed."));');
  });
});
