/**
 * AIInterviewSection (interview question generator + Q&A
 * pack) — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * An action panel whose two tools share one call helper
 * held to the family law (the StreamCopilotSection twin
 * shape): the helper gives credits their own branch (402
 * status or the body's out_of_credits code, surfaced as the
 * dedicated out-of-credits state rather than an error),
 * then throws the server's message on any other non-ok —
 * neither tool renders output from a failed call; the pack
 * step additionally refuses to run with zero questions
 * (qa.length === 0 returns early). Busy flags clear in
 * finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AIInterviewSection.tsx");

describe("the shared helper throws on non-ok after the credits branch", () => {
  it("the taxonomy and the gate are pinned", () => {
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Request failed."));');
    expect(src).toContain('setError(plainErrorText(e, "Could not generate questions."));');
    expect(src).toContain("if (qa.length === 0 || loading) return;");
  });
});
