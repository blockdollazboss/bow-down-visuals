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
  Link2,
  Loader2,
  Play,
  Radio,
  Trophy,
  Users,
  X,
  Check,
  CircleUserRound,
  Swords,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  ARCADE_CABINETS,
  PARTY_GAME_META,
  contestStatusLine,
  createPartyRoomBody,
  dropQualifies,
  gamesSurfaceForStation,
  outcomeForFailedScore,
  outcomeForSavedScore,
  parseArcadeMe,
  parseChallengeStandings,
  parseCreatedPartyRoom,
  parseHallOfFame,
  parseMyLiveStream,
  parseMyProfileSlug,
  parsePartyLeaderboard,
  parsePartyMe,
  parsePartyRooms,
  parseWeeklyContest,
  parseSharkDrop,
  partyInviteUrl,
  partySummonsHeadline,
  partyTableHomeLine,
  partyTableSeatState,
  type ArcadeScoreOutcome,
  type ContestStanding,
  type ContestWinnerStanding,
  type PartyLeaderboard,
  type PartyMyRecord,
  type PartyOpenRoom,
  type PartyTableHome,
  type PendingSharkDrop,
  type WeeklyContest,
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

   RING 2 — THE GAME LOOP (UPGRADE-PROGRAM 2.23–2.25, shipped here):
   1. Party invites are /world deep links (/world?party=CODE): the
      lobby's copy buttons and the in-room Copy (via RoomView's
      inviteUrlFor seam) build them; the world page parses the
      param on entry, verifies the table against the server, and
      summons the walker to this table with the code pre-filled.
   2. Contests + the Winners' Circle stand in the Arcade lobby:
      this week's contest with its live standings, and the
      all-time crowns — all from the challenge rails, server
      numbers verbatim (see games-lobby.ts for the rail verdict:
      the fan-contest list is owner-only, so it is not the wall).
   3. Tables open homed from in-world: plain, at your profile, or
      on your live stream — the same POST body the page builds.
   REMAINING FOLLOW-ON: the party lobby's header sound toggle is
   page chrome; in-world the toggle lives inside the room itself
   (the RoomView carries GameSoundToggle) — lobby-level parity is
   follow-on polish, not function. */

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
      {/* What's being played for, and who already wears a crown. */}
      <ContestsWall isLight={isLight} />
    </div>
  );
}

/* ─── Contests + the Winners' Circle (2.24) ─────────────────────────
   The wall of the Game Rooms: what's being played FOR, who's ahead
   right now, and who already wears a crown. Status you read at a
   glance — place badges and names, not a data table. Every number
   is the challenge server's own (weekly contest, its ranked
   entries, the hall of fame); the wall computes nothing. */
