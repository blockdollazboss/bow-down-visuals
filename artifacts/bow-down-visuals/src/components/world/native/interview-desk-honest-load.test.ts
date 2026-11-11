/**
 * InterviewDesk — honest load standard (deep-pins tranche 4,
 * batch D). The desk has no collection load — sessions live
 * for the sitting and the file's own header says it never
 * dresses them up as saved. The standard lands on the two
 * paid runs, Build session (200 VB) and Score my answer
 * (100 VB), which share one shape: a readiness gate refuses
 * before any call; a declined spend confirmation returns with
 * nothing run and nothing shown; 402 — or the rail's
 * out_of_credits error body — is the named out-of-credits
 * ending; a non-ok answer throws the rail's refunded-failure
 * words; an ok answer the seam's parser can't read throws the
 * "unusable" error — so the session / feedback state is set
 * only from a parsed answer, after every guard. Guests get
 * the gate card, never the desk.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./InterviewDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("build session — the session lands only from a parsed answer", () => {
  const build = slice(src, "async function buildSession() {", "async function submitAnswer() {");

  it("gate, decline, 402, non-ok, unusable are separate endings, in order", () => {
    expect(build).toContain("if (building || !interviewFormReady(form)) return;");
    expect(build).toContain("if (!res) return;");
    expect(build).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(build).toContain("setOutOfCredits(true);");
    expect(build).toContain("if (!res.ok) {");
    expect(build).toContain('throw new Error(apiErrorMessage(data, t("worldSponsorPress.ivBuildErrorRefunded")));');
    expect(build).toContain("const built = sessionOfResponse(data);");
    expect(build).toContain("if (!built) {");
    expect(build).toContain('throw new Error(t("worldSponsorPress.ivBuildErrorUnusable"));');
    expect(build.indexOf("if (!res) return;")).toBeLessThan(build.indexOf("if (res.status === 402"));
    expect(build.indexOf("if (res.status === 402")).toBeLessThan(build.indexOf("if (!res.ok) {"));
    expect(build.indexOf("setSession(built);")).toBeGreaterThan(build.indexOf("if (!built) {"));
  });

  it("a failure lands the build error line, and the session renders only from state", () => {
    expect(build).toContain('setBuildError(plainErrorText(e, t("worldSponsorPress.ivBuildErrorPlain")));');
    expect(src).toContain('data-testid="world-interview-desk-build-error"');
    expect(src).toContain("{session ? (");
  });
});

describe("score answer — the feedback lands only from a parsed answer", () => {
  const score = slice(src, "async function submitAnswer() {", "const activeQuestion =");

  it("both gates refuse before the call; decline, 402, non-ok, unusable follow in order", () => {
    expect(score).toContain("if (feedbackBusy || !session || practiceIdx === null) return;");
    expect(score).toContain("if (!q || !answerReady(answer)) return;");
    expect(score).toContain("if (!res) return;");
    expect(score).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(score).toContain("if (!res.ok) {");
    expect(score).toContain('throw new Error(apiErrorMessage(data, t("worldSponsorPress.ivFeedbackErrorRefunded")));');
    expect(score).toContain("const scored = feedbackOfResponse(data);");
    expect(score).toContain('if (!scored) throw new Error(t("worldSponsorPress.ivFeedbackErrorUnusable"));');
    expect(score.indexOf("setFeedback(scored);")).toBeGreaterThan(score.indexOf("if (!scored) throw"));
    expect(score).toContain('setFeedbackError(plainErrorText(e, t("worldSponsorPress.ivFeedbackErrorPlain")));');
  });
});

describe("the desk's honesty about itself", () => {
  it("guests get the gate; sessions are never dressed up as saved", () => {
    expect(src).toContain("if (isGuest) return <GuestGate isLight={isLight} />;");
    expect(src).toContain("never dresses them up as saved");
    expect(src).toContain('data-testid="world-interview-desk-guest"');
  });
});
