import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Crown, Users, Swords, Sparkles, Copy, Check, Play, LogOut, Trophy,
  Loader2, Radio, CircleUserRound, Hash, DoorOpen, Gamepad2,
  Music2, Clapperboard, Globe2, Gem, X,
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
  type PartyAnswerResult,
  type PartyCategory,
  type PartyGame,
  type PartyPlayer,
  type PartySocketLike,
} from "@/lib/party-client";
import { gameSfx } from "@/lib/game-sound";
import GameSoundToggle from "@/components/GameSoundToggle";

/* ─── Party Games (/party) ────────────────────────────────────────────────
   Multiplayer party rooms: Trivia (up to 8 at the table) and Court
   Battle (1v1 duels), played live over the site's own socket gateway.
   The server runs every room — questions, timers, scoring, the crown —
   this page only sends intents and paints what the server says.
   Scores and wins are recorded on your party record. Party games are
   played for the crown: no Visual Bucs ride on a room in v1.

   A room link is /party?room=CODE — drop it in a stream chat or on a
   profile and anyone signed in can take a seat. Rooms created from a
   stream/profile link (?stream= / ?profile=) carry that home with them.

   THE STAGE (upgrade): the room is presented as the King's game show —
   the King's medallion presides, players sit at a marble table with
   their real faces (avatarUrl has ridden the protocol since v1; now it
   is finally rendered), answers are marble plaques, correct answers
   flare gold under a shower of Bucs, and the crown literally drops on
   the winner at the podium. All motion is CSS; all sound is the shared
   synth in lib/game-sound.ts. The protocol did not change — only the
   theatre did. */

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

const CATEGORY_ICON: Record<PartyCategory, typeof Music2> = {
  music: Music2,
  creator: Clapperboard,
  general: Globe2,
};

/** Duel crown math mirrors the server (PARTY_DUEL_ROUNDS_TO_WIN). */
const DUEL_ROUNDS_TO_WIN = 3;

const KING_AVATAR = "/cheat-code-avatar.webp";
const COIN_IMG = "/images/visual-bucs-coin-transparent.png";

/* ─── Stage motion (CSS only, namespaced — no global stylesheet edit) ── */
const PARTY_FX_CSS = `
@keyframes party-coin-fall {
  0% { transform: translateY(-12%) rotate(0deg) scale(.7); opacity: 0; }
  12% { opacity: 1; }
  100% { transform: translateY(115%) rotate(560deg) scale(1); opacity: .85; }
}
@keyframes party-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-7px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(3px); }
}
@keyframes party-flare {
  0% { box-shadow: 0 0 0 0 rgba(240,216,120,.0); }
  35% { box-shadow: 0 0 34px 6px rgba(240,216,120,.55); }
  100% { box-shadow: 0 0 18px 2px rgba(240,216,120,.35); }
}
@keyframes party-cat-intro {
  0% { opacity: 0; transform: scale(.9) translateY(10px); }
  14% { opacity: 1; transform: scale(1) translateY(0); }
  78% { opacity: 1; }
  100% { opacity: 0; transform: scale(1.02) translateY(-8px); }
}
@keyframes party-crown-drop {
  0% { transform: translateY(-52px) rotate(-14deg); opacity: 0; }
  55% { transform: translateY(3px) rotate(3deg); opacity: 1; }
  75% { transform: translateY(-5px) rotate(-2deg); }
  100% { transform: translateY(0) rotate(0deg); opacity: 1; }
}
@keyframes party-flip-in {
  from { transform: perspective(600px) rotateX(72deg); opacity: .2; }
  to { transform: perspective(600px) rotateX(0deg); opacity: 1; }
}
@keyframes party-pop-in {
  0% { transform: scale(.4); opacity: 0; }
  70% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.party-coin { animation-name: party-coin-fall; animation-timing-function: cubic-bezier(.3,.6,.6,1); animation-fill-mode: forwards; }
.party-shake { animation: party-shake .45s ease; }
.party-flare { animation: party-flare 1.1s ease forwards; }
.party-cat-intro { animation: party-cat-intro 1.15s ease forwards; }
.party-crown-drop { animation: party-crown-drop .8s cubic-bezier(.3,1.4,.5,1) forwards; }
.party-flip-in { animation: party-flip-in .35s ease; transform-origin: top center; }
.party-pop-in { animation: party-pop-in .3s ease; }
`;

