import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, Clock3, Loader2, Sparkles, Plus, X, Upload, Video,
  Camera, Music2, ThumbsUp, Trash2, Pencil, CheckCircle2, XCircle,
  AlertTriangle, ChevronLeft, ChevronRight, Wand2, ListVideo, Inbox,
  History, GripVertical, RefreshCw, ExternalLink,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import { Button } from "@/components/ui/button";
import type { SocialAccountInfo } from "@/components/ConnectedAccounts";
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
   - AI best-time suggestions: 1 credit (refunded if the AI fails).
   - TikTok posts land in your TikTok drafts inbox — TikTok's API can't
     publish straight to your feed, so you finish the post in TikTok. */

type Tab = "calendar" | "queue" | "drafts" | "posted";

interface PlatformOpt {
  key: SchedulerPlatformKey;
  label: string;
  sub: string;
  icon: LucideIcon;
}

const PLATFORM_OPTS: PlatformOpt[] = [
  { key: "instagram", label: "Instagram", sub: "Reels", icon: Camera },
  { key: "tiktok", label: "TikTok", sub: "Video → your drafts", icon: Music2 },
  { key: "facebook", label: "Facebook", sub: "Page video", icon: ThumbsUp },
];

const NICHE_PRESETS = ["Music", "Gaming", "Comedy", "Fitness", "Beauty", "Tech", "Education", "Lifestyle"];

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

interface BestTimeSlot {
  date: string;
  time: string;
  platform: SchedulerPlatformKey;
  reason: string;
}

