/**
 * CaptionStylerBench (World native) — honest load standard
 * (deep-pins tranche 5). A server-owned job with a status
 * poll (the page's own poll, same cadence). The poll's
 * endings are honest: a non-ok poll fails the job with the
 * server's words; an unparseable poll body fails it too; a
 * server "failed" status fails it with the rail's message.
 * The result block renders ONLY on done + outputUrl, so no
 * success is ever claimed without a video in hand; a
 * done-without-url leaves the bench's always-live form in
 * place (nothing claimed, nothing trapped — the member can
 * run again) rather than a dressed-up result. Transient
 * poll throws keep polling by design (the job lives on the
 * server; closing the bench loses nothing). The start:
 * declined confirmation returns to idle silently, 402 is
 * out-of-credits at idle, and a start that answers without
 * a job fails with the start error.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CaptionStylerBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the poll — failures are terminal and named", () => {
  it("!ok fails with the server's words; an unparseable body fails; a failed job fails; done sets the url it carries", () => {
    const body = slice(src, "pollRef.current = window.setInterval(async () => {", "function pickFile(");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setStatus("failed");');
    expect(body).toContain('setError(apiErrorMessage(data, t("captionStyler.errorJobNotFound")));');
    expect(body).toContain("const job = captionStylerJobOf(data);");
    expect(body).toContain("if (!job) {");
    expect(body).toContain('setError(t("captionStyler.errorJobFailed"));');
    expect(body).toContain('if (job.status === "done") {');
    expect(body).toContain('setStatus("done");');
    expect(body).toContain("setOutputUrl(job.outputUrl);");
    expect(body).toContain('} else if (job.status === "failed") {');
    // the hub asset is added only when a url actually exists
    expect(body).toContain("if (job.outputUrl) {");
    expect(body.indexOf('setStatus("done");')).toBeLessThan(body.indexOf("if (job.outputUrl) {"));
    // the poll only runs while the job is in a busy status, and cleans up
    expect(src).toContain("if (!jobId || !isCaptionStylerBusyStatus(status)) return;");
    expect(src).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
  });

  it("the result block needs done AND a url — no url, no claimed video", () => {
    expect(src).toContain('{status === "done" && outputUrl && (');
    expect(src).toContain('data-testid="world-caption-styler-result"');
    expect(src).toContain('{t("captionStyler.doneTitle")}');
  });
});

describe("the start — a job exists only from a parsed start answer", () => {
  it("declined returns to idle; 402 out at idle; ok-without-a-job fails with the start error", () => {
    const body = slice(src, "async function startStyling() {", "return (");
    expect(body).toContain("if (!res) { setStatus(\"idle\"); return; } // spend confirmation declined — nothing ran");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("const started = captionStylerStartedOf(data);");
    expect(body).toContain("if (!res.ok || !started) {");
    expect(body).toContain('setError(apiErrorMessage(data, t("captionStyler.errorStartFailed")));');
    expect(body).toContain("setJobId(started.jobId);");
    expect(body.indexOf("if (!res.ok || !started) {")).toBeLessThan(body.indexOf("setJobId(started.jobId);"));
    const catchPart = slice(body, "} catch {", "setBusy");
    expect(catchPart).toContain('setError(t("captionStyler.errorNetwork"));');
  });
});
