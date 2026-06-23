import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Mic2, Music, Video, Film, Image as ImageIcon,
  Archive, FolderOpen, Headphones, ArrowRight,
  Zap, Users, Clock, Sparkles, ChevronRight,
  TrendingUp, Star, Lock, User, RefreshCw, AlertCircle, Rocket,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";

/* ─────────────────────── TYPES ─────────────────────── */

interface Project {
  id: string;
  title: string;
  project_type: string;
  artist_name: string | null;
  song_title: string | null;
  created_at: string;
}

/* ─────────────────────── HELPERS ─────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  "Make Song + Video": "text-yellow-400",
  "Make a Music Video": "text-blue-400",
  "Make a Song": "text-green-400",
  "Promo Clip Maker": "text-pink-400",
  "Thumbnail Maker": "text-orange-400",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  "Make Song + Video": <Mic2 className="h-3.5 w-3.5" />,
  "Make a Music Video": <Video className="h-3.5 w-3.5" />,
  "Make a Song": <Music className="h-3.5 w-3.5" />,
  "Promo Clip Maker": <Film className="h-3.5 w-3.5" />,
  "Thumbnail Maker": <ImageIcon className="h-3.5 w-3.5" />,
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function firstName(name: string | null | undefined, email: string | null | undefined) {
  if (name) return name.split(" ")[0];
  if (email) return email.split("@")[0];
  return "Creator";
}

/* ─────────────────────── HERO CARD ─────────────────────── */

interface HeroCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  cta: string;
  href: string;
  accent?: boolean;
}

function HeroCard({ icon: Icon, title, description, cta, href, accent }: HeroCardProps) {
  return (
    <Link href={href}>
      <div className={`
        group relative flex flex-col h-full p-7 rounded-2xl border transition-all duration-300 cursor-pointer
        ${accent
          ? "bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border-primary/50 shadow-[0_0_40px_rgba(218,165,32,0.18)] hover:shadow-[0_0_60px_rgba(218,165,32,0.28)] hover:-translate-y-0.5"
          : "bg-white/[0.03] border-white/[0.07] hover:border-primary/35 hover:bg-primary/[0.05] hover:-translate-y-0.5"
        }
      `}>
        {accent && (
          <div className="absolute -top-3 left-6">
            <span className="inline-flex items-center gap-1 bg-primary text-white text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full shadow-lg">
              <Star className="h-2.5 w-2.5" /> Most Popular
            </span>
          </div>
        )}
        <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-5 shrink-0 transition-colors ${
          accent ? "bg-primary text-white" : "bg-white/[0.06] group-hover:bg-primary/20"
        }`}>
          <Icon className={`h-5 w-5 ${accent ? "text-white" : "text-primary"}`} />
        </div>
        <h3 className="text-xl font-black text-white tracking-tight mb-2">{title}</h3>
        <p className="text-sm text-white/45 leading-relaxed flex-1">{description}</p>
        <div className={`mt-6 inline-flex items-center gap-2 text-sm font-bold transition-colors ${
          accent ? "text-yellow-300 group-hover:text-yellow-200" : "text-primary group-hover:text-yellow-300"
        }`}>
          {cta}
          <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

/* ─────────────────────── TOOL CHIP ─────────────────────── */

function ToolChip({ icon: Icon, label, href }: { icon: React.ElementType; label: string; href: string }) {
  return (
    <Link href={href}>
      <div className="group flex items-center gap-3 px-4 py-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:border-primary/30 hover:bg-primary/[0.05] transition-all cursor-pointer">
        <div className="h-8 w-8 rounded-lg bg-white/[0.05] group-hover:bg-primary/15 flex items-center justify-center shrink-0 transition-colors">
          <Icon className="h-4 w-4 text-white/50 group-hover:text-primary transition-colors" />
        </div>
        <span className="text-sm font-semibold text-white/60 group-hover:text-white transition-colors">{label}</span>
        <ChevronRight className="h-3.5 w-3.5 text-white/20 group-hover:text-primary group-hover:translate-x-0.5 ml-auto transition-all" />
      </div>
    </Link>
  );
}

/* ─────────────────────── STAT TILE ─────────────────────── */

function StatTile({ value, label, icon: Icon, color }: {
  value: string | number; label: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-2xl font-black text-white mt-0.5">{value}</p>
      <p className="text-xs text-white/35 font-medium">{label}</p>
    </div>
  );
}

/* ─────────────────────── RECENT PROJECT ROW ─────────────────────── */

function RecentProjectRow({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const label = project.title ||
    [project.artist_name, project.song_title].filter(Boolean).join(" — ") ||
    project.project_type;
  const iconColor = TYPE_COLORS[project.project_type] ?? "text-primary";
  const icon = TYPE_ICONS[project.project_type] ?? <FolderOpen className="h-3.5 w-3.5" />;

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04] transition-all group">
      <div className={`h-8 w-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0 ${iconColor}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-white truncate">{label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-white/30 font-medium">{project.project_type}</span>
          {project.artist_name && (
            <>
              <span className="text-white/15">·</span>
              <span className="text-[10px] text-white/30 truncate">{project.artist_name}</span>
            </>
          )}
        </div>
      </div>
      <span className="text-[11px] text-white/20 shrink-0 hidden sm:block">{formatDate(project.created_at)}</span>
      <button
        onClick={() => onOpen(project.id)}
        className="shrink-0 text-xs font-bold text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/50 px-3 py-1.5 rounded-lg transition-all"
      >
        Open
      </button>
    </div>
  );
}

