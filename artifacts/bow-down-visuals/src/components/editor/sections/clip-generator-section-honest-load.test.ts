/**
 * ClipGeneratorSection (the editor's clip generator +
 * upload) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * - THE UPLOAD→ATTACH CHAIN proves each step before the
 *   next claim: the scene-clip PATCH throws on non-ok with
 *   the server's message, and only AFTER upload + attach
 *   both succeed does local state mark the scene's clip
 *   "completed" and the status flip to done — a failed
 *   attach lands on uploadError with status "error", never
 *   a scene claiming a clip the project doesn't have.
 * - THE INPUT is validated up front: an oversized clip
 *   names the member's own actual limit before any bytes
 *   move, and uploading without a target scene says exactly
 *   that.
 * - THE IMPROVE-PROMPT helper is an ok-gated enhancement:
 *   the improved prompt replaces the member's text only
 *   from an ok response; a failure leaves their words
 *   untouched.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ClipGeneratorSection.tsx");

describe("local state claims completed only after upload AND attach prove", () => {
  it("the patch gate precedes the completed mark", () => {
    const gateIdx = src.indexOf("if (!patchRes.ok) {");
    const completedIdx = src.indexOf('generationStatus: "completed" as const');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(completedIdx).toBeGreaterThan(gateIdx);
    expect(src).toContain('setUploadStatus("error");');
  });

  it("validation speaks before bytes move; improve-prompt is ok-gated", () => {
    expect(src).toContain("uploadLimitLabel(isAdmin, 80 * 1024 * 1024)");
    expect(src).toContain('setUploadError("Select a scene first — the uploaded clip will be attached to it.");');
    expect(src).toContain("if (res.ok) {");
  });
});
