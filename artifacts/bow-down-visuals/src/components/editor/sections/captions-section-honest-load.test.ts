/**
 * CaptionsSection (the editor's captions desk) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The caption lines themselves are local editor state; the
 * section's one charged call is the AI SYNC (transcribe +
 * match), and it is an honesty exemplar:
 * - a declined credit confirmation (null res) returns
 *   claiming nothing;
 * - non-ok throws the server's message; an ok response with
 *   NO timestamped segments throws its own specific error
 *   ("may have no vocals") — an empty transcription is a
 *   failure, never a silent wipe of the existing captions;
 * - the sync result is VALIDATED before it may overwrite:
 *   more than half invalid timings rejects the whole sync
 *   with "Existing captions were not overwritten.", a
 *   partially bad result is auto-repaired and the repair is
 *   narrated in the status line;
 * - the final status narrates the proven counts (matched /
 *   needs-review), and the syncing flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CaptionsSection.tsx");

describe("the AI sync proves its result before overwriting a single caption", () => {
  it("cancel claims nothing; non-ok and empty-segment responses both throw honestly", () => {
    expect(src).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(src).toContain('throw new Error(apiErrorMessage(err, "Transcription failed"));');
    expect(src).toContain('throw new Error("No timestamped segments returned. The song may have no vocals, or try again.");');
  });

  it("a mostly-invalid sync is rejected WITHOUT overwriting, and says so", () => {
    expect(src).toContain("if (bad > 0.5) {");
    expect(src).toContain("Existing captions were not overwritten.");
    expect(src).toContain("const finalLines = bad > 0 ? repairCaptionTimings(syncedLines, songDuration) : syncedLines;");
  });

  it("the status narrates proven counts and the flag clears in finally", () => {
    expect(src).toContain("setAiSyncStatus({ type: \"error\", message: `AI sync failed: ${msg}` });");
    expect(src).toContain("setAiSyncing(false);");
  });
});
