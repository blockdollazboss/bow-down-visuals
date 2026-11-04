import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Crown, LogIn, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import { HALL_ROOM_ID, MUSIC_HALL_ID } from "@/lib/world/palace-layout";
import {
  buildContestBody,
  ContestApiError,
  contestDeadlineLine,
  contestPhaseLabel,
  enterContestWork,
  fetchContestDetail,
  fetchContests,
  fetchMyContestWorks,
  fetchWinnersCircle,
  hostContest,
  myContestEntry,
  nameContestWinners,
  type ContestErrorCopyBundle,
  type MyContestWork,
  type WinnersCircleHonor,
  type WorldContest,
  type WorldContestEntry,
} from "@/lib/world/contests";

/* ─── The Winners' Circle (UPGRADE-PROGRAM 2.24) ──────────────────
   The Royal Court Chamber's contest board: the palace's standing
   competitions and the honors they leave behind.

   - CONTESTS: every open, judging and decided contest on the two
     stages (Throne Hall, Music Hall), with its theme, host,
     deadline and entries. Opening one shows the entries.
   - ENTERING: a member enters ONE of their own published works
     (the picker reads the same my-works rail the server verifies
     against; unpublished works show disabled with the reason).
     Guests read everything and meet the pitch at the door —
     never a dead button.
   - JUDGING: when the window closes, the host names the podium
     from the entries, right here; the pick stands forever and
     lands below.
   - THE CIRCLE: every honor on record — winner, work, contest,
     date — public spectacle, guests included.
   - HOSTING: a member opens a contest from the form (the server
     applies the stage's rule: Throne Hall = Front Row + house,
     Music Hall = any member) and its refusal is shown in its own
     words.

   Honors are the prize in v1 — no Visual Bucs move for a win,
   and the panel says so rather than implying a purse. */

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white"
  }`;

const goldBtn =
  "rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const ghostBtn = (isLight: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

function defaultDeadlineLocal(): string {
  const d = new Date(Date.now() + 48 * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* The seam's word tables (stage / phase / place) render from the
   catalog, keyed by the seam's own tokens, with the seam functions
   kept as the fallback for anything unmapped. */
const PHASE_KEYS: Record<string, string> = {
  announced: "worldSocialDesk.winnersPhaseAnnounced",
  open: "worldSocialDesk.winnersPhaseOpen",
  judging: "worldSocialDesk.winnersPhaseJudging",
  decided: "worldSocialDesk.winnersPhaseDecided",
  "called-off": "worldSocialDesk.winnersPhaseCalledOff",
};

export function WinnersCirclePanel({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const userId = user?.id ?? null;

  const stageName = (roomId: string) =>
    roomId === HALL_ROOM_ID
      ? t("worldSocialDesk.winnersStageThroneHall")
      : roomId === MUSIC_HALL_ID
        ? t("worldSocialDesk.winnersStageMusicHall")
        : t("worldSocialDesk.winnersStagePalace");
  const phaseText = (p: WorldContest["phase"]) => {
    const k = PHASE_KEYS[p];
    return k ? t(k) : contestPhaseLabel(p);
  };
  const placeText = (place: number) =>
    place === 1
      ? t("worldSocialDesk.winnersPlaceFirst")
      : place === 2
        ? t("worldSocialDesk.winnersPlaceSecond")
        : place === 3
          ? t("worldSocialDesk.winnersPlaceThird")
          : t("worldSocialDesk.winnersPlaceOther", { place });
  const deadlineLine = (c: WorldContest) =>
    contestDeadlineLine(c, Date.now(), {
      strings: {
        close: t("worldSocialDesk.winnersDeadlineClose"),
        closed: t("worldSocialDesk.winnersDeadlineClosed"),
        decidedClosed: t("worldSocialDesk.winnersDeadlineDecidedClosed"),
      },
      locale: i18n.language,
    });
  const errorCopy: ContestErrorCopyBundle = {
    FRONT_ROW_REQUIRED: t("worldSocialDesk.winnersErrFrontRow"),
    NOT_A_STAGE: t("worldSocialDesk.winnersErrNotAStage"),
    INVALID_DEADLINE: t("worldSocialDesk.winnersErrInvalidDeadline"),
    ENTRIES_CLOSED: t("worldSocialDesk.winnersErrEntriesClosed"),
    ALREADY_ENTERED: t("worldSocialDesk.winnersErrAlreadyEntered"),
    NOT_PUBLISHED: t("worldSocialDesk.winnersErrNotPublished"),
    WORK_NOT_FOUND: t("worldSocialDesk.winnersErrWorkNotFound"),
    NOT_THE_HOST: t("worldSocialDesk.winnersErrNotTheHost"),
    STILL_OPEN: t("worldSocialDesk.winnersErrStillOpen"),
    ALREADY_DECIDED: t("worldSocialDesk.winnersErrAlreadyDecided"),
    ENTRY_NOT_IN_CONTEST: t("worldSocialDesk.winnersErrEntryNotInContest"),
    CONTEST_CALLED_OFF: t("worldSocialDesk.winnersErrContestCalledOff"),
    NO_PROFILE: t("worldSocialDesk.winnersErrNoProfile"),
    NOT_FOUND: t("worldSocialDesk.winnersErrNotFound"),
    generic: t("worldSocialDesk.winnersErrGeneric"),
  };

  const [contests, setContests] = useState<WorldContest[] | null>(null);
  const [honors, setHonors] = useState<WinnersCircleHonor[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ contest: WorldContest; entries: WorldContestEntry[] } | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailTick, setDetailTick] = useState(0);

  const [works, setWorks] = useState<MyContestWork[] | null>(null);
  const [pickedWorkId, setPickedWorkId] = useState("");
  const [podium, setPodium] = useState<(string | null)[]>([null, null, null]);

  const [showHostForm, setShowHostForm] = useState(false);
  const [hostTitle, setHostTitle] = useState("");
  const [hostTheme, setHostTheme] = useState("");
  const [hostRoom, setHostRoom] = useState<string>(MUSIC_HALL_ID);
  const [hostDeadline, setHostDeadline] = useState(defaultDeadlineLocal());

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  /* The board + the Circle (public reads). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cs, hs] = await Promise.all([fetchContests(), fetchWinnersCircle()]);
        if (!cancelled) {
          setContests(cs);
          setHonors(hs);
          setLoadFailed(false);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  /* One contest's entries. */
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchContestDetail(selectedId);
        if (!cancelled) {
          setDetail(d);
          setDetailFailed(false);
          setPodium([null, null, null]);
          setPickedWorkId("");
        }
      } catch {
        if (!cancelled) setDetailFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailTick, tick]);

  /* The member's own works, for the picker (members only — a
   * guest never fires it). */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token) return;
        const mine = await fetchMyContestWorks(token);
        if (!cancelled) setWorks(mine);
      } catch {
        if (!cancelled) setWorks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  const myEntry = useMemo(
    () => (detail ? myContestEntry(detail.entries, userId) : null),
    [detail, userId],
  );
  const isHost = !!detail && !!userId && detail.contest.hostUserId === userId;
  const publishedWorks = useMemo(() => (works ?? []).filter((w) => w.isPublished), [works]);

  async function runAction(fn: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      const text = await fn();
      setNotice({ ok: true, text });
      refresh();
      setDetailTick((n) => n + 1);
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ContestApiError ? err.message : t("worldSocialDesk.winnersErrGeneric"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onEnter() {
    if (!detail) return;
    const work = (works ?? []).find((w) => w.id === pickedWorkId);
    if (!work) {
      setNotice({ ok: false, text: t("worldSocialDesk.winnersPickWorkFirst") });
      return;
    }
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    await runAction(async () => {
      await enterContestWork(token, detail.contest.id, work, errorCopy);
      return t("worldSocialDesk.winnersEnteredNotice", { work: work.title, contest: detail.contest.title });
    });
  }

  async function onNameWinners() {
    if (!detail) return;
    if (!podium.some(Boolean)) {
      setNotice({ ok: false, text: t("worldSocialDesk.winnersNameFirstPlaceFirst") });
      return;
    }
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    await runAction(async () => {
      await nameContestWinners(token, detail.contest.id, podium, errorCopy);
      return t("worldSocialDesk.winnersNamedNotice");
    });
  }

  async function onHost() {
    const ends = new Date(hostDeadline);
    if (!hostTitle.trim() || !hostTheme.trim() || Number.isNaN(ends.getTime())) {
      setNotice({ ok: false, text: t("worldSocialDesk.winnersHostNeeds") });
      return;
    }
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    await runAction(async () => {
      const created = await hostContest(
        token,
        buildContestBody({ title: hostTitle, theme: hostTheme, roomId: hostRoom, endsAtIso: ends.toISOString() }),
        errorCopy,
      );
      setShowHostForm(false);
      setHostTitle("");
      setHostTheme("");
      if (created) setSelectedId(created.id);
      return t("worldSocialDesk.winnersHostedNotice");
    });
  }

  const sub = isLight ? "text-[#6B5B36]" : "text-white/55";
  const faint = isLight ? "text-[#6B5B36]" : "text-white/40";

  return (
    <div className="space-y-5" data-testid="world-winners-circle-panel">
      {notice && (
        <p
          data-testid="world-contest-notice"
          className={`rounded-xl border px-3 py-2 text-sm ${
            notice.ok
              ? isLight
                ? "border-[#C9A84C]/50 bg-[#d4af37]/10 text-[#2a1e07]"
                : "border-[#d4af37]/40 bg-[#d4af37]/10 text-white"
              : isLight
                ? "border-red-700/30 bg-red-50 text-red-900"
                : "border-red-400/30 bg-red-500/10 text-red-100"
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* ── Contests ─────────────────────────────────────────── */}
      <NativeBoard isLight={isLight} title={t("worldSocialDesk.winnersBoardTitle")}>
        {loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldSocialDesk.winnersLoadErrorTitle")}
            message={t("worldSocialDesk.winnersLoadErrorMessage")}
            onRetry={refresh}
          />
        ) : contests === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.winnersLoading")} />
        ) : contests.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldSocialDesk.winnersEmptyMessage")}
            detail={t("worldSocialDesk.winnersEmptyDetail")}
          />
        ) : (
          contests.map((c) => (
            <NativeBoardRow
              key={c.id}
              isLight={isLight}
              title={c.title}
              detail={`${c.theme ? t("worldSocialDesk.winnersThemePrefix", { theme: c.theme }) : ""}${t("worldSocialDesk.winnersRowDetail", { stage: stageName(c.roomId), name: c.hostName, deadline: deadlineLine(c) })}`}
              meta={t("worldSocialDesk.winnersRowMeta", {
                phase: phaseText(c.phase),
                entries: t(c.entryCount === 1 ? "worldSocialDesk.winnersEntriesOne" : "worldSocialDesk.winnersEntriesMany", { count: c.entryCount }),
              })}
              highlighted={selectedId === c.id}
              action={
                <button
                  type="button"
                  data-testid="world-contest-open"
                  onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                  aria-expanded={selectedId === c.id}
                  className={ghostBtn(isLight)}
                >
                  {selectedId === c.id ? t("common.close") : t("worldSocialDesk.winnersOpen")}
                </button>
              }
            />
          ))
        )}
      </NativeBoard>

      {/* ── The opened contest ───────────────────────────────── */}
      {selectedId && (
        <div data-testid="world-contest-detail" className="space-y-3">
          {detailFailed ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldSocialDesk.winnersDetailErrorTitle")}
              message={t("worldSocialDesk.winnersDetailErrorMessage")}
              onRetry={() => setDetailTick((n) => n + 1)}
            />
          ) : !detail ? (
            <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.winnersDetailLoading")} />
          ) : (
            <>
              <p className={`px-1 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {detail.contest.title}
                <span className={`ml-2 text-xs font-semibold ${faint}`}>
                  {t("worldSocialDesk.winnersPhaseStage", {
                    phase: phaseText(detail.contest.phase),
                    stage: stageName(detail.contest.roomId),
                  })}
                </span>
              </p>

              {detail.contest.winners.length > 0 && (
                <div className="space-y-1 px-1" data-testid="world-contest-podium">
                  {detail.contest.winners.map((w) => (
                    <p key={w.id} className={`inline-flex w-full items-center gap-2 text-sm ${sub}`}>
                      <Trophy className="h-4 w-4 shrink-0 text-[#d4af37]" />
                      <span>
                        <strong className={isLight ? "text-[#2a1e07]" : "text-white"}>{placeText(w.place)}:</strong>{" "}
                        {t("worldSocialDesk.winnersPodiumRest", { name: w.winnerName, work: w.workTitle })}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {detail.entries.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message={t("worldSocialDesk.winnersNoEntriesMessage")}
                  detail={
                    detail.contest.phase === "open"
                      ? t("worldSocialDesk.winnersNoEntriesDetailOpen")
                      : undefined
                  }
                />
              ) : (
                <div className="space-y-1.5">
                  {detail.entries.map((e) => (
                    <NativeBoardRow
                      key={e.id}
                      isLight={isLight}
                      title={e.workTitle}
                      detail={t("worldSocialDesk.winnersEntryDetail", {
                        kind: t(e.workKind === "video" ? "worldSocialDesk.winnersKindVideo" : "worldSocialDesk.winnersKindTrack"),
                        name: e.entrantName,
                      })}
                      highlighted={!!userId && e.userId === userId}
                    />
                  ))}
                </div>
              )}

              {/* Entering */}
              {detail.contest.phase === "open" &&
                (isGuest ? (
                  <p className={`inline-flex flex-wrap items-center gap-2 px-1 text-sm ${sub}`} data-testid="world-contest-guest-pitch">
                    {t("worldSocialDesk.winnersGuestPitch")}
                    <Link href={GUEST_SIGN_IN_HREF} className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105">
                      <LogIn className="h-3 w-3" /> {t("worldSocialDesk.winnersSignInToEnter")}
                    </Link>
                  </p>
                ) : myEntry ? (
                  <p className={`px-1 text-sm ${sub}`} data-testid="world-contest-my-entry">
                    {t("worldSocialDesk.winnersMyEntry", { work: myEntry.workTitle })}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-end gap-2 px-1">
                    <label className={`flex min-w-56 flex-1 flex-col gap-1 text-xs font-bold ${sub}`}>
                      {t("worldSocialDesk.winnersYourWork")}
                      <select
                        data-testid="world-contest-work-picker"
                        value={pickedWorkId}
                        onChange={(e) => setPickedWorkId(e.target.value)}
                        className={inputCls(isLight)}
                      >
                        <option value="">{t("worldSocialDesk.winnersPickWork")}</option>
                        {(works ?? []).map((w) => (
                          <option key={w.id} value={w.id} disabled={!w.isPublished}>
                            {w.title} ({w.workKind}){w.isPublished ? "" : t("worldSocialDesk.winnersNotPublishedSuffix")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" data-testid="world-contest-enter" disabled={busy} onClick={onEnter} className={goldBtn}>
                      {t("worldSocialDesk.winnersEnterButton")}
                    </button>
                    {works !== null && publishedWorks.length === 0 && (
                      <p className={`w-full text-xs ${faint}`}>
                        {t("worldSocialDesk.winnersNoPublishedWork")}
                      </p>
                    )}
                  </div>
                ))}

              {/* Judging */}
              {detail.contest.phase === "judging" &&
                (isHost ? (
                  <div className="space-y-2 px-1" data-testid="world-contest-judging">
                    <p className={`text-sm ${sub}`}>{t("worldSocialDesk.winnersJudgingIntro")}</p>
                    {[0, 1, 2].map((slot) => (
                      <label key={slot} className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                        {placeText(slot + 1)}
                        <select
                          data-testid={`world-contest-podium-${slot + 1}`}
                          value={podium[slot] ?? ""}
                          onChange={(e) =>
                            setPodium((p) => p.map((v, i) => (i === slot ? e.target.value || null : v)))
                          }
                          className={inputCls(isLight)}
                        >
                          <option value="">—</option>
                          {detail.entries.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.entrantName} — “{e.workTitle}”
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <button type="button" data-testid="world-contest-name-winners" disabled={busy} onClick={onNameWinners} className={goldBtn}>
                      {t("worldSocialDesk.winnersNameWinners")}
                    </button>
                  </div>
                ) : (
                  <p className={`px-1 text-sm ${sub}`}>
                    {t("worldSocialDesk.winnersJudgingWaiting", { name: detail.contest.hostName })}
                  </p>
                ))}
            </>
          )}
        </div>
      )}

      {/* ── Hosting ──────────────────────────────────────────── */}
      {!isGuest && (
        <div className="px-1">
          {showHostForm ? (
            <div className="space-y-2" data-testid="world-contest-host-form">
              <p className={`inline-flex items-center gap-2 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                <Crown className="h-4 w-4 text-[#d4af37]" /> {t("worldSocialDesk.winnersHostHeading")}
              </p>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                {t("worldSocialDesk.winnersFieldTitle")}
                <input data-testid="world-contest-host-title" value={hostTitle} onChange={(e) => setHostTitle(e.target.value)} maxLength={120} className={inputCls(isLight)} placeholder={t("worldSocialDesk.winnersHostTitlePlaceholder")} />
              </label>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                {t("worldSocialDesk.winnersFieldTheme")}
                <input data-testid="world-contest-host-theme" value={hostTheme} onChange={(e) => setHostTheme(e.target.value)} maxLength={140} className={inputCls(isLight)} placeholder={t("worldSocialDesk.winnersHostThemePlaceholder")} />
              </label>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                {t("worldSocialDesk.winnersFieldStage")}
                <select data-testid="world-contest-host-stage" value={hostRoom} onChange={(e) => setHostRoom(e.target.value)} className={inputCls(isLight)}>
                  <option value={MUSIC_HALL_ID}>{t("worldSocialDesk.winnersStageMusicOption")}</option>
                  <option value={HALL_ROOM_ID}>{t("worldSocialDesk.winnersStageThroneOption")}</option>
                </select>
              </label>
              <label className={`flex flex-col gap-1 text-xs font-bold ${sub}`}>
                {t("worldSocialDesk.winnersFieldDeadline")}
                <input data-testid="world-contest-host-deadline" type="datetime-local" value={hostDeadline} onChange={(e) => setHostDeadline(e.target.value)} className={inputCls(isLight)} />
              </label>
              <div className="flex gap-2">
                <button type="button" data-testid="world-contest-host-submit" disabled={busy} onClick={onHost} className={goldBtn}>
                  {t("worldSocialDesk.winnersHostSubmit")}
                </button>
                <button type="button" onClick={() => setShowHostForm(false)} className={ghostBtn(isLight)}>
                  {t("worldSocialDesk.winnersNotNow")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" data-testid="world-contest-host-open" onClick={() => setShowHostForm(true)} className={ghostBtn(isLight)}>
              {t("worldSocialDesk.winnersHostHeading")}
            </button>
          )}
        </div>
      )}

      {/* ── The Winners' Circle ──────────────────────────────── */}
      <NativeBoard isLight={isLight} title={t("worldSocialDesk.winnersCircleTitle")}>
        {loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldSocialDesk.winnersCircleErrorTitle")}
            message={t("worldSocialDesk.winnersCircleErrorMessage")}
            onRetry={refresh}
          />
        ) : honors === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.winnersCircleLoading")} />
        ) : honors.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldSocialDesk.winnersCircleEmptyMessage")}
            detail={t("worldSocialDesk.winnersCircleEmptyDetail")}
          />
        ) : (
          honors.map((hon) => (
            <NativeBoardRow
              key={hon.id}
              isLight={isLight}
              title={t("worldSocialDesk.winnersHonorTitle", { place: placeText(hon.place), name: hon.winnerName })}
              detail={t("worldSocialDesk.winnersHonorDetail", { work: hon.workTitle, kind: hon.workKind, contest: hon.contestTitle, stage: stageName(hon.roomId) })}
              meta={new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", year: "numeric" }).format(new Date(hon.decidedAt))}
            />
          ))
        )}
      </NativeBoard>
    </div>
  );
}
