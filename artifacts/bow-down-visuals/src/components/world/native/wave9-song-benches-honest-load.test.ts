/**
 * Wave9SongBenches — honest load standard (deep-pins tranche 4,
 * batch D). Neither bench loads a collection — the standard
 * lands on the two paid runs, Song Structure Builder and
 * Lyrics-to-Timeline, which share one shape: a form gate refuses
 * before any call; a declined spend confirmation returns with
 * nothing run; 402 is the named out-of-credits ending; a non-ok
 * answer — or an ok answer the seam's parser can't read — lands
 * the error line and RETURNS, so the result state is set only
 * from a parsed answer, and the hub-tray addAsset rides after
 * it as a non-fatal bonus. The lyrics bench's empty state is a
 * pre-run state only: it renders while idle with no lines AND
 * no error, so a failed run never dresses up as "nothing here."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./Wave9SongBenches.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("Song Structure Builder — the arrangement lands only from a parsed answer", () => {
  const bench = slice(src, "export function Wave9StructureBench", "/* ─── Lyrics-to-Timeline");

  it("gate, decline, 402, non-ok/unparseable are separate endings, in order", () => {
    expect(bench).toContain("if (busy || sections.length === 0) return;");
    expect(bench).toContain("if (!res) { setPhase(\"idle\"); return; } // spend confirmation declined — nothing ran");
    expect(bench).toContain("if (res.status === 402) {");
    expect(bench).toContain("setOutOfCredits(true);");
    expect(bench).toContain("const arrangement = wave9ArrangementOf(data);");
    expect(bench).toContain("if (!res.ok || !arrangement) {");
    expect(bench).toContain('setError(apiErrorMessage(data, t("wave9.structure.errorGeneric")));');
    expect(bench.indexOf("if (!res) {")).toBeLessThan(bench.indexOf("if (res.status === 402) {"));
    expect(bench.indexOf("if (res.status === 402) {")).toBeLessThan(bench.indexOf("if (!res.ok || !arrangement) {"));
  });

  it("the result is set only after the ok + parse guard", () => {
    expect(bench.indexOf("setResult(arrangement);")).toBeGreaterThan(bench.indexOf("if (!res.ok || !arrangement) {"));
    expect(bench).toContain('setPhase("done");');
    expect(bench).toContain("{phase === \"done\" && result && (");
    expect(bench).toContain('data-testid="world-wave9-structure-result"');
  });

  it("a thrown run lands the generic error, never a result", () => {
    expect(bench).toContain('setError(t("wave9.structure.errorGeneric"));');
  });
});

describe("Lyrics-to-Timeline — the timed lines land only from a parsed answer", () => {
  const bench = slice(src, "export function Wave9LyricsBench", "dummy-end-marker");

  it("gate, decline, 402, non-ok/unparseable are separate endings", () => {
    expect(bench).toContain("if (busy || !lyrics.trim()) return;");
    expect(bench).toContain("if (!res) { setPhase(\"idle\"); return; } // spend confirmation declined — nothing ran");
    expect(bench).toContain("if (res.status === 402) {");
    expect(bench).toContain("const timed = wave9TimedLinesOf(data);");
    expect(bench).toContain("if (!res.ok || !timed) {");
    expect(bench).toContain('setError(apiErrorMessage(data, t("wave9.timeline.errorGeneric")));');
    expect(bench.indexOf("setLines(timed);")).toBeGreaterThan(bench.indexOf("if (!res.ok || !timed) {"));
  });

  it("the empty state is pre-run only — idle, no lines, and no error", () => {
    expect(bench).toContain('{phase === "idle" && lines.length === 0 && !error && (');
    expect(bench).toContain('message={t("worldWave9Bench.lyricsEmpty")}');
    expect(bench).toContain('{phase === "done" && lines.length > 0 && (');
  });
});

describe("the shared notices — credits and error are their own lines", () => {
  it("out-of-credits names the feature; an error with a retry renders the error state", () => {
    expect(src).toContain('t("worldBenches300.outOfBucs", { feature })');
    expect(src).toContain("<NativeErrorState isLight={isLight} message={error} onRetry={onRetry} />");
  });
});