function PartyFxStyles() {
  return <style>{PARTY_FX_CSS}</style>;
}

/* ─── Shared stage pieces ───────────────────────────────────────────────── */

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** A player's face — the avatar the protocol has always carried, with
 *  an initials medallion as the honest fallback when there's no photo
 *  (or the photo won't load). Never a stock glyph. */
export function PlayerAvatar({
  player,
  size = "md",
  ring = "",
}: {
  player: PartyPlayer;
  size?: "sm" | "md" | "lg";
  ring?: string;
}) {
  const [broken, setBroken] = useState(false);
  const dims =
    size === "lg" ? "h-20 w-20 text-xl" : size === "sm" ? "h-8 w-8 text-[10px]" : "h-12 w-12 text-sm";
  const showImg = player.avatarUrl && !broken;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-[#f0d878] to-[#C9A84C] font-black text-black ${dims} ${ring}`}
      title={player.displayName}
    >
      {showImg ? (
        <img
          src={player.avatarUrl!}
          alt={player.displayName}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initialsOf(player.displayName)
      )}
    </span>
  );
}

/** The King's medallion presiding over the stage. */
function KingMedallion({ light, small = false }: { light: boolean; small?: boolean }) {
  return (
    <div className="flex flex-col items-center" aria-hidden>
      <span
        className={`inline-flex items-center justify-center overflow-hidden rounded-full ring-4 ${
          light ? "ring-[#C9A84C]/60" : "ring-[#C9A84C]/50"
        } ${small ? "h-12 w-12" : "h-16 w-16"} shadow-[0_0_28px_rgba(201,168,76,0.35)]`}
      >
        <img src={KING_AVATAR} alt="" className="h-full w-full object-cover" />
      </span>
      {!small && (
        <span className="mt-1.5 text-[10px] font-black uppercase tracking-[0.25em] text-[#C9A84C]">
          The King presides
        </span>
      )}
    </div>
  );
}

/** A rain of Visual Bucs over the stage — fired by a changing key. */
function CoinShower({ burstKey }: { burstKey: number }) {
  const [visible, setVisible] = useState(false);
  const coins = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        left: `${(i * 61) % 96 + 2}%`,
        delay: `${(i % 6) * 0.07}s`,
        dur: `${0.95 + ((i * 37) % 40) / 100}s`,
        size: 16 + ((i * 13) % 14),
      })),
    [],
  );
  useEffect(() => {
    if (burstKey <= 0) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1650);
    return () => clearTimeout(t);
  }, [burstKey]);
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {coins.map((c, i) => (
        <img
          key={i}
          src={COIN_IMG}
          alt=""
          className="party-coin absolute top-0"
          style={{
            left: c.left,
            width: c.size,
            height: c.size,
            animationDelay: c.delay,
            animationDuration: c.dur,
          }}
        />
      ))}
    </div>
  );
}

/** An SVG countdown ring — gold, burning red in the last 3 seconds. */
function CountdownRing({ frac, urgent, light }: { frac: number; urgent: boolean; light: boolean }) {
  const C = 2 * Math.PI * 17;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90" aria-hidden>
      <circle cx="22" cy="22" r="17" fill="none" strokeWidth="4" stroke={light ? "rgba(122,90,18,.18)" : "rgba(255,255,255,.12)"} />
      <circle
        cx="22"
        cy="22"
        r="17"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        stroke={urgent ? "#e0654f" : "#C9A84C"}
        strokeDasharray={C}
        strokeDashoffset={C * (1 - Math.min(1, Math.max(0, frac)))}
        style={{ transition: "stroke-dashoffset 100ms linear" }}
      />
    </svg>
  );
}

