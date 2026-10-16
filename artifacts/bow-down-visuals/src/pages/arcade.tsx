import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Gamepad2, Trophy, Gift, Sparkles, LayoutDashboard, Crown, Loader2, Check,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useAuth } from "@/contexts/AuthContext";
import SharkRunnerGame from "@/components/arcade/SharkRunnerGame";
import ShooterGalleryGame from "@/components/arcade/ShooterGalleryGame";
import ArcadeLeaderboard from "@/components/arcade/ArcadeLeaderboard";
import {
  ARCADE_GAME_META,
  DROP_QUALIFYING_SCORE,
  type ArcadeGameId,
  type ArcadeRunResult,
} from "@/lib/arcade-games";

/* ─── The Arcade (/arcade) ────────────────────────────────────────────────
   Play surface for the retention loop: two house games (Shark King
   Endless Runner, Shooter Gallery), real leaderboards, and rewards that
   ride the EXISTING rails — a qualifying run checks the Shark Drop rail
   (dice + caps + prefs all live there); quests, streaks, the Daily Drop
   and the hourly wheel live on the Dashboard, one tap away below.
   Nothing on this page mints Visual Bucs. */

interface SubmitOutcome {
  score: number;
  saved: boolean;
  personalBest?: number;
  isPersonalBest?: boolean;
  rank?: number | null;
  error?: string;
}

interface PendingDrop { id: string; amount: number }
type DropState =
  | { kind: "none" }
  | { kind: "offer"; drop: PendingDrop }
  | { kind: "claiming" }
  | { kind: "claimed"; amount: number }
  | { kind: "claim-error" };

