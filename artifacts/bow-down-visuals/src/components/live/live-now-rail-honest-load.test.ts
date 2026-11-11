/**
 * LiveNowRail (the who's-live rail) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * A presence surface held to the truthful-presence law: the
 * live list loads through a throw-on-non-ok loader into a
 * dedicated error state (`setError(true)`), cleared only by
 * a proven success (`setError(false)` after the payload) —
 * the rail's "live now" entries exist only from the proven
 * payload, and a failed load is a marked error state, never
 * a silently empty rail asserting nobody is live (the
 * ReachWatchPanel lesson, already applied here).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveNowRail.tsx");

describe("live presence comes only from a proven payload; failure is a state", () => {
  it("the throw and the error-state pair are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("setError(true);");
    expect(src).toContain("setError(false);");
  });
});
