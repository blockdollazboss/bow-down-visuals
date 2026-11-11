/**
 * DeverbPanel — honest load standard (deep-pins tranche 4,
 * batch C). A Pattern-B job tool behind a provider gate. The
 * gate read: a non-ok or failed status fetch leaves the gate
 * null, and null is CLOSED — the render order is checking
 * spinner → gated banner (naming provider-missing vs
 * pricing-pending vs unknown) → the processing UI only when the
 * gate proves enabled, so an unknown gate state never presents
 * as a working tool (and there is no fake DSP fallback). Start
 * (1,000 VB): a decline returns to idle, 503 is the
 * provider-not-configured ending, 402 splits pricing-pending
 * (failed, with the server's words) from out-of-credits (idle),
 * a non-ok or jobId-less answer is failed, and queued is set
 * only from a proven jobId. The poll mirrors LUFS: non-ok ends
 * failed, done alone sets the output + hub asset, failed ends
 * failed, transient network errors keep polling, interval
 * cleaned up.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DeverbPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the provider gate — an unproven gate is a closed gate", () => {
  it("the gate is set only from an ok status answer; failure leaves it null and ends loading", () => {
    const body = slice(src, "let cancelled = false;", "}, []);");
    expect(body).toContain('if (!res.ok) throw new Error("status failed");');
    expect(body.indexOf("setGate(data);")).toBeGreaterThan(body.indexOf('if (!res.ok) throw'));
    expect(body).toContain("if (!cancelled) setGate(null);");
    expect(body).toContain("if (!cancelled) setGateLoading(false);");
  });

  it("render order: checking → gated banner → processing UI only when enabled", () => {
    expect(src).toContain("const gated = gateLoading ? true : !gate?.enabled;");
    expect(src.indexOf("{gateLoading ? (")).toBeLessThan(src.indexOf(") : gated ? ("));
    expect(src).toContain('gate?.reason === "provider_not_configured"');
    expect(src).toContain('gate?.reason === "pricing_pending"');
    expect(src).toContain('t("deverb.gatedUnknown")');
  });
});

describe("start — decline / 503 / 402-split / non-ok are separate endings", () => {
  const body = slice(src, "async function startDeverb() {", "function reset() {");

  it("a decline returns to idle with nothing charged", () => {
    expect(body).toContain("if (!res) { setStatus(\"idle\"); return; } // user cancelled the credit confirmation");
  });

  it("503 is the provider ending; 402 splits pricing-pending from out-of-credits", () => {
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain('setError(apiErrorMessage(data, t("deverb.errorProviderNotConfigured")));');
    expect(body).toContain('const isPricingPending = data.error === "pricing_pending";');
    expect(body).toContain("setOutOfCredits(!isPricingPending);");
    expect(body).toContain('setStatus(isPricingPending ? "failed" : "idle");');
  });

  it("a non-ok or jobId-less answer is failed; queued is set only from a proven jobId", () => {
    expect(body).toContain("if (!res.ok || !data.jobId) {");
    expect(body.indexOf("setJobId(data.jobId);")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.jobId) {"));
    expect(body.indexOf('setStatus("queued");')).toBeGreaterThan(body.indexOf("setJobId(data.jobId);"));
    expect(body).toContain('if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);');
  });
});

describe("the poll — real terminal states, interval cleaned up", () => {
  const body = slice(src, 'if (!jobId || (status !== "queued"', "}, [jobId, status, mode, addAsset, t]);");

  it("a non-ok poll answer ends failed; done alone sets the output and the hub asset", () => {
    expect(body).toContain('if (!jobId || (status !== "queued" && status !== "processing")) return;');
    expect(body).toContain("if (!res.ok) {");
    expect(body.indexOf("setOutputUrl(data.outputUrl ?? null);")).toBeGreaterThan(body.indexOf('if (data.status === "done") {'));
    expect(body.indexOf("addAsset({")).toBeGreaterThan(body.indexOf('if (data.status === "done") {'));
    expect(body).toContain('} else if (data.status === "failed") {');
    expect(body).toContain('setError(apiErrorMessage(data, t("deverb.errorDeverbFailed")));');
  });

  it("transient network errors keep polling (on the code); cleanup clears the interval", () => {
    expect(body).toContain("/* keep polling on transient network errors */");
    expect(body).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
  });

  it("the result UI is gated on done AND an output URL", () => {
    expect(src).toContain("{status === \"done\" && outputUrl && (");
  });
});
