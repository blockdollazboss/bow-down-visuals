/**
 * LiveCaptionsStudioPanel (the streamer's captions studio)
 * — honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The streamer-side captions panel, pinned on its speech
 * leg: browser speech transcription runs through its own
 * state, and the error state tells the truth WITH the way
 * forward — "Speech transcription hit a problem in this
 * browser — type your lines below instead." A failed speech
 * engine never traps the streamer in a dead captions panel
 * and never fabricates lines: the manual typing path is
 * offered in the same breath as the failure.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveCaptionsStudioPanel.tsx");

describe("a speech failure names itself and offers the manual path", () => {
  it("the error state and its copy are pinned", () => {
    expect(src).toContain('speechState === "error"');
    expect(src).toContain("Speech transcription hit a problem in this browser — type your lines below instead.");
  });
});
