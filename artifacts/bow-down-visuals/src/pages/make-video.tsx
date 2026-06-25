import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Video, ArrowLeft, Loader2, ChevronRight, ChevronLeft, BarChart2, Check,
  Music2, Palette, Sparkles, Clapperboard, Volume2, Download,
  Film, Camera, MapPin, ChevronDown, ChevronUp, Save,
  FileText, ExternalLink,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import { SceneStudio } from "@/components/SceneStudio";
import { ActiveArtistBanner } from "@/components/ActiveArtistBanner";
import { ReferenceAudioPlayer } from "@/components/ReferenceAudioPlayer";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { AudioTranscribe } from "@/components/AudioTranscribe";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import { downloadTxt, downloadPdf } from "@/lib/export-utils";

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

const GENRES = [
  "Hip Hop","Drill","Trap","R&B","Pop",
  "Afrobeats","Dancehall","Gospel","Kids Music","Rock","Country","Other",
];

const MOODS = [
  "Luxury","Dark","Emotional","Street","Romantic",
  "Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly",
];

const VIDEO_STYLES = [
  "Street Cinematic","Luxury Rap Video","Brooklyn Drill","Dark Emotional Story",
  "Performance Video","Club Video","Cartoon Music Video","Anime Music Video",
  "Kids Nursery Rhyme","Romantic R&B Visual","Documentary Style",
];

const PLATFORMS = [
  "TikTok / Reels / Shorts - 9:16",
  "YouTube Music Video - 16:9",
  "Square Social Post - 1:1",
  "All Formats",
];

const LENGTHS = ["15 seconds","30 seconds","60 seconds","Full song"];

/* ─────────────────────────── STEPPER DEFINITION ─────────────────────────── */

