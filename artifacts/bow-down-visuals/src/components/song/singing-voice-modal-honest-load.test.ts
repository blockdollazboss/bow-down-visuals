/**
 * SingingVoiceModal — honest load standard (deep-pins tranche 4,
 * batch B-fix). The start flow has four honest endings before any
 * polling begins: a declined credit confirmation returns to the
 * form with nothing charged, 402 lands the out-of-credits panel
 * and the form, 503 lands the not-configured error and the form,
 * and any other non-ok answer (or an ok answer with no job id)
 * throws into the start-failed error. The poll is just as strict:
 * a non-ok poll response is TERMINAL — the interval clears, the
 * pollFailed error shows, and the phase returns to the form before
 * any status branch runs. A "done" status only reaches the done
 * phase with a real output URL; done-without-a-result is its own
 * error, failed is the refunded error, and transient poll errors
 * get a bounded grace of five before the poll gives up. On open,
 * the gate/catalog probe only sets configured/voices from ok
 * responses — a failure leaves the gate closed — and the poll
 * interval never outlives the modal.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SingingVoiceModal.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("start — decline / 402 / 503 / no-job are four endings, none charged or polling", () => {
  it("decline returns to the form; 402 and 503 land their named endings before the throw", () => {
    const body = slice(src, "async function startConversion() {", "function useInSong() {");
    expect(body).toContain('if (!res) { setPhase("form"); return; } // user cancelled the credit confirmation');
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain('setError(apiErrorMessage(data, t("singingVoice.notConfiguredError", { defaultValue: "Singing-voice conversion isn\'t connected yet." })));');
    expect(body).toContain('if (!res.ok || !data.jobId) throw new Error(apiErrorMessage(data, "Conversion failed to start"));');
    expect(body.indexOf("if (res.status === 402) {")).toBeLessThan(body.indexOf("if (res.status === 503) {"));
    expect(body.indexOf("if (res.status === 503) {")).toBeLessThan(body.indexOf("if (!res.ok || !data.jobId) throw"));
    // The 402 and 503 endings each return to the form before falling through.
    const s402 = slice(body, "if (res.status === 402) {", "if (res.status === 503) {");
    expect(s402).toContain('setPhase("form");');
    expect(s402).toContain("return;");
    const s503 = slice(body, "if (res.status === 503) {", "if (!res.ok || !data.jobId) throw");
    expect(s503).toContain('setPhase("form");');
    expect(s503).toContain("return;");
  });

  it("a thrown start lands the start-failed error and the form", () => {
    const body = slice(src, "async function startConversion() {", "function useInSong() {");
    expect(body).toContain('setError(plainErrorText(e, t("singingVoice.startFailed", { defaultValue: "Could not start conversion." })));');
    expect(body.indexOf('t("singingVoice.startFailed"')).toBeGreaterThan(body.indexOf("if (!res.ok || !data.jobId) throw"));
  });
});

describe("poll — a refused poll is terminal, and done needs a real result", () => {
  const poll = slice(src, "pollRef.current = window.setInterval(async () => {", "}, 3000);");

  it("the non-ok poll block clears, errors with pollFailed, and returns to the form BEFORE any status branch", () => {
    expect(poll).toContain("if (!pr.ok) {");
    const refused = slice(poll, "if (!pr.ok) {", 'pd.status === "done"');
    expect(refused).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
    expect(refused).toContain('setError(apiErrorMessage(pd, t("singingVoice.pollFailed", { defaultValue: "Couldn\'t check the conversion — please try again." })));');
    expect(refused).toContain('setPhase("form");');
    expect(refused).toContain("return;");
    expect(poll.indexOf("if (!pr.ok) {")).toBeLessThan(poll.indexOf('pd.status === "done"'));
    expect(poll.indexOf("if (!pr.ok) {")).toBeLessThan(poll.indexOf('pd.status === "failed"'));
  });

  it("done reaches the done phase only with an output URL; done without one is the doneNoResult error", () => {
    expect(poll).toContain('if (pd.status === "done" && pd.outputUrl) {');
    const doneOk = slice(poll, 'if (pd.status === "done" && pd.outputUrl) {', '} else if (pd.status === "done") {');
    expect(doneOk).toContain("setOutputUrl(pd.outputUrl);");
    expect(doneOk).toContain('setPhase("done");');
    const doneEmpty = slice(poll, '} else if (pd.status === "done") {', '} else if (pd.status === "failed") {');
    expect(doneEmpty).toContain('setError(t("singingVoice.doneNoResult", { defaultValue: "The conversion finished without a result — please try again." }));');
    expect(doneEmpty).toContain('setPhase("form");');
    expect(doneEmpty).not.toContain('setPhase("done")');
    expect(poll.indexOf('pd.status === "done" && pd.outputUrl')).toBeLessThan(poll.indexOf('} else if (pd.status === "done") {'));
  });

  it("failed status lands the failedRefunded error and the form", () => {
    const failed = slice(poll, '} else if (pd.status === "failed") {', "} else {");
    expect(failed).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
    expect(failed).toContain('setError(apiErrorMessage(pd, t("singingVoice.failedRefunded", { defaultValue: "Conversion failed — credits refunded." })));');
    expect(failed).toContain('setPhase("form");');
  });

  it("transient poll errors are bounded: the counter resets on a good poll and gives up at five", () => {
    const body = slice(src, "async function startConversion() {", "function useInSong() {");
    expect(body).toContain("let pollFailures = 0;");
    expect(body.indexOf("let pollFailures = 0;")).toBeLessThan(body.indexOf("pollRef.current = window.setInterval"));
    // A successful (ok) poll resets the streak before the status branches.
    expect(poll).toContain("pollFailures = 0;");
    expect(poll.indexOf("pollFailures = 0;")).toBeGreaterThan(poll.indexOf("if (!pr.ok) {"));
    expect(poll.indexOf("pollFailures = 0;")).toBeLessThan(poll.indexOf('pd.status === "done"'));
    const catcher = poll.slice(poll.indexOf("} catch {"));
    expect(catcher).toContain("pollFailures += 1;");
    expect(catcher).toContain("if (pollFailures >= 5) {");
    expect(catcher).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
    expect(catcher).toContain('setError(t("singingVoice.pollFailed", { defaultValue: "Couldn\'t check the conversion — please try again." }));');
    expect(catcher).toContain('setPhase("form");');
  });
});

describe("lifecycle — the poll never outlives the modal, and the gate probe fails closed", () => {
  it("unmount cleanup clears the poll interval", () => {
    const cleanup = slice(src, "// The conversion poll never outlives the modal.", "// Reset when opened for a new source;");
    expect(cleanup).toContain("useEffect(() => () => {");
    expect(cleanup).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
    expect(cleanup).toContain("}, []);");
  });

  it("configured/voices set only on ok responses; checking clears in finally and failure leaves the gate closed", () => {
    const probe = slice(src, "// Reset when opened for a new source; load gate + catalog.", "if (!open || !source) return null;");
    expect(probe).toContain("if (sRes.ok) {");
    expect(probe).toContain("setConfigured(s.configured === true);");
    expect(probe).toContain("if (vRes.ok) {");
    expect(probe).toContain("setVoices(v.voices ?? []);");
    expect(probe.indexOf("setConfigured(s.configured === true);")).toBeGreaterThan(probe.indexOf("if (sRes.ok) {"));
    expect(probe.indexOf("setVoices(v.voices ?? []);")).toBeGreaterThan(probe.indexOf("if (vRes.ok) {"));
    expect(probe).toContain("/* gate stays closed */");
    expect(probe).toContain("} finally {");
    expect(probe).toContain("setChecking(false);");
    expect(probe.indexOf("setChecking(false);")).toBeGreaterThan(probe.indexOf("/* gate stays closed */"));
    // setConfigured / setVoices appear nowhere in the probe outside their ok guards.
    expect(probe.match(/setConfigured\(/g)).toHaveLength(1);
    expect(probe.match(/setVoices\(/g)).toHaveLength(1);
  });
});
