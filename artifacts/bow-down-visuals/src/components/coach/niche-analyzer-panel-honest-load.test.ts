/**
 * NicheAnalyzerPanel — honest load standard (deep-pins tranche 3,
 * batch 8). The panel has no collection load — its standard lands
 * on the two confirmed runs and the roadmap handoff. Analyze:
 * input refused up front (too-short niche) before any call; a
 * decline (null res) returns with nothing claimed; 402 (status OR
 * the out_of_credits body) is its own ending; a non-ok answer OR an
 * analysis without content pillars THROWS into the error line — a
 * thin answer is never rendered as a real analysis; setAnalysis
 * happens only from the full parsed answer. Idea validation
 * mirrors it: decline returns, 402 is named, non-ok OR
 * verdict-less throws before setVerdict. The roadmap save throws on
 * non-ok, and its saved line counts the REAL saved rows — zero
 * rows reads "already in your Action Tracker", never "saved".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./NicheAnalyzerPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("analyze — a thin answer is never a real analysis", () => {
  it("decline, 402 and the pillar-less throw are separate; setAnalysis only after the gate", () => {
    const body = slice(src, "async function analyze() {", "async function validateIdea() {");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(body).toContain("if (!res.ok || !data.analysis || !data.analysis.contentPillars?.length) {");
    expect(body.indexOf("setAnalysis(data.analysis);")).toBeGreaterThan(
      body.indexOf("if (!res.ok || !data.analysis || !data.analysis.contentPillars?.length) {"),
    );
    expect(body).toContain('setError(plainErrorText(err, "Niche analysis failed. Try again."));');
  });
});

describe("validate + roadmap — verdicts and saved counts come from the answer", () => {
  it("validate throws on verdict-less; the roadmap line counts real rows", () => {
    const val = slice(src, "async function validateIdea() {", "return (\n    <div className={`${isLight");
    expect(val).toContain("if (!res.ok || !data.verdict) {");
    expect(val.indexOf("setVerdict(data.verdict);")).toBeGreaterThan(val.indexOf("if (!res.ok || !data.verdict) {"));
    const save = slice(src, "async function saveRoadmap() {", "// inline idea-validator handoff");
    expect(save).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t save the roadmap steps."));');
    expect(save).toContain("const saved = Array.isArray(data.items) ? data.items.length : 0;");
    expect(save).toContain('"Those weeks are already in your Action Tracker."');
  });
});
