/**
 * PodcastTranscriptEditor — honest load standard (deep-pins
 * tranche 4, batch C). Two job polls. Analyze (200 VB,
 * confirmed): a decline returns before the phase ever moves —
 * "analyzing" is entered only with a proven jobId from an ok
 * answer; a non-ok or jobId-less start throws into the error
 * line. In the poll, a parsed failed is terminal (error with
 * the refund wording, back to idle) and done alone builds the
 * result from the job's own payload and enters review; a
 * non-ok poll answer is skipped as transient — it moves nothing
 * and claims nothing — and both intervals are cleared on
 * cleanup/unmount. Render (free): gated on review/done, a
 * non-empty cut list and a live analyze job id (an expired
 * session says so instead of rendering blind); its poll's done
 * sets the output only from the payload, failed returns to
 * review with the error, and the player renders only on done
 * WITH a URL. Upload: the media URL is set only after the
 * upload resolves; failure is a destructive toast.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PodcastTranscriptEditor.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("analyze start — analyzing is entered only with a proven jobId", () => {
  const body = slice(src, "async function startAnalyze() {", "/* Poll the analyze job. */");

  it("a decline returns before any phase change; a jobId-less answer throws", () => {
    expect(body).toContain("if (!res) return; /* credit confirmation cancelled */");
    expect(body).toContain('if (!res.ok || !data?.jobId) throw new Error(apiErrorMessage(data, "Could not start the transcription."));');
    expect(body.indexOf('setPhase("analyzing");')).toBeGreaterThan(body.indexOf("if (!res.ok || !data?.jobId) throw"));
    expect(body.indexOf("setAnalyzeJobId(data.jobId);")).toBeLessThan(body.indexOf('setPhase("analyzing");'));
  });
});

describe("the analyze poll — done builds the result, failed is terminal", () => {
  const body = slice(src, "/* Poll the analyze job. */", "async function startRender() {");

  it("a non-ok poll answer moves nothing; done sets the result from the payload", () => {
    expect(body).toContain("if (!res.ok) return;");
    expect(body.indexOf("setResult({ cuts, words, durationSec: data.durationSec ?? null });")).toBeGreaterThan(
      body.indexOf('if (data.status === "done") {'),
    );
    expect(body.indexOf('setPhase("review");')).toBeGreaterThan(body.indexOf('if (data.status === "done") {'));
  });

  it("failed is terminal: refund wording, back to idle, job cleared", () => {
    expect(body).toContain('} else if (data.status === "failed") {');
    expect(body).toContain('setError(apiErrorMessage(data, "Transcription failed — the charge was refunded."));');
    expect(body).toContain('setPhase("idle");');
    expect(body).toContain("setAnalyzeJobId(null);");
  });

  it("the interval is stored and cleared on cleanup and on unmount", () => {
    expect(body).toContain("pollRef.current = setInterval(() => void tick(), 2500);");
    expect(body).toContain("if (pollRef.current) clearInterval(pollRef.current);");
    expect(src).toContain("useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);");
  });
});

describe("render — gated start, and done alone produces the player", () => {
  it("start refuses empty cuts and an expired session before any fetch", () => {
    const body = slice(src, "async function startRender() {", "const lastAnalyzeJobId = useRef");
    expect(body).toContain("if (renderCuts.length === 0) {");
    expect(body).toContain('setError("The transcription session expired — run the transcription again.");');
    expect(body).toContain("if (!res) return;");
    expect(body).toContain('if (!res.ok || !data?.jobId) throw new Error(apiErrorMessage(data, "Could not start the render."));');
    expect(body.indexOf('setPhase("rendering");')).toBeGreaterThan(body.indexOf("if (!res.ok || !data?.jobId) throw"));
  });

  it("the render poll: done sets the output from the payload; failed returns to review", () => {
    const body = slice(src, "/* Poll the render job. */", "function toggleWord(index: number) {");
    expect(body.indexOf("setOutputUrl(data.outputUrl ?? null);")).toBeGreaterThan(body.indexOf('if (data.status === "done") {'));
    expect(body).toContain('} else if (data.status === "failed") {');
    expect(body).toContain('setError(apiErrorMessage(data, "Render failed."));');
    expect(body).toContain('setPhase("review");');
    expect(body).toContain("const iv = setInterval(() => void tick(), 2500);");
    expect(body).toContain("clearInterval(iv);");
  });

  it("the player renders only on done WITH a URL", () => {
    expect(src).toContain("{phase === \"done\" && outputUrl && (");
  });
});

describe("upload — the URL is set only after the upload resolves", () => {
  it("signed-out is refused; success sets the URL; failure is a destructive toast", () => {
    const body = slice(src, "async function handleUpload(file: File) {", "async function startAnalyze() {");
    expect(body).toContain("if (!user) {");
    expect(body.indexOf("setMediaUrl(up.url);")).toBeGreaterThan(body.indexOf("const up = await uploadStemFile(user.id, file);"));
    expect(body).toContain('toast({ title: "Upload failed", description: plainErrorText(err, "Could not upload."), variant: "destructive" });');
    expect(body).toContain("setUploading(false);");
  });
});
