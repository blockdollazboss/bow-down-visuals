/**
 * LyricsToTimeline (lyrics → timed timeline lines) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load: the timing call gates
 * the placed lines on ok + a NON-EMPTY lines array
 * (`!res.ok || !Array.isArray(data.lines) ||
 * data.lines.length === 0`) — a timing job that produced
 * nothing is reported as the failure it is, never as a
 * successfully placed empty timeline. The profile refresh
 * (the charge record) fires only on the proven-success path
 * visible above the gate. The busy flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LyricsToTimeline.tsx");

describe("the lines place only from an ok response carrying a non-empty array", () => {
  it("the gate and the busy release are pinned", () => {
    expect(src).toContain("if (!res.ok || !Array.isArray(data.lines) || data.lines.length === 0) {");
    expect(src).toContain("setLines(data.lines);");
    expect(src).toContain('setError(plainErrorText(err, t("wave9.timeline.errorGeneric")));');
    expect(src).toContain("setLoading(false);");
  });
});
