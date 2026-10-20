import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, Crown, Link2, LogIn, Swords } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  PARTY_GAME_META,
  parsePartyRooms,
  partyInviteUrl,
  partyTableHomeLine,
  partyTableSeatState,
  type PartyOpenRoom,
} from "@/lib/world/games-lobby";
import {
  normalizeLeaderboard,
  type Leaderboard,
} from "@/lib/world/treasury-quests";
import {
  directorySlate,
  eventsToday,
  formatEventTime,
  kingdomStandings,
  mergeSlates,
  normalizeWorldEventSlate,
  type PalaceSlateEvent,
} from "@/lib/world/objective-strip";
import { PALACE_LAYOUT } from "@/lib/world/palace-layout";
import {
  fetchWorldEvents,
  type PalaceDirectoryEntry,
} from "@/lib/world/world-client";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import { PalaceCalendarBlock } from "./PalaceCalendarBlock";

/* ─── Kingdom Board blocks (Lane K2, item 2) ───────────────────────
   Blocks joining the Kingdom Board's room directory:
     STANDINGS — the weekly creation leaderboard's top 5 + the
       viewer's own rank, from GET /api/retention/leaderboard (the
       same rail the Treasury standings read). Own rank shows ONLY
       when signed in and present in the rail's answer — never
       fabricated. The rail carries no Front Row field, so the
       block names that plainly instead of inventing a standing.
     TODAY AT THE PALACE — today's slate from Lane H's events
       (GET /api/world/events + the directory frame's slate):
       shows, listening parties and drops with times and rooms,
       live ones marked live.
     PALACE CALENDAR (3.9) — PalaceCalendarBlock below: the same
       happenings grouped by palace day across the week ahead,
       with the last seven days behind them, and a member's walk
       to each one (its room, or the contest desk).
     OPEN PARTY TABLES (program 2.23's directory join) — the open
       Marble Tables off the server's own rail (GET /api/party/rooms,
       the lobby's discovery read), each with a Join that hands the
       table to the page's summons machinery — the same walk a
       /world?party=CODE landing takes: across to the Game Rooms,
       the Marble Table open, the seat offered. The board never
       seats anyone itself; it names the table and the page walks.
       Each row also carries the Invite copy the lobby rows carry —
       the same /world?party=CODE link (partyInviteUrl), so a host
       reading the board can summon a friend straight from the
       directory — and a FULL table reads full and offers no seat
       (partyTableSeatState, the profile table block's precedent):
       the board never walks anyone to a seat that isn't there.
   Guests: the standings rail is members-only (it answers 401), so
   a guest's standings block is the sign-in pitch — no fake rows,
   no claim buttons (there are none here for anyone). The party
   rail is members-only the same way, so the tables block is the
   pitch too. The today block is public information and reads the
   same for everyone. */

const EVENT_KIND_LABELS: Record<string, string> = {
  stage_show: "Stage show",
  listening_party: "Listening party",
  drop: "Drop",
  contest: "Contest",
  office_hours: "Office hours",
};

