import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, Clock3, Loader2, Sparkles, Plus, X, Upload, Video,
  Camera, Music2, ThumbsUp, Trash2, Pencil, CheckCircle2, XCircle,
  AlertTriangle, ChevronLeft, ChevronRight, Wand2, ListVideo, Inbox,
  History, GripVertical, RefreshCw, ExternalLink, Megaphone, Copy,
  Clapperboard, AtSign, Share2, Link2, TrendingUp,
  Play, Images, Radio, MessageSquare, Stethoscope, ArrowRight, RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { OutOfCredits } from "@/components/OutOfCredits";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import CalendarAutofill from "@/components/wave8/CalendarAutofill";
import { Button } from "@/components/ui/button";
import type { SocialAccountInfo } from "@/components/ConnectedAccounts";
import {
  todayISO,
  calendarSig,
  leadBlankCount,
  postingCount,
  type CalendarPlatformKey,
} from "@/lib/content-calendar";
import {
  combineLocalDateTime,
  countdownLabel,
  groupPostsByDay,
  isFutureLocal,
  monthGridDays,
  movePostToDate,
  normalizeHashtags,
  prettyDateTime,
  timeLocal,
  todayLocal,
  toLocalDate,
  type ScheduledPostShape,
  type SchedulerPlatformKey,
} from "@/lib/scheduler";

/* ─── Content Scheduler ──────────────────────────────────────────────────
   One calendar to schedule video posts across Instagram Reels, TikTok, and
   Facebook. Server-owned and restart-safe: the API persists every post and
   the job-poller fires them — no tab or console script required.

   Money model (shown honestly in the UI):
   - Drafts: free. Browsing the calendar: free.
   - Scheduling: 1 credit per post, charged up front — no matter how many
     platforms it targets. Cancel anytime before it fires for an automatic refund.
   - Best-time optimizer: 75 Visual Bucs per optimization, charged up front —
     benchmark slots always work even without an AI key; auto-refund on failure.
   - TikTok posts land in your TikTok drafts inbox — TikTok's API can't
     publish straight to your feed, so you finish the post in TikTok. */

type Tab = "calendar" | "queue" | "drafts" | "posted" | "community";

interface PlatformOpt {
  key: SchedulerPlatformKey;
  icon: LucideIcon;
}

const PLATFORM_OPTS: PlatformOpt[] = [
  { key: "instagram", icon: Camera },
  { key: "tiktok", icon: Music2 },
  { key: "facebook", icon: ThumbsUp },
];

const NICHE_PRESETS = ["music", "gaming", "comedy", "fitness", "beauty", "tech", "education", "lifestyle"];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20";
const labelClass = "mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40";

async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ─── Best-time optimizer + shareable schedules ────────────────────────────
   The optimizer section lives in <BestTimeOptimizer/> below. A schedule can
   be shared via /scheduler?shared=<payload>&ref=<CODE>: the payload is a
   base64url JSON blob { n: niche, s: [{d,t,p,s,r}] } rendered publicly by
   <SharedScheduleView/> — no login needed to view, which makes it postable
   anywhere for organic reach. The ref code is the sharer's referral code. */

type BestTimePlatformKey = "tiktok" | "instagram" | "youtube" | "x";

interface BestTimeSlot {
  date: string;
  time: string;
  platform: string;
  score: number;
  reason: string;
  source: "benchmark" | "personalized";
}

interface BestTimeHeatmap {
  dates: string[];
  scores: number[][];
  personalized: boolean[][];
  aiTuned: boolean[][];
}

interface BestTimeResult {
  slots: BestTimeSlot[];
  heatmap: Record<string, BestTimeHeatmap>;
  personalized: boolean;
  aiNicheTuning: boolean;
  benchmarkNote: string;
}

interface SharedSlot {
  d: string;
  t: string;
  p: string;
  s: number;
  r: string;
}

interface SharedSchedule {
  n: string;
  s: SharedSlot[];
}

const BT_PLATFORM_META: { key: BestTimePlatformKey; icon: LucideIcon; label: string }[] = [
  { key: "tiktok", icon: Music2, label: "TikTok" },
  { key: "instagram", icon: Camera, label: "Instagram" },
  { key: "youtube", icon: Clapperboard, label: "YouTube" },
  { key: "x", icon: AtSign, label: "X" },
];

function btPlatformLabel(key: string): string {
  return BT_PLATFORM_META.find((p) => p.key === key)?.label ?? key;
}

function prettyTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function hourLabel(h: number): string {
  const ap = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ap}`;
}

function prettyDay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function encodeSharedSchedule(s: SharedSchedule): string {
  const json = JSON.stringify(s);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeSharedSchedule(raw: string): SharedSchedule | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const p = JSON.parse(json) as Partial<SharedSchedule>;
    if (p && typeof p.n === "string" && Array.isArray(p.s) && p.s.length > 0) return p as SharedSchedule;
    return null;
  } catch {
    return null;
  }
}

export default function Scheduler() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  /* ?tab= deep link (?tab=plan is legacy — folded into the Calendar tab's
     AI Week Planner). ?niche= from the coach lands on the calendar too. */
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("tab") === "plan") return "calendar";
      if (q.get("niche") && !q.get("shared")) return "calendar";
    } catch { /* non-browser — ignore */ }
    return "calendar";
  });
  const [posts, setPosts] = useState<ScheduledPostShape[]>([]);
  const [accounts, setAccounts] = useState<SocialAccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [dragPostId, setDragPostId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  /* composer */
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ScheduledPostShape | null>(null);
  const [prefill, setPrefill] = useState<{ date: string; time: string } | null>(null);
  const [captionPrefill, setCaptionPrefill] = useState<string | null>(null);
  const [mediaPrefill, setMediaPrefill] = useState<string | null>(null);
  const [platformPrefill, setPlatformPrefill] = useState<SchedulerPlatformKey[] | null>(null);

  /* Deep-link protocol (used by Multi-Ratio Export handoffs):
     /scheduler?schedule=1&caption=…&media=…&platform=tiktok
     Auto-opens the composer with everything prefilled — each ratio lands
     as its own scheduled post. */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      /* Wave 8 Hook Rewriter handoff: a saved hook in localStorage opens the
         composer prefilled so the creator can schedule it right away. */
      try {
        const draft = window.localStorage.getItem("wave8_scheduler_draft");
        if (draft && draft.trim()) {
          window.localStorage.removeItem("wave8_scheduler_draft");
          openComposer(undefined, undefined, undefined, draft.trim());
        }
      } catch {
        /* storage unavailable — ignore */
      }
      if (params.get("schedule") !== "1") return;
      const caption = params.get("caption") ?? undefined;
      const media = params.get("media") ?? undefined;
      const rawPlatforms = (params.get("platform") ?? "").split(",").map((p) => p.trim().toLowerCase());
      const valid: SchedulerPlatformKey[] = ["instagram", "tiktok", "facebook"]
        .filter((p) => rawPlatforms.includes(p)) as SchedulerPlatformKey[];
      openComposer(undefined, undefined, undefined, caption, media, valid.length > 0 ? valid : undefined);
      // Consume the params so a refresh doesn't reopen the composer.
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* shared schedule (?shared= payload — public view, no login needed) */
  const [sharedSchedule, setSharedSchedule] = useState<SharedSchedule | null>(null);
  const [sharedRef, setSharedRef] = useState<string | null>(null);
  const [sharedDismissed, setSharedDismissed] = useState(false);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const ref = q.get("ref");
      if (ref) setSharedRef(ref);
      const raw = q.get("shared");
      if (raw) {
        const parsed = decodeSharedSchedule(raw);
        if (parsed) setSharedSchedule(parsed);
      }
    } catch {
      /* a bad payload just means no shared view */
    }
  }, []);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const loadPosts = useCallback(async () => {
    const token = await getAccessToken();
    const data = await api<{ posts: ScheduledPostShape[] }>("/api/scheduler/posts", token);
    setPosts(data.posts);
  }, [getAccessToken]);

  const loadAccounts = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const data = await api<{ accounts: SocialAccountInfo[] }>("/api/social/accounts", token);
      setAccounts(data.accounts);
    } catch {
      /* not fatal — composer shows the connect prompt */
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([loadPosts(), loadAccounts()]).finally(() => setLoading(false));
  }, [user, loadPosts, loadAccounts]);

  const refresh = useCallback(async () => {
    await loadPosts();
    refreshProfile();
  }, [loadPosts, refreshProfile]);

  const scheduled = useMemo(() => posts.filter((p) => p.status === "scheduled" || p.status === "publishing"), [posts]);
  const drafts = useMemo(() => posts.filter((p) => p.status === "draft"), [posts]);
  const history = useMemo(
    () => posts.filter((p) => p.status === "posted" || p.status === "failed" || p.status === "canceled"),
    [posts],
  );
  const byDay = useMemo(() => groupPostsByDay(scheduled), [scheduled]);
  const gridCells = useMemo(() => monthGridDays(monthCursor.y, monthCursor.m), [monthCursor]);
  const monthLabel = useMemo(
    () => new Date(monthCursor.y, monthCursor.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    [monthCursor],
  );

  function openComposer(post?: ScheduledPostShape, date?: string, time?: string, caption?: string, mediaUrl?: string, platforms?: SchedulerPlatformKey[]) {
    setEditingPost(post ?? null);
    setPrefill(date ? { date, time: time ?? "18:00" } : null);
    setCaptionPrefill(caption ?? null);
    setMediaPrefill(mediaUrl ?? null);
    setPlatformPrefill(platforms ?? null);
    setComposerOpen(true);
  }

  async function handleCancel(post: ScheduledPostShape) {
    if (!window.confirm(t("scheduler.confirm.cancel"))) return;
    try {
      const token = await getAccessToken();
      const data = await api<{ canceled?: boolean; refunded?: number; deleted?: boolean }>(
        `/api/scheduler/posts/${post.id}`,
        token,
        { method: "DELETE" },
      );
      await refresh();
      toast({
        title: data.canceled ? t("scheduler.toast.canceled") : t("scheduler.toast.deleted"),
        description: data.refunded ? t("scheduler.toast.refunded", { num: data.refunded, s: data.refunded === 1 ? "" : "s" }) : undefined,
      });
    } catch (err) {
      toast({ title: t("scheduler.toast.couldntCancel"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleReschedule(postId: string, targetDate: string) {
    const post = posts.find((p) => p.id === postId);
    if (!post?.scheduledAt) return;
    const moved = movePostToDate(post.scheduledAt, targetDate);
    if (!moved) return;
    if (new Date(moved).getTime() < Date.now() + 60_000) {
      toast({ title: t("scheduler.toast.cantMove"), description: t("scheduler.toast.futureDate"), variant: "destructive" });
      return;
    }
    try {
      const token = await getAccessToken();
      await api(`/api/scheduler/posts/${postId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ scheduledAt: moved }),
      });
      await loadPosts();
      toast({ title: t("scheduler.toast.rescheduled"), description: prettyDateTime(moved) });
    } catch (err) {
      toast({ title: t("scheduler.toast.couldntReschedule"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  function handleUseSlot(date: string, time: string, platform?: string) {
    /* Map the optimizer platform onto the composer's platform keys where possible
       (YouTube / X have no composer target yet — the composer keeps its default). */
    const key = platform === "tiktok" || platform === "instagram" ? platform : undefined;
    openComposer(undefined, date, time, undefined, undefined, key ? [key] : undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!user) {
    if (sharedSchedule) {
      /* Public shared-schedule view — no login needed, built for posting anywhere. */
      const signupHref = sharedRef ? `/signup?ref=${encodeURIComponent(sharedRef)}` : "/signup";
      return (
        <div className="min-h-screen bg-black text-white">
          <main className="mx-auto max-w-3xl px-5 pb-24 pt-14 md:pt-20">
            <SharedScheduleView shared={sharedSchedule} ctaHref={signupHref} ctaLabel={t("scheduler.shared.getYours")} />
          </main>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-black text-white">
        <main className="mx-auto max-w-3xl px-5 pb-24 pt-24 text-center">
          <h1 className="font-display text-4xl font-black">{t("scheduler.titlePrefix")} <span className="text-primary">{t("scheduler.titleSuffix")}</span></h1>
          <p className="mt-4 text-white/55">{t("scheduler.signInPrompt")}</p>
          <Button asChild className="mt-8 bg-primary text-black hover:bg-primary/90">
            <a href="/login">{t("scheduler.signIn")}</a>
          </Button>
        </main>

      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        {sharedSchedule && !sharedDismissed && (
          <div className="relative mb-8">
            <button
              onClick={() => setSharedDismissed(true)}
              className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-black/60 p-1.5 text-white/50 hover:text-white"
              aria-label={t("scheduler.shared.dismiss")}
            >
              <X className="h-4 w-4" />
            </button>
            <SharedScheduleView
              shared={sharedSchedule}
              ctaHref="#best-time-optimizer"
              ctaLabel={t("scheduler.shared.buildMine")}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <CalendarDays className="h-3 w-3" aria-hidden="true" /> {t("scheduler.badge")}
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            {t("scheduler.titlePrefix")} <span className="text-primary">{t("scheduler.titleSuffix")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            {t("scheduler.hero")}
          </p>
          <div className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/45">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> {t("scheduler.perks.free")}</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> {t("scheduler.perks.cost")}</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> {t("scheduler.perks.refund")}</span>
          </div>
          <div className="mt-6">
            <Button onClick={() => openComposer()} className="bg-primary font-bold text-black hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" /> {t("scheduler.newPost")}
            </Button>
          </div>
        </div>

        {outOfCredits && (
          <div className="relative mt-8"><OutOfCredits /></div>
        )}

        {/* tabs */}
        <div className="relative mt-10 flex flex-wrap gap-2 border-b border-white/10 pb-3">
          {(
            [
              { key: "calendar", label: t("scheduler.tabs.calendar"), icon: CalendarDays },
              { key: "queue", label: t("scheduler.tabs.queue", { num: scheduled.length }), icon: ListVideo },
              { key: "drafts", label: t("scheduler.tabs.drafts", { num: drafts.length }), icon: Inbox },
              { key: "posted", label: t("scheduler.tabs.posted"), icon: History },
              { key: "community", label: t("scheduler.tabs.community"), icon: Megaphone },
            ] as { key: Tab; label: string; icon: LucideIcon }[]
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === key
                  ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                  : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-white/40">
            <Loader2 className="mr-3 h-6 w-6 animate-spin" /> {t("scheduler.loading")}
          </div>
        ) : (
          <div className="relative mt-8">
            {tab === "calendar" && (
              <>
                {/* Wave 8 · AI Week Planner — drag-and-drop week grid */}
                <CalendarAutofill
                  onOpenComposer={(date, time, caption) =>
                    openComposer(undefined, date, time, caption)
                  }
                />
                <CalendarTab
                gridCells={gridCells}
                monthLabel={monthLabel}
                monthCursor={monthCursor}
                setMonthCursor={setMonthCursor}
                byDay={byDay}
                dragPostId={dragPostId}
                setDragPostId={setDragPostId}
                dragOverDay={dragOverDay}
                setDragOverDay={setDragOverDay}
                onDropDay={handleReschedule}
                onDayClick={(date) => openComposer(undefined, date)}
                onEdit={(p) => openComposer(p)}
                onCancel={handleCancel}
              />
              </>
            )}
            {tab === "queue" && (
              <QueueTab posts={scheduled} onEdit={(p) => openComposer(p)} onCancel={handleCancel} />
            )}
            {tab === "drafts" && (
              <DraftsTab
                posts={drafts}
                onSchedule={(p) => openComposer(p)}
                onDelete={handleCancel}
              />
            )}
            {tab === "posted" && <PostedTab posts={history} />}
            {tab === "community" && (
              <CommunityPostsTab
                onSchedulePost={(text) => openComposer(undefined, undefined, undefined, text)}
                onOutOfCredits={() => setOutOfCredits(true)}
              />
            )}
          </div>
        )}

        {/* ── Best time to post optimizer ── */}
        <BestTimeOptimizer
          timezone={timezone}
          onUseSlot={handleUseSlot}
          onOutOfCredits={() => setOutOfCredits(true)}
        />
      </main>



      {composerOpen && (
        <ComposerModal
          post={editingPost}
          prefill={prefill}
          captionPrefill={captionPrefill}
          mediaPrefill={mediaPrefill}
          platformPrefill={platformPrefill}
          accounts={accounts}
          timezone={timezone}
          onClose={() => { setComposerOpen(false); setEditingPost(null); setPrefill(null); setCaptionPrefill(null); setMediaPrefill(null); setPlatformPrefill(null); }}
          onSaved={async () => { setComposerOpen(false); setEditingPost(null); setPrefill(null); setCaptionPrefill(null); setMediaPrefill(null); setPlatformPrefill(null); await refresh(); }}
          onOutOfCredits={() => setOutOfCredits(true)}
        />
      )}
    </div>
  );
}


function CalendarTab(props: {
  gridCells: { date: string | null }[];
  monthLabel: string;
  monthCursor: { y: number; m: number };
  setMonthCursor: (c: { y: number; m: number }) => void;
  byDay: Map<string, ScheduledPostShape[]>;
  dragPostId: string | null;
  setDragPostId: (id: string | null) => void;
  dragOverDay: string | null;
  setDragOverDay: (d: string | null) => void;
  onDropDay: (postId: string, date: string) => void;
  onDayClick: (date: string) => void;
  onEdit: (p: ScheduledPostShape) => void;
  onCancel: (p: ScheduledPostShape) => void;
}) {
  const { t } = useTranslation();
  const { gridCells, monthLabel, monthCursor, setMonthCursor, byDay } = props;
  const today = todayLocal();

  function shiftMonth(delta: number) {
    const d = new Date(monthCursor.y, monthCursor.m + delta, 1);
    setMonthCursor({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-black">{monthLabel}</h2>
        <div className="flex gap-2">
          <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-primary/40 hover:text-white" aria-label={t("scheduler.calendar.prevMonth")}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => { const n = new Date(); setMonthCursor({ y: n.getFullYear(), m: n.getMonth() }); }}
            className="rounded-lg border border-white/10 px-3 text-[13px] font-semibold text-white/60 hover:border-primary/40 hover:text-white"
          >
            {t("scheduler.calendar.today")}
          </button>
          <button onClick={() => shiftMonth(1)} className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-primary/40 hover:text-white" aria-label={t("scheduler.calendar.nextMonth")}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-bold uppercase tracking-widest text-white/30">{t(`scheduler.days.${d}`)}</div>
        ))}
        {gridCells.map((cell, i) => {
          if (!cell.date) return <div key={i} className="min-h-[88px] rounded-xl" />;
          const dayPosts = byDay.get(cell.date) ?? [];
          const isToday = cell.date === today;
          const isPast = cell.date < today;
          const isDragOver = props.dragOverDay === cell.date;
          return (
            <div
              key={cell.date}
              onClick={() => { if (!isPast) props.onDayClick(cell.date!); }}
              onDragOver={(e) => { e.preventDefault(); props.setDragOverDay(cell.date); }}
              onDragLeave={() => props.setDragOverDay(null)}
              onDrop={(e) => {
                e.preventDefault();
                props.setDragOverDay(null);
                if (props.dragPostId && !isPast) props.onDropDay(props.dragPostId, cell.date!);
                props.setDragPostId(null);
              }}
              className={`min-h-[88px] cursor-pointer rounded-xl border p-1.5 transition ${
                isDragOver
                  ? "border-primary bg-primary/10"
                  : isToday
                    ? "border-primary/50 bg-primary/[0.06]"
                    : "border-white/10 bg-white/[0.02] hover:border-primary/30"
              } ${isPast ? "cursor-default opacity-50" : ""}`}
              title={isPast ? undefined : t("scheduler.calendar.dayTitle")}
            >
              <div className={`text-[11px] font-bold ${isToday ? "text-primary" : "text-white/50"}`}>
                {Number(cell.date.slice(8))}
              </div>
              <div className="mt-1 space-y-1">
                {dayPosts.slice(0, 3).map((p) => (
                  <button
                    key={p.id}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); props.setDragPostId(p.id); }}
                    onDragEnd={() => props.setDragPostId(null)}
                    onClick={(e) => { e.stopPropagation(); props.onEdit(p); }}
                    className={`flex w-full cursor-grab items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10px] font-semibold active:cursor-grabbing ${
                      p.status === "publishing" ? "bg-blue-500/20 text-blue-200" : "bg-primary/15 text-primary"
                    } ${props.dragPostId === p.id ? "opacity-40" : ""}`}
                    title={t("scheduler.calendar.postTitle", { datetime: prettyDateTime(p.scheduledAt!) })}
                  >
                    <GripVertical className="h-3 w-3 shrink-0 opacity-60" />
                    <span className="truncate">
                      {p.platforms.map((pl) => t(`scheduler.platforms.${pl}.label`).slice(0, 2)).join("·")}
                      {" "}{new Date(p.scheduledAt!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </button>
                ))}
                {dayPosts.length > 3 && (
                  <div className="px-1 text-[10px] text-white/40">{t("scheduler.calendar.more", { num: dayPosts.length - 3 })}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-white/35">
        {t("scheduler.calendar.hint")}
      </p>
    </div>
  );
}

/* ─── Queue tab ────────────────────────────────────────────────────────── */

function QueueTab(props: {
  posts: ScheduledPostShape[];
  onEdit: (p: ScheduledPostShape) => void;
  onCancel: (p: ScheduledPostShape) => void;
}) {
  const { t } = useTranslation();
  const sorted = useMemo(
    () => [...props.posts].sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "")),
    [props.posts],
  );
  if (sorted.length === 0) {
    return <EmptyState icon={ListVideo} title={t("scheduler.queue.emptyTitle")} hint={t("scheduler.queue.emptyHint")} />;
  }
  return (
    <div className="space-y-3">
      {sorted.map((p) => (
        <div key={p.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <MediaThumb post={p} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {p.platforms.map((pl) => {
                const opt = PLATFORM_OPTS.find((o) => o.key === pl)!;
                const Icon = opt.icon;
                return (
                  <span key={pl} className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
                    <Icon className="h-3 w-3" /> {t(`scheduler.platforms.${pl}.label`)}
                  </span>
                );
              })}
              {p.status === "publishing" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-bold text-blue-300">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t("scheduler.queue.postingNow")}
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-sm text-white/70">{p.caption || <span className="italic text-white/30">{t("scheduler.noCaption")}</span>}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-white/45">
              <Clock3 className="h-3.5 w-3.5" />
              {p.scheduledAt ? prettyDateTime(p.scheduledAt) : "—"}
              <span className="font-semibold text-primary">· {p.scheduledAt ? countdownLabel(p.scheduledAt) : ""}</span>
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Spine reverse handoff: scheduler → back to Promo Clips. */}
            <a
              href={`/promo-clip?hook=${encodeURIComponent((p.caption ?? "").slice(0, 200))}`}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-primary/40 hover:text-primary"
              aria-label={t("scheduler.queue.remixLabel")}
              title={t("scheduler.queue.remixTitle")}
            >
              <Clapperboard className="h-4 w-4" />
            </a>
            <button
              onClick={() => props.onEdit(p)}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-primary/40 hover:text-white"
              aria-label={t("scheduler.queue.editLabel")}
              title={t("scheduler.queue.editTitle")}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => props.onCancel(p)}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-red-500/50 hover:text-red-400"
              aria-label={t("scheduler.queue.cancelLabel")}
              title={t("scheduler.queue.cancelTitle")}
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Drafts tab ───────────────────────────────────────────────────────── */

function DraftsTab(props: {
  posts: ScheduledPostShape[];
  onSchedule: (p: ScheduledPostShape) => void;
  onDelete: (p: ScheduledPostShape) => void;
}) {
  const { t } = useTranslation();
  if (props.posts.length === 0) {
    return <EmptyState icon={Inbox} title={t("scheduler.drafts.emptyTitle")} hint={t("scheduler.drafts.emptyHint")} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {props.posts.map((p) => (
        <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <MediaThumb post={p} large />
          <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-white/70">{p.caption || <span className="italic text-white/30">{t("scheduler.noCaption")}</span>}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.platforms.map((pl) => (
              <span key={pl} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/60">
                {t(`scheduler.platforms.${pl}.label`)}
              </span>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" className="flex-1 bg-primary font-bold text-black hover:bg-primary/90" onClick={() => props.onSchedule(p)}>
              <Clock3 className="mr-1.5 h-3.5 w-3.5" /> {t("scheduler.drafts.schedule")}
            </Button>
            <button
              onClick={() => props.onDelete(p)}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-red-500/50 hover:text-red-400"
              aria-label={t("scheduler.drafts.deleteLabel")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Posted tab ───────────────────────────────────────────────────────── */

function PostedTab(props: { posts: ScheduledPostShape[] }) {
  const { t } = useTranslation();
  const sorted = useMemo(
    () => [...props.posts].sort((a, b) => (b.postedAt ?? b.updatedAt).localeCompare(a.postedAt ?? a.updatedAt)),
    [props.posts],
  );
  if (sorted.length === 0) {
    return <EmptyState icon={History} title={t("scheduler.posted.emptyTitle")} hint={t("scheduler.posted.emptyHint")} />;
  }
  return (
    <div className="space-y-3">
      {sorted.map((p) => (
        <div key={p.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <MediaThumb post={p} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.status} />
              {p.results.map((r) => (
                <span
                  key={r.platform}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    r.status === "posted" ? "bg-emerald-500/15 text-emerald-300"
                    : r.status === "failed" ? "bg-red-500/15 text-red-300"
                    : "bg-white/10 text-white/50"
                  }`}
                  title={r.error ?? r.status}
                >
                  {r.status === "posted" ? <CheckCircle2 className="h-3 w-3" />
                    : r.status === "failed" ? <XCircle className="h-3 w-3" />
                    : <AlertTriangle className="h-3 w-3" />}
                  {t(`scheduler.platforms.${r.platform}.label`)}
                </span>
              ))}
            </div>
            <p className="mt-1.5 truncate text-sm text-white/70">{p.caption || <span className="italic text-white/30">{t("scheduler.noCaption")}</span>}</p>
            <p className="mt-1 text-[13px] text-white/45">
              {p.postedAt ? `Posted ${prettyDateTime(p.postedAt)}` : `Updated ${prettyDateTime(p.updatedAt)}`}
              {p.lastError && p.status === "failed" && <span className="text-red-300/80"> · {p.lastError.slice(0, 120)}</span>}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Shared bits ──────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: ScheduledPostShape["status"] }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; cls: string }> = {
    posted: { label: t("scheduler.status.posted"), cls: "bg-emerald-500/15 text-emerald-300" },
    failed: { label: t("scheduler.status.failed"), cls: "bg-red-500/15 text-red-300" },
    canceled: { label: t("scheduler.status.canceled"), cls: "bg-white/10 text-white/50" },
    publishing: { label: t("scheduler.status.posting"), cls: "bg-blue-500/15 text-blue-300" },
    scheduled: { label: t("scheduler.status.scheduled"), cls: "bg-primary/15 text-primary" },
    draft: { label: t("scheduler.status.draft"), cls: "bg-white/10 text-white/50" },
  };
  const s = map[status] ?? map.draft!;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>{s.label}</span>;
}

function MediaThumb({ post, large }: { post: ScheduledPostShape; large?: boolean }) {
  const size = large ? "h-28 w-full" : "h-14 w-14";
  const src = post.mediaUrl.startsWith("supabase://") ? "" : post.mediaUrl;
  if (!src) {
    return (
      <div className={`${size} flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/60`}>
        <Video className="h-6 w-6 text-primary/60" />
      </div>
    );
  }
  return (
    <video src={src} muted playsInline preload="metadata" className={`${size} shrink-0 rounded-xl border border-white/10 bg-black object-cover`} />
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center">
      <Icon className="mx-auto h-10 w-10 text-primary/50" />
      <h3 className="mt-4 font-display text-xl font-black">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-white/45">{hint}</p>
    </div>
  );
}

/* ─── Community Posts tab (AI text-first post generator) ─────────────────
   Lives inside the scheduler — no new page, no new sidebar item.
   Generated variant → "Schedule this post" opens the existing composer with
   the text prefilled as the caption. */

interface CommunityPostVariant {
  text: string;
  charCount: number;
  limit: number;
  over: boolean;
}

interface CommunityBestTime {
  day: string;
  time: string;
  reason: string;
}

interface CommunityPlatformMeta {
  id: string;
  label: string;
  charLimit: number;
}

const COMMUNITY_PLATFORMS_FALLBACK: CommunityPlatformMeta[] = [
  { id: "youtube-community", label: "YouTube Community", charLimit: 5000 },
  { id: "x", label: "X", charLimit: 280 },
  { id: "instagram", label: "Instagram", charLimit: 2200 },
  { id: "threads", label: "Threads", charLimit: 500 },
];

const COMMUNITY_TONES_FALLBACK = [
  "hyped", "funny", "motivational", "chill", "luxury", "bold", "question", "story",
];

function CommunityPostsTab(props: {
  onSchedulePost: (text: string) => void;
  onOutOfCredits: () => void;
}) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("x");
  const [tone, setTone] = useState("hyped");
  const [cta, setCta] = useState("");
  const [niche, setNiche] = useState("");
  const [platforms, setPlatforms] = useState<CommunityPlatformMeta[]>(COMMUNITY_PLATFORMS_FALLBACK);
  const [tones, setTones] = useState<string[]>(COMMUNITY_TONES_FALLBACK);
  const [cost, setCost] = useState(50);
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<CommunityPostVariant[]>([]);
  const [bestTime, setBestTime] = useState<CommunityBestTime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const data = await api<{ platforms: CommunityPlatformMeta[]; tones: string[]; cost: number }>(
          "/api/community-post-platforms",
          token,
        );
        if (Array.isArray(data.platforms) && data.platforms.length > 0) setPlatforms(data.platforms);
        if (Array.isArray(data.tones) && data.tones.length > 0) {
          setTones(data.tones);
          if (!data.tones.includes(tone)) setTone(data.tones[0]!);
        }
        if (typeof data.cost === "number") setCost(data.cost);
      } catch {
        /* fall back to the hardcoded platform/tone lists */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    if (loading || topic.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const data = await api<{ posts: CommunityPostVariant[]; bestTime: CommunityBestTime }>(
        "/api/generate-community-post",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            topic: topic.trim(),
            platform,
            tone,
            cta: cta.trim() || undefined,
            niche: niche.trim() || undefined,
          }),
        },
      );
      setVariants(data.posts);
      setBestTime(data.bestTime);
      refreshProfile();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "out_of_credits") props.onOutOfCredits();
      else setError(err instanceof Error ? err.message : t("scheduler.communityPosts.failed"));
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: t("scheduler.communityPosts.copied") }),
      () => toast({ title: t("scheduler.communityPosts.failed"), variant: "destructive" }),
    );
  }

  const activeLimit = platforms.find((p) => p.id === platform)?.charLimit ?? 280;

  return (
    <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-primary" />
        <h2 className="font-display text-2xl font-black">{t("scheduler.communityPosts.title")}</h2>
        <span className="ml-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
          {t("scheduler.communityPosts.badge")}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-white/55">
        {t("scheduler.communityPosts.desc", { cost })}
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelClass}>{t("scheduler.communityPosts.topic")}</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder={t("scheduler.communityPosts.topicPlaceholder")}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("scheduler.communityPosts.platform")}</label>
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  platform === p.id
                    ? "bg-primary text-black"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                {p.label}
                <span className="ml-1.5 opacity-60">{p.charLimit}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("scheduler.communityPosts.tone")}</label>
          <div className="flex flex-wrap gap-2">
            {tones.map((tn) => (
              <button
                key={tn}
                onClick={() => setTone(tn)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold capitalize transition ${
                  tone === tn
                    ? "bg-primary text-black"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                {tn}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>{t("scheduler.communityPosts.cta")}</label>
          <input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            maxLength={160}
            placeholder={t("scheduler.communityPosts.ctaPlaceholder")}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t("scheduler.communityPosts.niche")}</label>
          <input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            maxLength={60}
            placeholder={t("scheduler.communityPosts.nichePlaceholder")}
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-6">
        <Button
          onClick={handleGenerate}
          disabled={loading || topic.trim().length < 2}
          className="bg-primary font-bold text-black hover:bg-primary/90"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {loading ? t("scheduler.communityPosts.generating") : t("scheduler.communityPosts.generate")}
        </Button>
      </div>

      {variants.length > 0 && (
        <div className="mt-8">
          <p className="text-sm text-white/55">{t("scheduler.communityPosts.generated")}</p>
          {bestTime && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="text-sm">
                <p className="font-bold text-white">
                  {t("scheduler.communityPosts.bestTime")}: {bestTime.day} · {bestTime.time}
                </p>
                <p className="mt-1 text-white/55">{bestTime.reason}</p>
              </div>
            </div>
          )}
          <div className="mt-4 grid gap-4">
            {variants.map((v, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                    {t("scheduler.communityPosts.variants", { num: i + 1 })}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      v.charCount <= (v.limit || activeLimit)
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {t("scheduler.communityPosts.charCount", { num: v.charCount, limit: v.limit || activeLimit })}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">{v.text}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => props.onSchedulePost(v.text)}
                    className="bg-primary font-bold text-black hover:bg-primary/90"
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {t("scheduler.communityPosts.scheduleThis")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleCopy(v.text)} className="border-white/15 text-white/70 hover:bg-white/5">
                    <Copy className="mr-2 h-4 w-4" />
                    {t("scheduler.communityPosts.copy")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Composer modal ───────────────────────────────────────────────────── */

/* ─── Best time to post optimizer ─────────────────────────────────────────
   Benchmark-powered 7-day heatmaps per platform (gold intensity = score),
   honest benchmark-vs-your-data labeling, a best-next-slot "ride the wave"
   chip, shareable schedule links carrying the creator's referral code, and
   click-any-slot → composer prefilled with that datetime.

   Handoff chain: optimizer slot → composer prefilled → scheduled post →
   (designed next step) posted-post engagement feeds back into
   /api/best-time `analytics`, auto-personalizing future optimizations. */

function BestTimeOptimizer(props: {
  timezone: string;
  onUseSlot: (date: string, time: string, platform?: string) => void;
  onOutOfCredits: () => void;
}) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const { project: hubProject } = useHubProject();
  const { timezone, onUseSlot, onOutOfCredits } = props;

  /* Niche prefilled from the hub project concept when available. */
  const hubConcept = useMemo(() => (hubProject?.concept ?? "").trim().slice(0, 60), [hubProject]);
  const [niche, setNiche] = useState(() => hubConcept || "music");
  const nicheTouched = useRef(false);
  useEffect(() => {
    if (!nicheTouched.current && hubConcept && niche === "music") setNiche(hubConcept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubConcept]);

  const [btPlatforms, setBtPlatforms] = useState<BestTimePlatformKey[]>(["tiktok", "instagram"]);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BestTimeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const todayStr = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }, []);
  const nowHour = useMemo(() => new Date().getHours(), []);

  async function handleOptimize() {
    if (loading || btPlatforms.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setShareLink(null);
    try {
      const res = await confirmedFetch("/api/best-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platforms: btPlatforms,
          niche: niche.trim() || undefined,
          postsPerWeek,
          timezone,
          /* Analytics feedback loop (designed next step): once posted-post
             engagement is recorded, feed [{platform, postedAt, engagement}]
             here to auto-personalize. Empty today → honest benchmarks. */
          analytics: [],
        }),
      });
      if (!res) return; /* user cancelled the credit confirmation */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        if (res.status === 402 || (data as { code?: string }).code === "out_of_credits" || data.error === "out_of_credits") {
          onOutOfCredits();
          return;
        }
        throw new Error(typeof data.message === "string" ? data.message : t("scheduler.bestTime.failed"));
      }
      setResult(data as unknown as BestTimeResult);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("scheduler.bestTime.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    if (!result || shareBusy) return;
    setShareBusy(true);
    try {
      /* The sharer's referral code rides along — every posted schedule is organic reach. */
      let code = "";
      try {
        const token = await getAccessToken();
        const r = await fetch("/api/referrals/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = (await r.json().catch(() => ({}))) as { code?: unknown };
        if (r.ok && typeof d.code === "string") code = d.code;
      } catch {
        /* the link still works without a referral code */
      }
      const payload: SharedSchedule = {
        n: niche.trim() || "creator",
        s: result.slots.slice(0, 5).map((s) => ({ d: s.date, t: s.time, p: s.platform, s: s.score, r: s.reason })),
      };
      const link = `${window.location.origin}/scheduler?shared=${encodeSharedSchedule(payload)}${
        code ? `&ref=${encodeURIComponent(code)}` : ""
      }`;
      setShareLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      } catch {
        /* clipboard unavailable — the link is shown below for manual copy */
      }
      toast({ title: t("scheduler.bestTime.linkReady") });
    } finally {
      setShareBusy(false);
    }
  }

  function copyShareLink() {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      },
      () => toast({ title: t("scheduler.bestTime.copyFailed"), variant: "destructive" }),
    );
  }

  const best = result?.slots[0] ?? null;
  const topSlots = result ? result.slots.slice(0, Math.max(1, Math.min(6, postsPerWeek))) : [];

  return (
    <section
      id="best-time-optimizer"
      data-min-stars="3"
      className="relative mt-14 scroll-mt-24 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10"
    >
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[480px] -translate-x-1/2 rounded-full bg-yellow-600/10 blur-[100px]"
        aria-hidden="true"
      />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <Clock3 className="h-5 w-5 text-primary" />
          <h2 className="font-display text-2xl font-black">{t("scheduler.bestTime.title")}</h2>
          <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            75 {t("scheduler.bestTime.bucs")}
          </span>
          {result?.aiNicheTuning && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/60">
              <Sparkles className="h-3 w-3 text-primary" /> {t("scheduler.bestTime.nicheTuned")}
            </span>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-white/55">{t("scheduler.bestTime.desc")}</p>

        <div className="mt-6">
          <label className={labelClass}>{t("scheduler.bestTime.niche")}</label>
          <div className="flex flex-wrap gap-2">
            {NICHE_PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => {
                  nicheTouched.current = true;
                  setNiche(n);
                }}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  niche === n
                    ? "bg-primary text-black"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                {t(`scheduler.niches.${n}`)}
              </button>
            ))}
          </div>
          <input
            value={niche}
            onChange={(e) => {
              nicheTouched.current = true;
              setNiche(e.target.value.slice(0, 60));
            }}
            maxLength={60}
            placeholder={t("scheduler.bestTime.customNichePlaceholder")}
            className={`${inputClass} mt-3 max-w-xs`}
          />
        </div>

        <div className="mt-4">
          <label className={labelClass}>{t("scheduler.bestTime.platforms")}</label>
          <div className="flex flex-wrap gap-2">
            {BT_PLATFORM_META.map(({ key, icon: Icon, label }) => {
              const on = btPlatforms.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => setBtPlatforms((p) => (on ? p.filter((x) => x !== key) : [...p, key]))}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                    on
                      ? "bg-primary text-black"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-4">
          <div>
            <label className={labelClass}>{t("scheduler.bestTime.postsPerWeek")}</label>
            <input
              type="number"
              min={1}
              max={14}
              value={postsPerWeek}
              onChange={(e) => setPostsPerWeek(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
              className="w-20 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
            />
          </div>
          <Button
            onClick={handleOptimize}
            disabled={loading || btPlatforms.length === 0}
            className="bg-primary font-bold text-black hover:bg-primary/90"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {loading ? t("scheduler.bestTime.optimizing") : t("scheduler.bestTime.optimize")}
          </Button>
          {result && (
            <Button
              variant="outline"
              onClick={handleShare}
              disabled={shareBusy}
              className="border-primary/40 text-primary hover:bg-primary/10"
            >
              {shareBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
              {t("scheduler.bestTime.share")}
            </Button>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {shareLink && (
          <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">{t("scheduler.bestTime.shareLinkLabel")}</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input readOnly value={shareLink} onFocus={(e) => e.target.select()} className={`${inputClass} font-mono text-[12px]`} />
              <Button size="sm" onClick={copyShareLink} className="shrink-0 bg-primary font-bold text-black hover:bg-primary/90">
                <Link2 className="mr-2 h-4 w-4" /> {copied ? t("scheduler.bestTime.copied") : t("scheduler.bestTime.copyLink")}
              </Button>
            </div>
            <p className="mt-2 text-[12px] text-white/45">{t("scheduler.bestTime.shareHint")}</p>
          </div>
        )}

        {result && (
          <>
            {/* best-next slot — ride the wave */}
            {best && (
              <div className="mt-8 overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent p-5 md:p-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                  {t("scheduler.bestTime.bestNext")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-display text-3xl font-black text-white">
                    {prettyDay(best.date)} <span className="text-primary">{prettyTime(best.time)}</span>
                  </span>
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                    {btPlatformLabel(best.platform)}
                  </span>
                  <span className="rounded-full border border-primary/30 px-2.5 py-0.5 text-[11px] font-bold text-white/60">
                    {t("scheduler.bestTime.score", { num: best.score })}
                  </span>
                  {best.source === "personalized" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                      <TrendingUp className="h-3 w-3" /> {t("scheduler.bestTime.yourData")}
                    </span>
                  )}
                </div>
                <p className="mt-2 max-w-2xl text-sm text-white/60">{best.reason}</p>
                <Button
                  className="mt-4 bg-primary font-bold text-black hover:bg-primary/90"
                  onClick={() => onUseSlot(best.date, best.time, best.platform)}
                >
                  <CalendarDays className="mr-2 h-4 w-4" /> {t("scheduler.bestTime.scheduleAtThisTime")}
                </Button>
              </div>
            )}

            {/* honest labeling legend */}
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/50">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-primary/80" aria-hidden="true" />{" "}
                {t("scheduler.bestTime.legendBenchmark")}
              </span>
              {result.personalized && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm ring-2 ring-emerald-400" aria-hidden="true" />{" "}
                  {t("scheduler.bestTime.legendPersonalized")}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-3xl text-[12px] italic leading-relaxed text-white/35">{result.benchmarkNote}</p>

            {/* top slots */}
            <h3 className="mt-8 font-display text-lg font-black">{t("scheduler.bestTime.topSlots")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topSlots.map((s, i) => (
                <div
                  key={`${s.platform}-${s.date}-${s.time}`}
                  className="rounded-2xl border border-white/10 bg-black/40 p-4 transition hover:border-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{prettyDay(s.date)}</span>
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                      {btPlatformLabel(s.platform)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <p className="font-display text-xl font-black text-primary">{prettyTime(s.time)}</p>
                    <span className="text-[11px] font-bold text-white/40">{t("scheduler.bestTime.score", { num: s.score })}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-white/55">{s.reason}</p>
                  <div className="mt-2">
                    {s.source === "personalized" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                        <TrendingUp className="h-3 w-3" /> {t("scheduler.bestTime.yourData")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary/80">
                        {t("scheduler.bestTime.benchmark")}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 border-primary/40 text-primary hover:bg-primary/10"
                    onClick={() => onUseSlot(s.date, s.time, s.platform)}
                  >
                    {t("scheduler.bestTime.useSlot")}
                  </Button>
                </div>
              ))}
            </div>

            {/* 7-day heatmaps */}
            <h3 className="mt-10 font-display text-lg font-black">{t("scheduler.bestTime.heatmapTitle")}</h3>
            <p className="mt-1 text-[13px] text-white/45">{t("scheduler.bestTime.heatmapHint")}</p>
            {btPlatforms.map(
              (p) =>
                result.heatmap[p] && (
                  <div key={p} className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      {(() => {
                        const Icon = BT_PLATFORM_META.find((m) => m.key === p)?.icon ?? Camera;
                        return <Icon className="h-4 w-4 text-primary" />;
                      })()}
                      <span className="text-sm font-bold text-white">{btPlatformLabel(p)}</span>
                    </div>
                    <div className="overflow-x-auto pb-1">
                      <div className="min-w-[680px]">
                        <div className="grid gap-1" style={{ gridTemplateColumns: "76px repeat(24, minmax(0, 1fr))" }}>
                          <div />
                          {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="text-center text-[9px] font-semibold uppercase tracking-wide text-white/30">
                              {h % 3 === 0 ? hourLabel(h) : ""}
                            </div>
                          ))}
                        </div>
                        {result.heatmap[p]!.dates.map((date, di) => (
                          <div
                            key={date}
                            className="mt-1 grid items-center gap-1"
                            style={{ gridTemplateColumns: "76px repeat(24, minmax(0, 1fr))" }}
                          >
                            <div className="pr-1 text-right text-[11px] font-bold leading-9 text-white/60">{prettyDay(date)}</div>
                            {result.heatmap[p]!.scores[di]!.map((score, h) => {
                              const past = date < todayStr || (date === todayStr && h <= nowHour);
                              const isPersonal = result.heatmap[p]!.personalized[di]![h] ?? false;
                              const hh = String(h).padStart(2, "0");
                              return (
                                <button
                                  key={h}
                                  type="button"
                                  disabled={past}
                                  title={`${prettyDay(date)} ${prettyTime(`${hh}:00`)} · ${t("scheduler.bestTime.score", {
                                    num: score,
                                  })}${isPersonal ? ` · ${t("scheduler.bestTime.yourData")}` : ""}`}
                                  onClick={() => onUseSlot(date, `${hh}:00`, p)}
                                  aria-label={`${prettyDay(date)} ${prettyTime(`${hh}:00`)} — ${t("scheduler.bestTime.score", {
                                    num: score,
                                  })}`}
                                  className={`h-9 rounded-md transition ${
                                    past ? "cursor-default opacity-20" : "hover:scale-110 hover:ring-2 hover:ring-white/60"
                                  }`}
                                  style={{
                                    backgroundColor: `rgba(212, 175, 55, ${(0.06 + (score / 100) * 0.88).toFixed(2)})`,
                                    boxShadow: isPersonal ? "inset 0 0 0 2px rgba(52, 211, 153, 0.85)" : undefined,
                                  }}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ),
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ─── Public shared-schedule view ─────────────────────────────────────────
   Rendered for /scheduler?shared=<payload>&ref=<CODE> — no login required,
   so creators can post their schedule anywhere. The ref code in the URL is
   the sharer's referral code (organic reach with attribution). */

function SharedScheduleView(props: { shared: SharedSchedule; ctaHref: string; ctaLabel: string }) {
  const { t } = useTranslation();
  const { shared, ctaHref, ctaLabel } = props;
  const best = shared.s[0]!;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-b from-[#1a1408] via-black to-black p-6 md:p-10">
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[480px] -translate-x-1/2 rounded-full bg-yellow-600/15 blur-[100px]"
        aria-hidden="true"
      />
      <div className="relative">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
          <CalendarDays className="h-3 w-3" aria-hidden="true" /> {t("scheduler.shared.badge")}
        </p>
        <h2 className="mt-4 font-display text-3xl font-black tracking-tight md:text-4xl">
          {t("scheduler.shared.headline", { niche: shared.n })}
        </h2>
        <p className="mt-2 max-w-xl text-sm text-white/55">{t("scheduler.shared.sub")}</p>

        <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/[0.07] p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">{t("scheduler.bestTime.bestNext")}</p>
          <p className="mt-1 font-display text-2xl font-black text-white">
            {prettyDay(best.d)} <span className="text-primary">{prettyTime(best.t)}</span>
            <span className="ml-3 align-middle text-sm font-bold uppercase tracking-wide text-white/50">
              {btPlatformLabel(best.p)}
            </span>
          </p>
          <p className="mt-1 text-sm text-white/55">{best.r}</p>
        </div>

        <div className="mt-2 divide-y divide-white/5">
          {shared.s.slice(1).map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-bold text-white">
                  {prettyDay(s.d)} · <span className="text-primary">{prettyTime(s.t)}</span>
                </p>
                <p className="text-[12px] text-white/45">{btPlatformLabel(s.p)}</p>
              </div>
              <span className="font-display text-lg font-black text-primary/90">{s.s}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[12px] italic text-white/35">{t("scheduler.shared.honesty")}</p>

        <Button asChild className="mt-6 bg-primary font-bold text-black hover:bg-primary/90">
          <a href={ctaHref}>{ctaLabel}</a>
        </Button>
        <p className="mt-3 text-[11px] uppercase tracking-widest text-white/30">{t("scheduler.shared.powered")}</p>
      </div>
    </div>
  );
}

function ComposerModal(props: {
  post: ScheduledPostShape | null;
  prefill: { date: string; time: string } | null;
  captionPrefill: string | null;
  mediaPrefill: string | null;
  platformPrefill: SchedulerPlatformKey[] | null;
  accounts: SocialAccountInfo[];
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
  onOutOfCredits: () => void;
}) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { post, prefill } = props;
  const isEdit = !!post;
  /* Spine: project-level attribution + referral link flow into published
     captions (default ON, toggleable from the Hub). */
  const { project: hubProject, getShareLink } = useHubProject();

  const [mediaRef, setMediaRef] = useState(post?.mediaUrl ?? props.mediaPrefill ?? "");
  const [previewUrl, setPreviewUrl] = useState(() => {
    const initial = post?.mediaUrl ?? props.mediaPrefill ?? "";
    return initial && !initial.startsWith("supabase://") ? initial : "";
  });
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState(post?.caption ?? props.captionPrefill ?? "");
  const [hashtags, setHashtags] = useState(post?.hashtags ?? "");
  const [platforms, setPlatforms] = useState<SchedulerPlatformKey[]>(post?.platforms ?? props.platformPrefill ?? ["instagram"]);
  const [accountIds, setAccountIds] = useState<Partial<Record<SchedulerPlatformKey, string>>>(post?.accountIds ?? {});
  const [date, setDate] = useState(() => {
    if (post?.scheduledAt) return toLocalDate(new Date(post.scheduledAt));
    return prefill?.date ?? todayLocal();
  });
  const [time, setTime] = useState(() => {
    if (post?.scheduledAt) return timeLocal(new Date(post.scheduledAt));
    return prefill?.time ?? "18:00";
  });
  const [saving, setSaving] = useState(false);
  const [aiCaptionLoading, setAiCaptionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const usableAccounts = useMemo(() => props.accounts.filter((a) => !a.expired), [props.accounts]);

  function togglePlatform(p: SchedulerPlatformKey) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setError(t("scheduler.error.videoOnly"));
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("clip", file);
      const res = await fetch("/api/upload-clip", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; ref?: string; error?: string; message?: string };
      if (!res.ok || !data.ref) throw new Error(data.message || data.error || t("scheduler.error.uploadFailed"));
      /* Persist the stable storage ref (never expires); preview with the signed URL. */
      setMediaRef(data.ref);
      setPreviewUrl(data.url ?? "");
      toast({ title: t("scheduler.toast.videoUploaded"), description: t("scheduler.toast.readyToSchedule") });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("scheduler.error.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleAiCaption() {
    if (aiCaptionLoading) return;
    setAiCaptionLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const data = await api<{ hooks?: { hook?: string }[] }>(
        "/api/hook-studio",
        token,
        {
          method: "POST",
          body: JSON.stringify({ mode: "hooks", videoType: "promo", topic: caption.slice(0, 120) || "my latest video drop" }),
        },
      );
      const hook = data.hooks?.[0]?.hook;
      if (hook) {
        setCaption((c) => (c ? `${c}\n\n${hook}` : hook));
        refreshProfile();
      } else {
        throw new Error(t("scheduler.toast.noCaption"));
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "out_of_credits") props.onOutOfCredits();
      else setError(err instanceof Error ? err.message : t("scheduler.toast.aiCaptionFailed"));
    } finally {
      setAiCaptionLoading(false);
    }
  }

  function validate(forSchedule: boolean): string | null {
    if (!mediaRef) return t("scheduler.error.noVideo");
    if (platforms.length === 0) return t("scheduler.error.noPlatform");
    const missing = platforms.filter((p) => !accountIds[p]);
    if (missing.length > 0) {
      const labels = missing.map((p) => t(`scheduler.platforms.${p}.label`)).join(", ");
      return t("scheduler.error.noAccount", { platforms: labels });
    }
    if (forSchedule && !isFutureLocal(date, time)) return t("scheduler.error.futureTime");
    return null;
  }

  async function save(forSchedule: boolean) {
    const problem = validate(forSchedule);
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      const token = await getAccessToken();
      const scheduledAt = forSchedule ? combineLocalDateTime(date, time)!.toISOString() : null;
      /* Spine: published posts carry the project's "Made with" credit + the
         creator's referral link (earning loop). Drafts stay clean; the line
         is added once — never duplicated on re-edits. */
      let finalCaption = caption.trim();
      if (forSchedule && hubProject.attribution && !finalCaption.includes("Made with Bow Down Visuals")) {
        finalCaption = `${finalCaption}\n\nMade with Bow Down Visuals\n${getShareLink()}`.trim();
      }
      const payload = {
        mediaUrl: mediaRef,
        mediaType: "video",
        caption: finalCaption,
        hashtags: normalizeHashtags(hashtags),
        platforms,
        accountIds,
        scheduledAt,
      };
      if (isEdit) {
        await api(`/api/scheduler/posts/${post!.id}`, token, { method: "PATCH", body: JSON.stringify(payload) });
        toast({
          title: forSchedule ? t("scheduler.toast.scheduled") : t("scheduler.toast.draftSaved"),
          description: forSchedule && scheduledAt ? prettyDateTime(scheduledAt) : undefined,
        });
      } else {
        await api("/api/scheduler/posts", token, { method: "POST", body: JSON.stringify(payload) });
        toast({
          title: forSchedule ? t("scheduler.toast.scheduledCost") : t("scheduler.toast.draftSaved"),
          description: forSchedule && scheduledAt ? t("scheduler.toast.scheduledDesc", { datetime: prettyDateTime(scheduledAt) }) : t("scheduler.toast.draftsFree"),
        });
      }
      props.onSaved();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "out_of_credits" || (err as { status?: number }).status === 402) {
        props.onOutOfCredits();
        setError(t("scheduler.toast.notEnoughCredits"));
      } else {
        setError(err instanceof Error ? err.message : t("scheduler.toast.couldntSave"));
      }
    } finally {
      setSaving(false);
    }
  }

  const showTikTokNote = platforms.includes("tiktok");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" onClick={props.onClose}>
      <div
        className="relative my-8 w-full max-w-2xl overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={props.onClose} className="absolute right-4 top-4 rounded-lg p-2 text-white/50 hover:text-white" aria-label={t("scheduler.composer.close")}>
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-display text-2xl font-black">
          {isEdit ? (post!.status === "draft" ? t("scheduler.composer.scheduleDraft") : t("scheduler.composer.editPost")) : t("scheduler.composer.newPost")}
        </h2>
        <p className="mt-1 text-[13px] text-white/45">
          {isEdit && post!.status === "scheduled"
            ? t("scheduler.composer.changesInstant")
            : t("scheduler.composer.costNote")}
        </p>

        {!isEdit && (
          <ProjectFlowBar
            kinds={["clip", "video"]}
            actionLabel="Schedule it"
            onPick={(asset) => {
              if (!/^https:\/\//.test(asset.url)) {
                toast({ title: t("scheduler.toast.needsHosted"), description: t("scheduler.toast.hostedDesc") });
                return;
              }
              setMediaRef(asset.url);
              setPreviewUrl(asset.url);
            }}
          />
        )}

        {/* media */}
        <div className="mt-6">
          <label className={labelClass}>{t("scheduler.composer.video")}</label>
          {previewUrl || mediaRef ? (
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
              {previewUrl ? (
                <video src={previewUrl} controls playsInline className="max-h-64 w-full object-contain" />
              ) : (
                <div className="flex h-32 items-center justify-center gap-2 text-sm text-white/50">
                  <Video className="h-5 w-5 text-primary/60" /> {t("scheduler.composer.noPreview")}
                </div>
              )}
              <button
                onClick={() => { setMediaRef(""); setPreviewUrl(""); }}
                className="absolute right-3 top-3 rounded-lg bg-black/70 p-2 text-white/70 hover:text-white"
                aria-label={t("scheduler.composer.removeVideo")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/[0.02] px-6 py-10 text-white/50 transition hover:border-primary/50 hover:text-white"
            >
              {uploading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-primary/70" />}
              <span className="text-sm font-semibold">{uploading ? t("scheduler.composer.uploading") : t("scheduler.composer.uploadCta")}</span>
              <span className="text-[12px] text-white/35">{t("scheduler.composer.uploadNote")}</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
        </div>

        {/* caption */}
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between">
            <label className={`${labelClass} mb-0`}>{t("scheduler.composer.caption")}</label>
            <button
              onClick={handleAiCaption}
              disabled={aiCaptionLoading}
              data-min-stars="2"
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1 text-[12px] font-bold text-primary transition hover:bg-primary/10"
              title={t("scheduler.composer.aiCaptionTitle")}
            >
              {aiCaptionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t("scheduler.composer.aiCaption")}
            </button>
          </div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 5000))}
            rows={4}
            placeholder={t("scheduler.composer.captionPlaceholder")}
            className={`${inputClass} resize-y`}
          />
          {hubProject.attribution ? (
            <p className="mt-1.5 text-[11px] text-white/35">
              {t("hubSpine.madeWith")} · {t("scheduler.composer.attributionNote")}{" "}
              <a href="/hub" className="text-primary/80 hover:underline">{t("scheduler.composer.attributionChange")}</a>
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <label className={labelClass}>{t("scheduler.composer.hashtags")}</label>
          <input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#sharkking #newmusic"
            className={inputClass}
          />
        </div>

        {/* platforms */}
        <div className="mt-5">
          <label className={labelClass}>{t("scheduler.composer.platforms")}</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {PLATFORM_OPTS.map(({ key, icon: Icon }) => {
              const on = platforms.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => togglePlatform(key)}
                  className={`rounded-2xl border p-3 text-left transition ${
                    on ? "border-primary bg-primary/10" : "border-white/10 bg-white/[0.02] hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${on ? "text-primary" : "text-white/50"}`} />
                    <span className={`text-sm font-bold ${on ? "text-white" : "text-white/60"}`}>{t(`scheduler.platforms.${key}.label`)}</span>
                    {on && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
                  </div>
                  <p className="mt-1 text-[11px] text-white/40">{t(`scheduler.platforms.${key}.sub`)}</p>
                </button>
              );
            })}
          </div>
          {showTikTokNote && (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-white/45">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
              {t("scheduler.composer.tiktokNote")}
            </p>
          )}
        </div>

        {/* accounts */}
        {platforms.length > 0 && (
          <div className="mt-4 space-y-3">
            {platforms.map((p) => {
              const opts = usableAccounts.filter((a) => a.platform === p);
              const label = t(`scheduler.platforms.${p}.label`);
              return (
                <div key={p}>
                  <label className={labelClass}>{t("scheduler.composer.accountLabel", { platform: label })}</label>
                  {opts.length === 0 ? (
                    <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] text-amber-200/90">
                      {t("scheduler.composer.noAccount1", { platform: label })}{" "}
                      <a href="/dashboard" className="font-bold underline">{t("scheduler.composer.noAccountLink")}</a>{t("scheduler.composer.noAccount2")}
                    </p>
                  ) : (
                    <select
                      value={accountIds[p] ?? ""}
                      onChange={(e) => setAccountIds((cur) => ({ ...cur, [p]: e.target.value }))}
                      className={`${inputClass} appearance-none`}
                    >
                      <option value="" disabled>{t("scheduler.composer.chooseAccount")}</option>
                      {opts.map((a) => (
                        <option key={a.id} value={a.id} className="bg-black">
                          {a.usernameMasked || a.pageName || a.platform}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* schedule time */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("scheduler.composer.date")}</label>
            <input type="date" value={date} min={todayLocal()} onChange={(e) => setDate(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
          </div>
          <div>
            <label className={labelClass}>{t("scheduler.composer.time")}</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
          </div>
        </div>
        <p className="mt-2 text-[12px] text-white/35">
          {t("scheduler.composer.timezoneNote", { tz: props.timezone })}
        </p>

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-200">{error}</p>
        )}

        {/* actions */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            onClick={() => save(true)}
            disabled={saving || uploading}
            className="flex-1 bg-primary py-6 font-black text-black hover:bg-primary/90"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock3 className="mr-2 h-4 w-4" />}
            {isEdit && post!.status === "scheduled" ? t("scheduler.composer.saveChanges") : t("scheduler.composer.scheduleButton")}
          </Button>
          {(!isEdit || post!.status === "draft") && (
            <Button
              onClick={() => save(false)}
              disabled={saving || uploading}
              variant="outline"
              className="border-white/20 py-6 text-white hover:bg-white/5"
            >
              {t("scheduler.composer.saveDraft")}
            </Button>
          )}
        </div>
        {isEdit && post!.status === "scheduled" && (
          <button
            onClick={() => {
              /* Unschedule → back to a free draft (reservation refunded server-side). */
              setSaving(true);
              setError(null);
              getAccessToken()
                .then((token) => api(`/api/scheduler/posts/${post!.id}`, token, { method: "PATCH", body: JSON.stringify({ scheduledAt: null }) }))
                .then(() => props.onSaved())
                .catch((err: unknown) => { setError(err instanceof Error ? err.message : t("scheduler.toast.couldntUnschedule")); setSaving(false); });
            }}
            className="mt-3 text-[13px] font-semibold text-white/45 underline-offset-2 hover:text-white hover:underline"
          >
            {t("scheduler.composer.unschedule")}
          </button>
        )}
      </div>
    </div>
  );
}
