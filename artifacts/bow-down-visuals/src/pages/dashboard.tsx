import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Mic2, Video, Film, FolderOpen, Headphones, ArrowRight, ArrowUpRight,
  Zap, AlertCircle, User, Flame, Star, Sparkles, Clapperboard, ImageIcon,
  Lightbulb, TrendingUp, DollarSign, Activity, ChevronRight, Play, Plus,
  Music2, BadgeDollarSign, Scissors as ScissorsIcon,
} from "lucide-react";
import { MarketingBadge } from "@/components/MarketingBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { usePageTitle } from "@/hooks/use-page-title";
import ExtensionPromoBanner from "@/components/ExtensionPromoBanner";
import SharkDropModal, { type SharkDrop } from "@/components/retention/SharkDropModal";
import LevelUpModal from "@/components/retention/LevelUpModal";
import LeaderboardWidget from "@/components/retention/LeaderboardWidget";
import CreationStreakWidget from "@/components/CreationStreakWidget";
import QuestsWidget from "@/components/QuestsWidget";
import { DailyDropCard } from "@/components/DailyDropCard";
import { AwayDigestModal } from "@/components/AwayDigestModal";
import { useTranslation } from "react-i18next";


/* ─────────────────────── TYPES ─────────────────────── */

interface Project {
  id: string;
  title: string;
  project_type: string;
  artist_name: string | null;
  song_title: string | null;
  created_at: string;
}

interface SponsorDeal {
  id: string;
  sponsorName: string;
  stage: string;
  dealValueCents: number;
  updatedAt: string;
}

interface UsageRow {
  id: string;
  createdAt: string;
  action: string;
  creditsUsed: number;
}

/* ─────────────────────── HELPERS ─────────────────────── */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatVB(n: number) {
  return n.toLocaleString("en-US");
}

function firstName(name: string | null | undefined, email: string | null | undefined) {
  if (name) return name.split(" ")[0];
  if (email) return email.split("@")[0];
  return "Creator";
}

function greetingKey(hour: number) {
  if (hour < 5) return "dashboard.greet_night";
  if (hour < 12) return "dashboard.greet_morning";
  if (hour < 18) return "dashboard.greet_afternoon";
  return "dashboard.greet_evening";
}

/* Cinematic card gradients per project type */
const TYPE_GRADIENT: Record<string, string> = {
  "Make Song + Video":  "from-amber-500/[0.22] via-yellow-600/[0.08] to-transparent",
  "Make a Music Video": "from-sky-500/[0.22] via-blue-600/[0.08] to-transparent",
  "Make a Song":        "from-emerald-500/[0.22] via-green-600/[0.08] to-transparent",
  "Promo Clip Maker":   "from-pink-500/[0.22] via-fuchsia-600/[0.08] to-transparent",
  "Thumbnail Maker":    "from-orange-500/[0.22] via-amber-600/[0.08] to-transparent",
};
const TYPE_ICON: Record<string, React.ReactNode> = {
  "Make Song + Video":  <Mic2 className="h-8 w-8" />,
  "Make a Music Video": <Video className="h-8 w-8" />,
  "Make a Song":        <Headphones className="h-8 w-8" />,
  "Promo Clip Maker":   <Film className="h-8 w-8" />,
};

function projectLabel(p: Project) {
  return p.title || [p.artist_name, p.song_title].filter(Boolean).join(" — ") || p.project_type;
}

/* ─────────────────────── SECTION LABEL ─────────────────────── */

function SectionLabel({ icon: Icon, children, action }: { icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode }) {
  const I = Icon;
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="flex items-center gap-2 text-xs font-black tracking-[0.18em] text-white/40 uppercase">
        <I className="h-3.5 w-3.5 text-primary/70" />{children}
      </h2>
      {action}
    </div>
  );
}

/* ─────────────────────── PAGE ─────────────────────── */

