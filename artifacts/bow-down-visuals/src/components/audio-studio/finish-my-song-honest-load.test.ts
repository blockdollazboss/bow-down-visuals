/**
 * FinishMySong (the demo-to-finished-song tool) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load:
 * - THE INPUT is validated up front with its own plain
 *   error: a demo over 25 MB is refused BEFORE any upload or
 *   charge, on both the file-picker path and the vault path
 *   ("same size rule as a manual pick").
 * - THE FINISH call gates the result on ok + the produced
 *   song URL (`!res.ok || !data.songUrl`) — the finished
 *   player renders only from a proven artifact; every other
 *   outcome lands on the error line, and the busy flag
 *   clears in finally so the tool can never trap mid-job.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FinishMySong.tsx");

describe("the finish applies only from an ok response carrying the song", () => {
  it("the gate, the upfront size honesty, and the busy release are pinned", () => {
    expect(src).toContain('if (!res.ok || !data.songUrl) throw new Error(apiErrorMessage(data, "Could not finish song."));');
    expect(src).toContain('setError("That demo is over 25 MB — pick a smaller file.");');
    expect(src).toContain("setLoading(false);");
  });
});
