/**
 * GenerateArtistImageModal (artist image / photo-shoot
 * generation) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * - THE SUBMIT gates on ok + a proven taskId before anything
 *   is claimed; a synchronous success additionally requires
 *   the url before onGenerated fires; a declined credit
 *   confirmation (null res) clears the generating flag and
 *   claims nothing.
 * - THE POLL terminates on EVERY terminal path — this is the
 *   anti-trap exemplar of the tranche: succeeded stops and
 *   either delivers the url or says, in words, "finished but
 *   returned no image. Visual Bucs were not charged.";
 *   failed/cancelled stops with the server's message; a
 *   thrown poll stops too (a network error while polling is
 *   a terminal honest error here, never an interval that
 *   spins a dead job forever); unmount stops the interval.
 * - THE RECENT STRIP is best-effort BY DESIGN, pinned as-is:
 *   it is a convenience gallery inside a generation modal
 *   whose primary surface (the generator) is fully honest;
 *   a failed strip read leaves the strip empty and claims
 *   nothing false anywhere.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GenerateArtistImageModal.tsx");

describe("the submit proves the task before polling or claiming", () => {
  it("non-ok or a missing taskId throws; sync success requires the url", () => {
    expect(src).toContain("if (!res.ok || !data.taskId) {");
    expect(src).toContain('if (data.status === "succeeded" && data.url) {');
    expect(src).toContain("if (!res) { setGenerating(false); return; } // user cancelled the credit confirmation");
    expect(src).toContain("startPolling(data.taskId);");
  });
});

describe("the poll terminates on every terminal path", () => {
  it("succeeded-without-url is an honest error line, not a blank success", () => {
    expect(src).toContain('setError("Generation finished but returned no image. Visual Bucs were not charged.");');
  });

  it("failed/cancelled and a thrown poll both stop the interval and clear generating", () => {
    expect(src).toContain('} else if (data.status === "failed" || data.status === "cancelled") {');
    expect(src).toContain('setError("Network error while polling. Visual Bucs were not charged.");');
    expect(src).toContain("useEffect(() => () => stopPolling(), []);");
    const stops = src.split("stopPolling();").length - 1;
    expect(stops).toBeGreaterThanOrEqual(4);
  });
});

describe("the recent strip is a best-effort convenience, pinned as-is", () => {
  it("its read is fail-soft and feeds only the gallery strip", () => {
    expect(src).toContain("const files = await r2List(`${userId}/generated`, token);");
    expect(src).toContain("} catch { /* best-effort */ }");
  });
});
