import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Mic2, ArrowLeft, Loader2, ChevronRight, ChevronDown, ChevronUp,
  Music, Video, Film, Check, Copy, Save, FileText, FileDown, Download, RefreshCcw, X,
  Sparkles, BarChart2, Zap, BookOpen, Camera, ArrowRight,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { MarketingBadge } from "@/components/MarketingBadge";

import { callGenerateApi } from "@/lib/generate-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { MusicVideoTimeline } from "@/components/MusicVideoTimeline";
import { ActiveArtistBanner } from "@/components/ActiveArtistBanner";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { AudioTranscribe } from "@/components/AudioTranscribe";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import { downloadTxt, downloadPdf } from "@/lib/export-utils";
import { useToast } from "@/hooks/use-toast";
import { vaultToPayload } from "@/lib/prompt-improve";

/* ─────────────────────── CONSTANTS ─────────────────────── */

const GENRES = ["Hip Hop","Drill","Trap","R&B","Pop","Afrobeats","Dancehall","Gospel","Kids Music","Rock","Country","Other"];
const MOODS  = ["Luxury","Dark","Emotional","Street","Romantic","Energetic","Pain","Victory","Party","Inspirational","Funny","Kid-Friendly"];
const VIDEO_STYLES = ["Street Cinematic","Luxury Rap Video","Brooklyn Drill","Dark Emotional Story","Performance Video","Club Video","Cartoon Music Video","Anime Music Video","Kids Nursery Rhyme","Romantic R&B Visual","Documentary Style"];
const PLATFORMS = ["TikTok / Reels / Shorts - 9:16","YouTube Music Video - 16:9","Square Social Post - 1:1","All Formats"];

const SONG_SECTION_KEYS = [
  "song concept","best song title","alternate title","full lyrics","hook",
  "verse 1","verse 2","bridge","outro","ai music prompt","beat direction","vocal direction",
];

const STEPS = [
  { id: 1, label: "Song Setup",        icon: Music },
  { id: 2, label: "Artist / Brand",    icon: Mic2  },
  { id: 3, label: "Video Direction",   icon: Camera },
  { id: 4, label: "Generate",          icon: Sparkles },
  { id: 5, label: "Results",           icon: BookOpen },
];

/* ─────────────────────── TYPES ─────────────────────── */

interface FormValues {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  songTopic: string;
  cleanOrExplicit: string;
  voiceStyle: string;
  beatStyle: string;
  songLength: string;
  existingLyrics: string;
  artistDescription: string;
  visualStyleRules: string;
  brandColors: string;
  doNotChangeRules: string;
  videoStyle: string;
  platform: string;
  videoLength: string;
  locationIdeas: string;
  specialInstructions: string;
}

interface ParsedSection {
  title: string;
  content: string;
  isSceneBreakdown: boolean;
}

/* ─────────────────────── HELPERS ─────────────────────── */

function parseSections(raw: string): ParsedSection[] {
  const lines = raw.split("\n");
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      const title = line.replace(/^## /, "").trim();
      current = { title, content: "", isSceneBreakdown: /scene.by.scene|scene breakdown/i.test(title) };
    } else if (current) {
      current.content += line + "\n";
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ ...s, content: s.content.trim() })).filter((s) => s.content.length > 0);
}

function isSongSection(title: string) {
  const t = title.toLowerCase();
  return SONG_SECTION_KEYS.some((k) => t.includes(k));
}

/* ─────────────────────── SMALL COMPONENTS ─────────────────────── */

function FieldWrapper({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/65 uppercase tracking-wider flex items-baseline gap-2">
        {label}
        {hint && <span className="text-[10px] normal-case tracking-normal font-normal text-white/25">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

const inputCls = "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors rounded-xl";
const textCls  = "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";
const selCls   = "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 transition-colors appearance-none cursor-pointer";

function Sel({ name, placeholder, options, value, onChange }: {
  name: string; placeholder: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)}
        className={selCls} style={{ colorScheme: "dark" }}>
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o) => <option key={o} value={o} style={{ background: "#111" }}>{o}</option>)}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1 text-xs text-white/30 hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-primary/10">
      {copied ? <><Check className="h-3 w-3 text-green-400" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy</>}
    </button>
  );
}

