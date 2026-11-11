/**
 * LinkToHitPanel (link/clip → hit package) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An action panel with no mount load:
 * - THE INPUT is validated up front with plain, specific
 *   errors BEFORE any upload or charge: a non-video file is
 *   refused as not-a-video, and an oversized video names the
 *   member's OWN actual limit (the label is computed from
 *   their admin status — the copy never quotes a limit that
 *   isn't theirs).
 * - THE ANALYZE call gates the package on ok + the produced
 *   concept (`!res.ok || !data.comedyConcept`) — the package
 *   renders only from a proven result; the busy flag clears
 *   in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LinkToHitPanel.tsx");

describe("the package applies only from an ok response carrying the concept", () => {
  it("the gate, the upfront validation, and the busy release are pinned", () => {
    expect(src).toContain('if (!res.ok || !data.comedyConcept) throw new Error(apiErrorMessage(data, "Package failed."));');
    expect(src).toContain('setError("That file isn\'t a video — choose a video file.");');
    expect(src).toContain("uploadLimitLabel(isAdmin, 80 * 1024 * 1024)");
    expect(src).toContain("setLoading(false);");
  });
});
