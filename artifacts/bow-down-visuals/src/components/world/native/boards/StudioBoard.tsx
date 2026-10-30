import { useEffect, useState } from "react";
import { Briefcase, Crown, Flame, ListChecks, MailOpen, Play, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { balanceComposition } from "@/lib/balance";
import { TemporaryBucsNote } from "@/components/BalanceBreakdown";
import {
  NativeBoard,
  NativeBoardRow,
  NativeCard,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native";
import {
  historyStatusWord,
  latestActivityLine,
  normalizeSponsorPipeline,
  normalizeStudioClips,
  normalizeStudioDigest,
  normalizeStudioDrafts,
  normalizeStudioHistory,
  normalizeStudioProjects,
  normalizeStudioStrip,
  studioNextMoves,
  summarizeContests,
  STUDIO_PROJECT_TABS,
  type SponsorPipeline,
  type StudioClipRow,
  type StudioContestSummary,
  type StudioDigest,
  type StudioDraftRow,
  type StudioHistoryRow,
  type StudioProjectRow,
  type StudioProjectsTabId,
  type StudioStrip,
} from "@/lib/world/studio-board";
import {
  characterMonogram,
  fetchVaultCharacters,
  type VaultCharacter,
} from "@/lib/world/characters";
import { parseWeeklyContest, type WeeklyContest } from "@/lib/world/games-lobby";
import { normalizeContests } from "@/lib/world/contests";
import { normalizeLeaderboard, type Leaderboard } from "@/lib/world/treasury-quests";
import { CreatorProfileCreateCard } from "@/components/world/native/CreatorProfileCreate";

/* ─── StudioBoard — My Studio as a palace board (NATIVE-PLAN §3.1) ───
   The Create Wing's studio door, rebuilt in-world: your projects
   as board rows (GET /api/projects — the board's full list IS the
   old /my-projects fold-in), a balance + streak strip, and your
   vault characters as a portrait row. A row's one action is
   Continue: the host steps through into the Visual Vibes editor
   seeded with that project (the editorStepthroughSearch machinery
   in the panel host) — you step into the workbench, still inside
   the palace, and Return brings you back to this board. The strip
   and the portraits are secondary rails: each degrades quietly
   rather than taking the project list down with it.

   P3-E (parity audit) adds the dashboard's widget family and the
   /my-projects deeper tabs. Every widget reads the site's own
   rail (challenges/contests, the away digest, the weekly
   leaderboard, sponsor deals) and degrades alone; next moves are
   the dashboard's rule-based derivation from the board's real
   state. The deeper tabs — drafts, generated clips, generation
   history — lazy-load on first open from the page's own rails. */

const PROJECT_CAP = 25;
const WIDGET_ROW_CAP = 5;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export interface StudioBoardProps {
  isLight: boolean;
  /** Step through into the editor seeded with this project. */
  onContinueProject: (projectId: string) => void;
}

interface ChallengesState {
  weekly: WeeklyContest | null;
  /** False when the weekly rail itself didn't answer — the card
   *  then says "couldn't be read", never "no contest". */
  weeklyKnown: boolean;
  summary: StudioContestSummary;
}

/** One lazy tab's read: rows land once, a failure is retryable,
 *  and "not asked yet" (null) is distinct from "answered empty". */
interface TabState<T> {
  rows: T[] | null;
  failed: boolean;
}

const TAB_IDLE = { rows: null, failed: false } as const;

export function StudioBoard({ isLight, onContinueProject }: StudioBoardProps) {
  const { profile, getAccessToken } = useAuth();
  const [projects, setProjects] = useState<StudioProjectRow[] | null>(null);
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [strip, setStrip] = useState<StudioStrip | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [characters, setCharacters] = useState<VaultCharacter[] | null>(null);
  const [tick, setTick] = useState(0);

  /* The widget family — undefined = the rail hasn't answered (the
     card stays hidden), null = it answered unreadable (also
     hidden), a value = render, empty states included. */
  const [challenges, setChallenges] = useState<ChallengesState | null | undefined>(undefined);
  const [digest, setDigest] = useState<StudioDigest | null | undefined>(undefined);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null | undefined>(undefined);
  const [pipeline, setPipeline] = useState<SponsorPipeline | null | undefined>(undefined);

  /* The deeper tabs. */
  const [tab, setTab] = useState<StudioProjectsTabId>("projects");
  const [drafts, setDrafts] = useState<TabState<StudioDraftRow>>(TAB_IDLE);
  const [clips, setClips] = useState<TabState<StudioClipRow>>(TAB_IDLE);
  const [history, setHistory] = useState<TabState<StudioHistoryRow>>(TAB_IDLE);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  /* The projects are the board's core: a failed read is the honest
     error state, never an empty-looking studio. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects", { headers: await authHeaders() });
        if (!res.ok) throw new Error("projects");
        if (!cancelled) {
          setProjects(normalizeStudioProjects(await res.json()));
          setProjectsFailed(false);
        }
      } catch {
        if (!cancelled) setProjectsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The strip: streak (bonus/status) + latest activity
     (credits/history). Quietly absent when the rails don't answer. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [bonusRes, creditsRes] = await Promise.all([
          fetch("/api/bonus/status", { headers }),
          fetch("/api/credits/history", { headers }),
        ]);
        if (cancelled) return;
        if (bonusRes.ok) setStrip(normalizeStudioStrip(await bonusRes.json()));
        if (creditsRes.ok) setActivity(latestActivityLine(await creditsRes.json()));
      } catch {
        /* the strip is a rail, not the board — silence is honest */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The vault portrait row (the picker's own shaping, reused). */
  useEffect(() => {
    let cancelled = false;
    fetchVaultCharacters(getAccessToken)
      .then((rows) => {
        if (!cancelled) setCharacters(rows);
      })
      .catch(() => {
        if (!cancelled) setCharacters([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The widget family: four rails, four independent reads — one
     dead rail costs its own card and nothing else. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const headers = await authHeaders();
      const jobs: Promise<void>[] = [
        (async () => {
          try {
            const [weeklyRes, contestsRes] = await Promise.all([
              fetch("/api/challenges/weekly", { headers }),
              fetch("/api/world/contests", { headers }),
            ]);
            if (cancelled || (!weeklyRes.ok && !contestsRes.ok)) return;
            const weekly = weeklyRes.ok ? parseWeeklyContest(await weeklyRes.json()).weekly : null;
            const contests = contestsRes.ok ? normalizeContests(await contestsRes.json()) : [];
            setChallenges({ weekly, weeklyKnown: weeklyRes.ok, summary: summarizeContests(contests) });
          } catch {
            /* this widget degrades alone */
          }
        })(),
        (async () => {
          try {
            const res = await fetch("/api/retention/away-digest", { headers });
            if (!cancelled && res.ok) setDigest(normalizeStudioDigest(await res.json()));
          } catch {
            /* this widget degrades alone */
          }
        })(),
        (async () => {
          try {
            const res = await fetch("/api/retention/leaderboard", { headers });
            if (!cancelled && res.ok) setLeaderboard(normalizeLeaderboard(await res.json()));
          } catch {
            /* this widget degrades alone */
          }
        })(),
        (async () => {
          try {
            const res = await fetch("/api/sponsors/pipeline/deals", { headers });
            if (!cancelled && res.ok) setPipeline(normalizeSponsorPipeline(await res.json()));
          } catch {
            /* this widget degrades alone */
          }
        })(),
      ];
      await Promise.allSettled(jobs);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* Lazy tab loaders — each fires the first time its tab opens
     (and again only on its own retry). */
  const loadDrafts = async () => {
    try {
      const res = await fetch("/api/drafts", { headers: await authHeaders() });
      if (!res.ok) throw new Error("drafts");
      setDrafts({ rows: normalizeStudioDrafts(await res.json()), failed: false });
    } catch {
      setDrafts({ rows: null, failed: true });
    }
  };
  const loadClips = async () => {
    try {
      const res = await fetch("/api/generated-clips", { headers: await authHeaders() });
      if (!res.ok) throw new Error("clips");
      setClips({ rows: normalizeStudioClips(await res.json()), failed: false });
    } catch {
      setClips({ rows: null, failed: true });
    }
  };
  const loadHistory = async () => {
    try {
      const res = await fetch("/api/generation-history", { headers: await authHeaders() });
      if (!res.ok) throw new Error("history");
      setHistory({ rows: normalizeStudioHistory(await res.json()), failed: false });
    } catch {
      setHistory({ rows: null, failed: true });
    }
  };

  useEffect(() => {
    if (tab === "drafts" && drafts.rows === null && !drafts.failed) void loadDrafts();
    if (tab === "clips" && clips.rows === null && !clips.failed) void loadClips();
    if (tab === "history" && history.rows === null && !history.failed) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const ink = isLight ? "text-[#2a1e07]" : "text-white";
  const balance = profile?.credits ?? null;

  const moves = studioNextMoves({
    latestProject: projects && projects.length > 0 ? { id: projects[0].id, label: projects[0].label } : null,
    sponsorNextName: pipeline ? (pipeline.next?.sponsorName ?? null) : null,
    canClaimDaily: strip?.canClaimDaily === true,
  });

  const tabCount = (id: StudioProjectsTabId): number | null => {
    if (id === "projects") return projects ? projects.length : null;
    if (id === "drafts") return drafts.rows ? drafts.rows.length : null;
    if (id === "clips") return clips.rows ? clips.rows.length : null;
    return history.rows ? history.rows.length : null;
  };

  return (
    <div className="space-y-3">
      {/* Your creator profile (Stack-100 #48): shows yours when you
          have one; a member without one claims it right here, so a
          first publish never has to leave the World. */}
      <CreatorProfileCreateCard isLight={isLight} />

      {/* The balance + streak strip */}
      <NativeCard isLight={isLight}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            {balance === null ? "—" : balance.toLocaleString("en-US")}{" "}
            <span className="text-[#d4af37]">Visual Bucs</span>
          </span>
          {/* Lane V-bucs: the total stays single in-world too, but a
              temporary part is named with its expiry under it. */}
          {profile && (
            <TemporaryBucsNote
              composition={profile.balance_composition ?? balanceComposition(profile)}
              mode="label"
              className={`text-xs font-bold ${isLight ? "text-[#8a6d1f]" : "text-amber-300/90"}`}
            />
          )}
          {strip && (
            <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              <Flame className="h-3.5 w-3.5 text-[#d4af37]" />
              {strip.streak}-day streak
              {strip.bonusCredits > 0 ? (
                <span className={muted}>· {strip.bonusCredits.toLocaleString("en-US")} bonus VB banked</span>
              ) : null}
            </span>
          )}
          {activity && <span className={`text-xs ${muted}`}>{activity}</span>}
        </div>
      </NativeCard>

      {/* The vault characters, as a portrait row */}
      {characters !== null && characters.length > 0 && (
        <NativeCard isLight={isLight} title="Your vault characters">
          <div className="flex flex-wrap gap-2">
            {characters.map((c) => (
              <span
                key={c.id}
                data-testid="world-studio-vault-character"
                className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 ${
                  isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                }`}
              >
                {c.portraitUrl ? (
                  <img src={c.portraitUrl} alt="" className="h-7 w-7 rounded-full border border-[#d4af37] object-cover" />
                ) : c.loopUrl ? (
                  <video src={c.loopUrl} muted playsInline className="h-7 w-7 rounded-full border border-[#d4af37] object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d4af37] bg-gradient-to-br from-amber-300 to-amber-600 text-[11px] font-black text-black">
                    {characterMonogram(c.name)}
                  </span>
                )}
                <span className={`max-w-[140px] truncate text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {c.name}
                </span>
              </span>
            ))}
          </div>
        </NativeCard>
      )}

      {/* Next moves — the dashboard's rules over this board's state */}
      <NativeCard isLight={isLight} title="Your next moves">
        <div className="space-y-2">
          {moves.map((m) => (
            <div key={m.kind} className="flex items-start gap-2.5">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
              <div className="min-w-0">
                <p className={`text-sm font-bold ${ink}`}>{m.title}</p>
                <p className={`text-xs ${muted}`}>{m.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </NativeCard>

      {/* The widget family */}
      <div className="grid gap-3 sm:grid-cols-2">
        {challenges ? (
          <NativeCard isLight={isLight} title="Challenges & contests">
            <div className="space-y-2" data-testid="world-studio-widget-challenges">
              <div className="flex items-start gap-2.5">
                <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
                <div className="min-w-0">
                  {challenges.weekly ? (
                    <>
                      <p className={`text-sm font-bold ${ink}`}>{challenges.weekly.title}</p>
                      <p className={`text-xs ${muted}`}>
                        This week&rsquo;s contest · {challenges.weekly.entryCount.toLocaleString("en-US")} entries
                        {challenges.weekly.prizePoolCredits > 0
                          ? ` · ${challenges.weekly.prizePoolCredits.toLocaleString("en-US")} VB in prizes`
                          : ""}
                        {challenges.weekly.endsAt ? ` · ends ${fmtDate(challenges.weekly.endsAt)}` : ""}
                      </p>
                    </>
                  ) : challenges.weeklyKnown ? (
                    <>
                      <p className={`text-sm font-bold ${ink}`}>No contest this week</p>
                      <p className={`text-xs ${muted}`}>The weekly contest hasn&rsquo;t launched — the wall says so rather than inventing one.</p>
                    </>
                  ) : (
                    <>
                      <p className={`text-sm font-bold ${ink}`}>This week&rsquo;s contest</p>
                      <p className={`text-xs ${muted}`}>The contest wall couldn&rsquo;t be read just now — the contest itself is fine.</p>
                    </>
                  )}
                </div>
              </div>
              <p className={`text-xs ${muted}`}>
                {challenges.summary.liveCount > 0
                  ? `${challenges.summary.liveCount} palace contest${challenges.summary.liveCount === 1 ? "" : "s"} live${
                      challenges.summary.nextTitle
                        ? ` — next to close: ${challenges.summary.nextTitle}${challenges.summary.nextEndsAt ? ` (${fmtDate(challenges.summary.nextEndsAt)})` : ""}`
                        : ""
                    }. The contest stand is in the Game Rooms.`
                  : "No palace contests are live right now — they open at the Game Rooms' contest stand."}
              </p>
            </div>
          </NativeCard>
        ) : null}

        {leaderboard ? (
          <NativeCard isLight={isLight} title="This week's leaderboard">
            <div className="space-y-1.5" data-testid="world-studio-widget-leaderboard">
              {leaderboard.rows.length === 0 ? (
                <p className={`text-xs ${muted}`}>No creations on the board yet this week — the first one sets the pace.</p>
              ) : (
                leaderboard.rows.slice(0, WIDGET_ROW_CAP).map((r) => (
                  <div key={r.rank} className="flex items-center gap-2 text-xs">
                    <Crown className={`h-3.5 w-3.5 shrink-0 ${r.rank === 1 ? "text-[#d4af37]" : "text-transparent"}`} />
                    <span className={`font-black ${ink}`}>#{r.rank}</span>
                    <span className={`min-w-0 flex-1 truncate font-bold ${ink}`}>
                      {r.name}
                      {r.isYou ? <span className="text-[#d4af37]"> · you</span> : null}
                    </span>
                    <span className={muted}>{r.score.toLocaleString("en-US")} pts</span>
                  </div>
                ))
              )}
              {leaderboard.viewerRank !== null && (
                <p className={`pt-0.5 text-xs font-bold ${ink}`}>
                  You stand #{leaderboard.viewerRank} this week · {leaderboard.viewerScore.toLocaleString("en-US")} pts
                </p>
              )}
            </div>
          </NativeCard>
        ) : null}

        {pipeline ? (
          <NativeCard isLight={isLight} title="Sponsor pipeline">
            <div className="space-y-1.5" data-testid="world-studio-widget-sponsors">
              <div className="flex items-start gap-2.5">
                <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
                <div className="min-w-0">
                  {pipeline.activeCount > 0 ? (
                    <>
                      <p className={`text-sm font-bold ${ink}`}>
                        {pipeline.activeCount} active deal{pipeline.activeCount === 1 ? "" : "s"} · $
                        {pipeline.pipelineDollars.toLocaleString("en-US")} in play
                      </p>
                      {pipeline.next ? (
                        <p className={`text-xs ${muted}`}>
                          Next to touch: {pipeline.next.sponsorName}
                          {pipeline.next.stage ? ` · ${pipeline.next.stage}` : ""}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className={`text-sm font-bold ${ink}`}>No sponsor deals in play yet</p>
                      <p className={`text-xs ${muted}`}>When a brand deal opens, its stage and value stand here.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </NativeCard>
        ) : null}

        {digest ? (
          <NativeCard isLight={isLight} title="While you were away">
            <div className="space-y-1.5" data-testid="world-studio-widget-digest">
              <div className="flex items-start gap-2.5">
                <MailOpen className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
                <div className="min-w-0 space-y-1">
                  {digest.state === "off" ? (
                    <p className={`text-xs ${muted}`}>Your away digest is off — it can be switched on in Settings on the website.</p>
                  ) : digest.state === "first-visit" ? (
                    <p className={`text-xs ${muted}`}>Your away digest starts building from this visit — next time you return, what finished while you were gone stands here.</p>
                  ) : digest.state === "recent" ? (
                    <p className={`text-xs ${muted}`}>You&rsquo;re all caught up — nothing has piled up since your last visit.</p>
                  ) : (
                    <>
                      {digest.completedJobs > 0 && (
                        <p className={`text-xs ${ink}`}>
                          <span className="font-bold">{digest.completedJobs} export{digest.completedJobs === 1 ? "" : "s"} finished</span> while you were away
                        </p>
                      )}
                      {digest.failedJobs > 0 && (
                        <p className={`text-xs ${ink}`}>
                          <span className="font-bold">{digest.failedJobs} export{digest.failedJobs === 1 ? "" : "s"} didn&rsquo;t finish</span> — they wait on the website&rsquo;s export queue
                        </p>
                      )}
                      {digest.newProjectLabels.map((label, i) => (
                        <p key={`${label}-${i}`} className={`text-xs ${muted}`}>New project: {label}</p>
                      ))}
                      {digest.bowRaceLine && <p className={`text-xs ${muted}`}>{digest.bowRaceLine}</p>}
                      {digest.jackpotLine && <p className={`text-xs ${muted}`}>{digest.jackpotLine}</p>}
                      {digest.streakDays !== null && (
                        <p className={`text-xs ${muted}`}>Streak standing: {digest.streakDays} days</p>
                      )}
                      {digest.completedJobs === 0 &&
                        digest.failedJobs === 0 &&
                        digest.newProjectLabels.length === 0 &&
                        !digest.bowRaceLine &&
                        !digest.jackpotLine &&
                        digest.streakDays === null && (
                          <p className={`text-xs ${muted}`}>Nothing new finished while you were away.</p>
                        )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </NativeCard>
        ) : null}
      </div>

      {/* The projects board, with its deeper tabs */}
      <div
        className={`flex flex-wrap items-center gap-1 border-b pb-0 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}
        role="tablist"
        aria-label="Your work"
      >
        {STUDIO_PROJECT_TABS.map((t) => {
          const count = tabCount(t.id);
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`world-studio-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`relative px-3 py-2 text-xs font-bold transition-colors bdv-touch-target ${
                active
                  ? `${ink} after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#d4af37]`
                  : `${muted} hover:opacity-80`
              }`}
            >
              {t.label}
              {count !== null ? <span className={muted}> · {count}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === "projects" ? (
        projectsFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The studio wouldn't open"
            message="Your projects are safe — the studio door just didn't answer. Try again."
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : projects === null ? (
          <NativeLoadingState isLight={isLight} message="Opening your studio…" />
        ) : (
          <NativeBoard isLight={isLight} title="Your projects">
            {projects.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="No projects yet — the studio is yours to fill."
                detail="Make something at the Create Wing's desks and it lands here, ready to continue."
              />
            ) : (
              <>
                {projects.slice(0, PROJECT_CAP).map((p) => (
                  <NativeBoardRow
                    key={p.id}
                    isLight={isLight}
                    title={p.label}
                    detail={[p.projectType, fmtDate(p.createdAt)].filter(Boolean).join(" · ") || undefined}
                    meta={p.creditsUsed !== null && p.creditsUsed > 0 ? `${p.creditsUsed.toLocaleString("en-US")} VB` : undefined}
                    action={
                      <button
                        type="button"
                        data-testid="world-studio-continue"
                        onClick={() => onContinueProject(p.id)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                      >
                        <Play className="h-3.5 w-3.5" /> Continue
                      </button>
                    }
                  />
                ))}
                {projects.length > PROJECT_CAP && (
                  <p className={`px-1 pt-1 text-[11px] ${muted}`}>
                    Showing your latest {PROJECT_CAP} of {projects.length} projects — the full archive waits on the website, one tap below.
                  </p>
                )}
              </>
            )}
          </NativeBoard>
        )
      ) : tab === "drafts" ? (
        drafts.failed ? (
          <NativeErrorState
            isLight={isLight}
            title="Drafts wouldn't load"
            message="Your drafts are safe — the shelf just didn't answer. Try again."
            onRetry={() => void loadDrafts()}
          />
        ) : drafts.rows === null ? (
          <NativeLoadingState isLight={isLight} message="Fetching your drafts…" />
        ) : (
          <NativeBoard isLight={isLight} title="Your drafts">
            {drafts.rows.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="No drafts yet."
                detail="Leave a song or video half-made at the website's desks and the draft waits for you here."
              />
            ) : (
              drafts.rows.slice(0, PROJECT_CAP).map((d) => (
                <NativeBoardRow
                  key={d.id}
                  isLight={isLight}
                  title={d.label}
                  detail={[d.workflowLabel, fmtDate(d.updatedAt)].filter(Boolean).join(" · ") || undefined}
                />
              ))
            )}
          </NativeBoard>
        )
      ) : tab === "clips" ? (
        clips.failed ? (
          <NativeErrorState
            isLight={isLight}
            title="Clips wouldn't load"
            message="Your clips are safe — the shelf just didn't answer. Try again."
            onRetry={() => void loadClips()}
          />
        ) : clips.rows === null ? (
          <NativeLoadingState isLight={isLight} message="Fetching your clips…" />
        ) : (
          <NativeBoard isLight={isLight} title="Your generated clips">
            {clips.rows.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="No generated clips yet."
                detail="Clips you generate — at the Video Desk or on the website — land here."
              />
            ) : (
              clips.rows.slice(0, PROJECT_CAP).map((c) => (
                <NativeBoardRow
                  key={c.id}
                  isLight={isLight}
                  title={c.label}
                  detail={[c.status, fmtDate(c.createdAt)].filter(Boolean).join(" · ") || undefined}
                  meta={c.hasVideo ? "Video ready" : undefined}
                />
              ))
            )}
          </NativeBoard>
        )
      ) : history.failed ? (
        <NativeErrorState
          isLight={isLight}
          title="History wouldn't load"
          message="Your generation history is safe — the ledger just didn't answer. Try again."
          onRetry={() => void loadHistory()}
        />
      ) : history.rows === null ? (
        <NativeLoadingState isLight={isLight} message="Reading your history…" />
      ) : (
        <NativeBoard isLight={isLight} title="Generation history">
          {history.rows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="Nothing generated yet."
              detail="Every generation you run — song, video, image — is written into this ledger."
            />
          ) : (
            history.rows.slice(0, PROJECT_CAP).map((h) => (
              <NativeBoardRow
                key={h.id}
                isLight={isLight}
                title={h.label}
                detail={[h.generationType, historyStatusWord(h), fmtDate(h.createdAt)].filter(Boolean).join(" · ") || undefined}
                meta={h.creditsUsed !== null && h.creditsUsed > 0 ? `${h.creditsUsed.toLocaleString("en-US")} VB` : undefined}
              />
            ))
          )}
        </NativeBoard>
      )}
    </div>
  );
}
