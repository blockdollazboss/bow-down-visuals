/**
 * The Arcade (/arcade) — honest load states (Stack-400 pin batch,
 * the "empty lie" family). The page's network-loaded collection is
 * the leaderboard, and its honesty lives in the child component
 * ArcadeLeaderboard (src/components/arcade/ArcadeLeaderboard.tsx),
 * which this pin reads alongside the page's wiring. The page's own
 * fetches are action posts (score submit, drop claim — both surface
 * their failures inline) and the per-game bests strip, which is
 * quiet by design and carries no empty copy.
 *
 * The leaderboard carries a "loading" | "ok" | "error" machine:
 * its loader throws on !res.ok and records "error" in the catch; a
 * successful load records the board and "ok". Render order is
 * loading → error panel with a retry wired to the real load → the
 * empty copy, which is gated on state === "ok" with zero rows, so
 * a failed load can never read as an empty board. All copy is
 * hardcoded English literals, so this pin asserts the literals and
 * carries no catalog block.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./arcade.tsx");
const board = read("../components/arcade/ArcadeLeaderboard.tsx");
const loadAt = board.indexOf("const load = useCallback(async () => {");
const loader = board.slice(loadAt, board.indexOf("}, [game, getAccessToken]);", loadAt));

describe("the page wires the leaderboard child that carries the honest machine", () => {
  it("the page imports and renders ArcadeLeaderboard with the refresh nonce", () => {
    expect(page).toContain('import ArcadeLeaderboard from "@/components/arcade/ArcadeLeaderboard";');
    expect(page).toContain("<ArcadeLeaderboard light={light} refreshNonce={boardNonce} />");
  });
});

describe("failure path — a failed board load never reads as an empty board", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("board failed");');
    expect(loader).toContain('setState("error");');
  });

  it("a successful load records the board and the ok state", () => {
    expect(loader).toContain("setBoard((await res.json()) as BoardData);");
    expect(loader).toContain('setState("ok");');
  });

  it("the state machine starts at loading", () => {
    expect(board).toContain('useState<"loading" | "ok" | "error">("loading")');
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(board).toContain("Couldn't load the leaderboard.");
    expect(board).toContain("onClick={() => void load()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders the pending state, not the empty copy", () => {
    expect(board).toContain('state === "loading" && (');
    expect(board).toContain("Loading the board…");
  });

  it("the empty copy is gated on the ok state and renders after the error branch", () => {
    expect(board).toContain('state === "ok" && board && board.rows.length === 0 && (');
    expect(board).toContain("No runs on the board yet. Set the first score — it holds the crown until somebody takes it.");
    const errAt = board.indexOf('state === "error" && (');
    const emptyAt = board.indexOf("No runs on the board yet.");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});
