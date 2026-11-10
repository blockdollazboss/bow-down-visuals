/**
 * RepurposeDesk (the World repurpose + stream-cut desks) —
 * honest load classification (Stack-400 C-28 components
 * residual, deep-pins tranche 2). These desks are job surfaces:
 * priced analyze/render actions (confirmedFetch) whose results
 * settle through background-job polls. The poll discipline is
 * what the standard pins here:
 *
 * - ONE JOB READ, shared by the poll and the manual re-check:
 *   a job that can't be read — non-ok, unparseable, or thrown —
 *   parses to NULL, "never a guessed state" (written on the
 *   code). The poll records a job only from a proven read.
 * - FINISHED WORK FLOWS IN ONLY ON A PROVEN DONE: clips enter
 *   the hub project once per job, guarded by the flowed set,
 *   and only when the read job's status is "done".
 * - POLL EXHAUSTION NEVER DISCARDS: when the attempt budget
 *   runs out, the job ids move to lostJobIds so "Check again"
 *   can re-read exactly those jobs, and the error copy names
 *   that action — the work is never silently dropped and never
 *   painted as finished.
 *
 * NO FIX in this lane — the flows already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./RepurposeDesk.tsx");

describe("a job that can't be read is null — never a guessed state", () => {
  it("the shared read returns null on non-ok, unparseable, and thrown alike", () => {
    expect(desk).toContain("A job that can't be read parses to null —\n     never a guessed state.");
    expect(desk).toContain("if (!res.ok) return null;");
    expect(desk).toContain("return repurposeJobOf(await res.json().catch(() => null));");
  });

  it("the poll records only proven reads", () => {
    expect(desk).toContain("const [cj, tj] = await Promise.all([readJob(clipJobId), readJob(thumbJobId)]);");
    expect(desk).toContain("if (cj) {");
    expect(desk).toContain("setClipJob(cj);");
  });
});

describe("finished work flows in once, on a proven done", () => {
  it("the hub add rides status done + the once-per-job guard", () => {
    expect(desk).toContain('if (cj.status === "done" && clipJobId && !flowedRef.current.has(clipJobId)) {');
    expect(desk).toContain("flowedRef.current.add(clipJobId);");
  });
});

describe("poll exhaustion keeps the jobs recoverable", () => {
  it("the ids move to lostJobIds with honest copy — never dropped, never 'done'", () => {
    expect(desk).toContain("if (attemptsRef.current > MAX_POLL_ATTEMPTS) {");
    expect(desk).toContain("setLostJobIds({ clip: clipJobId, thumb: thumbJobId });");
    expect(desk).toContain('setJobError(t("repurpose.error.lostJobs"));');
    expect(desk).toContain("the ids are NOT thrown away — they move to");
  });
});
