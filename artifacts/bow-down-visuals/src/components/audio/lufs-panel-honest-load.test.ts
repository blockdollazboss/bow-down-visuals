/**
 * LufsPanel — honest load standard (deep-pins tranche 4,
 * batch C). A Pattern-B job tool plus a FREE analysis. Analyze
 * (skipConfirm): a decline returns to idle, a non-ok answer is
 * the failed state with the server's message, and the analysis
 * is set only after the ok check. Normalize (100 VB): a decline
 * charges nothing and returns to idle, 402 is the out-of-credits
 * ending (idle, not failed), a non-ok or jobId-less answer is
 * failed, and the job is queued only from a proven jobId. The
 * poll has real terminal states: a non-ok poll answer ends
 * failed, a parsed failed ends failed with the refund wording,
 * and done alone sets the output (and the hub asset); a
 * transient network error keeps polling (commented on the code)
 * and the interval is cleared on cleanup. The result UI renders
 * only when status is done AND an output URL exists.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LufsPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("analyze — free, and the result sets only after ok", () => {
  const body = slice(src, "async function analyzeFile(f: File) {", "async function pickFile");

  it("decline returns to idle; non-ok is failed with the server's message", () => {
    expect(body).toContain("skipConfirm: true, // analysis is free");
    expect(body).toContain("if (!res) {");
    expect(body).toContain('setStatus("idle");');
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setStatus("failed");');
    expect(body).toContain("Could not analyze this file. Try another audio file.");
  });

  it("the analysis is set only after the ok check; a network failure is its own error", () => {
    expect(body.indexOf("setAnalysis(data);")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain('setError(t("lufs.errorNetwork"');
  });
});

describe("normalize start — decline / 402 / non-ok are separate endings", () => {
  const body = slice(src, "async function startNormalize() {", "/* A/B toggle");

  it("decline returns to idle; 402 is out-of-credits, also idle — not failed", () => {
    expect(body).toContain("} // user cancelled the credit confirmation");
    expect(body).toContain("if (res.status === 402) {");
    const ooc = slice(body, "if (res.status === 402) {", "if (!res.ok || !data.jobId) {");
    expect(ooc).toContain("setOutOfCredits(true);");
    expect(ooc).toContain('setStatus("idle");');
    expect(ooc).not.toContain('setStatus("failed");');
  });

  it("a non-ok or jobId-less answer is failed; queued is set only from a proven jobId", () => {
    expect(body).toContain("if (!res.ok || !data.jobId) {");
    expect(body.indexOf("setJobId(data.jobId);")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.jobId) {"));
    expect(body.indexOf('setStatus("queued");')).toBeGreaterThan(body.indexOf("setJobId(data.jobId);"));
    expect(body).toContain('if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);');
  });
});

describe("the poll — real terminal states, interval cleaned up", () => {
  const body = slice(src, 'if (!jobId || (status !== "queued"', "}, [jobId, status, addAsset, t, targetLufs]);");

  it("it runs only while queued/processing, and a non-ok answer ends failed", () => {
    expect(body).toContain('if (!jobId || (status !== "queued" && status !== "processing")) return;');
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setStatus("failed");');
    expect(body).toContain("Job not found — it may have expired.");
  });

  it("done alone sets the output and the hub asset; failed carries the refund wording", () => {
    expect(body.indexOf("setOutputUrl(data.outputUrl ?? null);")).toBeGreaterThan(body.indexOf('if (data.status === "done") {'));
    expect(body.indexOf("addAsset({")).toBeGreaterThan(body.indexOf('if (data.status === "done") {'));
    expect(body).toContain('} else if (data.status === "failed") {');
    expect(body).toContain("Normalization failed — you were refunded.");
  });

  it("transient network errors keep polling (on the code); cleanup clears the interval", () => {
    expect(body).toContain("/* keep polling on transient network errors */");
    expect(body).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
  });

  it("the result UI is gated on done AND an output URL", () => {
    expect(src).toContain("{status === \"done\" && outputUrl && (");
  });
});
