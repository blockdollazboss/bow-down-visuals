/**
 * HookLabBenches — honest load standard (deep-pins tranche 4,
 * batch D). No bench here loads a collection; every run rides
 * ONE shared runner (useBenchRunner), so the standard lands on
 * that runner once and on each bench's gate around it:
 *
 * - THE RUNNER: a declined spend confirmation returns null
 *   with nothing run; 402 — or the rail's out_of_credits body —
 *   sets the out-of-credits state and returns null; non-ok
 *   lands the server's words (or the hiccup note) and returns
 *   null; an ok answer the bench's parser returns null for
 *   lands the bench's empty note and returns null. The parsed
 *   value is returned — and the profile refreshed — only after
 *   every guard, so no bench can set a result from a failed or
 *   unreadable answer.
 * - THE BENCHES (AiInterviewBench's two runs, OpeningsBench,
 *   and DiagnosticsBenches' five tools): each refuses on its
 *   own readiness gate before the runner is called, and sets
 *   its result state only inside `if (got)` — a null from the
 *   runner leaves the previous screen exactly as it was, with
 *   the runner's note standing. Result blocks render only
 *   from that state.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./HookLabBenches.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the shared runner: decline, 402, non-ok, unparseable — then, and only then, a value", () => {
  const runner = slice(src, "function useBenchRunner() {", "/* ═══ B-16 · AI Interview");

  it("the four endings return null, in order", () => {
    expect(runner).toContain("if (!res) return null; // spend confirmation declined — nothing ran");
    expect(runner).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(runner).toContain("opts.setOutOfCredits(true);");
    expect(runner).toContain("if (!res.ok) {");
    expect(runner).toContain("opts.setNote(apiErrorMessage(data as { message?: string; error?: string }, opts.hiccupNote));");
    expect(runner).toContain("const parsed = parse(data);");
    expect(runner).toContain("if (!parsed) {");
    expect(runner).toContain("opts.setNote(opts.emptyNote);");
    expect(runner.indexOf("if (!res) return null;")).toBeLessThan(runner.indexOf("if (res.status === 402"));
    expect(runner.indexOf("if (res.status === 402")).toBeLessThan(runner.indexOf("if (!res.ok) {"));
    expect(runner.indexOf("if (!res.ok) {")).toBeLessThan(runner.indexOf("const parsed = parse(data);"));
  });

  it("the value — and the profile refresh — come only after the parse guard; busy always clears", () => {
    expect(runner.indexOf("return parsed;")).toBeGreaterThan(runner.indexOf("if (!parsed) {"));
    expect(runner.lastIndexOf("refreshProfile();")).toBeGreaterThan(runner.indexOf("if (!parsed) {"));
    expect(runner).toContain("opts.setNote(opts.hiccupNote);");
    expect(runner).toContain("opts.setBusy(false);");
  });
});

describe("AiInterviewBench: both runs gate first and set state only on a value", () => {
  const bench = slice(src, "export function AiInterviewBench", "/* ═══ B-17");

  it("questions: gate, then setQuestions only inside if (got)", () => {
    expect(bench).toContain("if (busy || !interviewQuestionsReady(topic)) return;");
    expect(bench).toContain("if (got) {");
    expect(bench).toContain("setQuestions(got);");
    expect(bench.indexOf("setQuestions(got);")).toBeGreaterThan(bench.indexOf("if (got) {"));
  });

  it("package: gate, then setPkg only on a value; the package renders only from state", () => {
    expect(bench).toContain("if (busy || !pkgReady) return;");
    expect(bench).toContain("if (got) setPkg(got);");
    expect(bench).toContain("{pkg && (");
    expect(bench).toContain('emptyNote: t("worldHooksBenches.interviewEmptyPackage")');
  });
});

describe("OpeningsBench: gate first, openings only on a value", () => {
  const bench = slice(src, "export function OpeningsBench", "/* ═══ B-20");

  it("refuses without a description and sets openings only inside if (got)", () => {
    expect(bench).toContain("if (busy || !openingsReady(description)) return;");
    expect(bench).toContain("if (got) setOpenings(got);");
    expect(bench).toContain("{openings && (");
    expect(bench).toContain('emptyNote: t("worldHooksBenches.openingsEmpty")');
  });
});

describe("DiagnosticsBenches: all five tools gate first and set results only on a value", () => {
  const bench = slice(src, "export function DiagnosticsBenches", "dummy-end-marker");

  it("each tool's readiness gate stands before its run", () => {
    expect(bench).toContain("if (busy || !hookAnalysisReady(hookText)) return;");
    expect(bench).toContain("if (busy || !seoScoreReady(seoTitle)) return;");
    expect(bench).toContain("if (busy || !doctorReady(docTitle, docRows)) return;");
    expect(bench).toContain("if (busy || !trendDraftReady(trend)) return;");
    expect(bench).toContain("if (busy || !styleStealerReady(styleDesc)) return;");
  });

  it("each result is set only inside if (got) and renders only from state", () => {
    expect(bench).toContain("if (got) setHookResult(got);");
    expect(bench).toContain("if (got) setSeoResult(got);");
    expect(bench).toContain("if (got) setDocResult(got);");
    expect(bench).toContain("if (got) setTrendResult(got);");
    expect(bench).toContain("if (got) setStyleResult(got);");
    expect(bench).toContain("{hookResult && (");
    expect(bench).toContain("{seoResult && (");
    expect(bench).toContain("{docResult && (");
    expect(bench).toContain("{trendResult && (");
  });

  it("switching tools clears the note and the credits state — a stale failure never rides across", () => {
    expect(bench).toContain("const switchTool = (next: DiagTool) => {");
    expect(bench).toContain("setNote(null);");
    expect(bench).toContain("setOutOfCredits(false);");
  });
});
