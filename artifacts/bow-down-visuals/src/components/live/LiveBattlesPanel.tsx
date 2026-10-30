import { apiErrorMessage, plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { Crown, Loader2, Swords, Trophy, XCircle, CheckCircle2, Play, Flag } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  LIVE_BATTLE_COPY,
  LIVE_BATTLES_CROWN_PATH,
  LIVE_BATTLES_MINE_PATH,
  LIVE_BATTLES_PATH,
  battleStatusLabel,
  battleViewerActions,
  battleWinnerLabel,
  cardForSide,
  liveBattleActionPath,
  liveBattleByStreamPath,
  tallyShare,
  voteEligibility,
  type BattleCrown,
  type BattleSide,
  type LiveBattle,
} from "@/lib/live-battles";

/* ─── Live Battles panel (Stack-200 TRULY NEW #154) ──────────────────────
   Docked INSIDE the existing live surfaces — never a standalone
   page:
   - the watch page (/live/:id) mounts it under the player with the
     stream's id: the battle riding THIS stream, its live tally and
     the vote buttons (guests watch the tally; voting is sign-in
     only, battlers never vote);
   - the Go Live hub's broadcast tab mounts it for the creators:
     challenge-by-slug, answer/cancel/start/finalize on my battles.
   Both mounts also carry the crown strip: the winner of the most
   recent completed battle holds the Charts crown until the next
   battle completes.

   The panel SAYS the rules where fans act (LIVE_BATTLE_COPY, pinned
   by lib tests): votes are recorded interactions only and tips
   never count as votes; battles charge nothing and pay out
   nothing. Designed in BOTH themes — light (warm cream / antique
   gold) and dark (black / gold) — via useIsLightTheme, matching the
   neighbouring live panels. */

type AuthedJson = { res: Response; data: Record<string, unknown> };

export function LiveBattleCrownStrip() {
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const [crown, setCrown] = useState<BattleCrown | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch(LIVE_BATTLES_CROWN_PATH, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as { crown: BattleCrown | null };
        if (!cancelled) setCrown(data.crown ?? null);
      } catch {
        /* the strip is an honour board — a failed read hides it */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  if (!loaded || !crown?.winner) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
        isLight ? "border-[#C9A84C]/40 bg-[#F7ECD2]/70 text-zinc-900" : "border-[#C9A84C]/30 bg-amber-400/[0.06] text-white"
      }`}
      data-testid="live-battle-crown"
    >
      <Crown className={`h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-amber-400"}`} aria-hidden="true" />
      <p className="text-sm">
        <span className="font-black">{crown.winner.display_name}</span>{" "}
        <span className={isLight ? "text-[#6B5B36]" : "text-white/60"}>
          holds the Live Battle crown — won on “{crown.battle.theme}”, {crown.battle.tally.challenger}–{crown.battle.tally.opponent} by the fans' recorded votes.
        </span>
      </p>
    </div>
  );
}

