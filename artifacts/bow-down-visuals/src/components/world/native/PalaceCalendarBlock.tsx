import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { CalendarDays, DoorOpen, LogIn, Swords } from "lucide-react";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { formatEventTime } from "@/lib/world/objective-strip";
import {
  CALENDAR_RECENT_WINDOW_DAYS,
  QUEST_RESET_KIND,
  calendarDayLabel,
  calendarEventAction,
  groupPalaceCalendar,
  normalizeCalendarEvents,
  palaceDayKey,
  questResetCalendarEvent,
  type CalendarEvent,
} from "@/lib/world/palace-calendar";
import { PALACE_LAYOUT, creatorSlugFromRoomId } from "@/lib/world/palace-layout";
import {
  fetchWorldEventCalendar,
  type PalaceDirectoryEntry,
} from "@/lib/world/world-client";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";

/* ─── The Palace Calendar (UPGRADE-PROGRAM 3.9) ──────────────────
   Every happening in the World on one board: stage shows,
   listening parties, drops, contests, office hours and court
   gatherings, grouped by
   palace day (the UTC day-turn), today first and the week ahead
   after it — plus the look back at what the last seven days held.
   One further line is the quest week's own: the weekly quest
   reset, derived from the quest pool's Monday week (never an
   events-rail row) and appended to the slate before grouping, so
   the board names the turn the Treasury's slate turns on.
   It reads the events rail's own public slate (with the server's
   opt-in look back), the same read the board's Today block makes,
   so it reads identically for guests and members; what differs is
   the walking: a member's row carries the walk to the happening —
   into its room, or to the contest desk — and a guest's rows read
   look-only with the sign-in ask below, the board's standing rule.
   A row never wears a button that goes nowhere: a kind this
   client can't place reads look-only, named for what it is. */

/* Kind words key-mapped to the family catalog; unknown kinds read
   the family's fallback key. */
const KIND_KEYS: Record<string, string> = {
  stage_show: "worldScheduleRelease.calKindStageShow",
  listening_party: "worldScheduleRelease.calKindListeningParty",
  drop: "worldScheduleRelease.calKindDrop",
  contest: "worldScheduleRelease.calKindContest",
  office_hours: "worldScheduleRelease.calKindOfficeHours",
  royal_court: "worldScheduleRelease.calKindRoyalCourt",
  quest_reset: "worldScheduleRelease.calKindQuestReset",
};

