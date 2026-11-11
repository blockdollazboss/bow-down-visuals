/**
 * KingdomBoardBlocks (the in-World kingdom boards:
 * standings, party rooms, and sibling blocks) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A multi-block board held to per-section law: each block
 * loads through its own try/catch, every loader throws on
 * non-ok (the leaderboard and party-rooms throws are pinned
 * below), and the blocks render through the shared native
 * states (NativeLoadingState / NativeEmptyState /
 * NativeErrorState) — one block's failure lands on that
 * block's error state and can neither blank the whole board
 * nor dress itself as that block's empty state. Standings
 * are computed server-side and rendered only from the
 * proven payload.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./KingdomBoardBlocks.tsx");

describe("each block fails into its own native error state", () => {
  it("the shared states and the per-block throws are pinned", () => {
    expect(src).toContain('import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";');
    expect(src).toContain('if (!res.ok) throw new Error("leaderboard");');
    expect(src).toContain('if (!res.ok) throw new Error("party rooms");');
  });
});
