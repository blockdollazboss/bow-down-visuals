/**
 * Wave8HookBenches — honest load standard (deep-pins tranche 4,
 * batch D). Neither bench loads a collection — the standard
 * lands on the two paid runs, Hook Rewriter and Styled Caption
 * Burn-in, which share one shape: a form gate refuses before
 * any call (the burn bench's empty-transcript gate is an error
 * line set BEFORE the working phase, never a charge); a
 * declined spend confirmation returns with nothing run; 402 is
 * the named out-of-credits ending; a non-ok answer — or an ok
 * answer the seam's parser can't read — lands the error line
 * and RETURNS, so the result state is set only from a parsed
 * answer. Each bench's empty state renders only while not
 * busy, with no result AND no error — a failed run never
 * dresses up as "nothing here," and the burn bench's SRT/VTT
 * downloads exist only inside the parsed result block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./Wave8HookBenches.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("Hook Rewriter — the variants land only from a parsed answer", () => {
  const bench = slice(src, "export function HookRewriterBench", "/* ─── Styled Caption Burn-in");

  it("gate, decline, 402, non-ok/unparseable are separate endings, in order", () => {
    expect(bench).toContain("if (busy || !post.trim()) return;");
    expect(bench).toContain("if (!res) { setPhase(\"idle\"); return; } // spend confirmation declined — nothing ran");
    expect(bench).toContain("if (res.status === 402) {");
    expect(bench).toContain("setOutOfCredits(true);");
    expect(bench).toContain("const parsed = hookRewriterResultOf(data);");
    expect(bench).toContain("if (!res.ok || !parsed) {");
    expect(bench).toContain('setError(apiErrorMessage(data, t("wave8.hookRewriter.errorRewrite")));');
    expect(bench.indexOf("if (!res) {")).toBeLessThan(bench.indexOf("if (res.status === 402) {"));
    expect(bench.indexOf("if (res.status === 402) {")).toBeLessThan(bench.indexOf("if (!res.ok || !parsed) {"));
    expect(bench.indexOf("setResult(parsed);")).toBeGreaterThan(bench.indexOf("if (!res.ok || !parsed) {"));
  });

  it("the empty state requires not-busy, no result, and no error", () => {
    expect(bench).toContain("{!busy && !result && !error && (");
    expect(bench).toContain('message={t("worldWave8Bench.hookEmpty")}');
  });
});

describe("Styled Caption Burn-in — the styled words land only from a parsed answer", () => {
  const bench = slice(src, "export function CaptionBurnBench", "dummy-end-marker");

  it("an empty transcript is refused with its own error before the working phase", () => {
    expect(bench).toContain("if (!transcript.trim()) {");
    expect(bench).toContain('setError(t("wave8.captionStyler.errorEmpty"));');
    expect(bench.indexOf('setError(t("wave8.captionStyler.errorEmpty"));')).toBeLessThan(bench.indexOf('setPhase("working");'));
  });

  it("decline, 402, non-ok/unparseable are separate endings; the result follows the guard", () => {
    expect(bench).toContain("if (!res) { setPhase(\"idle\"); return; } // spend confirmation declined — nothing ran");
    expect(bench).toContain("if (res.status === 402) {");
    expect(bench).toContain("const parsed = wave8CaptionBurnOf(data);");
    expect(bench).toContain("if (!res.ok || !parsed) {");
    expect(bench).toContain('setError(apiErrorMessage(data, t("wave8.captionStyler.errorFailed")));');
    expect(bench.indexOf("setResult(parsed);")).toBeGreaterThan(bench.indexOf("if (!res.ok || !parsed) {"));
  });

  it("the empty state requires not-busy, no result, and no error; downloads live in the result", () => {
    expect(bench).toContain("{!busy && !result && !error && (");
    expect(bench).toContain('message={t("worldWave8Bench.captionEmpty")}');
    expect(bench).toContain('onClick={() => downloadTextFile("captions.srt", result.srt)}');
    expect(bench).toContain('onClick={() => downloadTextFile("captions.vtt", result.vtt)}');
    expect(bench.indexOf('downloadTextFile("captions.srt"')).toBeGreaterThan(bench.indexOf("{result && ("));
  });
});

describe("the shared notices — credits and error are their own lines", () => {
  it("out-of-credits names the feature; an error with a retry renders the error state", () => {
    expect(src).toContain('t("worldBenches300.outOfBucs", { feature })');
    expect(src).toContain("<NativeErrorState isLight={isLight} message={error} onRetry={onRetry} />");
  });
});