function WinnerStandingRow({
  winner,
  isLight,
  showChallenge,
}: {
  winner: ContestWinnerStanding;
  isLight: boolean;
  showChallenge: boolean;
}) {
  const ink = isLight ? "text-[#2a1e07]" : "text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/55";
  return (
    <NativeBoardRow
      isLight={isLight}
      title={`${winner.creatorName}${winner.creatorSlug ? ` · @${winner.creatorSlug}` : ""}`}
      detail={
        showChallenge
          ? `${winner.challengeTitle}${winner.entryTitle ? ` — “${winner.entryTitle}”` : ""}`
          : winner.entryTitle
            ? `“${winner.entryTitle}”`
            : winner.challengeTitle
      }
      meta={winner.prizeCredits > 0 ? `${winner.prizeCredits.toLocaleString()} VB` : undefined}
      action={
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${
            winner.place === 1
              ? "bg-[#d4af37] text-black"
              : isLight
                ? "bg-[#7A5A12]/10 text-[#6B5B36]"
                : "bg-white/10 text-white/75"
          }`}
        >
          {winner.place === 1 ? <Crown className="h-3.5 w-3.5" /> : <Trophy className="h-3.5 w-3.5" />}
          #{winner.place}
        </span>
      }
    />
  );
}

function ContestsWall({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const [weekly, setWeekly] = useState<WeeklyContest | null>(null);
  const [lastWeek, setLastWeek] = useState<{
    challengeTitle: string;
    winners: ContestWinnerStanding[];
  } | null>(null);
  const [standings, setStandings] = useState<ContestStanding[] | null>(null);
  const [circle, setCircle] = useState<ContestWinnerStanding[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [weeklyRes, fameRes] = await Promise.all([
          fetch("/api/challenges/weekly", { headers }),
          fetch("/api/challenges/hall-of-fame?limit=5", { headers }),
        ]);
        if (weeklyRes.ok) {
          const presence = parseWeeklyContest(await weeklyRes.json());
          if (!cancelled) {
            setWeekly(presence.weekly);
            setLastWeek(presence.lastWeek);
          }
          /* The live standings ride the contest's own page rail —
             entries the server ranked, votes and views verbatim. */
          if (presence.weekly && presence.weekly.status !== "winners") {
            try {
              const detailRes = await fetch(
                `/api/challenges/${encodeURIComponent(presence.weekly.slug)}`,
                { headers },
              );
              if (detailRes.ok && !cancelled) {
                setStandings(parseChallengeStandings(await detailRes.json()));
              }
            } catch {
              /* The contest card stands without its standings. */
            }
          }
        }
        if (fameRes.ok && !cancelled) {
          setCircle(parseHallOfFame(await fameRes.json()));
        }
        if (!weeklyRes.ok && !fameRes.ok && !cancelled) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  const ink = isLight ? "text-[#2a1e07]" : "text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/55";

  return (
    <>
      <NativeBoard isLight={isLight} title="This week's contest">
        {failed ? (
          <p className={`px-1 py-2 text-sm ${muted}`}>
            The contest wall wouldn&rsquo;t load just now — the contest itself is fine.
          </p>
        ) : weekly === null && circle === null ? (
          <NativeLoadingState isLight={isLight} message="Reading the contest wall…" />
        ) : weekly === null ? (
          <NativeEmptyState
            isLight={isLight}
            message="No contest is running this week — the next crown is still being forged."
          />
        ) : (
          <div className="space-y-2 px-1 py-1" data-testid="world-contest-current">
            <p className={`text-sm font-black ${ink}`}>
              {weekly.title}{" "}
              {weekly.hashtag && (
                <span className="text-[#C9A84C]">#{weekly.hashtag}</span>
              )}
            </p>
            <p className={`text-xs font-semibold ${muted}`}>
              {contestStatusLine(weekly.status)} · {weekly.entryCount.toLocaleString()}{" "}
              entr{weekly.entryCount === 1 ? "y" : "ies"} in
              {weekly.prizePoolCredits > 0 && (
                <>
                  {" "}· playing for{" "}
                  <span className={ink}>
                    {weekly.prizePoolCredits.toLocaleString()} Visual Bucs
                  </span>
                </>
              )}
            </p>
            {weekly.prizes.length > 0 && weekly.status !== "winners" && (
              <p className={`text-xs ${muted}`}>
                {weekly.prizes
                  .map((p) => `#${p.place} takes ${p.prizeCredits.toLocaleString()} VB`)
                  .join(" · ")}
              </p>
            )}
            {weekly.status === "winners" && weekly.winners.length > 0 ? (
              <div data-testid="world-contest-winners">
                {weekly.winners.map((w) => (
                  <WinnerStandingRow
                    key={`${w.place}-${w.creatorName}`}
                    winner={w}
                    isLight={isLight}
                    showChallenge={false}
                  />
                ))}
              </div>
            ) : standings && standings.length > 0 ? (
              <div data-testid="world-contest-standings">
                <p className={`pb-1 text-[11px] font-black uppercase tracking-wide ${muted}`}>
                  Who&rsquo;s ahead
                </p>
                {standings.map((s) => (
                  <NativeBoardRow
                    key={`${s.rank}-${s.creatorName}`}
                    isLight={isLight}
                    highlighted={s.rank === 1}
                    title={`${s.rank}. ${s.creatorName}${s.rank === 1 ? " — in the lead" : ""}`}
                    detail={s.entryTitle ? `“${s.entryTitle}”` : undefined}
                    meta={`${s.votes.toLocaleString()} votes · ${s.views.toLocaleString()} views`}
                    action={
                      s.rank === 1 ? (
                        <Crown className="h-4 w-4 text-[#C9A84C]" />
                      ) : undefined
                    }
                  />
                ))}
              </div>
            ) : weekly.status !== "winners" ? (
              <p className={`text-xs ${muted}`}>
                No entries yet — the lead is there for the taking.
              </p>
            ) : null}
          </div>
        )}
      </NativeBoard>

      <NativeBoard isLight={isLight} title="The Winners' Circle">
        {circle === null ? (
          failed ? (
            <p className={`px-1 py-2 text-sm ${muted}`}>
              The Circle wouldn&rsquo;t load just now.
            </p>
          ) : (
            <NativeLoadingState isLight={isLight} message="Gathering the crowned…" />
          )
        ) : circle.length === 0 && !lastWeek ? (
          <NativeEmptyState
            isLight={isLight}
            message="No crowns on the wall yet — this week's contest writes the first names."
          />
        ) : (
          <div data-testid="world-winners-circle">
            {lastWeek && (
              <>
                <p className={`px-1 pb-1 text-[11px] font-black uppercase tracking-wide ${muted}`}>
                  Last week — {lastWeek.challengeTitle}
                </p>
                {lastWeek.winners.map((w) => (
                  <WinnerStandingRow
                    key={`lw-${w.place}-${w.creatorName}`}
                    winner={w}
                    isLight={isLight}
                    showChallenge={false}
                  />
                ))}
              </>
            )}
            {circle.length > 0 && (
              <>
                <p className={`px-1 pb-1 pt-2 text-[11px] font-black uppercase tracking-wide ${muted}`}>
                  All-time crowns
                </p>
                {circle.map((w, i) => (
                  <WinnerStandingRow
                    key={`hof-${i}-${w.creatorName}`}
                    winner={w}
                    isLight={isLight}
                    showChallenge
                  />
                ))}
              </>
            )}
          </div>
        )}
      </NativeBoard>
    </>
  );
}