function ResultCard({ section, defaultOpen }: { section: ParsedSection; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-white/[0.02] border-b border-white/[0.05]">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 flex-1 text-left min-w-0">
          {open ? <ChevronUp className="h-4 w-4 text-white/25 shrink-0" /> : <ChevronDown className="h-4 w-4 text-white/25 shrink-0" />}
          <h4 className="text-sm font-bold text-white uppercase tracking-wide truncate">{section.title}</h4>
        </button>
        <CopyBtn text={section.content} />
      </div>
      {open && (
        <div className="px-5 py-4">
          <pre className="whitespace-pre-wrap font-sans text-sm text-white/70 leading-relaxed">{section.content}</pre>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── STEPPER ─────────────────────── */

function Stepper({ step }: { step: number }) {
  return (
    <div className="mb-10">
      {/* Progress bar */}
      <div className="h-0.5 bg-white/[0.06] rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
        />
      </div>
      {/* Steps */}
      <div className="flex items-start justify-between gap-1">
        {STEPS.map((s) => {
          const done = step > s.id;
          const active = step === s.id;
          const Icon = s.icon;
          return (
            <div key={s.id} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 transition-all shrink-0 ${
                done   ? "border-primary bg-primary text-white" :
                active ? "border-primary bg-primary/20 text-primary" :
                         "border-white/[0.10] bg-transparent text-white/20"
              }`}>
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wide text-center leading-tight hidden sm:block transition-colors ${
                active ? "text-primary" : done ? "text-white/50" : "text-white/20"
              }`}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────── STEP SHELL ─────────────────────── */

function StepShell({ title, subtitle, icon: Icon, children }: {
  title: string; subtitle: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.05] bg-white/[0.015]">
        <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-black text-white">{title}</p>
          <p className="text-xs text-white/30">{subtitle}</p>
        </div>
      </div>
      <div className="p-6 md:p-8 space-y-6">{children}</div>
    </div>
  );
}

/* ─────────────────────── NAV BUTTONS ─────────────────────── */

function NavRow({ onBack, onNext, nextLabel = "Next Step", nextIcon, loading = false, backHidden = false }: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextIcon?: React.ReactNode;
  loading?: boolean;
  backHidden?: boolean;
}) {
  return (
    <div className={`flex items-center ${backHidden ? "justify-end" : "justify-between"} pt-2`}>
      {!backHidden && (
        <button type="button" onClick={onBack}
          className="flex items-center gap-2 text-sm text-white/30 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <Button type="button" onClick={onNext} disabled={loading}
        className="gold-glow font-bold gap-2 px-8 rounded-xl"
        style={{ height: "44px" }}>
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> :
          <>{nextIcon ?? <ArrowRight className="h-4 w-4" />} {nextLabel}</>}
      </Button>
    </div>
  );
}

/* ─────────────────────── PAGE ─────────────────────── */

export default function SongAndVideo() {
  const { getAccessToken, refreshProfile, user } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [step, setStep] = useState(1);
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [loadedVault, setLoadedVault]   = useState<ArtistVault | null>(activeArtist);
  const [songStructure, setSongStructure] = useState<SongStructure | null>(null);
  const [analyzing, setAnalyzing]         = useState(false);
  const [analyzeError, setAnalyzeError]   = useState<string | null>(null);
  const [scenes, setScenes]       = useState<SceneData[]>([]);
  const [audioUrl, setAudioUrl]   = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
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

  const { register, watch, setValue, formState: { errors }, trigger } = useForm<FormValues>({
    defaultValues: {
      artistName: "", songTitle: "", genre: "", mood: "",
      songTopic: "", cleanOrExplicit: "", voiceStyle: "", beatStyle: "",
      songLength: "", existingLyrics: "",
      artistDescription: "", visualStyleRules: "", brandColors: "", doNotChangeRules: "",
      videoStyle: "", platform: "", videoLength: "", locationIdeas: "", specialInstructions: "",
    },
  });

  const watched = watch();

  /* ── Vault load ── */
  function handleVaultLoad(vault: ArtistVault) {
    if (!watched.artistName) setValue("artistName", vault.artist_name);
    if (!watched.artistDescription && vault.personality) {
      const parts = [
        vault.personality,
        vault.hair ? `Hair: ${vault.hair}` : null,
        vault.tattoos ? `Tattoos: ${vault.tattoos}` : null,
        vault.jewelry ? `Jewelry: ${vault.jewelry}` : null,
        vault.clothing_style ? `Clothing: ${vault.clothing_style}` : null,
      ].filter(Boolean);
      setValue("artistDescription", parts.join(". "));
    }
    if (!watched.visualStyleRules && vault.visual_style) setValue("visualStyleRules", vault.visual_style);
    if (!watched.brandColors && vault.brand_colors)       setValue("brandColors", vault.brand_colors);
    if (!watched.doNotChangeRules && vault.do_not_change_rules) setValue("doNotChangeRules", vault.do_not_change_rules);
    if (!watched.videoStyle && vault.visual_style) setValue("videoStyle", "");
    setLoadedVault(vault);
  }

  /* ── Section analyze ── */
  async function handleAnalyze() {
    const lyrics = watched.existingLyrics;
    if (!lyrics || lyrics.length < 10) return;
    setAnalyzing(true); setAnalyzeError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/analyze-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ lyrics }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as SongStructure;
      setSongStructure(data);
    } catch {
      setAnalyzeError("Analysis failed — you can still generate without it.");
    } finally {
      setAnalyzing(false);
    }
  }

  /* ── Continue with active artist (skip Artist/Brand form) ── */
  function handleContinueWithActiveArtist() {
    const vault = activeArtist ?? loadedVault;
    if (!vault) return;
    setValue("artistName", vault.artist_name);
    const desc = [
      vault.personality,
      vault.hair           ? `Hair: ${vault.hair}`               : null,
      vault.tattoos        ? `Tattoos: ${vault.tattoos}`         : null,
      vault.jewelry        ? `Jewelry: ${vault.jewelry}`         : null,
      vault.clothing_style ? `Clothing: ${vault.clothing_style}` : null,
    ].filter(Boolean).join(". ");
    setValue("artistDescription", desc || vault.artist_name);
    if (vault.brand_colors)        setValue("brandColors", vault.brand_colors);
    if (vault.visual_style)        setValue("visualStyleRules", vault.visual_style);
    if (vault.do_not_change_rules) setValue("doNotChangeRules", vault.do_not_change_rules);
    setLoadedVault(vault);
    setStep(3);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
  }

  /* ── Step advance with validation ── */
  async function goNext() {
    if (step === 1) {
      const ok = await trigger(["artistName", "songTopic"]);
      if (!ok) return;
    }
    if (step === 2 && !loadedVault) {
      const ok = await trigger(["artistDescription"]);
      if (!ok) return;
    }
    setStep((s) => s + 1);
  }

  /* ── Generate ── */
  async function handleGenerate() {
    setLoading(true); setRawResult(null); setError(null);
    setOutOfCredits(false); setSaved(false); setSavedProjectId(null);

    const combinedInstructions = [
      watched.locationIdeas       ? `Location Ideas: ${watched.locationIdeas}`       : null,
      watched.videoLength         ? `Video Length: ${watched.videoLength}`           : null,
      watched.specialInstructions || null,
    ].filter(Boolean).join("\n\n");

    const vaultForApi = {
      artistType:          loadedVault?.artist_type            ?? null,
      artistDescription:   watched.artistDescription           || loadedVault?.personality,
      visualStyle:         watched.visualStyleRules            || loadedVault?.visual_style,
      brandColors:         watched.brandColors                 || loadedVault?.brand_colors,
      doNotChangeRules:    watched.doNotChangeRules            || loadedVault?.do_not_change_rules,
      hair:                loadedVault?.hair                   ?? null,
      tattoos:             loadedVault?.tattoos                ?? null,
      jewelry:             loadedVault?.jewelry                ?? null,
      clothingStyle:       loadedVault?.clothing_style         ?? null,
      consistencyPrompt:   loadedVault?.consistency_prompt     ?? null,
      referenceImageUrl:   loadedVault?.reference_image_url    ?? null,
    };

    try {
      const token = await getAccessToken();
      const { rawResult: res, creditsRemaining, genHistoryId: gid } = await callGenerateApi(
        "/api/generate-song-video",
        {
          artistName:        watched.artistName,
          songTitle:         watched.songTitle,
          genre:             watched.genre,
          mood:              watched.mood,
          explicit:          watched.cleanOrExplicit,
          songTopic:         watched.songTopic,
          voiceStyle:        watched.voiceStyle,
          beatStyle:         watched.beatStyle,
          songLength:        watched.songLength,
          videoStyle:        watched.videoStyle,
          platform:          watched.platform,
          artistDescription: watched.artistDescription,
          instructions:      combinedInstructions || undefined,
          existingLyrics:    watched.existingLyrics || undefined,
          artistVault:       (loadedVault || watched.artistDescription) ? vaultForApi : undefined,
          songStructure:     songStructure ?? undefined,
        },
        token,
      );
      setRawResult(res);
      const parsedScenes = parseScenes(extractBreakdownContent(res));
      setScenes(parsedScenes);
      setGenHistoryId(gid ?? null);
      if (creditsRemaining !== undefined) refreshProfile();
      void performSave({ result: res, sceneData: parsedScenes, ghid: gid ?? null });
      setStep(5);
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* ── Draft persistence ── */
  const DRAFT_KEY = "bdv_draft_songvideo";
  const WORKFLOW   = "song-and-video";

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
    const hasContent = !!(watched.artistName || watched.songTopic || rawResult);
    if (!hasContent) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        rawResult, scenes, formValues: watched, audioUrl, step, timestamp: Date.now(),
      }));
    } catch { /* ignore */ }
  }, [rawResult, scenes, watched, audioUrl, step]);

  /* Auto-save to server (debounced 30 s) */
  useEffect(() => {
    const hasContent = !!(watched.artistName || watched.songTopic || rawResult);
    if (!hasContent || !user) return;
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(async () => {
      // Suppress re-save after recovery to break the "found → recover → found" loop
      if (Date.now() < suppressDraftSaveUntil.current) return;
      try {
        const token = await getAccessToken();
        const title = [watched.artistName, watched.songTitle].filter(Boolean).join(" — ") || "Make Song + Video Draft";
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
      type DraftPayload = { rawResult?: string; scenes?: SceneData[]; formValues?: Partial<FormValues>; audioUrl?: string | null; step?: number };
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
        (Object.keys(fv) as Array<keyof FormValues>).forEach((k) => {
          const v = fv[k];
          if (typeof v === "string") setValue(k, v);
        });
      }
      // Restore the workflow step directly — bypass canReach guards since data is already loaded
      if (typeof payload.step === "number" && payload.step >= 1) {
        setStep(payload.step);
      } else if (payload.scenes?.length) {
        setStep(4); // had scenes → open at Scene Clips / Video step
      } else if (payload.rawResult) {
        setStep(3); // had plan → open at results
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
      const msg = err instanceof Error ? err.message : "Draft data not found — it may have expired. Try the backup JSON.";
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

  /* ── Save ── */
  async function performSave(opts?: { result?: string; sceneData?: SceneData[]; ghid?: string | null }) {
    if (!user) { toast({ title: "Sign in required", variant: "destructive" }); return; }
    const resultToSave = opts?.result    ?? rawResult ?? "";
    const scenesToSave = opts?.sceneData ?? scenes;
    const histId       = (opts !== undefined && "ghid" in opts) ? opts.ghid : genHistoryId;

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
          projectType:  "Make Song + Video",
          title:        [watched.artistName, watched.songTitle].filter(Boolean).join(" — ") || "Make Song + Video",
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
          creditsUsed:  2,
          genHistoryId: histId ?? null,
        }),
      });
      const body = await res.json() as { id?: string; error?: string; refunded?: boolean };
      if (!res.ok) {
        if (body.refunded) {
          setCreditRefunded(true);
          refreshProfile();
          toast({ title: "Credits refunded", description: "Project save failed — credits returned. Your generation is in Generation History.", variant: "destructive" });
        } else {
          const msg = body.error ?? `Save failed (HTTP ${res.status})`;
          setSaveError(msg);
          toast({ title: "Save failed", description: msg, variant: "destructive" });
        }
        setAutoSaveStatus("failed");
        return;
      }
      setSaved(true);
      setSavedProjectId(body.id ?? null);
      setAutoSaveStatus("saved");
      localStorage.removeItem(DRAFT_KEY);
      if (draftId) {
        fetch(`/api/drafts/${draftId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` } }).catch(() => {});
        setDraftId(null);
      }
      toast({ title: "Project saved!", description: "Find it in My Projects." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed — please try again";
      setSaveError(msg);
      setAutoSaveStatus("failed");
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() { await performSave(); }

  /* ── Downloads ── */
  const exportMeta = {
    projectType: "Make Song + Video",
    artistName:  watched.artistName  || undefined,
    songTitle:   watched.songTitle   || undefined,
    genre:       watched.genre       || undefined,
    mood:        watched.mood        || undefined,
    result:      rawResult ?? "",
  };

  /* ── Reset ── */
  function handleReset() {
    setRawResult(null); setError(null); setOutOfCredits(false);
    setScenes([]); setSaved(false); setSavedProjectId(null);
    setStep(1); setSongStructure(null); setLoadedVault(null);
    window.scrollTo({ top: 0 });
  }

  /* ── Parsed sections ── */
  const sections = rawResult ? parseSections(rawResult) : [];
  const songSections  = sections.filter((s) => isSongSection(s.title));
  const videoSections = sections.filter((s) => !isSongSection(s.title));

  /* ─────────────── RENDER ─────────────── */
  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[450px] bg-primary/7 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/35 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" /> Back to Dashboard
        </Link>

        {/* ── Draft Recovery Modal ── */}
        {draftState !== "idle" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl overflow-hidden">
              {draftState === "found" && (
                <div className="p-6 space-y-5">
                  <div>
                    <p className="text-[10px] font-bold text-yellow-400/70 uppercase tracking-widest mb-2">Unsaved Draft Found</p>
                    <p className="text-lg font-black text-white leading-tight">{draftInfo?.title ?? "Previous session"}</p>
                    {draftInfo?.updated && <p className="text-xs text-white/35 mt-1">Last saved {draftInfo.updated}</p>}
                  </div>
                  <p className="text-sm text-white/50">Recover your draft to continue where you left off — no credits will be charged.</p>
                  <div className="space-y-2.5">
                    <Button onClick={() => { void handleRecover(); }} className="w-full gold-glow font-bold gap-2 h-11">
                      <RefreshCcw className="h-4 w-4" /> Recover Draft
                    </Button>
                    <button onClick={downloadDraftBackup}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors font-semibold">
                      <Download className="h-4 w-4" /> Download Backup JSON
                    </button>
                    <button onClick={() => { void handleDiscardDraft(); }}
                      className="w-full py-2 text-sm text-white/25 hover:text-white/50 transition-colors">
                      Discard Draft
                    </button>
                  </div>
                </div>
              )}
              {draftState === "recovering" && (
                <div className="p-8 flex flex-col items-center gap-4">
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <div className="text-center">
                    <p className="font-bold text-white">Recovering draft…</p>
                    <p className="text-xs text-white/40 mt-1">Restoring all your content</p>
                  </div>
                </div>
              )}
              {draftState === "recovered" && (
                <div className="p-8 flex flex-col items-center gap-4">
                  <div className="h-14 w-14 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                    <Check className="h-7 w-7 text-green-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-black text-white text-lg">Draft Recovered</p>
                    <p className="text-xs text-white/40 mt-1">Your project has been fully restored</p>
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
                      <p className="font-bold text-white text-sm">Recovery Failed</p>
                      <p className="text-xs text-red-300/80 mt-0.5 leading-relaxed">{draftError}</p>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <button onClick={downloadDraftBackup}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-primary/30 bg-primary/[0.07] text-sm text-primary hover:bg-primary/15 transition-colors font-semibold">
                      <Download className="h-4 w-4" /> Download Backup JSON
                    </button>
                    <button onClick={() => { void handleDiscardDraft(); }}
                      className="w-full py-2 text-sm text-white/25 hover:text-white/50 transition-colors">
                      Dismiss
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
              <Mic2 className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">2 credits</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            Make Song + Video
          </h1>
          <p className="text-white/50 text-base md:text-lg max-w-2xl">
            Complete AI song + music video workflow — lyrics, visuals, and promo in one pass.
          </p>
        </div>

        {/* Stepper */}
        <Stepper step={step} />

        {/* ──────────── STEP 1: SONG SETUP ──────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <StepShell icon={Music} title="Song Setup" subtitle="Tell us about the song you want to create">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Artist Name">
                  <Input {...register("artistName", { required: true })}
                    placeholder="e.g. Lil Nova"
                    className={inputCls + (errors.artistName ? " border-red-500/50" : "")} />
                  {errors.artistName && <p className="text-red-400 text-xs mt-1">Required</p>}
                </FieldWrapper>
                <FieldWrapper label="Song Title" hint="optional">
                  <Input {...register("songTitle")} placeholder="e.g. On My Way Up" className={inputCls} />
                </FieldWrapper>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Genre">
                  <Sel name="genre" placeholder="Select genre…" options={GENRES}
                    value={watched.genre} onChange={(v) => setValue("genre", v)} />
                </FieldWrapper>
                <FieldWrapper label="Mood">
                  <Sel name="mood" placeholder="Select mood…" options={MOODS}
                    value={watched.mood} onChange={(v) => setValue("mood", v)} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Song Topic">
                <Textarea {...register("songTopic", { required: true })}
                  placeholder="Describe the story, theme, or feeling of the song. Include personal details, metaphors, or narrative elements you want woven into the lyrics…"
                  className={textCls + (errors.songTopic ? " border-red-500/50" : "")}
                  style={{ minHeight: "110px" }} />
                {errors.songTopic && <p className="text-red-400 text-xs mt-1">Required</p>}
              </FieldWrapper>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <FieldWrapper label="Clean or Explicit">
                  <Sel name="cleanOrExplicit" placeholder="Select…" options={["Clean","Explicit"]}
                    value={watched.cleanOrExplicit} onChange={(v) => setValue("cleanOrExplicit", v)} />
                </FieldWrapper>
                <FieldWrapper label="Voice Style" hint="optional">
                  <Input {...register("voiceStyle")} placeholder="e.g. deep, raspy, melodic…" className={inputCls} />
                </FieldWrapper>
                <FieldWrapper label="Song Length" hint="optional">
                  <Input {...register("songLength")} placeholder="e.g. 3:30, 2 minutes…" className={inputCls} />
                </FieldWrapper>
              </div>

              <FieldWrapper label="Beat Style" hint="optional">
                <Input {...register("beatStyle")} placeholder="e.g. dark 808s, trap drums, live piano, boom bap…" className={inputCls} />
              </FieldWrapper>

              {/* Existing Lyrics */}
              <div className="space-y-2 pt-1">
                <Label className="text-sm font-semibold text-white/65 uppercase tracking-wider flex items-baseline gap-2">
                  Existing Lyrics
                  <span className="text-[10px] normal-case tracking-normal font-normal text-white/25">Optional — AI uses these as the base</span>
                </Label>
                <AudioTranscribe
                  onTranscript={(text) => { setValue("existingLyrics", text); setSongStructure(null); }}
                  onFileUrl={setAudioUrl}
                />
                <Textarea {...register("existingLyrics")}
                  placeholder="Paste existing lyrics here, or upload audio above to auto-transcribe…"
                  className={textCls} style={{ minHeight: "120px" }} />
                {watched.existingLyrics.length > 10 && (
                  <div className="flex items-center gap-3 flex-wrap pt-1">
                    <button type="button" onClick={handleAnalyze} disabled={analyzing}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-primary/25 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors">
                      {analyzing
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
                        : <><BarChart2 className="h-3.5 w-3.5" /> Analyze Song Sections</>}
                    </button>
                    {songStructure && !analyzing && (
                      <span className="text-xs text-primary/60 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Analysis complete
                      </span>
                    )}
                    {analyzeError && <p className="text-xs text-red-400/80">{analyzeError}</p>}
                  </div>
                )}
              </div>
              {songStructure && <SongSectionAnalysis analysis={songStructure} />}

            </StepShell>

            <NavRow backHidden onNext={goNext} nextLabel="Artist & Brand" nextIcon={<ArrowRight className="h-4 w-4" />} />
          </div>
        )}

        {/* ──────────── STEP 2: ARTIST / BRAND ──────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <StepShell
              icon={Mic2}
              title="Artist / Brand"
              subtitle={activeArtist ? "Your active artist is ready to go." : "Help the AI match your look, style, and brand identity"}
            >
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
                    <Textarea {...register("artistDescription", { required: !loadedVault })}
                      placeholder="Describe the artist's look, personality, and visual brand. Include wardrobe style, tattoos, jewelry, vibe, and any references…"
                      className={textCls + (errors.artistDescription ? " border-red-500/50" : "")}
                      style={{ minHeight: "120px" }} />
                    {errors.artistDescription && <p className="text-red-400 text-xs mt-1">Required</p>}
                  </FieldWrapper>

                  <FieldWrapper label="Visual Style Rules" hint="optional">
                    <Textarea {...register("visualStyleRules")}
                      placeholder="Describe the visual aesthetic, cinematography style, color palette rules, or references…"
                      className={textCls} style={{ minHeight: "90px" }} />
                  </FieldWrapper>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <FieldWrapper label="Brand Colors" hint="optional">
                      <Input {...register("brandColors")} placeholder="e.g. black, gold, deep purple" className={inputCls} />
                    </FieldWrapper>
                    <div />
                  </div>

                  <FieldWrapper label="Do Not Change Rules" hint="optional">
                    <Textarea {...register("doNotChangeRules")}
                      placeholder="List anything the AI should NEVER change — artist name spelling, signature phrases, visual elements, etc…"
                      className={textCls} style={{ minHeight: "80px" }} />
                  </FieldWrapper>
                </>
              )}
            </StepShell>

            {!activeArtist && (
              <NavRow onBack={() => setStep(1)} onNext={goNext} nextLabel="Video Direction" nextIcon={<ArrowRight className="h-4 w-4" />} />
            )}
            {activeArtist && (
              <NavRow onBack={() => setStep(1)} onNext={handleContinueWithActiveArtist} nextLabel="Video Direction" nextIcon={<ArrowRight className="h-4 w-4" />} />
            )}
          </div>
        )}

        {/* ──────────── STEP 3: VIDEO DIRECTION ──────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <StepShell icon={Video} title="Video Direction" subtitle="Set the visual world for your music video">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Video Style">
                  <Sel name="videoStyle" placeholder="Select style…" options={VIDEO_STYLES}
                    value={watched.videoStyle} onChange={(v) => setValue("videoStyle", v)} />
                </FieldWrapper>
                <FieldWrapper label="Platform">
                  <Sel name="platform" placeholder="Select platform…" options={PLATFORMS}
                    value={watched.platform} onChange={(v) => setValue("platform", v)} />
                </FieldWrapper>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Video Length" hint="optional">
                  <Input {...register("videoLength")} placeholder="e.g. 3 minutes, match song length…" className={inputCls} />
                </FieldWrapper>
                <div />
              </div>

              <FieldWrapper label="Location Ideas" hint="optional">
                <Textarea {...register("locationIdeas")}
                  placeholder="Describe location concepts — city streets, rooftop, beach, abandoned warehouse, studio, specific cities or vibes…"
                  className={textCls} style={{ minHeight: "90px" }} />
              </FieldWrapper>

              <FieldWrapper label="Special Visual Instructions" hint="optional">
                <Textarea {...register("specialInstructions")}
                  placeholder="Specific shots, cultural elements, visual references, things to avoid, color notes, or anything else the AI should know…"
                  className={textCls} style={{ minHeight: "90px" }} />
              </FieldWrapper>

            </StepShell>

            <NavRow onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel="Review & Generate" nextIcon={<Sparkles className="h-4 w-4" />} />
          </div>
        )}

        {/* ──────────── STEP 4: GENERATE ──────────── */}
        {step === 4 && (
          <div className="space-y-6">
            <StepShell icon={Sparkles} title="Generate Package" subtitle="Review your setup and generate the full Song + Video package">

              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "Artist", value: watched.artistName || "—" },
                  { label: "Song",   value: watched.songTitle  || "Untitled" },
                  { label: "Genre",  value: watched.genre      || "—" },
                  { label: "Mood",   value: watched.mood       || "—" },
                  { label: "Video",  value: watched.videoStyle || "—" },
                  { label: "Platform", value: watched.platform ? watched.platform.split(" -")[0] : "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">{label}</p>
                    <p className="text-sm font-bold text-white truncate">{value}</p>
                  </div>
                ))}
              </div>

              {/* What you get */}
              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-5">
                <p className="text-xs font-bold text-primary/70 uppercase tracking-widest mb-3">What you'll get</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {[
                    "Song Concept + Best Title","Full Lyrics (Verse / Hook / Bridge)","AI Music Prompt for Suno / Udio",
                    "Beat Direction","Vocal Direction","Director's Treatment",
                    "Scene-by-Scene Breakdown","AI Video Prompts (Runway / Sora)","Thumbnail Prompts",
                    "Promo Clip Ideas","Caption Pack",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm text-white/60">
                      <Check className="h-3 w-3 text-primary shrink-0" /> {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-white/25 flex items-center gap-1.5">
                  <Zap className="h-3 w-3 text-primary" /> Uses 2 credits
                </p>
              </div>

            </StepShell>

            {outOfCredits && <OutOfCredits />}
            {error && (
              <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                <p className="text-red-400 text-sm font-medium">{error}</p>
              </div>
            )}

            <NavRow
              onBack={() => setStep(3)}
              onNext={handleGenerate}
              nextLabel="Create Song + Video Package"
              nextIcon={<Sparkles className="h-4 w-4" />}
              loading={loading}
            />
          </div>
        )}

        {/* ──────────── STEP 5: RESULTS ──────────── */}
        {step === 5 && rawResult && (
          <div className="space-y-8">

            {/* Result header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs font-bold tracking-widest text-green-400 uppercase">Package Ready</span>
                </div>
                <h2 className="text-xl font-black text-white">
                  {[watched.artistName, watched.songTitle].filter(Boolean).join(" — ") || "Your Song + Video Package"}
                </h2>
              </div>
            </div>

            {/* ── SONG PACKAGE ── */}
            {songSections.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                    <Music className="h-3.5 w-3.5 text-white" />
                  </div>
                  <h3 className="text-xs font-black text-primary uppercase tracking-widest">Song Package</h3>
                  <div className="flex-1 h-px bg-primary/20" />
                </div>
                <div className="space-y-2">
                  {songSections.map((s, i) => <ResultCard key={s.title} section={s} defaultOpen={i === 0} />)}
                </div>
              </div>
            )}

            {/* ── VIDEO PACKAGE ── */}
            {videoSections.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                    <Video className="h-3.5 w-3.5 text-white" />
                  </div>
                  <h3 className="text-xs font-black text-blue-400 uppercase tracking-widest">Video Package</h3>
                  <div className="flex-1 h-px bg-blue-600/20" />
                </div>
                <div className="space-y-2">
                  {videoSections.map((s, i) => <ResultCard key={s.title} section={s} defaultOpen={i === 0} />)}
                </div>
              </div>
            )}

            {/* ── TIMELINE ── */}
            <MusicVideoTimeline
              scenes={scenes}
              onScenesChange={setScenes}
              audioUrl={audioUrl}
              projectId={savedProjectId}
              artistVault={loadedVault ? vaultToPayload(loadedVault) : null}
              videoStyle={watched.videoStyle}
              platform={watched.platform}
            />

            {/* ── NEXT ACTIONS ── */}
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-7 w-7 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-white/40" />
                </div>
                <h3 className="text-xs font-black text-white/40 uppercase tracking-widest">Download & Share</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                {/* Save */}
                <div className="flex flex-col gap-1.5">
                  <button onClick={handleSave} disabled={saving || saved}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all font-semibold text-sm ${
                      saved
                        ? "border-green-500/30 bg-green-500/10 text-green-400 cursor-default"
                        : "border-primary/30 bg-primary/[0.07] text-primary hover:bg-primary/15"
                    }`}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      : saved ? <Check className="h-4 w-4 shrink-0" />
                      : <Save className="h-4 w-4 shrink-0" />}
                    {saved ? "Project Saved" : saving ? "Saving…" : "Save Project"}
                  </button>
                  {autoSaveStatus === "saving" && !saved && (
                    <p className="text-[11px] text-white/40 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Saving generation…
                    </p>
                  )}
                  {autoSaveStatus === "failed" && creditRefunded && (
                    <p className="text-[11px] text-amber-400">Credits refunded — find your content in <strong>Generation History</strong>.</p>
                  )}
                  {saveError && (
                    <p className="text-[11px] text-red-400">Save failed: {saveError}</p>
                  )}
                </div>

                {/* Open Video Editor */}
                {savedProjectId ? (
                  <Link href={`/video-editor?project=${savedProjectId}`}>
                    <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:border-white/[0.15] hover:bg-white/[0.06] transition-all font-semibold text-sm cursor-pointer">
                      <Video className="h-4 w-4 shrink-0" /> Open Video Editor
                    </div>
                  </Link>
                ) : (
                  <button onClick={() => { toast({ title: "Save your project first", description: "Save to unlock the Video Editor." }); }}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/30 font-semibold text-sm cursor-pointer hover:text-white/50 transition-colors">
                    <Video className="h-4 w-4 shrink-0" /> Open Video Editor
                  </button>
                )}

                {/* Generate Promo Clips */}
                <Link href="/promo-clip">
                  <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:border-white/[0.15] hover:bg-white/[0.06] transition-all font-semibold text-sm cursor-pointer">
                    <Film className="h-4 w-4 shrink-0" /> Generate Promo Clips
                  </div>
                </Link>

                {/* Download TXT */}
                <button onClick={() => downloadTxt(exportMeta)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:border-white/[0.15] hover:bg-white/[0.06] transition-all font-semibold text-sm">
                  <FileText className="h-4 w-4 shrink-0" /> Download TXT
                </button>

                {/* Download PDF */}
                <button onClick={() => downloadPdf(exportMeta)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:border-white/[0.15] hover:bg-white/[0.06] transition-all font-semibold text-sm">
                  <FileDown className="h-4 w-4 shrink-0" /> Download PDF
                </button>

              </div>

              {/* Start over */}
              <div className="pt-2 border-t border-white/[0.05]">
                <button onClick={handleReset}
                  className="text-xs text-white/20 hover:text-white/50 transition-colors">
                  ← Start a new Song + Video
                </button>
              </div>
            </div>

          </div>
        )}

      </div>


      {/* ── Dev debug overlay ── */}
      {import.meta.env.DEV && (
        <div className="fixed bottom-4 left-4 z-40 text-[10px] font-mono text-white/30 bg-black/70 rounded-lg px-3 py-2 space-y-0.5 border border-white/5 pointer-events-none">
          <p>Step {step}: Song + Video</p>
          <p>Draft: {draftState}{draftId ? " (server)" : draftState !== "idle" ? " (local)" : ""}</p>
          <p>Content: {rawResult ? `${rawResult.length} chars` : "none"} · Scenes: {scenes.length}</p>
        </div>
      )}
    </div>
  );
}
