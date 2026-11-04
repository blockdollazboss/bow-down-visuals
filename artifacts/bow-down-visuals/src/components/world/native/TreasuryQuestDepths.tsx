import { useEffect, useState } from "react";
import { Trophy, Flame, Crown, Target, Medal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  QUEST_DISPLAY,
  dailyQuestName,
  dailyQuestTitle,
  historyTotalVb,
  ledgerEntryKindLabel,
  normalizeLeaderboard,
  normalizeQuestMarksBoard,
  normalizeTreasuryHistory,
  questDestination,
  streakMilestoneTitle,
  type Leaderboard,
  type QuestMarksBoard,
  type TreasuryHistory,
} from "@/lib/world/treasury-quests";
import {
  normalizeStreakStatus,
  type StreakStatusShape,
} from "@/lib/world/objective-strip";
import {
  evaluateStreakCrossing,
  readSeenStreakMilestone,
  writeSeenStreakMilestone,
  type StreakMomentVerdict,
} from "@/lib/world/streak-moment";

/* ─── TreasuryQuestDepths — the Quest Board's depth (Ring 2) ───────
   Under the board's active objectives, three more ways to READ
   your standing — quests as a game, not a list (owner addendum,
   Oct 17 2026):

   • Trophies (2.21): the claim-history ledger as a trophy shelf —
     every claim the tables record (weekly quest rewards, Daily
     Quest Trio rewards, the King's gifts, the tutorial reward,
     shark drops, hourly crates, and — since the claim records
     landed — Daily Drop claims and streak milestones) with its
     recorded VB amount, under a status strip (lifetime claimed
     total from those same rows, creation streak, milestones).
     Daily-drop / streak claims from before the records began are
     NOT rows: they kept no per-claim record (only the last claim
     date, which the strip shows truthfully).
   • Catalog (2.22): the FULL quest catalog — every quest the
     server runs (the weekly slate AND the Daily Quest Trio's
     whole pool, today's rotation marked live), where each weekly
     quest is done in the palace, and past weeks' progress from
     the progress tables' own rows (weekly rows + trio days).
   • Standings (2.22): the site's weekly creation leaderboard
     (GET /api/retention/leaderboard — status only, no VB), your
     own row lit — and under it the Quest Marks board
     (GET /api/retention/quests/leaderboard): all-time marks
     banked from trio claims, summed from the claim rows' own
     stamps. Two boards, two truths, each labeled as its own.

   Every number on this surface comes from a server response and
   runs through the guards in lib/world/treasury-quests; a payload
   that fails the guard is the panel's error state, never rows. */

type DepthsTab = "trophies" | "catalog" | "standings";

interface StreakStatusDto {
  enabled: boolean;
  currentStreak: number;
  longestStreak: number;
  milestones: { days: number; reward: number; reached: boolean; claimed: boolean }[];
}

function fmtDate(iso: string | null | undefined, language?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(language, { month: "short", day: "numeric", year: "numeric" });
}

const KIND_LABEL_KEY: Record<string, string> = {
  quest: "worldRemainder.treKindQuest",
  "daily-quest": "worldRemainder.treKindDailyQuest",
  "king-gift": "worldRemainder.treKindKingGift",
  tutorial: "worldRemainder.treKindTutorial",
  "shark-drop": "worldRemainder.treKindSharkDrop",
  crate: "worldRemainder.treKindCrate",
  "daily-drop": "worldRemainder.treKindDailyDrop",
  "streak-milestone": "worldRemainder.treKindStreakMilestone",
};
const DAILY_TITLE_KEY: Record<string, string> = {
  "daily-first-frame": "worldRemainder.treDailyFirstFrame",
  "daily-song-spark": "worldRemainder.treDailySongSpark",
  "daily-ship-it": "worldRemainder.treDailyShipIt",
  "daily-double-frame": "worldRemainder.treDailyDoubleFrame",
  "daily-second-verse": "worldRemainder.treDailySecondVerse",
  "daily-loudmouth": "worldRemainder.treDailyLoudmouth",
  "daily-marathon-cut": "worldRemainder.treDailyMarathonCut",
};

