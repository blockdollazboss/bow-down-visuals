/**
 * ViralSoundFinder (the trending-sounds browser + AI match)
 * — honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE TRENDING BROWSE throws on non-ok into its error
 *   state — a failed browse never renders as an empty
 *   library of sounds.
 * - THE MATCH is a paid action with a strict result gate:
 *   a 402 gets its own out-of-credits state; an ok response
 *   with NO matches routes to the match-failed error line
 *   rather than painting an empty results wall — the panel
 *   never fabricates matches, and the failure line claims
 *   only that the match failed, never that no sounds exist
 *   (the browse leg owns the library truth). The matcher
 *   disclaimer from the proven response is carried into
 *   state and shown with the results.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ViralSoundFinder.tsx");

describe("browse errors honestly; match gates strictly", () => {
  it("the browse throws on non-ok; the match requires a non-empty proven list", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("sounds.errorLoadTrending")));');
    expect(src).toContain("if (!res.ok || !Array.isArray(data.matches) || data.matches.length === 0) {");
    expect(src).toContain("setMatchDisclaimer(data.disclaimer ?? \"\");");
    expect(src).toContain("setMatchLoading(false);");
  });
});
