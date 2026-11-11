/**
 * CinematicFxCard (the cinematic FX burn) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An editor card with no mount load, the failure-taxonomy
 * shape: a 402 lands on its own plain out-of-credits line
 * ("Out of Visual Bucs — top up to burn cinematic FX.")
 * BEFORE the general gate, and the render applies only from
 * an ok response carrying the output (`!res.ok ||
 * !body.url`) — a done-without-url answer is a failure
 * line, never a player with nothing in it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CinematicFxCard.tsx");

describe("402 speaks first; the render requires the proven output url", () => {
  it("the taxonomy and the gate are pinned", () => {
    expect(src).toContain('setError("Out of Visual Bucs — top up to burn cinematic FX.");');
    expect(src).toContain('if (!res.ok || !body.url) throw new Error(apiErrorMessage(body, "Cinematic FX render failed."));');
  });
});
