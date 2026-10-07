import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { useHubProject } from "@/lib/hub-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Video, ArrowLeft, Loader2, ChevronRight, ChevronLeft, BarChart2, Check,
  Music2, Palette, Sparkles, Clapperboard, Volume2, Download, RefreshCcw,
  Film, Camera, MapPin, ChevronDown, ChevronUp, Save, X,
  FileText, ExternalLink,
} from "lucide-react";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { SceneStudio } from "@/components/SceneStudio";
import { StoryboardReview } from "@/components/StoryboardReview";
import { ActiveArtistBanner } from "@/components/ActiveArtistBanner";
import { ReferenceAudioPlayer } from "@/components/ReferenceAudioPlayer";
import { SongSegmentPicker, type SongSegment } from "@/components/SongSegmentPicker";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { AudioTranscribe } from "@/components/AudioTranscribe";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import { downloadTxt, downloadPdf } from "@/lib/export-utils";
import { runAudioSceneFlow } from "@/lib/generate-scenes-from-audio-flow";
import { usePageTitle } from "@/hooks/use-page-title";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { useTranslation } from "react-i18next";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface VideoFormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  lyrics: string;
  artistDescription: string;
  brandColors: string;
  visualStyleRules: string;
  doNotChangeRules: string;
  videoStyle: string;
  platform: string;
  videoLength: string;
  locationIdeas: string;
  specialInstructions: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const GENRES: Array<{ value: string; labelKey: string }> = [
  { value: "Hip Hop", labelKey: "makeVideo.genreHipHop" },
  { value: "Drill", labelKey: "makeVideo.genreDrill" },
  { value: "Trap", labelKey: "makeVideo.genreTrap" },
  { value: "R&B", labelKey: "makeVideo.genreRB" },
  { value: "Pop", labelKey: "makeVideo.genrePop" },
  { value: "Afrobeats", labelKey: "makeVideo.genreAfrobeats" },
  { value: "Dancehall", labelKey: "makeVideo.genreDancehall" },
  { value: "Gospel", labelKey: "makeVideo.genreGospel" },
  { value: "Kids Music", labelKey: "makeVideo.genreKidsMusic" },
  { value: "Rock", labelKey: "makeVideo.genreRock" },
  { value: "Country", labelKey: "makeVideo.genreCountry" },
  { value: "Other", labelKey: "makeVideo.genreOther" },
];

const MOODS: Array<{ value: string; labelKey: string }> = [
  { value: "Luxury", labelKey: "makeVideo.moodLuxury" },
  { value: "Dark", labelKey: "makeVideo.moodDark" },
  { value: "Emotional", labelKey: "makeVideo.moodEmotional" },
  { value: "Street", labelKey: "makeVideo.moodStreet" },
  { value: "Romantic", labelKey: "makeVideo.moodRomantic" },
  { value: "Energetic", labelKey: "makeVideo.moodEnergetic" },
  { value: "Pain", labelKey: "makeVideo.moodPain" },
  { value: "Victory", labelKey: "makeVideo.moodVictory" },
  { value: "Party", labelKey: "makeVideo.moodParty" },
  { value: "Inspirational", labelKey: "makeVideo.moodInspirational" },
  { value: "Funny", labelKey: "makeVideo.moodFunny" },
  { value: "Kid-Friendly", labelKey: "makeVideo.moodKidFriendly" },
];

const VIDEO_STYLES: Array<{ value: string; labelKey: string }> = [
  { value: "Street Cinematic", labelKey: "makeVideo.videoStyleStreetCinematic" },
  { value: "Luxury Rap Video", labelKey: "makeVideo.videoStyleLuxuryRap" },
  { value: "Brooklyn Drill", labelKey: "makeVideo.videoStyleBrooklynDrill" },
  { value: "Dark Emotional Story", labelKey: "makeVideo.videoStyleDarkEmotional" },
  { value: "Performance Video", labelKey: "makeVideo.videoStylePerformance" },
  { value: "Club Video", labelKey: "makeVideo.videoStyleClub" },
  { value: "Cartoon Music Video", labelKey: "makeVideo.videoStyleCartoon" },
  { value: "Anime Music Video", labelKey: "makeVideo.videoStyleAnime" },
  { value: "Kids Nursery Rhyme", labelKey: "makeVideo.videoStyleKids" },
  { value: "Romantic R&B Visual", labelKey: "makeVideo.videoStyleRomanticRB" },
  { value: "Documentary Style", labelKey: "makeVideo.videoStyleDocumentary" },
];

const PLATFORMS: Array<{ value: string; labelKey: string }> = [
  { value: "TikTok / Reels / Shorts - 9:16", labelKey: "makeVideo.platformTiktok" },
  { value: "YouTube Music Video - 16:9", labelKey: "makeVideo.platformYoutube" },
  { value: "Square Social Post - 1:1", labelKey: "makeVideo.platformSquare" },
  { value: "All Formats", labelKey: "makeVideo.platformAll" },
];

const LENGTHS: Array<{ value: string; labelKey: string }> = [
  { value: "15 seconds", labelKey: "makeVideo.length15s" },
  { value: "30 seconds", labelKey: "makeVideo.length30s" },
  { value: "60 seconds", labelKey: "makeVideo.length60s" },
  { value: "Full song", labelKey: "makeVideo.lengthFull" },
];

/* ─────────────────────────── STEPPER DEFINITION ─────────────────────────── */

const STEPS = [
  { n: 1, labelKey: "makeVideo.step1Label", shortKey: "makeVideo.step1Short", icon: Music2 },
  { n: 2, labelKey: "makeVideo.step2Label", shortKey: "makeVideo.step2Short", icon: Palette },
  { n: 3, labelKey: "makeVideo.step3Label", shortKey: "makeVideo.step3Short", icon: Camera },
  { n: 4, labelKey: "makeVideo.step4Label", shortKey: "makeVideo.step4Short", icon: Sparkles },
  { n: 5, labelKey: "makeVideo.step5Label", shortKey: "makeVideo.step5Short", icon: Clapperboard },
  { n: 6, labelKey: "makeVideo.step6Label", shortKey: "makeVideo.step6Short", icon: Download },
];

/* ─────────────────────────── FORM HELPERS ─────────────────────────── */