export function KingdomBoardBlocks({
  directory,
  isLight,
  isGuest,
  kingLine,
  onJoinPartyTable,
  currentRoomId,
  onEnterRoom,
  onOpenStation,
}: {
  directory: PalaceDirectoryEntry[];
  isLight: boolean;
  isGuest: boolean;
  /** The room the walker stands in — the calendar block marks a
   *  happening there "You're here". Optional. */
  currentRoomId?: string;
  /** The Palace Calendar's walk to a happening's room (3.9) —
   *  threaded to the calendar block. Optional: without it the
   *  calendar reads look-only. */
  onEnterRoom?: (roomId: string) => void;
  /** Open a station's panel in-world — the calendar's contest
   *  rows ride it to the Winners' Circle desk. Optional. */
  onOpenStation?: (stationId: string) => void;
  /** The King's daily moment line (Ring 3) — while his claim
   *  window stands in the hall it leads the today block (the
   *  page builds it from the hall's kingMoment state). Null =
   *  no court stands; the block reads as before. */
  kingLine?: string | null;
  /** The party tables block's Join (program 2.23): the page's
   *  summons walk for the named table — the same machinery a
   *  /world?party=CODE landing rides. Optional: a host without
   *  it leaves the block's tables look-only, named but unseated. */
  onJoinPartyTable?: (room: PartyOpenRoom) => void;
}) {
  const { getAccessToken } = useAuth();
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [restEvents, setRestEvents] = useState<PalaceSlateEvent[]>([]);
  const [tables, setTables] = useState<PartyOpenRoom[] | null>(null);
  const [tablesFailed, setTablesFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  /* The row's Invite copy — the lobby rows' own gesture, verbatim:
     the /world deep link for the table (partyInviteUrl), a brief
     "Copied" on success, and on clipboard failure nothing breaks —
     the table's code rides its home line for plain tables. */
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const events = await fetchWorldEvents();
        if (!cancelled) setRestEvents(normalizeWorldEventSlate(events));
      } catch {
        /* The directory slate still speaks. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        const headers: Record<string, string> = token
          ? { Authorization: `Bearer ${token}` }
          : {};
        const res = await fetch("/api/retention/leaderboard", { headers });
        if (!res.ok) throw new Error("leaderboard");
        const normalized = normalizeLeaderboard(await res.json());
        if (!normalized) throw new Error("leaderboard payload");
        if (!cancelled) {
          setBoard(normalized);
          setBoardFailed(false);
        }
      } catch {
        if (!cancelled) setBoardFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  /* The open party tables — the Marble Table lobby's own
     discovery rail (members-only; guests never spend the fetch,
     their block is the pitch). */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        const headers: Record<string, string> = token
          ? { Authorization: `Bearer ${token}` }
          : {};
        const res = await fetch("/api/party/rooms", { headers });
        if (!res.ok) throw new Error("party rooms");
        const parsed = parsePartyRooms(await res.json());
        if (!cancelled) {
          setTables(parsed);
          setTablesFailed(false);
        }
      } catch {
        if (!cancelled) setTablesFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  const today = useMemo(
    () => eventsToday(mergeSlates(restEvents, directorySlate(directory)), Date.now()),
    [restEvents, directory],
  );

  const roomNameFor = (roomId: string, hostName?: string): string =>
    /* A creator room ("creator:<slug>") is named for its host —
     * it stands in no palace directory, by design. */
    roomId.startsWith("creator:")
      ? `${hostName?.trim() || "Creator"}'s Room`
      : (directory.find((r) => r.id === roomId)?.name ??
        PALACE_LAYOUT[roomId]?.name ??
        "the palace");

  const standings = board ? kingdomStandings(board) : null;

  return (
    <div className="mt-3 space-y-3" data-testid="world-kingdom-blocks">
      {/* ── Standings ── */}
      {isGuest ? (
        <div data-testid="world-kingdom-standings">
          <NativeBoard isLight={isLight} title="Standings — this week's creators">
            <p
              className={`inline-flex flex-wrap items-center gap-2 px-1 py-1 text-sm ${
                isLight ? "text-[#6B5B36]" : "text-white/55"
              }`}
            >
              The week&rsquo;s standings are members&rsquo; business.
              <Link
                href={GUEST_SIGN_IN_HREF}
                className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105"
              >
                <LogIn className="h-3 w-3" /> Sign in to see them
              </Link>
            </p>
          </NativeBoard>
        </div>
      ) : boardFailed ? (
        <div data-testid="world-kingdom-standings">
          <NativeErrorState
            isLight={isLight}
            title="The standings wouldn't load"
            message="The kingdom's creators are still ranked on the real rails. Try again."
            onRetry={() => {
              setBoardFailed(false);
              setBoard(null);
              setTick((n) => n + 1);
            }}
          />
        </div>
      ) : !standings ? (
        <div data-testid="world-kingdom-standings">
          <NativeLoadingState isLight={isLight} message="Reading the standings…" />
        </div>
      ) : standings.top.length === 0 ? (
        <div data-testid="world-kingdom-standings">
          <NativeEmptyState
            isLight={isLight}
            message="No creations on the board yet this week — the first one takes the crown."
            detail="The standings count this week's creations and exports across the kingdom."
          />
        </div>
      ) : (
        <div data-testid="world-kingdom-standings">
          <NativeBoard
            isLight={isLight}
            title="Standings — this week's creators"
            headline={
              standings.viewerRank !== null && !standings.viewerInTop ? (
                <p
                  className={`inline-flex items-center gap-2 px-1 text-xs font-bold ${
                    isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
                  }`}
                >
                  <Crown className="h-3.5 w-3.5" /> You stand #{standings.viewerRank} this
                  week — {standings.viewerScore} creations + exports
                </p>
              ) : undefined
            }
          >
            {standings.top.map((r) => (
              <NativeBoardRow
                key={r.rank}
                isLight={isLight}
                title={`#${r.rank} · ${r.name}${r.isYou ? " (you)" : ""}`}
                detail={`${r.creations} creations · ${r.exports} exports`}
                meta={`${r.score}`}
                highlighted={r.isYou}
              />
            ))}
            <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              Standings are honor only — no Visual Bucs ride on them. Front Row standing
              isn&rsquo;t carried by this rail — the Front Row sits in the Royal Court
              Chamber.
            </p>
          </NativeBoard>
        </div>
      )}

      {/* ── Today at the palace ── */}
      <div data-testid="world-kingdom-today">
        <NativeBoard isLight={isLight} title="Today at the palace">
          {kingLine && (
            <NativeBoardRow
              isLight={isLight}
              title="The King's daily moment"
              detail={kingLine}
              meta="LIVE now"
              highlighted
            />
          )}
          {today.length === 0 && !kingLine ? (
            <NativeEmptyState
              isLight={isLight}
              message="Nothing on today's slate at the palace."
              detail="Booked shows, listening parties, office hours and drops will read here on their day."
            />
          ) : (
            today.map((e) => (
              <NativeBoardRow
                key={e.id}
                isLight={isLight}
                title={e.title}
                detail={`${EVENT_KIND_LABELS[e.kind] ?? "Palace event"} · ${roomNameFor(e.roomId, e.hostName)}${e.hostName ? ` · hosted by ${e.hostName}` : ""}`}
                meta={
                  e.status === "live" ? "LIVE now" : formatEventTime(e.startsAt)
                }
                highlighted={e.status === "live"}
              />
            ))
          )}
        </NativeBoard>
      </div>

      {/* ── Palace calendar (3.9) ── */}
      <PalaceCalendarBlock
        directory={directory}
        currentRoomId={currentRoomId}
        isLight={isLight}
        isGuest={isGuest}
        onEnterRoom={onEnterRoom}
        onOpenStation={onOpenStation}
      />

      {/* ── Open party tables ── */}
      <div data-testid="world-kingdom-party-tables">
        <NativeBoard isLight={isLight} title="Open party tables">
          {isGuest ? (
            <p
              className={`inline-flex flex-wrap items-center gap-2 px-1 py-1 text-sm ${
                isLight ? "text-[#6B5B36]" : "text-white/55"
              }`}
            >
              The party tables are members&rsquo; games — the Marble Table
              seats signed-in players.
              <Link
                href={GUEST_SIGN_IN_HREF}
                className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105"
              >
                <LogIn className="h-3 w-3" /> Sign in to take a seat
              </Link>
            </p>
          ) : tablesFailed ? (
            <NativeErrorState
              isLight={isLight}
              title="The tables wouldn't come into view"
              message="Open party tables wouldn't load — the tables themselves are fine. Try again."
              onRetry={() => {
                setTablesFailed(false);
                setTables(null);
                setTick((n) => n + 1);
              }}
            />
          ) : tables === null ? (
            <NativeLoadingState isLight={isLight} message="Looking for open tables…" />
          ) : tables.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No tables are open right now."
              detail="Open the first one at the Marble Table in the Game Rooms — it will read here for the whole palace."
            />
          ) : (
            tables.map((room) => {
              const meta = PARTY_GAME_META[room.game];
              const seatState = partyTableSeatState(room);
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
                        data-testid={`world-kingdom-party-invite-${room.code}`}
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
                      {seatState === "full" ? (
                        <span
                          data-testid={`world-kingdom-party-full-${room.code}`}
                          className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold opacity-70 ${
                            isLight
                              ? "border-[#7A5A12]/30 text-[#6B5B36]"
                              : "border-white/15 text-white/70"
                          }`}
                        >
                          Table full
                        </span>
                      ) : onJoinPartyTable ? (
                        <button
                          type="button"
                          data-testid={`world-kingdom-party-join-${room.code}`}
                          onClick={() => onJoinPartyTable(room)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                        >
                          <Swords className="h-3.5 w-3.5" /> Take a seat
                        </button>
                      ) : null}
                    </span>
                  }
                />
              );
            })
          )}
        </NativeBoard>
      </div>
    </div>
  );
}