/* ─── The Marble Table ────────────────────────────────────────────── */

/** The party invite prop the world page threads down (2.23): a
 *  /world?party=CODE landing, already verified against the server's
 *  own room snapshot by the page. `room` is null when the table
 *  closed before the walker arrived — the summons says so. */
export interface PartyInviteProp {
  code: string;
  room: PartyOpenRoom | null;
}

function MarbleTablePanel({
  isLight,
  partyInvite,
}: {
  isLight: boolean;
  partyInvite?: PartyInviteProp | null;
}) {
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
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [summonsDismissed, setSummonsDismissed] = useState(false);
  /* Table homes (2.25): my profile slug + my live stream, loaded
     with the lobby — each home offers itself only when it's real. */
  const [homeKind, setHomeKind] = useState<"plain" | "profile" | "stream">("plain");
  const [mySlug, setMySlug] = useState<string | null>(null);
  const [myStream, setMyStream] = useState<{ id: string; title: string | null } | null>(null);

  /* The summons pre-fills the join-by-code — the walker still takes
     their own seat; nothing auto-joins a match they didn't choose. */
  useEffect(() => {
    if (partyInvite?.code) setJoinCode(partyInvite.code);
  }, [partyInvite?.code]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [profileRes, streamRes] = await Promise.all([
          fetch("/api/creator-profiles/me", { headers }),
          fetch("/api/live-streams/status", { headers }),
        ]);
        if (profileRes.ok && !cancelled) {
          setMySlug(parseMyProfileSlug(await profileRes.json()));
        }
        if (streamRes.ok && !cancelled) {
          setMyStream(parseMyLiveStream(await streamRes.json()));
        }
      } catch {
        /* No homes offer themselves — plain tables still open. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  const copyInvite = useCallback(async (code: string) => {
    const url = partyInviteUrl(window.location.origin, code);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 2000);
    } catch {
      /* Clipboard unavailable — the code itself is the invite. */
    }
  }, []);

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

  const tableHome: PartyTableHome =
    homeKind === "profile" && mySlug
      ? { kind: "profile", slug: mySlug }
      : homeKind === "stream" && myStream
        ? { kind: "stream", streamId: myStream.id, title: myStream.title }
        : { kind: "plain" };

  const create = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/party/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(createPartyRoomBody(game, tableHome)),
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
    // tableHome is derived from homeKind + the loaded homes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders, game, homeKind, mySlug, myStream]);

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
          <PartyRoomView
            key={activeCode}
            code={activeCode}
            onLeave={leaveRoom}
            inviteUrlFor={(code) => partyInviteUrl(window.location.origin, code) ?? ""}
          />
        </Suspense>
      </GameStepthrough>
    );
  }

  const summonsRoom =
    partyInvite && !summonsDismissed
      ? (rooms?.find((r) => r.code === partyInvite.code) ?? partyInvite.room)
      : null;
  const showSummons = !!partyInvite && !summonsDismissed;

  return (
    <div className="space-y-3" data-testid="world-marble-lobby">
      {showSummons && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#C9A84C]/60 bg-gradient-to-r from-[#f0d878]/25 via-[#C9A84C]/15 to-transparent p-4"
          data-testid="world-party-summons"
        >
          <Swords className="h-6 w-6 shrink-0 text-[#C9A84C]" />
          {summonsRoom ? (
            partyTableSeatState(summonsRoom) === "full" ? (
              <p className={`flex-1 text-sm font-bold ${ink}`}>
                {partySummonsHeadline(summonsRoom)} —{" "}
                {summonsRoom.players}/{PARTY_GAME_META[summonsRoom.game].seats} seated,
                and every seat is taken. The code stays filled in below if a seat
                opens up, and the open tables are right here.
              </p>
            ) : (
              <>
                <p className={`flex-1 text-sm font-bold ${ink}`}>
                  {partySummonsHeadline(summonsRoom)} —{" "}
                  {summonsRoom.players}/{PARTY_GAME_META[summonsRoom.game].seats} seated
                  {summonsRoom.profileSlug
                    ? `, playing at @${summonsRoom.profileSlug}`
                    : summonsRoom.streamId
                      ? ", on a live stream"
                      : ""}
                  . Your seat is waiting.
                </p>
                <button
                  type="button"
                  data-testid="world-party-summons-join"
                  onClick={() => setActiveCode(summonsRoom.code)}
                  className="rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-4 py-2 text-sm font-black text-black transition hover:brightness-110"
                >
                  Take your seat
                </button>
              </>
            )
          ) : (
            <p className={`flex-1 text-sm font-bold ${ink}`}>
              You were summoned to table {partyInvite.code}, but that table has closed —
              the code is filled in below if it reopens, and the open tables are right
              here.
            </p>
          )}
          <button
            type="button"
            aria-label="Dismiss the summons"
            onClick={() => setSummonsDismissed(true)}
            className={`rounded-full border px-2 py-1 text-xs font-bold ${
              isLight
                ? "border-[#7A5A12]/30 text-[#6B5B36]"
                : "border-white/15 text-white/70"
            }`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
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
                detail={partyTableHomeLine(room)}
                meta={`${room.players}/${meta.seats}`}
                action={
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`world-party-invite-${room.code}`}
                      onClick={() => void copyInvite(room.code)}
                      title="Copy a World invite link — it lands your friend at this table"
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                        isLight
                          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                          : "border-white/15 text-white/75 hover:text-white"
                      }`}
                    >
                      {copiedCode === room.code ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5" />
                      )}
                      {copiedCode === room.code ? "Copied" : "Invite"}
                    </button>
                    <button
                      type="button"
                      data-testid={`world-party-join-${room.code}`}
                      onClick={() => setActiveCode(room.code)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                    >
                      <Users className="h-3.5 w-3.5" /> Take a seat
                    </button>
                  </span>
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
        {(mySlug || myStream) && (
          <div className="mt-3" data-testid="world-party-home-picker">
            <p className={`text-[11px] font-black uppercase tracking-wide ${muted}`}>
              Hold the table…
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                data-testid="world-party-home-plain"
                onClick={() => setHomeKind("plain")}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  homeKind === "plain"
                    ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]"
                    : isLight
                      ? "border-[#C9A84C]/40 text-[#6B5B36]"
                      : "border-white/15 text-white/70"
                }`}
              >
                <Hash className="h-3.5 w-3.5" /> Right here
              </button>
              {mySlug && (
                <button
                  type="button"
                  data-testid="world-party-home-profile"
                  onClick={() => setHomeKind("profile")}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                    homeKind === "profile"
                      ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]"
                      : isLight
                        ? "border-[#C9A84C]/40 text-[#6B5B36]"
                        : "border-white/15 text-white/70"
                  }`}
                >
                  <CircleUserRound className="h-3.5 w-3.5" /> At your profile · @{mySlug}
                </button>
              )}
              {myStream && (
                <button
                  type="button"
                  data-testid="world-party-home-stream"
                  onClick={() => setHomeKind("stream")}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                    homeKind === "stream"
                      ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]"
                      : isLight
                        ? "border-[#C9A84C]/40 text-[#6B5B36]"
                        : "border-white/15 text-white/70"
                  }`}
                >
                  <Radio className="h-3.5 w-3.5" /> On your live stream
                  {myStream.title ? ` · ${myStream.title}` : ""}
                </button>
              )}
            </div>
            <p className={`mt-1.5 text-xs ${muted}`}>
              {homeKind === "profile" && mySlug
                ? `This table lives on your profile — players see “Playing at @${mySlug}”.`
                : homeKind === "stream" && myStream
                  ? "This table rides your live stream — your audience finds it there."
                  : "A plain palace table, right here in the Game Rooms."}
            </p>
          </div>
        )}
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
  partyInvite,
}: {
  stationId: string;
  isLight: boolean;
  partyInvite?: PartyInviteProp | null;
}) {
  const surface = gamesSurfaceForStation(stationId);
  if (surface === "marble") {
    return <MarbleTablePanel isLight={isLight} partyInvite={partyInvite} />;
  }
  if (surface === "arcade") return <ArcadeCabinetsPanel isLight={isLight} />;
  return null;
}
