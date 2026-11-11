/**
 * ViralityCheckPanel (the caption virality check) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, pinned for its STRICT
 * result gate: the score renders only when the response is
 * ok AND the payload is shaped like a real result —
 * `typeof data.overallScore !== "number" ||
 * !Array.isArray(data.fixes)` rejects into the error line,
 * so a malformed or partial body can never paint a score
 * the analysis didn't return. The caption requirement is
 * enforced up front with its own error line, and the busy
 * flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ViralityCheckPanel.tsx");

describe("the score renders only from a strictly-shaped proven result", () => {
  it("the shape gate and the honest failure paths are pinned", () => {
    expect(src).toContain('if (!res.ok || typeof data.overallScore !== "number" || !Array.isArray(data.fixes)) {');
    expect(src).toContain('setError(t("viralityCheck.captionRequiredError"));');
    expect(src).toContain('setError(plainErrorText(err, t("viralityCheck.checkFailedError")));');
    expect(src).toContain("setLoading(false);");
  });
});