function FieldWrapper({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{label}</Label>
      {hint && <p className="text-xs text-white/35 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  "h-11 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 placeholder:text-white/25 focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 rounded-xl hover:border-white/[0.18]";

const textareaClass =
  "bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 py-3 placeholder:text-white/25 focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 rounded-xl resize-none hover:border-white/[0.18]";

const selectClass =
  "h-11 w-full rounded-xl bg-[linear-gradient(180deg,hsl(0_0%_100%/0.04),hsl(0_0%_100%/0.015))] border border-white/[0.10] text-white px-3.5 text-sm focus:outline-none focus:border-[hsl(45_95%_55%/0.6)] focus:shadow-[0_0_0_3px_hsl(45_95%_50%/0.15),0_0_20px_-4px_hsl(45_95%_50%/0.35)] shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.3)] transition-all duration-200 appearance-none cursor-pointer hover:border-white/[0.18]";

function StyledSelect({
  name, placeholder, options, value, onChange,
}: {
  name: string; placeholder: string; options: Array<{ value: string; labelKey: string }>;
  value: string; onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
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
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "#111" }}>{t(o.labelKey)}</option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

/* ─────────────────────────── OUTPUT CARD ─────────────────────────── */

interface OutputSection { label: string; content: string; icon: React.ElementType; defaultOpen?: boolean; }

function OutputCard({ label, content, icon: Icon, defaultOpen = false }: OutputSection) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="lux-card-static overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Icon className="h-3.5 w-3.5 text-primary" />
          </span>
          <span className="font-bold text-sm text-white">{label}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-white/30 shrink-0" /> : <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-white/[0.06]">
          <pre className="text-sm text-white/65 leading-relaxed whitespace-pre-wrap pt-4 font-sans">{content}</pre>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── PARSE SECTIONS ─────────────────────────── */

function parseSections(raw: string): Array<{ key: string; content: string }> {
  const result: Array<{ key: string; content: string }> = [];
  const parts = raw.split(/^## /m);
  for (const part of parts) {
    const newlineIdx = part.indexOf("\n");
    if (newlineIdx === -1) continue;
    const key = part.slice(0, newlineIdx).trim();
    const content = part.slice(newlineIdx + 1).trim();
    if (key && content) result.push({ key, content });
  }
  return result;
}

const SECTION_META: Record<string, { labelKey: string; icon: React.ElementType }> = {
  "DIRECTOR'S TREATMENT":   { labelKey: "makeVideo.sectionDirectorsTreatment", icon: Video },
  "VISUAL CONCEPT":         { labelKey: "makeVideo.sectionVisualConcept",     icon: Palette },
  "COLOR PALETTE":          { labelKey: "makeVideo.sectionColorPalette",      icon: Palette },
  "MAIN LOCATIONS":         { labelKey: "makeVideo.sectionMainLocations",     icon: MapPin },
  "WARDROBE & ARTIST LOOK": { labelKey: "makeVideo.sectionWardrobe",          icon: Music2 },
  "CAMERA DIRECTIONS":      { labelKey: "makeVideo.sectionCamera",            icon: Camera },
  "SCENE-BY-SCENE BREAKDOWN": { labelKey: "makeVideo.sectionSceneBreakdown",  icon: Clapperboard },
  "AI VIDEO PROMPTS":       { labelKey: "makeVideo.sectionAiPrompts",         icon: Sparkles },
  "NEGATIVE PROMPTS":       { labelKey: "makeVideo.sectionNegativePrompts",   icon: Film },
  "THUMBNAIL PROMPTS":      { labelKey: "makeVideo.sectionThumbnailPrompts",  icon: Film },
  "PROMO CLIP IDEAS":       { labelKey: "makeVideo.sectionPromoClips",        icon: Film },
  "CAPTION IDEAS":          { labelKey: "makeVideo.sectionCaptionIdeas",       icon: FileText },
};

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function MakeVideo() {
  const { t } = useTranslation();
  usePageTitle(t("makeVideo.pageTitle"), t("makeVideo.pageDescription"));
  const { getAccessToken, refreshProfile, user } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();

  const [step, setStep] = useState(1);
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(activeArtist);
  const [songStructure, setSongStructure] = useState<SongStructure | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [storyboardApproved, setStoryboardApproved] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  /** Locked song segment — when set, scenes are built for this slice, not the full song. */
  const [songSegment, setSongSegment] = useState<SongSegment | null>(null);
  const [generatingScenesFromAudio, setGeneratingScenesFromAudio] = useState(false);
  const [audioSceneError, setAudioSceneError] = useState<string | null>(null);

  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const { addAsset } = useHubProject();
  const reportedClipUrls = useRef<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingScenes, setSavingScenes] = useState(false);
  const [genHistoryId, setGenHistoryId]     = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [creditRefunded, setCreditRefunded]  = useState(false);

  type DraftState = "idle" | "found" | "recovering" | "recovered" | "failed";
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftInfo, setDraftInfo] = useState<{ title?: string; updated?: string } | null>(null);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressDraftSaveUntil = useRef<number>(0);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<VideoFormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "", lyrics: "",
      artistDescription: "", brandColors: "", visualStyleRules: "", doNotChangeRules: "",
      videoStyle: "", platform: "", videoLength: "", locationIdeas: "", specialInstructions: "",
    },
  });

  const watched = watch();

  /* ── Vault load ── */
  function handleVaultLoad(vault: ArtistVault) {
    if (!watched.artistName) setValue("artistName", vault.artist_name);
    if (!watched.artistDescription) {
      const parts = [
        vault.personality,
        vault.hair ? `${t("makeVideo.hairLabel")}: ${vault.hair}` : null,
        vault.tattoos ? `${t("makeVideo.tattoosLabel")}: ${vault.tattoos}` : null,
        vault.jewelry ? `${t("makeVideo.jewelryLabel")}: ${vault.jewelry}` : null,
        vault.clothing_style ? `${t("makeVideo.clothingLabel")}: ${vault.clothing_style}` : null,
      ].filter(Boolean);
      if (parts.length > 0) setValue("artistDescription", parts.join(". "));
    }
    if (!watched.brandColors && vault.brand_colors) setValue("brandColors", vault.brand_colors);
    if (!watched.videoStyle && vault.visual_style) setValue("videoStyle", vault.visual_style);
    setLoadedVault(vault);
  }

  /* ── Analyze song sections ── */
  async function handleAnalyze() {
    const lyrics = watched.lyrics;
    if (!lyrics || lyrics.length < 10) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/analyze-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ lyrics }),
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = (await res.json()) as SongStructure;
      setSongStructure(data);
    } catch {
      setAnalyzeError(t("makeVideo.analysisFailedNote"));
    } finally {
      setAnalyzing(false);
    }
  }

  /* ── Generate scenes directly from the uploaded song (skips the text-plan step) ── */
  async function handleGenerateScenesFromAudio() {
    if (!audioUrl) return;
    setGeneratingScenesFromAudio(true);
    setAudioSceneError(null);
    try {
      const flow = await runAudioSceneFlow({
        lyrics: watched.lyrics,
        audioUrl,
        audioFile,
        songStructure,
        getAccessToken,
        fetchImpl: confirmedFetch,
        segment: songSegment,
      });
      if (!flow) { setGeneratingScenesFromAudio(false); return; } // user cancelled the credit confirmation
      const { songStructure: structure, scenes: newScenes } = flow;
      setSongStructure(structure);
      setScenes(newScenes);
      setStoryboardApproved(false);
      setStep(5);
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
    } catch (err) {
      setAudioSceneError(err instanceof Error ? err.message : t("makeVideo.audioSceneFailed"));
    } finally {
      setGeneratingScenesFromAudio(false);
    }
  }

  /* ── Generate video plan ── */
  async function onGenerate(values: VideoFormValues) {
    setLoading(true);
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
    setSaved(false);
    setSavedProjectId(null);

    const combinedInstructions = [
      values.locationIdeas ? `Location Ideas: ${values.locationIdeas}` : "",
      values.visualStyleRules ? `Visual Style Rules: ${values.visualStyleRules}` : "",
      values.brandColors ? `Brand Colors: ${values.brandColors}` : "",
      values.doNotChangeRules ? `Do Not Change: ${values.doNotChangeRules}` : "",
      values.specialInstructions || "",
    ].filter(Boolean).join("\n");

    try {
      const token = await getAccessToken();
      const genResult = await callGenerateApi("/api/generate-video-plan", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        genre: values.genre,
        mood: values.mood,
        videoStyle: values.videoStyle,
        platform: values.platform,
        videoLength: values.videoLength,
        lyrics: values.lyrics,
        artistDescription: values.artistDescription,
        instructions: combinedInstructions,
        artistVault: loadedVault
          ? {
              vaultId:             loadedVault.id,
              artistType:          loadedVault.artist_type       ?? null,
              artistDescription:   values.artistDescription      || loadedVault.personality,
              visualStyle:         values.videoStyle             || loadedVault.visual_style,
              brandColors:         values.brandColors            || loadedVault.brand_colors,
              doNotChangeRules:    values.doNotChangeRules       || loadedVault.do_not_change_rules,
              specialStyleRules:   loadedVault.special_style_rules ?? null,
              hair:                loadedVault.hair              ?? null,
              tattoos:             loadedVault.tattoos           ?? null,
              jewelry:             loadedVault.jewelry           ?? null,
              clothingStyle:       loadedVault.clothing_style    ?? null,
              consistencyPrompt:   loadedVault.consistency_prompt ?? null,
              referenceImageUrl:   loadedVault.reference_image_url ?? null,
            }
          : undefined,
        songStructure: songStructure ?? undefined,
      }, token, confirmedFetch);

      if (!genResult) { setLoading(false); return; } // user cancelled the credit confirmation
      const { rawResult: result, creditsRemaining, genHistoryId: gid } = genResult;

      setRawResult(result);
      const parsedScenes = parseScenes(extractBreakdownContent(result));
      setScenes(parsedScenes);
      setStoryboardApproved(false);
      setGenHistoryId(gid ?? null);
      if (creditsRemaining !== undefined) refreshProfile();
      void performSave({ result, sceneData: parsedScenes, ghid: gid ?? null });
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 80);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("makeVideo.generationFailed");
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* ── Draft persistence ── */
  const DRAFT_KEY = "bdv_draft_makevideo";
  const WORKFLOW   = "make-video";

  /* Check for existing draft on mount */
  useEffect(() => {
    let cancelled = false;
    async function check() {
      // 1. localStorage (fast, same-browser)
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { timestamp?: number; formValues?: Record<string, string>; rawResult?: string };
          const age = Date.now() - (parsed.timestamp ?? 0);
          const hasContent = !!(parsed.rawResult || Object.values(parsed.formValues ?? {}).some(Boolean));
          if (age < 7 * 24 * 60 * 60 * 1000 && hasContent && !rawResult) {
            const fv = parsed.formValues ?? {};
            const titleParts = [fv["artistName"], fv["songTitle"]].filter(Boolean).join(" — ");
            if (!cancelled) {
              setDraftInfo({ title: titleParts || t("makeVideo.unsavedDraft"), updated: new Date(parsed.timestamp ?? 0).toLocaleString() });
              setDraftState("found");
            }
            return;
          }
        }
      } catch { /* ignore */ }

      // 2. Server (cross-session, cross-device)
      if (!user) return;
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/drafts?workflow=${WORKFLOW}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { drafts: Array<{ id: string; title: string | null; updated_at: string }> };
        if (data.drafts.length > 0 && !rawResult) {
          const d = data.drafts[0];
          if (!cancelled) {
            setDraftId(d.id);
            setDraftInfo({ title: d.title ?? t("makeVideo.unsavedDraft"), updated: new Date(d.updated_at).toLocaleString() });
            setDraftState("found");
          }
        }
      } catch { /* ignore */ }
    }
    check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* Auto-save to localStorage (always, even before generation) */
  useEffect(() => {
    const hasContent = !!(watched.artistName || watched.lyrics || rawResult);
    if (!hasContent) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        rawResult, scenes, formValues: watched, audioUrl, step, timestamp: Date.now(),
      }));
    } catch { /* ignore */ }
  }, [rawResult, scenes, watched, audioUrl, step]);

  /* Auto-save to server (debounced 30 s) */
  useEffect(() => {
    const hasContent = !!(watched.artistName || watched.lyrics || rawResult);
    if (!hasContent || !user) return;
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(async () => {
      // Suppress re-save after recovery to break the "found → recover → found" loop
      if (Date.now() < suppressDraftSaveUntil.current) return;
      try {
        const token = await getAccessToken();
        const title = [watched.artistName, watched.songTitle].filter(Boolean).join(" — ") || t("makeVideo.draftTitleFallback");
        await fetch("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
          body: JSON.stringify({ workflowType: WORKFLOW, title, draftData: { rawResult, scenes, formValues: watched, audioUrl, step, timestamp: Date.now() } }),
        });
      } catch { /* silent */ }
    }, 30_000);
    return () => { if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawResult, scenes, watched, audioUrl, step, user]);

  /* Warn before leaving with unsaved work */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if ((rawResult || watched.artistName) && !saved) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [rawResult, watched.artistName, saved]);

  /* Download draft as JSON backup */
  function downloadDraftBackup() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const payload = raw ? JSON.parse(raw) : { rawResult, scenes, formValues: watched, audioUrl, step, timestamp: Date.now() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `bdv-draft-${Date.now()}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }

  /* Recover draft — restore all fields */
  const handleRecover = useCallback(async () => {
    setDraftState("recovering");
    setDraftError(null);
    try {
      type DraftPayload = { rawResult?: string; scenes?: SceneData[]; formValues?: Partial<VideoFormValues>; audioUrl?: string | null; step?: number };
      let payload: DraftPayload | null = null;

      // Try localStorage first
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) payload = JSON.parse(raw) as DraftPayload;
      } catch { /* ignore */ }

      // Fall back to server
      if (!payload && draftId) {
        const token = await getAccessToken();
        const res = await fetch(`/api/drafts/${draftId}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (res.ok) {
          const body = await res.json() as { draft: { draft_data: DraftPayload } };
          payload = body.draft.draft_data;
        }
      }
      if (!payload && !draftId) {
        // Last resort: check server by workflow
        const token = await getAccessToken();
        const res = await fetch(`/api/drafts?workflow=${WORKFLOW}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (res.ok) {
          const body = await res.json() as { drafts: Array<{ id: string; draft_data: DraftPayload }> };
          if (body.drafts.length > 0) { payload = body.drafts[0].draft_data; setDraftId(body.drafts[0].id); }
        }
      }

      if (!payload) throw new Error(t("makeVideo.draftNotFound"));

      // Restore all fields
      if (payload.rawResult) setRawResult(payload.rawResult);
      if (payload.scenes?.length) setScenes(payload.scenes);
      if (payload.audioUrl) setAudioUrl(payload.audioUrl);
      if (payload.formValues) {
        const fv = payload.formValues;
        (Object.keys(fv) as Array<keyof VideoFormValues>).forEach((k) => {
          const v = fv[k];
          if (typeof v === "string") setValue(k, v);
        });
      }
      // Restore the workflow step directly — bypass canReach guards since data is already loaded
      if (typeof payload.step === "number" && payload.step >= 1 && payload.step <= 6) {
        setStep(payload.step);
      } else if (payload.scenes?.length) {
        setStep(5); // had scenes → open at Scene Clips
      } else if (payload.rawResult) {
        setStep(4); // had plan → open at Create Plan
      }

      // Clear draft after successful recovery
      localStorage.removeItem(DRAFT_KEY);
      if (draftId) {
        getAccessToken().then((token) => fetch(`/api/drafts/${draftId}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` },
        })).catch(() => { /* silent */ });
      }

      // Suppress auto-save for 10 minutes so recovered data doesn't re-create the draft
      suppressDraftSaveUntil.current = Date.now() + 10 * 60 * 1000;

      setDraftState("recovered");
      setTimeout(() => setDraftState("idle"), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("makeVideo.draftNotFoundBackup");
      setDraftError(msg);
      setDraftState("failed");
    }
  }, [draftId, getAccessToken, setValue]);

  const handleDiscardDraft = useCallback(async () => {
    localStorage.removeItem(DRAFT_KEY);
    if (draftId) {
      try {
        const token = await getAccessToken();
        await fetch(`/api/drafts/${draftId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` } });
      } catch { /* silent */ }
    }
    setDraftState("idle");
    setDraftId(null);
    setDraftInfo(null);
  }, [draftId, getAccessToken]);

  /* ── Save project ── */
  async function performSave(opts?: { result?: string; sceneData?: SceneData[]; ghid?: string | null }) {
    if (!user) return;
    const resultToSave = opts?.result    ?? rawResult ?? "";
    const scenesToSave = opts?.sceneData ?? scenes;
    const histId       = (opts !== undefined && "ghid" in opts) ? opts.ghid : genHistoryId;
    if (!resultToSave) return;

    setSaving(true);
    setAutoSaveStatus("saving");
    setSaveError(null);
    setCreditRefunded(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectType:  "Make a Music Video",
          title:        [watched.artistName, watched.songTitle].filter(Boolean).join(" - ") || t("makeVideo.defaultProjectTitle"),
          artistName:   watched.artistName || null,
          songTitle:    watched.songTitle  || null,
          genre:        watched.genre      || null,
          mood:         watched.mood       || null,
          inputData:    watched as unknown as Record<string, unknown>,
          outputData: {
            result: resultToSave,
            ...(songStructure ? { songStructure } : {}),
            ...(scenesToSave.length > 0 ? { scenes: scenesToSave } : {}),
          },
          creditsUsed:  1,
          genHistoryId: histId ?? null,
        }),
      });
      const body = await res.json() as { id?: string; error?: string; refunded?: boolean };
      if (!res.ok) {
        if (body.refunded) {
          setCreditRefunded(true);
          refreshProfile();
          toast({ title: t("makeVideo.toastRefundedTitle"), description: t("makeVideo.toastRefundedDesc"), variant: "destructive" });
        } else {
          const msg = body.error ?? `Save failed (HTTP ${res.status})`;
          setSaveError(msg);
          toast({ title: t("makeVideo.toastSaveFailedTitle"), description: msg, variant: "destructive" });
        }
        setAutoSaveStatus("failed");
        return;
      }
      setSavedProjectId(body.id ?? null);
      setSaved(true);
      setAutoSaveStatus("saved");
      localStorage.removeItem(DRAFT_KEY);
      if (draftId) {
        fetch(`/api/drafts/${draftId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` } }).catch(() => {});
        setDraftId(null);
      }
      toast({ title: t("makeVideo.toastProjectSavedTitle"), description: t("makeVideo.toastProjectSavedDesc") });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("makeVideo.saveFailedRetry");
      setSaveError(msg);
      setAutoSaveStatus("failed");
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() { await performSave(); }

  /* ── Autosave scenes ── */
  async function handleScenesChange(updated: SceneData[]) {
    setScenes(updated);
    for (const sc of updated) {
      const url = sc.demoClipUrl;
      if (url && !reportedClipUrls.current.has(url)) {
        reportedClipUrls.current.add(url);
        addAsset({
          kind: "video",
          url,
          label: t("makeVideo.sceneAssetLabel", { n: sc.sceneNumber, section: sc.section || t("makeVideo.clipFallback") }),
          detail: sc.action ? sc.action.slice(0, 60) : t("makeVideo.sceneAssetDetail"),
        });
      }
    }
    if (!savedProjectId) return;
    try {
      const token = await getAccessToken();
      await fetch(`/api/projects/${savedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ scenes: updated }),
      });
    } catch { /* silent */ }
  }

  async function saveScenes() {
    if (!savedProjectId) {
      toast({ title: t("makeVideo.toastSaveFirstTitle"), description: t("makeVideo.toastSaveFirstDesc"), variant: "destructive" });
      return;
    }
    setSavingScenes(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/projects/${savedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ scenes }),
      });
      if (!res.ok) throw new Error();
      toast({ title: t("makeVideo.toastScenesSavedTitle") });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSavingScenes(false);
    }
  }

  /* ── Continue with active artist (skip Artist/Brand form) ── */
  function handleContinueWithActiveArtist() {
    const vault = activeArtist ?? loadedVault;
    if (!vault) return;
    setValue("artistName", vault.artist_name);
    const desc = [
      vault.personality,
      vault.hair           ? `${t("makeVideo.hairLabel")}: ${vault.hair}`                 : null,
      vault.tattoos        ? `${t("makeVideo.tattoosLabel")}: ${vault.tattoos}`           : null,
      vault.jewelry        ? `${t("makeVideo.jewelryLabel")}: ${vault.jewelry}`           : null,
      vault.clothing_style ? `${t("makeVideo.clothingLabel")}: ${vault.clothing_style}`   : null,
    ].filter(Boolean).join(". ");
    setValue("artistDescription", desc || vault.artist_name);
    if (vault.brand_colors)       setValue("brandColors", vault.brand_colors);
    if (vault.visual_style)       setValue("visualStyleRules", vault.visual_style);
    if (vault.do_not_change_rules) setValue("doNotChangeRules", vault.do_not_change_rules);
    setLoadedVault(vault);
    setStep(3);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
  }

  function canAdvance(from: number): boolean {
    if (from === 1) return !!watched.artistName?.trim();
    if (from === 2) return !!watched.artistDescription?.trim() || !!loadedVault;
    if (from === 4) return !!rawResult;
    return true;
  }

  function canReach(target: number): boolean {
    if (target <= step) return true;
    for (let s = step; s < target; s++) if (!canAdvance(s)) return false;
    return true;
  }

  function goToStep(target: number) {
    if (target < 1 || target > 6 || !canReach(target)) return;
    setStep(target);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
  }

  /* ── Parsed output sections ── */
  const parsedSections = rawResult ? parseSections(rawResult) : [];
  const videoStyleVal = watched.videoStyle || undefined;
  const platformVal = watched.platform || undefined;

  /* ── Next button label ── */
  function nextLabel(s: number): string {
    if (s === 1) return t("makeVideo.nextArtistBrand");
    if (s === 2) return t("makeVideo.nextVideoDirection");
    if (s === 3) return t("makeVideo.nextReviewCreate");
    if (s === 4) return rawResult ? t("makeVideo.nextSceneClips") : t("makeVideo.createPlanFirst");
    if (s === 5) return t("makeVideo.nextDownloadShare");
    return t("makeVideo.next");
  }

  /* ── Download helpers ── */
  function handleDownloadTxt() {
    if (!rawResult) return;
    downloadTxt({
      projectType: "Make a Music Video",
      artistName: watched.artistName,
      songTitle: watched.songTitle,
      genre: watched.genre,
      mood: watched.mood,
      result: rawResult,
    });
  }

  function handleDownloadPdf() {
    if (!rawResult) return;
    downloadPdf({
      projectType: "Make a Music Video",
      artistName: watched.artistName,
      songTitle: watched.songTitle,
      genre: watched.genre,
      mood: watched.mood,
      result: rawResult,
    });
  }

  /* ── Reset ── */
  function handleReset() {
    setRawResult(null);
    setError(null);
    setOutOfCredits(false);
    setScenes([]);
    setSavedProjectId(null);
    setSaved(false);
    setStep(1);
  }

  return (
    <div className="min-h-screen bg-black text-white lux-page">

      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          {t("makeVideo.backToDashboard")}
        </Link>

        {/* ── Draft Recovery Modal ── */}
        {draftState !== "idle" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl overflow-hidden">
              {draftState === "found" && (
                <div className="p-6 space-y-5">
                  <div>
                    <p className="text-[10px] font-bold text-yellow-400/70 uppercase tracking-widest mb-2">{t("makeVideo.draftFoundTitle")}</p>
                    <p className="text-lg font-black text-white leading-tight">{draftInfo?.title ?? t("makeVideo.previousSession")}</p>
                    {draftInfo?.updated && <p className="text-xs text-white/35 mt-1">Last saved {draftInfo.updated}</p>}
                  </div>
                  <p className="text-sm text-white/50">{t("makeVideo.draftFoundHint")}</p>
                  <div className="space-y-2.5">
                    <Button onClick={() => { void handleRecover(); }} className="w-full gold-glow font-bold gap-2 h-11">
                      <RefreshCcw className="h-4 w-4" /> {t("makeVideo.recoverDraft")}
                    </Button>
                    <button onClick={downloadDraftBackup}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors font-semibold">
                      <Download className="h-4 w-4" /> {t("makeVideo.downloadBackupJson")}
                    </button>
                    <button onClick={() => { void handleDiscardDraft(); }}
                      className="w-full py-2 text-sm text-white/25 hover:text-white/50 transition-colors">
                      {t("makeVideo.discardDraft")}
                    </button>
                  </div>
                </div>
              )}
              {draftState === "recovering" && (
                <div className="p-8 flex flex-col items-center gap-4">
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <div className="text-center">
                    <p className="font-bold text-white">{t("makeVideo.recoveringDraft")}</p>
                    <p className="text-xs text-white/40 mt-1">{t("makeVideo.restoringContent")}</p>
                  </div>
                </div>
              )}
              {draftState === "recovered" && (
                <div className="p-8 flex flex-col items-center gap-4">
                  <div className="h-14 w-14 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                    <Check className="h-7 w-7 text-green-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-black text-white text-lg">{t("makeVideo.draftRecovered")}</p>
                    <p className="text-xs text-white/40 mt-1">{t("makeVideo.projectRestored")}</p>
                  </div>
                </div>
              )}
              {draftState === "failed" && (
                <div className="p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center shrink-0">
                      <X className="h-4 w-4 text-red-400" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{t("makeVideo.recoveryFailed")}</p>
                      <p className="text-xs text-red-300/80 mt-0.5 leading-relaxed">{draftError}</p>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <button onClick={downloadDraftBackup}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-primary/30 bg-primary/[0.07] text-sm text-primary hover:bg-primary/15 transition-colors font-semibold">
                      <Download className="h-4 w-4" /> {t("makeVideo.downloadBackupJson")}
                    </button>
                    <button onClick={() => { void handleDiscardDraft(); }}
                      className="w-full py-2 text-sm text-white/25 hover:text-white/50 transition-colors">
                      {t("makeVideo.dismiss")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <Video className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">{t("makeVideo.priceBadge")}</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {t("makeVideo.title")}
          </h1>
          <p className="text-white/50 text-base md:text-lg max-w-2xl">
            {t("makeVideo.subtitle")}
          </p>
        </div>

        {/* ── Stepper ── */}
        <div className="mb-8">
          {/* Progress bar */}
          <div className="relative h-1 bg-white/[0.06] rounded-full mb-5 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-500"
              style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
            />
          </div>
          {/* Step dots */}
          <div className="flex items-center justify-between gap-1">
            {STEPS.map((s) => {
              const isActive = step === s.n;
              const isDone = step > s.n;
              const reachable = canReach(s.n);
              return (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => goToStep(s.n)}
                  disabled={!reachable}
                  className={`flex flex-col items-center gap-1.5 min-w-0 transition-opacity ${!reachable ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid={`step-tab-${s.n}`}
                >
                  <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors ${
                    isActive  ? "bg-primary border-primary text-black" :
                    isDone    ? "bg-primary/20 border-primary/40 text-primary" :
                    "bg-white/5 border-white/10 text-white/40"
                  }`}>
                    {isDone
                      ? <Check className="h-3.5 w-3.5" />
                      : <span className="text-xs font-black">{s.n}</span>}
                  </span>
                  <span className={`text-[10px] font-bold hidden sm:block whitespace-nowrap ${
                    isActive ? "text-primary" : isDone ? "text-white/50" : "text-white/30"
                  }`}>
                    {t(s.shortKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Alerts ── */}
        {outOfCredits && <div className="mb-6"><OutOfCredits /></div>}
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* ── Step Content ── */}
        <div className="lux-card-static p-6 md:p-8">

          {/* STEP 1 — Song Setup */}
          {step === 1 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-xl font-black text-white mb-1">{t("makeVideo.step1Label")}</h2>
                <p className="text-sm text-white/40">{t("makeVideo.step1Hint")}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label={t("makeVideo.artistNameLabel")}>
                  <Input
                    {...register("artistName", { required: true })}
                    placeholder={t("makeVideo.artistNamePlaceholder")}
                    className={inputClass + (errors.artistName ? " border-red-500/50" : "")}
                  />
                  {errors.artistName && <p className="text-red-400 text-xs mt-1">{t("makeVideo.required")}</p>}
                </FieldWrapper>
                <FieldWrapper label={t("makeVideo.songTitleLabel")}>
                  <Input {...register("songTitle")} placeholder={t("makeVideo.songTitlePlaceholder")} className={inputClass} />
                </FieldWrapper>
              </div>

              {/* Genre + Mood — style picks (2) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="2">
                <FieldWrapper label={t("makeVideo.genreLabel")}>
                  <StyledSelect name="genre" placeholder={t("makeVideo.selectGenre")} options={GENRES}
                    value={watched.genre} onChange={(v) => setValue("genre", v)} />
                </FieldWrapper>
                <FieldWrapper label={t("makeVideo.moodLabel")}>
                  <StyledSelect name="mood" placeholder={t("makeVideo.selectMood")} options={MOODS}
                    value={watched.mood} onChange={(v) => setValue("mood", v)} />
                </FieldWrapper>
              </div>

              <ProjectFlowBar
                kinds={["song"]}
                actionLabel={t("makeVideo.useTrack")}
                onPick={(asset) => { setAudioUrl(asset.url); setSongSegment(null); }}
              />
              <FieldWrapper label={t("makeVideo.uploadSongLabel")} hint={t("makeVideo.uploadSongHint")}>
                <AudioTranscribe
                  onTranscript={(text) => { setValue("lyrics", text); setSongStructure(null); }}
                  onFileUrl={(url) => { setAudioUrl(url); setSongSegment(null); }}
                  onFile={(f) => { setAudioFile(f); setSongSegment(null); }}
                />
                {audioUrl && <ReferenceAudioPlayer url={audioUrl} label="Your Song" />}
                {audioUrl && (
                  <div className="mt-3">
                    <SongSegmentPicker
                      audioUrl={audioUrl}
                      label="Pick your section"
                      initialSegment={songSegment}
                      onLock={setSongSegment}
                    />
                  </div>
                )}
              </FieldWrapper>

              <FieldWrapper label={t("makeVideo.lyricsLabel")} hint={t("makeVideo.lyricsHint")}>
                <Textarea
                  {...register("lyrics")}
                  placeholder={t("makeVideo.lyricsPlaceholder")}
                  className={textareaClass}
                  style={{ minHeight: "160px" }}
                />
                {watched.lyrics.length > 10 && (
                  <div className="flex items-center gap-3 flex-wrap pt-1">
                    <button
                      type="button"
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors border border-primary/25 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {analyzing
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("makeVideo.analyzing")}</>
                        : <><BarChart2 className="h-4 w-4" /> {t("makeVideo.findHookVerses")}</>}
                    </button>
                    {songStructure && !analyzing && (
                      <span className="text-xs text-primary/60 flex items-center gap-1.5">
                        <Check className="h-3 w-3" /> {t("makeVideo.analysisComplete")}
                      </span>
                    )}
                    {analyzeError && <p className="text-xs text-red-400/80">{analyzeError}</p>}
                  </div>
                )}
              </FieldWrapper>

              {songStructure && <SongSectionAnalysis analysis={songStructure} />}

              {/* "Skip the text plan" — pro alternate generation flow (5) */}
              {audioUrl && watched.lyrics.length > 10 && (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-min-stars="5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary shrink-0" /> {t("makeVideo.skipTextPlan")}
                    </p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {t("makeVideo.skipTextPlanHint")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateScenesFromAudio}
                    disabled={generatingScenesFromAudio}
                    data-testid="btn-generate-scenes-from-audio"
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors bg-primary text-black hover:bg-primary/90 disabled:opacity-50 shrink-0"
                  >
                    {generatingScenesFromAudio
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("makeVideo.generatingScenes")}</>
                      : <><Clapperboard className="h-4 w-4" /> {t("makeVideo.generateScenesFromSong")}</>}
                  </button>
                  {audioSceneError && <p className="text-xs text-red-400/80 basis-full">{audioSceneError}</p>}
                </div>
              )}
            </div>
          )}

          {/* STEP 2 — Artist / Brand */}
          {step === 2 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-xl font-black text-white mb-1">{t("makeVideo.step2Label")}</h2>
                <p className="text-sm text-white/40">
                  {activeArtist ? t("makeVideo.activeArtistReady") : t("makeVideo.step2Hint")}
                </p>
              </div>

              {/* ── Active artist shortcut ── */}
              {activeArtist ? (
                <ActiveArtistBanner
                  artist={activeArtist}
                  onContinue={handleContinueWithActiveArtist}
                />
              ) : (
                <>
                  {/* Artist vault preset pick — gated at level 2 (key presets / style picks) */}
                  <div data-min-stars="2">
                    <ArtistVaultSelector onLoad={handleVaultLoad} loadedVaultId={loadedVault?.id} loadedVault={loadedVault} context="video" />
                  </div>

                  <FieldWrapper label={t("makeVideo.artistDescriptionLabel")}>
                    <Textarea
                      {...register("artistDescription", { required: !loadedVault })}
                      placeholder={t("makeVideo.artistDescriptionPlaceholder")}
                      className={textareaClass + (errors.artistDescription ? " border-red-500/50" : "")}
                      style={{ minHeight: "120px" }}
                    />
                    {errors.artistDescription && <p className="text-red-400 text-xs mt-1">{t("makeVideo.required")}</p>}
                  </FieldWrapper>

                  {/* Brand Colors — tweak option (3) */}
                  <div data-min-stars="3">
                    <FieldWrapper label={t("makeVideo.brandColorsLabel")} hint={t("makeVideo.brandColorsHint")}>
                      <Input
                        {...register("brandColors")}
                        placeholder={t("makeVideo.brandColorsPlaceholder")}
                        className={inputClass}
                      />
                    </FieldWrapper>
                  </div>

                  {/* Visual Style Rules — tweak options (3) */}
                  <div data-min-stars="3">
                    <FieldWrapper label={t("makeVideo.visualStyleRulesLabel")} hint={t("makeVideo.visualStyleRulesHint")}>
                      <Textarea
                        {...register("visualStyleRules")}
                        placeholder={t("makeVideo.visualStyleRulesPlaceholder")}
                        className={textareaClass}
                        style={{ minHeight: "90px" }}
                      />
                    </FieldWrapper>
                  </div>

                  {/* Do Not Change Rules — manual overrides (4) */}
                  <div data-min-stars="4">
                    <FieldWrapper label={t("makeVideo.doNotChangeRulesLabel")} hint={t("makeVideo.doNotChangeRulesHint")}>
                      <Textarea
                        {...register("doNotChangeRules")}
                        placeholder={t("makeVideo.doNotChangeRulesPlaceholder")}
                        className={textareaClass}
                        style={{ minHeight: "90px" }}
                      />
                    </FieldWrapper>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3 — Video Direction */}
          {step === 3 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-xl font-black text-white mb-1">{t("makeVideo.step3Label")}</h2>
                <p className="text-sm text-white/40">{t("makeVideo.step3Hint")}</p>
              </div>

              {/* Video Style + Platform — style picks (2) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="2">
                <FieldWrapper label={t("makeVideo.videoStyleLabel")}>
                  <StyledSelect name="videoStyle" placeholder={t("makeVideo.selectStyle")} options={VIDEO_STYLES}
                    value={watched.videoStyle} onChange={(v) => setValue("videoStyle", v)} />
                </FieldWrapper>
                <FieldWrapper label={t("makeVideo.platformLabel")}>
                  <StyledSelect name="platform" placeholder={t("makeVideo.selectPlatform")} options={PLATFORMS}
                    value={watched.platform} onChange={(v) => setValue("platform", v)} />
                </FieldWrapper>
              </div>

              {/* Video Length — tweak option (3) */}
              <div data-min-stars="3">
                <FieldWrapper label={t("makeVideo.videoLengthLabel")}>
                  <StyledSelect name="videoLength" placeholder={t("makeVideo.selectLength")} options={LENGTHS}
                    value={watched.videoLength} onChange={(v) => setValue("videoLength", v)} />
                </FieldWrapper>
              </div>

              {/* Location Ideas — tweak options (3) */}
              <div data-min-stars="3">
                <FieldWrapper label={t("makeVideo.locationIdeasLabel")} hint={t("makeVideo.locationIdeasHint")}>
                  <Textarea
                    {...register("locationIdeas")}
                    placeholder={t("makeVideo.locationIdeasPlaceholder")}
                    className={textareaClass}
                    style={{ minHeight: "90px" }}
                  />
                </FieldWrapper>
              </div>

              {/* Special Visual Instructions — manual prompt editing (4) */}
              <div data-min-stars="4">
                <FieldWrapper label={t("makeVideo.specialInstructionsLabel")} hint={t("makeVideo.specialInstructionsHint")}>
                  <Textarea
                    {...register("specialInstructions")}
                    placeholder={t("makeVideo.specialInstructionsPlaceholder")}
                    className={textareaClass}
                    style={{ minHeight: "90px" }}
                  />
                </FieldWrapper>
              </div>
            </div>
          )}

          {/* STEP 4 — Generate Video Plan */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">{t("makeVideo.step4Title")}</h2>
                <p className="text-sm text-white/40">{t("makeVideo.step4Hint")}</p>
              </div>

              {!rawResult ? (
                <div className="space-y-5">
                  {/* Summary tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: t("makeVideo.summaryArtist"), value: watched.artistName || "—" },
                      { label: t("makeVideo.summarySong"), value: watched.songTitle || "—" },
                      { label: t("makeVideo.summaryGenre"), value: watched.genre || "—" },
                      { label: t("makeVideo.summaryMood"), value: watched.mood || "—" },
                      { label: t("makeVideo.summaryStyle"), value: watched.videoStyle || "—" },
                      { label: t("makeVideo.summaryPlatform"), value: watched.platform || "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="lux-card-static px-4 py-3">
                        <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider mb-1">{label}</p>
                        <p className="text-sm font-semibold text-white truncate">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* What you get */}
                  <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 space-y-4">
                    <p className="text-sm font-bold text-white/70 uppercase tracking-wider">{t("makeVideo.whatYouGet")}</p>
                    <ul className="space-y-2">
                      {[
                        t("makeVideo.sectionDirectorsTreatment"),
                        t("makeVideo.sectionSceneBreakdown"),
                        t("makeVideo.getAiPrompts"),
                        t("makeVideo.getVisualConcept"),
                        t("makeVideo.sectionThumbnailPrompts"),
                        t("makeVideo.sectionPromoClips"),
                        t("makeVideo.sectionCaptionIdeas"),
                        ...(songStructure ? [t("makeVideo.getSongStructure")] : []),
                      ].map((item) => (
                        <li key={item} className="flex items-center gap-2 text-sm text-white/60">
                          <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>

                    <Button
                      type="button"
                      size="lg"
                      onClick={handleSubmit(onGenerate)}
                      disabled={loading}
                      className="gold-glow font-bold text-base w-full gap-3 rounded-xl mt-2"
                      style={{ height: "52px" }}
                      data-testid="btn-generate-plan"
                    >
                      {loading
                        ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("makeVideo.buildingPlan")}</>
                        : <><Sparkles className="h-5 w-5" /> {t("makeVideo.createVideoPlan")}</>}
                    </Button>
                    <p className="text-white/25 text-xs text-center">{t("makeVideo.usesCredits")}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Result ready header */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-green-500/20 bg-green-500/5">
                    <span className="h-2.5 w-2.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
                    <p className="text-sm font-bold text-white/80">{t("makeVideo.planReady")}</p>
                    <button
                      type="button"
                      onClick={() => { setRawResult(null); setScenes([]); }}
                      className="ml-auto text-xs text-white/30 hover:text-white/60 transition-colors"
                    >
                      {t("makeVideo.regenerate")}
                    </button>
                  </div>

                  {/* Collapsible output cards */}
                  <div className="space-y-2">
                    {parsedSections.map((section, i) => {
                      const meta = SECTION_META[section.key];
                      return (
                        <OutputCard
                          key={section.key}
                          label={meta ? t(meta.labelKey) : section.key.replace(/_/g, " ")}
                          content={section.content}
                          icon={meta.icon}
                          defaultOpen={i === 0}
                        />
                      );
                    })}

                    {/* Song Structure card if available */}
                    {songStructure && (
                      <div className="lux-card-static overflow-hidden">
                        <div className="px-5 py-4 flex items-center gap-3">
                          <span className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <BarChart2 className="h-3.5 w-3.5 text-primary" />
                          </span>
                          <span className="font-bold text-sm text-white">{t("makeVideo.songStructureAnalysis")}</span>
                        </div>
                        <div className="px-5 pb-5 border-t border-white/[0.06]">
                          <SongSectionAnalysis analysis={songStructure} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Scene count badge */}
                  {scenes.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <Clapperboard className="h-4 w-4 text-primary/60" />
                      <p className="text-sm text-white/50">
                        <span className="text-white/80 font-semibold">{t("makeVideo.scenesExtracted", { count: scenes.length })}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 5 — Scene Clips */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">{t("makeVideo.step5Title")}</h2>
                <p className="text-sm text-white/40">{t("makeVideo.step5Hint")}</p>
              </div>

              {/* Runway note */}
              <div className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
                <Volume2 className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
                <p className="text-xs text-white/55 leading-relaxed">
                  {t("makeVideo.runwayNotePrefix")}<span className="text-white/80 font-semibold">{t("makeVideo.runwayNoteEmphasis")}</span>{t("makeVideo.runwayNoteSuffix")}
                </p>
              </div>

              {scenes.length > 0 ? (
                !storyboardApproved ? (
                  <StoryboardReview
                    scenes={scenes}
                    onApprove={(approvedScenes) => {
                      setScenes(approvedScenes);
                      setStoryboardApproved(true);
                      handleScenesChange(approvedScenes);
                    }}
                  />
                ) : (
                  <SceneStudio
                    scenes={scenes}
                    onScenesChange={handleScenesChange}
                    artistVault={loadedVault}
                    videoStyle={videoStyleVal}
                    platform={platformVal}
                    manageable
                    onSave={saveScenes}
                    saving={savingScenes}
                    projectId={savedProjectId}
                  />
                )
              ) : (
                <div className="lux-card-static px-6 py-10 text-center">
                  <Clapperboard className="h-8 w-8 text-white/20 mx-auto mb-3" />
                  <p className="text-sm text-white/40">{t("makeVideo.noScenes")}</p>
                  <button
                    type="button"
                    onClick={() => goToStep(4)}
                    className="mt-4 text-sm text-primary/70 hover:text-primary transition-colors"
                  >
                    {t("makeVideo.backToCreatePlan")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 6 — Next Actions */}
          {step === 6 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">{t("makeVideo.step6Label")}</h2>
                <p className="text-sm text-white/40">{t("makeVideo.step6Hint")}</p>
              </div>

              <div className="space-y-3">

                {/* Save Project */}
                <div className="lux-card-static p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Save className="h-4 w-4 text-primary" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">{t("makeVideo.saveProject")}</p>
                      <p className="text-xs text-white/40 mt-0.5">{t("makeVideo.saveProjectHint")}</p>
                    </div>
                  </div>
                  {saved ? (
                    <div className="flex items-center gap-2 text-green-400 font-bold text-sm shrink-0">
                      <Check className="h-4 w-4" /> {t("makeVideo.projectSaved")}
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {autoSaveStatus === "saving" && (
                        <p className="text-[11px] text-white/40 flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" /> {t("makeVideo.savingGeneration")}
                        </p>
                      )}
                      {autoSaveStatus === "failed" && creditRefunded && (
                        <p className="text-[11px] text-amber-400 text-right max-w-[220px]">{t("makeVideo.refundedNoticePrefix")}<strong>{t("makeVideo.generationHistory")}</strong>{t("makeVideo.refundedNoticeSuffix")}</p>
                      )}
                      <Button
                        onClick={handleSave}
                        disabled={saving || !rawResult}
                        className="gold-glow font-bold gap-2"
                        data-testid="btn-save-project"
                      >
                        {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("makeVideo.saving")}</> : <><Save className="h-4 w-4" /> {t("makeVideo.saveProject")}</>}
                      </Button>
                      {saveError && (
                        <p className="text-[11px] text-red-400 text-right max-w-[200px]">{t("makeVideo.saveFailedPrefix")}{saveError}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Open Video Editor */}
                <div className="lux-card-static p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Clapperboard className="h-4 w-4 text-primary" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">{t("makeVideo.openVideoEditor")}</p>
                      <p className="text-xs text-white/40 mt-0.5">
                        {savedProjectId ? t("makeVideo.openEditorHint") : t("makeVideo.openEditorHintLocked")}
                      </p>
                    </div>
                  </div>
                  {savedProjectId ? (
                    <Link href={`/video-editor?project=${savedProjectId}`}>
                      <Button className="gold-glow font-bold gap-2 shrink-0" data-testid="btn-open-video-editor">
                        <ExternalLink className="h-4 w-4" /> {t("makeVideo.openEditor")}
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      disabled
                      className="font-bold gap-2 shrink-0 opacity-40"
                      data-testid="btn-open-video-editor-disabled"
                    >
                      <ExternalLink className="h-4 w-4" /> {t("makeVideo.openEditor")}
                    </Button>
                  )}
                </div>

                {/* My Generated Clips */}
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                      <Video className="h-4 w-4 text-primary" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">{t("makeVideo.myGeneratedClips")}</p>
                      <p className="text-xs text-white/40 mt-0.5">{t("makeVideo.myClipsHint")}</p>
                    </div>
                  </div>
                  <Link href="/my-clips">
                    <Button className="gold-glow font-bold gap-2 shrink-0">
                      <Video className="h-4 w-4" /> {t("makeVideo.viewMyClips")}
                    </Button>
                  </Link>
                </div>

                {/* Generate Promo Clips */}
                <div className="lux-card-static p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Film className="h-4 w-4 text-primary" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">{t("makeVideo.generatePromoClips")}</p>
                      <p className="text-xs text-white/40 mt-0.5">{t("makeVideo.promoClipsHint")}</p>
                    </div>
                  </div>
                  <Link href="/promo-clip">
                    <Button variant="outline" className="border-white/10 bg-white/5 text-white/80 hover:bg-white/10 gap-2 shrink-0">
                      <ExternalLink className="h-4 w-4" /> {t("makeVideo.makePromoClips")}
                    </Button>
                  </Link>
                </div>

                {/* Download TXT */}
                <div className="lux-card-static p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-white/50" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">{t("makeVideo.downloadTxt")}</p>
                      <p className="text-xs text-white/40 mt-0.5">{t("makeVideo.downloadTxtHint")}</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleDownloadTxt}
                    disabled={!rawResult}
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white/80 hover:bg-white/10 gap-2 shrink-0"
                    data-testid="btn-download-txt"
                  >
                    <Download className="h-4 w-4" /> {t("makeVideo.downloadTxt")}
                  </Button>
                </div>

                {/* Download PDF */}
                <div className="lux-card-static p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-white/50" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">{t("makeVideo.downloadPdf")}</p>
                      <p className="text-xs text-white/40 mt-0.5">{t("makeVideo.downloadPdfHint")}</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleDownloadPdf}
                    disabled={!rawResult}
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white/80 hover:bg-white/10 gap-2 shrink-0"
                    data-testid="btn-download-pdf"
                  >
                    <Download className="h-4 w-4" /> {t("makeVideo.downloadPdf")}
                  </Button>
                </div>
              </div>

              {/* Start over */}
              <p className="text-center pt-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  {t("makeVideo.startNewPlan")}
                </button>
              </p>
            </div>
          )}

          {/* ── Footer navigation ── */}
          <div className="flex items-center justify-between gap-4 mt-10 pt-6 border-t border-white/[0.06]">
            <Button
              type="button"
              variant="outline"
              onClick={() => goToStep(step - 1)}
              disabled={step === 1}
              className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white gap-2 disabled:opacity-30"
              data-testid="btn-wizard-back"
            >
              <ChevronLeft className="h-4 w-4" /> {t("makeVideo.back")}
            </Button>

            {step < 6 && (
              <Button
                type="button"
                onClick={() => goToStep(step + 1)}
                disabled={!canAdvance(step)}
                className="gold-glow font-bold gap-2 disabled:opacity-40"
                data-testid="btn-wizard-next"
              >
                {nextLabel(step)} <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

      </div>

      {/* ── Dev debug overlay ── */}
      {import.meta.env.DEV && (
        <div className="fixed bottom-4 left-4 z-40 text-[10px] font-mono text-white/30 bg-black/70 rounded-lg px-3 py-2 space-y-0.5 border border-white/5 pointer-events-none">
          <p>Step {step}: {t(STEPS.find(s => s.n === step)?.labelKey ?? "makeVideo.unknownStep")}</p>
          <p>Draft: {draftState}{draftId ? " (server)" : draftState !== "idle" ? " (local)" : ""}</p>
          <p>Plan: {rawResult ? `${rawResult.length} chars` : "none"} · Scenes: {scenes.length}</p>
        </div>
      )}
    </div>
  );
}
