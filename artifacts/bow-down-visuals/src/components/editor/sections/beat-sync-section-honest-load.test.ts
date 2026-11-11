/**
 * BeatSyncSection (beat detection for the editor) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor section with no mount load, the failure-taxonomy
 * shape (the SubjectReframeCard family): the detect call
 * gives 402 (out of credits) and 503 (engine unavailable)
 * their own branches BEFORE the general gate, and the
 * general gate requires the proven payload shape —
 * `!res.ok || !Array.isArray(data.beats)` — so a beats list
 * renders only from a real detection. Each class lands on
 * its own line in the section's error state.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BeatSyncSection.tsx");

describe("each status class gets its own branch; beats require the proven shape", () => {
  it("402 and 503 precede the shape gate", () => {
    const creditsIdx = src.indexOf("if (res.status === 402) {");
    const unavailableIdx = src.indexOf("if (res.status === 503) {");
    const gateIdx = src.indexOf("if (!res.ok || !Array.isArray(data.beats)) {");
    expect(creditsIdx).toBeGreaterThan(-1);
    expect(unavailableIdx).toBeGreaterThan(creditsIdx);
    expect(gateIdx).toBeGreaterThan(unavailableIdx);
  });
});
