/**
 * CommentToVideoBench (the in-World comment-to-video bench)
 * — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A native-bench twin of the 2D CommentToVideoSection,
 * held to the same law through the native doctrine: credits
 * get their own branch (402 status or the body's
 * out_of_credits code), and the scripts render only from
 * `!res.ok || !parsed` inverted — the payload must survive
 * the bench's parser, so a malformed body can never paint
 * scripts the tool didn't return. The bench refuses to run
 * before its inputs are ready, and the busy flag clears in
 * finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CommentToVideoBench.tsx");

describe("credits speak first; scripts require a parsed proven payload", () => {
  it("the taxonomy and the parse gate are pinned", () => {
    expect(src).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(src).toContain("if (!res.ok || !parsed) {");
    expect(src).toContain("setLoading(false);");
  });
});
