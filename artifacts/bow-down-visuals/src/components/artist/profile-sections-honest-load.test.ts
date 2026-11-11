/**
 * ProfileSections (the public artist profile's sections) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A public-storefront surface, pinned on its sections' own
 * doctrines:
 * - STORIES / HIGHLIGHTS ride the shared apiJson helper
 *   (which throws on non-ok); a failed read leaves the rail
 *   unrendered (`stories.length === 0 && highlights.length
 *   === 0` → null) — on a public profile an absent rail
 *   claims nothing, and no fake stories are ever painted.
 * - THE FOLLOW-STATE leg carries a real loadError: its
 *   two-stage catch (token refresh, then loadError) ends on
 *   the error state rather than a guessed follow state.
 * - ACTION legs leave state as-is on failure by stated
 *   doctrine ("leave the list as-is; the next load tells
 *   the truth"; a checkout draft stays in place behind an
 *   auth wall), and a HELD checkout shows the server's own
 *   held copy when it provides one.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./profile-sections.tsx");

describe("public rails render only from proven reads; failures hold position", () => {
  it("the rail absence rule, the loadError landing, and the doctrines are pinned", () => {
    expect(src).toContain("if (stories.length === 0 && highlights.length === 0) return null;");
    expect(src).toContain(".catch(() => { if (!cancelled) setLoadError(true); });");
    expect(src).toContain("/* leave the list as-is; the next load tells the truth */");
    expect(src).toContain('if (c.status === "held") setHeldNotice(c.held_copy ?? HELD_COPY);');
  });
});
