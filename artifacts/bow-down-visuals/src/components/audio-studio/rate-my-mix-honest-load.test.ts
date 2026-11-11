/**
 * RateMyMix (the AI mix analysis) — honest action states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * An action panel with no mount load, the FinishMySong twin
 * shape:
 * - THE INPUT is validated up front with its own plain
 *   error: a mix over 25 MB is refused BEFORE any upload or
 *   charge.
 * - THE ANALYZE call gates the verdict on ok + the produced
 *   notes (`!res.ok || !data.notes`) — the rating renders
 *   only from a proven analysis; every other outcome lands
 *   on the error line, and the busy flag clears in finally
 *   so the tool can never trap mid-job.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./RateMyMix.tsx");

describe("the verdict applies only from an ok response carrying the analysis", () => {
  it("the gate, the upfront size honesty, and the busy release are pinned", () => {
    expect(src).toContain('if (!res.ok || !data.notes) throw new Error(apiErrorMessage(data, "Analysis failed."));');
    expect(src).toContain('setError("That mix is over 25 MB — pick a smaller file.");');
    expect(src).toContain("setLoading(false);");
  });
});
