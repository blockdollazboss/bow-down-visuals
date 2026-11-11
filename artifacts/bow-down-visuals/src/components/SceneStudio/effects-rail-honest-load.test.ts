/**
 * EffectsRail (the SceneStudio viral-effects rail) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE RECIPES LOAD is the anti-cache-poison exemplar: the
 *   module-level fetch promise RESETS itself on failure
 *   (recipesFetch = null in the catch), so a failed load is
 *   never cached as an empty library for the session (the
 *   tranche-1 LocationPicker defect shape, already correct
 *   here); the component lands on its own loadFailed state,
 *   rendered as an honest unavailable card that truthfully
 *   adds "generation works normally without effects" — the
 *   rail degrades, it never dresses the failure as "no
 *   effects exist".
 * - THE MATCH CALL gates on ok + the proven proposals
 *   payload before a single proposal renders, and its
 *   source (ai vs library) is carried into state and shown —
 *   a library fallback is never presented as an AI match.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./EffectsRail.tsx");

describe("the recipes load can never poison the cache or dress as empty", () => {
  it("the shared fetch promise resets on failure", () => {
    expect(src).toContain("if (!res.ok) throw new Error(`recipes ${res.status}`);");
    expect(src).toContain("recipesFetch = null;");
    expect(src).toContain("recipesCache = data;");
  });

  it("the failure renders an honest unavailable card, not an empty rail", () => {
    expect(src).toContain("if (loadFailed) {");
    expect(src).toContain('data-testid="effects-rail-unavailable"');
    expect(src).toContain("The effects library couldn't load — generation works normally without effects.");
    expect(src).toContain('data-testid="effects-rail-loading"');
  });
});

describe("the match gates on ok + proven proposals, and labels its source", () => {
  it("non-ok or a proposal-less body throws; the source rides into state", () => {
    expect(src).toContain('if (!res.ok || !data.proposals) throw new Error(apiErrorMessage(data, "match failed"));');
    expect(src).toContain('const [matchSource, setMatchSource] = useState<"ai" | "library" | null>(null);');
  });
});
