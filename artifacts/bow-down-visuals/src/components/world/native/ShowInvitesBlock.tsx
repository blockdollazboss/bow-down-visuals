/**
 * ShowInvitesBlock — invite-to-a-show (stack1300, Ring 3.8), docked
 * on the Kingdom Board directly under the Palace Calendar: the
 * calendar is where shows live, so the invites live with it.
 * Two panels, each shown only when it has something to say:
 * - "Show invites for you": a host named YOU to a specific show
 *   (never an anonymous link) — Accept records the yes and the
 *   show joins "Shows you're coming to", each carrying the
 *   calendar's own walk (its room, or the contest desk); Decline
 *   records the no and the row simply leaves.
 * - "Invite to your show" (hosts only): pick one of YOUR standing
 *   shows, pick a person from the member list (the room invites'
 *   directory, reused), and the invite goes out under your name
 *   carrying the show; the server's plain words answer a refusal
 *   (a duplicate already out reads exactly as it is).
 * Failure is never dressed as empty: a failed read says so and
 * offers Try again. Every control is a native button, input or
 * select, so the panel's controller navigation walks them like
 * every other control in the panel. Guests see none of it: an
 * invite names a member, and a guest is nobody yet.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, DoorOpen, Loader2, Mail, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { plainErrorText } from "@/lib/api-error";
import {
  fetchRoomInviteCandidates,
  type RoomInviteCandidate,
} from "@/lib/world/creator-rooms";
import type { CalendarEvent } from "@/lib/world/palace-calendar";
import {
  answerShowInvite,
  fetchShowInvitesMine,
  sendShowInvite,
  showInviteAction,
  upcomingInvitableShows,
  type WorldShowInvite,
} from "@/lib/world/show-invites";

/* Kind words key-mapped to the family catalog (the calendar's own
   kind keys); unknown kinds read the invites fallback key. */
const KIND_KEYS: Record<string, string> = {
  stage_show: "worldScheduleRelease.calKindStageShow",
  listening_party: "worldScheduleRelease.calKindListeningParty",
  drop: "worldScheduleRelease.calKindDrop",
  contest: "worldScheduleRelease.calKindContest",
  office_hours: "worldScheduleRelease.calKindOfficeHours",
};

