/**
 * SocialProofSettings (the social-proof account settings) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A member of the house settings family with TWO load legs,
 * both held to the same law:
 * - THE PREFS LOAD and THE PROOF REFRESH each throw on
 *   non-ok into the shared loadError state — a failure on
 *   either leg never paints defaults as the member's saved
 *   settings, and a refresh failure never dresses the last
 *   state as freshly proven (loadError clears only from a
 *   proven response on the leg that ran).
 * - THE SAVE throws on non-ok ("save failed") into its
 *   failure surface — the panel never keeps a state the
 *   server didn't store.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SocialProofSettings.tsx");

describe("both load legs error honestly", () => {
  it("the prefs load and the proof refresh each throw on non-ok into loadError", () => {
    const loadThrows = src.split('if (!res.ok) throw new Error("load failed");').length - 1;
    expect(loadThrows).toBe(2);
    expect(src).toContain('if (!res.ok) throw new Error("refresh failed");');
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain("{loading ? (");
  });
});

describe("the save claims nothing before an ok response", () => {
  it("non-ok throws the save-failed error", () => {
    expect(src).toContain('if (!res.ok) throw new Error("save failed");');
  });
});
