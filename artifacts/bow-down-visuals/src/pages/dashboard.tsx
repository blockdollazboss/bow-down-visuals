import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Mic2, Video, Film, Archive, FolderOpen, Headphones,
  ArrowRight, Zap, AlertCircle, User, RefreshCw,
  ChevronRight, ChevronDown, Star, CheckCircle2, Sparkles, SlidersHorizontal,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useUserMode } from "@/contexts/UserModeContext";


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
  "Make Song + Video":  "text-yellow-400",
  "Make a Music Video": "text-blue-400",
  "Make a Song":        "text-green-400",
  "Promo Clip Maker":   "text-pink-400",
  "Thumbnail Maker":    "text-orange-400",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  "Make Song + Video":  <Mic2     className="h-3.5 w-3.5" />,
  "Make a Music Video": <Video    className="h-3.5 w-3.5" />,
  "Make a Song":        <Headphones className="h-3.5 w-3.5" />,
  "Promo Clip Maker":   <Film     className="h-3.5 w-3.5" />,
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

/* ─────────────────────── CREATOR CARD ─────────────────────── */

interface CreatorCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  cta: string;
  href: string;
  accent?: boolean;
}

function CreatorCard({ icon: Icon, title, description, cta, href, accent }: CreatorCardProps) {
  return (
    <Link href={href}>
      <div className={`
        group relative flex flex-col h-full p-6 rounded-2xl border transition-all duration-300 cursor-pointer
        ${accent
          ? "bg-gradient-to-br from-primary/[0.18] via-primary/[0.09] to-transparent border-primary/45 shadow-[0_0_36px_rgba(218,165,32,0.14)] hover:shadow-[0_0_52px_rgba(218,165,32,0.24)] hover:-translate-y-0.5"
          : "bg-white/[0.025] border-white/[0.07] hover:border-primary/30 hover:bg-primary/[0.04] hover:-translate-y-0.5"
        }
      `}>
        {accent && (
          <div className="absolute -top-3 left-5">
            <span className="inline-flex items-center gap-1 bg-primary text-black text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full shadow-lg">
              <Star className="h-2.5 w-2.5" /> Most Popular
            </span>
          </div>
        )}
        <div className={`h-11 w-11 rounded-xl flex items-center justify-center mb-4 shrink-0 transition-colors ${
          accent ? "bg-primary text-black" : "bg-white/[0.06] group-hover:bg-primary/[0.18]"
        }`}>
          <Icon className={`h-5 w-5 ${accent ? "text-black" : "text-primary"}`} />
        </div>
        <h3 className="text-base font-black text-white tracking-tight mb-1.5 leading-tight">{title}</h3>
        <p className="text-sm text-white/40 leading-relaxed flex-1">{description}</p>
        <div className={`mt-5 inline-flex items-center gap-2 text-sm font-bold transition-colors ${
          accent ? "text-yellow-300 group-hover:text-yellow-200" : "text-primary/80 group-hover:text-primary"
        }`}>
          {cta}
          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
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

/* ─────────────────────── PAGE ─────────────────────── */

export default function Dashboard() {
  const { profile, user, getAccessToken, refreshProfile } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { setMode, isSimple } = useUserMode();
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [vaultCount, setVaultCount] = useState<number | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [paymentToast, setPaymentToast] = useState<{ type: "success" | "error" | "cancelled"; message: string } | null>(null);

  const name = firstName(profile?.display_name, user?.email);

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
      setPaymentToast({ type: "success", message: "Payment successful. Adding credits to your account…" });

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
            setPaymentToast({ type: "success", message: "Payment successful. Your credits were added." });
            refreshProfile();
            setTimeout(() => refreshProfile(), 3000);
          } else {
            setPaymentToast({ type: "error", message: data.error ?? "Payment recorded but credits could not be applied. Contact support." });
          }
        } catch {
          setPaymentToast({ type: "error", message: "Payment recorded but could not apply credits. Try refreshing the page." });
        }
      })();
    }
  }, [user]);

  /* ── Projects fetch ── */
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

  /* ── Vault count fetch ── */
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

  /* Open checklist by default for new users */
  useEffect(() => {
    if (projects.length === 0 || vaultCount === 0) setChecklistOpen(true);
  }, [projects.length, vaultCount]);

  const recentProjects = projects.slice(0, 5);

  function handleOpen(id: string) {
    void id;
    window.location.href = `/my-projects`;
  }

  /* ── Checklist step completion ── */
  const checklistSteps = [
    {
      label: "Choose your artist",
      done: (vaultCount ?? 0) > 0,
      href: "/artist-vault",
    },
    {
      label: "Make or upload a song",
      done: projects.some((p) => p.project_type === "Make a Song" || p.project_type === "Make Song + Video"),
      href: "/make-song",
    },
    {
      label: "Create a video plan",
      done: projects.some((p) => p.project_type === "Make a Music Video" || p.project_type === "Make Song + Video"),
      href: "/make-video",
    },
    {
      label: "Generate video clips",
      done: projects.some((p) => p.project_type === "Make a Music Video" || p.project_type === "Make Song + Video"),
      href: "/make-video",
    },
    {
      label: "Open the video editor",
      done: false,
      href: "/my-projects",
    },
    {
      label: "Export or save your video",
      done: false,
      href: "/my-projects",
    },
  ];
  const checklistDoneCount = checklistSteps.filter((s) => s.done).length;

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-primary/[0.07] rounded-full blur-[120px]" />
        <div className="absolute top-1/2 -right-40 w-[400px] h-[400px] bg-violet-700/[0.04] rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14 space-y-10">

        {/* ── PAYMENT TOAST ── */}
        {paymentToast && (
          <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl border text-sm font-medium ${
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
            >×</button>
          </div>
        )}

        {/* ── 1. WELCOME HEADER ── */}
        <div>
          <p className="text-xs font-bold tracking-[0.2em] text-primary/55 uppercase mb-2">Creator Studio</p>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight leading-tight mb-1">
            <span className="text-white/90">Welcome back, </span>
            <span className="gold-text-shine">{name}</span>
          </h1>
          <p className="text-white/35 text-base font-medium">
            Create the Song. Create the Video. Promote the Release.
          </p>
        </div>

        {/* ── 2. ACTIVE ARTIST STRIP ── */}
        {activeArtist ? (() => {
          const initials = activeArtist.artist_name.split(" ").slice(0,2).map(w => w[0]?.toUpperCase() ?? "").join("");
          const hasConsistency = !!(activeArtist.consistency_prompt || activeArtist.reference_image_url);
          return (
            <div style={{
              borderRadius: 18,
              border: "1px solid rgba(201,168,76,0.28)",
              background: "linear-gradient(90deg, rgba(201,168,76,0.06) 0%, rgba(0,0,0,0) 60%)",
              padding: "12px 16px",
              display: "flex", alignItems: "center", gap: 14,
              position: "relative", overflow: "hidden",
              boxShadow: "0 0 24px rgba(201,168,76,0.06), inset 0 1px 0 rgba(201,168,76,0.1)",
            }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0, width: 2.5,
                background: "linear-gradient(to bottom, #C9A84C, rgba(201,168,76,0))",
                borderRadius: "2px 0 0 2px",
              }} />
              <div style={{
                width: 56, height: 56, borderRadius: 16, flexShrink: 0,
                background: "linear-gradient(135deg, rgba(201,168,76,0.2) 0%, rgba(201,168,76,0.06) 100%)",
                border: "1.5px solid rgba(201,168,76,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 18px rgba(201,168,76,0.25)",
                position: "relative", overflow: "hidden",
                fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 900, color: "#C9A84C",
              }}>
                {activeArtist.reference_image_url ? (
                  <img src={activeArtist.reference_image_url} alt={activeArtist.artist_name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }} />
                ) : initials}
                <div style={{
                  position: "absolute", bottom: -1, right: -1,
                  width: 9, height: 9, borderRadius: "50%",
                  background: "#C9A84C", border: "1.5px solid #080808",
                  boxShadow: "0 0 6px #C9A84C",
                }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <p style={{ fontSize: 13, fontWeight: 900, color: "#fff", letterSpacing: "0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {activeArtist.artist_name}
                  </p>
                  <span style={{
                    fontSize: 7.5, fontWeight: 900, color: "#C9A84C",
                    background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.3)",
                    borderRadius: 4, padding: "1px 5px", letterSpacing: "0.12em", flexShrink: 0,
                  }}>ACTIVE</span>
                </div>
                <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.35)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[activeArtist.artist_type, activeArtist.genre].filter(Boolean).join(" · ")}
                  {hasConsistency ? " · 🔒 Locked" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLocation("/choose-artist")}
                style={{
                  height: 30, borderRadius: 9,
                  border: "1px solid rgba(201,168,76,0.3)",
                  background: "rgba(201,168,76,0.08)",
                  color: "#C9A84C", fontSize: 10.5, fontWeight: 800,
                  cursor: "pointer", padding: "0 12px", flexShrink: 0,
                  letterSpacing: "0.04em", whiteSpace: "nowrap",
                }}
              >Change →</button>
            </div>
          );
        })() : (
          <div style={{
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            padding: "12px 16px",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 13, flexShrink: 0,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <User className="h-5 w-5 text-white/20" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.16em", textTransform: "uppercase" }}>Active Artist</p>
              <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.35)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertCircle className="h-3.5 w-3.5 text-white/20 shrink-0" />
                No artist selected — choose one for consistent AI style
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLocation("/choose-artist")}
              style={{
                height: 30, borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.5)", fontSize: 10.5, fontWeight: 700,
                cursor: "pointer", padding: "0 12px", flexShrink: 0,
              }}
            >Choose Artist</button>
          </div>
        )}

        {/* ── 3. CREATE ── */}
        {isSimple ? (
          <section>
            <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/[0.14] via-primary/[0.05] to-transparent p-8 md:p-10 shadow-[0_0_40px_rgba(218,165,32,0.10)]">
              <div className="max-w-xl">
                <span className="inline-flex items-center gap-1.5 bg-primary text-black text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full mb-4">
                  <Sparkles className="h-3 w-3" /> Simple Mode
                </span>
                <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight leading-tight mb-2">
                  Upload a song or paste an idea — we'll do the rest
                </h2>
                <p className="text-white/45 text-sm md:text-base font-medium mb-6">
                  One click. AI picks the genre, mood, format, and editing style, generates your scenes,
                  and drops you straight into a ready-to-export video.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/create">
                    <Button size="lg" className="gold-glow font-black gap-2">
                      <Sparkles className="h-4 w-4" /> Create with AI
                    </Button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setMode("advanced")}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-white/40 hover:text-white/70 transition-colors"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" /> Switch to Advanced for full manual controls
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
        <section>
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-white tracking-tight">What do you want to create?</h2>
              <p className="text-sm text-white/35 mt-1">Pick a workflow below to get started.</p>
            </div>
            <button
              type="button"
              onClick={() => setMode("simple")}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-primary/70 hover:text-primary transition-colors shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" /> Try Simple Mode
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <CreatorCard
              icon={Mic2}
              title="Make Song + Video"
              description="Create a song idea, lyrics, video scenes, and clips."
              cta="Start Full Workflow"
              href="/song-and-video"
              accent
            />
            <CreatorCard
              icon={Video}
              title="Make Music Video"
              description="Turn your song or lyrics into video scenes and AI clips."
              cta="Create Music Video"
              href="/make-video"
            />
            <CreatorCard
              icon={Film}
              title="Promo Clips"
              description="Make TikTok, Reels, and Shorts ideas for your release."
              cta="Create Promo Clips"
              href="/promo-clip"
            />
            <CreatorCard
              icon={Archive}
              title="Artist Profiles"
              description="Save your artist look, style, colors, and brand rules."
              cta="Choose Artist"
              href="/artist-vault"
            />
            <CreatorCard
              icon={Headphones}
              title="Music Mixer"
              description="Upload vocals, beats, or stems and preview your mix."
              cta="Open Music Mixer"
              href="/video-editor"
            />
            <CreatorCard
              icon={FolderOpen}
              title="My Projects"
              description="Continue editing saved songs, videos, and campaigns."
              cta="Open Projects"
              href="/my-projects"
            />
          </div>
        </section>
        )}

        {/* ── 4. RECENT PROJECTS ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold tracking-[0.18em] text-white/30 uppercase">Recent Projects</h2>
            <Link href="/my-projects">
              <span className="text-xs font-bold text-primary/60 hover:text-primary transition-colors flex items-center gap-1">
                View All Projects <ChevronRight className="h-3 w-3" />
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
        </section>

        {/* ── 5. GETTING STARTED (collapsible) ── */}
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
          <button
            type="button"
            onClick={() => setChecklistOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3 text-left">
              <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4 text-primary/70" />
              </div>
              <div>
                <p className="text-sm font-black text-white">Getting Started</p>
                <p className="text-[11px] text-white/35">
                  {checklistDoneCount} of {checklistSteps.length} steps completed
                </p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-white/30 shrink-0 transition-transform ${checklistOpen ? "rotate-180" : ""}`} />
          </button>

          {checklistOpen && (
            <div className="border-t border-white/[0.06] px-6 py-4 space-y-2.5">
              {checklistSteps.map(({ label, done, href }, i) => (
                <Link key={label} href={done ? "#" : href}>
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    done
                      ? "border-primary/20 bg-primary/[0.05] opacity-60 cursor-default"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-primary/30 cursor-pointer"
                  }`}>
                    <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 text-[10px] font-black ${
                      done ? "border-primary bg-primary text-black" : "border-white/20 text-white/30"
                    }`}>
                      {done ? "✓" : i + 1}
                    </div>
                    <span className={`text-sm font-semibold flex-1 ${done ? "line-through text-white/30" : "text-white/70"}`}>
                      {label}
                    </span>
                    {!done && <ChevronRight className="h-3.5 w-3.5 text-white/20" />}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
