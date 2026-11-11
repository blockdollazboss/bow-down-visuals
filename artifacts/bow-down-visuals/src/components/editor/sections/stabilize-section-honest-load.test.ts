/**
 * StabilizeSection (video stabilization) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An editor section with no mount load: the stabilize call
 * gates the result on ok + the produced URL (`!res.ok ||
 * !data.url`), and BOTH failure paths — the server's refusal
 * and the bare catch — carry the money truth in the copy
 * itself: "Stabilization failed — no Visual Bucs were
 * spent." (the endpoint's charge-on-success contract is
 * what backs the claim, the same doctrine as the
 * SubjectReframeCard refunded line). Picking a different
 * scene clears the previous result AND error, so a stale
 * success never lingers beside a new input.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StabilizeSection.tsx");

describe("the result requires the proven url; failures state the no-spend truth", () => {
  it("the gate and both failure lines are pinned", () => {
    expect(src).toContain("if (!res.ok || !data.url) {");
    expect(src).toContain('setError(apiErrorMessage(data, "Stabilization failed — no Visual Bucs were spent."));');
    expect(src).toContain('setError("Stabilization failed — no Visual Bucs were spent.");');
  });
});