/* ─────────────────────── COMING SOON ─────────────────────── */

const COMING_SOON = [
  { label: "Real AI Vocals + Beats", icon: Mic2 },
  { label: "Advanced Auto Editing", icon: TrendingUp },
  { label: "Full Export Studio", icon: Sparkles },
  { label: "Team Accounts", icon: Users },
];

/* ─────────────────────── PAGE ─────────────────────── */

export default function Dashboard() {
  const { profile, user, getAccessToken, refreshProfile } = useAuth();
  const { activeArtist } = useActiveArtist();
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [vaultCount, setVaultCount] = useState<number | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [paymentToast, setPaymentToast] = useState<{ type: "success" | "error" | "cancelled"; message: string } | null>(null);

  const name = firstName(profile?.display_name, user?.email);
  const credits = profile?.credits ?? 0;

  // Handle Stripe redirect back to dashboard
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
      setPaymentToast({
        type: "success",
        message: "Payment successful. Adding credits to your account…",
      });

      // Verify payment directly with Stripe and credit immediately — no webhook dependency
      (async () => {
        try {
          const token = await getAccessToken();
          const res = await fetch("/api/checkout/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ sessionId }),
          });
          const data = await res.json() as { success?: boolean; credits?: number; added?: number; pack?: string; error?: string };

          if (res.ok && data.success) {
            setPaymentToast({
              type: "success",
              message: "Payment successful. Your credits were added.",
            });
            refreshProfile();
            // Second refresh after a short delay to guarantee latest balance from Supabase
            setTimeout(() => refreshProfile(), 3000);
          } else {
            setPaymentToast({
              type: "error",
              message: data.error ?? "Payment recorded but credits could not be applied. Contact support.",
            });
          }
        } catch {
          setPaymentToast({
            type: "error",
            message: "Payment recorded but could not apply credits. Try refreshing the page.",
          });
        }
      })();
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      const res = await fetch("/api/projects", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!cancelled) {
        const d = res.ok ? await res.json() : { projects: [] };
        setProjects(d.projects ?? []);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      const res = await fetch("/api/artist-vaults", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!cancelled) {
        const d = res.ok ? await res.json() : { vaults: [] };
        setVaultCount((d.vaults ?? []).length);
      }
    })().catch(() => setVaultCount(0));
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  const recentProjects = projects.slice(0, 3);
  const projectCount = projects.length;

  function handleOpen(id: string) {
    setOpenProjectId(id);
    window.location.href = `/my-projects`;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-primary/7 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 -right-40 w-[400px] h-[400px] bg-blue-600/4 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14 space-y-12">

        {/* ── PAYMENT TOAST ── */}
        {paymentToast && (
          <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl border text-sm font-medium animate-fade-in ${
            paymentToast.type === "success"
              ? "border-green-500/30 bg-green-500/[0.08] text-green-300"
              : paymentToast.type === "cancelled"
              ? "border-yellow-500/25 bg-yellow-500/[0.06] text-yellow-300/80"
              : "border-red-500/25 bg-red-500/[0.06] text-red-300"
          }`}>
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1">{paymentToast.message}</span>
            <button
              onClick={() => setPaymentToast(null)}
              className="text-white/30 hover:text-white/60 transition-colors shrink-0 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* ── 1. WELCOME HEADER ── */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-0 sm:justify-between">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-primary/60 uppercase mb-2">Creator Studio</p>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight leading-tight mb-1">
              Welcome back, {name}
            </h1>
            <p className="text-white/35 text-base font-medium">
              Create the Song. Create the Video. Promote the Release.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto px-4 py-2.5 rounded-xl border border-primary/25 bg-primary/[0.07]">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-sm font-black text-white">{credits}</span>
            <span className="text-xs text-white/40 font-medium">credits</span>
          </div>
        </div>

        {/* ── 1b. ACTIVE ARTIST STRIP ── */}
        <div className={`flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 rounded-2xl border transition-all ${
          activeArtist
            ? "border-white/20 bg-white/[0.04]"
            : "border-white/[0.06] bg-white/[0.02]"
        }`}>
          <div className={`h-10 w-10 rounded-full border-2 flex items-center justify-center shrink-0 overflow-hidden ${
            activeArtist ? "border-white/25" : "border-white/10"
          }`}>
            {activeArtist?.photo_url ? (
              <img src={activeArtist.photo_url} alt={activeArtist.artist_name} className="h-full w-full object-cover" />
            ) : (
              <User className={`h-5 w-5 ${activeArtist ? "text-zinc-300" : "text-white/20"}`} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            {activeArtist ? (
              <>
                <p className="text-[10px] font-bold tracking-widest text-zinc-300/70 uppercase">Active Artist</p>
                <p className="text-sm font-black text-white truncate">{activeArtist.artist_name}</p>
                {(activeArtist.genre || activeArtist.artist_type) && (
                  <p className="text-xs text-white/35 truncate">{[activeArtist.artist_type, activeArtist.genre].filter(Boolean).join(" · ")}</p>
                )}
              </>
            ) : (
              <>
                <p className="text-[10px] font-bold tracking-widest text-white/30 uppercase">Active Artist</p>
                <p className="text-sm text-white/40 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-white/20" />
                  No artist selected — your content won't have a consistent style yet. Choose or create one to get started.
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLocation("/choose-artist")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border border-white/20 bg-white/[0.05] text-zinc-200 hover:bg-white/[0.10] transition-colors shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {activeArtist ? "Change Artist" : "Choose Artist"}
          </button>
        </div>

        {/* ── 2. HERO ACTION CARDS ── */}
        <section>
          <div className="mb-5">
            <h2 className="text-lg font-black text-white tracking-tight">What do you want to do?</h2>
            <p className="text-sm text-white/35 mt-0.5">Pick a workflow below to get started.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
            <HeroCard
              icon={Mic2}
              title="Make Song + Video"
              description="Create lyrics, AI music prompts, video plans, scene clips, captions, and promo content in one workflow."
              cta="Start Full Workflow"
              href="/song-and-video"
              accent
            />
            <HeroCard
              icon={Video}
              title="Make a Music Video"
              description="Upload a song or paste lyrics, generate a cinematic video plan, create Runway clips, and edit your visual."
              cta="Create Video"
              href="/make-video"
            />
            <HeroCard
              icon={Film}
              title="Promo Clips"
              description="Turn your song or saved project into TikTok, Reels, YouTube Shorts, captions, and rollout ideas."
              cta="Create Promo Pack"
              href="/promo-clip"
            />
          </div>
        </section>

        {/* ── 3. SECONDARY TOOLS ── */}
        <section>
          <h2 className="text-xs font-bold tracking-[0.18em] text-white/30 uppercase mb-4">More Tools</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            <ToolChip icon={Music}      label="Make a Song"       href="/make-song" />
            <ToolChip icon={ImageIcon}  label="Thumbnail Maker"   href="/thumbnail" />
            <ToolChip icon={Archive}    label="Artist Profiles"   href="/artist-vault" />
            <ToolChip icon={Headphones} label="Video Editor"        href="/video-editor" />
            <ToolChip icon={FolderOpen} label="My Projects"        href="/my-projects" />
          </div>
        </section>

        {/* ── 4 + 5. RECENT PROJECTS + STATS (side by side on desktop) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Recent Projects */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold tracking-[0.18em] text-white/30 uppercase">Recent Projects</h2>
              <Link href="/my-projects">
                <span className="text-xs font-bold text-primary/60 hover:text-primary transition-colors flex items-center gap-1">
                  View all <ChevronRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
            {recentProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-white/[0.05] bg-white/[0.01] text-center gap-3">
                <FolderOpen className="h-8 w-8 text-white/10" />
                <p className="text-sm text-white/25">No saved projects yet.</p>
                <Link href="/song-and-video">
                  <Button size="sm" className="gold-glow font-semibold gap-1.5 mt-1">
                    <Mic2 className="h-3.5 w-3.5" /> Start your first project
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentProjects.map((p) => (
                  <RecentProjectRow key={p.id} project={p} onOpen={handleOpen} />
                ))}
              </div>
            )}
          </div>

          {/* Quick Stats */}
          <div>
            <h2 className="text-xs font-bold tracking-[0.18em] text-white/30 uppercase mb-4">Quick Status</h2>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5">
              <StatTile
                value={credits}
                label="Credits remaining"
                icon={Zap}
                color="bg-primary/15 text-primary"
              />
              <StatTile
                value={projectCount}
                label="Saved projects"
                icon={FolderOpen}
                color="bg-blue-500/15 text-blue-400"
              />
              <StatTile
                value={vaultCount === null ? "—" : vaultCount}
                label="Artist profiles"
                icon={Archive}
                color="bg-green-500/15 text-green-400"
              />
              <StatTile
                value="∞"
                label="AI video clips"
                icon={Film}
                color="bg-pink-500/15 text-pink-400"
              />
            </div>
          </div>
        </div>

        {/* ── ONBOARDING CHECKLIST ── */}
        {(projects.length === 0 || vaultCount === 0) && (
          <section className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-6">
            <h2 className="text-sm font-black text-white tracking-tight mb-1">Getting Started</h2>
            <p className="text-xs text-white/35 mb-5">New here? Follow these steps to create your first release.</p>
            <div className="space-y-3">
              {[
                { label: "Create or choose an artist profile", done: (vaultCount ?? 0) > 0, href: "/artist-vault" },
                { label: "Make a song or start a song + video", done: projects.some(p => p.project_type === "Make a Song" || p.project_type === "Make Song + Video"), href: "/make-song" },
                { label: "Create a music video plan", done: projects.some(p => p.project_type === "Make a Music Video"), href: "/make-video" },
                { label: "Open the video editor and export", done: false, href: "/my-projects" },
              ].map(({ label, done, href }) => (
                <Link key={label} href={done ? "#" : href}>
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${done ? "border-primary/20 bg-primary/[0.06] opacity-60" : "border-white/[0.07] bg-white/[0.02] hover:border-primary/30 cursor-pointer"}`}>
                    <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 text-[10px] font-black ${done ? "border-primary bg-primary text-white" : "border-white/20"}`}>
                      {done ? "✓" : ""}
                    </div>
                    <span className={`text-sm font-semibold ${done ? "line-through text-white/30" : "text-white/70"}`}>{label}</span>
                    {!done && <ChevronRight className="h-3.5 w-3.5 text-white/20 ml-auto" />}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── BETA ACCESS CARD ── */}
        <section>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 px-6 py-5 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/[0.07] via-primary/[0.04] to-transparent">
            <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <Rocket className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-black text-white">Beta Access Open</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/20 border border-primary/30 text-[10px] font-bold text-primary tracking-wide">
                  LIMITED SPOTS
                </span>
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                Invite other creators or request early access features. Beta members lock in the founding rate and get 100 bonus credits.
              </p>
            </div>
            <Link href="/beta-access" className="shrink-0">
              <Button size="sm" className="gold-glow font-bold gap-1.5 whitespace-nowrap">
                <Sparkles className="h-3.5 w-3.5" /> Join Beta
              </Button>
            </Link>
          </div>
        </section>

        {/* ── 6. COMING SOON ── */}
        <section>
          <h2 className="text-xs font-bold tracking-[0.18em] text-white/30 uppercase mb-4">Coming Soon</h2>
          <div className="flex flex-wrap gap-2.5">
            {COMING_SOON.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.07] bg-white/[0.025] text-white/30 text-sm font-semibold"
              >
                <Lock className="h-3 w-3 text-white/20" />
                <Icon className="h-3.5 w-3.5" />
                {label}
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
