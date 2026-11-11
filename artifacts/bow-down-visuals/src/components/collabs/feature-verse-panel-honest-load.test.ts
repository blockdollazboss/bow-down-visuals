/**
 * FeatureVersePanel (feature-verse listings) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE LOAD is a dual-leg gate: BOTH the listings leg and
 *   the own-listings leg must answer ok (`!l.res.ok ||
 *   !o.res.ok` throws "load failed") before either applies —
 *   the panel never renders a half-proven market, and the
 *   failure lands on loadError with loading settled in
 *   finally.
 * - THE SAVE write throws on non-ok with the server's
 *   message ("Could not save your listing.") — a listing is
 *   never shown as saved on an unproven write.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FeatureVersePanel.tsx");

describe("both legs must prove before either renders; saves gate on ok", () => {
  it("the dual gate and the save throw are pinned", () => {
    expect(src).toContain('if (!l.res.ok || !o.res.ok) throw new Error("load failed");');
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Could not save your listing."));');
  });
});