export function PalaceCalendarBlock({
  directory,
  currentRoomId,
  isLight,
  isGuest,
  onEnterRoom,
  onOpenStation,
}: {
  directory: PalaceDirectoryEntry[];
  /** The room the walker stands in (a row for it reads "You're
   *  here" instead of offering the walk). */
  currentRoomId?: string;
  isLight: boolean;
  isGuest: boolean;
  /** The walk to a happening's room (palace or creator room — the
   *  page resolves the doorway). Optional: a host without it
   *  leaves the calendar look-only, like the party tables without
   *  their Join. */
  onEnterRoom?: (roomId: string) => void;
  /** Open a station's panel in-world — the contest rows' walk to
   *  the Winners' Circle desk. Optional, same rule as above. */
  onOpenStation?: (stationId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [read, setRead] = useState<{
    upcoming: CalendarEvent[];
    recent: CalendarEvent[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { events: slate, recent } = await fetchWorldEventCalendar();
        if (cancelled) return;
        setRead({
          upcoming: normalizeCalendarEvents(slate),
          recent: normalizeCalendarEvents(recent),
        });
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const calendar = useMemo(
    () =>
      read
        ? groupPalaceCalendar(
            /* The slate plus the quest reset — the week's own turn,
               shaped from the quest pool's Monday week at read time. */
            [...read.upcoming, questResetCalendarEvent(Date.now(), t("worldScheduleRelease.calQuestResetTitle"))],
            read.recent,
            Date.now(),
            {
              today: t("worldScheduleRelease.calToday"),
              tomorrow: t("worldScheduleRelease.calTomorrow"),
              locale: i18n.language,
            },
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [read, t, i18n.language],
  );

  const roomNameFor = (roomId: string, hostName?: string): string =>
    /* A creator room ("creator:<slug>") is named for its host —
     * it stands in no palace directory, by design. */
    creatorSlugFromRoomId(roomId)
      ? t("worldScheduleRelease.calCreatorRoom", { name: hostName?.trim() || t("worldScheduleRelease.calCreatorFallback") })
      : (directory.find((r) => r.id === roomId)?.name ??
        PALACE_LAYOUT[roomId]?.name ??
        t("worldScheduleRelease.calPalaceFallback"));

  const detailFor = (e: CalendarEvent): string => {
    /* The reset has no room and no host — its line says what turns. */
    if (e.kind === QUEST_RESET_KIND) {
      return t("worldScheduleRelease.calResetDetail");
    }
    const parts = [
      KIND_KEYS[e.kind] ? t(KIND_KEYS[e.kind]) : t("worldScheduleRelease.calKindFallback"),
      roomNameFor(e.roomId, e.hostName),
    ];
    if (e.hostName) parts.push(t("worldScheduleRelease.calHostedBy", { name: e.hostName }));
    if (e.theme) parts.push(`“${e.theme}”`);
    if (e.note) parts.push(e.note);
    return parts.join(" · ");
  };

  /* A member's walk for a row; guests and handler-less hosts get
     no button at all — never a dead one. Recent rows never carry
     one either: that happening is over. */
  const actionFor = (e: CalendarEvent) => {
    if (isGuest) return undefined;
    const action = calendarEventAction(e);
    if (action.type === "room") {
      if (currentRoomId && action.roomId === currentRoomId) {
        return (
          <span className="text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">
            {t("worldScheduleRelease.calYoureHere")}
          </span>
        );
      }
      if (!onEnterRoom) return undefined;
      return (
        <button
          type="button"
          data-testid={`world-calendar-goto-${e.id}`}
          onClick={() => onEnterRoom(action.roomId)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          <DoorOpen className="h-3.5 w-3.5" /> {t("worldScheduleRelease.calGoToRoom")}
        </button>
      );
    }
    if (action.type === "station") {
      if (!onOpenStation) return undefined;
      return (
        <button
          type="button"
          data-testid={`world-calendar-station-${e.id}`}
          onClick={() => onOpenStation(action.stationId)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          <Swords className="h-3.5 w-3.5" />{" "}
          {e.kind === QUEST_RESET_KIND ? t("worldScheduleRelease.calSeeQuests") : t("worldScheduleRelease.calSeeContest")}
        </button>
      );
    }
    return undefined;
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/40";

  return (
    <>
      {/* ── The week ahead ── */}
      <div data-testid="world-kingdom-calendar">
        <NativeBoard isLight={isLight} title={t("worldScheduleRelease.calBoardTitle")}>
          {failed ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldScheduleRelease.calLoadFailedTitle")}
              message={t("worldScheduleRelease.calLoadFailedMessage")}
              onRetry={() => {
                setFailed(false);
                setRead(null);
                setTick((n) => n + 1);
              }}
            />
          ) : !calendar ? (
            <NativeLoadingState isLight={isLight} message={t("worldScheduleRelease.calLoading")} />
          ) : calendar.days.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldScheduleRelease.calEmptyTitle")}
              detail={t("worldScheduleRelease.calEmptyDetail")}
            />
          ) : (
            <>
              {calendar.days.map((day) => (
                <div key={day.dayKey} className="space-y-1.5" data-testid={`world-calendar-day-${day.dayKey}`}>
                  <p
                    className={`inline-flex items-center gap-1.5 px-1 pt-1 text-[11px] font-black uppercase tracking-[0.14em] ${
                      isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
                    }`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> {day.label}
                  </p>
                  {day.events.map((e) => (
                    <NativeBoardRow
                      key={e.id}
                      isLight={isLight}
                      title={e.title}
                      detail={detailFor(e)}
                      meta={e.status === "live" ? t("worldScheduleRelease.calLiveNow") : formatEventTime(e.startsAt)}
                      highlighted={e.status === "live"}
                      action={actionFor(e)}
                    />
                  ))}
                </div>
              ))}
              {calendar.laterCount > 0 && (
                <p className={`px-1 pt-1 text-[11px] ${muted}`}>
                  {t(calendar.laterCount === 1 ? "worldScheduleRelease.calLaterOne" : "worldScheduleRelease.calLaterMany", { count: calendar.laterCount })}
                </p>
              )}
              {isGuest && (
                <p className={`inline-flex flex-wrap items-center gap-2 px-1 pt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                  {t("worldScheduleRelease.calGuestLine")}
                  <Link
                    href={GUEST_SIGN_IN_HREF}
                    className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105"
                  >
                    <LogIn className="h-3 w-3" /> {t("worldScheduleRelease.calSignInToJoin")}
                  </Link>
                </p>
              )}
            </>
          )}
        </NativeBoard>
      </div>

      {/* ── The look back ── */}
      {calendar && calendar.recent.length > 0 && (
        <div data-testid="world-kingdom-calendar-recent">
          <NativeBoard
            isLight={isLight}
            title={t("worldScheduleRelease.calRecentTitle", { days: CALENDAR_RECENT_WINDOW_DAYS })}
          >
            {calendar.recent.map((e) => (
              <NativeBoardRow
                key={e.id}
                isLight={isLight}
                title={e.title}
                detail={detailFor(e)}
                meta={`${calendarDayLabel(palaceDayKey(Date.parse(e.startsAt)), Date.now(), {
                  today: t("worldScheduleRelease.calToday"),
                  tomorrow: t("worldScheduleRelease.calTomorrow"),
                  locale: i18n.language,
                })} · ${formatEventTime(e.startsAt)}`}
              />
            ))}
          </NativeBoard>
        </div>
      )}
    </>
  );
}
