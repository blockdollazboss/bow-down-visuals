import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  CalendarDays, Loader2, Sparkles, ArrowRight, CheckCircle2, Camera,
  Music2, Play, Clapperboard, Images, Radio, MessageSquare, Clock3,
  RotateCcw, Stethoscope, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  todayISO,
  calendarSig,
  leadBlankCount,
  postingCount,
  type CalendarPlatformKey,
} from "@/lib/content-calendar";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── AI Content Calendar ────────────────────────────────────────────────
   Creators pick a niche + platforms, GPT-6 builds a 30-day posting
   calendar: every posting day gets a concept, format, platform, hook line,
   and best posting time. 1 credit per calendar. Viewing the grid and
   checking off completed days is free (progress persists in localStorage).
   Platform keys must stay in sync with the backend route's PLATFORMS enum. */

type PlatformKey = CalendarPlatformKey;
type CalendarFormat = "video" | "carousel" | "live" | "story";

interface PlatformOpt {
  key: PlatformKey;
  label: string;
  icon: LucideIcon;
}

const PLATFORM_OPTS: PlatformOpt[] = [
  { key: "tiktok", label: "TikTok", icon: Music2 },
  { key: "youtube", label: "YouTube", icon: Play },
  { key: "instagram", label: "Instagram", icon: Camera },
];

const FORMAT_ICONS: Record<CalendarFormat, LucideIcon> = {
  video: Clapperboard,
  carousel: Images,
  live: Radio,
  story: MessageSquare,
};

const NICHE_PRESETS = [
  "Music", "Gaming", "Comedy", "Fitness",
  "Beauty & Fashion", "Tech", "Education", "Lifestyle",
];

const CREDIT_COST = 1;

interface CalendarDay {
  date: string;
  dayLabel: string;
  post: boolean;
  title: string;
  format: CalendarFormat | "";
  platform: PlatformKey | "";
  hook: string;
  bestTime: string;
}