/** The show's hour, in the words the board speaks: "Fri, Nov 6 · 7:00 PM". */
function showWhenLabel(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

export function ShowInvitesBlock({
  isLight,
  onEnterRoom,
  onOpenStation,
}: {
  isLight: boolean;
  /** The calendar's walk to a show's room — threaded from the
   *  board. Optional: without it accepted invites read look-only. */
  onEnterRoom?: (roomId: string) => void;
  /** Open a station's panel in-world — a contest invite's walk. */
  onOpenStation?: (stationId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [mine, setMine] = useState<{ pending: WorldShowInvite[]; accepted: WorldShowInvite[] } | null>(null);
  const [mineFailed, setMineFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerDone, setAnswerDone] = useState<string | null>(null);
  const [shows, setShows] = useState<CalendarEvent[] | null>(null);
  const [showsFailed, setShowsFailed] = useState(false);
  const [showsTick, setShowsTick] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<RoomInviteCandidate[] | null>(null);
  const [candidatesFailed, setCandidatesFailed] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentKeys, setSentKeys] = useState<ReadonlySet<string>>(new Set());
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendDone, setSendDone] = useState<string | null>(null);

  /* My standing invites — refetched after every answer, so the
   * sections always show the server's record, never a local
   * guess at it. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setMineFailed(false);
    (async () => {
      try {
        const token = await getAccessToken();
        const standing = await fetchShowInvitesMine(token, {
          loadFailed: t("worldScheduleRelease.invMineLoadFailed"),
          sendFailed: t("worldScheduleRelease.invSendFailed"),
          answerFailed: t("worldScheduleRelease.invAnswerFailed"),
        });
        if (!cancelled) setMine(standing);
      } catch {
        if (!cancelled) setMineFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, getAccessToken, tick, t]);

  /* My own standing shows — the picker's list, off the calendar
   * backbone's mine read. Only shows the server would accept an
   * invite for are offered (upcomingInvitableShows). */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setShowsFailed(false);
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/world/events/mine", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("mine failed");
        const payload: unknown = await res.json().catch(() => null);
        if (!cancelled) {
          const invitable = upcomingInvitableShows(payload, Date.now());
          setShows(invitable);
          setSelectedEventId((prev) =>
            invitable.some((s) => s.id === prev) ? prev : (invitable[0]?.id ?? ""),
          );
        }
      } catch {
        if (!cancelled) setShowsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, showsTick]);

  /* The member list for the picker — hosts with a show standing
   * only, debounced on the search (the room invites' read, reused). */
  const hasShows = showsFailed || (shows !== null && shows.length > 0);
  useEffect(() => {
    if (!user || !hasShows) return;
    let cancelled = false;
    const t = setTimeout(() => {
      (async () => {
        try {
          const token = await getAccessToken();
          const members = await fetchRoomInviteCandidates(token, query);
          if (!cancelled) {
            setCandidates(members);
            setCandidatesFailed(false);
          }
        } catch {
          if (!cancelled) setCandidatesFailed(true);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user, hasShows, query, getAccessToken]);

  if (!user) return null;

  const answer = async (invite: WorldShowInvite, which: "accept" | "decline") => {
    if (answeringId) return;
    setAnsweringId(invite.id);
    setAnswerError(null);
    setAnswerDone(null);
    try {
      const token = await getAccessToken();
      await answerShowInvite(invite.id, which, token, {
        loadFailed: t("worldScheduleRelease.invMineLoadFailed"),
        sendFailed: t("worldScheduleRelease.invSendFailed"),
        answerFailed: t("worldScheduleRelease.invAnswerFailed"),
      });
      setAnswerDone(
        which === "accept"
          ? t("worldScheduleRelease.invAcceptedDone", { title: invite.eventTitle })
          : t("worldScheduleRelease.invDeclinedDone"),
      );
      setTick((n) => n + 1);
    } catch (err) {
      setAnswerError(plainErrorText(err, t("worldScheduleRelease.invAnswerFailed")));
    } finally {
      setAnsweringId(null);
    }
  };

  const send = async (candidate: RoomInviteCandidate) => {
    if (!selectedEventId || sendingId) return;
    setSendingId(candidate.userId);
    setSendError(null);
    setSendDone(null);
    try {
      const token = await getAccessToken();
      const invite = await sendShowInvite(selectedEventId, candidate.userId, token, {
        loadFailed: t("worldScheduleRelease.invMineLoadFailed"),
        sendFailed: t("worldScheduleRelease.invSendFailed"),
        answerFailed: t("worldScheduleRelease.invAnswerFailed"),
      });
      setSentKeys((prev) => new Set(prev).add(`${invite.eventId}:${candidate.userId}`));
      setSendDone(t("worldScheduleRelease.invSentDone", { name: candidate.displayName, title: invite.eventTitle }));
    } catch (err) {
      setSendError(plainErrorText(err, t("worldScheduleRelease.invSendFailed")));
    } finally {
      setSendingId(null);
    }
  };

  const walk = (invite: WorldShowInvite) => {
    const action = showInviteAction(invite);
    if (action.type === "room") onEnterRoom?.(action.roomId);
    else if (action.type === "station") onOpenStation?.(action.stationId);
  };
  const walkTarget = (invite: WorldShowInvite) => {
    const action = showInviteAction(invite);
    if (action.type === "room" && onEnterRoom) return "room" as const;
    if (action.type === "station" && onOpenStation) return "station" as const;
    return null;
  };

  const cardClass = `rounded-2xl border px-3 py-3 ${
    isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/25 bg-white/5"
  }`;
  const headingClass = `inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide ${
    isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
  }`;
  const subClass = `text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`;
  const errorClass = `text-xs font-semibold ${isLight ? "text-[#9A3412]" : "text-red-300"}`;
  const doneClass = `text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  const avatar = (url: string | null, name: string) =>
    url ? (
      <img src={url} alt={name} className="h-9 w-9 shrink-0 rounded-full border-2 border-[#d4af37]/60 object-cover" />
    ) : (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#d4af37]/60 bg-gradient-to-br from-[#f0d488] to-[#d4af37] text-sm font-black text-black">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );

  const showMine = mineFailed || (mine !== null && (mine.pending.length > 0 || mine.accepted.length > 0));
  const selectedShow = shows?.find((s) => s.id === selectedEventId) ?? null;

  return (
    <>
      {showMine && (
        <div className={cardClass} data-testid="world-show-invites-for-you">
          <p className={headingClass}>
            <Mail className="h-4 w-4 text-[#d4af37]" /> {t("worldScheduleRelease.invForYouTitle")}
          </p>
          {mineFailed ? (
            <div className="flex flex-col items-start gap-2 pt-2">
              <p className={subClass}>{t("worldScheduleRelease.invLoadFailed")}</p>
              <button
                type="button"
                onClick={() => setTick((n) => n + 1)}
                className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                {t("worldScheduleRelease.invTryAgain")}
              </button>
            </div>
          ) : (
            <>
              {mine!.pending.length > 0 && (
                <div className="space-y-2 pt-2">
                  {mine!.pending.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-wrap items-center gap-2.5"
                      data-testid="world-show-invite-pending"
                    >
                      {avatar(invite.hostAvatarUrl, invite.hostName)}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                          {t("worldScheduleRelease.invInvitedYou", { host: invite.hostName, title: invite.eventTitle })}
                        </span>
                        <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                          {KIND_KEYS[invite.eventKind] ? t(KIND_KEYS[invite.eventKind]) : t("worldScheduleRelease.invKindFallback")} · {showWhenLabel(invite.startsAt, i18n.language)}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={answeringId !== null}
                        onClick={() => void answer(invite, "accept")}
                        className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                        data-testid="world-show-invite-accept"
                      >
                        {answeringId === invite.id ? t("worldScheduleRelease.invAnswering") : t("worldScheduleRelease.invAccept")}
                      </button>
                      <button
                        type="button"
                        disabled={answeringId !== null}
                        onClick={() => void answer(invite, "decline")}
                        className={`rounded-full border px-4 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                          isLight
                            ? "border-[#C9A84C]/60 text-[#7A5A12] hover:border-[#7A5A12]"
                            : "border-[#d4af37]/30 text-white/70 hover:border-[#d4af37]/70"
                        }`}
                        data-testid="world-show-invite-decline"
                      >
                        {t("worldScheduleRelease.invDecline")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {mine!.accepted.length > 0 && (
                <div className="space-y-2 pt-2" data-testid="world-show-invites-coming">
                  <p className={subClass}>{t("worldScheduleRelease.invComingTo")}</p>
                  {mine!.accepted.map((invite) => {
                    const target = walkTarget(invite);
                    return (
                      <div
                        key={invite.id}
                        className="flex flex-wrap items-center gap-2.5"
                        data-testid="world-show-invite-accepted"
                      >
                        {avatar(invite.hostAvatarUrl, invite.hostName)}
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                            “{invite.eventTitle}”
                          </span>
                          <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                            {t("worldScheduleRelease.invHostingLine", { host: invite.hostName })} · {showWhenLabel(invite.startsAt, i18n.language)}
                          </span>
                        </span>
                        {target && (
                          <button
                            type="button"
                            onClick={() => walk(invite)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                            data-testid="world-show-invite-walk"
                          >
                            <DoorOpen className="h-3.5 w-3.5" />{" "}
                            {target === "room" ? t("worldScheduleRelease.invGoToShow") : t("worldScheduleRelease.invOpenContestDesk")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {answerError && (
                <p className={`${errorClass} pt-2`} data-testid="world-show-invite-answer-error">
                  {answerError}
                </p>
              )}
              {answerDone && (
                <p className={`${doneClass} pt-2`} data-testid="world-show-invite-answer-done">
                  {answerDone}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {hasShows && (
        <div className={cardClass} data-testid="world-show-invites-send">
          <p className={headingClass}>
            <UserPlus className="h-4 w-4 text-[#d4af37]" /> {t("worldScheduleRelease.invSendTitle")}
          </p>
          {showsFailed ? (
            <div className="flex flex-col items-start gap-2 pt-2">
              <p className={subClass}>{t("worldScheduleRelease.invShowsLoadFailed")}</p>
              <button
                type="button"
                onClick={() => setShowsTick((n) => n + 1)}
                className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                {t("worldScheduleRelease.invTryAgain")}
              </button>
            </div>
          ) : (
            <>
              <p className={`${subClass} pt-1`}>
                {t("worldScheduleRelease.invSendIntro")}
              </p>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                aria-label={t("worldScheduleRelease.invPickShowAria")}
                className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
                  isLight
                    ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] focus:border-[#7A5A12]"
                    : "border-[#d4af37]/25 bg-white/5 text-white focus:border-[#d4af37]/70"
                }`}
                data-testid="world-show-invite-show-picker"
              >
                {(shows ?? []).map((show) => (
                  <option key={show.id} value={show.id}>
                    {show.title} — {showWhenLabel(show.startsAt, i18n.language)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("worldScheduleRelease.invSearchPlaceholder")}
                aria-label={t("worldScheduleRelease.invSearchAria")}
                className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
                  isLight
                    ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
                    : "border-[#d4af37]/25 bg-white/5 text-white placeholder:text-white/35 focus:border-[#d4af37]/70"
                }`}
                data-testid="world-show-invite-search"
              />
              <div className="space-y-2 pt-2">
                {candidatesFailed ? (
                  <p className={subClass}>{t("worldScheduleRelease.invMembersLoadFailed")}</p>
                ) : candidates === null ? (
                  <p className={`inline-flex items-center gap-2 ${subClass}`}>
                    <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldScheduleRelease.invMembersLoading")}
                  </p>
                ) : candidates.length === 0 ? (
                  <p className={subClass}>
                    {query.trim()
                      ? t("worldScheduleRelease.invNoMatch")
                      : t("worldScheduleRelease.invNoMembers")}
                  </p>
                ) : (
                  candidates.map((candidate) => {
                    const sent = selectedShow !== null && sentKeys.has(`${selectedShow.id}:${candidate.userId}`);
                    return (
                      <div
                        key={candidate.userId}
                        className="flex flex-wrap items-center gap-2.5"
                        data-testid="world-show-invite-candidate"
                      >
                        {avatar(candidate.avatarUrl, candidate.displayName)}
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                            {candidate.displayName}
                          </span>
                          <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                            /artist/{candidate.slug}
                          </span>
                        </span>
                        {sent ? (
                          <span className={`inline-flex items-center gap-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                            <Check className="h-3.5 w-3.5" /> {t("worldScheduleRelease.invInviteSent")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={sendingId !== null || !selectedShow}
                            onClick={() => void send(candidate)}
                            className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                            data-testid="world-show-invite-send-button"
                          >
                            {sendingId === candidate.userId ? t("worldScheduleRelease.invSending") : t("worldScheduleRelease.invInvite")}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              {sendError && (
                <p className={`${errorClass} pt-2`} data-testid="world-show-invite-send-error">
                  {sendError}
                </p>
              )}
              {sendDone && (
                <p className={`${doneClass} pt-2`} data-testid="world-show-invite-send-done">
                  {sendDone}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
