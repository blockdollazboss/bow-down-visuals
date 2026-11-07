/**
 * ChallengeEnterStrip — honest load state (Stack-200 hardening D2,
 * census section A item 19: the "empty lie" family).
 *
 * Before: the catch did setChallenges([]) and the render returned
 * null on empty — a failed live-challenges read was indistinguishable
 * from "no live challenges", on the exact surface whose job is to
 * catch creators at publish time (the spinner at the header was dead
 * code inside the excluded branch). After: failure raises loadFailed
 * and — with nothing loaded — renders a one-line "couldn't load — try
 * again" strip whose retry bumps the attempt counter and re-runs the
 * load; a confirmed-empty successful load still renders nothing.
 *
 * Copy note: this component's existing copy is hard-coded English
 * literals (no i18n wiring); the new line follows the file's own
 * convention rather than inventing a parallel catalog story here.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const strip = read("./ChallengeEnterStrip.tsx");

describe("failure path — a failed read is a strip, not a silent absence", () => {
  it("the load catch raises the failed flag and never writes the empty array", () => {
    expect(strip).toContain("setLoadFailed(true)");
    expect(strip).not.toContain("setChallenges([])");
  });

  it("a successful load clears the failed flag", () => {
    expect(strip).toContain("setLoadFailed(false)");
  });

  it("failure with nothing loaded renders the one-line strip with a retry", () => {
    expect(strip).toContain('data-testid="challenge-enter-load-error"');
    expect(strip).toContain("Live challenges couldn&rsquo;t load");
    expect(strip).toContain("onClick={() => setAttempt((n) => n + 1)}");
  });

  it("the retry re-runs the load effect through the attempt counter", () => {
    expect(strip).toContain("}, [limit, attempt]);");
  });
});

describe("genuine-empty and loading paths stay distinct from failure", () => {
  it("the failure strip renders before the empty/loading null", () => {
    const failAt = strip.indexOf('data-testid="challenge-enter-load-error"');
    const nullAt = strip.indexOf("if (!challenges || challenges.length === 0) return null;");
    expect(failAt).toBeGreaterThan(-1);
    expect(nullAt).toBeGreaterThan(failAt);
  });

  it("a confirmed-empty success still renders nothing (no strip, no fake empty copy)", () => {
    expect(strip).toContain("setChallenges(j.challenges ?? [])");
  });
});
