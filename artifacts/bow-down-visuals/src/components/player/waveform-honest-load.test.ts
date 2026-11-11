/**
 * Waveform (audio waveform renderer) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * A classification pin for a media-decoration load: the
 * peaks come from fetching the audio file itself; a non-ok
 * response resolves to NULL peaks (`if (!res.ok) return
 * null`) and a thrown fetch lands in the same null — the
 * component then renders WITHOUT peak data rather than
 * fabricating a waveform shape. The audio is the truth; the
 * waveform is a visualization of proven bytes or it is
 * absent — never invented.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./Waveform.tsx");

describe("peaks exist only from the proven audio bytes", () => {
  it("non-ok resolves to no peaks, never a fabricated shape", () => {
    expect(src).toContain("if (!res.ok) return null;");
  });
});
