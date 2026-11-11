/**
 * RetentionPrefsSettings (the retention / delight account
 * prefs) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A member of the house settings family (the pattern
 * exemplar, FeedbackPromptSettings, is pinned in this same
 * tranche): the prefs load throws on non-ok into a dedicated
 * loadError card — a failed load never paints the defaults
 * as the member's saved choices; every pref write throws on
 * non-ok and reverts to the previous proven value, so the
 * panel never keeps a state the server didn't store.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./RetentionPrefsSettings.tsx");

describe("the prefs load errors honestly instead of painting defaults", () => {
  it("non-ok lands on the load-error card", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("if (!cancelled) setLoadError(true);");
    expect(src).toContain("{loadError ? (");
    expect(src).toContain('t("retention.prefs.loadError")');
  });
});

describe("the writes roll back on failure", () => {
  it("a refused save restores the previous proven value", () => {
    expect(src).toContain('if (!res.ok) throw new Error("save failed");');
    expect(src).toContain("setPrefs({ ...prefs, [key]: prev }); // revert on failure");
  });
});
