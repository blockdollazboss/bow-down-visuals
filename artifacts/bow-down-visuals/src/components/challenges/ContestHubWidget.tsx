import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Trophy, Timer, Users, Loader2, Crown, ChevronRight, Rocket,
  BadgeDollarSign, Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { formatBucs, formatBucsShort } from "@/lib/visual-bucs";
import ConfettiBurst from "@/components/artist/confetti-burst";
import { cn } from "@/lib/utils";

/* ─── ContestHubWidget — the weekly creator contest ritual ────────────────
   The addictive weekly heartbeat, docked on the dashboard and the homepage.
   One endpoint (GET /api/challenges/weekly) drives the whole card:

     live/upcoming  → theme, ticking countdown, entry count, prize pool,
                      big "Enter now" CTA → /publish prefilled + auto-entered
     winners        → confetti moment + link to the winners' circle
     no contest     → countdown to Monday's drop + admin-only one-click launch

   Hidden when the user has the retention toggle off (contests_enabled).
   Real votes, real countdowns, real prizes — nothing faked. */

type Lifecycle = "upcoming" | "live" | "judging" | "winners";

interface WeeklyPrize { place: number; prize_credits: number; description: string }

interface WeeklyWinner {
  place: number; prize_credits: number; announced_at: string | null;
  creator: { slug: string | null; display_name: string | null; avatar_url: string | null };
  video: { id: string; title: string; thumbnail_url: string | null };
}

interface WeeklyChallenge {
  slug: string; title: string; hashtag: string; description: string;
  cover_url: string | null; status: Lifecycle; week_key: string;
  starts_at: string | null; ends_at: string | null; judging_ends_at: string | null;
  entry_count: number; prize_pool_credits: number;
  prizes: WeeklyPrize[]; winners: WeeklyWinner[];
}

interface LastWeek {
  week_key: string; challenge_slug: string; challenge_title: string; hashtag: string;
  winners: WeeklyWinner[];
}

