import { useTranslation } from "react-i18next";
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
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult, type SaveMetadata } from "@/components/GenerationResult";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { OpenVideoEditorButton } from "@/components/OpenVideoEditorButton";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { AssetHandoffs } from "@/components/hub/AssetHandoffs";
import { useHubProject, type HubAsset } from "@/lib/hub-project";
import type { SceneData } from "@/lib/scene-parser";
import { usePageTitle } from "@/hooks/use-page-title";

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
  { id: "Hook Promo",               i18nKey: "hookPromo" },
  { id: "Best Bar Clip",            i18nKey: "bestBarClip" },
  { id: "Release Announcement",     i18nKey: "releaseAnnouncement" },
  { id: "Music Video Teaser",       i18nKey: "musicVideoTeaser" },
  { id: "Behind The Song",          i18nKey: "behindTheSong" },
  { id: "Lyrics Clip",              i18nKey: "lyricsClip" },
  { id: "Countdown Post",           i18nKey: "countdownPost" },
  { id: "Streaming Call-To-Action", i18nKey: "streamingCta" },
];

const PLATFORMS = [
  { id: "TikTok 9:16",            i18nKey: "tiktok",       aspect: "9:16" },
  { id: "Instagram Reels 9:16",   i18nKey: "reels",        aspect: "9:16" },
  { id: "YouTube Shorts 9:16",    i18nKey: "shorts",       aspect: "9:16" },
  { id: "Square 1:1",             i18nKey: "square",       aspect: "1:1" },
  { id: "All Platforms",          i18nKey: "allPlatforms", aspect: "" },
];

const PLATFORM_IDS = PLATFORMS.map((p) => p.id);

const GENRES = [
  { id: "Hip Hop",    i18nKey: "hipHop" },
  { id: "Drill",      i18nKey: "drill" },
  { id: "Trap",       i18nKey: "trap" },
  { id: "R&B",        i18nKey: "rnb" },
  { id: "Pop",        i18nKey: "pop" },
  { id: "Afrobeats",  i18nKey: "afrobeats" },
  { id: "Dancehall",  i18nKey: "dancehall" },
  { id: "Gospel",     i18nKey: "gospel" },
  { id: "Kids Music", i18nKey: "kidsMusic" },
  { id: "Rock",       i18nKey: "rock" },
  { id: "Country",    i18nKey: "country" },
  { id: "Other",      i18nKey: "other" },
];
const MOODS = [
  { id: "Luxury",        i18nKey: "luxury" },
  { id: "Dark",          i18nKey: "dark" },
  { id: "Emotional",     i18nKey: "emotional" },
  { id: "Street",        i18nKey: "street" },
  { id: "Romantic",      i18nKey: "romantic" },
  { id: "Energetic",     i18nKey: "energetic" },
  { id: "Pain",          i18nKey: "pain" },
  { id: "Victory",       i18nKey: "victory" },
  { id: "Party",         i18nKey: "party" },
  { id: "Inspirational", i18nKey: "inspirational" },
  { id: "Funny",         i18nKey: "funny" },
  { id: "Kid-Friendly",  i18nKey: "kidFriendly" },
];
const GOALS = [
  { id: "Build hype before release", i18nKey: "buildHype" },
  { id: "Promote new song",          i18nKey: "promoteSong" },
  { id: "Push music video",          i18nKey: "pushMusicVideo" },
  { id: "Get more streams",          i18nKey: "getStreams" },
  { id: "Go viral with hook",        i18nKey: "goViral" },
  { id: "Promote artist brand",      i18nKey: "promoteBrand" },
  { id: "Announce release date",     i18nKey: "announceReleaseDate" },
];

