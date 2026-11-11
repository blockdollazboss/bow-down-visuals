/**
 * BriefDesk (the in-World UGC brief desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A native desk on a kind-tagged state machine: the state
 * starts at { kind: "loading" } on every load, a non-ok
 * response branches into the machine's failure kind (never
 * into the brief list), and the desk's actions disable
 * while the state is loading — a brief is never rendered,
 * claimed, or acted on from an unproven payload, and the
 * loading state is a state of the machine, not a spinner
 * pasted over stale data.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BriefDesk.tsx");

describe("the brief loads through a kind machine that starts at loading", () => {
  it("the machine and the non-ok branch are pinned", () => {
    expect(src).toContain('setState({ kind: "loading" });');
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain('disabled={state.kind === "loading"}');
  });
});
