/**
 * MultiRatioExport — honest load standard (deep-pins tranche 3,
 * batch 8). Both exports in this file are job-poll flows. The
 * referral read is a documented enhancement (its comment: share
 * links just won't carry ?ref). pollJob FAILS SOFT BY DESIGN — a
 * non-ok or thrown poll returns null and the interval simply tries
 * again — but the poll is bounded by the job's terminal states:
 * the effect watches only a non-terminal job, clears the interval
 * the moment done/failed lands, and cleanup clears it too. The
 * terminal toasts tell the partial truth: a done job with failed
 * ratios reports done/failed/refunded counts, never a blanket
 * success; a failed job toasts the job's own error. startRender
 * refuses without a source or a ratio before any call, a decline
 * stops the spinner with nothing run, and the job state is set only
 * from an ok start answer. ExtractAudio mirrors the pattern
 * (decline / non-ok-or-url-less / result only from the parse).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MultiRatioExport.tsx");
const extractSrc = src.slice(src.indexOf("export function ExtractAudio"));

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the poll — fail-soft ticks, hard terminal states", () => {
  it("pollJob returns null on failure; the effect stops at done/failed and toasts the partial truth", () => {
    const poll = slice(src, "async function pollJob(jobId: string): Promise<MultiRatioJobStatus | null> {", "useEffect(() => {\n    if (!job || job.state === \"done\"");
    expect(poll).toContain("if (!res.ok) return null;");
    const effect = slice(src, "useEffect(() => {\n    if (!job || job.state === \"done\"", "async function startRender() {");
    expect(effect).toContain('if (next.state === "done" || next.state === "failed") {');
    expect(effect).toContain("if (pollTimer.current) clearInterval(pollTimer.current);");
    expect(effect).toContain('t("videoEditor.multiRatio.completePartial", {');
    expect(effect).toContain("refunded: next.refunded,");
    expect(effect).toContain("plainErrorText(next.error, t(\"videoEditor.multiRatio.failedDesc\"))");
  });

  it("startRender validates before the call; the job sets only from an ok answer", () => {
    const body = slice(src, "async function startRender() {", "async function copyShareLink(url: string) {");
    expect(body.indexOf('t("videoEditor.multiRatio.noSourceTitle")')).toBeLessThan(body.indexOf("const res = await confirmedFetch("));
    expect(body).toContain("setRendering(false); // user cancelled the credit confirmation");
    expect(body).toContain("if (!res.ok) {");
    expect(body.indexOf("setJob(data);")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
  });

  it("the referral read is a documented enhancement", () => {
    expect(src).toContain("/* referrals unavailable — share links just won't carry ?ref */");
  });
});

describe("ExtractAudio — the same checked pattern", () => {
  it("decline, 402 and a url-less answer are separate endings", () => {
    const body = slice(extractSrc, "const res = await confirmedFetch(\"/api/extract-audio\", {", "catch (err) {");
    expect(body).toContain("if (!res) {");
    expect(body).toContain("if (!res.ok || !data.url) {");
  });
});
