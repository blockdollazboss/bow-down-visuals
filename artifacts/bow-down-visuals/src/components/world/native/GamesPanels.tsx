import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Crown,
  DoorOpen,
  Gamepad2,
  Gift,
  Hash,
  Loader2,
  Play,
  Trophy,
  Users,
  X,
  Check,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  ARCADE_CABINETS,
  PARTY_GAME_META,
  createPartyRoomBody,
  dropQualifies,
  gamesSurfaceForStation,
  outcomeForFailedScore,
  outcomeForSavedScore,
  parseArcadeMe,
  parseCreatedPartyRoom,
  parsePartyLeaderboard,
  parsePartyMe,
  parsePartyRooms,
  parseSharkDrop,
  type ArcadeScoreOutcome,
  type PartyLeaderboard,
  type PartyMyRecord,
  type PartyOpenRoom,
  type PendingSharkDrop,
} from "@/lib/world/games-lobby";
import type { ArcadeGameId, ArcadeRunResult } from "@/lib/arcade-games";
import {
  isPartyRoomCode,
  normalizePartyCode,
  type PartyGame,
} from "@/lib/party-client";
import ArcadeLeaderboard from "@/components/arcade/ArcadeLeaderboard";

/* ─── The Game Cabinets & the Marble Table (NATIVE-PLAN §3.5) ───────
   The Game Rooms go native the way the plan splits them:
   - The LOBBY is a board, in-world: cabinet cards + the arcade
     leaderboard at the Arcade Cabinets; open tables as table
     cards, Open a table, join-by-code and the party leaderboard
     at the Marble Table. All of it rides the endpoints the
     website pages already use — no new server work.
   - PLAYING steps through: picking a cabinet (or taking a seat)
     takes the full screen INSIDE /world under a "Return to the
     palace" bar — the editor's sanctioned step-through class
     (§3.8) — mounting the existing self-contained game surfaces
     directly (components/arcade/*; the party RoomView), never
     the /arcade or /party page wrappers. Scores post from inside
     exactly as the components already arrange (the page posts
     POST /api/arcade/scores on game over; the party server scores
     over its own socket).

   NATIVE FOLLOW-ON (parity log — page-only after this lane):
   1. The /arcade page's "Keep the streak alive" onward rail
      (Dashboard drops/quests/streaks, /contests, /winners) has
      no in-world form here — the Treasury covers drops/quests
      in-world, but Contests and the Winners' Circle have no
      palace station yet.
   2. Party invite links still point at /party?room=CODE (the
      in-world room's Copy button builds the same link, exactly
      as the page does) — a /world deep link that lands a guest
      at the Marble Table with the code pre-filled is follow-on.
   3. Tables opened from a stream/profile home (?stream= /
      ?profile= on the page) — in-world tables open plain; the
      stream/profile home for a palace table is follow-on.
   4. The party lobby's header sound toggle is page chrome;
      in-world the toggle lives inside the room itself (the
      RoomView carries GameSoundToggle) — lobby-level parity
      is follow-on polish, not function. */

const SharkRunnerGame = lazy(() => import("@/components/arcade/SharkRunnerGame"));
const RoyalSkeetGame = lazy(() => import("@/components/arcade/RoyalSkeetGame"));
const PartyRoomView = lazy(() =>
  import("@/pages/party").then((m) => ({ default: m.RoomView })),
);

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);
}

/* ─── The step-through frame — the editor's, reused ─────────────────
   The same full-screen-inside-/world frame StationPanel builds
   for the Visual Vibes editor: fixed inset-0, the station name +
   "still in the palace" line, and the gold Return button as the
   way back to your exact spot. Escape returns to the lobby first
   (captured here so the panel host's own Escape-to-close never
   fires mid-game). */
