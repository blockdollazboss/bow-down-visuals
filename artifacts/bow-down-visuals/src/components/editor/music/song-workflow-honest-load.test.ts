/**
 * SongWorkflow (the song creation workflow's transcribe
 * step) — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * An action surface with no mount load: the transcribe call
 * gates the workflow's advance on ok + the produced
 * transcript (`!res.ok || !data.transcript`) — the flow
 * never moves to the lyrics/timing steps on a transcript
 * that doesn't exist, and a failure lands on the error line
 * via the shared catch instead of advancing silently.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SongWorkflow.tsx");

describe("the workflow advances only from an ok response carrying the transcript", () => {
  it("the gate is pinned", () => {
    expect(src).toContain('if (!res.ok || !data.transcript) throw new Error(apiErrorMessage(data, "Transcription failed"));');
  });
});
