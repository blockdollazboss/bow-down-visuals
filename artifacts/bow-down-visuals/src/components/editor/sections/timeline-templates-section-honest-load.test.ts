/**
 * TimelineTemplatesSection (apply a timeline template) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor section with no mount load:
 * - THE PRECONDITION speaks first: applying without audio
 *   lands on the dedicated no-audio error line before any
 *   call is made.
 * - THE APPLY call gives 402 its own branch, then gates the
 *   timeline mutation on the proven payload shape —
 *   `!res.ok || !Array.isArray(data.ops)` — so the editor
 *   applies only the operations a real template returned;
 *   a malformed body can never half-apply to the member's
 *   timeline.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TimelineTemplatesSection.tsx");

describe("the template applies only from a proven ops array", () => {
  it("the precondition, the 402 branch, and the shape gate are pinned", () => {
    expect(src).toContain("setError(t(`${ns}.errorNoAudio`));");
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain("if (!res.ok || !Array.isArray(data.ops)) {");
  });
});
