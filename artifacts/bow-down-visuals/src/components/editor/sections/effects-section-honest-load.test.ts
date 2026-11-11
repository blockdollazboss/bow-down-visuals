/**
 * EffectsSection (the editor effects panel; background
 * removal leg) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * An editor section whose server legs are actions: the
 * background-removal call resolves into a three-way honest
 * branch — non-ok shows the server's message; ok WITHOUT an
 * output URL gets its own plain line ("No output URL
 * returned.") instead of replacing the clip with nothing;
 * only ok + a real URL replaces the clip's video. A declined
 * credit confirmation returns quietly (finally still clears
 * the busy flag) — a cancel is never an error.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./EffectsSection.tsx");

describe("background removal: error, no-output, or proven replace — never a silent swap", () => {
  it("the three-way branch and the busy release are pinned", () => {
    expect(src).toContain('setBgRemovalError(apiErrorMessage(data, "Background removal failed."));');
    expect(src).toContain("} else if (data.url && onReplaceClipVideo) {");
    expect(src).toContain('setBgRemovalError("No output URL returned.");');
    expect(src).toContain("setBgRemoving(false);");
  });
});