function TallyBar({ battle, isLight }: { battle: LiveBattle; isLight: boolean }) {
  const share = tallyShare(battle.tally);
  const ch = battle.challenger;
  const op = battle.opponent;
  return (
    <div data-testid="battle-tally">
      <div className="flex items-stretch gap-2 text-sm font-bold">
        <div className="min-w-0 flex-1">
          <p className="truncate">{ch?.display_name ?? "Challenger"}</p>
          <p className={`text-2xl font-black ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>
            {battle.tally.challenger}
            <span className={`ml-1 text-xs font-bold ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>{share.challenger}%</span>
          </p>
        </div>
        <div className={`self-center text-xs font-black uppercase tracking-widest ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>vs</div>
        <div className="min-w-0 flex-1 text-right">
          <p className="truncate">{op?.display_name ?? "Opponent"}</p>
          <p className={`text-2xl font-black ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>
            {battle.tally.opponent}
            <span className={`ml-1 text-xs font-bold ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>{share.opponent}%</span>
          </p>
        </div>
      </div>
      <div
        className={`mt-2 flex h-2.5 overflow-hidden rounded-full ${isLight ? "bg-[#C9A84C]/25" : "bg-white/10"}`}
        role="img"
        aria-label={`Tally: ${battle.tally.challenger} to ${battle.tally.opponent} from ${battle.tally.total} recorded votes`}
      >
        <div className="h-full bg-gradient-to-r from-amber-300 to-yellow-600 transition-all duration-500" style={{ width: `${share.challenger}%` }} />
        <div className={`h-full flex-1 ${isLight ? "bg-zinc-700/70" : "bg-white/35"}`} />
      </div>
      <p className={`mt-1.5 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
        {battle.tally.total} recorded vote{battle.tally.total === 1 ? "" : "s"}
        {battle.status === "live" && battle.current_round ? ` · Round ${battle.current_round} of ${battle.round_count}` : ""}
      </p>
    </div>
  );
}

export default function LiveBattlesPanel({
  streamId = null,
  showMine = false,
}: {
  /** The stream this surface is watching/hosting — its battle leads. */
  streamId?: string | null;
  /** Go Live hub mount: also show the challenge form + my battles. */
  showMine?: boolean;
}) {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;

  const [streamBattle, setStreamBattle] = useState<LiveBattle | null>(null);
  const [mine, setMine] = useState<LiveBattle[]>([]);
  const [opponentSlug, setOpponentSlug] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [myLiveStreamId, setMyLiveStreamId] = useState<string | null>(null);

  const call = useCallback(async (path: string, opts?: { method?: string; body?: unknown }): Promise<AuthedJson> => {
    const token = await tokenRef.current().catch(() => null);
    const res = await fetch(path, {
      method: opts?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }, []);

  const loadStreamBattle = useCallback(async () => {
    if (!streamId) return;
    try {
      const { res, data } = await call(liveBattleByStreamPath(streamId));
      if (res.ok) setStreamBattle((data.battle as LiveBattle | null) ?? null);
    } catch {
      /* polling retries */
    }
  }, [call, streamId]);

  const loadMine = useCallback(async () => {
    if (!user) {
      setMine([]);
      return;
    }
    try {
      const { res, data } = await call(LIVE_BATTLES_MINE_PATH);
      if (res.ok) setMine((data.battles as LiveBattle[]) ?? []);
    } catch {
      /* best-effort list */
    }
    /* My currently-live stream (the start door for accepted battles). */
    try {
      const { res, data } = await call("/api/live-streams/status");
      if (res.ok) {
        const live = data.live_stream as { id: string } | null;
        setMyLiveStreamId(live?.id ?? null);
      }
    } catch {
      /* start simply stays unavailable until a stream is live */
    }
  }, [call, user]);

  useEffect(() => {
    void loadStreamBattle();
  }, [loadStreamBattle]);
  useEffect(() => {
    if (showMine) void loadMine();
  }, [showMine, loadMine]);

  /* Live battles poll fast (the tally is the show); everything else
     settles on a slow tick. */
  const activeLive = streamBattle?.status === "live" || mine.some((b) => b.status === "live");
  useEffect(() => {
    const id = setInterval(
      () => {
        void loadStreamBattle();
        if (showMine) void loadMine();
      },
      activeLive ? 5_000 : 20_000,
    );
    return () => clearInterval(id);
  }, [activeLive, loadStreamBattle, loadMine, showMine]);

  async function act(battle: LiveBattle, action: "accept" | "decline" | "cancel" | "start" | "finalize") {
    if (busy) return;
    setBusy(`${battle.id}:${action}`);
    setMsg(null);
    try {
      const body = action === "start" ? { stream_id: streamId ?? myLiveStreamId ?? "" } : {};
      const { res, data } = await call(liveBattleActionPath(battle.id, action), { method: "POST", body });
      if (!res.ok) throw new Error(apiErrorMessage(data, "That didn't go through."));
      const updated = data.battle as LiveBattle;
      if (streamBattle?.id === updated.id) setStreamBattle(updated);
      setMine((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      void loadStreamBattle();
      if (showMine) void loadMine();
    } catch (err) {
      setMsg(plainErrorText(err, "That didn't go through."));
    } finally {
      setBusy(null);
    }
  }

  async function vote(battle: LiveBattle, side: BattleSide) {
    if (busy) return;
    setBusy(`${battle.id}:vote`);
    setMsg(null);
    try {
      const { res, data } = await call(liveBattleActionPath(battle.id, "vote"), { method: "POST", body: { side } });
      if (!res.ok) throw new Error(apiErrorMessage(data, "That vote didn't land."));
      const updated = data.battle as LiveBattle;
      if (streamBattle?.id === updated.id) setStreamBattle(updated);
    } catch (err) {
      setMsg(plainErrorText(err, "That vote didn't land."));
    } finally {
      setBusy(null);
    }
  }

  async function challenge() {
    const slug = opponentSlug.trim().toLowerCase();
    if (!slug || busy) return;
    setBusy("challenge");
    setMsg(null);
    try {
      const { res, data } = await call(LIVE_BATTLES_PATH, { method: "POST", body: { opponent_slug: slug } });
      if (!res.ok) throw new Error(apiErrorMessage(data, "That challenge didn't go out."));
      setOpponentSlug("");
      setMsg("Challenge sent — it waits on their answer. The theme is drawn when the challenge is created, so you both prepare for the same brief.");
      void loadMine();
    } catch (err) {
      setMsg(plainErrorText(err, "That challenge didn't go out."));
    } finally {
      setBusy(null);
    }
  }

  const panelCls = isLight
    ? "border-[#C9A84C]/40 bg-[#F7ECD2]/60 text-zinc-900"
    : "border-white/10 bg-white/[0.03] text-white";
  const subCls = isLight ? "text-[#6B5B36]" : "text-white/50";
  const goldBtn =
    "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-yellow-600 px-4 py-2.5 text-sm font-extrabold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
  const ghostBtn = `inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
    isLight ? "border-[#C9A84C]/50 bg-white/60 text-zinc-800 hover:border-[#C9A84C]" : "border-white/15 bg-white/5 text-white/80 hover:border-amber-400/50 hover:text-white"
  }`;
  const inputCls = `w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-amber-400/60 ${
    isLight ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900 placeholder:text-zinc-400" : "border-white/10 bg-black/60 text-white placeholder:text-white/25"
  }`;

  const featured = streamBattle ?? mine.find((b) => b.status === "live") ?? null;
  const others = mine.filter((b) => b.id !== featured?.id);
  const list = showMine ? others : [];

  function BattleCardView({ battle }: { battle: LiveBattle }) {
    const actions = battleViewerActions(battle);
    const eligibility = voteEligibility(battle, { signedIn: !!user });
    const winnerLabel = battleWinnerLabel(battle);
    const startStreamId = streamId ?? myLiveStreamId;
    return (
      <article className={`rounded-2xl border p-5 ${panelCls}`} data-testid="live-battle-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-black">
            <Swords className={`h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-amber-400"}`} aria-hidden="true" />
            Live Battle — “{battle.theme}”
          </p>
          <span className={`text-xs font-bold uppercase tracking-wider ${subCls}`}>{battleStatusLabel(battle.status)}</span>
        </div>
        <p className={`mt-1 text-xs ${subCls}`}>
          {battle.round_count} rounds · {battle.round_seconds}s each · {LIVE_BATTLE_COPY.noMoney}
        </p>
        <div className="mt-4">
          <TallyBar battle={battle} isLight={isLight} />
        </div>

        {battle.status === "completed" && (
          <p className={`mt-3 flex items-center gap-2 text-sm font-bold ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`} data-testid="battle-winner">
            <Trophy className="h-4 w-4" aria-hidden="true" />
            {winnerLabel}
            {battle.result === "tie" ? ` — ${LIVE_BATTLE_COPY.tieKeepsCrown}` : ""}
          </p>
        )}
        {battle.status === "voided" && (
          <p className={`mt-3 text-sm font-bold ${isLight ? "text-red-700" : "text-red-300"}`}>
            This battle was cut off{battle.void_reason === "blocked" ? " — a block between the two creators ends a battle on the spot." : "."}
          </p>
        )}

        {battle.status === "live" && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {(["challenger", "opponent"] as BattleSide[]).map((side) => {
                const card = cardForSide(battle, side);
                const mine_ = battle.my_vote === side;
                return (
                  <button
                    key={side}
                    type="button"
                    className={mine_ ? goldBtn : ghostBtn}
                    disabled={!eligibility.canVote || busy === `${battle.id}:vote`}
                    onClick={() => void vote(battle, side)}
                    data-testid={`btn-vote-${side}`}
                    aria-pressed={mine_}
                  >
                    {busy === `${battle.id}:vote` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    Vote {card?.display_name ?? side}
                    {mine_ ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
            <p className={`mt-2 text-xs ${subCls}`}>{eligibility.canVote ? LIVE_BATTLE_COPY.votesAreRecorded : eligibility.reason}</p>
          </div>
        )}

        {actions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {actions.includes("accept") && (
              <button type="button" className={goldBtn} disabled={busy === `${battle.id}:accept`} onClick={() => void act(battle, "accept")}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Accept the battle
              </button>
            )}
            {actions.includes("decline") && (
              <button type="button" className={ghostBtn} disabled={busy === `${battle.id}:decline`} onClick={() => void act(battle, "decline")}>
                <XCircle className="h-4 w-4" aria-hidden="true" /> Decline
              </button>
            )}
            {actions.includes("start") && (
              <button
                type="button"
                className={goldBtn}
                disabled={busy === `${battle.id}:start` || !startStreamId}
                title={!startStreamId ? "Start one of your live streams first — the battle rides it." : undefined}
                onClick={() => void act(battle, "start")}
              >
                <Play className="h-4 w-4" aria-hidden="true" /> Start the battle
              </button>
            )}
            {actions.includes("cancel") && (
              <button type="button" className={ghostBtn} disabled={busy === `${battle.id}:cancel`} onClick={() => void act(battle, "cancel")}>
                <XCircle className="h-4 w-4" aria-hidden="true" /> Call it off
              </button>
            )}
            {actions.includes("finalize") && (
              <button type="button" className={goldBtn} disabled={busy === `${battle.id}:finalize`} onClick={() => void act(battle, "finalize")}>
                <Flag className="h-4 w-4" aria-hidden="true" /> Close &amp; declare the result
              </button>
            )}
          </div>
        )}
        {actions.includes("start") && !startStreamId && (
          <p className={`mt-2 text-xs ${subCls}`}>Start one of your live streams first — the battle rides a battler's own live stream.</p>
        )}
      </article>
    );
  }

  if (!featured && !showMine) {
    return (
      <div className="mt-5 space-y-3">
        <LiveBattleCrownStrip />
      </div>
    );
  }

  return (
    <section className="mt-5 space-y-3" data-testid="live-battles-panel" aria-label="Live Battles">
      <LiveBattleCrownStrip />
      {featured && <BattleCardView battle={featured} />}

      {showMine && (
        <div className={`rounded-2xl border p-5 ${panelCls}`}>
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <Swords className={`h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-amber-400"}`} aria-hidden="true" /> Challenge a creator
          </h3>
          <p className={`mt-1 text-sm ${subCls}`}>
            Two creators, one drawn theme, timed rounds, live audience voting. {LIVE_BATTLE_COPY.votesAreRecorded}
          </p>
          {user ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className={`${inputCls} min-w-[220px] flex-1`}
                value={opponentSlug}
                onChange={(e) => setOpponentSlug(e.target.value)}
                placeholder="Their profile name — e.g. thy-cheat-code"
                aria-label="Creator to challenge (profile slug)"
                data-testid="battle-opponent-slug"
              />
              <button type="button" className={goldBtn} disabled={busy === "challenge" || !opponentSlug.trim()} onClick={() => void challenge()}>
                {busy === "challenge" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Swords className="h-4 w-4" aria-hidden="true" />}
                Send challenge
              </button>
            </div>
          ) : (
            <p className={`mt-3 text-sm ${subCls}`}>Sign in to challenge a creator to a Live Battle.</p>
          )}
          {list.length > 0 && (
            <div className="mt-4 space-y-3">
              {list.map((b) => (
                <BattleCardView key={b.id} battle={b} />
              ))}
            </div>
          )}
        </div>
      )}
      {msg && (
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/70"}`} role="status">
          {msg}
        </p>
      )}
    </section>
  );
}
