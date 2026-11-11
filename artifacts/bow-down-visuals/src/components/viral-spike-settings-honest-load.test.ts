/**
 * ViralSpikeSettings (the viral-spike account toggle) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A member of the house settings family (the pattern
 * exemplar, FeedbackPromptSettings, is pinned in this same
 * tranche): the prefs load throws on non-ok into a dedicated
 * loadError card — a failed load never paints the default as
 * the member's saved choice; the toggle write is optimistic
 * WITH rollback, and the saved toast fires only after the
 * ok response, adopting the value the SERVER echoes back
 * (d.enabled) rather than assuming the requested one stuck.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ViralSpikeSettings.tsx");

describe("the prefs load errors honestly instead of painting the default", () => {
  it("non-ok lands on the load-error card", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("if (!cancelled) setLoadError(true);");
    expect(src).toContain('t("settings.viralSpike.loadError")');
  });
});

describe("the toggle confirms from the server's echo, and rolls back on failure", () => {
  it("the saved toast fires only after ok, adopting the echoed value", () => {
    expect(src).toContain('if (!res.ok) throw new Error("save failed");');
    expect(src).toContain("setEnabled(d.enabled ?? nextValue);");
    expect(src).toContain("setEnabled(prev); // revert on failure");
  });
});