export default function Scheduler() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("calendar");
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

  /* best-time */
  const [niche, setNiche] = useState("Music");
  const [btPlatforms, setBtPlatforms] = useState<SchedulerPlatformKey[]>(["instagram", "tiktok"]);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [btLoading, setBtLoading] = useState(false);
  const [slots, setSlots] = useState<BestTimeSlot[]>([]);
  const [btNote, setBtNote] = useState("");

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

  function openComposer(post?: ScheduledPostShape, date?: string, time?: string) {
    setEditingPost(post ?? null);
    setPrefill(date ? { date, time: time ?? "18:00" } : null);
    setComposerOpen(true);
  }

  async function handleCancel(post: ScheduledPostShape) {
    if (!window.confirm("Cancel this scheduled post? Your reserved credits will be refunded.")) return;
    try {
      const token = await getAccessToken();
      const data = await api<{ canceled?: boolean; refunded?: number; deleted?: boolean }>(
        `/api/scheduler/posts/${post.id}`,
        token,
        { method: "DELETE" },
      );
      await refresh();
      toast({
        title: data.canceled ? "Post canceled" : "Post deleted",
        description: data.refunded ? `${data.refunded} credit${data.refunded === 1 ? "" : "s"} refunded.` : undefined,
      });
    } catch (err) {
      toast({ title: "Couldn't cancel", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleReschedule(postId: string, targetDate: string) {
    const post = posts.find((p) => p.id === postId);
    if (!post?.scheduledAt) return;
    const moved = movePostToDate(post.scheduledAt, targetDate);
    if (!moved) return;
    if (new Date(moved).getTime() < Date.now() + 60_000) {
      toast({ title: "Can't move it there", description: "Pick a date in the future.", variant: "destructive" });
      return;
    }
    try {
      const token = await getAccessToken();
      await api(`/api/scheduler/posts/${postId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ scheduledAt: moved }),
      });
      await loadPosts();
      toast({ title: "Rescheduled", description: prettyDateTime(moved) });
    } catch (err) {
      toast({ title: "Couldn't reschedule", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleBestTime() {
    if (btLoading) return;
    setBtLoading(true);
    setSlots([]);
    setBtNote("");
    try {
      const token = await getAccessToken();
      const data = await api<{ slots: BestTimeSlot[]; note: string }>(
        "/api/scheduler/best-time",
        token,
        {
          method: "POST",
          body: JSON.stringify({ niche, platforms: btPlatforms, postsPerWeek, timezone }),
        },
      );
      setSlots(data.slots);
      setBtNote(data.note);
      refreshProfile();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "out_of_credits") setOutOfCredits(true);
      else toast({ title: "Best-time failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBtLoading(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white">
        <MarketingNav />
        <main className="mx-auto max-w-3xl px-5 pb-24 pt-24 text-center">
          <h1 className="font-display text-4xl font-black">Content <span className="text-primary">Scheduler</span></h1>
          <p className="mt-4 text-white/55">Sign in to schedule posts across Instagram, TikTok, and Facebook.</p>
          <Button asChild className="mt-8 bg-primary text-black hover:bg-primary/90">
            <a href="/login">Sign in</a>
          </Button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <CalendarDays className="h-3 w-3" aria-hidden="true" /> Post everywhere from one calendar
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Content <span className="text-primary">Scheduler</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Schedule video posts across Instagram Reels, TikTok, and Facebook.
            Server-side and restart-safe — your queue fires even with the tab closed.
          </p>
          <div className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/45">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Drafts &amp; browsing free</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> 1 credit per post to schedule</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Cancel anytime = auto-refund</span>
          </div>
          <div className="mt-6">
            <Button onClick={() => openComposer()} className="bg-primary font-bold text-black hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" /> New scheduled post
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
              { key: "calendar", label: "Calendar", icon: CalendarDays },
              { key: "queue", label: `Queue (${scheduled.length})`, icon: ListVideo },
              { key: "drafts", label: `Drafts (${drafts.length})`, icon: Inbox },
              { key: "posted", label: "Posted", icon: History },
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
            <Loader2 className="mr-3 h-6 w-6 animate-spin" /> Loading your schedule…
          </div>
        ) : (
          <div className="relative mt-8">
            {tab === "calendar" && (
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
          </div>
        )}

        {/* ── AI best-time ── */}
        <section className="relative mt-14 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-display text-2xl font-black">AI best-time suggestions</h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-white/55">
            Tell the AI your niche and rhythm — it suggests the smartest upcoming slots
            across your platforms. <span className="text-white/70 font-semibold">1 credit</span>,
            refunded automatically if the suggestion fails. Suggestions are guidance, not a guarantee.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
            <div>
              <label className={labelClass}>Niche</label>
              <div className="flex flex-wrap gap-2">
                {NICHE_PRESETS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setNiche(n)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                      niche === n
                        ? "bg-primary text-black"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-4">
              <div>
                <label className={labelClass}>Posts / week</label>
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
                onClick={handleBestTime}
                disabled={btLoading || btPlatforms.length === 0}
                className="bg-primary font-bold text-black hover:bg-primary/90"
              >
                {btLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Suggest times · 1 credit
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <label className={labelClass}>Platforms</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTS.map(({ key, label, icon: Icon }) => {
                const on = btPlatforms.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => setBtPlatforms((p) => (on ? p.filter((x) => x !== key) : [...p, key]))}
                    className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                      on ? "bg-primary text-black" : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                );
              })}
            </div>
          </div>
          {slots.length > 0 && (
            <div className="mt-6">
              <p className="text-[13px] italic text-white/45">{btNote}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {slots.map((s, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">
                        {new Date(s.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                        {s.platform}
                      </span>
                    </div>
                    <p className="mt-1 font-display text-xl font-black text-primary">{s.time}</p>
                    <p className="mt-1 text-[13px] text-white/55">{s.reason}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 border-primary/40 text-primary hover:bg-primary/10"
                      onClick={() => {
                        openComposer(undefined, s.date, s.time);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Use this slot
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <SiteFooter />

      {composerOpen && (
        <ComposerModal
          post={editingPost}
          prefill={prefill}
          accounts={accounts}
          timezone={timezone}
          onClose={() => { setComposerOpen(false); setEditingPost(null); setPrefill(null); }}
          onSaved={async () => { setComposerOpen(false); setEditingPost(null); setPrefill(null); await refresh(); }}
          onOutOfCredits={() => setOutOfCredits(true)}
        />
      )}
    </div>
  );
}

/* ─── Calendar tab ─────────────────────────────────────────────────────── */

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
          <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-primary/40 hover:text-white" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => { const n = new Date(); setMonthCursor({ y: n.getFullYear(), m: n.getMonth() }); }}
            className="rounded-lg border border-white/10 px-3 text-[13px] font-semibold text-white/60 hover:border-primary/40 hover:text-white"
          >
            Today
          </button>
          <button onClick={() => shiftMonth(1)} className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-primary/40 hover:text-white" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-bold uppercase tracking-widest text-white/30">{d}</div>
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
              title={isPast ? undefined : "Click to schedule · drop a post here to move it"}
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
                    title={`${prettyDateTime(p.scheduledAt!)} — drag to move, click to edit`}
                  >
                    <GripVertical className="h-3 w-3 shrink-0 opacity-60" />
                    <span className="truncate">
                      {p.platforms.map((pl) => PLATFORM_OPTS.find((o) => o.key === pl)?.label.slice(0, 2)).join("·")}
                      {" "}{new Date(p.scheduledAt!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </button>
                ))}
                {dayPosts.length > 3 && (
                  <div className="px-1 text-[10px] text-white/40">+{dayPosts.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-white/35">
        Click a future day to schedule · drag a post to another day to move it · click a post to edit or cancel.
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
  const sorted = useMemo(
    () => [...props.posts].sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "")),
    [props.posts],
  );
  if (sorted.length === 0) {
    return <EmptyState icon={ListVideo} title="Queue is empty" hint="Schedule a post and it will wait here until it fires — no tab required." />;
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
                    <Icon className="h-3 w-3" /> {opt.label}
                  </span>
                );
              })}
              {p.status === "publishing" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-bold text-blue-300">
                  <Loader2 className="h-3 w-3 animate-spin" /> posting now
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-sm text-white/70">{p.caption || <span className="italic text-white/30">No caption</span>}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-white/45">
              <Clock3 className="h-3.5 w-3.5" />
              {p.scheduledAt ? prettyDateTime(p.scheduledAt) : "—"}
              <span className="font-semibold text-primary">· {p.scheduledAt ? countdownLabel(p.scheduledAt) : ""}</span>
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => props.onEdit(p)}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-primary/40 hover:text-white"
              aria-label="Edit or reschedule"
              title="Edit / reschedule"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => props.onCancel(p)}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-red-500/50 hover:text-red-400"
              aria-label="Cancel (refunds credits)"
              title="Cancel — credits refunded"
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
  if (props.posts.length === 0) {
    return <EmptyState icon={Inbox} title="No drafts" hint="Save a post as a draft while you perfect the caption — drafts are free." />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {props.posts.map((p) => (
        <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <MediaThumb post={p} large />
          <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-white/70">{p.caption || <span className="italic text-white/30">No caption</span>}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.platforms.map((pl) => (
              <span key={pl} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/60">
                {PLATFORM_OPTS.find((o) => o.key === pl)?.label}
              </span>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" className="flex-1 bg-primary font-bold text-black hover:bg-primary/90" onClick={() => props.onSchedule(p)}>
              <Clock3 className="mr-1.5 h-3.5 w-3.5" /> Schedule
            </Button>
            <button
              onClick={() => props.onDelete(p)}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:border-red-500/50 hover:text-red-400"
              aria-label="Delete draft"
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
  const sorted = useMemo(
    () => [...props.posts].sort((a, b) => (b.postedAt ?? b.updatedAt).localeCompare(a.postedAt ?? a.updatedAt)),
    [props.posts],
  );
  if (sorted.length === 0) {
    return <EmptyState icon={History} title="Nothing posted yet" hint="Fired posts land here with per-platform results." />;
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
                  {PLATFORM_OPTS.find((o) => o.key === r.platform)?.label}
                </span>
              ))}
            </div>
            <p className="mt-1.5 truncate text-sm text-white/70">{p.caption || <span className="italic text-white/30">No caption</span>}</p>
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
  const map: Record<string, { label: string; cls: string }> = {
    posted: { label: "Posted", cls: "bg-emerald-500/15 text-emerald-300" },
    failed: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
    canceled: { label: "Canceled", cls: "bg-white/10 text-white/50" },
    publishing: { label: "Posting", cls: "bg-blue-500/15 text-blue-300" },
    scheduled: { label: "Scheduled", cls: "bg-primary/15 text-primary" },
    draft: { label: "Draft", cls: "bg-white/10 text-white/50" },
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

/* ─── Composer modal ───────────────────────────────────────────────────── */

function ComposerModal(props: {
  post: ScheduledPostShape | null;
  prefill: { date: string; time: string } | null;
  accounts: SocialAccountInfo[];
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
  onOutOfCredits: () => void;
}) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { post, prefill } = props;
  const isEdit = !!post;

  const [mediaRef, setMediaRef] = useState(post?.mediaUrl ?? "");
  const [previewUrl, setPreviewUrl] = useState(
    post && !post.mediaUrl.startsWith("supabase://") ? post.mediaUrl : "",
  );
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [hashtags, setHashtags] = useState(post?.hashtags ?? "");
  const [platforms, setPlatforms] = useState<SchedulerPlatformKey[]>(post?.platforms ?? ["instagram"]);
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
      setError("Please choose a video file — the auto-post pipelines publish video.");
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
      if (!res.ok || !data.ref) throw new Error(data.message || data.error || "Upload failed.");
      /* Persist the stable storage ref (never expires); preview with the signed URL. */
      setMediaRef(data.ref);
      setPreviewUrl(data.url ?? "");
      toast({ title: "Video uploaded", description: "Ready to schedule." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
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
        throw new Error("The AI didn't return a caption.");
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "out_of_credits") props.onOutOfCredits();
      else setError(err instanceof Error ? err.message : "AI caption failed.");
    } finally {
      setAiCaptionLoading(false);
    }
  }

  function validate(forSchedule: boolean): string | null {
    if (!mediaRef) return "Upload a video first.";
    if (platforms.length === 0) return "Pick at least one platform.";
    const missing = platforms.filter((p) => !accountIds[p]);
    if (missing.length > 0) {
      const labels = missing.map((p) => PLATFORM_OPTS.find((o) => o.key === p)?.label).join(", ");
      return `Pick a connected account for: ${labels}.`;
    }
    if (forSchedule && !isFutureLocal(date, time)) return "Pick a date and time at least a minute in the future.";
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
      const payload = {
        mediaUrl: mediaRef,
        mediaType: "video",
        caption: caption.trim(),
        hashtags: normalizeHashtags(hashtags),
        platforms,
        accountIds,
        scheduledAt,
      };
      if (isEdit) {
        await api(`/api/scheduler/posts/${post!.id}`, token, { method: "PATCH", body: JSON.stringify(payload) });
        toast({
          title: forSchedule ? "Scheduled" : "Draft saved",
          description: forSchedule && scheduledAt ? prettyDateTime(scheduledAt) : undefined,
        });
      } else {
        await api("/api/scheduler/posts", token, { method: "POST", body: JSON.stringify(payload) });
        toast({
          title: forSchedule ? "Scheduled · 1 credit" : "Draft saved",
          description: forSchedule && scheduledAt ? `${prettyDateTime(scheduledAt)} — cancel anytime for a refund.` : "Drafts are free.",
        });
      }
      props.onSaved();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "out_of_credits" || (err as { status?: number }).status === 402) {
        props.onOutOfCredits();
        setError("Not enough credits — top up to schedule.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn't save the post.");
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
        <button onClick={props.onClose} className="absolute right-4 top-4 rounded-lg p-2 text-white/50 hover:text-white" aria-label="Close">
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-display text-2xl font-black">
          {isEdit ? (post!.status === "draft" ? "Schedule draft" : "Edit scheduled post") : "New scheduled post"}
        </h2>
        <p className="mt-1 text-[13px] text-white/45">
          {isEdit && post!.status === "scheduled"
            ? "Changes save instantly."
            : "Scheduling costs 1 credit per post — charged now, refunded automatically if you cancel."}
        </p>

        {/* media */}
        <div className="mt-6">
          <label className={labelClass}>Video</label>
          {previewUrl || mediaRef ? (
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
              {previewUrl ? (
                <video src={previewUrl} controls playsInline className="max-h-64 w-full object-contain" />
              ) : (
                <div className="flex h-32 items-center justify-center gap-2 text-sm text-white/50">
                  <Video className="h-5 w-5 text-primary/60" /> Video attached — preview unavailable for stored media.
                </div>
              )}
              <button
                onClick={() => { setMediaRef(""); setPreviewUrl(""); }}
                className="absolute right-3 top-3 rounded-lg bg-black/70 p-2 text-white/70 hover:text-white"
                aria-label="Remove video"
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
              <span className="text-sm font-semibold">{uploading ? "Uploading…" : "Click to upload your video"}</span>
              <span className="text-[12px] text-white/35">MP4 / MOV · up to 80 MB · free to upload</span>
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
            <label className={`${labelClass} mb-0`}>Caption</label>
            <button
              onClick={handleAiCaption}
              disabled={aiCaptionLoading}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1 text-[12px] font-bold text-primary transition hover:bg-primary/10"
              title="AI writes a hook for your caption · 1 credit"
            >
              {aiCaptionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              AI caption · 1 credit
            </button>
          </div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 5000))}
            rows={4}
            placeholder="Write your caption…"
            className={`${inputClass} resize-y`}
          />
        </div>

        <div className="mt-4">
          <label className={labelClass}>Hashtags</label>
          <input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#sharkking #newmusic"
            className={inputClass}
          />
        </div>

        {/* platforms */}
        <div className="mt-5">
          <label className={labelClass}>Platforms</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {PLATFORM_OPTS.map(({ key, label, sub, icon: Icon }) => {
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
                    <span className={`text-sm font-bold ${on ? "text-white" : "text-white/60"}`}>{label}</span>
                    {on && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" />}
                  </div>
                  <p className="mt-1 text-[11px] text-white/40">{sub}</p>
                </button>
              );
            })}
          </div>
          {showTikTokNote && (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-white/45">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
              TikTok's API delivers to your drafts inbox — you'll finish the post in TikTok. Instagram and Facebook publish directly.
            </p>
          )}
        </div>

        {/* accounts */}
        {platforms.length > 0 && (
          <div className="mt-4 space-y-3">
            {platforms.map((p) => {
              const opts = usableAccounts.filter((a) => a.platform === p);
              const label = PLATFORM_OPTS.find((o) => o.key === p)?.label;
              return (
                <div key={p}>
                  <label className={labelClass}>{label} account</label>
                  {opts.length === 0 ? (
                    <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] text-amber-200/90">
                      No {label} account connected.{" "}
                      <a href="/dashboard" className="font-bold underline">Connect one in Tools → Social</a> to schedule here.
                    </p>
                  ) : (
                    <select
                      value={accountIds[p] ?? ""}
                      onChange={(e) => setAccountIds((cur) => ({ ...cur, [p]: e.target.value }))}
                      className={`${inputClass} appearance-none`}
                    >
                      <option value="" disabled>Choose account…</option>
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
            <label className={labelClass}>Date</label>
            <input type="date" value={date} min={todayLocal()} onChange={(e) => setDate(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
          </div>
          <div>
            <label className={labelClass}>Time</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
          </div>
        </div>
        <p className="mt-2 text-[12px] text-white/35">
          Times are in your timezone ({props.timezone}). The server fires the post even with this tab closed.
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
            {isEdit && post!.status === "scheduled" ? "Save changes" : "Schedule · 1 credit"}
          </Button>
          {(!isEdit || post!.status === "draft") && (
            <Button
              onClick={() => save(false)}
              disabled={saving || uploading}
              variant="outline"
              className="border-white/20 py-6 text-white hover:bg-white/5"
            >
              Save as free draft
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
                .catch((err: unknown) => { setError(err instanceof Error ? err.message : "Couldn't unschedule."); setSaving(false); });
            }}
            className="mt-3 text-[13px] font-semibold text-white/45 underline-offset-2 hover:text-white hover:underline"
          >
            Unschedule → move back to drafts (refunds 1 credit)
          </button>
        )}
      </div>
    </div>
  );
}