export default function ArcadePage() {
  usePageTitle(
    "The Arcade — Bow Down Visuals",
    "Play Shark King Endless Runner and the Shooter Gallery. Climb the arcade leaderboards and earn Shark Drops in Visual Bucs.",
  );
  const light = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const [outcomes, setOutcomes] = useState<Partial<Record<ArcadeGameId, SubmitOutcome>>>({});
  const [dropState, setDropState] = useState<DropState>({ kind: "none" });
  const [boardNonce, setBoardNonce] = useState(0);
  const [myBests, setMyBests] = useState<Partial<Record<ArcadeGameId, number | null>>>({});
  const dropCheckedForRef = useRef<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadMyBests = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/arcade/me", { headers });
      if (!res.ok) return;
      const data = (await res.json()) as { games: { game: ArcadeGameId; best: number | null }[] };
      const next: Partial<Record<ArcadeGameId, number | null>> = {};
      for (const g of data.games) next[g.game] = g.best;
      setMyBests(next);
    } catch {
      /* Non-fatal: bests strip just stays quiet. */
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadMyBests();
  }, [loadMyBests]);

  /* After a qualifying run, ask the Shark Drop rail — it alone decides
     (15% dice, ≤2 drops per rolling 7 days, prefs). The arcade shows an
     offer only when the rail actually created/held a drop. */
  const checkDropRail = useCallback(
    async (result: ArcadeRunResult) => {
      const key = `${result.game}:${result.score}:${result.durationMs}`;
      if (dropCheckedForRef.current === key) return;
      dropCheckedForRef.current = key;
      if (result.score < DROP_QUALIFYING_SCORE[result.game]) return;
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/retention/shark-drop", { headers });
        if (!res.ok) return;
        const data = (await res.json()) as {
          drop?: { id: string; amount: number } | null;
        };
        if (data.drop) {
          setDropState({ kind: "offer", drop: data.drop });
        }
      } catch {
        /* The rail stays silent on failure — no fake offers. */
      }
    },
    [authHeaders],
  );

  const handleGameOver = useCallback(
    async (result: ArcadeRunResult) => {
      setDropState({ kind: "none" });
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/arcade/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(result),
        });
        const data = (await res.json().catch(() => ({}))) as {
          personalBest?: number;
          isPersonalBest?: boolean;
          rank?: number | null;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "save failed");
        setOutcomes((prev) => ({
          ...prev,
          [result.game]: {
            score: result.score,
            saved: true,
            personalBest: data.personalBest,
            isPersonalBest: data.isPersonalBest,
            rank: data.rank,
          },
        }));
        setBoardNonce((n) => n + 1);
        void loadMyBests();
      } catch (err) {
        setOutcomes((prev) => ({
          ...prev,
          [result.game]: {
            score: result.score,
            saved: false,
            error: err instanceof Error ? err.message : "Could not save your score",
          },
        }));
      }
      void checkDropRail(result);
    },
    [authHeaders, checkDropRail, loadMyBests],
  );

  const claimDrop = useCallback(async () => {
    if (dropState.kind !== "offer") return;
    const { drop } = dropState;
    setDropState({ kind: "claiming" });
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/retention/shark-drop/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ dropId: drop.id }),
      });
      if (!res.ok) throw new Error("claim failed");
      setDropState({ kind: "claimed", amount: drop.amount });
    } catch {
      setDropState({ kind: "claim-error" });
    }
  }, [authHeaders, dropState]);

  const panel = light
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const ink = light ? "text-[#2A1E07]" : "text-white";
  const muted = light ? "text-[#6B5B36]" : "text-white/55";

  const outcomeLine = (game: ArcadeGameId) => {
    const o = outcomes[game];
    if (!o) return null;
    if (!o.saved) {
      return (
        <p className="text-sm font-semibold text-[#e0654f]">
          Score {o.score.toLocaleString()} — couldn't save it ({o.error}). Your run still counted here; try the next one.
        </p>
      );
    }
    return (
      <p className={`text-sm ${muted}`}>
        Saved: <span className={`font-black ${ink}`}>{o.score.toLocaleString()}</span>
        {o.isPersonalBest ? (
          <span className="ml-2 font-bold text-[#C9A84C]">New personal best!</span>
        ) : (
          <span> · best {o.personalBest?.toLocaleString()}</span>
        )}
        {o.rank ? <span> · ranked #{o.rank}</span> : null}
      </p>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10" data-testid="arcade-page">
      {/* Header */}
      <header className={`relative overflow-hidden rounded-2xl border p-6 md:p-8 ${panel}`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C9A84C]/70 to-transparent" />
        <h1 className={`inline-flex items-center gap-3 text-2xl font-black md:text-3xl ${ink}`}>
          <Gamepad2 className="h-8 w-8 text-[#C9A84C]" /> The Arcade
        </h1>
        <p className={`mt-2 max-w-2xl text-sm ${muted}`}>
          Two house games, real leaderboards, and Shark Drops for qualifying
          runs — paid in Visual Bucs through the same drop rail as the rest
          of the palace. Play sharp: the board remembers everything.
        </p>
        <div className={`mt-4 flex flex-wrap gap-2 text-xs font-bold ${muted}`}>
          {(Object.keys(ARCADE_GAME_META) as ArcadeGameId[]).map((g) => (
            <span
              key={g}
              className={`rounded-full px-3 py-1.5 ${light ? "bg-[#7A5A12]/10" : "bg-white/[0.06]"}`}
            >
              {ARCADE_GAME_META[g].title} · your best:{" "}
              <span className={ink}>
                {myBests[g] != null ? myBests[g]!.toLocaleString() : "—"}
              </span>
            </span>
          ))}
        </div>
      </header>

      {/* Shark Drop offer — only ever shown when the rail produced one */}
      {dropState.kind !== "none" && (
        <div
          className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[#C9A84C]/60 bg-gradient-to-r from-[#f0d878]/25 via-[#C9A84C]/15 to-transparent p-4"
          data-testid="arcade-drop-banner"
        >
          <Gift className="h-6 w-6 shrink-0 text-[#C9A84C]" />
          {dropState.kind === "offer" && (
            <>
              <p className={`flex-1 text-sm font-bold ${ink}`}>
                The King dropped you {dropState.drop.amount.toLocaleString()} Visual Bucs for that run.
              </p>
              <button
                type="button"
                onClick={() => void claimDrop()}
                className="rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-4 py-2 text-sm font-black text-black transition hover:brightness-110"
              >
                Claim {dropState.drop.amount.toLocaleString()} VB
              </button>
            </>
          )}
          {dropState.kind === "claiming" && (
            <p className={`inline-flex items-center gap-2 text-sm font-bold ${ink}`}>
              <Loader2 className="h-4 w-4 animate-spin" /> Claiming…
            </p>
          )}
          {dropState.kind === "claimed" && (
            <p className={`inline-flex items-center gap-2 text-sm font-bold ${ink}`}>
              <Check className="h-4 w-4 text-[#C9A84C]" /> {dropState.amount.toLocaleString()} Visual Bucs added to your balance.
            </p>
          )}
          {dropState.kind === "claim-error" && (
            <p className="text-sm font-bold text-[#e0654f]">
              The claim didn't go through — the drop stays waiting for you on the Dashboard.
            </p>
          )}
        </div>
      )}

      {/* Runner */}
      <section className={`mt-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h2 className={`text-lg font-black ${ink}`}>{ARCADE_GAME_META.runner.title}</h2>
        <p className={`mb-4 mt-1 text-sm ${muted}`}>{ARCADE_GAME_META.runner.tagline}</p>
        <SharkRunnerGame light={light} onGameOver={handleGameOver} />
        <div className="mt-3">{outcomeLine("runner")}</div>
      </section>

      {/* Gallery */}
      <section className={`mt-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h2 className={`text-lg font-black ${ink}`}>{ARCADE_GAME_META.gallery.title}</h2>
        <p className={`mb-4 mt-1 text-sm ${muted}`}>{ARCADE_GAME_META.gallery.tagline}</p>
        <ShooterGalleryGame light={light} onGameOver={handleGameOver} />
        <div className="mt-3">{outcomeLine("gallery")}</div>
      </section>

      {/* Leaderboard */}
      <div className="mt-6">
        <ArcadeLeaderboard light={light} refreshNonce={boardNonce} />
      </div>

      {/* Onward: where the rest of the rewards live */}
      <section className={`mt-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h2 className={`inline-flex items-center gap-2 text-lg font-black ${ink}`}>
          <Sparkles className="h-5 w-5 text-[#C9A84C]" /> Keep the streak alive
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          The Arcade is one room of the palace. Your Daily Drop, weekly
          quests, creation streaks and the hourly Cheat Code wheel all live
          on the Dashboard — and the crown itself is decided in Contests.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-4 py-2 text-sm font-black text-black transition hover:brightness-110"
          >
            <LayoutDashboard className="h-4 w-4" /> Dashboard — drops, quests & streaks
          </Link>
          <Link
            href="/contests"
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${
              light ? "bg-[#7A5A12]/10 text-[#7A5A12]" : "bg-white/[0.06] text-white/85"
            }`}
          >
            <Trophy className="h-4 w-4" /> Contests
          </Link>
          <Link
            href="/winners"
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${
              light ? "bg-[#7A5A12]/10 text-[#7A5A12]" : "bg-white/[0.06] text-white/85"
            }`}
          >
            <Crown className="h-4 w-4" /> Winners' Circle
          </Link>
        </div>
      </section>
    </div>
  );
}