const OUTPUT_TAGS = [
  "promo15", "promo30", "hookScript", "onScreenText", "captions",
  "hashtags", "ctas", "visualShots", "clipTiming", "thumbnailIdea",
];

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
  const { t } = useTranslation();
  usePageTitle(t("promo-clip.pageTitle"), t("promo-clip.pageDescription"));
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset, latestOfKind, project: hubProject } = useHubProject();

  /* ── Hub project spine: prefill the from-scratch form from the active
     project — song title, artist, hook travel over, no re-typing. ── */
  function handleProjectPick(asset: HubAsset) {
    const title = asset.meta?.["title"] ?? asset.label;
    const artist = asset.meta?.["artist"] ?? "";
    const hook = asset.meta?.["hook"] ?? "";
    if (title && !watch("songTitle")) setValue("songTitle", title, { shouldDirty: true });
    if (artist && !watch("artistName")) setValue("artistName", artist, { shouldDirty: true });
    if (hook && !watch("songHook")) setValue("songHook", hook, { shouldDirty: true });
    if (mode !== "from-scratch") switchMode("from-scratch");
  }

  /* ── Hub project spine: the finished promo plan lands in the project as a
     script asset so Hook Studio / Scheduler / Social Kit can build on it. ── */
  function pushPromoPlanToProject(result: string, songTitle: string) {
    try {
      addAsset({
        kind: "script",
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(result)}`,
        label: `Promo plan · ${songTitle || "untitled"}`,
        detail: "Promo Clip Maker",
        meta: { kind: "promo-plan", title: songTitle },
      });
    } catch {
      /* best-effort */
    }
  }

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

  /* Deep-link protocol: /promo-clip?song=…&artist=…&hook=… pre-fills the
     from-scratch form (e.g. coming from song-and-video or the hub). */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const song = params.get("song");
      const artist = params.get("artist");
      const hook = params.get("hook");
      if (song) setValue("songTitle", song);
      if (artist) setValue("artistName", artist);
      if (hook) setValue("songHook", hook);
      if (song || artist || hook) window.history.replaceState(null, "", window.location.pathname);
    } catch { /* non-browser — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const res = await callGenerateApi(
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
        confirmedFetch,
      );
      if (!res) return; // user cancelled the credit confirmation
      const { rawResult: result, creditsRemaining } = res;
      setRawResult(result);
      pushPromoPlanToProject(result, selectedProject?.song_title ?? "");
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("promo-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("promo-clip.errorGenerationFailed");
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
      const res = await callGenerateApi(
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
        confirmedFetch,
      );
      if (!res) return; // user cancelled the credit confirmation
      const { rawResult: result, creditsRemaining } = res;
      setRawResult(result);
      pushPromoPlanToProject(result, values.songTitle);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("promo-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("promo-clip.errorGenerationFailed");
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

  /* Translated display strings (ids stay English for the API) */
  const platformStrings = PLATFORMS.map((p) => {
    const label = t(`promo-clip.platforms.${p.i18nKey}`);
    return p.aspect ? `${label} ${p.aspect}` : label;
  });
  const selectedPlatform = PLATFORMS.find((p) => p.id === platform);
  const selectedPlatformLabel = selectedPlatform
    ? selectedPlatform.aspect
      ? `${t(`promo-clip.platforms.${selectedPlatform.i18nKey}`)} ${selectedPlatform.aspect}`
      : t(`promo-clip.platforms.${selectedPlatform.i18nKey}`)
    : platform;
  const selectedPromoType = PROMO_TYPES.find((pt) => pt.id === promoType);
  const selectedPromoTypeLabel = selectedPromoType
    ? t(`promo-clip.promoTypes.${selectedPromoType.i18nKey}.label`)
    : promoType;

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

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          {t("promo-clip.backToDashboard")}
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <Film className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">{t("promo-clip.creditBadge")}</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {t("promo-clip.title")}
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            {t("promo-clip.subtitle")}
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {OUTPUT_TAGS.map((tag) => (
              <span key={tag} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/35 px-3 py-1 rounded-full">{t(`promo-clip.tags.${tag}`)}</span>
            ))}
          </div>
        </div>

        <ProjectFlowBar
          kinds={["song", "video", "script"]}
          actionLabel={t("hubSpine.flowBar.useSongInVideo")}
          onPick={handleProjectPick}
        />

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
              <h2 className="text-xl font-black text-white mb-2">{t("promo-clip.modes.fromProject.title")}</h2>
              <p className="text-sm text-white/40 leading-relaxed mb-5">
                {t("promo-clip.modes.fromProject.desc")}
              </p>
              <div className="flex items-center gap-1.5 text-primary text-sm font-bold group-hover:gap-2.5 transition-all">
                {t("promo-clip.modes.fromProject.cta")} <ChevronRight className="h-4 w-4" />
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
              <h2 className="text-xl font-black text-white mb-2">{t("promo-clip.modes.fromScratch.title")}</h2>
              <p className="text-sm text-white/40 leading-relaxed mb-5">
                {t("promo-clip.modes.fromScratch.desc")}
              </p>
              <div className="flex items-center gap-1.5 text-white/40 text-sm font-bold group-hover:text-white/70 group-hover:gap-2.5 transition-all">
                {t("promo-clip.modes.fromScratch.cta")} <ChevronRight className="h-4 w-4" />
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
              <ArrowLeft className="h-3.5 w-3.5" /> {t("promo-clip.changeMode")}
            </button>

            {/* ── STEP 1: Select Project ── */}
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
              <StepHeader number={1} label={t("promo-clip.steps.selectProject")} done={!!selectedProject} />

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
                          {t("promo-clip.clips.count", { count: getClips(selectedProject).length })}
                        </span>
                      )}
                      {extractLyrics(selectedProject) && (
                        <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">{t("promo-clip.clips.lyrics")}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedProject(null); setPromoType(""); setPlatform(""); setSelectedClipIds([]); }}
                    className="text-xs text-white/30 hover:text-white/70 transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-white/[0.05]"
                  >
                    {t("promo-clip.change")}
                  </button>
                </div>
              ) : projectsLoading ? (
                <div className="flex items-center gap-2 text-white/35 py-6">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("promo-clip.loadingProjects")}
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-10">
                  <FolderOpen className="h-8 w-8 text-white/15 mx-auto mb-3" />
                  <p className="text-white/35 text-sm mb-4">{t("promo-clip.noProjects")}</p>
                  <Link href="/song-and-video">
                    <Button size="sm" variant="outline" className="border-white/10 text-white/50">
                      {t("promo-clip.createProjectFirst")}
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
                      placeholder={t("promo-clip.searchPlaceholder")}
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors"
                    />
                  </div>

                  {/* Project grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                    {filteredProjects.length === 0 ? (
                      <p className="text-white/30 text-sm py-4 col-span-2">{t("promo-clip.noProjectsMatch")}</p>
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
                                  {t("promo-clip.clips.count", { count: clipCount })}
                                </span>
                              )}
                              {extractLyrics(p) && (
                                <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">{t("promo-clip.clips.lyrics")}</span>
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

            {/* ── STEP 2: Promo Type — preset picks (2) ── */}
            {selectedProject && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6" data-min-stars="2">
                <StepHeader number={2} label={t("promo-clip.steps.choosePromoType")} done={!!promoType} />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PROMO_TYPES.map((pt) => (
                    <ChipBtn
                      key={pt.id}
                      label={t(`promo-clip.promoTypes.${pt.i18nKey}.label`)}
                      sub={t(`promo-clip.promoTypes.${pt.i18nKey}.desc`)}
                      selected={promoType === pt.id}
                      onClick={() => { setPromoType(pt.id); setPlatform(""); }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 3: Platform — preset picks (2) ── */}
            {selectedProject && promoType && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6" data-min-stars="2">
                <StepHeader number={3} label={t("promo-clip.steps.choosePlatform")} done={!!platform} />
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
                      {t(`promo-clip.platforms.${p.i18nKey}`)}
                      {p.aspect && <span className="text-[10px] opacity-50 font-normal">{p.aspect}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Clip Selector (if project has clips) — tweak option (3) ── */}
            {selectedProject && promoType && platform && projectClips.length > 0 && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6" data-min-stars="3">
                <button
                  type="button"
                  onClick={() => setClipsOpen((v) => !v)}
                  className="flex items-center justify-between w-full"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold text-white/60 uppercase tracking-wider">{t("promo-clip.clipsSelector.title")}</span>
                    <MarketingBadge variant="free" className="text-[10px]">
                      {t("promo-clip.clipsSelector.available", { count: projectClips.length })}
                    </MarketingBadge>
                  </div>
                  {clipsOpen ? <ChevronUp className="h-4 w-4 text-white/25" /> : <ChevronDown className="h-4 w-4 text-white/25" />}
                </button>
                <p className="text-xs text-white/25 mt-1 mb-4">
                  {t("promo-clip.clipsSelector.hint")}
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
                              {clip.location || clip.action || t("promo-clip.clipsSelector.clipFallback", { n: idx + 1 })}
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

            {/* ── Advanced Options — manual prompt editing (4) ── */}
            {selectedProject && promoType && platform && (
              <div className="rounded-2xl border border-white/[0.06] bg-transparent overflow-hidden" data-min-stars="4">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex items-center justify-between w-full px-5 py-4"
                >
                  <span className="text-xs font-bold text-white/35 uppercase tracking-wider">{t("promo-clip.advanced.title")}</span>
                  {advancedOpen ? <ChevronUp className="h-4 w-4 text-white/25" /> : <ChevronDown className="h-4 w-4 text-white/25" />}
                </button>
                {advancedOpen && (
                  <div className="px-6 pb-6 space-y-5 border-t border-white/[0.05] pt-5">
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.advanced.hookOverride")}</FieldLabel>
                      <p className="text-xs text-white/25">{t("promo-clip.advanced.hookOverrideHint")}</p>
                      <textarea
                        value={hookOverride}
                        onChange={(e) => setHookOverride(e.target.value)}
                        placeholder={t("promo-clip.advanced.hookPlaceholder")}
                        className={textareaClass + " w-full"}
                        style={{ minHeight: "90px" }}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.advanced.specialInstructions")}</FieldLabel>
                      <textarea
                        value={projSpecialInstructions}
                        onChange={(e) => setProjSpecialInstructions(e.target.value)}
                        placeholder={t("promo-clip.advanced.instructionsPlaceholder")}
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
                  <span className="text-white/40">{t("promo-clip.summary.project")}</span>
                  <span className="text-white font-semibold">
                    {selectedProject?.artist_name}
                    {selectedProject?.song_title ? ` — ${selectedProject.song_title}` : ""}
                  </span>
                  <span className="text-white/20">·</span>
                  <span className="text-primary font-semibold">{selectedPromoTypeLabel}</span>
                  <span className="text-white/20">·</span>
                  <span className="text-white/60">{selectedPlatformLabel}</span>
                  {selectedClipIds.length > 0 && (
                    <>
                      <span className="text-white/20">·</span>
                      <span className="text-blue-400 text-xs">{t("promo-clip.summary.clipsSelected", { count: selectedClipIds.length })}</span>
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
                      ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("promo-clip.generating")}</>
                      : <><Megaphone className="h-5 w-5" /> {t("promo-clip.generate")}</>}
                  </Button>
                  <p className="text-white/20 text-xs">{t("promo-clip.costNote")}</p>
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
              <ArrowLeft className="h-3.5 w-3.5" /> {t("promo-clip.changeMode")}
            </button>

            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
              <form onSubmit={handleSubmit(generateFromScratch)} className="space-y-8">

                {/* Artist vault preset pick — gated at level 2 (key presets / style picks) */}
                <div data-min-stars="2">
                  <ArtistVaultSelector
                    onLoad={(vault) => {
                      if (!watched.artistName) setValue("artistName", vault.artist_name);
                      if (!watched.genre && vault.genre) setValue("genre", vault.genre);
                      setLoadedVault(vault);
                    }}
                    loadedVaultId={loadedVault?.id}
                    loadedVault={loadedVault}
                    context="promo"
                  />
                </div>

                {/* Step 1: Artist & Track */}
                <div className="space-y-4">
                  <StepHeader number={1} label={t("promo-clip.steps.artistTrack")} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.form.artistName")}</FieldLabel>
                      <Input
                        {...register("artistName", { required: true })}
                        placeholder={t("promo-clip.form.artistNamePlaceholder")}
                        className={inputClass + (errors.artistName ? " border-red-500/50" : "")}
                      />
                      {errors.artistName && <p className="text-red-400 text-xs">{t("promo-clip.form.required")}</p>}
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.form.songTitle")}</FieldLabel>
                      <Input {...register("songTitle")} placeholder={t("promo-clip.form.songTitlePlaceholder")} className={inputClass} />
                    </div>
                  </div>
                </div>

                {/* Step 2: Sound & Style — style picks (2) */}
                <div className="space-y-4">
                  <StepHeader number={2} label={t("promo-clip.steps.soundStyle")} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="2">
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.form.genre")}</FieldLabel>
                      <StyledSelect name="genre" placeholder={t("promo-clip.form.selectGenre")}
                        options={GENRES.map((g) => t(`promo-clip.genres.${g.i18nKey}`))}
                        ids={GENRES.map((g) => g.id)}
                        value={watched.genre} onChange={(v) => setValue("genre", v)} />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.form.mood")}</FieldLabel>
                      <StyledSelect name="mood" placeholder={t("promo-clip.form.selectMood")}
                        options={MOODS.map((m) => t(`promo-clip.moods.${m.i18nKey}`))}
                        ids={MOODS.map((m) => m.id)}
                        value={watched.mood} onChange={(v) => setValue("mood", v)} />
                    </div>
                  </div>
                </div>

                {/* Step 3: Campaign — platform & goal preset picks (2); song hook is required input and stays visible */}
                <div className="space-y-4">
                  <StepHeader number={3} label={t("promo-clip.steps.campaign")} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="2">
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.form.platform")}</FieldLabel>
                      <StyledSelect name="platform" placeholder={t("promo-clip.form.selectPlatform")}
                        options={platformStrings} ids={PLATFORM_IDS}
                        value={watched.platform} onChange={(v) => setValue("platform", v)} />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t("promo-clip.form.promoGoal")}</FieldLabel>
                      <StyledSelect name="promoGoal" placeholder={t("promo-clip.form.selectGoal")}
                        options={GOALS.map((g) => t(`promo-clip.goals.${g.i18nKey}`))}
                        ids={GOALS.map((g) => g.id)}
                        value={watched.promoGoal} onChange={(v) => setValue("promoGoal", v)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>{t("promo-clip.form.songHook")}</FieldLabel>
                    <Textarea
                      {...register("songHook", { required: true })}
                      placeholder={t("promo-clip.form.songHookPlaceholder")}
                      className={textareaClass + (errors.songHook ? " border-red-500/50" : "")}
                      style={{ minHeight: "120px" }}
                    />
                    {errors.songHook && <p className="text-red-400 text-xs">{t("promo-clip.form.hookRequired")}</p>}
                  </div>
                </div>

                {/* Advanced — special instructions = manual prompt editing (4) */}
                <div className="border border-white/[0.06] rounded-xl overflow-hidden" data-min-stars="4">
                  <button
                    type="button"
                    onClick={() => setScratchAdvancedOpen((v) => !v)}
                    className="flex items-center justify-between w-full px-5 py-3.5"
                  >
                    <span className="text-xs font-bold text-white/30 uppercase tracking-wider">{t("promo-clip.advanced.specialInstructions")}</span>
                    {scratchAdvancedOpen ? <ChevronUp className="h-4 w-4 text-white/25" /> : <ChevronDown className="h-4 w-4 text-white/25" />}
                  </button>
                  {scratchAdvancedOpen && (
                    <div className="px-5 pb-5 pt-4 border-t border-white/[0.05]">
                      <Textarea
                        {...register("specialInstructions")}
                        placeholder={t("promo-clip.advanced.instructionsPlaceholderScratch")}
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
                      ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("promo-clip.generating")}</>
                      : <><Megaphone className="h-5 w-5" /> {t("promo-clip.generate")}</>}
                  </Button>
                  <p className="text-white/20 text-xs">{t("promo-clip.costNote")}</p>
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
                  <p className="text-sm font-semibold text-white">{t("promo-clip.videoEditor.title")}</p>
                  <p className="text-xs text-white/35 mt-0.5">{t("promo-clip.videoEditor.desc")}</p>
                </div>
                <OpenVideoEditorButton
                  projectId={selectedProject.id}
                  size="sm"
                  label={t("promo-clip.videoEditor.open")}
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

            {/* Spine: next-step handoffs on the finished promo plan — the
                orphaned clip-description tool writes YouTube-ready copy, and
                a project image can become a meme. Both save back to the
                project automatically. */}
            <div className="mt-8">
              <AssetHandoffs
                asset={{
                  id: `promo-plan-${Date.now().toString(36)}`,
                  kind: "script",
                  url: "",
                  label: watched.songTitle || "Promo plan",
                  createdAt: Date.now(),
                }}
                handoffs={["clip-description"]}
                topic={watched.songTitle || watched.songHook || hubProject.name}
              />
            </div>
            {(() => {
              const img = latestOfKind("image") ?? latestOfKind("thumbnail");
              if (!img) return null;
              return (
                <div className="mt-6">
                  <AssetHandoffs asset={img} handoffs={["meme"]} />
                </div>
              );
            })()}

          </div>
        )}

      </div>
    </div>
  );
}
