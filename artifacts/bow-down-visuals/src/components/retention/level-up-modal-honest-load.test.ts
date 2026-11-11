/**
 * LevelUpModal (the level-up celebration) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A classification pin for a celebration surface: the modal
 * opens only from a proven level-check (the level it
 * celebrates is computed server-side from real work — the
 * earned-rank law — and handed to the modal as data). Its
 * one write, the celebrate record, is a fire-and-forget
 * beacon inside its own try/catch: it marks the celebration
 * as shown so it doesn't re-fire, and its failure's only
 * consequence is that a TRUE celebration may show again —
 * the beacon never gates, fabricates, or errors over the
 * moment it records.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LevelUpModal.tsx");

describe("the celebrate record is a beacon, never a gate", () => {
  it("the beacon call is pinned", () => {
    expect(src).toContain('fetch("/api/retention/level-check/celebrate", {');
  });
});