interface CalendarResponse {
  days?: CalendarDay[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function loadStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ContentCalendar() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [niche, setNiche] = useState("Music");
  const [customNiche, setCustomNiche] = useState("");
  const [platforms, setPlatforms] = useState<PlatformKey[]>(["tiktok", "instagram"]);
  const [postsPerWeek, setPostsPerWeek] = useState("3");
  const [startDate, setStartDate] = useState(todayISO());

  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Retention Doctor handoff: the doctor saves diagnosed fixes to
     localStorage ("bdv-retention-fixes") and deep-links here. This picks
     them up and offers them as an importable fix day. */
  interface RetentionFix {
    at: string;
    dropPct: number;
    causeLabel: string;
    prescription: string;
  }
  interface RetentionFixBundle {
    title?: string;
    niche?: string;
    fixes?: RetentionFix[];
  }
  const [retentionBundle, setRetentionBundle] = useState<RetentionFixBundle | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bdv-retention-fixes");
      if (!raw) return;
      const bundle = JSON.parse(raw) as RetentionFixBundle;
      if (Array.isArray(bundle.fixes) && bundle.fixes.length > 0) {
        setRetentionBundle(bundle);
      } else {
        localStorage.removeItem("bdv-retention-fixes");
      }
    } catch {
      /* malformed handoff — ignore */
    }
  }, []);

  function dismissRetentionBundle() {
    try {
      localStorage.removeItem("bdv-retention-fixes");
    } catch {
      /* storage blocked — ignore */
    }
    setRetentionBundle(null);
  }

  function importRetentionFixes() {
    if (!retentionBundle?.fixes?.length) return;
    const fixes = retentionBundle.fixes.slice(0, 6);
    const title = retentionBundle.title?.slice(0, 120) || "your video";
    const fixDay: CalendarDay = {
      date: todayISO(),
      dayLabel: WEEKDAYS[new Date().getDay()],
      post: true,
      title: t("retentionDoctor.calendarFixDayTitle", { title }),
      format: "video",
      platform: platforms[0] ?? "",
      hook: t("retentionDoctor.calendarFixDayHook", {
        fixes: fixes.map((f) => `${f.dropPct}% @ ${f.at} — ${f.prescription}`).join(" · "),
      }).slice(0, 600),
      bestTime: "",
    };
    setDays((prev) => {
      const list = prev ?? [];
      const existing = list.findIndex((d) => d.date === fixDay.date);
      if (existing >= 0) {
        /* A day already exists today — merge the fixes into it. */
        return list.map((d, i) =>
          i === existing
            ? {
                ...d,
                post: true,
                title: `${d.title} + ${fixDay.title}`.slice(0, 160),
                hook: `${d.hook ? d.hook + " · " : ""}${fixDay.hook}`.slice(0, 600),
              }
            : d
        );
      }
      return [...list, fixDay];
    });
    dismissRetentionBundle();
  }

  /* Deep-link handoff: ?niche= pre-fills the niche (used by the
     /coach Niche Analyzer "Build a content calendar" handoff). */
  useEffect(() => {
    try {
      const linked = new URLSearchParams(window.location.search).get("niche")?.trim().slice(0, 120);
      if (linked) setCustomNiche(linked);
    } catch {
      /* ignore malformed query strings */
    }
  }, []);

  const sig = useMemo(
    () => calendarSig(customNiche.trim() || niche, platforms, parseInt(postsPerWeek, 10) || 3, startDate),
    [niche, customNiche, platforms, postsPerWeek, startDate],
  );

  // Restore a previously generated calendar + progress when inputs match.
  useEffect(() => {
    const stored = loadStored<CalendarDay[]>(`bdv-calendar:${sig}`);
    setDays(stored && stored.length === 30 ? stored : null);
    setChecked(loadStored<Record<string, boolean>>(`bdv-calendar-checked:${sig}`) ?? {});
  }, [sig]);

  useEffect(() => {
    try {
      localStorage.setItem(`bdv-calendar-checked:${sig}`, JSON.stringify(checked));
    } catch {
      /* storage full/blocked — progress just won't persist */
    }
  }, [checked, sig]);

  function togglePlatform(key: PlatformKey) {
    setPlatforms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  function toggleChecked(date: string) {
    setChecked((prev) => ({ ...prev, [date]: !prev[date] }));
  }

  async function generate() {
    if (loading || !user) return;
    const finalNiche = (customNiche.trim() || niche).slice(0, 120);
    if (!finalNiche) {
      setError(t("content-calendar.pick_a_niche_first_that_s_what_t"));
      return;
    }
    if (platforms.length === 0) {
      setError(t("content-calendar.pick_at_least_one_platform_to_pl"));
      return;
    }
    const cadence = Math.max(1, Math.min(14, parseInt(postsPerWeek, 10) || 0));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setError(t("content-calendar.pick_a_valid_start_date"));
      return;
    }

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/content-calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          niche: finalNiche,
          platforms,
          postsPerWeek: cadence,
          startDate,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as CalendarResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.days) || data.days.length === 0) {
        throw new Error(data.message || data.error || "Calendar failed — try again.");
      }
      setDays(data.days);
      setChecked({});
      try {
        localStorage.setItem(`bdv-calendar:${sig}`, JSON.stringify(data.days));
        localStorage.setItem(`bdv-calendar-checked:${sig}`, JSON.stringify({}));
      } catch {
        /* non-fatal */
      }
      refreshProfile();
      setTimeout(() => {
        document.getElementById("calendar-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  // Calendar grid math: leading blanks so day 1 lands on its weekday.
  const leadBlanks = useMemo(() => leadBlankCount(days ?? []), [days]);

  const postingDays = useMemo(() => postingCount(days ?? []), [days]);
  const doneCount = useMemo(
    () => days?.filter((d) => checked[d.date]).length ?? 0,
    [days, checked],
  );

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <CalendarDays className="h-3 w-3" aria-hidden="true" />{t("content-calendar.thy_cheat_code_s_planning_tools")}</p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">{t("content-calendar.ai_content")}<span className="text-primary">{t("content-calendar.calendar")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">{t("content-calendar.never_wonder_what_to_post_again")}</p>
        </div>

        {/* ── INPUTS ─────────────────────────────────────────────────── */}
        <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          {/* niche */}
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("content-calendar.your_niche")}</p>
          <div data-min-stars="2" className="flex flex-wrap gap-2">
            {NICHE_PRESETS.map((n) => {
              const selected = !customNiche.trim() && niche === n;
              return (
                <button
                  key={n}
                  onClick={() => { setNiche(n); setCustomNiche(""); }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <input
            value={customNiche}
            onChange={(e) => setCustomNiche(e.target.value)}
            maxLength={120}
            placeholder={t("content-calendar.or_type_your_own_niche")}
            className={`${inputClass} mt-3`}
          />

          {/* platforms */}
          <p data-min-stars="2" className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("content-calendar.platforms")}</p>
          <div data-min-stars="2" className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {PLATFORM_OPTS.map((p) => {
              const Icon = p.icon;
              const selected = platforms.includes(p.key);
              return (
                <button
                  key={p.key}
                  onClick={() => togglePlatform(p.key)}
                  className={`flex items-center gap-2.5 rounded-2xl border p-3.5 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/30"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                      selected ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                  <span className={`text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* cadence + start date */}
          <div data-min-stars="3" className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("content-calendar.posts_per_week")}</p>
              <input
                value={postsPerWeek}
                onChange={(e) => setPostsPerWeek(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                inputMode="numeric"
                placeholder="3"
                aria-label={t("content-calendar.posts_per_week")}
                className={inputClass}
              />
            </div>
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">{t("content-calendar.start_date")}</p>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label={t("content-calendar.calendar_start_date")}
                className={`${inputClass} [color-scheme:dark]`}
              />
            </div>
          </div>

          {/* CTA */}
          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={generate}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                )}
                {loading ? "Planning your 30 days…" : days ? "Regenerate calendar" : "Generate my 30-day calendar"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <CalendarDays className="h-6 w-6" aria-hidden="true" />{t("content-calendar.sign_in_to_plan_your_30_days")}<ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {CREDIT_COST} Visual Buc per calendar · powered by Thy Cheat Code · viewing & check-offs are free
            </p>
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {error && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* ── RETENTION DOCTOR HANDOFF ───────────────────────────────────
            Importable fix day from the AI Retention Doctor. Purely additive:
            shows only when the doctor stashed a fix bundle. */}
        {retentionBundle?.fixes?.length ? (
          <div className="mx-auto mt-8 flex max-w-3xl items-start gap-4 rounded-2xl border border-primary/30 bg-primary/[0.07] p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/15 text-primary">
              <Stethoscope className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-white">
                {t("retentionDoctor.calendarBannerTitle")}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/60">
                {t("retentionDoctor.calendarBannerBlurb", {
                  title: retentionBundle.title || "—",
                  count: retentionBundle.fixes.length,
                })}
              </p>
              <button
                onClick={importRetentionFixes}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95"
              >
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                {t("retentionDoctor.calendarBannerAdd")}
              </button>
            </div>
            <button
              onClick={dismissRetentionBundle}
              aria-label={t("retentionDoctor.calendarBannerDismiss")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/40 transition hover:border-white/30 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {/* ── CALENDAR GRID ──────────────────────────────────────────── */}
        {days && days.length > 0 && (
          <div id="calendar-results" className="relative mt-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                Your 30 days · {postingDays} posts planned
              </p>
              <div className="flex items-center gap-3">
                <p className="text-xs text-white/40">
                  {doneCount}/{days.length} days done
                </p>
                <div className="h-2 w-28 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-[#f5d67b] transition-all"
                    style={{ width: `${Math.round((doneCount / days.length) * 100)}%` }}
                  />
                </div>
                {user && (
                  <button
                    onClick={generate}
                    disabled={loading}
                    data-min-stars="2"
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Regenerate ({CREDIT_COST} Visual Buc)
                  </button>
                )}
              </div>
            </div>

            {/* weekday header */}
            <div className="mb-2 grid grid-cols-7 gap-2">
              {WEEKDAYS.map((w) => (
                <p key={w} className="text-center text-[11px] font-bold uppercase tracking-widest text-white/30">
                  {w}
                </p>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: leadBlanks }).map((_, i) => (
                <div key={`blank-${i}`} className="min-h-[120px] rounded-2xl border border-white/5 bg-white/[0.01]" />
              ))}
              {days.map((d) => {
                const isDone = !!checked[d.date];
                const PlatformIcon = d.platform
                  ? PLATFORM_OPTS.find((p) => p.key === d.platform)?.icon
                  : null;
                const FormatIcon = d.format ? FORMAT_ICONS[d.format] : null;
                return (
                  <div
                    key={d.date}
                    className={`relative min-h-[120px] rounded-2xl border p-2.5 transition ${
                      d.post
                        ? isDone
                          ? "border-emerald-500/30 bg-emerald-500/[0.05]"
                          : "border-primary/25 bg-primary/[0.05]"
                        : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className={`text-[11px] font-bold ${d.post ? "text-white/80" : "text-white/30"}`}>
                        {d.dayLabel}
                      </p>
                      <button
                        onClick={() => toggleChecked(d.date)}
                        aria-label={isDone ? `Mark ${d.dayLabel} not done` : `Mark ${d.dayLabel} done`}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                          isDone
                            ? "border-emerald-400 bg-emerald-400 text-black"
                            : "border-white/20 text-transparent hover:border-primary/60"
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {d.post ? (
                      <div className={isDone ? "opacity-60" : ""}>
                        <p className={`mt-1.5 line-clamp-3 text-[12px] font-bold leading-snug ${isDone ? "text-white/50 line-through" : "text-white/90"}`}>
                          {d.title}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {PlatformIcon && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                              <PlatformIcon className="h-2.5 w-2.5" aria-hidden="true" />
                              {d.platform}
                            </span>
                          )}
                          {FormatIcon && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-white/60">
                              <FormatIcon className="h-2.5 w-2.5" aria-hidden="true" />
                              {d.format}
                            </span>
                          )}
                        </div>
                        {d.hook && (
                          <p className="mt-1.5 line-clamp-2 text-[11px] italic leading-snug text-white/45">
                            “{d.hook}”
                          </p>
                        )}
                        {d.bestTime && (
                          <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-white/35">
                            <Clock3 className="h-2.5 w-2.5" aria-hidden="true" />
                            {d.bestTime}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] italic text-white/25">{t("content-calendar.rest_day")}</p>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="mt-4 text-center text-xs text-white/30">{t("content-calendar.tap_the_checkbox_on_any_day_to_m")}</p>
          </div>
        )}

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Calendar in hand? Run your best ideas through the{" "}
          <Link href="/hooks" className="font-semibold text-primary hover:underline">{t("content-calendar.hook_studio")}</Link>{" "}
          before you film.
        </p>
      </main>


    </div>
  );
}
