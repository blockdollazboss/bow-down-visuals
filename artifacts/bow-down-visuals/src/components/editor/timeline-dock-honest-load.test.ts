/**
 * TimelineDock — honest load standard (deep-pins tranche 5).
 * The dock itself is props-driven (scenes/settings arrive
 * from the editor), so the pinned surfaces are its three
 * network seams. (1) The freeze-frame job: cancel is silent,
 * 402 is out-of-Bucs, the start must answer 202 + jobId, and
 * the poll is BOUNDED (150 × 2s ≈ 5 min) — "done" requires a
 * url, "failed" throws the server's words, and the bound
 * itself throws a timed-out error; the busy flag settles in
 * finally. (2) The beat grid: detectBeatGrid catches
 * internally and resolves null on any failure, so the
 * loading flag always clears and no-grid is an honest state,
 * never a spinner. (3) Clip replace: the success toast
 * lands only after uploadClipDirect resolves.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TimelineDock.tsx");
const beat = read("../../lib/beat-grid.ts");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the freeze job — bounded poll, url-gated done", () => {
  it("poll: 150 bounded rounds; done needs a url; failed throws; the bound throws timed-out", () => {
    const body = slice(src, "async function pollFreezeJob(jobId: string): Promise<void> {", "/* ── Freeze a clip at an index");
    expect(body).toContain("for (let i = 0; i < 150; i++) {");
    expect(body).toContain('if (!res) throw new Error(t("videoEditor.freezePollCancelled"));');
    expect(body).toContain('if (body.status === "done" && body.url) {');
    expect(body).toContain("setFreezeResult(body.url as string);");
    expect(body).toContain('if (body.status === "failed") throw new Error(apiErrorMessage(body, t("videoEditor.freezeRenderFailed")));');
    expect(body).toContain('throw new Error(t("videoEditor.freezeTimedOut"));');
    expect(body.indexOf('if (body.status === "done" && body.url) {')).toBeLessThan(
      body.indexOf('throw new Error(t("videoEditor.freezeTimedOut"));'),
    );
  });

  it("start: cancel silent; 402 is out-of-Bucs; anything but 202 + jobId throws; busy settles in finally", () => {
    const body = slice(src, "const freezeClipAt = useCallback(async (idx: number) => {", "async function doFreeze() {");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain('t("videoEditor.freezeOutOfBucs")');
    expect(body).toContain('if (res.status !== 202 || !body.jobId) throw new Error(apiErrorMessage(body, t("videoEditor.freezeStartFailed")));');
    expect(body).toContain("await pollFreezeJob(body.jobId as string);");
    expect(body.indexOf("if (res.status !== 202 || !body.jobId) throw new Error(")).toBeLessThan(
      body.indexOf("await pollFreezeJob(body.jobId as string);"),
    );
    const finallyPart = slice(body, "} finally {", "async function doFreeze() {");
    expect(finallyPart).toContain("setFreezeBusy(false);");
  });
});

describe("the beat grid — failure resolves to an honest no-grid", () => {
  it("detectBeatGrid never rejects: !ok and throws both resolve null, so beatLoading always clears", () => {
    expect(beat).toContain("if (!res.ok) return null;");
    expect(beat).toContain("return null;");
    const body = slice(src, "detectBeatGrid(audioUrl, audioDuration).then((grid) => {", "return () => { alive = false; };");
    expect(body).toContain("setBeatGrid(grid);");
    expect(body).toContain("setBeatLoading(false);");
    expect(src).toContain('beatGrid ? `${beatGrid.bpm.toFixed(0)} BPM detected` : beatLoading ? "Detecting beat grid…" : "No beat grid"');
  });
});

describe("clip replace — success toast only after the upload resolves", () => {
  it("the replaced toast sits after uploadClipDirect; failures toast the error", () => {
    const body = slice(src, "const data = await uploadClipDirect(file, token);", "}, [replaceTargetId, onReplaceClipVideo, toast, timelineLocked, isAdmin]);");
    expect(body).toContain('toast({ title: "Clip replaced", description: file.name });');
    expect(src.indexOf("const data = await uploadClipDirect(file, token);")).toBeLessThan(
      src.indexOf('toast({ title: "Clip replaced", description: file.name });'),
    );
  });
});
