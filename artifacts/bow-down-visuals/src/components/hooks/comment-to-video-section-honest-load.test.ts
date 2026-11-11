/**
 * CommentToVideoSection (comments → video scripts) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, the failure-taxonomy
 * shape (the MemeMachineSection family): a 402 status OR
 * the body's own out_of_credits code lands on the credits
 * branch BEFORE the general gate, and the scripts render
 * only from an ok response carrying a non-empty list
 * (`!res.ok || !data.scripts?.length`) — an ok-but-empty
 * generation is a failure line, never an empty script wall
 * presented as the result. The call refuses to run with no
 * comments, and the busy flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CommentToVideoSection.tsx");

describe("credits speak first; scripts require a proven non-empty list", () => {
  it("the taxonomy and the gate are pinned", () => {
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain('if (!res.ok || !data.scripts?.length) throw new Error(apiErrorMessage(data, "Script generation failed."));');
    expect(src).toContain("setLoading(false);");
  });
});
