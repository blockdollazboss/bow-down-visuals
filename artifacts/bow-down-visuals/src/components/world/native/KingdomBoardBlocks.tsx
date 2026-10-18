import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Crown, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
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

/* ─── Kingdom Board blocks (Lane K2, item 2) ───────────────────────
   Two blocks join the Kingdom Board's room directory:
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
   Guests: the standings rail is members-only (it answers 401), so
   a guest's standings block is the sign-in pitch — no fake rows,
   no claim buttons (there are none here for anyone). The today
   block is public information and reads the same for everyone. */

const EVENT_KIND_LABELS: Record<string, string> = {
  stage_show: "Stage show",
  listening_party: "Listening party",
  drop: "Drop",
};

export function KingdomBoardBlocks({
  directory,
  isLight,
  isGuest,
}: {
  directory: PalaceDirectoryEntry[];
  isLight: boolean;
  isGuest: boolean;
}) {
  const { getAccessToken } = useAuth();
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [restEvents, setRestEvents] = useState<PalaceSlateEvent[]>([]);
  const [tick, setTick] = useState(0);

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

  const today = useMemo(
    () => eventsToday(mergeSlates(restEvents, directorySlate(directory)), Date.now()),
    [restEvents, directory],
  );

  const roomNameFor = (roomId: string): string =>
    directory.find((r) => r.id === roomId)?.name ??
    PALACE_LAYOUT[roomId]?.name ??
    "the palace";

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
          {today.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="Nothing on today's slate at the palace."
              detail="Booked shows, listening parties and drops will read here on their day."
            />
          ) : (
            today.map((e) => (
              <NativeBoardRow
                key={e.id}
                isLight={isLight}
                title={e.title}
                detail={`${EVENT_KIND_LABELS[e.kind] ?? "Palace event"} · ${roomNameFor(e.roomId)}${e.hostName ? ` · hosted by ${e.hostName}` : ""}`}
                meta={
                  e.status === "live" ? "LIVE now" : formatEventTime(e.startsAt)
                }
                highlighted={e.status === "live"}
              />
            ))
          )}
        </NativeBoard>
      </div>
    </div>
  );
}
