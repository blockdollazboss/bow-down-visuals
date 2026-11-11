/**
 * MaskCard (the editor's freeze-mask tool) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE SUBMIT gates on the exact acceptance shape: only a
 *   202 WITH a jobId starts the poll; a 402 gets the
 *   out-of-Bucs toast; anything else throws the server's
 *   message; a declined confirmation (null res) claims
 *   nothing.
 * - FIX (this tranche): THE POLL could spin forever. The
 *   job's only live status is "processing" (the rail's
 *   JobStatus is processing | done | failed); done and
 *   failed terminated the poll honestly, but ANY other
 *   answer fell through and kept polling every 2s with the
 *   card stuck busy — including the 404 "Job not found."
 *   body of an evicted job and a done-without-url. The poll
 *   now treats every non-processing, non-done answer as
 *   terminal: interval cleared, busy cleared, and the
 *   server's message toasted as the failure it is (the
 *   SingingVoiceModal / VocalTunePanel fix shape from
 *   tranches 4–5).
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MaskCard.tsx");

describe("the submit gates on the exact acceptance shape", () => {
  it("only a 202 with a jobId starts the poll; 402 and other failures claim nothing", () => {
    expect(src).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain("if (res.status !== 202 || !body.jobId) throw new Error(apiErrorMessage(body, t(\"videoEditor.mask.applyFailed\")));");
  });
});

describe("FIX: the poll terminates on every terminal answer", () => {
  it("done requires the url; failed terminates with the server's message", () => {
    expect(src).toContain('if (jb.status === "done" && jb.url) {');
    expect(src).toContain('} else if (jb.status === "failed") {');
  });

  it("any non-processing remainder is terminal instead of an endless poll", () => {
    expect(src).toContain('} else if (jb.status !== "processing") {');
    expect(src).toContain("is terminal too. Falling through here used to poll a");
  });
});
