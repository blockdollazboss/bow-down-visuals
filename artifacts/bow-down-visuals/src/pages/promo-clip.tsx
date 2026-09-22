import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Film, ArrowLeft, Loader2, ChevronRight, ChevronDown, ChevronUp,
  FolderOpen, Music, Video, Mic2, Image as ImageIcon, Wand2,
  Megaphone, Check, Search,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult, type SaveMetadata } from "@/components/GenerationResult";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { OpenVideoEditorButton } from "@/components/OpenVideoEditorButton";
import type { SceneData } from "@/lib/scene-parser";

/* ─────────────────────────── TYPES ─────────────────────────── */

type Mode = "select" | "from-project" | "from-scratch";

interface Project {
  id: string;
  title: string;
  project_type: string;
  artist_name: string | null;
  song_title: string | null;
  genre: string | null;
  mood: string | null;
  input_data: Record<string, unknown> | null;
  output_data: {
    result?: string;
    scenes?: SceneData[];
  } | null;
  credits_used: number;
  created_at: string;
}

interface FormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  platform: string;
  promoGoal: string;
  songHook: string;
  specialInstructions: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const PROMO_TYPES = [
  { id: "Hook Promo",                 label: "Hook Promo",             desc: "Go viral with your hook" },
  { id: "Best Bar Clip",              label: "Best Bar Clip",          desc: "Showcase your hardest bar" },
  { id: "Release Announcement",       label: "Release Announcement",   desc: "Drop announcement content" },
  { id: "Music Video Teaser",         label: "Music Video Teaser",     desc: "Tease the visuals" },
  { id: "Behind The Song",            label: "Behind The Song",        desc: "Story behind the record" },
  { id: "Lyrics Clip",                label: "Lyrics Clip",            desc: "Lyric-forward content" },
  { id: "Countdown Post",             label: "Countdown Post",         desc: "Build pre-release hype" },
  { id: "Streaming Call-To-Action",   label: "Streaming CTA",          desc: "Drive streams & saves" },
];

const PLATFORMS = [
  { id: "TikTok 9:16",            label: "TikTok",         aspect: "9:16" },
  { id: "Instagram Reels 9:16",   label: "Reels",          aspect: "9:16" },
  { id: "YouTube Shorts 9:16",    label: "Shorts",         aspect: "9:16" },
  { id: "Square 1:1",             label: "Square",         aspect: "1:1" },
  { id: "All Platforms",          label: "All Platforms",  aspect: "" },
];

const PLATFORM_STRINGS = PLATFORMS.map((p) => p.aspect ? `${p.label} ${p.aspect}` : p.label);
const PLATFORM_IDS     = PLATFORMS.map((p) => p.id);

const GENRES = ["Hip Hop","Drill","Trap","R&B","Pop","Afrobeats","Dancehall","Gospel","Kids Music","Rock","Country","Other"];
const MOODS  = ["Luxury","Dark","Emotional","Street","Romantic","Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly"];
const GOALS  = ["Build hype before release","Promote new song","Push music video","Get more streams","Go viral with hook","Promote artist brand","Announce release date"];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  "Make a Song":       <Music  className="h-3.5 w-3.5" />,
  "Make a Music Video":<Video  className="h-3.5 w-3.5" />,
  "Make Song + Video": <Mic2   className="h-3.5 w-3.5" />,
  "Promo Clip Maker":  <Film   className="h-3.5 w-3.5" />,
  "Thumbnail Maker":   <ImageIcon className="h-3.5 w-3.5" />,
};

/* ─────────────────────────── HELPERS ─────────────────────────── */

function isVideoProject(type: string): boolean {
  return type === "Make a Music Video" || type === "Make Song + Video";
}

function extractLyrics(project: Project): string | null {
  const inputLyrics = project.input_data?.["lyrics"];
  if (typeof inputLyrics === "string" && inputLyrics.length > 10) return inputLyrics;
  const inputExisting = project.input_data?.["existingLyrics"];
  if (typeof inputExisting === "string" && inputExisting.length > 10) return inputExisting;
  const result = project.output_data?.result ?? "";
  const match = result.match(/##\s*FULL LYRICS\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (match) {
    const extracted = match[1].trim();
    if (extracted.length > 10) return extracted;
  }
  return null;
}

function getClips(project: Project): SceneData[] {
  return (project.output_data?.scenes ?? []).filter((s) => !!s.demoClipUrl);
}

/* ─────────────────────────── STYLE TOKENS ─────────────────────────── */

