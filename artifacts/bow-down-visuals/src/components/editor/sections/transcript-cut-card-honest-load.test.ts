/**
 * TranscriptCutCard — honest load standard (deep-pins tranche 4,
 * batch B). Both phases are poll jobs owned by useEffects whose
 * cleanup clears the interval, so a poll ends on phase change or
 * unmount as well as on its own outcomes. Analyze (paid): a
 * decline returns with nothing charged, 402 is the OutOfCredits
 * panel, non-ok or a jobId-less answer throws into the error
 * line, and the analyzing phase starts only from a returned
 * jobId. The analyze poll separates its endings: non-ok and
 * failed land back at idle with the refunded-failure error, while
 * a done job with zero words goes to the dedicated noWords phase
 * — the pane says word editing is off for this clip rather than
 * inventing an alignment — and only a done job WITH words enters
 * review. Render (free, covered by the analysis charge): the
 * done phase, the output url, the hub asset and the toast all sit
 * behind `status === "done" && data.outputUrl`; failure returns
 * to review with the error.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TranscriptCutCard.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("analyze — decline / 402 / jobId-less are separate endings before the phase starts", () => {
  it("the analyzing phase is set only after the jobId check", () => {
    const body = slice(src, "async function startAnalyze() {", "/* Poll the analyze job. */");
    expect(body).toContain("if (!res) return; /* credit confirmation cancelled */");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok || !data.jobId) {");
    expect(body.indexOf('setPhase("analyzing");')).toBeGreaterThan(body.indexOf("if (!res.ok || !data.jobId) {"));
  });
});

describe("analyze poll — failure, honest-empty (no words) and loaded stay separate", () => {
  it("non-ok and failed return to idle with the refunded error; done-with-no-words is its own phase", () => {
    const body = slice(src, "/* Poll the analyze job. */", "async function startRender() {");
    expect(body).toContain('setError(apiErrorMessage(data, "Transcription failed — the charge was refunded."));');
    expect(body).toContain('if (data.status === "done") {');
    expect(body).toContain("if (list.length === 0) {");
    expect(body).toContain('setPhase("noWords");');
    expect(body).toContain('setPhase("review");');
    expect(body).toContain('} else if (data.status === "failed") {');
    expect(body).toContain("if (pollRef.current) window.clearInterval(pollRef.current);");
    expect(src).toContain("word editing is off for this clip.");
  });
});

describe("render poll — done requires an output url before anything is claimed", () => {
  it("the render phase starts only from a jobId; done+url gates the result, asset and toast", () => {
    const start = slice(src, "async function startRender() {", "/* Poll the render job. */");
    expect(start).toContain("/* Render is covered by the analysis charge — no second confirmation. */");
    expect(start).toContain("if (!res.ok || !data.jobId) {");
    expect(start.indexOf('setPhase("rendering");')).toBeGreaterThan(start.indexOf("if (!res.ok || !data.jobId) {"));
    const poll = slice(src, "/* Poll the render job. */", "function onWordClick");
    expect(poll).toContain('if (data.status === "done" && data.outputUrl) {');
    expect(poll.indexOf("setOutputUrl(url);")).toBeGreaterThan(poll.indexOf('if (data.status === "done" && data.outputUrl) {'));
    expect(poll.indexOf('setPhase("done");')).toBeGreaterThan(poll.indexOf("setOutputUrl(url);"));
    expect(poll).toContain('} else if (data.status === "failed") {');
    expect(poll).toContain('setPhase("review");');
  });
});