interface WeeklyData {
  week_key: string; week_starts_at: string; next_launch_at: string;
  challenge: WeeklyChallenge | null;
  last_week: LastWeek | null;
  week_available: boolean;
  suggested_theme: { title: string; hashtag: string; description: string };
  weekly_cap_vb: number;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Live countdown ticking every second. Null when the target passes. */
function useCountdown(target: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor(ms / 3_600_000) % 24;
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1_000) % 60;
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const MEDAL = ["🥇", "🥈", "🥉"];

export default function ContestHubWidget() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<WeeklyData | null>(null);
  const [prefsOff, setPrefsOff] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/challenges/weekly");
        if (res.ok && !cancelled) setData(await res.json());
      } catch { /* non-fatal: the widget simply doesn't render */ }
    })();
    return () => { cancelled = true; };
  }, []);

  /* Retention toggle: only hide when explicitly switched off. Defaults to
     on, so the widget renders even before the prefs plumbing lands. */
  useEffect(() => {
    if (!user) { setPrefsOff(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/retention/prefs", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const j = await res.json();
          if (!cancelled) setPrefsOff(j.contests_enabled === false);
        }
      } catch { /* default: show */ }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  /* Admin detection — the one-click launch nudge. Same pattern as the app sidebar. */
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/admin/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const j = await res.json();
          if (!cancelled) setIsAdmin(j.isAdmin === true);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  const challenge = data?.challenge ?? null;

  const launchThisWeek = async () => {
    if (launching) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/challenges/weekly-launch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Launch failed");
      const w = await fetch("/api/challenges/weekly");
      if (w.ok) setData(await w.json());
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  if (prefsOff) return null;
  if (!data) return null; // loading or failed — the widget never blocks the page

  const enterHref = challenge
    ? (user
      ? `/publish?type=video&category=video&challenge=${encodeURIComponent(challenge.slug)}&description=${encodeURIComponent(`#${challenge.hashtag} — ${challenge.title}\n`)}`
      : "/login")
    : "/login";

  return (
    <section aria-label={t("weekly_contest.aria", { defaultValue: "Weekly creator contest" })}
      className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.10] via-zinc-950 to-black p-6 md:p-7">
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/3 h-56 w-56 rounded-full bg-primary/[0.14] blur-[90px]" />

      {challenge && (challenge.status === "live" || challenge.status === "upcoming") && (
        <LiveCard data={data} challenge={challenge} enterHref={enterHref} />
      )}

      {challenge && challenge.status === "judging" && (
        <JudgingCard challenge={challenge} />
      )}

      {challenge && challenge.status === "winners" && (
        <WinnersCard challenge={challenge} />
      )}

      {!challenge && data.week_available && (
        <NoContestCard
          data={data} isAdmin={isAdmin} launching={launching}
          launchError={launchError} onLaunch={launchThisWeek}
        />
      )}

      {data.last_week && (!challenge || challenge.status !== "winners") && (
        <LastWeekStrip lastWeek={data.last_week} />
      )}
    </section>
  );
}

/* ─── Live / upcoming: the FOMO driver ──────────────────────────────────── */
function LiveCard({ data, challenge, enterHref }: { data: WeeklyData; challenge: WeeklyChallenge; enterHref: string }) {
  const { t } = useTranslation();
  const target = challenge.status === "upcoming" ? challenge.starts_at : challenge.ends_at;
  const countdown = useCountdown(target);
  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          {challenge.status === "live" && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          )}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">
          {t("weekly_contest.label", { defaultValue: "Weekly creator contest" })}
        </p>
        {countdown && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-black text-primary">
            <Timer className="h-4 w-4" />
            {challenge.status === "upcoming"
              ? t("weekly_contest.drops_in", { defaultValue: "Drops in" })
              : t("weekly_contest.ends_in", { defaultValue: "Ends in" })}{" "}
            {countdown}
          </span>
        )}
      </div>

      <h2 className="mt-3 text-2xl font-black text-white md:text-3xl">{challenge.title}</h2>
      {challenge.description && (
        <p className="mt-1.5 max-w-2xl text-sm text-white/55">{challenge.description}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 text-white/65">
          <Users className="h-4 w-4 text-primary" />
          {t("weekly_contest.entries", { defaultValue: "{{count}} entries", count: fmtCount(challenge.entry_count) })}
        </span>
        {challenge.prize_pool_credits > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3.5 py-1 font-black text-primary">
            <Trophy className="h-4 w-4" /> {formatBucs(challenge.prize_pool_credits)}
          </span>
        )}
        {challenge.prizes.slice(0, 3).map((p) => (
          <span key={p.place} className="inline-flex items-center gap-1 text-xs font-bold text-white/70">
            {MEDAL[p.place - 1] ?? `#${p.place}`} {formatBucsShort(p.prize_credits)}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href={enterHref}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-black text-black shadow-[0_0_30px_rgba(218,165,32,0.35)] hover:brightness-110">
          <Sparkles className="h-5 w-5" />
          {t("weekly_contest.enter_now", { defaultValue: "Enter now" })}
        </Link>
        <Link href={`/challenge/${challenge.slug}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-5 py-3 text-sm font-bold text-white/75 hover:border-primary/50 hover:text-primary">
          {t("weekly_contest.view_entries", { defaultValue: "View entries" })}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <p className="mt-3 text-xs text-white/40">
        {t("weekly_contest.enter_hint", {
          defaultValue: "Post your video and it's auto-entered — winners are paid in Visual Bucs from this week's {{cap}} prize pool.",
          cap: formatBucs(data.weekly_cap_vb),
        })}
      </p>
    </div>
  );
}

/* ─── Judging: entries closed, votes still move the crown ───────────────── */
function JudgingCard({ challenge }: { challenge: WeeklyChallenge }) {
  const { t } = useTranslation();
  const countdown = useCountdown(challenge.judging_ends_at);
  return (
    <div className="relative">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">
        {t("weekly_contest.label", { defaultValue: "Weekly creator contest" })}
      </p>
      <h2 className="mt-3 text-2xl font-black text-white md:text-3xl">
        {t("weekly_contest.judging_title", { defaultValue: "Judging is on — every vote moves the crown" })}
      </h2>
      <p className="mt-1.5 max-w-2xl text-sm text-white/55">
        {t("weekly_contest.judging_sub", {
          defaultValue: "Entries are closed for \"{{title}}\". Rally votes on your favorites — the community crown decides.",
          title: challenge.title,
        })}
      </p>
      {countdown && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-black text-primary">
          <Timer className="h-4 w-4" /> {t("weekly_contest.winners_in", { defaultValue: "Winners in" })} {countdown}
        </p>
      )}
      <div className="mt-5">
        <Link href={`/challenge/${challenge.slug}`}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-black text-black hover:brightness-110">
          <Trophy className="h-5 w-5" />
          {t("weekly_contest.vote_now", { defaultValue: "Vote for the crown" })}
        </Link>
      </div>
    </div>
  );
}

/* ─── Winners: the confetti moment ──────────────────────────────────────── */
function WinnersCard({ challenge }: { challenge: WeeklyChallenge }) {
  const { t } = useTranslation();
  const fresh = challenge.winners.some((w) => {
    if (!w.announced_at) return false;
    return Date.now() - new Date(w.announced_at).getTime() < 48 * 3_600_000;
  });
  const top = [...challenge.winners].sort((a, b) => a.place - b.place).slice(0, 3);
  return (
    <div className="relative">
      {fresh && <ConfettiBurst count={80} />}
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">
        {t("weekly_contest.label", { defaultValue: "Weekly creator contest" })}
      </p>
      <h2 className="mt-3 flex items-center gap-2 text-2xl font-black text-white md:text-3xl">
        <Crown className="h-7 w-7 text-primary" />
        {t("weekly_contest.winners_dropped", { defaultValue: "Winners just dropped" })}
      </h2>
      <p className="mt-1.5 text-sm text-white/55">
        {t("weekly_contest.winners_sub", {
          defaultValue: "\"{{title}}\" is crowned — prizes paid in Visual Bucs.",
          title: challenge.title,
        })}
      </p>
      {top.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {top.map((w) => (
            <span key={w.place} className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] px-4 py-1.5 text-sm font-bold text-white">
              {MEDAL[w.place - 1] ?? `#${w.place}`}
              {w.creator.display_name ? `@${w.creator.display_name}` : t("weekly_contest.a_creator", { defaultValue: "a creator" })}
              {w.prize_credits > 0 && (
                <span className="font-black text-primary">{formatBucsShort(w.prize_credits)}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={`/challenge/${challenge.slug}/winners`}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-black text-black hover:brightness-110">
          <Crown className="h-5 w-5" />
          {t("weekly_contest.see_winners", { defaultValue: "See the winners' circle" })}
        </Link>
        <Link href="/winners"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-5 py-3 text-sm font-bold text-white/75 hover:border-primary/50 hover:text-primary">
          {t("weekly_contest.hall_of_fame", { defaultValue: "Hall of fame" })}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

/* ─── No contest yet: Monday countdown + admin one-click launch ─────────── */
function NoContestCard({
  data, isAdmin, launching, launchError, onLaunch,
}: {
  data: WeeklyData; isAdmin: boolean; launching: boolean;
  launchError: string | null; onLaunch: () => void;
}) {
  const { t } = useTranslation();
  const countdown = useCountdown(data.next_launch_at);
  return (
    <div className="relative">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">
        {t("weekly_contest.label", { defaultValue: "Weekly creator contest" })}
      </p>
      <h2 className="mt-3 text-2xl font-black text-white md:text-3xl">
        {t("weekly_contest.next_drop", { defaultValue: "The next contest drops Monday" })}
      </h2>
      {countdown && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-black text-primary">
          <Timer className="h-4 w-4" /> {countdown}
        </p>
      )}
      <p className="mt-3 max-w-2xl text-sm text-white/55">
        {t("weekly_contest.next_drop_sub", {
          defaultValue: "One theme. One week. {{cap}} in Visual Bucs on the line. Next up: \"{{theme}}\" (#{{hashtag}}).",
          cap: formatBucs(data.weekly_cap_vb),
          theme: data.suggested_theme.title,
          hashtag: data.suggested_theme.hashtag,
        })}
      </p>
      {isAdmin && (
        <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-bold text-amber-200">
            {t("weekly_contest.admin_nudge", {
              defaultValue: "Admin: this week's contest isn't live yet. One tap launches \"{{theme}}\" with the {{cap}} prize pool.",
              theme: data.suggested_theme.title,
              cap: formatBucs(data.weekly_cap_vb),
            })}
          </p>
          <button
            onClick={onLaunch}
            disabled={launching}
            className={cn(
              "mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-black text-black hover:brightness-110",
              launching && "opacity-60",
            )}
          >
            {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {launching
              ? t("weekly_contest.launching", { defaultValue: "Launching…" })
              : t("weekly_contest.launch_week", { defaultValue: "Launch this week's contest" })}
          </button>
          {launchError && <p className="mt-2 text-xs text-red-300">{launchError}</p>}
        </div>
      )}
      <div className="mt-4">
        <Link href="/winners"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
          <BadgeDollarSign className="h-4 w-4" />
          {t("weekly_contest.while_you_wait", { defaultValue: "While you wait: browse the hall of fame" })}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

/* ─── Last week's crowns — the loop never dead-ends ─────────────────────── */
function LastWeekStrip({ lastWeek }: { lastWeek: LastWeek }) {
  const { t } = useTranslation();
  return (
    <div className="mt-5 border-t border-white/10 pt-4">
      <Link href={`/challenge/${lastWeek.challenge_slug}/winners`}
        className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 font-black text-white">
          <Crown className="h-4 w-4 text-primary" />
          {t("weekly_contest.last_week", { defaultValue: "Last week's crowns" })}
        </span>
        {lastWeek.winners.slice(0, 3).map((w) => (
          <span key={w.place} className="text-white/60">
            {MEDAL[w.place - 1] ?? `#${w.place}`} @{w.creator.display_name ?? w.creator.slug ?? "?"}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 font-bold text-primary group-hover:underline">
          {t("weekly_contest.see_all", { defaultValue: "See all" })}
          <ChevronRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}
