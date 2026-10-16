import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Crown, Users, Swords, Sparkles, Copy, Check, Play, LogOut, Trophy,
  Loader2, Radio, CircleUserRound, Hash, DoorOpen, Gamepad2,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useAuth } from "@/contexts/AuthContext";
import {
  PartyClient,
  defaultPartySocketUrl,
  isPartyRoomCode,
  normalizePartyCode,
  partyOverlay,
  type PartyCategory,
  type PartyGame,
  type PartyPlayer,
  type PartySocketLike,
} from "@/lib/party-client";

/* ─── Party Games (/party) ────────────────────────────────────────────────
   Multiplayer party rooms: Trivia (up to 8 at the table) and Court
   Battle (1v1 duels), played live over the site's own socket gateway.
   The server runs every room — questions, timers, scoring, the crown —
   this page only sends intents and paints what the server says.
   Scores and wins are recorded on your party record. Party games are
   played for the crown: no Visual Bucs ride on a room in v1.

   A room link is /party?room=CODE — drop it in a stream chat or on a
   profile and anyone signed in can take a seat. Rooms created from a
   stream/profile link (?stream= / ?profile=) carry that home with them. */

const GAME_META: Record<PartyGame, { title: string; tagline: string; icon: typeof Sparkles }> = {
  trivia: {
    title: "Party Trivia",
    tagline: "Up to 8 at the table. Timed questions, speed scores, one crown.",
    icon: Sparkles,
  },
  duel: {
    title: "Court Battle",
    tagline: "A 1v1 duel. Trade category picks, fastest correct answer takes the round — first to 3 rounds.",
    icon: Swords,
  },
};

const CATEGORY_LABEL: Record<PartyCategory, string> = {
  music: "Music",
  creator: "Creator Craft",
  general: "General Knowledge",
};

interface OpenRoom {
  code: string;
  game: PartyGame;
  hostName: string;
  players: number;
  streamId: string | null;
  profileSlug: string | null;
}

interface MyRecord {
  totalMatches: number;
  games: { game: PartyGame; matches: number; wins: number; points: number; bestScore: number }[];
}

function usePanel() {
  const light = useIsLightTheme();
  return {
    light,
    panel: light
      ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
      : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]",
    ink: light ? "text-[#2A1E07]" : "text-white",
    muted: light ? "text-[#6B5B36]" : "text-white/55",
    chip: light ? "bg-[#7A5A12]/10" : "bg-white/[0.06]",
    goldBtn:
      "rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-4 py-2 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50",
  };
}

export default function PartyPage() {
  usePageTitle(
    "Party Games — Bow Down Visuals",
    "Play Party Trivia and Court Battle duels live with other creators. Server-run rooms, speed scoring, one crown.",
  );
  const [activeCode, setActiveCode] = useState<string | null>(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    return room && isPartyRoomCode(room) ? normalizePartyCode(room) : null;
  });

  const leaveRoom = useCallback(() => {
    setActiveCode(null);
    window.history.replaceState(null, "", "/party");
  }, []);

  return activeCode ? (
    <RoomView key={activeCode} code={activeCode} onLeave={leaveRoom} />
  ) : (
    <LobbyView onEnter={(code) => setActiveCode(code)} />
  );
}

/* ─── Lobby ─────────────────────────────────────────────────────────────── */