function GameStepthrough({
  title,
  isLight,
  onReturn,
  children,
}: {
  title: string;
  isLight: boolean;
  onReturn: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onReturn();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onReturn]);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black"
      data-testid="world-games-stepthrough"
    >
      <div
        className={`relative z-10 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 ${
          isLight
            ? "border-[#C9A84C]/50 bg-[#FBF6E9] text-[#2a1e07]"
            : "border-[#d4af37]/25 bg-[#070605] text-white"
        }`}
      >
        <span className="inline-flex items-center gap-2 text-sm font-black">
          <DoorOpen className="h-4 w-4 text-[#d4af37]" /> {title}
          <span
            className={`hidden text-xs font-semibold sm:inline ${
              isLight ? "text-[#6B5B36]" : "text-white/50"
            }`}
          >
            — stepped through, still in the palace
          </span>
        </span>
        <button
          type="button"
          data-testid="world-games-return"
          onClick={onReturn}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
        >
          <X className="h-4 w-4" /> Return to the palace
        </button>
      </div>
      <div
        className={`relative min-h-0 flex-1 overflow-y-auto ${
          isLight ? "bg-[#f7ecd2]" : "bg-[#0d0a04]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function StepthroughLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-16 text-white/60">
      <Loader2 className="h-5 w-5 animate-spin text-[#d4af37]" />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

/* ─── The Arcade Cabinets ─────────────────────────────────────────── */

type DropState =
  | { kind: "none" }
  | { kind: "offer"; drop: PendingSharkDrop }
  | { kind: "claiming" }
  | { kind: "claimed"; amount: number }
  | { kind: "claim-error" };

function ArcadeCabinetsPanel({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const { refreshProfile } = useAuth();
  const [playing, setPlaying] = useState<ArcadeGameId | null>(null);
  const [myBests, setMyBests] = useState<Partial<Record<ArcadeGameId, number | null>>>({});
  const [outcomes, setOutcomes] = useState<Partial<Record<ArcadeGameId, ArcadeScoreOutcome>>>({});
  const [dropState, setDropState] = useState<DropState>({ kind: "none" });
  const [boardNonce, setBoardNonce] = useState(0);
  const dropCheckedForRef = useRef<string | null>(null);

  const loadMyBests = useCallback(async () => {
    try {
      const res = await fetch("/api/arcade/me", { headers: await authHeaders() });
      if (!res.ok) return;
      setMyBests(parseArcadeMe(await res.json()));
    } catch {
      /* Non-fatal, as on the page: the bests strip just stays quiet. */
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadMyBests();
  }, [loadMyBests]);

  /* After a qualifying run, ask the Shark Drop rail — it alone
     decides. The palace already claims drops in the Treasury; the
     arcade's own rail check rides along here too, so a run in the
     Game Rooms can surface its drop where the run happened. */
  const checkDropRail = useCallback(
    async (result: ArcadeRunResult) => {
      const key = `${result.game}:${result.score}:${result.durationMs}`;
      if (dropCheckedForRef.current === key) return;
      dropCheckedForRef.current = key;
      if (!dropQualifies(result)) return;
      try {
        const res = await fetch("/api/retention/shark-drop", {
          headers: await authHeaders(),
        });
        if (!res.ok) return;
        const drop = parseSharkDrop(await res.json());
        if (drop) setDropState({ kind: "offer", drop });
      } catch {
        /* The rail stays silent on failure — no fake offers. */
      }
    },
    [authHeaders],
  );

  /* The score post the /arcade page performs on game over, carried
     unchanged: POST the run, shape the outcome, refresh the board. */
  const handleGameOver = useCallback(
    async (result: ArcadeRunResult) => {
      setDropState({ kind: "none" });
      try {
        const res = await fetch("/api/arcade/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(result),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "save failed");
        setOutcomes((prev) => ({ ...prev, [result.game]: outcomeForSavedScore(result.score, data) }));
        setBoardNonce((n) => n + 1);
        void loadMyBests();
      } catch (err) {
        setOutcomes((prev) => ({
          ...prev,
          [result.game]: outcomeForFailedScore(
            result.score,
            err instanceof Error ? err.message : "Could not save your score",
          ),
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
      const res = await fetch("/api/retention/shark-drop/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ dropId: drop.id }),
      });
      if (!res.ok) throw new Error("claim failed");
      setDropState({ kind: "claimed", amount: drop.amount });
      refreshProfile();
    } catch {
      setDropState({ kind: "claim-error" });
    }
  }, [authHeaders, dropState, refreshProfile]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/55";
  const ink = isLight ? "text-[#2a1e07]" : "text-white";

  const outcomeLine = (game: ArcadeGameId) => {
    const o = outcomes[game];
    if (!o) return null;
    if (!o.saved) {
      return (
        <p className="text-sm font-semibold text-[#e0654f]">
          Score {o.score.toLocaleString()} — couldn&rsquo;t save it ({o.error}). Your run
          still counted here; try the next one.
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

  const dropBanner = dropState.kind !== "none" && (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#C9A84C]/60 bg-gradient-to-r from-[#f0d878]/25 via-[#C9A84C]/15 to-transparent p-4"
      data-testid="world-arcade-drop-banner"
    >
      <Gift className="h-6 w-6 shrink-0 text-[#C9A84C]" />
      {dropState.kind === "offer" && (
        <>
          <p className={`flex-1 text-sm font-bold ${ink}`}>
            The King dropped you {dropState.drop.amount.toLocaleString()} Visual Bucs for
            that run.
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
          <Check className="h-4 w-4 text-[#C9A84C]" /> {dropState.amount.toLocaleString()}{" "}
          Visual Bucs added to your balance.
        </p>
      )}
      {dropState.kind === "claim-error" && (
        <p className="text-sm font-bold text-[#e0654f]">
          The claim didn&rsquo;t go through — the drop stays waiting for you in the
          Treasury&rsquo;s Shark Drops.
        </p>
      )}
    </div>
  );

  if (playing) {
    const cabinet = ARCADE_CABINETS.find((c) => c.id === playing)!;
    return (
      <GameStepthrough
        title={cabinet.title}
        isLight={isLight}
        onReturn={() => setPlaying(null)}
      >
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <section
            className={`rounded-2xl border p-5 md:p-6 ${
              isLight
                ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
                : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
            }`}
          >
            <h2 className={`text-lg font-black ${ink}`}>{cabinet.title}</h2>
            <p className={`mb-4 mt-1 text-sm ${muted}`}>{cabinet.tagline}</p>
            <Suspense fallback={<StepthroughLoading label="Warming up the cabinet…" />}>
              {playing === "runner" ? (
                <SharkRunnerGame light={isLight} onGameOver={handleGameOver} />
              ) : (
                <RoyalSkeetGame light={isLight} onGameOver={handleGameOver} />
              )}
            </Suspense>
            <div className="mt-3">{outcomeLine(playing)}</div>
            {dropBanner && <div className="mt-4">{dropBanner}</div>}
          </section>
        </div>
      </GameStepthrough>
    );
  }

  return (
    <div className="space-y-3" data-testid="world-arcade-lobby">
      <NativeBoard isLight={isLight} title="The cabinets">
        <div className="grid gap-2 sm:grid-cols-2">
          {ARCADE_CABINETS.map((cabinet) => (
            <NativeCard key={cabinet.id} isLight={isLight}>
              <div className="flex h-full flex-col gap-2">
                <span className={`inline-flex items-center gap-2 text-sm font-black ${ink}`}>
                  <Gamepad2 className="h-4 w-4 text-[#d4af37]" /> {cabinet.title}
                </span>
                <span className={`flex-1 text-xs ${muted}`}>{cabinet.tagline}</span>
                <span className={`text-xs font-bold ${muted}`}>
                  Your best:{" "}
                  <span className={ink}>
                    {myBests[cabinet.id] != null ? myBests[cabinet.id]!.toLocaleString() : "—"}
                  </span>
                </span>
                {outcomes[cabinet.id] && <div>{outcomeLine(cabinet.id)}</div>}
                <button
                  type="button"
                  data-testid={`world-arcade-play-${cabinet.id}`}
                  onClick={() => setPlaying(cabinet.id)}
                  className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105"
                >
                  <Play className="h-4 w-4" /> Play
                </button>
              </div>
            </NativeCard>
          ))}
        </div>
      </NativeBoard>
      {dropBanner}
      {/* The board beside the cabinets — the arcade's own leaderboard
          component, reading GET /api/arcade/leaderboard itself. */}
      <ArcadeLeaderboard light={isLight} refreshNonce={boardNonce} />
    </div>
  );
}

/* ─── The Marble Table ────────────────────────────────────────────── */

function MarbleTablePanel({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PartyOpenRoom[] | null>(null);
  const [roomsFailed, setRoomsFailed] = useState(false);
  const [record, setRecord] = useState<PartyMyRecord | null>(null);
  const [board, setBoard] = useState<PartyLeaderboard | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [game, setGame] = useState<PartyGame>("trivia");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const loadLobby = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [roomsRes, meRes, boardRes] = await Promise.all([
        fetch("/api/party/rooms", { headers }),
        fetch("/api/party/me", { headers }),
        fetch("/api/party/leaderboard", { headers }),
      ]);
      if (roomsRes.ok) {
        setRooms(parsePartyRooms(await roomsRes.json()));
        setRoomsFailed(false);
      } else {
        setRoomsFailed(true);
      }
      if (meRes.ok) setRecord(parsePartyMe(await meRes.json()));
      if (boardRes.ok) {
        setBoard(parsePartyLeaderboard(await boardRes.json()));
        setBoardFailed(false);
      } else {
        setBoardFailed(true);
      }
    } catch {
      setRoomsFailed(true);
      setBoardFailed(true);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadLobby();
  }, [loadLobby, tick]);

  const leaveRoom = useCallback(() => {
    setActiveCode(null);
    setTick((n) => n + 1);
  }, []);

  const create = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/party/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(createPartyRoomBody(game)),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const code = parseCreatedPartyRoom(data);
      if (!res.ok || !code) throw new Error(data.error ?? "Could not open the table");
      setActiveCode(code);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not open the table");
    } finally {
      setCreating(false);
    }
  }, [authHeaders, game]);

  const join = useCallback(() => {
    const code = normalizePartyCode(joinCode);
    if (!isPartyRoomCode(code)) {
      setJoinError("Room codes are 6 letters and numbers — check the code and try again.");
      return;
    }
    setJoinError(null);
    setActiveCode(code);
  }, [joinCode]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/55";
  const ink = isLight ? "text-[#2a1e07]" : "text-white";

  if (activeCode) {
    return (
      <GameStepthrough title="The Marble Table" isLight={isLight} onReturn={leaveRoom}>
        <Suspense fallback={<StepthroughLoading label="Taking your seat…" />}>
          <PartyRoomView key={activeCode} code={activeCode} onLeave={leaveRoom} />
        </Suspense>
      </GameStepthrough>
    );
  }

  return (
    <div className="space-y-3" data-testid="world-marble-lobby">
      {record && record.totalMatches > 0 && (
        <p className={`px-1 text-xs font-bold ${muted}`}>
          Your record: {record.totalMatches} match{record.totalMatches === 1 ? "" : "es"} ·{" "}
          <span className={ink}>
            {record.totalWins} crown{record.totalWins === 1 ? "" : "s"}
          </span>
          {record.games.map((g) => (
            <span key={g.game}>
              {" "}· {PARTY_GAME_META[g.game].title}: best {g.bestScore.toLocaleString()}
            </span>
          ))}
        </p>
      )}

      <NativeBoard isLight={isLight} title="Open tables">
        {roomsFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The tables wouldn't come into view"
            message="Open party rooms wouldn't load — the tables themselves are fine. Try again."
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : rooms === null ? (
          <NativeLoadingState isLight={isLight} message="Looking for open tables…" />
        ) : rooms.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message="No tables are open right now — open the first one below."
          />
        ) : (
          rooms.map((room) => {
            const meta = PARTY_GAME_META[room.game];
            return (
              <NativeBoardRow
                key={room.code}
                isLight={isLight}
                title={`${meta.title} · ${room.hostName}`}
                detail={
                  room.profileSlug
                    ? `Playing at @${room.profileSlug}`
                    : room.streamId
                      ? "Live stream room"
                      : `Table ${room.code}`
                }
                meta={`${room.players}/${meta.seats}`}
                action={
                  <button
                    type="button"
                    data-testid={`world-party-join-${room.code}`}
                    onClick={() => setActiveCode(room.code)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                  >
                    <Users className="h-3.5 w-3.5" /> Take a seat
                  </button>
                }
              />
            );
          })
        )}
      </NativeBoard>

      <NativeCard isLight={isLight} title="Open a table">
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(PARTY_GAME_META) as PartyGame[]).map((g) => {
            const meta = PARTY_GAME_META[g];
            const selected = game === g;
            return (
              <button
                key={g}
                type="button"
                data-testid={`world-party-pick-${g}`}
                onClick={() => setGame(g)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected
                    ? "border-[#d4af37] bg-[#d4af37]/10"
                    : isLight
                      ? "border-[#C9A84C]/40 bg-white/50 hover:border-[#7A5A12]"
                      : "border-white/10 bg-white/5 hover:border-[#d4af37]/60"
                }`}
              >
                <span className={`block text-sm font-black ${ink}`}>{meta.title}</span>
                <span className={`mt-0.5 block text-xs ${muted}`}>{meta.tagline}</span>
              </button>
            );
          })}
        </div>
        {createError && (
          <p className="mt-2 text-sm font-semibold text-[#e0654f]">{createError}</p>
        )}
        <button
          type="button"
          data-testid="world-party-create"
          onClick={() => void create()}
          disabled={creating}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {creating ? "Opening…" : "Open a table & take the host seat"}
        </button>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide ${muted}`}>
            <Hash className="h-3.5 w-3.5 text-[#d4af37]" /> Join with a code
          </span>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="ABC234"
            maxLength={6}
            data-testid="world-party-join-input"
            className={`w-36 rounded-xl border px-3 py-2 text-center text-sm font-black uppercase tracking-[0.25em] ${
              isLight
                ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/50"
                : "border-white/15 bg-black/40 text-white placeholder:text-white/30"
            }`}
          />
          <button
            type="button"
            onClick={join}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              isLight
                ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                : "border-white/15 text-white/75 hover:text-white"
            }`}
          >
            Join
          </button>
          {joinError && <p className="w-full text-sm font-semibold text-[#e0654f]">{joinError}</p>}
        </div>
      </NativeCard>

      <NativeBoard isLight={isLight} title="Palace leaderboard">
        {boardFailed ? (
          <p className={`px-1 py-2 text-sm ${muted}`}>
            The board wouldn&rsquo;t load just now — matches still count.
          </p>
        ) : board === null ? (
          <NativeLoadingState isLight={isLight} message="Reading the board…" />
        ) : board.rows.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message="No crowns claimed yet — the first finished match writes history."
          />
        ) : (
          <>
            {board.rows.map((row) => (
              <NativeBoardRow
                key={row.userId}
                isLight={isLight}
                highlighted={row.isYou}
                title={`${row.rank}. ${row.name}${row.isYou ? " — you" : ""}`}
                detail={`${row.matches} match${row.matches === 1 ? "" : "es"}`}
                meta={`${row.points.toLocaleString()} pts`}
                action={
                  <span className="inline-flex items-center gap-1 text-xs font-black text-[#C9A84C]">
                    {row.rank === 1 ? (
                      <Crown className="h-3.5 w-3.5" />
                    ) : (
                      <Trophy className="h-3.5 w-3.5" />
                    )}
                    {row.wins}
                  </span>
                }
              />
            ))}
            {board.viewerRank !== null && board.viewerRank > 10 && (
              <p className={`px-1 pt-1 text-xs font-bold ${muted}`}>
                You stand at <span className={ink}>#{board.viewerRank}</span> — the top of
                the board is in sight.
              </p>
            )}
          </>
        )}
      </NativeBoard>
    </div>
  );
}

/* ─── The dispatch the panel host renders for pattern "games" ─────── */

export function GamesPanel({
  stationId,
  isLight,
}: {
  stationId: string;
  isLight: boolean;
}) {
  const surface = gamesSurfaceForStation(stationId);
  if (surface === "marble") return <MarbleTablePanel isLight={isLight} />;
  if (surface === "arcade") return <ArcadeCabinetsPanel isLight={isLight} />;
  return null;
}