const STEPS = [
  { n: 1, label: "Song Setup",       short: "Song",     icon: Music2 },
  { n: 2, label: "Artist / Brand",   short: "Artist",   icon: Palette },
  { n: 3, label: "Video Direction",  short: "Direction",icon: Camera },
  { n: 4, label: "Create Plan",       short: "Create",   icon: Sparkles },
  { n: 5, label: "Scene Clips",      short: "Scenes",   icon: Clapperboard },
  { n: 6, label: "Download & Share",  short: "Share",    icon: Download },
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
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";

const textareaClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";

const selectClass =
  "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";

function StyledSelect({
  name, placeholder, options, value, onChange,
}: {
  name: string; placeholder: string; options: string[];
  value: string; onChange: (v: string) => void;
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
        {options.map((o) => (
          <option key={o} value={o} style={{ background: "#111" }}>{o}</option>
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
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
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

const SECTION_META: Record<string, { label: string; icon: React.ElementType }> = {
  "DIRECTOR'S TREATMENT":   { label: "Director's Treatment",    icon: Video },
  "VISUAL CONCEPT":         { label: "Visual Concept",          icon: Palette },
  "COLOR PALETTE":          { label: "Color Palette",           icon: Palette },
  "MAIN LOCATIONS":         { label: "Main Locations",          icon: MapPin },
  "WARDROBE & ARTIST LOOK": { label: "Wardrobe & Artist Look",  icon: Music2 },
  "CAMERA DIRECTIONS":      { label: "Camera Directions",       icon: Camera },
  "SCENE-BY-SCENE BREAKDOWN": { label: "Scene-by-Scene Breakdown", icon: Clapperboard },
  "AI VIDEO PROMPTS":       { label: "AI Video Prompts",        icon: Sparkles },
  "NEGATIVE PROMPTS":       { label: "Negative Prompts",        icon: Film },
  "THUMBNAIL PROMPTS":      { label: "Thumbnail Prompts",       icon: Film },
  "PROMO CLIP IDEAS":       { label: "Promo Clip Ideas",        icon: Film },
  "CAPTION IDEAS":          { label: "Caption Ideas",           icon: FileText },
};

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function MakeVideo() {
  const { getAccessToken, refreshProfile, user } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { toast } = useToast();

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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingScenes, setSavingScenes] = useState(false);

  type DraftState = "idle" | "found" | "recovering" | "recovered" | "failed";
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftInfo, setDraftInfo] = useState<{ title?: string; updated?: string } | null>(null);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        vault.hair ? `Hair: ${vault.hair}` : null,
        vault.tattoos ? `Tattoos: ${vault.tattoos}` : null,
        vault.jewelry ? `Jewelry: ${vault.jewelry}` : null,
        vault.clothing_style ? `Clothing: ${vault.clothing_style}` : null,
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
      setAnalyzeError("Analysis failed. You can still generate without it.");
    } finally {
      setAnalyzing(false);
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
      const { rawResult: result, creditsRemaining } = await callGenerateApi("/api/generate-video-plan", {
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
              artistType:          loadedVault.artist_type       ?? null,
              artistDescription:   values.artistDescription      || loadedVault.personality,
              visualStyle:         values.videoStyle             || loadedVault.visual_style,
              brandColors:         values.brandColors            || loadedVault.brand_colors,
              doNotChangeRules:    values.doNotChangeRules       || loadedVault.do_not_change_rules,
              specialStyleRules:   loadedVault.do_not_change_rules ?? null,
              hair:                loadedVault.hair              ?? null,
              tattoos:             loadedVault.tattoos           ?? null,
              jewelry:             loadedVault.jewelry           ?? null,
              clothingStyle:       loadedVault.clothing_style    ?? null,
              consistencyPrompt:   loadedVault.consistency_prompt ?? null,
              referenceImageUrl:   loadedVault.reference_image_url ?? null,
            }
          : undefined,
        songStructure: songStructure ?? undefined,
      }, token);

      setRawResult(result);
      setScenes(parseScenes(extractBreakdownContent(result)));
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 80);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
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
              setDraftInfo({ title: titleParts || "Unsaved draft", updated: new Date(parsed.timestamp ?? 0).toLocaleString() });
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
            setDraftInfo({ title: d.title ?? "Unsaved draft", updated: new Date(d.updated_at).toLocaleString() });
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
        rawResult, scenes, formValues: watched, audioUrl, timestamp: Date.now(),
      }));
    } catch { /* ignore */ }
  }, [rawResult, scenes, watched, audioUrl]);

  /* Auto-save to server (debounced 30 s) */
  useEffect(() => {
    const hasContent = !!(watched.artistName || watched.lyrics || rawResult);
    if (!hasContent || !user) return;
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(async () => {
      try {
        const token = await getAccessToken();
        const title = [watched.artistName, watched.songTitle].filter(Boolean).join(" — ") || "Make a Music Video Draft";
        await fetch("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
          body: JSON.stringify({ workflowType: WORKFLOW, title, draftData: { rawResult, scenes, formValues: watched, audioUrl, timestamp: Date.now() } }),
        });
      } catch { /* silent */ }
    }, 30_000);
    return () => { if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawResult, scenes, watched, audioUrl, user]);

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
      const payload = raw ? JSON.parse(raw) : { rawResult, scenes, formValues: watched, audioUrl, timestamp: Date.now() };
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
      type DraftPayload = { rawResult?: string; scenes?: SceneData[]; formValues?: Partial<VideoFormValues>; audioUrl?: string | null };
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

      if (!payload) throw new Error("Draft data not found — it may have expired.");

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

      // Clear draft after successful recovery
      localStorage.removeItem(DRAFT_KEY);
      if (draftId) {
        getAccessToken().then((token) => fetch(`/api/drafts/${draftId}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` },
        })).catch(() => { /* silent */ });
      }

      setDraftState("recovered");
      setTimeout(() => setDraftState("idle"), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recovery failed — please try downloading the backup JSON.";
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
  async function handleSave() {
    if (!user || !rawResult) return;
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectType: "Make a Music Video",
          title: [watched.artistName, watched.songTitle].filter(Boolean).join(" - ") || "Make a Music Video",
          artistName: watched.artistName || null,
          songTitle: watched.songTitle || null,
          genre: watched.genre || null,
          mood: watched.mood || null,
          inputData: watched as unknown as Record<string, unknown>,
          outputData: {
            result: rawResult,
            ...(songStructure ? { songStructure } : {}),
            ...(scenes.length > 0 ? { scenes } : {}),
          },
          creditsUsed: 1,
        }),
      });
      const body = await res.json() as { id?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSavedProjectId(body.id ?? null);
      setSaved(true);
      localStorage.removeItem(DRAFT_KEY);
      toast({ title: "Project saved!", description: "Find it in My Projects." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed — please try again";
      setSaveError(msg);
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ── Autosave scenes ── */
  async function handleScenesChange(updated: SceneData[]) {
    setScenes(updated);
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
      toast({ title: "Save your project first", description: "Use Save Project in Next Actions.", variant: "destructive" });
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
      toast({ title: "Scenes saved" });
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
      vault.hair           ? `Hair: ${vault.hair}`                 : null,
      vault.tattoos        ? `Tattoos: ${vault.tattoos}`           : null,
      vault.jewelry        ? `Jewelry: ${vault.jewelry}`           : null,
      vault.clothing_style ? `Clothing: ${vault.clothing_style}`   : null,
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
    if (s === 1) return "Artist & Brand";
    if (s === 2) return "Video Direction";
    if (s === 3) return "Review & Create Plan";
    if (s === 4) return rawResult ? "Scene Clips" : "Create plan first";
    if (s === 5) return "Download & Share";
    return "Next";
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
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* ── Draft recovery banner ── */}
        {draftState === "found" && (
          <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
            <div className="flex items-start gap-3">
              <span className="text-yellow-400 text-base shrink-0 mt-0.5">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-yellow-300">Previous draft found</p>
                {draftInfo?.title && <p className="text-xs text-white/60 mt-0.5 truncate">{draftInfo.title}</p>}
                {draftInfo?.updated && <p className="text-xs text-white/35">Last saved {draftInfo.updated}</p>}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                <button onClick={downloadDraftBackup} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors px-2 py-1.5 rounded-lg border border-white/10 hover:bg-white/5">
                  <Download className="h-3 w-3" /> Backup JSON
                </button>
                <button onClick={() => { void handleRecover(); }} className="text-xs font-bold text-yellow-300 hover:text-yellow-200 transition-colors px-3 py-1.5 rounded-lg border border-yellow-500/30 hover:bg-yellow-500/20">
                  Recover
                </button>
                <button onClick={() => { void handleDiscardDraft(); }} className="text-xs text-white/30 hover:text-white/60 transition-colors px-3 py-1.5">
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
        {draftState === "recovering" && (
          <div className="mb-6 flex items-center gap-3 px-4 py-3.5 rounded-xl border border-primary/30 bg-primary/10">
            <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
            <p className="text-sm font-bold text-primary">Recovering draft…</p>
          </div>
        )}
        {draftState === "recovered" && (
          <div className="mb-6 flex items-center gap-3 px-4 py-3.5 rounded-xl border border-green-500/30 bg-green-500/10">
            <Check className="h-4 w-4 text-green-400 shrink-0" />
            <p className="text-sm font-bold text-green-300">Draft recovered successfully</p>
          </div>
        )}
        {draftState === "failed" && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-start gap-3">
              <span className="text-red-400 shrink-0 mt-0.5">✕</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-red-300">Recovery failed: {draftError}</p>
                <p className="text-xs text-white/40 mt-0.5">Your draft may still be saved. Download the backup JSON to keep it safe.</p>
              </div>
              <button onClick={downloadDraftBackup} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 px-2 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 shrink-0">
                <Download className="h-3 w-3" /> Backup JSON
              </button>
            </div>
          </div>
        )}

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Video className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">
              1 credit
            </Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Make a Music Video
          </h1>
          <p className="text-white/50 text-base md:text-lg max-w-2xl">
            A step-by-step studio — from song setup to a cinematic AI music video plan.
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
                    {s.short}
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
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">

          {/* STEP 1 — Song Setup */}
          {step === 1 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Song Setup</h2>
                <p className="text-sm text-white/40">Tell us about the track, upload your song, and add lyrics.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Artist Name">
                  <Input
                    {...register("artistName", { required: true })}
                    placeholder="e.g. Lil Nova"
                    className={inputClass + (errors.artistName ? " border-red-500/50" : "")}
                  />
                  {errors.artistName && <p className="text-red-400 text-xs mt-1">Required</p>}
                </FieldWrapper>
                <FieldWrapper label="Song Title">
                  <Input {...register("songTitle")} placeholder="e.g. On My Way Up" className={inputClass} />
                </FieldWrapper>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Genre">
                  <StyledSelect name="genre" placeholder="Select genre..." options={GENRES}
                    value={watched.genre} onChange={(v) => setValue("genre", v)} />
                </FieldWrapper>
                <FieldWrapper label="Mood">
                  <StyledSelect name="mood" placeholder="Select mood..." options={MOODS}
                    value={watched.mood} onChange={(v) => setValue("mood", v)} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Upload Song" hint="Upload your track to get an audio preview and auto-transcribe lyrics.">
                <AudioTranscribe
                  onTranscript={(text) => { setValue("lyrics", text); setSongStructure(null); }}
                  onFileUrl={setAudioUrl}
                />
                {audioUrl && <ReferenceAudioPlayer url={audioUrl} label="Your Song" />}
              </FieldWrapper>

              <FieldWrapper label="Lyrics" hint="Paste lyrics below, or upload audio above and click Transcribe.">
                <Textarea
                  {...register("lyrics")}
                  placeholder="Paste your lyrics here — or transcribe from audio above..."
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
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing...</>
                        : <><BarChart2 className="h-4 w-4" /> Find Hook &amp; Verses</>}
                    </button>
                    {songStructure && !analyzing && (
                      <span className="text-xs text-primary/60 flex items-center gap-1.5">
                        <Check className="h-3 w-3" /> Analysis complete
                      </span>
                    )}
                    {analyzeError && <p className="text-xs text-red-400/80">{analyzeError}</p>}
                  </div>
                )}
              </FieldWrapper>

              {songStructure && <SongSectionAnalysis analysis={songStructure} />}
            </div>
          )}

          {/* STEP 2 — Artist / Brand */}
          {step === 2 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Artist / Brand</h2>
                <p className="text-sm text-white/40">
                  {activeArtist ? "Your active artist is ready to go." : "Load your vault profile or describe the artist's look and brand."}
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
                  <ArtistVaultSelector onLoad={handleVaultLoad} loadedVaultId={loadedVault?.id} loadedVault={loadedVault} />

                  <FieldWrapper label="Artist Description">
                    <Textarea
                      {...register("artistDescription", { required: !loadedVault })}
                      placeholder="Describe the artist's look, personality, and visual brand. Include wardrobe, style references, typical vibe, and anything important for the video..."
                      className={textareaClass + (errors.artistDescription ? " border-red-500/50" : "")}
                      style={{ minHeight: "120px" }}
                    />
                    {errors.artistDescription && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </FieldWrapper>

                  <FieldWrapper label="Brand Colors" hint="Primary colors to use in visuals (e.g. black, gold, deep purple).">
                    <Input
                      {...register("brandColors")}
                      placeholder="e.g. All black, silver accents, deep purple"
                      className={inputClass}
                    />
                  </FieldWrapper>

                  <FieldWrapper label="Visual Style Rules" hint="Always-on rules for every visual — lock in the brand's look.">
                    <Textarea
                      {...register("visualStyleRules")}
                      placeholder="e.g. All black wardrobe only. No bright colors. Cinematic dark tones always."
                      className={textareaClass}
                      style={{ minHeight: "90px" }}
                    />
                  </FieldWrapper>

                  <FieldWrapper label="Do Not Change Rules" hint="Hard limits — the AI will never violate these.">
                    <Textarea
                      {...register("doNotChangeRules")}
                      placeholder="e.g. Never show the artist without their chain. Never use cartoonish styles."
                      className={textareaClass}
                      style={{ minHeight: "90px" }}
                    />
                  </FieldWrapper>
                </>
              )}
            </div>
          )}

          {/* STEP 3 — Video Direction */}
          {step === 3 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Video Direction</h2>
                <p className="text-sm text-white/40">Choose the style, platform, and creative direction for your video.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Video Style">
                  <StyledSelect name="videoStyle" placeholder="Select style..." options={VIDEO_STYLES}
                    value={watched.videoStyle} onChange={(v) => setValue("videoStyle", v)} />
                </FieldWrapper>
                <FieldWrapper label="Platform">
                  <StyledSelect name="platform" placeholder="Select platform..." options={PLATFORMS}
                    value={watched.platform} onChange={(v) => setValue("platform", v)} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Video Length">
                <StyledSelect name="videoLength" placeholder="Select length..." options={LENGTHS}
                  value={watched.videoLength} onChange={(v) => setValue("videoLength", v)} />
              </FieldWrapper>

              <FieldWrapper label="Location Ideas" hint="Suggest locations, environments, or settings for your scenes.">
                <Textarea
                  {...register("locationIdeas")}
                  placeholder="e.g. Brooklyn streets at night, rooftop overlooking the city, abandoned warehouse..."
                  className={textareaClass}
                  style={{ minHeight: "90px" }}
                />
              </FieldWrapper>

              <FieldWrapper label="Special Visual Instructions" hint="Specific shots, themes, cultural references, or things to avoid.">
                <Textarea
                  {...register("specialInstructions")}
                  placeholder="Any specific shots, visual themes, cultural elements, or things to avoid..."
                  className={textareaClass}
                  style={{ minHeight: "90px" }}
                />
              </FieldWrapper>
            </div>
          )}

          {/* STEP 4 — Generate Video Plan */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Create Your Video Plan</h2>
                <p className="text-sm text-white/40">Review your setup, then create your Director's Treatment, scene breakdown, and AI prompts.</p>
              </div>

              {!rawResult ? (
                <div className="space-y-5">
                  {/* Summary tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Artist", value: watched.artistName || "—" },
                      { label: "Song", value: watched.songTitle || "—" },
                      { label: "Genre", value: watched.genre || "—" },
                      { label: "Mood", value: watched.mood || "—" },
                      { label: "Style", value: watched.videoStyle || "—" },
                      { label: "Platform", value: watched.platform || "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                        <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider mb-1">{label}</p>
                        <p className="text-sm font-semibold text-white truncate">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* What you get */}
                  <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 space-y-4">
                    <p className="text-sm font-bold text-white/70 uppercase tracking-wider">What you'll get</p>
                    <ul className="space-y-2">
                      {[
                        "Director's Treatment",
                        "Scene-by-Scene Breakdown",
                        "AI Video Prompts (Runway-ready)",
                        "Visual Concept & Color Palette",
                        "Thumbnail Prompts",
                        "Promo Clip Ideas",
                        "Caption Ideas",
                        ...(songStructure ? ["Song Structure Analysis ✓"] : []),
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
                        ? <><Loader2 className="h-5 w-5 animate-spin" /> Building your video plan...</>
                        : <><Sparkles className="h-5 w-5" /> Create Video Plan</>}
                    </Button>
                    <p className="text-white/25 text-xs text-center">Uses 1 credit per generation</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Result ready header */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-green-500/20 bg-green-500/5">
                    <span className="h-2.5 w-2.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
                    <p className="text-sm font-bold text-white/80">Video plan ready</p>
                    <button
                      type="button"
                      onClick={() => { setRawResult(null); setScenes([]); }}
                      className="ml-auto text-xs text-white/30 hover:text-white/60 transition-colors"
                    >
                      Regenerate
                    </button>
                  </div>

                  {/* Collapsible output cards */}
                  <div className="space-y-2">
                    {parsedSections.map((section, i) => {
                      const meta = SECTION_META[section.key] ?? { label: section.key.replace(/_/g, " "), icon: FileText };
                      return (
                        <OutputCard
                          key={section.key}
                          label={meta.label}
                          content={section.content}
                          icon={meta.icon}
                          defaultOpen={i === 0}
                        />
                      );
                    })}

                    {/* Song Structure card if available */}
                    {songStructure && (
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                        <div className="px-5 py-4 flex items-center gap-3">
                          <span className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <BarChart2 className="h-3.5 w-3.5 text-primary" />
                          </span>
                          <span className="font-bold text-sm text-white">Song Structure Analysis</span>
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
                        <span className="text-white/80 font-semibold">{scenes.length} scenes</span> extracted — continue to Scene Clips to generate Runway videos.
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
                <h2 className="text-xl font-black text-white mb-1">Your Scene Clips</h2>
                <p className="text-sm text-white/40">Review each scene, refine the AI prompts if needed, then generate Runway clips and approve the best ones.</p>
              </div>

              {/* Runway note */}
              <div className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
                <Volume2 className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
                <p className="text-xs text-white/55 leading-relaxed">
                  Runway clips are <span className="text-white/80 font-semibold">silent previews</span>. Your uploaded song or Music Studio mix will be added during final export.
                </p>
              </div>

              {scenes.length > 0 ? (
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
              ) : (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-6 py-10 text-center">
                  <Clapperboard className="h-8 w-8 text-white/20 mx-auto mb-3" />
                  <p className="text-sm text-white/40">No scenes yet — go back to step 4 and generate your plan.</p>
                  <button
                    type="button"
                    onClick={() => goToStep(4)}
                    className="mt-4 text-sm text-primary/70 hover:text-primary transition-colors"
                  >
                    ← Back to Create Plan
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 6 — Next Actions */}
          {step === 6 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Download & Share</h2>
                <p className="text-sm text-white/40">Save your project, open the Video Editor to build your clip, and download your files.</p>
              </div>

              <div className="space-y-3">

                {/* Save Project */}
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Save className="h-4 w-4 text-primary" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">Save Project</p>
                      <p className="text-xs text-white/40 mt-0.5">Save your video plan and scenes to My Projects.</p>
                    </div>
                  </div>
                  {saved ? (
                    <div className="flex items-center gap-2 text-green-400 font-bold text-sm shrink-0">
                      <Check className="h-4 w-4" /> Project Saved
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Button
                        onClick={handleSave}
                        disabled={saving || !rawResult}
                        className="gold-glow font-bold gap-2"
                        data-testid="btn-save-project"
                      >
                        {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> Save Project</>}
                      </Button>
                      {saveError && (
                        <p className="text-[11px] text-red-400 text-right max-w-[200px]">Save failed: {saveError}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Open Video Editor */}
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Clapperboard className="h-4 w-4 text-primary" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">Open Video Editor</p>
                      <p className="text-xs text-white/40 mt-0.5">
                        {savedProjectId ? "Edit scenes, add captions, mix audio, and export." : "Save your project first to open it in the editor."}
                      </p>
                    </div>
                  </div>
                  {savedProjectId ? (
                    <Link href={`/video-editor?project=${savedProjectId}`}>
                      <Button className="gold-glow font-bold gap-2 shrink-0" data-testid="btn-open-video-editor">
                        <ExternalLink className="h-4 w-4" /> Open Editor
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      disabled
                      className="font-bold gap-2 shrink-0 opacity-40"
                      data-testid="btn-open-video-editor-disabled"
                    >
                      <ExternalLink className="h-4 w-4" /> Open Editor
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
                      <p className="font-bold text-white text-sm">My Generated Clips</p>
                      <p className="text-xs text-white/40 mt-0.5">All your Runway clips are auto-saved here — even if project saving fails.</p>
                    </div>
                  </div>
                  <Link href="/my-clips">
                    <Button className="gold-glow font-bold gap-2 shrink-0">
                      <Video className="h-4 w-4" /> View My Clips
                    </Button>
                  </Link>
                </div>

                {/* Generate Promo Clips */}
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Film className="h-4 w-4 text-primary" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">Generate Promo Clips</p>
                      <p className="text-xs text-white/40 mt-0.5">Create short-form promo content for TikTok, Reels, and YouTube Shorts.</p>
                    </div>
                  </div>
                  <Link href="/promo-clip">
                    <Button variant="outline" className="border-white/10 bg-white/5 text-white/80 hover:bg-white/10 gap-2 shrink-0">
                      <ExternalLink className="h-4 w-4" /> Make Promo Clips
                    </Button>
                  </Link>
                </div>

                {/* Download TXT */}
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-white/50" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">Download TXT</p>
                      <p className="text-xs text-white/40 mt-0.5">Plain text export of your full video plan.</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleDownloadTxt}
                    disabled={!rawResult}
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white/80 hover:bg-white/10 gap-2 shrink-0"
                    data-testid="btn-download-txt"
                  >
                    <Download className="h-4 w-4" /> Download TXT
                  </Button>
                </div>

                {/* Download PDF */}
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-white/50" />
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">Download PDF</p>
                      <p className="text-xs text-white/40 mt-0.5">Premium branded PDF with your full video plan.</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleDownloadPdf}
                    disabled={!rawResult}
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white/80 hover:bg-white/10 gap-2 shrink-0"
                    data-testid="btn-download-pdf"
                  >
                    <Download className="h-4 w-4" /> Download PDF
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
                  Start a new Music Video plan
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
              <ChevronLeft className="h-4 w-4" /> Back
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
    </div>
  );
}
