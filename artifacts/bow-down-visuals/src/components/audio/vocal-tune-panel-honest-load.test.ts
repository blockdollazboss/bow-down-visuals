/**
 * VocalTunePanel — honest load standard (deep-pins
 * tranche 5). PINNED POST-FIX. THE FIX (this tranche): the
 * status poll used to set "done" even when outputUrl was
 * null — but the result renders only on done + outputUrl,
 * the form only on idle/failed, and busy covers only
 * uploading/queued/processing, so a done-without-url (or an
 * unknown status) stranded the panel on a blank trap; and
 * transient poll throws retried without bound. Now: done
 * requires an outputUrl, else the job fails with
 * vocalTune.errorDoneNoResult; an unknown status fails
 * terminally with errorTuneFailed; consecutive poll
 * transport failures are counted and the 20th fails the job
 * with errorNetwork (≈1 min of unreadable polls); any
 * readable poll resets the counter. The start was already
 * honest: cancel is silent, 402 is out-of-credits, and a
 * non-ok / jobId-less start fails before the job id is
 * kept; the poll effect cleans up its interval on every
 * status change.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VocalTunePanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — the poll can never strand the panel", () => {
  it("done without an outputUrl fails with the done-no-result line, before done can be set", () => {
    const body = slice(src, "pollRef.current = window.setInterval(async () => {", "}, [jobId, status, style, addAsset, t]);");
    expect(body).toContain('if (data.status === "done") {');
    expect(body).toContain("if (!data.outputUrl) {");
    expect(body).toContain('setError(t("vocalTune.errorDoneNoResult", { defaultValue: "Tuning finished without a result — your Visual Bucs were refunded." }));');
    expect(body.indexOf("if (!data.outputUrl) {")).toBeLessThan(body.indexOf('setStatus("done");'));
    expect(body.indexOf('setError(t("vocalTune.errorDoneNoResult"')).toBeLessThan(body.indexOf('setStatus("done");'));
  });

  it("only queued/processing continue; an unknown status fails terminally", () => {
    const body = slice(src, "pollRef.current = window.setInterval(async () => {", "}, [jobId, status, style, addAsset, t]);");
    expect(body).toContain('} else if (data.status === "queued" || data.status === "processing") {');
    expect(body).toContain("setStatus(data.status);");
    const elsePart = slice(body, '} else if (data.status === "queued" || data.status === "processing") {', "} catch {");
    expect(elsePart).toContain('setStatus("failed");');
    expect(elsePart).toContain('t("vocalTune.errorTuneFailed"');
  });

  it("transient poll failures are bounded: the counter resets on any readable poll, the 20th failure ends the job", () => {
    expect(src).toContain("const pollFailuresRef = useRef(0);");
    const body = slice(src, "pollRef.current = window.setInterval(async () => {", "}, [jobId, status, style, addAsset, t]);");
    expect(body).toContain("pollFailuresRef.current = 0;");
    const catchPart = slice(body, "} catch {", "}, 3000);");
    expect(catchPart).toContain("pollFailuresRef.current += 1;");
    expect(catchPart).toContain("if (pollFailuresRef.current >= 20) {");
    expect(catchPart).toContain('setStatus("failed");');
    expect(catchPart).toContain('t("vocalTune.errorNetwork"');
    // a fresh tune starts with a clean counter
    const start = slice(src, "async function startTune() {", "const form = new FormData();");
    expect(start).toContain("setOutOfCredits(false);");
    expect(start).toContain("pollFailuresRef.current = 0;");
    expect(start.indexOf("setOutOfCredits(false);")).toBeLessThan(start.indexOf("pollFailuresRef.current = 0;"));
  });

  it("the render gates make the trap impossible: result needs done + url, the form returns on failed", () => {
    expect(src).toContain('{status === "done" && outputUrl && (');
    expect(src).toContain('{status === "idle" || status === "failed" ? (');
    expect(src).toContain('const busy = status === "uploading" || status === "queued" || status === "processing";');
  });
});

describe("the start, pinned briefly", () => {
  it("cancel silent; 402 is out-of-credits; !ok or a missing jobId fails before the job id is kept", () => {
    const body = slice(src, "async function startTune() {", "function reset() {");
    expect(body).toContain('if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation');
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok || !data.jobId) {");
    expect(body).toContain('setError(apiErrorMessage(data, t("vocalTune.errorStartFailed", { defaultValue: "Couldn\'t start tuning. Please try again." })));');
    expect(body).toContain("setJobId(data.jobId);");
    expect(body.indexOf('if (!res) { setStatus("idle"); return; }')).toBeLessThan(body.indexOf("if (res.status === 402) {"));
    expect(body.indexOf("if (!res.ok || !data.jobId) {")).toBeLessThan(body.indexOf("setJobId(data.jobId);"));
    const failBlock = slice(body, "if (!res.ok || !data.jobId) {", "setJobId(data.jobId);");
    expect(failBlock).toContain('setStatus("failed");');
    expect(failBlock).toContain("return;");
  });
});
