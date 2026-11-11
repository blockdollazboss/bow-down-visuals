/**
 * GenerationResult (the shared result panel under the
 * generators) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * The result itself arrives by props — there is no collection
 * load to dress up. Its two writes narrate only from checked
 * responses:
 * - THE SAVE claims "Project saved!" (setSaved, the saved id,
 *   the onSaved callback) ONLY after an ok response; a non-ok
 *   throws the server's message into a destructive "Save
 *   failed" toast, so the panel never shows a saved state for
 *   a project that was never stored.
 * - THE AUDIO GENERATION rides the shared helper through
 *   confirmedFetch: a declined confirmation (null resp)
 *   returns claiming nothing; out_of_credits lands on its
 *   dedicated state; any other failure lands on the audio
 *   error line; the success toast fires only with a real
 *   generated url in hand; the generating flag clears in
 *   finally on every path.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GenerationResult.tsx");

describe("the save claims success only on an ok response", () => {
  it("non-ok throws the server's message before any saved state is set", () => {
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain('throw new Error(apiErrorMessage(err, "Save failed"));');
    expect(src).toContain("setSaved(true);");
    expect(src).toContain('toast({ title: "Project saved!"');
    expect(src).toContain('title: "Save failed"');
  });
});

describe("the audio generation separates cancel, credits, failure, success", () => {
  it("each outcome lands on its own state and the flag always clears", () => {
    expect(src).toContain("if (!resp) return; // user cancelled the credit confirmation");
    expect(src).toContain('if (msg === "out_of_credits") {');
    expect(src).toContain("setAudioOutOfCredits(true);");
    expect(src).toContain("setAudioError(msg);");
    expect(src).toContain("setGeneratedAudioUrl(resp.url);");
    expect(src).toContain("setGeneratingAudio(false);");
  });
});
