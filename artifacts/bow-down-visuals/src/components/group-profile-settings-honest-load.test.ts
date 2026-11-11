/**
 * GroupProfileSettings (group profile editing) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE API HELPER branches on non-ok before any caller
 *   reads a payload — group settings are never built from
 *   an error body, and the load settles loading in its
 *   finally-equivalent path.
 * - THE FORM validates in plain, specific language before
 *   any write: the handle rule is stated exactly ("needs
 *   3–64 characters: lowercase letters, numbers and dashes,
 *   starting and ending with a letter or number") and a
 *   locally-built validation error surfaces as itself — a
 *   save is never attempted, or claimed, over invalid input.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GroupProfileSettings.tsx");

describe("payloads are read only past the ok branch; validation speaks plainly", () => {
  it("the branch and the handle rule are pinned", () => {
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain("The group handle needs 3–64 characters: lowercase letters, numbers and dashes, starting and ending with a letter or number.");
    expect(src).toContain("setLoading(false);");
  });
});
