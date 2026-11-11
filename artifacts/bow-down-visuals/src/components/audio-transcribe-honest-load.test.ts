/**
 * AudioTranscribe (transcribe an uploaded song) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The transcribe call narrates only truth:
 * - a declined credit confirmation (null res) returns
 *   claiming nothing, and the phase machine resets in
 *   finally on every path (no spinner outlives the attempt);
 * - non-ok throws the server's message;
 * - an ok response with an EMPTY transcript is its own
 *   honest failure ("came back empty — your song may have
 *   no clear vocals") with a manual path offered — an empty
 *   result is never handed to onTranscript as a success;
 * - a timeout abort gets its own truthful message, distinct
 *   from a user cancel (which resets quietly by design).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AudioTranscribe.tsx");

describe("the transcribe proves its payload before handing it over", () => {
  it("non-ok throws the server's message; an empty transcript is an honest failure", () => {
    expect(src).toContain('throw new Error(apiErrorMessage(data, "Transcription failed"));');
    expect(src).toContain('"The transcription came back empty — your song may have no clear vocals. Try a shorter clip or paste your lyrics manually.",');
    expect(src).toContain("onTranscript(transcript);");
  });

  it("cancel claims nothing; timeout is its own message; the phase always resets", () => {
    expect(src).toContain("if (!res) return; // user cancelled the credit confirmation (finally resets state)");
    expect(src).toContain('"Transcription timed out — your song may be too long. Try a shorter MP3 or paste your lyrics manually.",');
    expect(src).toContain("setPhase(null);");
  });
});