function LobbyView({ onEnter }: { onEnter: (code: string) => void }) {
  const { light, panel, ink, muted, chip, goldBtn } = usePanel();
  const { getAccessToken } = useAuth();
  const [game, setGame] = useState<PartyGame>("trivia");
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [openRooms, setOpenRooms] = useState<OpenRoom[] | null>(null);
  const [record, setRecord] = useState<MyRecord | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadLobby = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [roomsRes, meRes] = await Promise.all([
        fetch("/api/party/rooms", { headers }),
        fetch("/api/party/me", { headers }),
      ]);
      if (roomsRes.ok) {
        const data = (await roomsRes.json()) as {
          rooms: {
            code: string;
            game: PartyGame;
            players: { displayName: string; isHost: boolean }[];
            streamId: string | null;
            profileSlug: string | null;
          }[];
        };
        setOpenRooms(
          data.rooms.map((r) => ({
            code: r.code,
            game: r.game,
            hostName: r.players.find((p) => p.isHost)?.displayName ?? "Creator",
            players: r.players.length,
            streamId: r.streamId,
            profileSlug: r.profileSlug,
          })),
        );
      }
      if (meRes.ok) setRecord((await meRes.json()) as MyRecord);
    } catch {
      /* The lobby still works without the lists — creation/join are local. */
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadLobby();
  }, [loadLobby]);

  const create = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const headers = await authHeaders();
      const res = await fetch("/api/party/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          game,
          streamId: params.get("stream") ?? undefined,
          profileSlug: params.get("profile") ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { room?: { code: string }; error?: string };
      if (!res.ok || !data.room) throw new Error(data.error ?? "Could not open the room");
      window.history.replaceState(null, "", `/party?room=${data.room.code}`);
      onEnter(data.room.code);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not open the room");
    } finally {
      setCreating(false);
    }
  }, [authHeaders, game, onEnter]);

  const join = useCallback(() => {
    const code = normalizePartyCode(joinCode);
    if (!isPartyRoomCode(code)) {
      setJoinError("Room codes are 6 letters and numbers — check the code and try again.");
      return;
    }
    setJoinError(null);
    window.history.replaceState(null, "", `/party?room=${code}`);
    onEnter(code);
  }, [joinCode, onEnter]);

  const myWins = record?.games.reduce((n, g) => n + g.wins, 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10" data-testid="party-page">
      <header className={`relative overflow-hidden rounded-2xl border p-6 md:p-8 ${panel}`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C9A84C]/70 to-transparent" />
        <h1 className={`inline-flex items-center gap-3 text-2xl font-black md:text-3xl ${ink}`}>
          <Gamepad2 className="h-8 w-8 text-[#C9A84C]" /> Party Games
        </h1>
        <p className={`mt-2 max-w-2xl text-sm ${muted}`}>
          Live rooms, real rivals, one crown. Open a room, share the code,
          and the palace runs the game — questions, timers and scoring all
          happen on the server, so the crown is earned, never typed in.
          Played for glory and your party record; no Visual Bucs ride on a room.
        </p>
        {record && record.totalMatches > 0 && (
          <div className={`mt-4 flex flex-wrap gap-2 text-xs font-bold ${muted}`}>
            <span className={`rounded-full px-3 py-1.5 ${chip}`}>
              Your record: {record.totalMatches} match{record.totalMatches === 1 ? "" : "es"} ·{" "}
              <span className={ink}>{myWins} crown{myWins === 1 ? "" : "s"}</span>
            </span>
            {record.games.map((g) => (
              <span key={g.game} className={`rounded-full px-3 py-1.5 ${chip}`}>
                {GAME_META[g.game].title}: best {g.bestScore.toLocaleString()}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* Create */}
        <section className={`rounded-2xl border p-5 md:p-6 ${panel}`}>
          <h2 className={`inline-flex items-center gap-2 text-lg font-black ${ink}`}>
            <DoorOpen className="h-5 w-5 text-[#C9A84C]" /> Open a room
          </h2>
          <div className="mt-4 grid gap-3">
            {(Object.keys(GAME_META) as PartyGame[]).map((g) => {
              const Meta = GAME_META[g];
              const selected = game === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGame(g)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected
                      ? "border-[#C9A84C] bg-[#C9A84C]/10"
                      : light
                        ? "border-[#C9A84C]/30 hover:border-[#C9A84C]/60"
                        : "border-white/10 hover:border-[#C9A84C]/50"
                  }`}
                  data-testid={`party-pick-${g}`}
                >
                  <span className={`inline-flex items-center gap-2 font-black ${ink}`}>
                    <Meta.icon className="h-5 w-5 text-[#C9A84C]" /> {Meta.title}
                  </span>
                  <span className={`mt-1 block text-sm ${muted}`}>{Meta.tagline}</span>
                </button>
              );
            })}
          </div>
          {createError && <p className="mt-3 text-sm font-semibold text-[#e0654f]">{createError}</p>}
          <button type="button" onClick={() => void create()} disabled={creating} className={`mt-4 ${goldBtn}`}>
            {creating ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Opening…
              </span>
            ) : (
              "Create room & get the code"
            )}
          </button>
        </section>

        {/* Join */}
        <section className={`rounded-2xl border p-5 md:p-6 ${panel}`}>
          <h2 className={`inline-flex items-center gap-2 text-lg font-black ${ink}`}>
            <Hash className="h-5 w-5 text-[#C9A84C]" /> Join with a code
          </h2>
          <p className={`mt-1 text-sm ${muted}`}>
            Got a code from a stream chat or a profile? Take your seat.
          </p>
          <div className="mt-4 flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder="ABC234"
              maxLength={6}
              className={`w-full min-w-0 flex-1 rounded-xl border px-4 py-2.5 text-center text-lg font-black uppercase tracking-[0.3em] ${
                light
                  ? "border-[#C9A84C]/40 bg-white/60 text-[#2A1E07] placeholder:text-[#6B5B36]/50"
                  : "border-white/15 bg-black/40 text-white placeholder:text-white/30"
              }`}
              data-testid="party-join-input"
            />
            <button type="button" onClick={join} className={goldBtn}>
              Join
            </button>
          </div>
          {joinError && <p className="mt-3 text-sm font-semibold text-[#e0654f]">{joinError}</p>}

          <h3 className={`mt-6 text-sm font-black uppercase tracking-wide ${muted}`}>Open lobbies</h3>
          {openRooms === null ? (
            <p className={`mt-2 inline-flex items-center gap-2 text-sm ${muted}`}>
              <Loader2 className="h-4 w-4 animate-spin" /> Looking for open rooms…
            </p>
          ) : openRooms.length === 0 ? (
            <p className={`mt-2 text-sm ${muted}`}>No rooms are open right now — be the first host.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {openRooms.map((r) => (
                <li
                  key={r.code}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${chip}`}
                  data-testid={`party-open-${r.code}`}
                >
                  <span className={`min-w-0 flex-1 truncate text-sm font-bold ${ink}`}>
                    {GAME_META[r.game].title} · {r.hostName}
                    {(r.streamId || r.profileSlug) && (
                      <span className={`ml-2 inline-flex items-center gap-1 text-xs font-semibold ${muted}`}>
                        {r.streamId ? <Radio className="h-3.5 w-3.5" /> : <CircleUserRound className="h-3.5 w-3.5" />}
                        {r.profileSlug ? `@${r.profileSlug}` : "live stream room"}
                      </span>
                    )}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-xs font-bold ${muted}`}>
                    <Users className="h-3.5 w-3.5" /> {r.players}/{r.game === "duel" ? 2 : 8}
                  </span>
                  <button
                    type="button"
                    onClick={() => onEnter(r.code)}
                    className="rounded-lg bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-3 py-1.5 text-xs font-black text-black transition hover:brightness-110"
                  >
                    Take a seat
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className={`mt-6 text-center text-sm ${muted}`}>
        Warm up solo first in{" "}
        <Link href="/arcade" className="font-bold text-[#C9A84C] hover:underline">
          The Arcade
        </Link>{" "}
        — then bring the crown fight here.
      </p>
    </div>
  );
}

/* ─── Room ──────────────────────────────────────────────────────────────── */

function RoomView({ code, onLeave }: { code: string; onLeave: () => void }) {
  const { light, panel, ink, muted, chip, goldBtn } = usePanel();
  const { getAccessToken } = useAuth();
  const clientRef = useRef<PartyClient | null>(null);
  const [, setTick] = useState(0);
  const [rounds, setRounds] = useState(8);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  if (!clientRef.current) {
    clientRef.current = new PartyClient({
      getAccessToken,
      socketUrl: (token, c) => defaultPartySocketUrl(window.location, token, c),
      openSocket: (url) => new WebSocket(url) as unknown as PartySocketLike,
    });
  }
  const client = clientRef.current;

  useEffect(() => {
    client.onUpdate = () => setTick((t) => t + 1);
    void client.connect(code);
    return () => {
      client.onUpdate = null;
      client.disconnect();
    };
  }, [client, code]);

  const inCountdown = client.phase === "question" || client.phase === "pick";
  useEffect(() => {
    if (!inCountdown) return;
    const t = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(t);
  }, [inCountdown]);

  const overlay = partyOverlay(client.status);
  const Meta = GAME_META[client.game];
  const myReveal = client.reveal?.results.find((r) => r.peerId === client.self?.peerId);
  const questionEndsAt = client.question?.endsAt ?? 0;
  const questionTotalMs = 15_000;
  const timeLeft = client.phase === "question" ? Math.max(0, questionEndsAt - nowMs) : Math.max(0, client.pickEndsAt - nowMs);
  const timeFrac = Math.min(1, timeLeft / (client.phase === "question" ? questionTotalMs : 6_000));

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/party?room=${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code itself is the invite */
    }
  }, [code]);

  const standingsWithPlacement = useMemo(() => {
    const list = client.podium?.standings ?? client.reveal?.standings ?? client.players;
    let placement = 0;
    return list.map((p, i) => {
      const prev = list[i - 1];
      if (!prev || prev.score !== p.score || prev.correct !== p.correct || prev.roundsWon !== p.roundsWon) {
        placement = i + 1;
      }
      return { player: p, placement };
    });
  }, [client.podium, client.reveal, client.players]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:py-10" data-testid="party-room">
      {/* Header */}
      <header className={`relative overflow-hidden rounded-2xl border p-5 md:p-6 ${panel}`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C9A84C]/70 to-transparent" />
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className={`inline-flex items-center gap-2.5 text-xl font-black md:text-2xl ${ink}`}>
              <Meta.icon className="h-6 w-6 text-[#C9A84C]" /> {Meta.title}
            </h1>
            <p className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${muted}`}>
              <span className="inline-flex items-center gap-1.5">
                Room <span className={`font-black tracking-[0.2em] ${ink}`}>{code}</span>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold ${chip} ${ink}`}
                  data-testid="party-copy-link"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy invite link"}
                </button>
              </span>
              {(client.streamId || client.profileSlug) && (
                <span className="inline-flex items-center gap-1">
                  {client.streamId ? <Radio className="h-4 w-4" /> : <CircleUserRound className="h-4 w-4" />}
                  {client.profileSlug ? `Playing at @${client.profileSlug}` : "Playing on a live stream"}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onLeave}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${chip} ${ink}`}
          >
            <LogOut className="h-4 w-4" /> Leave
          </button>
        </div>

        {/* Players */}
        <ul className="mt-4 flex flex-wrap gap-2" data-testid="party-players">
          {client.players.map((p) => (
            <li
              key={p.peerId}
              className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-xs font-bold ${chip} ${
                p.connected ? ink : `${muted} opacity-60`
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${p.connected ? "bg-emerald-500" : "bg-zinc-400"}`} />
              {p.displayName}
              {p.isHost && <Crown className="h-3.5 w-3.5 text-[#C9A84C]" />}
              {client.game === "duel" && client.phase !== "lobby" ? (
                <span className="text-[#C9A84C]">{p.roundsWon} rounds</span>
              ) : (
                <span className="text-[#C9A84C]">{p.score.toLocaleString()}</span>
              )}
            </li>
          ))}
        </ul>
      </header>

      {/* Status overlays */}
      {overlay && (
        <section className={`mt-6 rounded-2xl border p-6 text-center ${panel}`} data-testid={`party-overlay-${overlay}`}>
          {overlay === "connecting" && (
            <p className={`inline-flex items-center gap-2 font-bold ${ink}`}>
              <Loader2 className="h-5 w-5 animate-spin" /> Taking your seat…
            </p>
          )}
          {overlay === "room-full" && (
            <>
              <h2 className={`text-lg font-black ${ink}`}>This room is full</h2>
              <p className={`mt-1 text-sm ${muted}`}>Every seat is taken. Open your own room from the lobby — the crown travels.</p>
            </>
          )}
          {overlay === "no-room" && (
            <>
              <h2 className={`text-lg font-black ${ink}`}>That room isn't open</h2>
              <p className={`mt-1 text-sm ${muted}`}>{client.lastError ?? "Check the code and try again — rooms close when the match ends and everyone leaves."}</p>
            </>
          )}
          {overlay === "auth" && (
            <>
              <h2 className={`text-lg font-black ${ink}`}>Sign in to take a seat</h2>
              <p className={`mt-1 text-sm ${muted}`}>Party records belong to accounts — sign in and this link will seat you.</p>
            </>
          )}
          {overlay === "error" && (
            <>
              <h2 className={`text-lg font-black ${ink}`}>The room connection dropped</h2>
              <p className={`mt-1 text-sm ${muted}`}>Head back to the lobby and rejoin with the same code — your seat and score are kept while the match runs.</p>
            </>
          )}
          <button type="button" onClick={onLeave} className={`mt-4 ${goldBtn}`}>
            Back to the lobby
          </button>
        </section>
      )}

      {!overlay && client.phase === "lobby" && (
        <section className={`mt-6 rounded-2xl border p-6 text-center ${panel}`}>
          <h2 className={`text-lg font-black ${ink}`}>
            {client.players.length < 2
              ? client.game === "duel"
                ? "Waiting for your rival…"
                : "Waiting for players…"
              : "The table is set"}
          </h2>
          <p className={`mt-1 text-sm ${muted}`}>
            {client.game === "duel"
              ? "A Court Battle seats exactly two. Share the code — first rival in takes the other chair."
              : "Share the code or the invite link. Trivia seats up to 8 and needs at least 2 to start."}
          </p>
          {client.isHost ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {client.game === "trivia" && (
                <label className={`inline-flex items-center gap-2 text-sm font-bold ${muted}`}>
                  Questions
                  <select
                    value={rounds}
                    onChange={(e) => setRounds(Number(e.target.value))}
                    className={`rounded-lg border px-2 py-1.5 font-black ${
                      light ? "border-[#C9A84C]/40 bg-white/60 text-[#2A1E07]" : "border-white/15 bg-black/40 text-white"
                    }`}
                    data-testid="party-rounds"
                  >
                    {[5, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                disabled={client.players.length < 2}
                onClick={() => client.start(client.game === "trivia" ? rounds : undefined)}
                className={goldBtn}
                data-testid="party-start"
              >
                <span className="inline-flex items-center gap-2">
                  <Play className="h-4 w-4" /> Start the {client.game === "duel" ? "battle" : "game"}
                </span>
              </button>
            </div>
          ) : (
            <p className={`mt-4 text-sm font-bold ${muted}`}>Waiting for the host to start…</p>
          )}
          {client.lastError && <p className="mt-3 text-sm font-semibold text-[#e0654f]">{client.lastError}</p>}
        </section>
      )}

      {!overlay && client.phase === "pick" && (
        <section className={`mt-6 rounded-2xl border p-6 ${panel}`} data-testid="party-pick">
          <h2 className={`text-center text-lg font-black ${ink}`}>
            {client.self?.peerId === client.pickerPeerId
              ? "Your pick — choose the battlefield"
              : `${client.players.find((p) => p.peerId === client.pickerPeerId)?.displayName ?? "Your rival"} is picking the category…`}
          </h2>
          <TimerBar frac={timeFrac} light={light} />
          {client.self?.peerId === client.pickerPeerId && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {(Object.keys(CATEGORY_LABEL) as PartyCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => client.pick(cat)}
                  className={`${goldBtn} w-full`}
                  data-testid={`party-pick-${cat}`}
                >
                  {CATEGORY_LABEL[cat]}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {!overlay && client.phase === "question" && client.question && (
        <section className={`mt-6 rounded-2xl border p-6 ${panel}`} data-testid="party-question">
          <div className={`flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-wide ${muted}`}>
            <span className={`rounded-full px-2.5 py-1 ${chip}`}>{CATEGORY_LABEL[client.question.category]}</span>
            <span>
              Question {client.question.index} of {client.question.total}
            </span>
            <span className="ml-auto inline-flex items-center gap-1">
              {client.answeredCount} answered
            </span>
          </div>
          <TimerBar frac={timeFrac} light={light} />
          <h2 className={`mt-4 text-xl font-black leading-snug ${ink}`}>{client.question.prompt}</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {client.question.choices.map((choice, i) => {
              const mine = client.myChoice === i;
              const locked = client.myChoice !== null;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={locked}
                  onClick={() => client.answer(i)}
                  className={`rounded-xl border p-4 text-left font-bold transition ${
                    mine
                      ? "border-[#C9A84C] bg-[#C9A84C]/15"
                      : locked
                        ? light
                          ? "border-[#C9A84C]/25 opacity-60"
                          : "border-white/10 opacity-60"
                        : light
                          ? "border-[#C9A84C]/40 hover:border-[#C9A84C] hover:bg-[#C9A84C]/10"
                          : "border-white/15 hover:border-[#C9A84C]/70 hover:bg-[#C9A84C]/10"
                  } ${ink}`}
                  data-testid={`party-choice-${i}`}
                >
                  {choice}
                  {mine && <Check className="ml-2 inline h-4 w-4 text-[#C9A84C]" />}
                </button>
              );
            })}
          </div>
          {client.myChoice !== null && (
            <p className={`mt-3 text-sm font-bold ${muted}`}>Locked in. Speed counts — the crown watches the clock.</p>
          )}
        </section>
      )}

      {!overlay && client.phase === "reveal" && client.reveal && (
        <section className={`mt-6 rounded-2xl border p-6 ${panel}`} data-testid="party-reveal">
          <h2 className={`text-lg font-black ${ink}`}>
            {client.game === "duel"
              ? client.reveal.roundWinnerPeerId
                ? `Round to ${client.players.find((p) => p.peerId === client.reveal!.roundWinnerPeerId)?.displayName ?? "—"}`
                : "Round drawn — nobody landed it"
              : "The reveal"}
          </h2>
          {client.question && (
            <p className={`mt-1 text-sm ${muted}`}>
              {client.question.prompt} —{" "}
              <span className={`font-black ${ink}`}>{client.question.choices[client.reveal.answer]}</span>
            </p>
          )}
          {myReveal && (
            <p className={`mt-3 text-sm font-bold ${myReveal.correct ? "text-[#C9A84C]" : "text-[#e0654f]"}`}>
              {myReveal.correct
                ? `You landed it — +${myReveal.points.toLocaleString()} points`
                : myReveal.choice === null
                  ? "No answer locked in — the clock took that one."
                  : "Not this one. The next question is a new crown chase."}
            </p>
          )}
          <Standings rows={standingsWithPlacement} ink={ink} muted={muted} selfId={client.self?.peerId} />
          {client.isHost ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => client.next()} className={goldBtn} data-testid="party-next">
                Next
              </button>
              <button
                type="button"
                onClick={() => client.end()}
                className={`rounded-xl px-4 py-2 text-sm font-bold ${chip} ${ink}`}
              >
                End match
              </button>
            </div>
          ) : (
            <p className={`mt-4 text-sm font-bold ${muted}`}>Waiting for the host…</p>
          )}
        </section>
      )}

      {!overlay && client.phase === "podium" && client.podium && (
        <section className={`mt-6 rounded-2xl border p-6 text-center ${panel}`} data-testid="party-podium">
          <Trophy className="mx-auto h-10 w-10 text-[#C9A84C]" />
          <h2 className={`mt-2 text-xl font-black ${ink}`}>
            {client.podium.draw
              ? "A drawn battle — the crown stays unclaimed"
              : client.podium.winnerPeerIds.includes(client.self?.peerId ?? "")
                ? "The crown is yours"
                : `${client.players.find((p) => p.peerId === client.podium!.winnerPeerIds[0])?.displayName ?? "—"} takes the crown`}
          </h2>
          <p className={`mt-1 text-sm ${muted}`}>The result is on your party record. No Visual Bucs ride on a room — this one's for glory.</p>
          <div className="mx-auto mt-4 max-w-md text-left">
            <Standings rows={standingsWithPlacement} ink={ink} muted={muted} selfId={client.self?.peerId} />
          </div>
          <button type="button" onClick={onLeave} className={`mt-5 ${goldBtn}`}>
            Back to the lobby
          </button>
        </section>
      )}
    </div>
  );
}

function TimerBar({ frac, light }: { frac: number; light: boolean }) {
  return (
    <div className={`mt-3 h-2 overflow-hidden rounded-full ${light ? "bg-[#7A5A12]/15" : "bg-white/10"}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#f0d878] to-[#C9A84C] transition-[width] duration-100"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%` }}
      />
    </div>
  );
}

function Standings({
  rows,
  ink,
  muted,
  selfId,
}: {
  rows: { player: PartyPlayer; placement: number }[];
  ink: string;
  muted: string;
  selfId?: string;
}) {
  return (
    <ol className="mt-4 grid gap-1.5" data-testid="party-standings">
      {rows.map(({ player: p, placement }) => (
        <li
          key={p.peerId}
          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
            p.peerId === selfId ? "bg-[#C9A84C]/10 font-black" : ""
          } ${ink}`}
        >
          <span className="w-6 text-center font-black text-[#C9A84C]">{placement}</span>
          <span className="min-w-0 flex-1 truncate">
            {p.displayName}
            {p.isHost && <Crown className="ml-1.5 inline h-3.5 w-3.5 text-[#C9A84C]" />}
            {!p.connected && <span className={`ml-2 text-xs ${muted}`}>(away)</span>}
          </span>
          {p.roundsWon > 0 && <span className={`text-xs font-bold ${muted}`}>{p.roundsWon} rounds</span>}
          <span className="font-black">{p.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
