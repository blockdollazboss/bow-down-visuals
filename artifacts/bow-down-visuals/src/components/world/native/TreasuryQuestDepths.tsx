import { useEffect, useState } from "react";
import { Trophy, Flame, Crown, Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  QUEST_DISPLAY,
  historyTotalVb,
  ledgerEntryKindLabel,
  normalizeLeaderboard,
  normalizeTreasuryHistory,
  questDestination,
  type Leaderboard,
  type TreasuryHistory,
} from "@/lib/world/treasury-quests";

/* ─── TreasuryQuestDepths — the Quest Board's depth (Ring 2) ───────
   Under the board's active objectives, three more ways to READ
   your standing — quests as a game, not a list (owner addendum,
   Oct 17 2026):

   • Trophies (2.21): the claim-history ledger as a trophy shelf —
     every claim the retention/bonus tables record (quest rewards,
     shark drops, hourly crates) with its recorded VB amount, under
     a status strip (lifetime claimed total from those same rows,
     creation streak, milestones). Daily-drop claims are NOT rows:
     the bonus rail keeps no per-claim record (only the last claim
     date, which the strip shows truthfully).
   • Catalog (2.22): the FULL quest catalog — every quest the
     server runs, where each is done in the palace, and past weeks'
     progress from quest_progress's own rows.
   • Standings (2.22): the site's weekly creation leaderboard
     (GET /api/retention/leaderboard — status only, no VB), your
     own row lit.

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function TreasuryQuestDepths({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [tab, setTab] = useState<DepthsTab>("trophies");
  const [history, setHistory] = useState<TreasuryHistory | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [streak, setStreak] = useState<StreakStatusDto | null>(null);
  const [lastDailyClaim, setLastDailyClaim] = useState<string | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
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
          const s = (await streakRes.json()) as StreakStatusDto;
          if (!cancelled && s && Array.isArray(s.milestones)) setStreak(s);
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
      className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${
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
      <div className="flex flex-wrap gap-2">
        {tabBtn("trophies", "Trophies")}
        {tabBtn("catalog", "Quest catalog")}
        {tabBtn("standings", "Standings")}
      </div>

      {tab === "trophies" && (
        <>
          {historyFailed ? (
            <NativeErrorState
              isLight={isLight}
              title="The trophy ledger wouldn't open"
              message="Your claims are safe on the real rails — nothing here writes to them. Try again."
              onRetry={() => {
                setHistoryFailed(false);
                setHistory(null);
                setTick((n) => n + 1);
              }}
            />
          ) : history === null ? (
            <NativeLoadingState isLight={isLight} message="Polishing your trophies…" />
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
                  {historyTotalVb(history.entries).toLocaleString("en-US")} VB claimed
                </span>
                {streak && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                    <Flame className="h-3.5 w-3.5 text-[#d4af37]" />
                    {streak.currentStreak}-day creation streak · longest {streak.longestStreak}
                  </span>
                )}
                {lastDailyClaim && (
                  <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
                    Last daily drop claimed {fmtDate(lastDailyClaim)}
                  </span>
                )}
              </div>

              {streak && streak.milestones.length > 0 && (
                <NativeBoard isLight={isLight} title="Streak milestones">
                  {streak.milestones.map((m) => (
                    <NativeBoardRow
                      key={m.days}
                      isLight={isLight}
                      title={`${m.days}-day milestone`}
                      detail={m.claimed ? "Claimed — it's on your shelf" : m.reached ? "Reached — claim it on the board above" : "Keep the streak alive to reach it"}
                      meta={`${m.reward.toLocaleString("en-US")} VB`}
                      highlighted={m.claimed}
                    />
                  ))}
                </NativeBoard>
              )}

              <NativeBoard isLight={isLight} title="Claim history">
                {history.entries.length === 0 ? (
                  <NativeEmptyState
                    isLight={isLight}
                    message="No trophies yet — finish an objective above and claim it here."
                    detail="Quest rewards, shark drops and hourly crates you claim will line this shelf."
                  />
                ) : (
                  history.entries.map((e, i) => (
                    <NativeBoardRow
                      key={`${e.kind}-${e.at}-${i}`}
                      isLight={isLight}
                      title={e.kind === "quest" ? questTitle(e.key) : ledgerEntryKindLabel(e.kind)}
                      detail={`${ledgerEntryKindLabel(e.kind)} · ${fmtDate(e.at)}`}
                      meta={`+${e.amount.toLocaleString("en-US")} VB`}
                    />
                  ))
                )}
              </NativeBoard>
              <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                Daily drops pay at the Daily Drop counter — the bonus rail records only your last
                claim date (shown above), so daily claims aren&rsquo;t listed as rows here.
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
              title="The quest catalog wouldn't open"
              message="The board above still holds this week's objectives. Try again."
              onRetry={() => {
                setHistoryFailed(false);
                setHistory(null);
                setTick((n) => n + 1);
              }}
            />
          ) : history === null ? (
            <NativeLoadingState isLight={isLight} message="Opening the quest catalog…" />
          ) : (
            <>
              <NativeBoard isLight={isLight} title="Every quest in the kingdom">
                {history.catalog.map((c) => {
                  const dest = questDestination(c.key);
                  return (
                    <NativeBoardRow
                      key={c.key}
                      isLight={isLight}
                      title={questTitle(c.key)}
                      detail={
                        dest?.kind === "station"
                          ? `Done at the ${dest.stationName} in ${dest.roomName} — “Go do it” on the board walks you there`
                          : "No desk in the palace performs this one yet — its board action opens it on the website"
                      }
                      meta={c.reward > 0 ? `${c.reward.toLocaleString("en-US")} VB` : "Reward TBD"}
                    />
                  );
                })}
              </NativeBoard>

              {history.weeks.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="No past weeks yet — this week's objectives are on the board above."
                />
              ) : (
                history.weeks.map((week) => (
                  <NativeBoard key={week.weekStart} isLight={isLight} title={`Week of ${fmtDate(week.weekStart)}`}>
                    {week.quests.map((q) => (
                      <NativeBoardRow
                        key={q.key}
                        isLight={isLight}
                        title={questTitle(q.key)}
                        detail={
                          q.claimed
                            ? `Claimed ${fmtDate(q.claimedAt)}`
                            : q.completed
                              ? "Finished — never claimed"
                              : `${q.progress} of ${q.target} done`
                        }
                        meta={`${q.progress}/${q.target}`}
                        highlighted={q.claimed}
                      />
                    ))}
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
              title="The standings wouldn't load"
              message="The kingdom's creators are still ranked on the real rails. Try again."
              onRetry={() => {
                setBoardFailed(false);
                setBoard(null);
              }}
            />
          ) : board === null ? (
            <NativeLoadingState isLight={isLight} message="Reading the standings…" />
          ) : board.rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No creations on the board yet this week — the first one takes the crown."
              detail="The standings count this week's creations and exports across the kingdom."
            />
          ) : (
            <NativeBoard
              isLight={isLight}
              title="This week's creators"
              headline={
                board.viewerRank !== null ? (
                  <p className={`inline-flex items-center gap-2 px-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                    <Crown className="h-3.5 w-3.5" /> You stand #{board.viewerRank} this week — {board.viewerScore} creations + exports
                  </p>
                ) : undefined
              }
            >
              {board.rows.map((r) => (
                <NativeBoardRow
                  key={r.rank}
                  isLight={isLight}
                  title={`#${r.rank} · ${r.name}${r.isYou ? " (you)" : ""}`}
                  detail={`${r.creations} creations · ${r.exports} exports`}
                  meta={`${r.score}`}
                  highlighted={r.isYou}
                />
              ))}
              <p className={`inline-flex items-center gap-1.5 px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                <Target className="h-3 w-3" /> Standings are honor only — no Visual Bucs ride on them.
              </p>
            </NativeBoard>
          )}
        </>
      )}
    </div>
  );
}
