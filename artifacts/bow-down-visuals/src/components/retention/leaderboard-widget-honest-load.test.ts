/**
 * LeaderboardWidget (the weekly creation leaderboard +
 * delight prefs) — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * - THE BOARD LOAD is a four-state exemplar: a rejected,
 *   non-ok, or unparseable board read lands on boardFailed —
 *   the error row with a retry (btn-retry-board) renders
 *   INSTEAD of the "no creations yet" copy, and the source
 *   says so in as many words. A refresh failure with a board
 *   already on screen keeps that proven board (the error row
 *   shows only while there is no board). The prefs leg
 *   settles independently and only ever sets from an ok,
 *   proven prefs payload.
 * - THE PREFS WRITE is the honest optimistic pattern: the
 *   toggle flips immediately, an ok response replaces it
 *   with the server's proven prefs and only then shows the
 *   saved tick; any failure ROLLS BACK to the previous prefs
 *   — the UI never keeps a state the server didn't store.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LeaderboardWidget.tsx");

describe("the board load: error row, proven board, genuine empty — in that order", () => {
  it("only an ok board response may set the board; failures set boardFailed", () => {
    expect(src).toContain('if (bRes.status === "fulfilled" && bRes.value.ok) {');
    expect(src).toContain("setBoardFailed(true);");
    expect(src).toContain("A failed load is NOT an empty board");
  });

  it("the error row renders only while there is no proven board, with a real retry", () => {
    expect(src).toContain("{boardFailed && !board ? (");
    expect(src).toContain('data-testid="btn-retry-board"');
    expect(src).toContain(") : !board || board.rows.length === 0 ? (");
  });
});

describe("the prefs write rolls back on failure", () => {
  it("the saved tick shows only on ok; failure restores the previous prefs", () => {
    expect(src).toContain("setPrefs({ ...prefs, [key]: value }); // optimistic");
    expect(src).toContain("setSavedTick(true);");
    expect(src).toContain("setPrefs(prev);");
  });
});
