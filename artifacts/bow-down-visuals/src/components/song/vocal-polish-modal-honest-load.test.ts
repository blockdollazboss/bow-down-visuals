/**
 * VocalPolishModal (AI vocal polish) — honest action states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * - THE START gates on ok + a proven jobId before the poll
 *   begins; failures land on their own error lines.
 * - THE POLL's proven paths were honest: a non-ok poll stops
 *   with the job-not-found line; done requires the outputUrl
 *   before the done phase; failed stops with the refund
 *   truth; transient network errors keep polling BY DESIGN
 *   (the job is server-durable and the next tick retries).
 * - FIX (this tranche): the poll had the SingingVoiceModal
 *   trap (tranche 4) in its remaining form — a done-without-
 *   outputUrl or an unknown status fell through every branch
 *   and kept polling forever, and the generating phase
 *   DISABLES the close button and the overlay click, so the
 *   member was trapped in the modal with a dead job. Any
 *   non-processing remainder is now terminal: polling stops,
 *   the form phase returns, and the new
 *   vocalPolish.errorDoneNoResult line says the job finished
 *   without delivering audio (no refund is claimed — this
 *   path can't prove one).
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VocalPolishModal.tsx");

describe("the start proves the job before polling", () => {
  it("non-ok or a missing jobId lands on the start-failed line", () => {
    expect(src).toContain("if (!res.ok || !data.jobId) {");
    expect(src).toContain('setError(apiErrorMessage(data, t("vocalPolish.errorStartFailed")));');
    expect(src).toContain("pollRef.current = window.setInterval(() => void pollJob(data.jobId!), 3000);");
  });
});

describe("the poll's proven paths terminate honestly", () => {
  it("non-ok stops with not-found; done requires the url; failed states the refund truth", () => {
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain('setError(apiErrorMessage(data, t("vocalPolish.errorJobNotFound")));');
    expect(src).toContain('if (data.status === "done" && data.outputUrl) {');
    expect(src).toContain('setError(apiErrorMessage(data, t("vocalPolish.errorJobFailed", { cost: CREDIT_COST })));');
    expect(src).toContain("/* keep polling on transient network errors */");
  });

  it("the generating phase really does gate closing — the trap the fix removes", () => {
    expect(src).toContain('disabled={phase === "generating"}');
  });
});

describe("FIX: any non-processing remainder is terminal", () => {
  it("done-without-url and unknown statuses stop the poll and return to the form", () => {
    expect(src).toContain('} else if (data.status !== "processing") {');
    expect(src).toContain('setError(t("vocalPolish.errorDoneNoResult"));');
  });
});