/** The brief full-stage card that introduces each question's category. */
function CategoryIntro({ category, index }: { category: PartyCategory; index: number }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <div
      key={`${category}-${index}`}
      className="party-cat-intro pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/45 backdrop-blur-[1px]"
      aria-hidden
    >
      <Icon className="h-10 w-10 text-[#f0d878]" />
      <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/70">
        Question {index}
      </span>
      <span className="text-2xl font-black text-[#f0d878]">{CATEGORY_LABEL[category]}</span>
    </div>
  );
}

/** Crown jewels for a duelist — one slot per round needed to win. */
function CrownJewels({ won, light }: { won: number; light: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${won} rounds won`}>
      {Array.from({ length: DUEL_ROUNDS_TO_WIN }, (_, i) =>
        i < won ? (
          <Gem key={i} className="party-pop-in h-4 w-4 fill-[#f0d878] text-[#C9A84C]" />
        ) : (
          <Gem key={i} className={`h-4 w-4 ${light ? "text-[#7A5A12]/35" : "text-white/25"}`} />
        ),
      )}
    </span>
  );
}

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

interface PartyBoardRow {
  rank: number;
  userId: string;
  name: string;
  wins: number;
  matches: number;
  points: number;
  isYou: boolean;
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
  const [board, setBoard] = useState<{ rows: PartyBoardRow[]; viewerRank: number | null } | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadLobby = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [roomsRes, meRes, boardRes] = await Promise.all([
        fetch("/api/party/rooms", { headers }),
        fetch("/api/party/me", { headers }),
        fetch("/api/party/leaderboard", { headers }),
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
      if (boardRes.ok) {
        const data = (await boardRes.json()) as { rows: PartyBoardRow[]; viewerRank: number | null };
        setBoard({ rows: data.rows ?? [], viewerRank: data.viewerRank ?? null });
      } else {
        setBoardFailed(true);
      }
    } catch {
      /* The lobby still works without the lists — creation/join are local. */
      setBoardFailed(true);
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
      <PartyFxStyles />
      <header className={`relative overflow-hidden rounded-2xl border p-6 md:p-8 ${panel}`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C9A84C]/70 to-transparent" />
        <div className="absolute right-5 top-5">
          <GameSoundToggle light={light} />
        </div>
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

      {/* Palace leaderboard — the wins/points board the server has
          always kept, finally on a wall where players can see it. */}
      <section className={`mt-6 rounded-2xl border p-5 md:p-6 ${panel}`} data-testid="party-leaderboard">
        <h2 className={`inline-flex items-center gap-2 text-lg font-black ${ink}`}>
          <Trophy className="h-5 w-5 text-[#C9A84C]" /> Palace leaderboard
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          Crowns and points across every finished party match in the palace.
        </p>
        {board === null && !boardFailed && (
          <p className={`mt-3 inline-flex items-center gap-2 text-sm ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the board…
          </p>
        )}
        {boardFailed && (
          <p className={`mt-3 text-sm ${muted}`}>The board wouldn't load just now — matches still count.</p>
        )}
        {board && board.rows.length === 0 && (
          <p className={`mt-3 text-sm ${muted}`}>No crowns claimed yet — the first finished match writes history.</p>
        )}
        {board && board.rows.length > 0 && (
          <ol className="mt-3 grid gap-1.5">
            {board.rows.map((r) => (
              <li
                key={r.userId}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                  r.isYou ? "bg-[#C9A84C]/15 font-black" : chip
                } ${ink}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                    r.rank === 1
                      ? "bg-gradient-to-b from-[#f0d878] to-[#C9A84C] text-black"
                      : r.rank === 2
                        ? "bg-gradient-to-b from-[#e8e8e8] to-[#9a9a9a] text-black"
                        : r.rank === 3
                          ? "bg-gradient-to-b from-[#e0a56a] to-[#8a5a2e] text-black"
                          : light
                            ? "bg-[#7A5A12]/10 text-[#7A5A12]"
                            : "bg-white/[0.07] text-white/70"
                  }`}
                >
                  {r.rank}
                </span>
                <span className="min-w-0 flex-1 truncate font-bold">
                  {r.name}
                  {r.isYou && <span className="ml-2 text-xs font-black text-[#C9A84C]">YOU</span>}
                </span>
                <span className={`hidden text-xs font-bold sm:inline ${muted}`}>
                  {r.matches} match{r.matches === 1 ? "" : "es"}
                </span>
                <span className="inline-flex items-center gap-1 font-black text-[#C9A84C]">
                  <Crown className="h-4 w-4" /> {r.wins}
                </span>
                <span className="font-black">{r.points.toLocaleString()} pts</span>
              </li>
            ))}
          </ol>
        )}
        {board && board.viewerRank !== null && board.viewerRank > 10 && (
          <p className={`mt-3 text-sm font-bold ${muted}`}>
            You stand at <span className={ink}>#{board.viewerRank}</span> — the top of the board is in sight.
          </p>
        )}
      </section>

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

/* Exported for the palace's Marble Table (NATIVE-PLAN §3.5): the
   room is a self-contained surface — it speaks only through
   lib/party-client.ts and its onLeave callback, and its one URL
   use is building the invite link a player CHOOSES to copy — so
   the world mounts this component directly in its step-through
   instead of wrapping the /party page. The lobby above stays
   page-shaped (it reads ?room=/?stream= from the page URL and
   writes history); the palace lobby is its own native board. */
export function RoomView({
  code,
  onLeave,
  inviteUrlFor,
}: {
  code: string;
  onLeave: () => void;
  /* The invite link this mount copies. The page keeps its own
     /party?room= link; the palace's Marble Table passes the /world
     deep link (/world?party=CODE, program 2.23) so a copied invite
     lands the friend at the in-world table. Default = page link,
     so page behavior is unchanged where the prop isn't passed. */
  inviteUrlFor?: (code: string) => string;
}) {
  const { light, panel, ink, muted, chip, goldBtn } = usePanel();
  const { getAccessToken } = useAuth();
  const clientRef = useRef<PartyClient | null>(null);
  const [, setTick] = useState(0);
  const [rounds, setRounds] = useState(8);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showerKey, setShowerKey] = useState(0);
  const lastTickRef = useRef(-1);
  const soundedRef = useRef<string>("");

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

  /* ── The sound of the room (synth kit — see lib/game-sound.ts) ──────
     Ticks in the last 3 seconds of a question; a sting on every reveal
     and podium, golden when the moment is yours. Keyed so a re-render
     never replays a moment that already sounded. */
  useEffect(() => {
    if (client.phase !== "question") {
      lastTickRef.current = -1;
      return;
    }
    const secs = Math.ceil(timeLeft / 1000);
    if (secs <= 3 && secs >= 1 && secs !== lastTickRef.current) {
      lastTickRef.current = secs;
      gameSfx.tick();
    }
  }, [client.phase, timeLeft]);

  useEffect(() => {
    if (client.phase === "reveal" && client.reveal) {
      const key = `reveal:${client.question?.index ?? 0}:${client.reveal.answer}`;
      if (soundedRef.current === key) return;
      soundedRef.current = key;
      const mine = client.reveal.results.find((r) => r.peerId === client.self?.peerId);
      const roundMine = client.reveal.roundWinnerPeerId === client.self?.peerId;
      if (mine?.correct || roundMine) {
        gameSfx.revealGood();
        setShowerKey((k) => k + 1);
      } else if (mine && mine.choice !== null) {
        gameSfx.revealBad();
      } else {
        gameSfx.sting();
      }
    }
    if (client.phase === "podium" && client.podium) {
      const key = `podium:${client.podium.winnerPeerIds.join(",")}:${client.podium.draw}`;
      if (soundedRef.current === key) return;
      soundedRef.current = key;
      if (!client.podium.draw && client.podium.winnerPeerIds.includes(client.self?.peerId ?? "")) {
        gameSfx.fanfare();
        setShowerKey((k) => k + 1);
      } else {
        gameSfx.sting();
      }
    }
  }, [client.phase, client.reveal, client.podium, client.self?.peerId, client.question?.index]);

  const answerWithSound = useCallback(
    (i: number) => {
      gameSfx.lockIn();
      client.answer(i);
    },
    [client],
  );

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        inviteUrlFor?.(code) ?? `${window.location.origin}/party?room=${code}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code itself is the invite */
    }
  }, [code, inviteUrlFor]);

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

  const inMatch = client.phase === "pick" || client.phase === "question" || client.phase === "reveal";
  const resultsByPeer = useMemo(() => {
    const map = new Map<string, PartyAnswerResult>();
    for (const r of client.reveal?.results ?? []) map.set(r.peerId, r);
    return map;
  }, [client.reveal]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10" data-testid="party-room">
      <PartyFxStyles />
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
          <GameSoundToggle light={light} />
          <button
            type="button"
            onClick={onLeave}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${chip} ${ink}`}
          >
            <LogOut className="h-4 w-4" /> Leave
          </button>
        </div>

        {/* The table — every seat a face, every face a score. */}
        <div className={`mt-5 rounded-2xl border px-4 py-3 ${light ? "border-[#7A5A12]/25 bg-[#7A5A12]/[.04]" : "border-white/[0.07] bg-black/25"}`}>
          <p className={`text-[10px] font-black uppercase tracking-[0.25em] ${muted}`}>At the table</p>
          <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-3" data-testid="party-players">
            {client.players.map((p) => {
              const result = client.phase === "reveal" ? resultsByPeer.get(p.peerId) : undefined;
              return (
                <li key={p.peerId} className={`flex items-center gap-2.5 ${p.connected ? "" : "opacity-55"}`}>
                  <span className="relative">
                    <PlayerAvatar
                      player={p}
                      ring={
                        p.peerId === client.self?.peerId
                          ? "ring-2 ring-[#f0d878]"
                          : p.isHost
                            ? "ring-2 ring-[#C9A84C]"
                            : light
                              ? "ring-1 ring-[#7A5A12]/30"
                              : "ring-1 ring-white/20"
                      }
                    />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ${
                        light ? "ring-[#FCF7EA]" : "ring-[#14100a]"
                      } ${p.connected ? "bg-emerald-500" : "bg-zinc-400"}`}
                    />
                    {result && (
                      <span
                        className={`party-pop-in absolute -right-2.5 -top-2 z-10 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                          result.correct
                            ? "bg-gradient-to-b from-[#f0d878] to-[#C9A84C] text-black"
                            : "bg-[#3a3a3a] text-white/75"
                        }`}
                      >
                        {result.correct ? `+${result.points.toLocaleString()}` : result.choice === null ? "—" : <X className="h-3 w-3" />}
                      </span>
                    )}
                  </span>
                  <span className="leading-tight">
                    <span className={`flex items-center gap-1 text-sm font-bold ${ink}`}>
                      <span className="max-w-[110px] truncate">{p.displayName}</span>
                      {p.isHost && <Crown className="h-3.5 w-3.5 shrink-0 text-[#C9A84C]" />}
                    </span>
                    <span className="block text-xs font-bold text-[#C9A84C]">
                      {client.game === "duel" && client.phase !== "lobby"
                        ? `${p.roundsWon} round${p.roundsWon === 1 ? "" : "s"} · ${p.score.toLocaleString()}`
                        : `${p.score.toLocaleString()} pts`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
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
        <section className={`relative mt-6 overflow-hidden rounded-2xl border p-6 text-center ${panel}`}>
          <div className="flex justify-center">
            <KingMedallion light={light} />
          </div>
          <h2 className={`mt-3 text-lg font-black ${ink}`}>
            {client.players.length < 2
              ? client.game === "duel"
                ? "Waiting for your rival…"
                : "Waiting for players…"
              : "The table is set"}
          </h2>
          <p className={`mx-auto mt-1 max-w-md text-sm ${muted}`}>
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

      {/* The stage + the live standings rail */}
      {!overlay && inMatch && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_264px]">
          <div className="min-w-0">
            {client.game === "duel" && client.players.length === 2 && (
              <DuelStage client={client} light={light} ink={ink} muted={muted} />
            )}
            {client.game === "trivia" && (
              <div className="mb-4 flex justify-center">
                <KingMedallion light={light} small />
              </div>
            )}

            {client.phase === "pick" && (
              <section className={`relative overflow-hidden rounded-2xl border p-6 ${panel}`} data-testid="party-pick">
                <h2 className={`text-center text-lg font-black ${ink}`}>
                  {client.self?.peerId === client.pickerPeerId
                    ? "Your pick — choose a door"
                    : `${client.players.find((p) => p.peerId === client.pickerPeerId)?.displayName ?? "Your rival"} is choosing a door…`}
                </h2>
                <div className="mt-3 flex justify-center">
                  <CountdownRing frac={timeFrac} urgent={timeLeft <= 2_000} light={light} />
                </div>
                {client.self?.peerId === client.pickerPeerId ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {(Object.keys(CATEGORY_LABEL) as PartyCategory[]).map((cat) => {
                      const Icon = CATEGORY_ICON[cat];
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            gameSfx.lockIn();
                            client.pick(cat);
                          }}
                          className={`group relative flex flex-col items-center gap-2 overflow-hidden rounded-t-[4.5rem] border-2 px-3 pb-5 pt-8 transition duration-200 hover:-translate-y-1 ${
                            light
                              ? "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] via-[#F4E7C3] to-[#E7D29C] text-[#2A1E07]"
                              : "border-[#C9A84C]/50 bg-gradient-to-b from-[#2a2010] via-[#1a1409] to-[#0d0a04] text-white"
                          }`}
                          data-testid={`party-pick-${cat}`}
                        >
                          <span className="pointer-events-none absolute inset-x-3 top-3 h-px bg-gradient-to-r from-transparent via-[#C9A84C]/80 to-transparent" />
                          <Icon className="h-8 w-8 text-[#C9A84C] transition group-hover:scale-110" />
                          <span className="text-sm font-black">{CATEGORY_LABEL[cat]}</span>
                          <span className="h-2 w-2 rounded-full bg-gradient-to-b from-[#f0d878] to-[#7A5A12] shadow" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={`mt-4 text-center text-sm font-bold ${muted}`}>
                    Three marble doors. Behind one of them: the next question.
                  </p>
                )}
              </section>
            )}

            {client.phase === "question" && client.question && (
              <section className={`relative overflow-hidden rounded-2xl border p-6 ${panel}`} data-testid="party-question">
                <CategoryIntro category={client.question.category} index={client.question.index} />
                <div className={`flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-wide ${muted}`}>
                  <span className={`rounded-full px-2.5 py-1 ${chip}`}>{CATEGORY_LABEL[client.question.category]}</span>
                  <span>
                    Question {client.question.index} of {client.question.total}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-2">
                    {client.answeredCount} answered
                    <span className="relative inline-flex">
                      <CountdownRing frac={timeFrac} urgent={timeLeft <= 3_000} light={light} />
                      <span
                        className={`absolute inset-0 flex items-center justify-center text-[11px] font-black ${
                          timeLeft <= 3_000 ? "text-[#e0654f]" : ink
                        }`}
                      >
                        {Math.ceil(timeLeft / 1000)}
                      </span>
                    </span>
                  </span>
                </div>
                <h2 className={`mt-4 text-xl font-black leading-snug ${ink}`}>{client.question.prompt}</h2>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {client.question.choices.map((choice, i) => {
                    const mine = client.myChoice === i;
                    const locked = client.myChoice !== null;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={locked}
                        onClick={() => answerWithSound(i)}
                        className={`party-flip-in group flex items-center gap-3 rounded-xl border-2 p-4 text-left font-bold transition duration-150 ${
                          mine
                            ? "border-[#C9A84C] bg-[#C9A84C]/15 shadow-[0_0_18px_rgba(201,168,76,0.25)]"
                            : locked
                              ? light
                                ? "border-[#C9A84C]/25 opacity-60"
                                : "border-white/10 opacity-60"
                              : light
                                ? "border-[#C9A84C]/40 bg-white/40 hover:-translate-y-0.5 hover:border-[#C9A84C] hover:bg-[#C9A84C]/10"
                                : "border-white/15 bg-white/[0.03] hover:-translate-y-0.5 hover:border-[#C9A84C]/80 hover:bg-[#C9A84C]/10"
                        } ${ink}`}
                        style={{ animationDelay: `${i * 60}ms` }}
                        data-testid={`party-choice-${i}`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                            mine
                              ? "bg-gradient-to-b from-[#f0d878] to-[#C9A84C] text-black"
                              : light
                                ? "bg-[#7A5A12]/12 text-[#7A5A12]"
                                : "bg-white/[0.08] text-[#f0d878]"
                          }`}
                        >
                          {"ABCD"[i]}
                        </span>
                        <span className="min-w-0 flex-1">{choice}</span>
                        {mine && <Check className="h-4 w-4 shrink-0 text-[#C9A84C]" />}
                      </button>
                    );
                  })}
                </div>
                {client.myChoice !== null && (
                  <p className={`mt-3 text-sm font-bold ${muted}`}>Locked in. Speed counts — the crown watches the clock.</p>
                )}
              </section>
            )}

            {client.phase === "reveal" && client.reveal && (
              <section className={`relative overflow-hidden rounded-2xl border p-6 ${panel}`} data-testid="party-reveal">
                <CoinShower burstKey={showerKey} />
                <h2 className={`text-lg font-black ${ink}`}>
                  {client.game === "duel"
                    ? client.reveal.roundWinnerPeerId
                      ? `Round to ${client.players.find((p) => p.peerId === client.reveal!.roundWinnerPeerId)?.displayName ?? "—"}`
                      : "Round drawn — nobody landed it"
                    : "The reveal"}
                </h2>
                {client.question && (
                  <>
                    <p className={`mt-1 text-sm ${muted}`}>
                      {client.question.prompt} —{" "}
                      <span className={`font-black ${ink}`}>{client.question.choices[client.reveal.answer]}</span>
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {client.question.choices.map((choice, i) => {
                        const isAnswer = i === client.reveal!.answer;
                        const myWrongPick = myReveal && !myReveal.correct && myReveal.choice === i;
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-3 rounded-xl border-2 p-3 text-sm font-bold ${
                              isAnswer
                                ? "party-flare border-[#C9A84C] bg-[#C9A84C]/15"
                                : myWrongPick
                                  ? "party-shake border-[#e0654f]/60 bg-[#e0654f]/10"
                                  : light
                                    ? "border-[#C9A84C]/20 opacity-55"
                                    : "border-white/10 opacity-55"
                            } ${ink}`}
                          >
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                                isAnswer
                                  ? "bg-gradient-to-b from-[#f0d878] to-[#C9A84C] text-black"
                                  : light
                                    ? "bg-[#7A5A12]/12 text-[#7A5A12]"
                                    : "bg-white/[0.08] text-white/70"
                              }`}
                            >
                              {"ABCD"[i]}
                            </span>
                            <span className="min-w-0 flex-1">{choice}</span>
                            {isAnswer && <Check className="h-4 w-4 shrink-0 text-[#C9A84C]" />}
                            {myWrongPick && <X className="h-4 w-4 shrink-0 text-[#e0654f]" />}
                          </div>
                        );
                      })}
                    </div>
                  </>
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
          </div>

          {/* Live standings rail */}
          <aside className={`rounded-2xl border p-4 ${panel}`} data-testid="party-rail">
            <h3 className={`text-xs font-black uppercase tracking-[0.2em] ${muted}`}>Standings — live</h3>
            <Standings rows={standingsWithPlacement} ink={ink} muted={muted} selfId={client.self?.peerId} compact />
          </aside>
        </div>
      )}

      {!overlay && client.phase === "podium" && client.podium && (
        <section className={`relative mt-6 overflow-hidden rounded-2xl border p-6 text-center ${panel}`} data-testid="party-podium">
          <CoinShower burstKey={showerKey} />
          {(() => {
            const winner = client.podium.draw
              ? null
              : client.players.find((p) => p.peerId === client.podium!.winnerPeerIds[0]);
            return winner ? (
              <div className="relative mx-auto w-fit">
                <PlayerAvatar player={winner} size="lg" ring="ring-4 ring-[#C9A84C]/70" />
                <Crown className="party-crown-drop absolute -top-7 left-1/2 h-9 w-9 -translate-x-1/2 fill-[#f0d878] text-[#7A5A12]" />
              </div>
            ) : (
              <Trophy className="mx-auto h-10 w-10 text-[#C9A84C]" />
            );
          })()}
          <h2 className={`mt-3 text-xl font-black ${ink}`}>
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

/** The Court Battle face-off: two podiums, a VS medallion, and the
 *  crown jewels that light as rounds are won. */
function DuelStage({
  client,
  light,
  ink,
  muted,
}: {
  client: PartyClient;
  light: boolean;
  ink: string;
  muted: string;
}) {
  const [left, right] = client.players;
  const Podium = ({ p, side }: { p: PartyPlayer; side: "left" | "right" }) => (
    <div className={`flex flex-1 flex-col items-center gap-1.5 ${side === "right" ? "" : ""}`}>
      <PlayerAvatar
        player={p}
        size="lg"
        ring={
          client.reveal?.roundWinnerPeerId === p.peerId && client.phase === "reveal"
            ? "ring-4 ring-[#f0d878] shadow-[0_0_26px_rgba(240,216,120,0.5)]"
            : p.peerId === client.self?.peerId
              ? "ring-2 ring-[#f0d878]"
              : light
                ? "ring-2 ring-[#7A5A12]/30"
                : "ring-2 ring-white/20"
        }
      />
      <span className={`max-w-[130px] truncate text-sm font-black ${ink}`}>
        {p.displayName}
        {p.isHost && <Crown className="ml-1 inline h-3.5 w-3.5 text-[#C9A84C]" />}
      </span>
      <CrownJewels won={p.roundsWon} light={light} />
      <span className={`text-xs font-bold ${muted}`}>{p.score.toLocaleString()} pts</span>
    </div>
  );
  return (
    <section
      className={`mb-4 flex items-center gap-3 rounded-2xl border px-4 py-4 ${
        light ? "border-[#C9A84C]/40 bg-white/30" : "border-white/[0.08] bg-black/25"
      }`}
      data-testid="party-duel-stage"
    >
      {left && <Podium p={left} side="left" />}
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#f0d878] to-[#C9A84C] text-sm font-black text-black shadow-[0_0_20px_rgba(201,168,76,0.4)]">
        VS
      </span>
      {right && <Podium p={right} side="right" />}
    </section>
  );
}

function Standings({
  rows,
  ink,
  muted,
  selfId,
  compact = false,
}: {
  rows: { player: PartyPlayer; placement: number }[];
  ink: string;
  muted: string;
  selfId?: string;
  compact?: boolean;
}) {
  return (
    <ol className={`${compact ? "mt-3" : "mt-4"} grid gap-1.5`} data-testid="party-standings">
      {rows.map(({ player: p, placement }) => (
        <li
          key={p.peerId}
          className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${
            p.peerId === selfId ? "bg-[#C9A84C]/10 font-black" : ""
          } ${ink}`}
        >
          <span className="w-5 text-center font-black text-[#C9A84C]">{placement}</span>
          <PlayerAvatar player={p} size="sm" />
          <span className="min-w-0 flex-1 truncate">
            {p.displayName}
            {p.isHost && <Crown className="ml-1.5 inline h-3.5 w-3.5 text-[#C9A84C]" />}
            {!p.connected && <span className={`ml-2 text-xs ${muted}`}>(away)</span>}
          </span>
          {p.roundsWon > 0 && (
            <span className={`inline-flex items-center gap-1 text-xs font-bold ${muted}`}>
              <Gem className="h-3.5 w-3.5 fill-[#f0d878] text-[#C9A84C]" /> {p.roundsWon}
            </span>
          )}
          <span className="font-black">{p.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