export default function Dashboard() {
  const { t } = useTranslation();
  usePageTitle(t("dashboard.metaTitle"), t("dashboard.metaDescription"));
  const { profile, user, getAccessToken, refreshProfile } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { stars } = useUserMode();
  const [, setLocation] = useLocation();

  const [projects, setProjects] = useState<Project[]>([]);
  const [deals, setDeals] = useState<SponsorDeal[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [streak, setStreak] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentToast, setPaymentToast] = useState<{ type: "success" | "error" | "cancelled"; message: string } | null>(null);
  const [sharkDrop, setSharkDrop] = useState<SharkDrop | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const sharkFiredFor = useRef<string | null>(null);
  const levelFiredFor = useRef<Set<string>>(new Set());

  const name = firstName(profile?.display_name, user?.email);
  const balance = profile?.credits ?? 0;

  /* ── Stripe redirect handler ── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");
    if (payment === "cancelled") {
      setPaymentToast({ type: "cancelled", message: "Payment cancelled. No charges were made." });
      window.history.replaceState({}, "", "/dashboard");
      return;
    }
    if (payment === "success" && sessionId) {
      window.history.replaceState({}, "", "/dashboard");
      setPaymentToast({ type: "success", message: "Payment successful. Adding Visual Bucs to your account…" });
      (async () => {
        try {
          const token = await getAccessToken();
          const res = await fetch("/api/checkout/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ sessionId }),
          });
          const data = await res.json() as { success?: boolean; error?: string };
          if (res.ok && data.success) {
            setPaymentToast({ type: "success", message: "Payment successful. Your Visual Bucs were added." });
            refreshProfile();
            setTimeout(() => refreshProfile(), 3000);
          } else {
            setPaymentToast({ type: "error", message: data.error ?? "Payment recorded but Visual Bucs could not be applied. Contact support." });
          }
        } catch {
          setPaymentToast({ type: "error", message: "Payment recorded but could not apply Visual Bucs. Try refreshing the page." });
        }
      })();
    }
  }, [user]);

  /* ── Consolidated data fetch: projects, deals, usage, streak ── */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const token = await getAccessToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const [pRes, dRes, uRes, sRes] = await Promise.allSettled([
        fetch("/api/projects", { headers }),
        fetch("/api/wave8/sponsors/deals", { headers }),
        fetch("/api/credits/history", { headers }),
        fetch("/api/bonus/status", { headers }),
      ]);
      if (cancelled) return;
      if (pRes.status === "fulfilled" && pRes.value.ok) {
        const d = await pRes.value.json().catch(() => ({ projects: [] }));
        setProjects(d.projects ?? []);
      }
      if (dRes.status === "fulfilled" && dRes.value.ok) {
        const d = await dRes.value.json().catch(() => ({ deals: [] }));
        setDeals(d.deals ?? []);
      }
      if (uRes.status === "fulfilled" && uRes.value.ok) {
        const d = await uRes.value.json().catch(() => ({ usage: [] }));
        setUsage((d.usage ?? []).slice(0, 6));
      }
      if (sRes.status === "fulfilled" && sRes.value.ok) {
        const d = await sRes.value.json().catch(() => ({}));
        setStreak(typeof d.streak === "number" ? d.streak : 0);
      }
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  /* ── Retention delight: shark drop dice roll + level-up check ──
     The server owns all the rules (15% drop chance, 2-per-7-day cap,
     exactly-once celebrations); the client only surfaces what it returns.
     Shark drop rolls once per user per mount; level-check re-runs if the
     resolved star level changes (auth resolves async) — the celebrate
     POST is idempotent, so re-runs never double-fire. */
  useEffect(() => {
    if (!user || sharkFiredFor.current === user.id) return;
    sharkFiredFor.current = user.id;
    (async () => {
      try {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch("/api/retention/shark-drop", { headers });
        if (res.ok) {
          const d = (await res.json().catch(() => ({}))) as { drop?: SharkDrop | null };
          if (d.drop) setSharkDrop(d.drop);
        }
      } catch {
        /* Non-fatal: the drop simply doesn't appear on failure. */
      }
    })();
  }, [user, getAccessToken]);

  useEffect(() => {
    if (!user) return;
    const key = `${user.id}:${stars}`;
    if (levelFiredFor.current.has(key)) return;
    levelFiredFor.current.add(key);
    (async () => {
      try {
        const token = await getAccessToken();
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`/api/retention/level-check?currentLevel=${stars}`, { headers });
        if (res.ok) {
          const d = (await res.json().catch(() => ({}))) as { uncelebrated?: number[] };
          if (d.uncelebrated && d.uncelebrated.length > 0) setLevelUp(d.uncelebrated[0]!);
        }
      } catch {
        /* Non-fatal. */
      }
    })();
  }, [user, stars, getAccessToken]);

  /* ── Derived: money pipeline ── */
  const money = useMemo(() => {
    const active = deals.filter((d) => !["paid", "lost", "rejected", "dead"].includes((d.stage || "").toLowerCase()));
    const pipelineCents = active.reduce((s, d) => s + (d.dealValueCents || 0), 0);
    const next = [...active].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0] ?? null;
    return { activeCount: active.length, pipelineDollars: Math.round(pipelineCents / 100), next };
  }, [deals]);

  /* ── Derived: AI next moves (rule-based, real state) ── */
  const nextMoves = useMemo(() => {
    const moves: { icon: React.ReactNode; title: string; sub: string; href: string; cta: string }[] = [];
    const latest = projects[0];
    if (latest) {
      moves.push({
        icon: <Play className="h-4 w-4" />,
        title: t("dashboard.move_finish", { name: projectLabel(latest) }),
        sub: t("dashboard.move_finish_sub"),
        href: `/video-editor?project=${latest.id}`,
        cta: t("dashboard.move_open"),
      });
    }
    moves.push({
      icon: <TrendingUp className="h-4 w-4" />,
      title: t("dashboard.move_trend"),
      sub: t("dashboard.move_trend_sub"),
      href: "/scheduler?tab=trends",
      cta: t("dashboard.move_view"),
    });
    moves.push({
      icon: <Sparkles className="h-4 w-4" />,
      title: t("dashboard.move_linktohit"),
      sub: t("dashboard.move_linktohit_sub"),
      href: "/create?panel=link-to-hit",
      cta: t("dashboard.move_try"),
    });
    return moves.slice(0, 3);
  }, [projects, t]);

  const quickTiles = [
    { icon: Music2, label: t("dashboard.tile_song"), href: "/create?panel=song", grad: "from-emerald-500/[0.16] to-transparent" },
    { icon: Clapperboard, label: t("dashboard.tile_video"), href: "/create?panel=video", grad: "from-sky-500/[0.16] to-transparent" },
    { icon: Sparkles, label: t("dashboard.tile_cartoon"), href: "/cartoon-studio", grad: "from-fuchsia-500/[0.16] to-transparent" },
    { icon: ScissorsIcon, label: t("dashboard.tile_vibes"), href: "/video-editor", grad: "from-amber-500/[0.16] to-transparent" },
    { icon: ImageIcon, label: t("dashboard.tile_thumbnail"), href: "/thumbnail-studio", grad: "from-orange-500/[0.16] to-transparent" },
    { icon: Lightbulb, label: t("dashboard.tile_hook"), href: "/hooks", grad: "from-yellow-500/[0.16] to-transparent" },
  ];

  const greet = t(greetingKey(new Date().getHours()), { name });

  return (
    <div className="min-h-screen bg-black text-white lux-page">
      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[420px] bg-primary/[0.08] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-5 md:px-8 py-8 md:py-10 space-y-8">

        {/* ── RETENTION DELIGHT MODALS (dismissible, pref-gated server-side) ── */}
        {sharkDrop && (
          <SharkDropModal
            drop={sharkDrop}
            onClaimed={() => setSharkDrop(null)}
            onDismiss={() => setSharkDrop(null)}
          />
        )}
        {levelUp !== null && (
          <LevelUpModal level={levelUp} onClose={() => setLevelUp(null)} />
        )}

        {/* ── PAYMENT TOAST ── */}
        {paymentToast && (
          <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl border text-sm font-medium ${
            paymentToast.type === "success" ? "border-green-500/30 bg-green-500/[0.08] text-green-300"
            : paymentToast.type === "cancelled" ? "border-yellow-500/25 bg-yellow-500/[0.06] text-yellow-300/80"
            : "border-red-500/25 bg-red-500/[0.06] text-red-300"}`}>
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1">{paymentToast.message}</span>
            <button onClick={() => setPaymentToast(null)} className="text-white/30 hover:text-white/60 transition-colors shrink-0 text-lg leading-none">×</button>
          </div>
        )}

        {/* ── 1. COMMAND BAR ── */}
        <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.12] via-primary/[0.04] to-transparent p-6 md:p-7 shadow-[0_0_50px_rgba(218,165,32,0.10)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[10px] font-black tracking-[0.22em] text-primary/60 uppercase mb-1.5">{t("dashboard.command_center")}</p>
              <h1 className="text-2xl md:text-[28px] font-black tracking-tight text-white leading-tight">{greet}</h1>
              <p className="text-sm text-white/40 mt-1 font-medium">{t("dashboard.command_sub")}</p>
            </div>
            {/* Live stats */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button onClick={() => setLocation("/pricing")} title={t("dashboard.top_up")}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-black font-black text-sm hover:brightness-110 transition-all shadow-[0_0_20px_rgba(218,165,32,0.35)]">
                <Zap className="h-4 w-4" />{formatVB(balance)}
              </button>
              {streak !== null && streak > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-orange-500/30 bg-orange-500/[0.08] text-sm font-black text-orange-300" title={t("dashboard.streak_days")}>
                  <Flame className="h-4 w-4" />{streak}
                </div>
              )}
              <div className="flex items-center gap-1 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-sm font-black text-white/60" title={t("dashboard.creator_level")}>
                <Star className="h-4 w-4 text-primary" />{stars}
              </div>
            </div>
          </div>
          <div className="mt-5">
            {projects[0] ? (
              <Button size="lg" onClick={() => setLocation(`/video-editor?project=${projects[0].id}`)}
                className="gold-glow font-black gap-2">
                <Play className="h-4 w-4" />{t("dashboard.continue_project", { name: projectLabel(projects[0]) })}
              </Button>
            ) : (
              <Link href="/create">
                <Button size="lg" className="gold-glow font-black gap-2">
                  <Plus className="h-4 w-4" />{t("dashboard.create_with_ai")}
                </Button>
              </Link>
            )}
          </div>
        </section>

        {/* ── RETENTION: CREATION STREAK + WEEKLY QUESTS (dismissible, toggleable) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          <CreationStreakWidget getToken={getAccessToken} onBalanceChange={refreshProfile} />
          <QuestsWidget getToken={getAccessToken} onBalanceChange={refreshProfile} />
        </div>

        {/* ── THY DAILY DROP ── */}
        <DailyDropCard />

        {/* ── ACTIVE ARTIST STRIP (compact) ── */}
        {activeArtist ? (() => {
          const initials = activeArtist.artist_name.split(" ").slice(0,2).map(w => w[0]?.toUpperCase() ?? "").join("");
          return (
            <div className="rounded-2xl border px-4 py-2.5 flex items-center gap-3 relative overflow-hidden" style={{
              borderColor: "var(--character-glow, rgba(201,168,76,0.28))",
              background: "linear-gradient(90deg, var(--character-tint, rgba(201,168,76,0.06)) 0%, rgba(0,0,0,0) 60%)",
            }}>
              <div className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center overflow-hidden font-[Georgia,serif] text-base font-black border-[1.5px]" style={{
                color: "var(--character-primary, #C9A84C)",
                borderColor: "var(--character-glow, rgba(201,168,76,0.4))",
                background: "var(--character-tint, rgba(201,168,76,0.12))",
              }}>
                {activeArtist.reference_image_url ? <img src={activeArtist.reference_image_url} alt={activeArtist.artist_name} className="h-full w-full object-cover object-[top_center]" /> : initials}
              </div>
              <p className="flex-1 min-w-0 text-[13px] font-black text-white truncate">{activeArtist.artist_name}</p>
              <MarketingBadge variant="muted" className="text-[8px] px-1.5 py-0.5 tracking-[0.12em] shrink-0">{t("dashboard.active")}</MarketingBadge>
              <button type="button" onClick={() => setLocation("/choose-artist")}
                className="text-[11px] font-bold text-primary/70 hover:text-primary transition-colors shrink-0">{t("dashboard.change")}</button>
            </div>
          );
        })() : null}

        {/* ── 2. CONTINUE ── */}
        <section>
          <SectionLabel icon={Play} action={
            <Link href="/my-projects"><span className="text-xs font-bold text-primary/60 hover:text-primary transition-colors flex items-center gap-1">{t("dashboard.view_all")}<ChevronRight className="h-3 w-3" /></span></Link>
          }>{t("dashboard.continue_title")}</SectionLabel>
          {loading ? (
            <div className="flex gap-3 overflow-hidden">
              {[0,1,2].map(i => <div key={i} className="w-56 h-32 rounded-2xl lux-skeleton shrink-0" />)}
            </div>
          ) : projects.length === 0 ? (
            <Link href="/create">
              <div className="flex items-center gap-4 p-5 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] hover:bg-primary/[0.08] hover:border-primary/50 transition-all group cursor-pointer">
                <div className="h-11 w-11 rounded-xl bg-primary text-black flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform"><Plus className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm font-black text-white">{t("dashboard.no_projects_cta")}</p>
                  <p className="text-xs text-white/40 mt-0.5">{t("dashboard.no_projects_sub")}</p>
                </div>
              </div>
            </Link>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none" style={{ scrollbarWidth: "none" }}>
              {projects.slice(0, 8).map(p => (
                <button key={p.id} onClick={() => setLocation(`/video-editor?project=${p.id}`)}
                  className={`snap-start shrink-0 w-56 text-left rounded-2xl border border-white/[0.08] bg-gradient-to-br ${TYPE_GRADIENT[p.project_type] ?? "from-primary/[0.14] to-transparent"} p-4 hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(218,165,32,0.15)] transition-all group relative overflow-hidden`}>
                  <div className="text-white/[0.13] group-hover:text-primary/25 transition-colors mb-6">{TYPE_ICON[p.project_type] ?? <FolderOpen className="h-8 w-8" />}</div>
                  <p className="text-sm font-black text-white truncate leading-tight">{projectLabel(p)}</p>
                  <p className="text-[10px] text-white/35 mt-1 truncate">{p.project_type} · {formatDate(p.created_at)}</p>
                  <span className="absolute top-3 right-3 h-7 w-7 rounded-full bg-black/50 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── 3. MONEY PIPELINE ── */}
        <section>
          <SectionLabel icon={DollarSign} action={
            <Link href="/coach"><span className="text-xs font-bold text-primary/60 hover:text-primary transition-colors flex items-center gap-1">{t("dashboard.money_hub")}<ChevronRight className="h-3 w-3" /></span></Link>
          }>{t("dashboard.money_title")}</SectionLabel>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5 flex flex-wrap items-center gap-4">
            {loading ? (
              <div className="h-10 flex-1 rounded-xl lux-skeleton" />
            ) : money.activeCount > 0 ? (
              <>
                <div className="h-11 w-11 rounded-xl bg-green-500/[0.12] border border-green-500/25 flex items-center justify-center shrink-0">
                  <BadgeDollarSign className="h-5 w-5 text-green-400" />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <p className="text-lg font-black text-white leading-tight">
                    {t("dashboard.deals_pipeline", { count: money.activeCount, value: money.pipelineDollars.toLocaleString() })}
                  </p>
                  <p className="text-[11px] text-white/35 mt-0.5">
                    {money.next ? t("dashboard.next_move_followup", { name: money.next.sponsorName }) : t("dashboard.next_move_find")}
                  </p>
                </div>
                <Link href="/coach?tab=brand-deals">
                  <Button size="sm" className="gold-glow font-black shrink-0">{t("dashboard.open_deals")}</Button>
                </Link>
              </>
            ) : (
              <>
                <div className="h-11 w-11 rounded-xl bg-primary/[0.10] border border-primary/25 flex items-center justify-center shrink-0">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <p className="text-sm font-black text-white">{t("dashboard.money_empty_title")}</p>
                  <p className="text-[11px] text-white/35 mt-0.5">{t("dashboard.money_empty_sub")}</p>
                </div>
                <Link href="/coach?tab=brand-deals">
                  <Button size="sm" variant="outline" className="font-bold shrink-0 border-primary/30 text-primary hover:bg-primary/10">{t("dashboard.find_deals")}</Button>
                </Link>
              </>
            )}
          </div>
        </section>

        {/* ── 4. AI NEXT MOVE ── */}
        <section>
          <SectionLabel icon={Sparkles}>{t("dashboard.next_move_title")}</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {nextMoves.map((m, i) => (
              <Link key={i} href={m.href}>
                <div className="group h-full p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-primary/40 hover:bg-primary/[0.05] hover:-translate-y-0.5 transition-all cursor-pointer">
                  <div className="h-9 w-9 rounded-xl bg-primary/[0.12] border border-primary/20 flex items-center justify-center text-primary mb-3 group-hover:scale-105 transition-transform">{m.icon}</div>
                  <p className="text-sm font-black text-white leading-snug truncate">{m.title}</p>
                  <p className="text-[11px] text-white/35 mt-1 leading-relaxed line-clamp-2">{m.sub}</p>
                  <p className="text-[11px] font-bold text-primary/70 group-hover:text-primary mt-2.5 flex items-center gap-1">{m.cta}<ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" /></p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ── 5. QUICK CREATE ── */}
        <section>
          <SectionLabel icon={Zap}>{t("dashboard.quick_create_title")}</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {quickTiles.map(tile => (
              <Link key={tile.href} href={tile.href}>
                <div className={`group p-4 rounded-2xl border border-white/[0.08] bg-gradient-to-br ${tile.grad} hover:border-primary/40 hover:-translate-y-0.5 transition-all cursor-pointer text-center`}>
                  <div className="h-10 w-10 mx-auto rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-primary mb-2.5 group-hover:scale-110 group-hover:border-primary/40 transition-all">
                    <tile.icon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-black text-white">{tile.label}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ── 6. RECENT ACTIVITY ── */}
        <section>
          <SectionLabel icon={Activity} action={
            <Link href="/credit-history"><span className="text-xs font-bold text-primary/60 hover:text-primary transition-colors flex items-center gap-1">{t("dashboard.view_all")}<ChevronRight className="h-3 w-3" /></span></Link>
          }>{t("dashboard.activity_title")}</SectionLabel>
          {loading ? (
            <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-12 rounded-xl lux-skeleton" />)}</div>
          ) : usage.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-primary/25 bg-primary/[0.03] px-6 py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-black text-white">{t("dashboard.activity_empty")}</p>
              <p className="text-xs text-white/40 mt-1 max-w-xs mx-auto">{t("dashboard.no_projects_sub")}</p>
              <Link href="/create">
                <Button size="sm" className="gold-glow font-black mt-4 gap-1.5">
                  <Plus className="h-3.5 w-3.5" />{t("dashboard.create_with_ai")}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.05] overflow-hidden">
              {usage.slice(0, 5).map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="h-7 w-7 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                    <Zap className="h-3.5 w-3.5 text-primary/70" />
                  </div>
                  <p className="flex-1 min-w-0 text-xs font-bold text-white/70 truncate">{u.action}</p>
                  <span className={`text-[11px] font-mono shrink-0 ${u.creditsUsed < 0 ? "text-green-400" : "text-white/30"}`}>
                    {u.creditsUsed < 0 ? `+${formatVB(Math.abs(u.creditsUsed))}` : `-${formatVB(u.creditsUsed)}`}
                  </span>
                  <span className="text-[10px] text-white/20 shrink-0 hidden sm:block">{formatDate(u.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 7. WEEKLY LEADERBOARD + DELIGHT SETTINGS ── */}
        <LeaderboardWidget />

        <ExtensionPromoBanner />
        <AwayDigestModal />
      </div>
    </div>
  );
}
