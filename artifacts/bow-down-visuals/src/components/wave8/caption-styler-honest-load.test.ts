/**
 * CaptionStyler (wave8 caption burn-in) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An action panel with no mount load, the fullest branch
 * taxonomy in its family — every outcome gets its own line:
 * empty input speaks BEFORE the call (errorEmpty); a
 * DECLINED credit confirmation gets the cancelled line,
 * never a failure (errorCancelled); a 402 gets the
 * out-of-credits line; any other non-ok gets the failed
 * line; and the bare catch closes the set. The styled video
 * applies only past all of them, from the proven response.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CaptionStyler.tsx");

describe("every outcome class gets its own line", () => {
  it("empty, cancelled, credits, and failed are distinct branches", () => {
    expect(src).toContain('setError(t("wave8.captionStyler.errorEmpty"));');
    expect(src).toContain('setError(t("wave8.captionStyler.errorCancelled"));');
    expect(src).toContain('setError(t("wave8.captionStyler.errorOutOfCredits"));');
    expect(src).toContain('setError(t("wave8.captionStyler.errorFailed"));');
  });
});