const inputClass    = "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors rounded-xl";
const textareaClass = "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors rounded-xl resize-none";
const selectClass   = "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors appearance-none cursor-pointer";

/* ─────────────────────────── SUB-COMPONENTS ─────────────────────────── */

function StepHeader({ number, label, done }: { number: number; label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-black shrink-0 transition-colors ${
        done ? "bg-primary text-black" : "bg-white/[0.08] text-white/60"
      }`}>
        {done ? <Check className="h-3.5 w-3.5" /> : number}
      </div>
      <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">{label}</h3>
    </div>
  );
}

function ChipBtn({ label, sub, selected, onClick }: { label: string; sub?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start text-left rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-all ${
        selected
          ? "border-primary/60 bg-primary/[0.08] text-white"
          : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white"
      }`}
    >
      <span>{label}</span>
      {sub && <span className="text-[10px] font-normal text-white/30 mt-0.5">{sub}</span>}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">{children}</Label>;
}

function StyledSelect({ name, placeholder, options, ids, value, onChange }: {
  name: string; placeholder: string; options: string[]; ids?: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
        style={{ colorScheme: "dark" }}
      >
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o, i) => (
          <option key={o} value={ids ? ids[i] : o} style={{ background: "#111" }}>{o}</option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function PromoClip() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { activeArtist } = useActiveArtist();

  /* ── Mode ── */
  const [mode, setMode] = useState<Mode>("select");

  /* ── From-project state ── */
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [promoType, setPromoType] = useState("");
  const [platform, setPlatform] = useState("");
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [hookOverride, setHookOverride] = useState("");
  const [projSpecialInstructions, setProjSpecialInstructions] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [clipsOpen, setClipsOpen] = useState(true);

  /* ── From-scratch state ── */
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      platform: "", promoGoal: "", songHook: "", specialInstructions: "",
    },
  });
  const watched = watch();
  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(activeArtist);
  const [scratchAdvancedOpen, setScratchAdvancedOpen] = useState(false);

  /* ── Shared output ── */
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* ── Load projects when entering from-project mode ── */
  useEffect(() => {
    if (mode === "from-project" && user && projects.length === 0 && !projectsLoading) {
      void loadProjects();
    }
  }, [mode, user]);

  async function loadProjects() {
    setProjectsLoading(true);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/projects", { headers });
      if (res.ok) {
        const data = (await res.json()) as { projects: Project[] };
        setProjects(data.projects ?? []);
      }
    } finally {
      setProjectsLoading(false);
    }
  }

  function resetOutput() {
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
  }

  function switchMode(m: Mode) {
    setMode(m);
    resetOutput();
    setSelectedProject(null);
    setPromoType("");
    setPlatform("");
    setSelectedClipIds([]);
    setHookOverride("");
    setProjSpecialInstructions("");
    setAdvancedOpen(false);
    setProjectSearch("");
  }

  /* ── Generate from existing project ── */
  async function generateFromProject() {
    if (!selectedProject || !promoType || !platform) return;
    setLoading(true);
    resetOutput();
    try {
      const token = await getAccessToken();
      const lyrics = extractLyrics(selectedProject);
      const clips  = getClips(selectedProject);
      const { rawResult: result, creditsRemaining } = await callGenerateApi(
        "/api/generate-promo-clips",
        {
          artistName:    selectedProject.artist_name ?? "",
          songTitle:     selectedProject.song_title  ?? "",
          genre:         selectedProject.genre        ?? "",
          mood:          selectedProject.mood         ?? "",
          platform,
          promoGoal:     promoType,
          songHook:      hookOverride || (lyrics ? lyrics.slice(0, 500) : ""),
          instructions:  projSpecialInstructions,
          promoType,
          lyrics:        lyrics ?? "",
          hasRunwayClips: clips.length > 0,
          clipCount:      clips.length,
          selectedClipIds,
        },
        token,
      );
      setRawResult(result);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("promo-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* ── Generate from scratch ── */
  async function generateFromScratch(values: FormValues) {
    setLoading(true);
    resetOutput();
    try {
      const token = await getAccessToken();
      const { rawResult: result, creditsRemaining } = await callGenerateApi(
        "/api/generate-promo-clips",
        {
          artistName:  values.artistName,
          songTitle:   values.songTitle,
          genre:       values.genre,
          mood:        values.mood,
          platform:    values.platform,
          promoGoal:   values.promoGoal,
          songHook:    values.songHook,
          instructions: values.specialInstructions,
          artistVault: loadedVault,
        },
        token,
      );
      setRawResult(result);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("promo-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* ── Derived ── */
  const filteredProjects = projects.filter((p) => {
    if (!projectSearch) return true;
    const q = projectSearch.toLowerCase();
    return (
      (p.artist_name  ?? "").toLowerCase().includes(q) ||
      (p.song_title   ?? "").toLowerCase().includes(q) ||
      (p.title        ?? "").toLowerCase().includes(q)
    );
  });

  const projectClips = selectedProject ? getClips(selectedProject) : [];
  const canGenerate  = !!selectedProject && !!promoType && !!platform;

  const projSaveMetadata: SaveMetadata | null = selectedProject
    ? {
        projectType: "Promo Clip Maker",
        artistName:  selectedProject.artist_name ?? "",
        songTitle:   selectedProject.song_title  ?? "",
        genre:       selectedProject.genre        ?? "",
        mood:        selectedProject.mood         ?? "",
        inputData:   { promoType, platform, sourceProjectId: selectedProject.id } as Record<string, unknown>,
        creditsUsed: 1,
      }
    : null;

  /* ─────────────────────────── RENDER ─────────────────────────── */

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <Film className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">1 credit</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            Promo Clips
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Create TikTok, Reels, and YouTube Shorts ideas for your song. Scripts, captions, hashtags, and rollout plans included.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {["15-Sec Promo","30-Sec Promo","Hook Clip Script","On-Screen Text","Captions","Hashtags","CTAs","Visual Shots","Clip Timing","Thumbnail Idea"].map((tag) => (
              <span key={tag} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/35 px-3 py-1 rounded-full">{tag}</span>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            MODE SELECTOR
        ═══════════════════════════════════════════════════════════ */}
        {mode === "select" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* From Project */}
            <button
              type="button"
              onClick={() => switchMode("from-project")}
              className="group flex flex-col items-start text-left rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-primary/40 hover:bg-primary/[0.03] p-7 transition-all"
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Start From Existing Project</h2>
              <p className="text-sm text-white/40 leading-relaxed mb-5">
                Load a saved song or video project. We'll pull your lyrics, clips, and artist info automatically.
              </p>
              <div className="flex items-center gap-1.5 text-primary text-sm font-bold group-hover:gap-2.5 transition-all">
                Select a project <ChevronRight className="h-4 w-4" />
              </div>
            </button>

            {/* From Scratch */}
            <button
              type="button"
              onClick={() => switchMode("from-scratch")}
              className="group flex flex-col items-start text-left rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.03] p-7 transition-all"
            >
              <div className="h-12 w-12 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center mb-5 group-hover:border-white/20 transition-colors">
                <Wand2 className="h-6 w-6 text-white/50 group-hover:text-white/80 transition-colors" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Start From Scratch</h2>
              <p className="text-sm text-white/40 leading-relaxed mb-5">
                Enter your artist details manually. Great for new projects or quick promo content.
              </p>
              <div className="flex items-center gap-1.5 text-white/40 text-sm font-bold group-hover:text-white/70 group-hover:gap-2.5 transition-all">
                Fill in details <ChevronRight className="h-4 w-4" />
              </div>
            </button>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            FROM EXISTING PROJECT
        ═══════════════════════════════════════════════════════════ */}
        {mode === "from-project" && (
          <div className="space-y-5">

            <button
              type="button"
              onClick={() => switchMode("select")}
              className="inline-flex items-center gap-1.5 text-sm text-white/35 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Change mode
            </button>

            {/* ── STEP 1: Select Project ── */}
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
              <StepHeader number={1} label="Select Your Project" done={!!selectedProject} />

              {/* ── COLLAPSED: project already selected ── */}
              {selectedProject ? (
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center shrink-0 text-black">
                    <Check className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">
                      {selectedProject.artist_name || selectedProject.title}
                      {selectedProject.song_title ? ` — ${selectedProject.song_title}` : ""}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] bg-white/[0.04] text-white/25 px-2 py-0.5 rounded-full">{selectedProject.project_type}</span>
                      {getClips(selectedProject).length > 0 && (
                        <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                          {getClips(selectedProject).length} clip{getClips(selectedProject).length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {extractLyrics(selectedProject) && (
                        <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">lyrics</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedProject(null); setPromoType(""); setPlatform(""); setSelectedClipIds([]); }}
                    className="text-xs text-white/30 hover:text-white/70 transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-white/[0.05]"
                  >
                    Change
                  </button>
                </div>
              ) : projectsLoading ? (
                <div className="flex items-center gap-2 text-white/35 py-6">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your projects…
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-10">
                  <FolderOpen className="h-8 w-8 text-white/15 mx-auto mb-3" />
                  <p className="text-white/35 text-sm mb-4">No saved projects found.</p>
                  <Link href="/song-and-video">
                    <Button size="sm" variant="outline" className="border-white/10 text-white/50">
                      Create a project first
                    </Button>
                  </Link>
                </div>
              ) : (
                <>
                  {/* Search */}
                  <div className="relative mb-4">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25" />
                    <input
                      type="text"
                      placeholder="Search by artist, song, or title…"
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors"
                    />
                  </div>

                  {/* Project grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                    {filteredProjects.length === 0 ? (
                      <p className="text-white/30 text-sm py-4 col-span-2">No projects match your search.</p>
                    ) : filteredProjects.map((p) => {
                      const clipCount = getClips(p).length;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSelectedProject(p);
                            setPromoType("");
                            setPlatform("");
                            setSelectedClipIds([]);
                          }}
                          className="flex items-start gap-3 text-left rounded-xl border border-white/[0.06] bg-transparent hover:border-primary/40 hover:bg-primary/[0.03] p-3.5 transition-all"
                        >
                          <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-white/[0.06] text-white/40">
                            {TYPE_ICONS[p.project_type] ?? <Film className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white truncate">
                              {p.artist_name || p.title}
                            </p>
                            <p className="text-xs text-white/35 truncate">
                              {p.song_title || p.project_type}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <span className="text-[10px] bg-white/[0.04] text-white/25 px-2 py-0.5 rounded-full">{p.project_type}</span>
                              {clipCount > 0 && (
                                <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                                  {clipCount} clip{clipCount !== 1 ? "s" : ""}
                                </span>
                              )}
                              {extractLyrics(p) && (
                                <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">lyrics</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ── STEP 2: Promo Type ── */}
            {selectedProject && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <StepHeader number={2} label="Choose Promo Type" done={!!promoType} />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PROMO_TYPES.map((pt) => (
                    <ChipBtn
                      key={pt.id}
                      label={pt.label}
                      sub={pt.desc}
                      selected={promoType === pt.id}
                      onClick={() => { setPromoType(pt.id); setPlatform(""); }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 3: Platform ── */}
            {selectedProject && promoType && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <StepHeader number={3} label="Choose Platform" done={!!platform} />
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlatform(p.id)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-semibold transition-all ${
                        platform === p.id
                          ? "border-primary/60 bg-primary/[0.08] text-white"
                          : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {p.label}
                      {p.aspect && <span className="text-[10px] opacity-50 font-normal">{p.aspect}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Clip Selector (if project has clips) ── */}
            {selectedProject && promoType && platform && projectClips.length > 0 && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <button
                  type="button"
                  onClick={() => setClipsOpen((v) => !v)}
                  className="flex items-center justify-between w-full"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold text-white/60 uppercase tracking-wider">Clips for Promo Timeline</span>
                    <MarketingBadge variant="free" className="text-[10px]">
                      {projectClips.length} available
                    </MarketingBadge>
                  </div>
                  {clipsOpen ? <ChevronUp className="h-4 w-4 text-white/25" /> : <ChevronDown className="h-4 w-4 text-white/25" />}
                </button>
                <p className="text-xs text-white/25 mt-1 mb-4">
                  Select which clips to reference in the AI promo suggestions
                </p>

                {clipsOpen && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {projectClips.map((clip, idx) => {
                      const clipId  = clip.demoClipUrl ?? `clip-${idx}`;
                      const picked  = selectedClipIds.includes(clipId);
                      return (
                        <button
                          key={clipId}
                          type="button"
                          onClick={() =>
                            setSelectedClipIds((prev) =>
                              picked ? prev.filter((id) => id !== clipId) : [...prev, clipId]
                            )
                          }
                          className={`relative rounded-xl border overflow-hidden transition-all text-left ${
                            picked
                              ? "border-primary/50 ring-1 ring-primary/20"
                              : "border-white/[0.07] hover:border-white/20"
                          }`}
                        >
                          <div className="aspect-video bg-white/[0.03] flex items-center justify-center overflow-hidden">
                            {clip.demoClipUrl ? (
                              <video src={clip.demoClipUrl} className="w-full h-full object-cover" muted playsInline />
                            ) : (
                              <Film className="h-5 w-5 text-white/15" />
                            )}
                          </div>
                          <div className="px-2.5 py-2">
                            <p className="text-[11px] text-white/40 truncate">
                              {clip.location || clip.action || `Clip ${idx + 1}`}
                            </p>
                          </div>
                          {picked && (
                            <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                              <Check className="h-3 w-3 text-black" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Advanced Options ── */}
            {selectedProject && promoType && platform && (
              <div className="rounded-2xl border border-white/[0.06] bg-transparent overflow-hidden">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex items-center justify-between w-full px-5 py-4"
                >
                  <span className="text-xs font-bold text-white/35 uppercase tracking-wider">Advanced Options</span>
                  {advancedOpen ? <ChevronUp className="h-4 w-4 text-white/25" /> : <ChevronDown className="h-4 w-4 text-white/25" />}
                </button>
                {advancedOpen && (
                  <div className="px-6 pb-6 space-y-5 border-t border-white/[0.05] pt-5">
                    <div className="space-y-2">
                      <FieldLabel>Hook / Best Lyrics Override</FieldLabel>
                      <p className="text-xs text-white/25">Paste a specific hook or bar to focus the promo around. If blank, we'll pull from your project lyrics automatically.</p>
                      <textarea
                        value={hookOverride}
                        onChange={(e) => setHookOverride(e.target.value)}
                        placeholder="Paste your hook or best bar here…"
                        className={textareaClass + " w-full"}
                        style={{ minHeight: "90px" }}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Special Instructions</FieldLabel>
                      <textarea
                        value={projSpecialInstructions}
                        onChange={(e) => setProjSpecialInstructions(e.target.value)}
                        placeholder="Release date, content restrictions, cultural context, trending sounds to reference…"
                        className={textareaClass + " w-full"}
                        style={{ minHeight: "70px" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Summary + Generate Button ── */}
            {canGenerate && (
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="text-white/40">Project:</span>
                  <span className="text-white font-semibold">
                    {selectedProject?.artist_name}
                    {selectedProject?.song_title ? ` — ${selectedProject.song_title}` : ""}
                  </span>
                  <span className="text-white/20">·</span>
                  <span className="text-primary font-semibold">{promoType}</span>
                  <span className="text-white/20">·</span>
                  <span className="text-white/60">{platform}</span>
                  {selectedClipIds.length > 0 && (
                    <>
                      <span className="text-white/20">·</span>
                      <span className="text-blue-400 text-xs">{selectedClipIds.length} clip{selectedClipIds.length !== 1 ? "s" : ""} selected</span>
                    </>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <Button
                    type="button"
                    size="lg"
                    disabled={loading}
                    onClick={generateFromProject}
                    className="gold-glow font-bold text-base px-10 rounded-xl gap-3"
                    style={{ height: "52px" }}
                  >
                    {loading
                      ? <><Loader2 className="h-5 w-5 animate-spin" /> Building Promo Pack…</>
                      : <><Megaphone className="h-5 w-5" /> Generate Promo Pack</>}
                  </Button>
                  <p className="text-white/20 text-xs">Uses 1 credit</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            FROM SCRATCH
        ═══════════════════════════════════════════════════════════ */}
        {mode === "from-scratch" && (
          <div className="space-y-5">

            <button
              type="button"
              onClick={() => switchMode("select")}
              className="inline-flex items-center gap-1.5 text-sm text-white/35 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Change mode
            </button>

            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
              <form onSubmit={handleSubmit(generateFromScratch)} className="space-y-8">

                <ArtistVaultSelector
                  onLoad={(vault) => {
                    if (!watched.artistName) setValue("artistName", vault.artist_name);
                    if (!watched.genre && vault.genre) setValue("genre", vault.genre);
                    setLoadedVault(vault);
                  }}
                  loadedVaultId={loadedVault?.id}
                  loadedVault={loadedVault}
                />

                {/* Step 1: Artist & Track */}
                <div className="space-y-4">
                  <StepHeader number={1} label="Artist & Track" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <FieldLabel>Artist Name</FieldLabel>
                      <Input
                        {...register("artistName", { required: true })}
                        placeholder="e.g. Lil Nova"
                        className={inputClass + (errors.artistName ? " border-red-500/50" : "")}
                      />
                      {errors.artistName && <p className="text-red-400 text-xs">Required</p>}
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Song Title</FieldLabel>
                      <Input {...register("songTitle")} placeholder="e.g. On My Way Up" className={inputClass} />
                    </div>
                  </div>
                </div>

                {/* Step 2: Sound & Style */}
                <div className="space-y-4">
                  <StepHeader number={2} label="Sound & Style" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <FieldLabel>Genre</FieldLabel>
                      <StyledSelect name="genre" placeholder="Select genre…" options={GENRES}
                        value={watched.genre} onChange={(v) => setValue("genre", v)} />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Mood</FieldLabel>
                      <StyledSelect name="mood" placeholder="Select mood…" options={MOODS}
                        value={watched.mood} onChange={(v) => setValue("mood", v)} />
                    </div>
                  </div>
                </div>

                {/* Step 3: Campaign */}
                <div className="space-y-4">
                  <StepHeader number={3} label="Campaign" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <FieldLabel>Platform</FieldLabel>
                      <StyledSelect name="platform" placeholder="Select platform…"
                        options={PLATFORM_STRINGS} ids={PLATFORM_IDS}
                        value={watched.platform} onChange={(v) => setValue("platform", v)} />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Promo Goal</FieldLabel>
                      <StyledSelect name="promoGoal" placeholder="Select goal…" options={GOALS}
                        value={watched.promoGoal} onChange={(v) => setValue("promoGoal", v)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Song Hook / Best Lyrics</FieldLabel>
                    <Textarea
                      {...register("songHook", { required: true })}
                      placeholder="Paste your hook, best bar, or the lyrics you want to build the promo around. The more specific, the better…"
                      className={textareaClass + (errors.songHook ? " border-red-500/50" : "")}
                      style={{ minHeight: "120px" }}
                    />
                    {errors.songHook && <p className="text-red-400 text-xs">Required — paste your hook or best bar</p>}
                  </div>
                </div>

                {/* Advanced */}
                <div className="border border-white/[0.06] rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setScratchAdvancedOpen((v) => !v)}
                    className="flex items-center justify-between w-full px-5 py-3.5"
                  >
                    <span className="text-xs font-bold text-white/30 uppercase tracking-wider">Special Instructions</span>
                    {scratchAdvancedOpen ? <ChevronUp className="h-4 w-4 text-white/25" /> : <ChevronDown className="h-4 w-4 text-white/25" />}
                  </button>
                  {scratchAdvancedOpen && (
                    <div className="px-5 pb-5 pt-4 border-t border-white/[0.05]">
                      <Textarea
                        {...register("specialInstructions")}
                        placeholder="Release date, content restrictions, cultural context, trending sounds to reference, platform-specific notes…"
                        className={textareaClass + " w-full"}
                        style={{ minHeight: "80px" }}
                      />
                    </div>
                  )}
                </div>

                {/* Submit */}
                <div className="pt-1 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <Button
                    type="submit"
                    size="lg"
                    disabled={loading}
                    className="gold-glow font-bold text-base px-12 rounded-xl gap-3"
                    style={{ height: "52px" }}
                  >
                    {loading
                      ? <><Loader2 className="h-5 w-5 animate-spin" /> Building Promo Pack…</>
                      : <><Megaphone className="h-5 w-5" /> Generate Promo Pack</>}
                  </Button>
                  <p className="text-white/20 text-xs">Uses 1 credit</p>
                </div>

              </form>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            ERROR STATES
        ═══════════════════════════════════════════════════════════ */}
        {outOfCredits && <div className="mt-6"><OutOfCredits /></div>}
        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            OUTPUT — PROMO PACK
        ═══════════════════════════════════════════════════════════ */}
        {rawResult && (
          <div id="promo-result" className="mt-10 space-y-5">

            {/* Open Video Editor shortcut — only when project has video clips */}
            {mode === "from-project" && selectedProject && isVideoProject(selectedProject.project_type) && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div>
                  <p className="text-sm font-semibold text-white">This project has video clips</p>
                  <p className="text-xs text-white/35 mt-0.5">Open the Video Editor to build your full promo timeline</p>
                </div>
                <OpenVideoEditorButton
                  projectId={selectedProject.id}
                  size="sm"
                  label="Open Video Editor"
                />
              </div>
            )}

            <GenerationResult
              result={rawResult}
              onReset={resetOutput}
              saveMetadata={
                projSaveMetadata ?? {
                  projectType: "Promo Clip Maker",
                  artistName:  watched.artistName,
                  songTitle:   watched.songTitle,
                  genre:       watched.genre,
                  mood:        watched.mood,
                  inputData:   watched as unknown as Record<string, unknown>,
                  creditsUsed: 1,
                }
              }
            />

          </div>
        )}

      </div>
    </div>
  );
}