export function TreasuryQuestDepths({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const { getAccessToken, user } = useAuth();
  const [tab, setTab] = useState<DepthsTab>("trophies");
  const [history, setHistory] = useState<TreasuryHistory | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [streak, setStreak] = useState<StreakStatusDto | null>(null);
  /* The streak MOMENT (Lane K2, item 3): the normalized server
     streak shape + the crossing verdict this device hasn't shown
     yet. Personal to the achiever — see lib/world/streak-moment
     for why this never becomes a room broadcast. */
  const [streakShape, setStreakShape] = useState<StreakStatusShape | null>(null);
  const [streakMoment, setStreakMoment] = useState<Extract<
    StreakMomentVerdict,
    { kind: "crossed" }
  > | null>(null);
  const [lastDailyClaim, setLastDailyClaim] = useState<string | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [marks, setMarks] = useState<QuestMarksBoard | null>(null);
  const [marksFailed, setMarksFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [histRes, streakRes, bonusRes] = await Promise.all([
          fetch("/api/retention/quests/history", { headers }),
          fetch("/api/retention/streak", { headers }),
          fetch("/api/bonus/status", { headers }),
        ]);
        if (!histRes.ok) throw new Error("history");
        const normalized = normalizeTreasuryHistory(await histRes.json());
        if (!normalized) throw new Error("history payload");
        if (cancelled) return;
        setHistory(normalized);
        setHistoryFailed(false);
        if (streakRes.ok) {
          const rawStreak: unknown = await streakRes.json();
          const s = rawStreak as StreakStatusDto;
          if (!cancelled && s && Array.isArray(s.milestones)) setStreak(s);
          const shaped = normalizeStreakStatus(rawStreak);
          if (!cancelled && shaped) setStreakShape(shaped);
        }
        if (bonusRes.ok) {
          const b = (await bonusRes.json()) as { lastDailyClaim?: string | null };
          if (!cancelled) setLastDailyClaim(b.lastDailyClaim ?? null);
        }
      } catch {
        if (!cancelled) setHistoryFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    if (tab !== "standings" || board) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/retention/leaderboard", { headers: await authHeaders() });
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
  }, [tab]);

  /* The Quest Marks board loads beside the creation standings —
     its own fetch, its own honest states; one board failing never
     takes the other down with it. */
  useEffect(() => {
    if (tab !== "standings" || marks) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/retention/quests/leaderboard", { headers: await authHeaders() });
        if (!res.ok) throw new Error("quest marks");
        const normalized = normalizeQuestMarksBoard(await res.json());
        if (!normalized) throw new Error("quest marks payload");
        if (!cancelled) {
          setMarks(normalized);
          setMarksFailed(false);
        }
      } catch {
        if (!cancelled) setMarksFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* The crossing verdict: server state vs this device's seen
     baseline (the level-watch pattern). A baseline verdict is
     stored silently; a crossing is presented once, here, and the
     baseline moves past it. */
  useEffect(() => {
    if (!streakShape || !user) return;
    let verdict: StreakMomentVerdict;
    try {
      verdict = evaluateStreakCrossing(
        readSeenStreakMilestone(window.localStorage, user.id),
        streakShape,
      );
      if (verdict.kind === "baseline") {
        writeSeenStreakMilestone(window.localStorage, user.id, verdict.milestoneDays);
        return;
      }
      if (verdict.kind === "crossed") {
        writeSeenStreakMilestone(window.localStorage, user.id, verdict.milestone.days);
        setStreakMoment(verdict);
      }
    } catch {
      /* storage unavailable — no moment this visit, nothing breaks */
    }
  }, [streakShape, user]);

  const kindLabel = (kind: string): string =>
    t(KIND_LABEL_KEY[kind] ?? "worldRemainder.treKindQuest");
  const dailyTitle = (key: string | null): string =>
    dailyQuestTitle(
      key,
      (k) => (DAILY_TITLE_KEY[k] ? t(DAILY_TITLE_KEY[k]) : undefined),
      kindLabel,
    );

  const questTitle = (key: string | null): string => {
    if (!key) return "";
    const display = QUEST_DISPLAY[key];
    return display ? t(display.titleKey) : key;
  };

  const tabBtn = (id: DepthsTab, label: string) => (
    <button
      key={id}
      type="button"
      data-testid={`world-treasury-tab-${id}`}
      onClick={() => setTab(id)}
      className={`rounded-full px-3.5 py-1.5 text-xs font-black transition bdv-touch-target ${
        tab === id
          ? "bg-[#d4af37] text-black"
          : isLight
            ? "border border-[#C9A84C]/50 text-[#6B5B36]"
            : "border border-white/15 text-white/60"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-4 space-y-3" data-testid="world-treasury-depths">
      {streakMoment && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-2xl border-2 px-4 py-3 ${
            isLight
              ? "border-[#d4af37] bg-[#fdf3d0]"
              : "border-[#d4af37]/70 bg-[#d4af37]/10"
          }`}
          data-testid="world-treasury-streak-moment"
          role="status"
        >
          <Flame className="h-7 w-7 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {t("worldRemainder.treMomentTitle")}
            </p>
            <p className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
              {t("worldRemainder.treMomentBody", { days: streakMoment.milestone.days, current: streakMoment.currentStreak })}{" "}
              {streakMoment.milestone.claimed
                ? t("worldRemainder.treMomentClaimed", { reward: streakMoment.milestone.reward.toLocaleString(i18n.language) })
                : t("worldRemainder.treMomentWaiting", { reward: streakMoment.milestone.reward.toLocaleString(i18n.language) })}
            </p>
          </div>
          <button
            type="button"
            data-testid="world-treasury-streak-moment-dismiss"
            onClick={() => setStreakMoment(null)}
            className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
          >
            {t("worldRemainder.treMomentDismiss")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {tabBtn("trophies", t("worldRemainder.treTabTrophies"))}
        {tabBtn("catalog", t("worldRemainder.treTabCatalog"))}
        {tabBtn("standings", t("worldRemainder.treTabStandings"))}
      </div>

      {tab === "trophies" && (
        <>
          {historyFailed ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldRemainder.treTrophiesLoadTitle")}
              message={t("worldRemainder.treTrophiesLoadMessage")}
              onRetry={() => {
                setHistoryFailed(false);
                setHistory(null);
                setTick((n) => n + 1);
              }}
            />
          ) : history === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldRemainder.treTrophiesLoading")} />
          ) : (
            <>
              {/* Status strip: streak + lifetime claimed, all server sums. */}
              <div
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border px-4 py-3 ${
                  isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                }`}
                data-testid="world-treasury-status-strip"
              >
                <span className="inline-flex items-center gap-2 text-sm font-black">
                  <Trophy className="h-4 w-4 text-[#d4af37]" />
                  {t("worldRemainder.treVbClaimed", { total: historyTotalVb(history.entries).toLocaleString(i18n.language) })}
                </span>
                {streak && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                    <Flame className="h-3.5 w-3.5 text-[#d4af37]" />
                    {t("worldRemainder.treStreakLine", { current: streak.currentStreak, longest: streak.longestStreak })}
                  </span>
                )}
                {lastDailyClaim && (
                  <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                    {t("worldRemainder.treLastDailyClaim", { date: fmtDate(lastDailyClaim, i18n.language) })}
                  </span>
                )}
              </div>

              {streak && streak.milestones.length > 0 && (
                <NativeBoard isLight={isLight} title={t("worldRemainder.treMilestonesTitle")}>
                  {streak.milestones.map((m) => (
                    <NativeBoardRow
                      key={m.days}
                      isLight={isLight}
                      title={t("worldRemainder.treMilestoneTitle", { days: m.days })}
                      detail={m.claimed ? t("worldRemainder.treMilestoneClaimed") : m.reached ? t("worldRemainder.treMilestoneReached") : t("worldRemainder.treMilestoneKeepGoing")}
                      meta={t("worldRemainder.treVbAmount", { amount: m.reward.toLocaleString(i18n.language) })}
                      highlighted={m.claimed}
                    />
                  ))}
                </NativeBoard>
              )}

              <NativeBoard isLight={isLight} title={t("worldRemainder.treClaimHistoryTitle")}>
                {history.entries.length === 0 ? (
                  <NativeEmptyState
                    isLight={isLight}
                    message={t("worldRemainder.treNoTrophies")}
                    detail={t("worldRemainder.treNoTrophiesDetail")}
                  />
                ) : (
                  history.entries.map((e, i) => (
                    <NativeBoardRow
                      key={`${e.kind}-${e.at}-${i}`}
                      isLight={isLight}
                      title={
                        e.kind === "quest"
                          ? questTitle(e.key)
                          : e.kind === "daily-quest"
                            ? dailyTitle(e.key)
                            : e.kind === "tutorial"
                              ? t("worldRemainder.treTutorialTitle")
                              : e.kind === "streak-milestone"
                                ? streakMilestoneTitle(e.key, (days) => t("worldRemainder.treStreakMilestoneTitle", { days }), kindLabel)
                                : ledgerEntryKindLabel(e.kind, kindLabel)
                      }
                      detail={`${ledgerEntryKindLabel(e.kind, kindLabel)} · ${fmtDate(e.at, i18n.language)}`}
                      meta={t("worldRemainder.treVbPlus", { amount: e.amount.toLocaleString(i18n.language) })}
                    />
                  ))
                )}
              </NativeBoard>
              <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                {t("worldRemainder.treLedgerFootnote")}
              </p>
            </>
          )}
        </>
      )}

      {tab === "catalog" && (
        <>
          {historyFailed ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldRemainder.treCatalogLoadTitle")}
              message={t("worldRemainder.treCatalogLoadMessage")}
              onRetry={() => {
                setHistoryFailed(false);
                setHistory(null);
                setTick((n) => n + 1);
              }}
            />
          ) : history === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldRemainder.treCatalogLoading")} />
          ) : (
            <>
              <NativeBoard isLight={isLight} title={t("worldRemainder.treCatalogTitle")}>
                {history.catalog.map((c) => {
                  const dest = questDestination(c.key);
                  return (
                    <NativeBoardRow
                      key={c.key}
                      isLight={isLight}
                      title={questTitle(c.key)}
                      detail={
                        dest?.kind === "station"
                          ? t("worldRemainder.treCatalogStationDetail", { station: dest.stationName, room: dest.roomName })
                          : t("worldRemainder.treCatalogNoDesk")
                      }
                      meta={c.reward > 0 ? t("worldRemainder.treCatalogMeta", { reward: c.reward.toLocaleString(i18n.language), target: c.target }) : t("worldRemainder.treRewardTbd")}
                    />
                  );
                })}
              </NativeBoard>

              {history.dailyCatalog.length > 0 && (
                <div data-testid="world-treasury-daily-catalog">
                  <NativeBoard isLight={isLight} title={t("worldRemainder.treDailyCatalogTitle")}>
                    {history.dailyCatalog.map((d) => (
                      <NativeBoardRow
                        key={d.key}
                        isLight={isLight}
                        title={d.name}
                        detail={
                          d.liveToday
                            ? t("worldRemainder.treDailyLiveDetail")
                            : t("worldRemainder.treDailyRotationDetail")
                        }
                        meta={t("worldRemainder.treDailyMeta", { vb: d.rewardVb.toLocaleString(i18n.language), marks: d.marks })}
                        highlighted={d.liveToday}
                      />
                    ))}
                  </NativeBoard>
                  <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                    {t("worldRemainder.treDailyFootnote")}
                  </p>
                </div>
              )}

              {history.weeks.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message={t("worldRemainder.treNoWeeks")}
                />
              ) : (
                history.weeks.map((week) => (
                  <NativeBoard key={week.weekStart} isLight={isLight} title={t("worldRemainder.treWeekOf", { date: fmtDate(week.weekStart, i18n.language) })}>
                    {week.quests.map((q) => (
                      <NativeBoardRow
                        key={q.key}
                        isLight={isLight}
                        title={questTitle(q.key)}
                        detail={
                          q.claimed
                            ? t("worldRemainder.treClaimedOn", { date: fmtDate(q.claimedAt, i18n.language) })
                            : q.completed
                              ? t("worldRemainder.treFinishedUnclaimed")
                              : t("worldRemainder.treProgressOf", { progress: q.progress, target: q.target })
                        }
                        meta={`${q.progress}/${q.target}`}
                        highlighted={q.claimed}
                      />
                    ))}
                    {week.daily.length > 0 && (
                      <>
                        <p
                          className={`px-1 pt-1 text-[11px] font-black uppercase tracking-[0.14em] ${
                            isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
                          }`}
                        >
                          {t("worldRemainder.treDailyTrioHeading")}
                        </p>
                        {week.daily.map((d) => (
                          <NativeBoardRow
                            key={`${d.day}-${d.key}`}
                            isLight={isLight}
                            title={dailyQuestName(history.dailyCatalog, d.key) ?? d.key}
                            detail={
                              d.claimed
                                ? t("worldRemainder.treDayClaimed", { day: fmtDate(d.day, i18n.language), date: fmtDate(d.claimedAt, i18n.language) })
                                : d.completed
                                  ? t("worldRemainder.treDayFinished", { day: fmtDate(d.day, i18n.language) })
                                  : t("worldRemainder.treDayProgress", { day: fmtDate(d.day, i18n.language), progress: d.progress, target: d.target })
                            }
                            meta={
                              d.claimed
                                ? t("worldRemainder.treDailyClaimedMeta", { vb: (d.rewardVb ?? 0).toLocaleString(i18n.language), marks: d.marks })
                                : `${d.progress}/${d.target}`
                            }
                            highlighted={d.claimed}
                          />
                        ))}
                      </>
                    )}
                  </NativeBoard>
                ))
              )}
            </>
          )}
        </>
      )}

      {tab === "standings" && (
        <>
          {boardFailed ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldRemainder.treStandingsLoadTitle")}
              message={t("worldRemainder.treStandingsLoadMessage")}
              onRetry={() => {
                setBoardFailed(false);
                setBoard(null);
              }}
            />
          ) : board === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldRemainder.treStandingsLoading")} />
          ) : board.rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldRemainder.treStandingsEmpty")}
              detail={t("worldRemainder.treStandingsEmptyDetail")}
            />
          ) : (
            <NativeBoard
              isLight={isLight}
              title={t("worldRemainder.treStandingsTitle")}
              headline={
                board.viewerRank !== null ? (
                  <p className={`inline-flex items-center gap-2 px-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                    <Crown className="h-3.5 w-3.5" /> {t("worldRemainder.treViewerRank", { rank: board.viewerRank, score: board.viewerScore })}
                  </p>
                ) : undefined
              }
            >
              {board.rows.map((r) => (
                <NativeBoardRow
                  key={r.rank}
                  isLight={isLight}
                  title={`#${r.rank} · ${r.name}${r.isYou ? t("worldRemainder.treRowYouSuffix") : ""}`}
                  detail={t("worldRemainder.treRowDetail", { creations: r.creations, exports: r.exports })}
                  meta={`${r.score}`}
                  highlighted={r.isYou}
                />
              ))}
              <p className={`inline-flex items-center gap-1.5 px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                <Target className="h-3 w-3" /> {t("worldRemainder.treStandingsHonor")}
              </p>
            </NativeBoard>
          )}

          {/* The Quest Marks board: trio honor, all-time — a
              different truth from the creation standings above,
              labeled as its own. */}
          <div data-testid="world-treasury-marks-board">
            {marksFailed ? (
              <NativeErrorState
                isLight={isLight}
                title={t("worldRemainder.treMarksLoadTitle")}
                message={t("worldRemainder.treMarksLoadMessage")}
                onRetry={() => {
                  setMarksFailed(false);
                  setMarks(null);
                }}
              />
            ) : marks === null ? (
              <NativeLoadingState isLight={isLight} message={t("worldRemainder.treMarksLoading")} />
            ) : marks.rows.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message={t("worldRemainder.treMarksEmpty")}
                detail={t("worldRemainder.treMarksEmptyDetail")}
              />
            ) : (
              <NativeBoard
                isLight={isLight}
                title={t("worldRemainder.treMarksTitle")}
                headline={
                  marks.viewerRank !== null ? (
                    <p className={`inline-flex items-center gap-2 px-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                      <Medal className="h-3.5 w-3.5" /> {t("worldRemainder.treMarksViewerRank", { rank: marks.viewerRank, marks: marks.viewerMarks.toLocaleString(i18n.language), claims: marks.viewerClaims })}
                    </p>
                  ) : marks.viewerMarks > 0 ? (
                    <p className={`inline-flex items-center gap-2 px-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                      <Medal className="h-3.5 w-3.5" /> {t("worldRemainder.treMarksViewerHidden", { marks: marks.viewerMarks.toLocaleString(i18n.language) })}
                    </p>
                  ) : undefined
                }
              >
                {marks.rows.map((r) => (
                  <NativeBoardRow
                    key={r.rank}
                    isLight={isLight}
                    title={`#${r.rank} · ${r.name}${r.isYou ? t("worldRemainder.treRowYouSuffix") : ""}`}
                    detail={r.claims === 1 ? t("worldRemainder.treMarksRowDetailOne", { claims: r.claims }) : t("worldRemainder.treMarksRowDetailMany", { claims: r.claims })}
                    meta={t("worldRemainder.treMarksMeta", { marks: r.marks.toLocaleString(i18n.language) })}
                    highlighted={r.isYou}
                  />
                ))}
                <p className={`inline-flex items-center gap-1.5 px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  <Medal className="h-3 w-3" /> {t("worldRemainder.treMarksHonor")}
                </p>
              </NativeBoard>
            )}
          </div>
        </>
      )}
    </div>
  );
}
