import { useCallback, useEffect, useState } from "react";
import { Trophy, Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ARCADE_GAME_META, type ArcadeGameId } from "@/lib/arcade-games";

/* ─── Arcade leaderboard — best score per player, per game ───────────────
   Reads GET /api/arcade/leaderboard. Status only (no Visual Bucs ride on
   rank). Honest states: loading spinner, error + retry, designed empty
   state — never a fake board. */

interface BoardRow {
  rank: number;
  userId: string;
  name: string;
  best: number;
  plays: number;
  isYou: boolean;
}

interface BoardData {
  game: ArcadeGameId;
  rows: BoardRow[];
  viewerRank: number | null;
  viewerBest: number | null;
}

const RANK_STYLE: Record<number, string> = {
  1: "bg-gradient-to-b from-[#f0d878] to-[#C9A84C] text-black",
  2: "bg-gradient-to-b from-[#e8e8e8] to-[#9a9a9a] text-black",
  3: "bg-gradient-to-b from-[#e0a56a] to-[#8a5a2e] text-black",
};

export default function ArcadeLeaderboard({
  light,
  refreshNonce,
}: {
  light: boolean;
  refreshNonce: number;
}) {
  const { getAccessToken } = useAuth();
  const [game, setGame] = useState<ArcadeGameId>("runner");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/arcade/leaderboard?game=${game}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("board failed");
      setBoard((await res.json()) as BoardData);
      setState("ok");
    } catch {
      setState("error");
    }
  }, [game, getAccessToken]);

  useEffect(() => {
    void load();
  }, [load, refreshNonce]);

  const panel = light
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const ink = light ? "text-[#2A1E07]" : "text-white";
  const muted = light ? "text-[#6B5B36]" : "text-white/55";

  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${panel}`} data-testid="arcade-leaderboard">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={`inline-flex items-center gap-2 text-lg font-black ${ink}`}>
          <Trophy className="h-5 w-5 text-[#C9A84C]" /> Arcade leaderboard
        </h2>
        <div className="ml-auto flex gap-2">
          {(Object.keys(ARCADE_GAME_META) as ArcadeGameId[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGame(g)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                game === g
                  ? "bg-gradient-to-r from-[#f0d878] to-[#C9A84C] text-black"
                  : light
                    ? "bg-[#7A5A12]/10 text-[#7A5A12] hover:bg-[#7A5A12]/20"
                    : "bg-white/[0.06] text-white/70 hover:bg-white/[0.12]"
              }`}
              data-testid={`board-tab-${g}`}
            >
              {ARCADE_GAME_META[g].title.replace("Shark King ", "")}
            </button>
          ))}
        </div>
      </div>

      {state === "loading" && (
        <div className={`mt-6 flex items-center gap-2 text-sm ${muted}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the board…
        </div>
      )}
      {state === "error" && (
        <div className="mt-6">
          <p className={`inline-flex items-center gap-2 text-sm font-bold ${ink}`}>
            <AlertTriangle className="h-4 w-4 text-[#C9A84C]" /> Couldn't load the leaderboard.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className={`mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold ${
              light ? "bg-[#7A5A12]/10 text-[#7A5A12]" : "bg-white/[0.06] text-white/80"
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}
      {state === "ok" && board && board.rows.length === 0 && (
        <p className={`mt-6 text-sm ${muted}`}>
          No runs on the board yet. Set the first score — it holds the crown until somebody takes it.
        </p>
      )}
      {state === "ok" && board && board.rows.length > 0 && (
        <ol className="mt-4 space-y-1.5">
          {board.rows.map((r) => (
            <li
              key={r.userId}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                r.isYou
                  ? light
                    ? "bg-[#C9A84C]/20 ring-1 ring-[#C9A84C]/50"
                    : "bg-[#C9A84C]/15 ring-1 ring-[#C9A84C]/40"
                  : light
                    ? "bg-white/40"
                    : "bg-white/[0.03]"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  RANK_STYLE[r.rank] ?? (light ? "bg-[#7A5A12]/15 text-[#7A5A12]" : "bg-white/10 text-white/70")
                }`}
              >
                {r.rank}
              </span>
              <span className={`min-w-0 flex-1 truncate text-sm font-bold ${ink}`}>
                {r.name}
                {r.isYou && <span className="ml-2 text-xs font-bold text-[#C9A84C]">You</span>}
              </span>
              <span className={`text-xs ${muted}`}>{r.plays} run{r.plays === 1 ? "" : "s"}</span>
              <span className={`text-sm font-black ${ink}`}>{r.best.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
      {state === "ok" && board && board.viewerRank !== null && board.viewerRank > 10 && (
        <p className={`mt-3 text-xs ${muted}`}>
          You're ranked #{board.viewerRank} with {board.viewerBest?.toLocaleString()} — one good run from the board.
        </p>
      )}
    </section>
  );
}
