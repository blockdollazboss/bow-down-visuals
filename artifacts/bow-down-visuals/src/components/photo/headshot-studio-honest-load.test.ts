/**
 * HeadshotStudio (AI headshot generation) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An action panel with no mount load:
 * - THE INPUT validates first: no description, no call —
 *   the describe-first error speaks before any charge.
 * - THE PROVIDER-DOWN outcome is its own STATE, not an
 *   error line: a 503 status or the body's
 *   provider_not_connected code sets providerDown, so the
 *   studio shows the engine-isn't-connected truth instead
 *   of a generic failure.
 * - THE RESULT gates on ok + the produced URL
 *   (`!res.ok || !data.url`), and the failure fallback
 *   states the money truth: "Headshot generation failed.
 *   Visual Bucs were not charged." (the charge-on-success
 *   contract family).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./HeadshotStudio.tsx");

describe("provider-down is a state; the result requires the proven url", () => {
  it("the taxonomy, the gate, and the validation are pinned", () => {
    expect(src).toContain('if (!res.ok || !data.url) {');
    expect(src).toContain('if (res.status === 503 || data.code === "provider_not_connected") setProviderDown(true);');
    expect(src).toContain("Headshot generation failed. Visual Bucs were not charged.");
    expect(src).toContain('t("headshotStudio.errors.describeFirst"');
  });
});
