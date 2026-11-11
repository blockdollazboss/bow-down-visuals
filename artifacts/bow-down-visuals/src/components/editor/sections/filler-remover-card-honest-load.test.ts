/**
 * FillerRemoverCard — honest load standard (deep-pins tranche 4,
 * batch B). Both phases are poll jobs owned by useEffects whose
 * cleanup clears the interval, so each poll ends on phase change
 * or unmount as well as on its own outcomes. Analyze (paid,
 * 200 VB): a decline returns with nothing charged, 402 is the
 * OutOfCredits panel, non-ok or a jobId-less answer throws into
 * the error line, the analyzing phase starts only from a
 * returned jobId, and creditsRemaining is recorded only when the
 * answer actually carries a number. The analyze poll separates
 * failure from honest-empty: non-ok and failed return to idle
 * with the error, while a done job enters review even with zero
 * cuts — where the review phase renders its own no-cuts panel —
 * so "nothing found" can only follow a completed analysis. The
 * render (free, covered by the analysis charge) refuses with no
 * enabled cuts, and its poll sets the output, the hub asset and
 * the toast only behind `status === "done" && data.outputUrl`;
 * failure returns to review with the error.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FillerRemoverCard.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("analyze — decline / 402 / jobId-less are separate endings before the phase starts", () => {
  it("the analyzing phase and the credits figure land only from a checked answer", () => {
    const body = slice(src, "async function startAnalyze() {", "const enabledCuts =");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok || !data.jobId) {");
    expect(body.indexOf('setPhase("analyzing");')).toBeGreaterThan(body.indexOf("if (!res.ok || !data.jobId) {"));
    expect(body).toContain('if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);');
  });
});

describe("analyze poll — failure returns to idle; a done job with zero cuts is honestly empty in review", () => {
  it("non-ok and failed carry the error; done carries the cuts into review", () => {
    const body = slice(src, "/* Poll the analyze job. */", "/* Poll the render job. */");
    expect(body).toContain('setError(apiErrorMessage(data, t("fillerRemover.errorAnalyze")));');
    expect(body).toContain('if (data.status === "done") {');
    expect(body.indexOf("setCuts(list);")).toBeGreaterThan(body.indexOf('if (data.status === "done") {'));
    expect(body).toContain('setPhase("review");');
    expect(body).toContain('} else if (data.status === "failed") {');
    expect(body).toContain('setPhase("idle");');
    expect(body).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
    expect(src).toContain("{cuts.length === 0 ? (");
    expect(src).toContain('t("fillerRemover.noCutsTitle")');
  });
});

describe("render poll — done requires an output url before anything is claimed", () => {
  it("the render refuses with no enabled cuts and starts only from a jobId", () => {
    const body = slice(src, "async function startRender() {", "function toggleCut");
    expect(body).toContain("if (!analyzeJobId || enabledCuts.length === 0 || phase === \"rendering\") return;");
    expect(body).toContain("// Render is covered by the analysis charge — no second confirmation.");
    expect(body).toContain("if (!res.ok || !data.jobId) {");
    expect(body.indexOf('setPhase("rendering");')).toBeGreaterThan(body.indexOf("if (!res.ok || !data.jobId) {"));
  });

  it("done+url gates the output, the hub asset and the toast; failure returns to review", () => {
    const body = slice(src, "/* Poll the render job. */", "function toggleWord");
    expect(body).toContain('if (data.status === "done" && data.outputUrl) {');
    expect(body.indexOf("setOutputUrl(url);")).toBeGreaterThan(body.indexOf('if (data.status === "done" && data.outputUrl) {'));
    expect(body.indexOf('setPhase("done");')).toBeGreaterThan(body.indexOf("setOutputUrl(url);"));
    expect(body).toContain('} else if (data.status === "failed") {');
    expect(body).toContain('setPhase("review");');
  });
});
