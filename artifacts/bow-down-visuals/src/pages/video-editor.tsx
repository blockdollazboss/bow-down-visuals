import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type SetStateAction } from "react";
import { Link, useSearch } from "wouter";
import {
  ArrowLeft, Loader2, Clapperboard,
  Check, CloudOff, Save, Film, ListVideo, Music2, Captions, Wand2, Download,
  CheckCircle2, Circle, Layers, Play, Pause,
  RefreshCw, Zap, SkipBack, Maximize, Minimize, PictureInPicture2,
  Volume2, VolumeX, Rewind, FastForward, SkipForward,
  Crop, Smartphone, Monitor, Square, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Bug, Mic2,
  Minimize2, Maximize2, EyeOff, Eye, Sparkles, AlertCircle, AlertTriangle, BookOpen,
  Theater, Repeat, StepBack, StepForward, RotateCcw, Columns2, ChevronsLeftRight,
  SlidersHorizontal, Undo2, Redo2, LayoutTemplate, AudioWaveform, Scissors, MessageSquareText,
  PanelRightClose, PanelRightOpen, Languages, Image as ImageIcon, Palette, MapPin,
  Fingerprint, Laugh, Timer,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { VideoBanner } from "@/components/layout/video-banner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InstagramIcon } from "@/components/ui/instagram-icon";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useRemixDeeplink } from "@/hooks/use-remix-deeplink";
import { useToast } from "@/hooks/use-toast";
import { ClipSequencePlayer } from "@/components/ClipSequencePlayer";
import { TimelinePreviewPlayer, type SharedPreviewState, type TimelinePlayerHandle } from "@/components/TimelinePreviewPlayer";
import { parseScenesWithMode, parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import { computeSceneTimings } from "@/lib/scene-timing";
import {
  normalizeEditorSettings,
  sceneHasClip,
  getClipEdit,
  defaultClipEdit,
  type ClipEdit,
  formatAspectCss,
  formatDimensions,
  FORMAT_PRESET_LABELS,
  VIDEO_FORMATS,
  MASTER_PLAYER_MIN_WIDTH,
  MASTER_PLAYER_MAX_WIDTH,
  MASTER_PLAYER_DEFAULT_WIDTH,
  MASTER_PLAYER_MIN_HEIGHT,
  getValidCaptionWords,
  type EditorSettings,
  type VideoFormat,
  type FitMode,
} from "@/lib/editor-settings";
import { computeMasterPlayerFit } from "@/lib/master-player-size";
import { TransitionCompositor, type TransitionState } from "@/components/TransitionCompositor";
import { captionFontFamily } from "@/lib/fonts";
import { getLibraryPreset } from "@/data/library-presets";
import {
  COMPARE_POS_DEFAULT,
  COMPARE_POS_MIN,
  COMPARE_POS_MAX,
  COMPARE_KEY_STEP,
  COMPARE_KEY_STEP_LARGE,
  clampComparePos,
  compareClipPath,
  comparePosFromClientX,
  hasActiveVisualEffects,
} from "@/lib/compare-slider";
import { OverlayLayer } from "@/components/OverlayLayer";
import { ActiveOverlayEffects } from "@/components/ActiveOverlayEffects";
import { ClipGeneratorSection } from "@/components/editor/sections/ClipGeneratorSection";
import { ScreenRecorderPanel } from "@/components/editor/sections/ScreenRecorderPanel";
import { StockLibraryPanel } from "@/components/editor/sections/StockLibraryPanel";
import TemplatesTabPanel from "@/components/video-editor/TemplatesTabPanel";
import { CaptionsSection } from "@/components/editor/sections/CaptionsSection";
import { AiCaptionSuite } from "@/components/editor/sections/AiCaptionSuite";
import { EffectsSection } from "@/components/editor/sections/EffectsSection";
import { ExportSection } from "@/components/editor/sections/ExportSection";
import { MusicStudio } from "@/components/editor/music/MusicStudio";
import { BrandingSection } from "@/components/editor/sections/BrandingSection";
import { LipSyncSection } from "@/components/editor/sections/LipSyncSection";
import { PreProductionSection } from "@/components/editor/sections/PreProductionSection";
import { TimelineSection } from "@/components/editor/sections/TimelineSection";
import { MotionGraphicsSection } from "@/components/editor/sections/MotionGraphicsSection";
import { StudioEditorSection } from "@/components/editor/sections/StudioEditorSection";
import { VoiceDirectedEditsSection } from "@/components/editor/sections/VoiceDirectedEditsSection";
import { BeatSyncSection } from "@/components/editor/sections/BeatSyncSection";
import { TimelineTemplatesSection } from "@/components/editor/sections/TimelineTemplatesSection";
import { BackgroundReplaceSection } from "@/components/editor/sections/BackgroundReplaceSection";
import { ProToolsSection } from "@/components/editor/sections/ProToolsSection";
import { CanvasGeneratorSection } from "@/components/editor/sections/CanvasGeneratorSection";
import { KeyframesSection } from "@/components/editor/sections/KeyframesSection";
import { ChromaKeyPreview } from "@/components/editor/ChromaKeyPreview";
import {
  buildProToolsCssFilter,
  buildProToolsTransform,
  buildProToolsClipPath,
} from "@/lib/pro-tools-preview";
import { TimelineDock } from "@/components/editor/TimelineDock";
import TemplatePicker from "@/components/TemplatePicker";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import type { HubAsset } from "@/lib/hub-project";
import PromoClip from "@/pages/promo-clip";
import LyricVideo from "@/pages/lyric-video";
import Translate from "@/pages/translate";
import Repurpose from "@/pages/repurpose";
import Upscale from "@/pages/upscale";
import CartoonStudio from "@/pages/cartoon-studio";
import ThumbnailStudio from "@/pages/thumbnail-studio";
import { VisualVibesSection } from "@/components/editor/sections/VisualVibesSection";
import LocationsPage from "@/pages/locations";
import { StyleStealerSection } from "@/components/editor/sections/StyleStealerSection";
import { MemeMachineSection } from "@/components/editor/sections/MemeMachineSection";
import { ThreeSecondLabSection } from "@/components/editor/sections/ThreeSecondLabSection";
import { ToolPanelShell } from "@/components/editor/ToolPanelShell";
import { ALIGN_CREDITS as LYRIC_ALIGN_CREDITS, RENDER_CREDITS as LYRIC_RENDER_CREDITS } from "@/lib/lyric-video";
import {
  getVideoTemplate, setLastTemplate, getLastTemplate,
  type VideoTemplateId,
} from "@/lib/video-templates";
import { runAudioSceneFlow } from "@/lib/generate-scenes-from-audio-flow";
import {
  AUDIO_EXPORT_BUTTONS,
  audioExportTypeForVideoAudioSource,
  canRenderVideoAudioSource,
  type AudioExportType,
  type DirectAudioExportStatus,
} from "@/lib/audio-export";
import {
  resolveVideoAudio,
  VIDEO_AUDIO_SOURCE_LABELS,
} from "@/lib/resolve-video-audio-url";

type EditorTab = "clips" | "templates" | "timeline" | "beat-sync" | "edit-recipes" | "music" | "captions" | "effects" | "motion" | "branding" | "export" | "lip-sync" | "studio" | "voice-edits" | "pre-production" | "pro-tools" | "promo-clips" | "lyric-video" | "translate" | "repurpose" | "upscale" | "cartoonize" | "thumbnails" | "vibes" | "locations" | "style-stealer" | "meme-machine" | "three-second-lab";

/* ── CSS filter maps for effects live preview ──
 * Kept in lockstep with effects-ffmpeg.ts (api-server). VHS / Cinematic Bars /
 * Camera Shake / Film Grain now burn TRUE ffmpeg chains on export — the
 * preview below mirrors them with DOM overlays (true bars, scanlines,
 * tracking line, shake keyframes) instead of the old fake CSS tweaks.
 * Where a true CSS preview is impossible, the Effects tab labels it honestly:
 * "preview approximates — export is the real thing". */
const EFFECT_CSS_FILTERS: Record<string, string> = {
  "Film Grain":        "contrast(108%) brightness(97%)",
  "Glow":              "brightness(118%) saturate(140%)",
  "Blur":              "blur(2px)",
  "Sharpen":           "contrast(125%) brightness(103%)",
  "Vignette":          "brightness(82%)",
  "Black & White":     "grayscale(100%)",
  "Neon Glow":         "hue-rotate(270deg) saturate(180%) brightness(115%)",
  /* VHS preview: color approximation only — the burn adds real noise,
   * chromatic aberration, scanlines and tracking wobble (see below). */
  "VHS":               "saturate(75%) contrast(112%) hue-rotate(8deg) brightness(92%)",
  /* Cinematic Bars preview = true DOM black bars below (12.5% top/bottom,
   * exactly matching the burned drawbox chain) — no CSS filter needed. */
  "Cinematic Bars":    "",
  /* Camera Shake preview = bdv-cam-shake keyframes below — the old
   * contrast/saturate tweak was fake. */
  "Camera Shake":      "",
  "Slow Zoom":         "saturate(115%) brightness(103%)",
  "Speed Ramp":        "contrast(120%) brightness(98%)",
  "Warm Grade":          "sepia(40%) saturate(135%) brightness(108%)",
  "Cool Grade":          "hue-rotate(195deg) saturate(115%) brightness(94%)",
  "Teal & Orange":       "hue-rotate(20deg) saturate(165%) contrast(110%)",
  "Moody Desaturated":   "saturate(40%) contrast(120%) brightness(88%)",
  "Vibrant Pop":         "saturate(210%) brightness(108%) contrast(106%)",
  "Street Night":        "hue-rotate(230deg) saturate(145%) brightness(80%) contrast(128%)",
  "Luxury Gold":         "sepia(65%) saturate(175%) brightness(112%) contrast(108%)",
  "Dark Drill":          "brightness(72%) contrast(148%) saturate(55%)",
  "Cinematic Contrast":  "contrast(155%) saturate(88%) brightness(90%)",
};

/* ─── Thy Library deep-link maps ──────────────────────────────────────────
   Library preset slugs → the editor's built-in, export-safe catalogs.
   The library's 30 fx / 20 text-style / 15 transition presets are curated
   vibes; the editor only burns built-in names on export (see
   api-server effects-ffmpeg.ts), so each slug maps to its closest built-in
   rather than inventing a filter the export can't reproduce. */
const LIBRARY_FX_TO_EFFECT: Record<string, string> = {
  "fx-gold-hour": "Luxury Gold", "fx-cinematic-teal": "Teal & Orange",
  "fx-noir": "Black & White", "fx-vintage-film": "Warm Grade",
  "fx-neon-nights": "Neon Glow", "fx-moody-blue": "Moody Desaturated",
  "fx-sunset-bloom": "Warm Grade", "fx-cyberpunk": "Street Night",
  "fx-forest-mist": "Moody Desaturated", "fx-desert-heat": "Warm Grade",
  "fx-arctic": "Cool Grade", "fx-blood-moon": "Vibrant Pop",
  "fx-lavender-dream": "Cool Grade", "fx-emerald-city": "Teal & Orange",
  "fx-champagne": "Glow", "fx-midnight-oil": "Vignette",
  "fx-candy-pop": "Vibrant Pop", "fx-old-money": "Moody Desaturated",
  "fx-toxic": "Neon Glow", "fx-ultraviolet": "Cool Grade",
  "fx-paper-white": "Glow", "fx-ember": "Warm Grade",
  "fx-tide": "Teal & Orange", "fx-royal": "Luxury Gold",
  "fx-static-vhs": "VHS", "fx-rose-gold": "Luxury Gold",
  "fx-ink-black": "Moody Desaturated", "fx-honey": "Warm Grade",
  "fx-storm": "Moody Desaturated", "fx-gilded": "Luxury Gold",
};

/* Library text-style slugs → caption font ids (the 12 Google Fonts loaded in
   index.html; Playfair Display isn't loaded, so luxe/royal map to Cinzel). */
const LIBRARY_TEXTSTYLE_TO_FONT: Record<string, string> = {
  "txt-beast-mode": "anton", "txt-luxe-serif": "cinzel",
  "txt-street-tag": "marker", "txt-neon-glow": "bebas",
  "txt-bubble-pop": "titan", "txt-condensed-punch": "barlow",
  "txt-slab-authority": "alfa-slab", "txt-archivo-black": "archivo",
  "txt-righteous": "righteous", "txt-bungee": "bungee",
  "txt-cinzel": "cinzel", "txt-luckiest": "luckiest",
  "txt-poppins-bold": "poppins", "txt-gold-foil": "cinzel",
  "txt-chrome": "archivo", "txt-outline-only": "anton",
  "txt-shadow-drop": "bebas", "txt-glitch": "archivo",
  "txt-handwritten": "marker", "txt-royal-script": "cinzel",
};

const LIBRARY_TRANSITION_MAP: Record<string, string> = {
  "tr-whip-pan": "Whip Pan", "tr-zoom-burst": "Zoom",
  "tr-glitch-cut": "Glitch", "tr-spin-in": "Spin",
  "tr-slide-wipe": "Slide", "tr-fade-through": "Crossfade",
  "tr-light-leak": "Light Leak", "tr-shake-hit": "Flash",
  "tr-page-turn": "Slide", "tr-morph-zoom": "Zoom",
  "tr-split-screen": "Slide", "tr-ink-bleed": "Blur Dissolve",
  "tr-flash-cut": "Flash", "tr-vertigo": "Zoom",
  "tr-gold-sweep": "Light Leak",
};

function buildEffectFilter(effects: string[]): string {
  return effects
    .map((fx) => EFFECT_CSS_FILTERS[fx])
    .filter(Boolean)
    .join(" ");
}

interface LoadedProject {
  id: string;
  title: string;
  artist_name: string | null;
  song_title: string | null;
  genre: string | null;
  mood: string | null;
  input_data: Record<string, unknown> | null;
  output_data: {
    result?: string;
    scenes?: SceneData[];
    editorSettings?: Partial<EditorSettings>;
    transcriptText?: string;
  } | null;
}

type SaveState = "idle" | "saving" | "saved" | "error" | "unsaved";

/** Auto PiP guard — requestPictureInPicture() throws "Metadata for the video
 *  element are not loaded yet" (which surfaces as a player error) when called
 *  before HAVE_METADATA. Only engage PiP once metadata is in. */
function canAutoPiP(v: HTMLVideoElement | null | undefined): v is HTMLVideoElement {
  return !!v && v.readyState >= 1;
}

export default function VideoEditor() {
  const { t } = useTranslation();
  usePageTitle(t("videoEditor.pageTitle"), t("videoEditor.pageDescription"));
  const search = useSearch();
  const projectId = new URLSearchParams(search).get("project");
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const { activeArtist, consistencyPrompt } = useActiveArtist();
  const { isSimple } = useUserMode();
  /** Simple mode hides the technical/advanced panels behind the sidebar mode toggle;
   *  the underlying settings/tabs are untouched so switching to Advanced reveals everything. */
  const SIMPLE_VISIBLE_TABS: EditorTab[] = ["music", "clips", "templates", "pre-production", "lip-sync", "timeline", "export"];
  /** Creator Level star thresholds per rail tab — clips / music / timeline /
   *  export are core (level 1) and never gated. */
  const TAB_MIN_STARS: Partial<Record<EditorTab, number>> = {
    branding: 2,
    "beat-sync": 2,
    "pre-production": 2,
    captions: 3,
    effects: 3,
    "edit-recipes": 3,
    studio: 4,
    "voice-edits": 4,
    "lip-sync": 5,
    "pro-tools": 5,
  };

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<LoadedProject | null>(null);
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [scenes, setScenesState] = useState<SceneData[]>([]);
  const [settings, setSettingsState] = useState<EditorSettings>(normalizeEditorSettings(null));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  /* Autosave preference — persisted per user in localStorage. Default ON
     preserves the existing silent-autosave behavior. When OFF, changes only
     mark the project "unsaved" until the user hits Save (or re-enables). */
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean>(() => {
    try { const s = localStorage.getItem("bdv:autosave"); return s === null ? true : s === "true"; }
    catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("bdv:autosave", String(autosaveEnabled)); } catch {}
  }, [autosaveEnabled]);
  const [tab, setRawTab] = useState<EditorTab>("clips");
  /* Thy Library transition deep-link (?transition=<slug>): scenes load async,
     so the mapped transition parks here until scenes arrive, then applies
     to every clip exactly once. */
  const pendingTransitionRef = useRef<string | null>(null);
  /* ── Resizable tool panel: drag the divider between the panel and the
     preview to size it. Width persists per browser. Double-click resets. ── */
  const PANEL_MIN = 240;
  const PANEL_MAX = 600;
  const PANEL_DEFAULT = 340;
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("bdv:panelWidth"));
      return Number.isFinite(v) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, v)) : PANEL_DEFAULT;
    } catch { return PANEL_DEFAULT; }
  });
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const panelWidthRef = useRef(panelWidth);
  const panelDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const onPanelDividerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    panelDragRef.current = { startX: e.clientX, startW: panelWidthRef.current };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const d = panelDragRef.current;
      if (!d) return;
      const w = d.startW + (ev.clientX - d.startX);
      const clamped = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
      panelWidthRef.current = clamped;
      setPanelWidth(clamped);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      panelDragRef.current = null;
      try { localStorage.setItem("bdv:panelWidth", String(panelWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);
  const resetPanelWidth = useCallback(() => {
    panelWidthRef.current = PANEL_DEFAULT;
    setPanelWidth(PANEL_DEFAULT);
    try { localStorage.removeItem("bdv:panelWidth"); } catch { /* ignore */ }
  }, []);
  /* LUT Import handoff: graded clip URL pre-loads the multi-ratio export card. */
  const [lutHandoffUrl, setLutHandoffUrl] = useState<string | null>(null);
  /* ── Template system: "what are you making?" drives format, tool order,
     and which presets each feature shows. Fully customizable after pick. ── */
  const [templateId, setTemplateId] = useState<VideoTemplateId | null>(() => getLastTemplate());
  const [showTemplatePicker, setShowTemplatePicker] = useState(() => getLastTemplate() == null);
  const [previewDropActive, setPreviewDropActive] = useState(false);
  const template = getVideoTemplate(templateId);

  function applyTemplate(id: VideoTemplateId) {
    const t = getVideoTemplate(id);
    setTemplateId(id);
    setLastTemplate(id);
    setShowTemplatePicker(false);
    // Template defaults: aspect format + caption style. Everything else
    // stays exactly as the user had it (customizable, not a reset).
    setSettingsState((prev) => ({
      ...prev,
      export: { ...prev.export, format: t.defaultFormat },
      captions: { ...prev.captions, stylePreset: t.defaultCaptionPreset },
    }));
    if (t.priorityTabs.length > 0) setTab(t.priorityTabs[0] as EditorTab);
  }

  interface RailTabItem { id: string; label: string; icon: React.ReactNode; testId: string }
  function orderedRailTabs(items: RailTabItem[]): RailTabItem[] {
    if (templateId == null || template.priorityTabs.length === 0) return items;
    const prio = template.priorityTabs;
    return [...items].sort((a, b) => {
      const ai = prio.indexOf(a.id);
      const bi = prio.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  const [requestedAudioExport, setRequestedAudioExport] = useState<AudioExportType | null>(null);
  const [directAudioExportStatus, setDirectAudioExportStatus] = useState<DirectAudioExportStatus>({ status: "idle" });
  function setTab(t: EditorTab) {
    // Centralized enforcement: even internal "go to X" callbacks (captions,
    // effects, branding, lip-sync, studio) must never land a Simple-mode
    // user on an advanced tab. Redirect to a safe default instead.
    const next = isSimple && !SIMPLE_VISIBLE_TABS.includes(t) ? "clips" : t;
    setRawTab(next);
    window.dispatchEvent(new CustomEvent("bdv-editor-tab", { detail: next }));
  }
  useEffect(() => {
    if (isSimple && !SIMPLE_VISIBLE_TABS.includes(tab)) setTab("clips");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimple, tab]);
  /* Voiceover Studio handoff: if the user clicked "Use in video editor" on
     /voiceover, surface the finished narration here so it can be layered
     under the project. The key is cleared after pickup (one-shot). */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bdv_voiceover_handoff");
      if (!raw) return;
      localStorage.removeItem("bdv_voiceover_handoff");
      const handoff = JSON.parse(raw) as {
        audioUrl?: string;
        format?: string;
        wordCount?: number;
      };
      if (!handoff.audioUrl) return;
      toast({
        title: t("videoEditor.voiceoverReadyTitle"),
        description: t("videoEditor.voiceoverReadyDesc", {
          words: handoff.wordCount ?? "?",
          format: String(handoff.format ?? "mp3").toUpperCase(),
          url: handoff.audioUrl,
        }),
      });
    } catch {
      /* malformed handoff — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* ── Thy Library deep-links (?fx= / ?textstyle= / ?transition=) ──────────
     Each slug resolves against the library preset catalog, then maps to the
     editor's built-in export-safe catalog (see LIBRARY_*_MAP above).
     ?fx= activates the effect + opens the Effects tab.
     ?textstyle= sets the caption font + opens the Text tab.
     ?transition= parks in pendingTransitionRef and applies to every clip
     once scenes load (they're async) + opens the Timeline tab.
     Unknown slugs are ignored — never throws, never blocks the editor. */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fxSlug = params.get("fx");
      if (fxSlug) {
        const preset = getLibraryPreset(fxSlug);
        const mapped = preset && preset.category === "Effects" ? LIBRARY_FX_TO_EFFECT[preset.slug] : undefined;
        if (mapped) {
          setSettings((prev) => ({
            ...prev,
            effects: prev.effects.includes(mapped) ? prev.effects : [...prev.effects, mapped],
          }));
          setTab("effects");
        }
      }
      const tsSlug = params.get("textstyle");
      if (tsSlug) {
        const preset = getLibraryPreset(tsSlug);
        const fontId = preset && preset.category === "Text Styles" ? LIBRARY_TEXTSTYLE_TO_FONT[preset.slug] : undefined;
        if (fontId) {
          setSettings((prev) => ({
            ...prev,
            captions: { ...prev.captions, fontFamily: fontId },
          }));
          setTab("captions");
        }
      }
      const trSlug = params.get("transition");
      if (trSlug) {
        const preset = getLibraryPreset(trSlug);
        const mapped = preset && preset.category === "Transitions" ? LIBRARY_TRANSITION_MAP[preset.slug] : undefined;
        if (mapped) {
          pendingTransitionRef.current = mapped;
          setTab("timeline");
        }
      }
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* Applies the parked library transition to every clip once scenes exist. */
  useEffect(() => {
    const mapped = pendingTransitionRef.current;
    if (!mapped || scenes.length === 0) return;
    pendingTransitionRef.current = null;
    setSettings((prev) => {
      const next = { ...prev.clips };
      for (const s of scenes) {
        next[s.id] = { ...defaultClipEdit(), ...(next[s.id] ?? {}), transition: mapped };
      }
      return { ...prev, clips: next };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes]);
  /* Wave 9A Lyrics-to-Timeline handoff: a caption plan drafted in the Music
     Studio's Lyrics-to-Timeline panel lands here as caption lines so the
     creator can style them immediately. One-shot: key removed on pickup. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wave9a_lyric_captions");
      if (!raw) return;
      localStorage.removeItem("wave9a_lyric_captions");
      const handoff = JSON.parse(raw) as {
        songTitle?: string;
        lines?: Array<{ text?: string; start?: number; end?: number }>;
      };
      const lines = (handoff.lines ?? [])
        .filter((l) => l && typeof l.text === "string" && l.text.trim().length > 0)
        .map((l, i) => ({
          id: `wave9a-${Date.now()}-${i}`,
          startSec: Number.isFinite(Number(l.start)) ? Number(l.start) : 0,
          endSec: Number.isFinite(Number(l.end)) ? Number(l.end) : 0,
          text: String(l.text).trim(),
        }));
      if (lines.length === 0) return;
      setSettings((prev) => ({
        ...prev,
        captions: { ...prev.captions, lines: [...prev.captions.lines, ...lines] },
      }));
      setTab("captions");
      toast({
        title: t("videoEditor.lyricCaptionsReadyTitle", { defaultValue: "Lyric captions ready" }),
        description: t("videoEditor.lyricCaptionsReadyDesc", {
          defaultValue: "{{count}} timed lyric lines from “{{title}}” were added — style them here.",
          count: lines.length,
          title: handoff.songTitle?.trim() || "your song",
        }),
      });
    } catch {
      /* malformed handoff — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* ── Video-template deep link: /video-editor?tab=templates&template=<key> ──
     Used by the /templates/videos gallery and share links. The tab is in
     SIMPLE_VISIBLE_TABS so the deep link works in guide mode too. */
  const [deepLinkedTemplateKey, setDeepLinkedTemplateKey] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("tab") === "templates") {
      setTab("templates");
      const key = params.get("template");
      if (key) setDeepLinkedTemplateKey(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  /* ── Pro Tools deep link: /video-editor?tab=pro-tools ──
     Lands the user straight on the Pro Tools tab where the AI Filler-Word
     Remover lives. Pairs with ?videoUrl= for hub handoffs. Simple-mode
     users are redirected to a safe tab by setTab's built-in guard. */
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("tab") === "pro-tools") {
      setTab("pro-tools");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  /* ── Generic rail-tab deep link: /video-editor?tab=<rail-tab-id> ──
     Used by old-URL redirects (e.g. /promo-clip → /video-editor?tab=promo-clips).
     Validates against known tab ids; setTab's built-in guard keeps Simple-mode
     users on safe tabs. */
  const RAIL_TAB_IDS: EditorTab[] = ["clips", "templates", "timeline", "beat-sync", "edit-recipes", "music", "captions", "effects", "motion", "branding", "export", "lip-sync", "studio", "voice-edits", "pre-production", "pro-tools", "promo-clips", "lyric-video", "translate", "repurpose", "upscale", "cartoonize", "thumbnails", "vibes", "locations", "style-stealer", "meme-machine", "three-second-lab"];

  /* 3-Second Lab: prefill the video description from the timeline's opening
     (first scene lyric/action or first caption line). */
  const threeSecondLabHint = useMemo(() => {
    const first = scenes[0];
    const bits: string[] = [];
    if (first?.lyricLine?.trim()) bits.push(first.lyricLine.trim());
    if (first?.action?.trim()) bits.push(first.action.trim());
    if (first?.aiVideoPrompt?.trim()) bits.push(first.aiVideoPrompt.trim().slice(0, 200));
    const cap = settings.captions.lines[0]?.text?.trim();
    if (cap) bits.push(cap);
    return bits.join(" — ").slice(0, 300);
  }, [scenes, settings.captions.lines]);
  useEffect(() => {
    const params = new URLSearchParams(search);
    const deepTab = params.get("tab");
    if (deepTab && (RAIL_TAB_IDS as string[]).includes(deepTab) && deepTab !== "templates" && deepTab !== "pro-tools") {
      setTab(deepTab as EditorTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  /* ── Canvas deep link: /video-editor?tab=export&canvas=1 ──
     Lands the user on the Export tab where the Canvas Generator lives.
     Pairs with ?canvasCover= / ?canvasAudio= / ?canvasTitle= / ?canvasArtist=
     which the CanvasGeneratorSection reads for prefill. Used by "Make a
     Canvas" on song results and "Animate as Canvas" on the cover-art page. */
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("tab") === "export" && params.get("canvas") === "1") {
      setTab("export");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  /* ── Video/clip deep link: /video-editor?video=<url>, ?clip=<url> or ?videoUrl=<url> ──
     Lets any tool hand a finished video straight into the editor as a new
     scene clip. Runs once per URL; the param is stripped via replaceState.
     ?videoUrl= is the hub-project handoff convention (hub assets, podcast). */
  const [videoLinkConsumed, setVideoLinkConsumed] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(search);
    const videoUrl = params.get("video") || params.get("clip") || params.get("videoUrl");
    if (!videoUrl || videoLinkConsumed === videoUrl) return;
    setVideoLinkConsumed(videoUrl);
    const scene: SceneData = {
      id: `link-${Date.now().toString(36)}`,
      sceneNumber: scenesRef.current.length + 1,
      timestamp: "",
      section: "",
      lyricLine: "",
      location: "",
      action: "",
      cameraMovement: "",
      lighting: "",
      mood: "",
      aiVideoPrompt: "",
      negativePrompt: "",
      approved: true,
      demoClipUrl: videoUrl,
      thumbnailUrl: null,
      clipId: null,
      runwayJobId: null,
      provider: "deep-link",
      generationStatus: "completed",
      promptUsed: null,
      generatedAt: new Date().toISOString(),
      clipReusedIntentionally: true,
    };
    setScenes((prev) => [...prev, scene]);
    setTab("clips");
    params.delete("video");
    params.delete("clip");
    params.delete("videoUrl");
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    toast({
      title: t("videoEditor.videoLinkLoadedTitle"),
      description: t("videoEditor.videoLinkLoadedDesc"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  /** Current rendered height of the bottom TimelineDock (0 when no project is loaded), so the pinned
   *  master player's height clamp clears it instead of running underneath it. */
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    if (!project) setDockHeight(0);
  }, [project]);
  /** Current rendered height of the sticky top nav bar, so the pinned master player's
   *  height clamp clears it instead of running underneath it. */
  const [headerHeight, setHeaderHeight] = useState(0);
  /** State broadcast from TimelinePreviewPlayer — drives Live Preview mirroring */
  const [previewEngineState, setPreviewEngineState] = useState<SharedPreviewState | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<"idle" | "rebuilding" | "done" | "error">("idle");
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [autoSceneStatus, setAutoSceneStatus] = useState<"idle" | "generating" | "error">("idle");
  const [autoSceneError, setAutoSceneError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  /** Duration (seconds) probed from the resolved preview audio URL */
  const [detectedAudioDuration, setDetectedAudioDuration] = useState<number | null>(null);
  /** Selected clip index — shared between the persistent TimelineDock and the Studio tab inspector. */
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  /** Wave 9 — kept beat-marker times from BeatSyncSection, fed into TimelineTemplatesSection's beatGrid. */
  const [beatGrid, setBeatGrid] = useState<number[]>([]);

  const [testEffectActive, setTestEffectActive] = useState(false);
  const testEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function triggerTestEffect() {
    setTestEffectActive(true);
    if (testEffectTimerRef.current) clearTimeout(testEffectTimerRef.current);
    testEffectTimerRef.current = setTimeout(() => setTestEffectActive(false), 2000);
  }

  /** Video element for the departing clip during scene transitions */
  const outgoingVideoRef = useRef<HTMLVideoElement | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transitionState, setTransitionState] = useState<TransitionState | null>(null);
  const testOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [testOverlayActive, setTestOverlayActive] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  /** Called by TimelinePreviewPlayer when a scene switch fires during playback. */
  function handleSceneChange(_oldIdx: number, newIdx: number) {
    const scene = scenes[newIdx];
    if (!scene) return;
    const clip = getClipEdit(settings, scene.id);
    const type = clip.transition;
    if (!type || type === "Cut") return;
    const duration = Math.max(0.1, Math.min(3.0, clip.transitionDuration ?? 1.0));
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    setTransitionState({ type, duration });
    transitionTimerRef.current = setTimeout(() => setTransitionState(null), duration * 1000 + 100);
  }

  function triggerTestTransition() {
    const clipped = scenes.filter((s) => s.demoClipUrl?.startsWith("http"));
    if (outgoingVideoRef.current && clipped[0]?.demoClipUrl) {
      outgoingVideoRef.current.src = clipped[0].demoClipUrl;
      outgoingVideoRef.current.muted = true;
      outgoingVideoRef.current.play().catch(() => {});
    }
    if (liveVideoRef.current && clipped[1]?.demoClipUrl) {
      liveVideoRef.current.src = clipped[1].demoClipUrl;
      liveVideoRef.current.muted = true;
      liveVideoRef.current.play().catch(() => {});
    }
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    setTransitionState({ type: "Crossfade", duration: 1.0 });
    transitionTimerRef.current = setTimeout(() => setTransitionState(null), 1100);
  }

  /** Jump the master player to ~1s before a scene's transition and play it. */
  function handlePreviewTransition(sceneIndex: number) {
    setTab("timeline");
    timelinePlayerRef.current?.previewTransition(sceneIndex);
  }

  function triggerTestOverlay() {
    setTestOverlayActive(true);
    if (testOverlayTimerRef.current) clearTimeout(testOverlayTimerRef.current);
    testOverlayTimerRef.current = setTimeout(() => setTestOverlayActive(false), 3000);
  }

  const hydrated  = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current ref so persist() never uses a stale scenes closure
  const scenesRef = useRef<SceneData[]>([]);
  /** Imperative handle into TimelinePreviewPlayer — lets master player control audio */
  const timelinePlayerRef = useRef<TimelinePlayerHandle>(null);
  /** Single shared video element driven imperatively by the effect below */
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);

  /* ── Deep-link initial seek (?t=seconds) ────────────────────────────────────
   * From client review comments: /video-editor?project=<id>&t=42 opens the
   * editor with the timeline parked at the reviewer's timestamp. Seeks once,
   * after the project has loaded and the player handle is mounted. */
  const initialSeekDone = useRef(false);
  useEffect(() => {
    if (initialSeekDone.current || loading || !project) return;
    const tParam = new URLSearchParams(search).get("t");
    const target = tParam != null ? Number(tParam) : NaN;
    if (!Number.isFinite(target) || target <= 0) {
      initialSeekDone.current = true;
      return;
    }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const player = timelinePlayerRef.current;
      if (player) {
        try { player.seekTo(Math.max(0, target)); } catch { /* player not ready */ }
        initialSeekDone.current = true;
        clearInterval(timer);
      } else if (attempts > 40) {
        initialSeekDone.current = true;
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot deep link
  }, [loading, project, search]);

  /* ── Load project ── */
  useEffect(() => {
    if (!user || !projectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/projects/${projectId}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) throw new Error(res.status === 404 ? t("videoEditor.projectNotFound") : t("videoEditor.loadProjectFailed"));
        const data = (await res.json()) as { project: LoadedProject };
        if (cancelled) return;
        setProject(data.project);
        const savedResult = data.project.output_data?.result ?? null;
        setRawResult(savedResult);
        const savedScenes = data.project.output_data?.scenes ?? [];
        // Auto-parse scenes from saved result text when none were persisted
        if (savedScenes.length === 0 && savedResult) {
          const parsed = parseScenes(extractBreakdownContent(savedResult));
          setScenes(parsed);
          if (parsed.length > 0) setRebuildStatus("done");
        } else {
          setScenes(savedScenes);
        }
        setSettings(normalizeEditorSettings(data.project.output_data?.editorSettings));
        setTranscriptText(data.project.output_data?.transcriptText ?? null);
        resetHistory();
        hydrated.current = true;
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("videoEditor.loadProjectFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on user id, not the
    // user object, so a same-user session refresh (new object ref) doesn't re-trigger reload
  }, [user?.id, projectId, getAccessToken]);

  /* ── Keep scenesRef in sync so persist() is never stale ── */
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);

  /** Always-current ref for settings (mirrors scenesRef) — lets undo/redo
   *  snapshots read the latest value outside render. */
  const settingsRef = useRef<EditorSettings>(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  /* ── Undo/redo history over {scenes, settings} ─────────────────────────
   * The wrapped setScenes/setSettings below snapshot the pre-change state
   * before applying. Child sections receive the wrapped setters, so every
   * editor edit — clip attach, reorder, captions, effects, branding, music —
   * is undoable. Rapid bursts (typing, slider drags) coalesce into one step. */
  interface EditorSnapshot { scenes: SceneData[]; settings: EditorSettings; }
  const undoHistoryApi = useUndoRedo<EditorSnapshot>({ maxHistory: 50, coalesceMs: 800 });
  const { push: pushHistory, undo: undoStep, redo: redoStep, reset: resetHistory } = undoHistoryApi;
  const canUndo = undoHistoryApi.canUndo;
  const canRedo = undoHistoryApi.canRedo;

  const snapshotNow = useCallback((): EditorSnapshot => ({
    scenes: scenesRef.current,
    settings: settingsRef.current,
  }), []);

  const setScenes = useCallback((update: SetStateAction<SceneData[]>) => {
    const prev = scenesRef.current;
    const next = typeof update === "function" ? (update as (p: SceneData[]) => SceneData[])(prev) : update;
    if (next === prev) return;
    pushHistory(snapshotNow());
    scenesRef.current = next;
    setScenesState(next);
  }, [pushHistory, snapshotNow]);

  /* ── Hub project spine: drop a project clip/video straight into the
     timeline as its own scene (marked intentionally-reused so the export's
     duplicate-URL check exempts it). ── */
  const addHubAssetAsScene = useCallback((asset: HubAsset) => {
    const scene: SceneData = {
      id: `hub-${Date.now().toString(36)}`,
      sceneNumber: scenesRef.current.length + 1,
      timestamp: "",
      section: "",
      lyricLine: "",
      location: "",
      action: asset.label,
      cameraMovement: "",
      lighting: "",
      mood: "",
      aiVideoPrompt: asset.meta?.["prompt"] ?? "",
      negativePrompt: "",
      approved: true,
      demoClipUrl: asset.url,
      thumbnailUrl: null,
      clipId: null,
      runwayJobId: null,
      provider: null,
      generationStatus: "completed",
      promptUsed: asset.meta?.["prompt"] ?? null,
      generatedAt: new Date().toISOString(),
      clipReusedIntentionally: true,
    };
    setScenes((prev) => [...prev, scene]);
    toast({ title: t("hubSpine.flowBar.clipAdded"), description: asset.label });
  }, [setScenes, toast, t]);

  /* ── Video-template handoff: finished template video → "Add captions" ──
     Appends the rendered video as a new scene clip and opens the captions
     tab so the creator can caption it immediately. */
  const handleTemplateVideoForCaptions = useCallback((videoUrl: string, title: string) => {
    const scene: SceneData = {
      id: `template-${Date.now().toString(36)}`,
      sceneNumber: scenesRef.current.length + 1,
      timestamp: "",
      section: title,
      lyricLine: "",
      location: "",
      action: title,
      cameraMovement: "",
      lighting: "",
      mood: "",
      aiVideoPrompt: title,
      negativePrompt: "",
      approved: true,
      demoClipUrl: videoUrl,
      thumbnailUrl: null,
      clipId: null,
      runwayJobId: null,
      provider: "video-template",
      generationStatus: "completed",
      promptUsed: null,
      generatedAt: new Date().toISOString(),
      clipReusedIntentionally: true,
    };
    setScenes((prev) => [...prev, scene]);
    setTab("captions");
    toast({
      title: t("videoEditor.templateVideoAddedTitle"),
      description: t("videoEditor.templateVideoAddedDesc"),
    });
  }, [setScenes, setTab, toast, t]);

  /* ── Split-screen handoffs (docked in the Templates tab) ──
     "Use in editor": appends the finished grid as a new scene clip so it can
     be dropped on the timeline (clips tab). "Multi-ratio": prefills the
     export tab's multi-ratio card with the grid URL so it's one click away. */
  const handleSplitScreenUseInEditor = useCallback((videoUrl: string, title: string) => {
    const scene: SceneData = {
      id: `splitscreen-${Date.now().toString(36)}`,
      sceneNumber: scenesRef.current.length + 1,
      timestamp: "",
      section: title,
      lyricLine: "",
      location: "",
      action: title,
      cameraMovement: "",
      lighting: "",
      mood: "",
      aiVideoPrompt: title,
      negativePrompt: "",
      approved: true,
      demoClipUrl: videoUrl,
      thumbnailUrl: null,
      clipId: null,
      runwayJobId: null,
      provider: "split-screen",
      generationStatus: "completed",
      promptUsed: null,
      generatedAt: new Date().toISOString(),
      clipReusedIntentionally: true,
    };
    setScenes((prev) => [...prev, scene]);
    setTab("clips");
    toast({
      title: t("videoEditor.splitScreenAddedTitle"),
      description: t("videoEditor.splitScreenAddedDesc"),
    });
  }, [setScenes, setTab, toast, t]);

  const handleSplitScreenMultiRatio = useCallback((videoUrl: string) => {
    try {
      sessionStorage.setItem("bdv:multiratio-prefill", videoUrl);
    } catch {
      /* prefill skipped — the manual URL field still works */
    }
    setTab("export");
    toast({
      title: t("videoEditor.splitScreenMultiRatioTitle"),
      description: t("videoEditor.splitScreenMultiRatioDesc"),
    });
  }, [setTab, toast, t]);

  const setSettings = useCallback((update: SetStateAction<EditorSettings>) => {
    const prev = settingsRef.current;
    const next = typeof update === "function" ? (update as (p: EditorSettings) => EditorSettings)(prev) : update;
    if (next === prev) return;
    pushHistory(snapshotNow());
    settingsRef.current = next;
    setSettingsState(next);
  }, [pushHistory, snapshotNow]);

  /* Trending Remix Feed deep-link (?remix=<slug>) — applies the preset's
     effect/motion and opens the relevant tab. */
  useRemixDeeplink({ setSettings, setTab });

  const handleUndo = useCallback(() => {
    const snap = undoStep(snapshotNow());
    if (!snap) return;
    scenesRef.current = snap.scenes;
    settingsRef.current = snap.settings;
    setScenesState(snap.scenes);
    setSettingsState(snap.settings);
  }, [undoStep, snapshotNow]);

  /** Wave 9 — apply beat-cut times as real scene splits in the timeline model.
      Same split semantics as TimelineDock's doSplit: the scene under each cut
      time becomes two scenes with adjusted trimStart/trimEnd. Cuts are
      processed ascending so inserted boundaries don't shift later cuts.
      Undoable via the wrapped setScenes/setSettings. Returns the number of
      cuts actually applied. */
  const applyBeatCuts = useCallback((cuts: number[]): number => {
    const curScenes = scenesRef.current;
    const curSettings = settingsRef.current;
    if (!curScenes.length || !cuts.length) return 0;
    const audioDur = previewEngineState?.audioDuration ?? null;
    let nextScenes = [...curScenes];
    let nextClips: Record<string, ClipEdit> = { ...(curSettings.clips ?? {}) };
    let applied = 0;
    const sorted = [...cuts].filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b);
    for (const t of sorted) {
      const timings = computeSceneTimings(nextScenes, audioDur);
      const idx = timings.findIndex((tm) => t >= tm.startSec && t < tm.endSec);
      if (idx < 0) continue;
      const tm = timings[idx]!;
      const scene = nextScenes[idx]!;
      const splitAt = t - tm.startSec;
      /* Same 0.3s edge guard as doSplit — skip cuts too close to a boundary. */
      if (splitAt <= 0.3 || splitAt >= tm.durationSec - 0.3) continue;
      const ce = nextClips[scene.id] ?? defaultClipEdit();
      const origTrimStart = ce.trimStart ?? 0;
      const origTrimEnd = ce.trimEnd ?? 0;
      const secondId = `sc_${Math.random().toString(36).slice(2, 10)}`;
      const f = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
      const secondScene: SceneData = {
        ...scene,
        id: secondId,
        sceneNumber: scene.sceneNumber + 0.5,
        timestamp: `${f(tm.startSec + splitAt)}-${f(tm.endSec)}`,
      };
      const firstScene: SceneData = { ...scene, timestamp: `${f(tm.startSec)}-${f(tm.startSec + splitAt)}` };
      nextScenes = [...nextScenes];
      nextScenes[idx] = firstScene;
      nextScenes.splice(idx + 1, 0, secondScene);
      nextClips = {
        ...nextClips,
        [scene.id]: { ...ce, trimEnd: origTrimEnd + (tm.durationSec - splitAt) },
        [secondId]: { ...ce, trimStart: origTrimStart + splitAt, useLipSync: false, lipSyncUrl: null, lipSyncStatus: null },
      };
      applied++;
    }
    if (applied > 0) {
      setScenes(nextScenes);
      setSettings({ ...curSettings, clips: nextClips });
    }
    return applied;
  }, [previewEngineState?.audioDuration, setScenes, setSettings]);

  const handleRedo = useCallback(() => {
    const snap = redoStep(snapshotNow());
    if (!snap) return;
    scenesRef.current = snap.scenes;
    settingsRef.current = snap.settings;
    setScenesState(snap.scenes);
    setSettingsState(snap.settings);
  }, [redoStep, snapshotNow]);

  /* Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — skipped inside text fields so native
   * field-level undo keeps working there; the toolbar buttons always work. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  /* ── Debounced autosave on scenes / settings change ── */
  useEffect(() => {
    if (loading || !project) return;
    if (!hydrated.current) return;
    if (!autosaveEnabled) {
      // Autosave off: cancel any pending timer, don't touch the server —
      // just flag unsaved changes.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("unsaved");
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(() => { void persist(); }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, settings, loading, project, autosaveEnabled]);

  /* ── Re-enabling autosave flushes any pending unsaved changes immediately ── */
  useEffect(() => {
    if (autosaveEnabled && saveState === "unsaved" && project && !loading) {
      void saveNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveEnabled]);

  /* ── Auto-select first scene with clip for preview ── */
  useEffect(() => {
    if (previewSceneId) return;
    const first = scenes.find((s) => sceneHasClip(s));
    if (first) setPreviewSceneId(first.id);
  }, [scenes, previewSceneId]);

  async function persist(): Promise<boolean> {
    if (!project) return false;
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          // Use the ref — never stale even when called from an old closure / timer
          scenes: scenesRef.current,
          outputData: { editorSettings: { ...settings, updatedAt: new Date().toISOString() } },
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }

  async function saveNow() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    const ok = await persist();
    toast(
      ok
        ? { title: t("videoEditor.saveOkTitle"), description: t("videoEditor.saveOkDesc") }
        : { title: t("videoEditor.saveFailedTitle"), description: t("videoEditor.saveFailedDesc"), variant: "destructive" },
    );
  }

  async function rebuildScenesFromPlan() {
    // Show rebuilding state FIRST so the UI responds immediately
    setRebuildStatus("rebuilding");
    setRebuildError(null);

    if (!rawResult) {
      setRebuildStatus("error");
      setRebuildError(t("videoEditor.noSavedPlanError"));
      return;
    }

    try {
      // Try the breakdown section first; fall back to the full result
      let breakdown = extractBreakdownContent(rawResult);
      if (!breakdown) {
        breakdown = rawResult;
      }

      const { scenes: parsed } = parseScenesWithMode(breakdown);

      if (parsed.length === 0) {
        setRebuildStatus("error");
        setRebuildError(t("videoEditor.noSceneBreakdownError"));
        return;
      }

      // Update the ref BEFORE setScenes so the autosave timer
      // that will fire ~1.2 s later gets the fresh array, not stale []
      scenesRef.current = parsed;
      setScenes(parsed);
      setRebuildStatus("done");

      // ── Hard save immediately (do not rely only on the debounced autosave) ──
      if (project) {
        try {
          const token = await getAccessToken();
          const patchRes = await fetch(`/api/projects/${project.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
            body: JSON.stringify({ scenes: parsed }),
          });
          if (patchRes.ok) {
            setSaveState("saved");

            // Verify: re-fetch the project and confirm the scenes are there (best-effort)
            try {
              const verifyToken = await getAccessToken();
              const verifyRes = await fetch(`/api/projects/${project.id}`, {
                headers: { Authorization: `Bearer ${verifyToken ?? ""}` },
              });
              if (verifyRes.ok) {
                await verifyRes.json();
              }
            } catch {
              // verification is best-effort; ignore failures
            }
          } else {
            const errText = await patchRes.text().catch(() => String(patchRes.status));
            toast({
              title: t("videoEditor.scenesRebuiltButSaveFailedTitle"),
              description: t("videoEditor.scenesRebuiltButSaveFailedDesc", { status: patchRes.status, detail: errText.slice(0, 120) }),
              variant: "destructive",
            });
          }
        } catch (saveErr) {
          const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
          toast({
            title: t("videoEditor.scenesRebuiltButSaveFailedTitle"),
            description: t("videoEditor.rebuildSaveFailedDetail", { msg }),
            variant: "destructive",
          });
        }
      }

      toast({ title: t("videoEditor.scenesRebuiltSaved", { count: parsed.length }), description: t("videoEditor.scenesReadyDesc") });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setRebuildStatus("error");
      setRebuildError(t("videoEditor.parseScenesError", { msg }));
      toast({ title: t("videoEditor.parseScenesTitle"), description: msg, variant: "destructive" });
    }
  }

  /* ── Generate scenes straight from the song's audio (no text plan needed) ── */
  async function generateScenesFromSong() {
    if (!previewAudioUrl) return;
    setAutoSceneStatus("generating");
    setAutoSceneError(null);
    try {
      const flow = await runAudioSceneFlow({
        lyrics: lyricsForCaptions ?? "",
        audioUrl: previewAudioUrl,
        audioFile: null,
        songStructure: null,
        getAccessToken,
        fetchImpl: confirmedFetch,
      });
      if (!flow) {
        // User cancelled the credit confirmation — reset the status and bail out
        setAutoSceneStatus("idle");
        return;
      }
      const { scenes: newScenes } = flow;
      scenesRef.current = newScenes;
      setScenes(newScenes);
      setAutoSceneStatus("idle");
      toast({ title: t("videoEditor.scenesGeneratedFromSong", { count: newScenes.length }), description: t("videoEditor.scenesReadyDesc") });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("videoEditor.autoSceneErrorDefault");
      setAutoSceneStatus("error");
      setAutoSceneError(msg);
    }
  }

  /* ── Sync Missing Clips ── */
  async function syncMissingClips() {
    if (!project) return;
    setSyncState("syncing");
    setSyncMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/projects/${project.id}/sync-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
      });
      const json = await res.json() as {
        synced?: number;
        skipped?: number;
        message?: string;
        error?: string;
        scenes?: SceneData[];
      };
      if (!res.ok) {
        const errMsg = json.error ?? `Server error ${res.status}`;
        setSyncState("error");
        setSyncMsg(errMsg);
        toast({ title: t("videoEditor.syncFailedTitle"), description: errMsg, variant: "destructive" });
        return;
      }
      const synced = json.synced ?? 0;
      /* TEMPORARY (2026-09-22): apply recovered scenes even when sync attaches nothing */
      const recovered = (json as { recovered?: number }).recovered ?? 0;
      if (json.scenes && json.scenes.length > 0 && (synced > 0 || recovered > 0)) {
        scenesRef.current = json.scenes;
        setScenes(json.scenes);
      }
      if (synced === 0 && recovered === 0) {
        setSyncState("done");
        setSyncMsg(json.message ?? t("videoEditor.noNewClipsMsg"));
        toast({ title: t("videoEditor.nothingToSyncTitle"), description: json.message ?? t("videoEditor.nothingToSyncDesc") });
        return;
      }
      if (recovered > 0 && synced === 0) {
        setSyncState("done");
        setSyncMsg(json.message ?? t("videoEditor.recoveredClipsMsg", { count: recovered, plural: recovered !== 1 ? "s" : "" }));
        toast({
          title: t("videoEditor.clipsRecoveredTitle", { count: recovered, plural: recovered !== 1 ? "s" : "" }),
          description: t("videoEditor.clipsRecoveredDesc"),
        });
        return;
      }
      /* Update local scenes state from the server response */
      if (json.scenes && json.scenes.length > 0) {
        scenesRef.current = json.scenes;
        setScenes(json.scenes);
      }
      setSyncState("done");
      setSyncMsg(t("videoEditor.syncedClipsMsg", { count: synced, plural: synced !== 1 ? "s" : "" }));
      toast({
        title: t("videoEditor.clipsSyncedTitle", { count: synced, plural: synced !== 1 ? "s" : "" }),
        description: t("videoEditor.clipsSyncedDesc"),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSyncState("error");
      setSyncMsg(msg);
      toast({ title: t("videoEditor.syncFailedTitle"), description: msg, variant: "destructive" });
    }
  }

  /** Save transcript to project output_data and update local state. */
  async function handleTranscriptReady(text: string) {
    setTranscriptText(text);
    if (!project) return;
    try {
      const token = await getAccessToken();
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          outputData: {
            transcriptText: text,
            transcriptAt: new Date().toISOString(),
          },
        }),
      });
    } catch {
      /* non-fatal — transcript is already in local state */
    }
  }

  const artistName = project?.artist_name ?? (project?.input_data?.["artistName"] as string | undefined) ?? "";
  const songTitle = project?.song_title ?? (project?.input_data?.["songTitle"] as string | undefined) ?? "";
  const audioUrl =
    (project?.input_data?.["audioUrl"] as string | undefined) ??
    (project?.input_data?.["audio_url"] as string | undefined) ??
    null;

  /**
   * Resolved audio URL for Timeline Preview — mirrors ExportSection's
   * resolveAudioUrl() so the same audio source the user chose for export
   * is also used for preview.
   *
   * Priority:
   *  1. videoAudio.source → uploaded URL / mix export / stem export
   *  2. project-level audioUrl (uploaded song)
   *  3. first uploaded stem URL (Music Mixer fallback)
   */
  const previewAudioResolution = resolveVideoAudio(settings.musicStudio, audioUrl);
  const previewAudioUrl: string | null = previewAudioResolution.url;
  const selectedMixMissing = previewAudioResolution.missingExport &&
    settings.musicStudio.videoAudio.source !== "uploaded" &&
    settings.musicStudio.videoAudio.source !== "none";
  const missingMixExportType = audioExportTypeForVideoAudioSource(settings.musicStudio.videoAudio.source);
  const canDirectRenderMissingMix =
    !isSimple &&
    selectedMixMissing &&
    missingMixExportType !== null &&
    canRenderVideoAudioSource(settings.musicStudio.videoAudio.source, settings.musicStudio.stems);
  const missingMixExportLabel = missingMixExportType
    ? AUDIO_EXPORT_BUTTONS.find((button) => button.id === missingMixExportType)?.label ?? t("videoEditor.renderMix")
    : t("videoEditor.renderMix");

  function requestMissingMixRender() {
    if (!missingMixExportType || !canDirectRenderMissingMix) {
      setTab("music");
      return;
    }
    setDirectAudioExportStatus({
      status: "rendering",
      exportType: missingMixExportType,
      label: missingMixExportLabel,
    });
    setRequestedAudioExport(missingMixExportType);
    setTab("music");
  }

  /* ── Lyrics: check project input_data first, then fall back to scene lyricLines ── */
  const projectLyrics =
    (project?.input_data?.["lyrics"] as string | undefined) ??
    (project?.input_data?.["lyricsText"] as string | undefined) ??
    (project?.input_data?.["songLyrics"] as string | undefined) ??
    null;
  const sceneLyricsJoined =
    scenes.length > 0
      ? scenes.map((s) => s.lyricLine).filter(Boolean).join("\n")
      : "";
  const lyricsForCaptions = projectLyrics ?? transcriptText ?? (sceneLyricsJoined || null);

  /* ── Probe audio duration from the preview URL whenever it changes ──
     This is the exact URL Timeline Preview uses — if it plays, this fires.
     On success we immediately write the duration into settings so it persists
     across tab switches and page reloads without re-probing.              */
  useEffect(() => {
    if (!previewAudioUrl) {
      setDetectedAudioDuration(null);
      return;
    }
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    let disposed = false;

    const onLoaded = () => {
      if (!disposed && isFinite(audio.duration) && audio.duration > 0) {
        setDetectedAudioDuration(audio.duration);
      }
    };
    const onError = () => {
      /* leave detectedAudioDuration as-is — don't clear a previously good value */
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.src = previewAudioUrl;

    return () => {
      disposed = true;
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };
  }, [previewAudioUrl]);

  /* ── Persist detected duration into settings so CaptionsSection + export
     can read it immediately without re-probing on every tab switch.       */
  useEffect(() => {
    if (detectedAudioDuration == null) return;
    if (settings.musicStudio.videoAudio.duration === detectedAudioDuration) return;
    setSettings((prev) => ({
      ...prev,
      musicStudio: {
        ...prev.musicStudio,
        videoAudio: { ...prev.musicStudio.videoAudio, duration: detectedAudioDuration },
      },
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedAudioDuration]);

  /* ── Song duration — priority: persisted in settings → project metadata → live probe ── */
  const songDuration: number | null =
    settings.musicStudio.videoAudio.duration ??
    (project?.input_data?.["songDuration"] as number | undefined) ??
    (project?.input_data?.["duration"] as number | undefined) ??
    detectedAudioDuration ??
    null;

  /* Scenes with lipSyncUrl swapped in for demoClipUrl when useLipSync is active.
     This is the source-of-truth for all player components. */
  const resolvedScenes = useMemo<SceneData[]>(
    () =>
      scenes.map((s) => {
        const ce = settings.clips[s.id];
        if (ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl) {
          return {
            ...s,
            demoClipUrl: ce.lipSyncUrl,
            clipVideoOffsetSec: ce.lipSyncOffsetSeconds ?? 0,
          };
        }
        return s;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenes, settings.clips],
  );
  const previewScene = resolvedScenes.find((s) => s.id === previewSceneId) ?? null;
  const approvedCount = scenes.filter((s) => s.approved && sceneHasClip(s)).length;

  /* ── Static clip preview — drives liveVideoRef before timeline is started ──
     Once the user starts the timeline, TimelinePreviewPlayer drives the video
     imperatively via externalVideoRef. This effect only handles the "static"
     case: no engine running, user clicks Preview on a scene in the Clips tab. */
  useEffect(() => {
    const v = liveVideoRef.current;
    if (!v) return;
    // If engine has ever started (isPlaying or time > 0), TimelinePreviewPlayer
    // owns the video — don't override it here.
    if (previewEngineState?.isPlaying) return;
    if ((previewEngineState?.currentTime ?? 0) > 0) return;

    const clip = previewScene?.demoClipUrl ?? null;
    if (clip) {
      if (v.src !== clip) { v.src = clip; v.currentTime = 0; }
      v.muted = true;
      void v.play().catch(() => {});
    } else {
      v.pause();
      v.removeAttribute("src");
    }
  // Only re-run when the selected clip changes (engine drives itself)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewScene?.demoClipUrl]);

  /* ── Character consistency ── */
  const CONSISTENCY_MARKER = "[CHARACTER CONSISTENCY:";
  function applyConsistencyToAllScenes() {
    if (!consistencyPrompt || scenes.length === 0) return;
    const updated = scenes.map((scene) => {
      const existingPrompt = scene.aiVideoPrompt ?? "";
      if (existingPrompt.startsWith(CONSISTENCY_MARKER)) return scene;
      return { ...scene, aiVideoPrompt: `${consistencyPrompt}\n\n${existingPrompt}`.trimEnd() };
    });
    setScenes(updated);
    toast({
      title: t("videoEditor.consistencyAppliedTitle"),
      description: t("videoEditor.consistencyAppliedDesc", { count: scenes.length, plural: scenes.length !== 1 ? "s" : "" }),
    });
  }

  /* ── Context-aware tips for the Help Panel ── */
  const helpTips = [
    !previewScene && scenes.length > 0
      ? t("videoEditor.tipNoPreviewScene")
      : null,
    !audioUrl && settings.musicStudio.stems.length === 0
      ? t("videoEditor.tipNoAudio")
      : null,
    settings.captions.lines.length === 0
      ? t("videoEditor.tipNoCaptions")
      : null,
    settings.effects.length > 0
      ? t("videoEditor.tipEffectsSelected", { count: settings.effects.length, plural: settings.effects.length !== 1 ? "s" : "" })
      : t("videoEditor.tipNoEffects"),
    approvedCount > 0
      ? t("videoEditor.tipClipsApproved", { count: approvedCount, plural: approvedCount !== 1 ? "s" : "" })
      : t("videoEditor.tipNoApprovedClips"),
  ].filter(Boolean) as string[];

  return (
    <>
    <div className="h-screen flex flex-col bg-black text-white overflow-hidden">
      <VideoBanner onHeightChange={setHeaderHeight} />

      <div className="flex-1 flex flex-col min-h-0 relative">
        <Link href="/my-projects" className="sr-only">{t("videoEditor.backToProjects")}</Link>

        {!projectId ? (
          <NoProject />
        ) : loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        ) : loadError ? (
          <div className="py-20 text-center space-y-3">
            <p className="text-red-400 font-semibold">{loadError}</p>
            <Link href="/my-projects"><Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">{t("videoEditor.backToProjects")}</Button></Link>
          </div>
        ) : (
          <>
            {/* ── CapCut-style slim top bar ── */}
            <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-white/10 bg-black">
              <Link href="/my-projects" className="flex items-center gap-2 text-white/50 hover:text-white transition-colors">
                <ArrowLeft className="h-4 w-4" />
                <span className="text-xs font-bold hidden sm:inline">{t("videoEditor.projectsNav")}</span>
              </Link>
              <div className="w-px h-5 bg-white/10" aria-hidden="true" />
              <div className="flex items-center gap-2 min-w-0">
                <Clapperboard className="h-4 w-4 text-primary shrink-0" />
                <h1 className="text-sm font-bold text-white tracking-tight truncate">{project?.title || t("videoEditor.untitledProject")}</h1>
              </div>
              <SaveIndicator state={saveState} />
              <div className="flex-1" />
              <Button
                onClick={() => setShowTemplatePicker(true)}
                size="sm"
                variant="ghost"
                className="text-[#C9A84C] hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 gap-2 h-8 border border-[#C9A84C]/30"
                title={t("videoEditor.changeTemplateTitle")}
                data-testid="btn-template-picker"
              >
                <Sparkles className="h-3.5 w-3.5" /> <span className="hidden md:inline">{template.name}</span>
              </Button>
              <Button onClick={handleUndo} disabled={!canUndo} size="sm" variant="ghost" className="text-white/60 hover:text-white hover:bg-white/5 gap-2 h-8 disabled:opacity-30" title={t("videoEditor.undoTitle")} data-testid="btn-undo-editor">
                <Undo2 className="h-3.5 w-3.5" /> <span className="hidden md:inline">{t("videoEditor.undo")}</span>
              </Button>
              <Button onClick={handleRedo} disabled={!canRedo} size="sm" variant="ghost" className="text-white/60 hover:text-white hover:bg-white/5 gap-2 h-8 disabled:opacity-30" title={t("videoEditor.redoTitle")} data-testid="btn-redo-editor">
                <Redo2 className="h-3.5 w-3.5" /> <span className="hidden md:inline">{t("videoEditor.redo")}</span>
              </Button>
              <Button onClick={() => setTab("captions")} size="sm" variant="ghost" className="text-[#C9A84C] hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 gap-2 h-8 border border-[#C9A84C]/30" title={t("videoEditor.autoCaptionsTitle", { defaultValue: "Auto-generate captions from audio" })} data-testid="btn-auto-captions">
                <Captions className="h-3.5 w-3.5" /> <span className="hidden md:inline">{t("videoEditor.autoCaptions", { defaultValue: "Auto Captions" })}</span>
              </Button>
              <label
                className="flex items-center gap-1.5 cursor-pointer select-none shrink-0"
                title={t("videoEditor.autosaveTitle")}
                data-testid="autosave-toggle-wrap"
              >
                <Switch
                  checked={autosaveEnabled}
                  onCheckedChange={setAutosaveEnabled}
                  className="scale-[0.8]"
                  data-testid="autosave-toggle"
                  aria-label={t("videoEditor.autosave")}
                />
                <span className="text-xs text-white/50 hidden lg:inline">{t("videoEditor.autosave")}</span>
              </label>
              <Button onClick={saveNow} size="sm" variant="ghost" className="text-white/60 hover:text-white hover:bg-white/5 gap-2 h-8" data-testid="btn-save-editor">
                <Save className="h-3.5 w-3.5" /> {t("videoEditor.save")}
              </Button>
              <Button onClick={() => setTab("export")} size="sm" className="bg-primary text-black hover:bg-primary/90 font-bold gap-2 h-8" data-testid="btn-export-topbar">
                <Download className="h-3.5 w-3.5" /> {t("videoEditor.export")}
              </Button>
            </div>

            {/* ── CapCut 3-pane layout: rail · panel · preview · inspector ── */}
            <div className="flex-1 flex min-h-0 relative" style={{ paddingBottom: dockHeight }}>

              {/* ── LEFT RAIL: icon nav ── */}
              <nav className="w-[68px] shrink-0 bg-[#080808] border-r border-white/10 flex flex-col items-center py-3 gap-1 overflow-y-auto" aria-label="Editor sections">
                {orderedRailTabs([
                    // ── 1. PLAN & SOURCE ──
                    { id: "pre-production", label: t("videoEditor.railPrePro"), icon: <BookOpen className="h-5 w-5" />, testId: "rail-pre-production" },
                    { id: "clips", label: t("videoEditor.railMedia"), icon: <Film className="h-5 w-5" />, testId: "rail-clips" },
                    { id: "templates", label: t("videoEditor.railTemplates"), icon: <LayoutTemplate className="h-5 w-5" />, testId: "rail-templates" },
                    { id: "music", label: t("videoEditor.railAudio"), icon: <Music2 className="h-5 w-5" />, testId: "rail-music" },
                    // ── 2. BUILD ──
                    { id: "timeline", label: t("videoEditor.railTimeline"), icon: <ListVideo className="h-5 w-5" />, testId: "rail-timeline" },
                    { id: "beat-sync", label: t("videoEditor.railBeatSync"), icon: <AudioWaveform className="h-5 w-5" />, testId: "rail-beat-sync" },
                    { id: "captions", label: t("videoEditor.railText"), icon: <Captions className="h-5 w-5" />, testId: "rail-captions" },
                    { id: "effects", label: t("videoEditor.railEffects"), icon: <Wand2 className="h-5 w-5" />, testId: "rail-effects" },
                    { id: "motion", label: t("videoEditor.railMotion", { defaultValue: "Motion" }), icon: <Wand2 className="h-5 w-5" />, testId: "rail-motion" },
                    { id: "lip-sync", label: t("videoEditor.railLipSync"), icon: <Mic2 className="h-5 w-5" />, testId: "rail-lip-sync" },
                    { id: "voice-edits", label: t("videoEditor.railVoiceEdits"), icon: <MessageSquareText className="h-5 w-5" />, testId: "rail-voice-edits" },
                    { id: "branding", label: t("videoEditor.railBrand"), icon: <Layers className="h-5 w-5" />, testId: "rail-branding" },
                    // ── 3. STYLE & POLISH ──
                    { id: "vibes", label: t("videoEditor.railVibes", { defaultValue: "Vibes" }), icon: <Palette className="h-5 w-5" />, testId: "rail-vibes" },
                    { id: "style-stealer", label: t("videoEditor.railStyleStealer", { defaultValue: "Style Stealer" }), icon: <Fingerprint className="h-5 w-5" />, testId: "rail-style-stealer" },
                    { id: "locations", label: t("videoEditor.railLocations", { defaultValue: "Locations" }), icon: <MapPin className="h-5 w-5" />, testId: "rail-locations" },
                    { id: "upscale", label: t("videoEditor.railUpscale", { defaultValue: "Upscale" }), icon: <Maximize className="h-5 w-5" />, testId: "rail-upscale" },
                    { id: "cartoonize", label: t("videoEditor.railCartoonize", { defaultValue: "Cartoonize" }), icon: <Sparkles className="h-5 w-5" />, testId: "rail-cartoonize" },
                    // ── 4. CREATE MORE ──
                    { id: "promo-clips", label: t("videoEditor.railPromoClips", { defaultValue: "Promo Clips" }), icon: <Film className="h-5 w-5" />, testId: "rail-promo-clips" },
                    { id: "lyric-video", label: t("videoEditor.railLyricVideo", { defaultValue: "Lyric Video" }), icon: <AudioWaveform className="h-5 w-5" />, testId: "rail-lyric-video" },
                    { id: "thumbnails", label: t("videoEditor.railThumbnails", { defaultValue: "Thumbnails" }), icon: <ImageIcon className="h-5 w-5" />, testId: "rail-thumbnails" },
                    { id: "meme-machine", label: t("videoEditor.railMemeMachine", { defaultValue: "Meme Machine" }), icon: <Laugh className="h-5 w-5" />, testId: "rail-meme-machine" },
                    { id: "three-second-lab", label: t("videoEditor.railThreeSecondLab", { defaultValue: "3-Second Lab" }), icon: <Timer className="h-5 w-5" />, testId: "rail-three-second-lab" },
                    { id: "translate", label: t("videoEditor.railTranslate", { defaultValue: "Translate" }), icon: <Languages className="h-5 w-5" />, testId: "rail-translate" },
                    { id: "repurpose", label: t("videoEditor.railRepurpose", { defaultValue: "Repurpose" }), icon: <Repeat className="h-5 w-5" />, testId: "rail-repurpose" },
                    // ── 5. FINISH ──
                    { id: "edit-recipes", label: t("videoEditor.railEditRecipes"), icon: <Scissors className="h-5 w-5" />, testId: "rail-edit-recipes" },
                    { id: "studio", label: t("videoEditor.railAdvanced"), icon: <Clapperboard className="h-5 w-5" />, testId: "rail-studio" },
                    { id: "pro-tools", label: t("videoEditor.railProTools"), icon: <SlidersHorizontal className="h-5 w-5" />, testId: "rail-pro-tools" },
                    { id: "export", label: t("videoEditor.railExport"), icon: <Download className="h-5 w-5" />, testId: "rail-export" },
                  ])
                    .filter((item) => !isSimple || (["clips", "templates", "music", "lip-sync", "timeline", "export"] as string[]).includes(item.id))
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id as EditorTab)}
                        data-testid={item.testId}
                        data-min-stars={TAB_MIN_STARS[item.id as EditorTab]}
                        title={item.label}
                        className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg w-14 border transition-colors ${
                          tab === item.id ? "bg-primary/15 text-primary border-primary/30" : "text-white/45 hover:text-white hover:bg-white/5 border-transparent"
                        }`}
                      >
                        {item.icon}
                        <span className="text-[9px] font-bold leading-none">{item.label}</span>
                      </button>
                    ))}
              </nav>

              {/* ── LEFT PANEL: active section (draggable divider on its right edge) ── */}
              <aside style={{ width: panelCollapsed ? 0 : panelWidth, display: panelCollapsed ? "none" : undefined }} className="shrink-0 bg-[#0a0a0a] border-r border-white/10 overflow-y-auto hidden md:block">
                <div className="h-12 shrink-0 flex items-center px-4 border-b border-white/10 sticky top-0 bg-[#0a0a0a] z-10">
                  <h2 className="text-xs font-black text-white uppercase tracking-widest">
                    {{
                      clips: t("videoEditor.railMedia"),
                      templates: t("videoEditor.railTemplates"),
                      music: t("videoEditor.railAudio"),
                      timeline: t("videoEditor.railTimeline"),
                      "beat-sync": t("videoEditor.railBeatSync"),
                      "edit-recipes": t("videoEditor.railEditRecipes"),
                      captions: t("videoEditor.railText"),
                      effects: t("videoEditor.railEffects"),
                      motion: t("videoEditor.railMotion", { defaultValue: "Motion" }),
                      branding: t("videoEditor.railBrand"),
                      "lip-sync": t("videoEditor.railLipSync"),
                      "pre-production": t("videoEditor.railPrePro"),
                      export: t("videoEditor.railExport"),
                      studio: t("videoEditor.railAdvanced"),
                      "voice-edits": t("videoEditor.railVoiceEdits"),
                      "pro-tools": t("videoEditor.railProTools"),
                      "promo-clips": t("videoEditor.railPromoClips", { defaultValue: "Promo Clips" }),
                      "lyric-video": t("videoEditor.railLyricVideo", { defaultValue: "Lyric Video" }),
                      translate: t("videoEditor.railTranslate", { defaultValue: "Translate" }),
                      repurpose: t("videoEditor.railRepurpose", { defaultValue: "Repurpose" }),
                      upscale: t("videoEditor.railUpscale", { defaultValue: "Upscale" }),
                      cartoonize: t("videoEditor.railCartoonize", { defaultValue: "Cartoonize" }),
                      thumbnails: t("videoEditor.railThumbnails", { defaultValue: "Thumbnails" }),
                      vibes: t("videoEditor.railVibes", { defaultValue: "Vibes" }),
                      locations: t("videoEditor.railLocations", { defaultValue: "Locations" }),
                      "style-stealer": t("videoEditor.railStyleStealer", { defaultValue: "Style Stealer" }),
                      "meme-machine": t("videoEditor.railMemeMachine", { defaultValue: "Meme Machine" }),
                      "three-second-lab": t("videoEditor.railThreeSecondLab", { defaultValue: "3-Second Lab" }),
                    }[tab]}
                  </h2>
                </div>
                <div className="p-4">
                  {/* TimelinePreviewPlayer — always mounted (it IS the playback engine), visually hidden */}
                  <div className="hidden">
                    <TimelinePreviewPlayer
                      ref={timelinePlayerRef}
                      scenes={resolvedScenes}
                      captionLines={settings.captions.lines}
                      audioUrl={previewAudioUrl}
                      initialSceneId={previewSceneId}
                      captionSettings={settings.captions}
                      onEngineUpdate={setPreviewEngineState}
                      externalVideoRef={liveVideoRef}
                      outgoingVideoRef={outgoingVideoRef}
                      onSceneChange={handleSceneChange}
                      timelineLayout={settings.timelineLayout}
                      clipEdits={settings.clips}
                      songCrop={settings.musicStudio.songCrop}
                      audioOffsetSec={settings.musicStudio.videoAudio.startSec ?? 0}
                    />
                  </div>

                  {tab === "timeline" && (
                    <>
                    <TimelineSection
                      scenes={scenes}
                      settings={settings}
                      setSettings={setSettings}
                      onPreviewTransition={handlePreviewTransition}
                      onGoToClips={() => setTab("clips")}
                      onGoToEffects={() => setTab("effects")}
                      isSimple={isSimple}
                      /* Connected to the master player: same engine state + transport */
                      engineState={previewEngineState}
                      duration={songDuration}
                      onSeek={(sec) => timelinePlayerRef.current?.seekTo(sec)}
                      onTogglePlay={() => timelinePlayerRef.current?.togglePlay()}
                      onRestart={() => timelinePlayerRef.current?.restart()}
                      audioUrl={previewAudioUrl}
                      transcriptText={transcriptText}
                    />
                    {/* Wave 9 sections moved to their own rail tabs (Beat Sync / Edit Recipes) for direct reachability. */}
                    </>
                  )}

                  {tab === "beat-sync" && (
                    <div className="p-4">
                      <BeatSyncSection
                        scenes={scenes}
                        settings={settings}
                        setSettings={setSettings}
                        audioUrl={previewAudioUrl}
                        durationSec={previewEngineState?.audioDuration ?? songDuration ?? null}
                        onSeek={(sec) => timelinePlayerRef.current?.seekTo(sec)}
                        projectKey={projectId || "default"}
                        onMarkersChange={setBeatGrid}
                        onApplyCuts={applyBeatCuts}
                      />
                    </div>
                  )}

                  {tab === "edit-recipes" && (
                    <div className="p-4">
                      <TimelineTemplatesSection
                        scenes={scenes}
                        settings={settings}
                        setSettings={setSettings}
                        audioUrl={previewAudioUrl}
                        durationSec={previewEngineState?.audioDuration ?? songDuration ?? null}
                        beatGrid={beatGrid}
                        projectKey={projectId || "default"}
                      />
                    </div>
                  )}

                  {tab === "clips" && (
                        <div className="space-y-6">
                          {/* Hub project spine — pull finished clips/videos straight into the timeline */}
                          <ProjectFlowBar
                            kinds={["video", "clip"]}
                            actionLabel={t("hubSpine.flowBar.useInEditor")}
                            onPick={addHubAssetAsScene}
                          />
                          {/* Apply consistency banner */}
                          {consistencyPrompt && scenes.length > 0 && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/25 bg-primary/[0.06]">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-primary">{t("videoEditor.consistencyLockActive")}</p>
                                <p className="text-[10px] text-white/40 mt-0.5">
                                  {activeArtist ? t("videoEditor.consistencyLockDesc", { name: activeArtist.artist_name }) : t("videoEditor.consistencyLockDescGeneric")}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={applyConsistencyToAllScenes}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> {t("videoEditor.applyToAllScenes")}
                              </button>
                            </div>
                          )}
                          {/* Generate Scenes From Song — surfaced when there's no saved plan to rebuild
                              from, but the song's audio + lyrics are already available. */}
                          {/* Generate Scenes From Song — pro alternate generation flow (5) */}
                          {scenes.length === 0 && !rawResult && (
                            previewAudioUrl && lyricsForCaptions && lyricsForCaptions.trim().length > 10 ? (
                              <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-min-stars="5">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-white flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-primary shrink-0" /> {t("videoEditor.generateScenesTitle")}
                                  </p>
                                  <p className="text-xs text-white/40 mt-0.5">
                                    {t("videoEditor.generateScenesDesc")}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => { void generateScenesFromSong(); }}
                                  disabled={autoSceneStatus === "generating"}
                                  data-testid="btn-generate-scenes-from-audio"
                                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors bg-primary text-black hover:bg-primary/90 disabled:opacity-50 shrink-0"
                                >
                                  {autoSceneStatus === "generating"
                                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("videoEditor.generatingScenes")}</>
                                    : <><Clapperboard className="h-4 w-4" /> {t("videoEditor.generateScenesButton")}</>}
                                </button>
                                {autoSceneStatus === "error" && autoSceneError && (
                                  <p className="text-xs text-red-400/80 basis-full">{autoSceneError}</p>
                                )}
                              </div>
                            ) : !previewAudioUrl ? (
                              <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-white/60">{t("videoEditor.noSongLoaded")}</p>
                                  <p className="text-[10px] text-white/35 mt-0.5">{t("videoEditor.noSongDesc")}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setTab("music")}
                                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors"
                                >
                                  <Music2 className="h-3.5 w-3.5" /> {t("videoEditor.goToSong")}
                                </button>
                              </div>
                            ) : null
                          )}

                          {/* Rebuild scenes banner — shown when saved plan exists */}
                          {rawResult && (
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
                              <div className="flex-1 min-w-0">
                                {scenes.length === 0 ? (
                                  <>
                                    <p className="text-xs font-bold text-amber-400">{t("videoEditor.noScenesSavedPlan")}</p>
                                    <p className="text-[10px] text-white/40 mt-0.5">{t("videoEditor.rebuildScenesHint")}</p>
                                  </>
                                ) : rebuildStatus === "done" ? (
                                  <>
                                    <p className="text-xs font-bold text-green-400">{t("videoEditor.scenesLoadedFromPlan", { count: scenes.length })}</p>
                                    <p className="text-[10px] text-white/40 mt-0.5">{t("videoEditor.scenesParsedDesc")}</p>
                                  </>
                                ) : rebuildStatus === "error" ? (
                                  <>
                                    <p className="text-xs font-bold text-red-400">{t("videoEditor.parseScenesTitle")}</p>
                                    <p className="text-[10px] text-white/40 mt-0.5">{rebuildError ?? t("videoEditor.noSceneBreakdownError")}</p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-xs font-bold text-white/50">{t("videoEditor.savedPlanAvailable")}</p>
                                    <p className="text-[10px] text-white/35 mt-0.5">{t("videoEditor.reparseDesc")}</p>
                                  </>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => { void rebuildScenesFromPlan(); }}
                                disabled={rebuildStatus === "rebuilding"}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors disabled:opacity-50"
                                data-testid="btn-rebuild-scenes"
                              >
                                {rebuildStatus === "rebuilding" ? (
                                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("videoEditor.rebuilding")}</>
                                ) : (
                                  <><RefreshCw className="h-3.5 w-3.5" /> {t("videoEditor.rebuildScenes")}</>
                                )}
                              </button>
                            </div>
                          )}

                          {/* Sync Missing Clips button */}
                          {projectId && (
                            <div className="flex items-center justify-between gap-3 px-1">
                              <div className="min-w-0">
                                {syncState === "done" && syncMsg && (
                                  <p className="text-[10px] text-green-400 font-medium">{syncMsg}</p>
                                )}
                                {syncState === "error" && syncMsg && (
                                  <p className="text-[10px] text-red-400 font-medium">{syncMsg}</p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => { setSyncState("idle"); void syncMissingClips(); }}
                                disabled={syncState === "syncing"}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors disabled:opacity-50"
                                title={t("videoEditor.syncMissingClipsTitle")}
                              >
                                {syncState === "syncing" ? (
                                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("videoEditor.syncing")}</>
                                ) : (
                                  <><Zap className="h-3.5 w-3.5" /> {t("videoEditor.syncMissingClips")}</>
                                )}
                              </button>
                            </div>
                          )}

                          {/* ── Screen Recorder (CapCut parity): capture straight into the timeline. Free. ── */}
                          <ScreenRecorderPanel
                            scenes={scenes}
                            setScenes={setScenes}
                            projectId={projectId}
                            getAccessToken={getAccessToken}
                            onGoToTab={(t) => setTab(t)}
                          />

                          {/* ── Stock Media Library (CapCut parity): searchable stock video + photos.
                              Browsing is free; importing into the project costs 50 Visual Bucs. ── */}
                          <StockLibraryPanel
                            scenes={scenes}
                            setScenes={setScenes}
                            projectId={projectId}
                            getAccessToken={getAccessToken}
                            confirmedFetch={confirmedFetch}
                            onGoToTab={(t) => setTab(t)}
                          />

                          <ClipGeneratorSection
                            scenes={scenes}
                            setScenes={setScenes}
                            settings={settings}
                            setSettings={setSettings}
                            artistVault={activeArtist}
                            projectId={projectId}
                            onPreview={(id) => setPreviewSceneId(id)}
                            previewSceneId={previewSceneId}
                            getAccessToken={getAccessToken}
                            saveState={saveState}
                            playheadTimeSec={previewEngineState?.currentTime ?? 0}
                            totalDurationSec={songDuration ?? undefined}
                            artistName={artistName}
                            songTitle={songTitle}
                          />
                        </div>
                      )}

                  {tab === "templates" && (
                    <TemplatesTabPanel
                      scenes={scenes}
                      deepLinkedKey={deepLinkedTemplateKey}
                      onDeepLinkConsumed={() => setDeepLinkedTemplateKey(null)}
                      onAddCaptions={handleTemplateVideoForCaptions}
                      onUseInEditor={handleSplitScreenUseInEditor}
                      onMultiRatio={handleSplitScreenMultiRatio}
                    />
                  )}

                  {tab === "music" && (
                    <MusicStudio
                      settings={settings}
                      onChange={setSettings}
                      artistName={artistName}
                      songTitle={songTitle}
                      audioUrl={audioUrl}
                      projectId={projectId}
                      getAccessToken={getAccessToken}
                      onTranscriptReady={handleTranscriptReady}
                      transcriptText={transcriptText}
                      activeArtist={activeArtist}
                      onGoToCaptions={() => setTab("captions")}
                      isSimple={isSimple}
                      requestedExport={requestedAudioExport}
                      onExportRequestHandled={() => setRequestedAudioExport(null)}
                      onDirectExportStatusChange={setDirectAudioExportStatus}
                    />
                  )}

                  {tab === "captions" && (
                    <>
                      {/* ── AI Caption Suite (Wave 5): the single user-facing
                          concept for captions — Generate → Style → Translate.
                          Orchestrates /api/auto-captions, /api/caption-styler,
                          /api/style-subtitles, /api/translate-captions. ── */}
                      <AiCaptionSuite
                        getAccessToken={getAccessToken}
                        timelineVideos={scenes
                          .filter((s) => s.demoClipUrl?.startsWith("http"))
                          .map((s) => ({
                            id: s.id,
                            label: `Scene ${s.sceneNumber}${s.section ? ` — ${s.section}` : ""}`,
                            url: s.demoClipUrl as string,
                          }))}
                        onPushToTimeline={(newLines) => {
                          setSettings((prev) => ({
                            ...prev,
                            captions: {
                              ...prev.captions,
                              lines: [
                                ...prev.captions.lines,
                                ...newLines.map((l, i) => ({
                                  id: `suite-${Date.now()}-${i}`,
                                  startSec: l.startSec,
                                  endSec: l.endSec,
                                  text: l.text,
                                })),
                              ],
                            },
                          }));
                        }}
                      />
                      <CaptionsSection
                      settings={settings}
                      setSettings={setSettings}
                      lyrics={lyricsForCaptions ?? undefined}
                      songDuration={songDuration ?? undefined}
                      audioSourceLoading={!!previewAudioUrl && songDuration == null}
                      selectedCaptionId={selectedCaptionId}
                      onSelectCaption={setSelectedCaptionId}
                      audioUrl={previewAudioUrl}
                      getAccessToken={getAccessToken}
                      visiblePresetIds={template.captionPresets}
                    />
                    </>
                  )}

                  {tab === "effects" && (
                    <EffectsSection
                      scenes={scenes}
                      settings={settings}
                      setSettings={setSettings}
                      audioUrl={audioUrl ?? settings.musicStudio.stems[0]?.url ?? null}
                      onTestEffect={triggerTestEffect}
                      onTestTransition={triggerTestTransition}
                      onTestOverlay={triggerTestOverlay}
                      activeTransitionType={transitionState?.type ?? null}
                      onPreviewTransition={handlePreviewTransition}
                      visibleEffects={template.effects}
                      visibleColorGrades={template.colorGrades}
                      onReplaceClipVideo={(sceneId, url) =>
                        setScenes((prev) =>
                          prev.map((s) => (s.id === sceneId ? { ...s, demoClipUrl: url } : s)),
                        )
                      }
                      onGoToCaptions={() => setTab("captions")}
                      onGoToExport={(videoUrl) => {
                        if (videoUrl) setLutHandoffUrl(videoUrl);
                        setTab("export");
                      }}
                    />
                  )}

                  {tab === "motion" && (
                    <MotionGraphicsSection
                      playheadTimeSec={previewEngineState?.currentTime ?? 0}
                      activeArtist={activeArtist}
                      onAddToTimeline={(item) => {
                        const id = `motion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                        setSettings((prev) => ({
                          ...prev,
                          overlayItems: [...(prev.overlayItems ?? []), { ...item, id }],
                        }));
                        toast({
                          title: t("motionGraphics.addedToast", { defaultValue: "Motion graphic added" }),
                          description: t("motionGraphics.addedToastDesc", { defaultValue: "Placed on the timeline at the playhead." }),
                        });
                      }}
                    />
                  )}

                  {tab === "branding" && (
                    <BrandingSection
                      settings={settings}
                      setSettings={setSettings}
                      artistName={artistName}
                      songTitle={songTitle}
                    />
                  )}

                  {tab === "lip-sync" && (
                    <LipSyncSection
                      scenes={scenes}
                      settings={settings}
                      setSettings={setSettings}
                      audioUrl={audioUrl}
                      masterAudioUrl={previewAudioUrl}
                      audioDuration={previewEngineState?.audioDuration ?? null}
                      projectId={projectId}
                    />
                  )}

                  {tab === "pre-production" && project && (
                    <PreProductionSection
                      settings={settings}
                      setSettings={setSettings}
                      songTitle={project.song_title ?? undefined}
                      genre={project.genre ?? undefined}
                      mood={project.mood ?? undefined}
                    />
                  )}

                  {tab === "export" && (
                    <>
                    <ExportSection
                      // NOTE: resolvedScenes (not raw scenes) so the export uses
                      // lip-synced clip URLs wherever the user enabled lip sync —
                      // what you see in the master player is what gets exported.
                      scenes={resolvedScenes}
                      settings={settings}
                      setSettings={setSettings}
                      projectId={project!.id}
                      audioUrl={audioUrl ?? settings.musicStudio.stems[0]?.url ?? null}
                      rawProjectAudioUrl={audioUrl}
                      masterAudioUrl={previewAudioUrl}
                      onGoToMusicStudio={() => setTab("music")}
                      onRenderMissingMix={requestMissingMixRender}
                      canRenderMissingMix={canDirectRenderMissingMix}
                      directRenderStatus={directAudioExportStatus}
                      onGoToEffects={() => setTab("effects")}
                      masterCurrentTimeSec={previewEngineState?.currentTime ?? 0}
                      projectDurationSec={previewEngineState?.audioDuration ?? 0}
                      isSimple={isSimple}
                      topic={songTitle || undefined}
                      handoffVideoUrl={lutHandoffUrl}
                    />
                    {/* Spotify Canvas Generator — docked in the export/promo
                        chain (DistroKid Canvas parity). Deep-linked via
                        ?tab=export&canvas=1 from song results / cover art. */}
                    <div className="mt-6">
                      <CanvasGeneratorSection
                        audioUrl={audioUrl ?? settings.musicStudio.stems[0]?.url ?? null}
                        songTitle={songTitle || undefined}
                        artistName={artistName || undefined}
                      />
                    </div>
                    </>
                  )}

                  {tab === "studio" && (
                    <>
                    <StudioEditorSection
                      scenes={scenes}
                      settings={settings}
                      setSettings={setSettings}
                      setScenes={setScenes}
                      currentTime={previewEngineState?.currentTime ?? 0}
                      audioDuration={previewEngineState?.audioDuration ?? null}
                      isPlaying={previewEngineState?.isPlaying ?? false}
                      audioUrl={previewAudioUrl}
                      onSeek={(sec) => timelinePlayerRef.current?.seekTo(sec)}
                      onTogglePlay={() => timelinePlayerRef.current?.togglePlay()}
                      onRestart={() => timelinePlayerRef.current?.restart()}
                      onGoToExport={() => setTab("export")}
                      onGoToMusic={() => setTab("music")}
                      selectedIdx={selectedIdx}
                      setSelectedIdx={setSelectedIdx}
                    />
                    {/* Wave 9 Voice-Directed Edits moved to its own rail tab for direct reachability. */}
                    </>
                  )}

                  {tab === "voice-edits" && (
                    <div className="p-4">
                      <VoiceDirectedEditsSection
                        scenes={scenes}
                        settings={settings}
                        setSettings={setSettings}
                        setScenes={setScenes}
                        audioDuration={previewEngineState?.audioDuration ?? null}
                        projectTitle={songTitle || undefined}
                      />
                    </div>
                  )}

                  {tab === "pro-tools" && (
                    <>
                      <ProToolsSection
                        scenes={resolvedScenes}
                        settings={settings}
                        setSettings={setSettings}
                        videoRef={liveVideoRef}
                        onReplaceClipVideo={(sceneId, url) =>
                          setScenes((prev) =>
                            prev.map((s) => (s.id === sceneId ? { ...s, demoClipUrl: url } : s)),
                          )
                        }
                      />
                      <KeyframesSection
                        scenes={resolvedScenes}
                        settings={settings}
                        setSettings={setSettings}
                      />
                      {/* Wave 9 — Background Replace: AI background swap for talking-head clips
                          (honest 503 until a segmentation provider is wired; green-screen clips
                          are pointed at the working Chroma Key tool). */}
                      <div className="mt-6">
                        <BackgroundReplaceSection
                          scene={selectedIdx != null ? resolvedScenes[selectedIdx] ?? null : null}
                          settings={settings}
                          setSettings={setSettings}
                          onReplaceClipVideo={(sceneId, url) =>
                            setScenes((prev) =>
                              prev.map((s) => (s.id === sceneId ? { ...s, demoClipUrl: url } : s)),
                            )
                          }
                        />
                      </div>
                    </>
                  )}
                  {tab === "promo-clips" && (
                    <ToolPanelShell
                      tool="promo-clips"
                      kicker={t("videoEditor.railPromoClips", { defaultValue: "Promo Clips" })}
                      title={t("promo-clip.title")}
                      subtitle={t("promo-clip.subtitle")}
                      price={t("promo-clip.creditBadge")}
                    >
                      <PromoClip embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "lyric-video" && (
                    <ToolPanelShell
                      tool="lyric-video"
                      kicker={t("lyricVideo.badge")}
                      title={<>{t("lyricVideo.titlePrefix")}<span className="text-violet-300">{t("lyricVideo.titleHighlight")}</span></>}
                      subtitle={t("lyricVideo.subtitle", { alignCredits: LYRIC_ALIGN_CREDITS, renderCredits: LYRIC_RENDER_CREDITS })}
                    >
                      <LyricVideo embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "translate" && (
                    <ToolPanelShell
                      tool="translate"
                      kicker={t("translate.badge")}
                      title={t("translate.pageTitle")}
                      subtitle={t("translate.pageSubtitle")}
                    >
                      <Translate embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "repurpose" && (
                    <ToolPanelShell
                      tool="repurpose"
                      kicker={t("repurpose.badge")}
                      title={<>{t("repurpose.titlePrefix")} <span className="text-teal-300">{t("repurpose.titleSuffix")}</span></>}
                      subtitle={t("repurpose.hero")}
                    >
                      <Repurpose embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "upscale" && (
                    <ToolPanelShell
                      tool="upscale"
                      kicker={t("videoEditor.railUpscale", { defaultValue: "Upscale" })}
                      title={t("upscale.pageTitle")}
                      subtitle={t("upscale.pageSub")}
                    >
                      <Upscale embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "cartoonize" && (
                    <ToolPanelShell
                      tool="cartoonize"
                      kicker={t("videoEditor.railCartoonize", { defaultValue: "Cartoonize" })}
                      title={t("cartoonStudio.title")}
                      subtitle={t("cartoonStudio.subtitle")}
                      price={t("cartoonStudio.costBadge")}
                    >
                      <CartoonStudio initialTab="cartoonize" embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "thumbnails" && (
                    <ToolPanelShell
                      tool="thumbnails"
                      kicker={t("videoEditor.railThumbnails", { defaultValue: "Thumbnails" })}
                      title={t("thumbnailStudio.title", { defaultValue: "Thumbnail Studio" })}
                      subtitle={t("thumbnailStudio.subtitle", {
                        defaultValue: "Generate scroll-stopping thumbnails, A/B test them with AI, and browse your library — all in one studio.",
                      })}
                      price={t("thumbnailMaker.costBadge")}
                    >
                      <ThumbnailStudio defaultTab="generate" embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "vibes" && (
                    <ToolPanelShell
                      tool="vibes"
                      kicker={t("videoEditor.railVibes", { defaultValue: "Vibes" })}
                      title={t("videoEditor.vibesTitle", { defaultValue: "Vibes" })}
                      subtitle={t("videoEditor.vibesDesc", {
                        defaultValue: "One-tap mood presets. Each vibe styles your overlays, effects, color grade, and captions instantly — free, no credits.",
                      })}
                    >
                      <VisualVibesSection settings={settings} setSettings={setSettings} bare />
                    </ToolPanelShell>
                  )}
                  {tab === "locations" && (
                    <ToolPanelShell
                      tool="locations"
                      kicker={t("videoEditor.railLocations", { defaultValue: "Locations" })}
                      title={t("locations.pageTitle")}
                      subtitle={t("locations.subtitle")}
                    >
                      <LocationsPage embedded />
                    </ToolPanelShell>
                  )}
                  {tab === "style-stealer" && (
                    <ToolPanelShell
                      tool="style-stealer"
                      kicker={t("videoEditor.railStyleStealer", { defaultValue: "Style Stealer" })}
                      title={t("videoEditor.styleStealerTitle", { defaultValue: "Style Stealer" })}
                      subtitle={t("videoEditor.styleStealerDesc", {
                        defaultValue: "Paste a viral video link and describe what you saw. AI reverse-engineers its formula — hook, pacing, cuts — into an edit recipe for your timeline.",
                      })}
                    >
                      <StyleStealerSection settings={settings} setSettings={setSettings} bare />
                    </ToolPanelShell>
                  )}
                  {tab === "meme-machine" && (
                    <ToolPanelShell
                      tool="meme-machine"
                      kicker={t("videoEditor.railMemeMachine", { defaultValue: "Meme Machine" })}
                      title={t("videoEditor.memeMachineTitle", { defaultValue: "Meme Machine" })}
                      subtitle={t("videoEditor.memeMachineDesc", {
                        defaultValue: "Describe the moment, pick a meme format — AI writes the punchlines. Apply drops the winner onto your timeline as styled captions.",
                      })}
                    >
                      <MemeMachineSection settings={settings} setSettings={setSettings} bare />
                    </ToolPanelShell>
                  )}
                  {tab === "three-second-lab" && (
                    <ToolPanelShell
                      tool="three-second-lab"
                      kicker={t("videoEditor.railThreeSecondLab", { defaultValue: "3-Second Lab" })}
                      title={t("videoEditor.labTitle", { defaultValue: "3-Second Lab" })}
                      subtitle={t("videoEditor.labDesc", {
                        defaultValue: "Win the first 3 seconds. AI writes 5 alternate openings for your video and scores each for scroll-stopping power.",
                      })}
                    >
                      <ThreeSecondLabSection openingHint={threeSecondLabHint} bare />
                    </ToolPanelShell>
                  )}
                </div>
              </aside>

              {/* ── DRAGGABLE DIVIDER: resize the tool panel (double-click resets) ── */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize tool panel"
                title="Drag to resize the panel · double-click to reset"
                onPointerDown={onPanelDividerDown}
                onDoubleClick={resetPanelWidth}
                className="w-[9px] -ml-[9px] shrink-0 cursor-ew-resize touch-none z-10 hidden md:flex items-center justify-center group"
                data-testid="panel-divider"
              >
                <div className="w-[3px] h-24 rounded-full bg-white/10 group-hover:bg-primary/80 group-active:bg-primary transition-colors" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPanelCollapsed(true); }}
                  className="absolute top-2 -left-1 h-6 w-6 rounded-full bg-black/80 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:border-primary/50 transition-colors"
                  title="Collapse panel"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
              </div>
              {/* Expand button when panel is collapsed */}
              {panelCollapsed && (
                <button
                  type="button"
                  onClick={() => setPanelCollapsed(false)}
                  className="shrink-0 w-8 hidden md:flex items-center justify-center bg-[#0a0a0a] border-r border-white/10 text-white/60 hover:text-white hover:bg-white/[0.03] transition-colors"
                  title="Expand panel"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}

              {/* ── CENTER: preview ── */}
              <main
                className="flex-1 min-w-0 bg-black flex flex-col min-h-0 overflow-y-auto relative"
                onDragOver={(e) => { e.preventDefault(); setPreviewDropActive(true); }}
                onDragLeave={() => setPreviewDropActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setPreviewDropActive(false);
                  const captionPreset = e.dataTransfer.getData("application/x-bdv-caption-preset");
                  const effect = e.dataTransfer.getData("application/x-bdv-effect");
                  if (captionPreset) {
                    setSettings((prev: EditorSettings) => ({
                      ...prev,
                      captions: { ...prev.captions, stylePreset: captionPreset as typeof prev.captions.stylePreset },
                    }));
                    setTab("captions");
                  } else if (effect) {
                    setSettings((prev: EditorSettings) => ({
                      ...prev,
                      effects: prev.effects.includes(effect) ? prev.effects : [...prev.effects, effect],
                    }));
                  }
                }}
              >
                {previewDropActive && (
                  <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#C9A84C]/10 border-2 border-dashed border-[#C9A84C]/60 rounded-xl m-2">
                    <p className="text-[#C9A84C] font-black text-sm bg-black/70 px-4 py-2 rounded-full">{t("videoEditor.dropToApply")}</p>
                  </div>
                )}
                {/* ── MASTER PLAYER — docked: fills the center column edge-to-edge,
                    connected to the timeline below. No floating, no centering. ── */}
                <div className="shrink-0 z-20 bg-black flex justify-center">
                  <div className="w-full flex justify-center">
                    {/* ── MASTER PREVIEW PLAYER — one player, above all tabs ── */}
                    <MasterPreviewPlayer
                      eng={previewEngineState}
                      scenes={resolvedScenes}
                      liveVideoRef={liveVideoRef}
                      previewScene={previewScene}
                      tab={tab}
                      captionSettings={settings.captions}
                      settings={settings}
                      setSettings={setSettings}
                      testEffectActive={testEffectActive}
                      outgoingVideoRef={outgoingVideoRef}
                      transitionState={transitionState}
                      testOverlayActive={testOverlayActive}
                      activeOverlayChips={settings.overlays}
                      overlayIntensity={settings.overlayIntensity}
                      watermarkText={settings.watermarkText ?? "Bow Down Visuals"}
                      waveformPosition={settings.waveformPosition ?? "bottom-safe"}
                      onTogglePlay={() => timelinePlayerRef.current?.togglePlay()}
                      onRestart={() => timelinePlayerRef.current?.restart()}
                      onSeek={(sec) => timelinePlayerRef.current?.seekTo(sec)}
                      onSetVolume={(vol) => timelinePlayerRef.current?.setVolume(vol)}
                      onSetMuted={(m) => timelinePlayerRef.current?.setMuted(m)}
                      onSetPlaybackRate={(r) => timelinePlayerRef.current?.setPlaybackRate(r)}
                      dockHeight={dockHeight}

                      headerHeight={headerHeight}
                    />

                  </div>
                </div>
                <div className="shrink-0 px-4 md:px-6 pb-4 space-y-3 w-full max-w-6xl mx-auto">
                  {/* Active Artist pill */}
                  {activeArtist && (() => {
                    const initials = activeArtist.artist_name.split(" ").slice(0,2).map(w => w[0]?.toUpperCase() ?? "").join("");
                    return (
                      <div style={{
                        borderRadius: 12,
                        border: "1px solid rgba(201,168,76,0.3)",
                        background: "linear-gradient(90deg, rgba(201,168,76,0.07) 0%, rgba(0,0,0,0) 70%)",
                        padding: "7px 12px",
                        display: "flex", alignItems: "center", gap: 9,
                        position: "relative", overflow: "hidden",
                        marginBottom: 16,
                      }}>
                        <div style={{
                          position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
                          background: "#C9A84C", borderRadius: "2px 0 0 2px",
                        }} />
                        <div style={{
                          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                          background: "rgba(201,168,76,0.18)",
                          border: "1.5px solid rgba(201,168,76,0.4)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 900, color: "#C9A84C",
                          fontFamily: "Georgia, serif",
                          boxShadow: "0 0 14px rgba(201,168,76,0.25)",
                          overflow: "hidden",
                        }}>
                          {activeArtist.reference_image_url ? (
                            <img src={activeArtist.reference_image_url} alt={activeArtist.artist_name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }} />
                          ) : initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {activeArtist.artist_name}
                          </p>
                          {(activeArtist.artist_type || activeArtist.genre) && (
                            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                              {[activeArtist.artist_type, activeArtist.genre].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                        {consistencyPrompt && (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 800, color: "rgba(201,168,76,0.7)", flexShrink: 0 }}>
                            {t("videoEditor.lockedBadge")}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* ── Audio fallback warning now lives as a compact pill in the
                      TimelineDock transport row (audioWarningPill prop) — not a
                      full-width banner here. ── */}
                  {/* ── Collapsible Debug Panel — only with ?debug=1 and at 6 stars (debug/experimental).
                      The editor should feel like a finished product, not a sandbox. ── */}
                  {typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1" && (
                  <div className="rounded-xl border border-white/[0.06] overflow-hidden" data-min-stars="6">
                    <button
                      type="button"
                      onClick={() => setDebugOpen((o) => !o)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <Bug className="h-3 w-3 text-white/20" />
                      <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest flex-1">{t("videoEditor.debugPanel")}</span>
                      {debugOpen ? <ChevronUp className="h-3 w-3 text-white/20" /> : <ChevronDown className="h-3 w-3 text-white/20" />}
                    </button>
                    {debugOpen && (
                      <div className="px-3 pb-3 border-t border-white/[0.05] pt-2 space-y-0.5">
                        {([
                          ["scenes",         `${scenes.length} total · ${scenes.filter(s => sceneHasClip(s)).length} with clip`],
                          ["audio url",      previewAudioUrl ? "loaded OK" : "none"],
                          ["audio duration", songDuration != null ? `${songDuration.toFixed(1)}s` : "unknown"],
                          ["format",         settings.export.format ?? "9:16"],
                          ["fit mode",       settings.export.fitMode ?? "fill"],
                          ["effects",        settings.effects.length > 0 ? settings.effects.join(", ") : "none"],
                          ["overlays",       settings.overlays.length > 0 ? `${settings.overlays.length} active` : "none"],
                          ["caption lines",  `${settings.captions.lines.length}`],
                          ["playhead",          `${(previewEngineState?.currentTime ?? 0).toFixed(2)}s`],
                          ["duration",          songDuration != null ? `${songDuration.toFixed(1)}s` : "unknown"],
                          ["active scene",      previewEngineState?.activeSceneIndex != null ? `Scene ${previewEngineState.activeSceneIndex + 1}` : "—"],
                          ["active caption",    previewEngineState?.activeCaption?.text?.slice(0, 30) ?? "—"],
                          ["playing",           previewEngineState?.isPlaying ? "yes OK" : "no"],
                          ["transport synced",  "yes OK"],
                          ["save state",        saveState],
                          ["master player",     "connected OK"],
                          ["timeline",          "connected OK"],
                          ["export order",      "timeline order OK"],
                          ["lip sync enabled",  settings.lipSync.enabled ? "yes" : "no"],
                          ["lip sync selected", settings.lipSync.selectedSceneId ? `scene ${scenes.findIndex(s => s.id === settings.lipSync.selectedSceneId) + 1}` : "none"],
                          ["lip sync audio",    settings.lipSync.audioSource],
                          ["lip sync provider", (import.meta.env.VITE_LIP_SYNC_ENABLED as string | undefined) ? "connected OK" : "not connected"],
                          ["lip sync done",     `${scenes.filter(s => getClipEdit(settings, s.id).lipSyncStatus === "done").length} / ${scenes.length}`],
                          ["lip sync result",   (() => { const ce = settings.lipSync.selectedSceneId ? getClipEdit(settings, settings.lipSync.selectedSceneId) : null; return ce?.lipSyncUrl ? "saved OK" : "none"; })()],
                          ["lip sync error",    (() => { const ce = settings.lipSync.selectedSceneId ? getClipEdit(settings, settings.lipSync.selectedSceneId) : null; return ce?.lipSyncError?.slice(0, 40) ?? "—"; })()],
                        ] as [string, string][]).map(([label, value]) => (
                          <div key={label} className="flex items-center justify-between gap-2">
                            <span className="text-[9px] font-mono text-white/25">{label}</span>
                            <span className={`text-[9px] font-bold shrink-0 ${
                              value.includes("OK") ? "text-green-400/70"
                                : value === "none" || value === "no" || value === "unknown" ? "text-white/25"
                                : "text-[#C9A84C]/70"
                            }`}>{value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </main>

              {/* ── CONTEXTUAL INSPECTOR: floating overlay, slides in only when a scene
                  is selected. No permanent sidebar, no toggle button — the player
                  keeps the space. ── */}
              {selectedIdx != null && scenes[selectedIdx] && (
              <div
                className="absolute top-0 right-0 bottom-0 z-30 w-[300px] max-w-[85vw] bg-[#0a0a0a]/95 backdrop-blur-md border-l border-primary/20 shadow-[-16px_0_48px_rgba(0,0,0,0.6)] flex flex-col animate-[slideInRight_0.25s_ease-out]"
                role="complementary"
                aria-label={t("videoEditor.inspector")}
              >
                <div className="h-12 shrink-0 flex items-center px-4 border-b border-white/10">
                  <h2 className="text-xs font-black text-white uppercase tracking-widest flex-1">{t("videoEditor.inspector")}</h2>
                  <button type="button" onClick={() => setSelectedIdx(null)}
                    className="flex items-center justify-center h-7 w-7 rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
                    title={t("videoEditor.hideInspector")} aria-label={t("videoEditor.hideInspector")}>
                    <PanelRightClose className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto flex-1">
                  {(() => {
                      const scene = scenes[selectedIdx];
                      const hasClip = sceneHasClip(scene);
                      return (
                        <div className="space-y-3">
                          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">{t("videoEditor.sceneOfScenes", { current: selectedIdx + 1, total: scenes.length })}</p>
                            <p className="text-xs text-white/70 mt-1.5 leading-relaxed line-clamp-6">{scene.aiVideoPrompt || t("videoEditor.noPrompt")}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">{t("videoEditor.clipLabel")}</p>
                              <p className={`text-xs font-bold mt-1 ${hasClip ? "text-green-400" : "text-white/40"}`}>{hasClip ? t("videoEditor.clipAttached") : t("videoEditor.clipNoClip")}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">{t("videoEditor.approvedLabel")}</p>
                              <p className={`text-xs font-bold mt-1 ${scene.approved ? "text-primary" : "text-white/40"}`}>{scene.approved ? t("videoEditor.yes") : t("videoEditor.no")}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setScenes(scenes.map((s, i) => (i === selectedIdx ? { ...s, approved: !s.approved } : s)))}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors"
                          >
                            {scene.approved ? <><CheckCircle2 className="h-3.5 w-3.5" /> {t("videoEditor.unapproveScene")}</> : <><Circle className="h-3.5 w-3.5" /> {t("videoEditor.approveScene")}</>}
                          </button>
                          <button
                            type="button"
                            onClick={() => setTab("clips")}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                          >
                            <Film className="h-3.5 w-3.5" /> {t("videoEditor.goToClips")}
                          </button>
                        </div>
                      );
                    })()}
                </div>
              </div>
              )}
            </div>
          </>
        )}
      </div>

      {project && (
        <div className={`relative ${settings.masterPlayerTheater ? "z-[60]" : ""}`}>
        <TimelineDock
          audioWarningPill={selectedMixMissing ? (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 shrink-0"
              data-testid="video-audio-fallback-warning"
              title={t("videoEditor.previewingWithFallback", {
                fallback: previewAudioResolution.fallbackSource === "project-audio"
                  ? t("videoEditor.fallbackUploadedSong")
                  : previewAudioResolution.fallbackSource === "first-stem"
                  ? t("videoEditor.fallbackFirstStem")
                  : t("videoEditor.fallbackNoAudio"),
                label: VIDEO_AUDIO_SOURCE_LABELS[settings.musicStudio.videoAudio.source],
              })}
            >
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
              <span className="text-[10px] font-bold text-amber-200/80 whitespace-nowrap hidden sm:inline">
                {t("videoEditor.audioFallbackPill")}
              </span>
              <button
                type="button"
                onClick={requestMissingMixRender}
                disabled={directAudioExportStatus.status === "rendering"}
                data-testid="btn-render-missing-video-audio"
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 underline hover:text-amber-200 transition-colors disabled:opacity-60 disabled:no-underline"
              >
                {directAudioExportStatus.status === "rendering" ? (
                  <><Loader2 className="h-3 w-3 animate-spin no-underline" /> {t("videoEditor.rendering")}</>
                ) : canDirectRenderMissingMix ? (
                  t("videoEditor.renderMix")
                ) : (
                  t("videoEditor.openMusicStudio")
                )}
              </button>
            </div>
          ) : undefined}
          scenes={scenes}
          setScenes={setScenes}
          settings={settings}
          setSettings={setSettings}
          currentTime={previewEngineState?.currentTime ?? 0}
          audioDuration={previewEngineState?.audioDuration ?? null}
          isPlaying={previewEngineState?.isPlaying ?? false}
          audioUrl={previewAudioUrl}
          onSeek={(sec) => timelinePlayerRef.current?.seekTo(sec)}
          onTogglePlay={() => timelinePlayerRef.current?.togglePlay()}
          onRestart={() => timelinePlayerRef.current?.restart()}
          selectedIdx={selectedIdx}
          setSelectedIdx={setSelectedIdx}
          onHeightChange={setDockHeight}
          onReplaceClipVideo={(sceneId, url) =>
            setScenes((prev) =>
              prev.map((s) => (s.id === sceneId ? { ...s, demoClipUrl: url } : s)),
            )
          }
        />
        </div>
      )}
    </div>
    {showTemplatePicker && (
      <TemplatePicker
        activeId={templateId}
        onSelect={applyTemplate}
        onClose={() => setShowTemplatePicker(false)}
      />
    )}
    </>
  );
}

/* ─────────────────────── MASTER PREVIEW PLAYER ─────────────────────── */
/* MasterVideoElement lives at module level so React never remounts the
   <video> element when the user switches tabs. The ref is wired up by
   the liveVideoRef useEffect in VideoEditor. */

function fmtSecs(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Always in the DOM — callback ref sets muted so clips play silently
 *  (audio comes from TimelinePreviewPlayer's <audio> element). */
function MasterVideoElement({
  videoRef,
  fitMode = "fill",
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  fitMode?: FitMode;
}) {
  const setEl = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const objFit = fitMode === "fill" ? "object-cover" : "object-contain";
  return (
    <video
      ref={setEl}
      playsInline
      className={`w-full h-full ${objFit}`}
      data-testid="master-preview-video"
    />
  );
}

/* ── Caption overlay style builder ── */
import type { CaptionSettings } from "@/lib/editor-settings";
import { usePageTitle } from "@/hooks/use-page-title";

function buildCaptionOverlayStyle(cs: CaptionSettings): {
  containerStyle: React.CSSProperties;
  wrapperStyle: React.CSSProperties;
  textStyle: React.CSSProperties;
  animClass: string;
  maxWidth: string;
} {
  // cqw = container-query width — scales relative to the video canvas, not the browser window
  const fsMap: Record<string, string> = {
    Small:  "clamp(10px, 2.5cqw, 18px)",
    Medium: "clamp(13px, 3.5cqw, 24px)",
    Large:  "clamp(16px, 5cqw, 32px)",
    XL:     "clamp(20px, 7cqw, 42px)",
  };
  const fontSize = fsMap[cs.fontSize] ?? fsMap["Medium"]!;
  const maxWidth = cs.maxWidth ?? "80%";

  // %-based insets so captions respect safe margins on every aspect ratio
  const sidePad: React.CSSProperties = { paddingLeft: "5%", paddingRight: "5%" };
  const containerStyle: React.CSSProperties =
    cs.position === "Top"
      ? { ...sidePad, top: "7%", bottom: "auto" }
    : cs.position === "Center"
      ? { ...sidePad, top: "50%", bottom: "auto", transform: "translateY(-50%)" }
    : cs.position === "Lower Third"
      ? { ...sidePad, bottom: "22%", top: "auto" }
    : /* Bottom */ { ...sidePad, bottom: "7%", top: "auto" };

  const animClass =
    cs.animation === "fade"       ? "bdv-caption-fade"
    : cs.animation === "pop"      ? "bdv-caption-pop"
    : cs.animation === "bounce"   ? "bdv-caption-bounce"
    : cs.animation === "slide-up" ? "bdv-caption-slide-up"
    : cs.animation === "typewriter" ? "bdv-caption-typewriter"
    : cs.animation === "word-pop" ? "bdv-caption-word-pop"
    : "";

  const presets: Record<string, { wrapperStyle: React.CSSProperties; textStyle: React.CSSProperties }> = {
    "clean-white": {
      wrapperStyle: {},
      textStyle: { color: "#fff", fontWeight: 800,
        textShadow: "0 0 6px #000, 1px 1px 0 #000, -1px -1px 0 #000" },
    },
    "gold-hiphop": {
      wrapperStyle: {},
      textStyle: { color: "#FFD700", fontWeight: 900,
        textShadow: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 4px 12px rgba(0,0,0,.8)" },
    },
    "karaoke": {
      wrapperStyle: { background: "rgba(0,0,0,0.6)", borderRadius: "0.35rem",
        padding: "0.1rem 0.8rem", borderBottom: "2px solid #FFD700" },
      textStyle: { color: "#fff", fontWeight: 800, textShadow: "0 0 6px #000" },
    },
    "boxed": {
      wrapperStyle: { background: "rgba(0,0,0,0.72)", borderRadius: "0.5rem", padding: "0.3rem 1rem" },
      textStyle: { color: "#fff", fontWeight: 700 },
    },
    "viral-shorts": {
      wrapperStyle: {},
      textStyle: { color: "#fff", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em",
        textShadow: "3px 3px 0 #000,-3px -3px 0 #000,3px -3px 0 #000,-3px 3px 0 #000" },
    },
    "minimal": {
      wrapperStyle: {},
      textStyle: { color: "#fff", fontWeight: 500, textShadow: "0 2px 8px rgba(0,0,0,.6)" },
    },
    /* Legacy presets (export renderer parity). */
    "drill": {
      wrapperStyle: {},
      textStyle: { color: "#fff", fontWeight: 900, textTransform: "uppercase",
        textShadow: "2px 2px 0 #c00,-2px -2px 0 #c00,2px -2px 0 #c00,-2px 2px 0 #c00" },
    },
    "luxury": {
      wrapperStyle: {},
      textStyle: { color: "#FFD700", fontWeight: 600, fontFamily: "\"Cinzel\", Georgia, serif",
        textShadow: "0 2px 10px rgba(0,0,0,.85)" },
    },
    "rnb": {
      wrapperStyle: {},
      textStyle: { color: "#FFF6EA", fontWeight: 600, textShadow: "0 0 12px rgba(255,200,150,.45), 0 2px 6px rgba(0,0,0,.7)" },
    },
    "kids": {
      wrapperStyle: {},
      textStyle: { color: "#FFE14D", fontWeight: 900,
        textShadow: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000" },
    },
    /* New generation. */
    "neon-glow": {
      wrapperStyle: {},
      textStyle: { color: "#A5F3FC", fontWeight: 800,
        textShadow: "0 0 8px rgba(34,211,238,.9), 0 0 24px rgba(34,211,238,.5), 1px 1px 0 #000" },
    },
    "pill-pop": {
      wrapperStyle: { background: "linear-gradient(180deg,#FFD700,#E0A800)", borderRadius: "999px",
        padding: "0.15rem 1.1rem", boxShadow: "0 4px 18px rgba(0,0,0,.55)" },
      textStyle: { color: "#111", fontWeight: 900 },
    },
    "brutalist": {
      wrapperStyle: { background: "#000", padding: "0.2rem 0.9rem" },
      textStyle: { color: "#fff", fontWeight: 800, letterSpacing: "0.04em" },
    },
    "karaoke-word": {
      wrapperStyle: {},
      textStyle: { color: "#fff", fontWeight: 900,
        textShadow: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000" },
    },
  };

  const ps = presets[cs.stylePreset] ?? presets["clean-white"]!;
  const textStyle: React.CSSProperties = { fontSize, ...ps.textStyle };
  // An explicit font pick always wins; otherwise the preset keeps its own face
  // (e.g. luxury's Cinzel serif).
  const picked = captionFontFamily(cs.fontFamily);
  if (picked) textStyle.fontFamily = picked;
  return { containerStyle, wrapperStyle: ps.wrapperStyle, textStyle, animClass, maxWidth };
}

/** Icon shown on the Aspect Ratio cycle button for each format. */
const FORMAT_ICONS_MAP: Record<VideoFormat, React.ReactNode> = {
  "9:16":  <Smartphone className="h-3.5 w-3.5" />,
  "16:9":  <Monitor   className="h-3.5 w-3.5" />,
  "1:1":   <Square    className="h-3.5 w-3.5" />,
  "4:5":   <InstagramIcon className="h-3.5 w-3.5" />,
};

/** Ordered list for Aspect Ratio cycling. */
const CYCLE_FORMATS: VideoFormat[] = ["9:16", "16:9", "1:1", "4:5"];

/** Ordered list for Fit Mode cycling. */
const CYCLE_FIT_MODES: FitMode[] = ["fill", "fit", "blur"];

/** Fixed width of the minimized player chip. (Fit margin lives in lib/master-player-size.ts.) */
const MINIMIZED_CHIP_WIDTH = 96;

/** Docked-player aspect ratio from the project's export format. */
function floatPlayerAspect(fmt: VideoFormat): number {
  switch (fmt) {
    case "16:9": return 16 / 9;
    case "1:1": return 1;
    case "4:5": return 4 / 5;
    case "9:16":
    default: return 9 / 16;
  }
}

/** Short badge label shown on the Fit Mode button. */
/** Badge text key for each Fit Mode (render with t()). */
const FIT_BADGE: Record<FitMode, string> = {
  fill: "videoEditor.fitBadgeFill",
  fit:  "videoEditor.fitBadgeFit",
  blur: "videoEditor.fitBadgeBlur",
};

/** Toast-friendly label key for each Fit Mode (render with t()). */
const FIT_TOAST: Record<FitMode, string> = {
  fill: "videoEditor.fitToastFill",
  fit:  "videoEditor.fitToastFit",
  blur: "videoEditor.fitToastBlur",
};

/** Available playback speeds. */
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.25, 1.5, 2] as const;

/** Compute scene start offsets — mirrors TLP exactly: even distribution over audioDuration. */
function buildSceneOffsets(scenes: unknown[], totalDuration: number): number[] {
  if (!scenes.length || totalDuration <= 0) return scenes.map(() => 0);
  const d = totalDuration / scenes.length;
  return scenes.map((_, i) => i * d);
}

function MasterPreviewPlayer({
  eng, scenes, liveVideoRef, previewScene, tab, captionSettings,
  settings, setSettings, testEffectActive,
  outgoingVideoRef, transitionState, testOverlayActive, activeOverlayChips, overlayIntensity,
  watermarkText, waveformPosition,
  onTogglePlay, onRestart,
  onSeek, onSetVolume, onSetMuted, onSetPlaybackRate,
  dockHeight,
  headerHeight,
}: {
  eng: SharedPreviewState | null;
  scenes: SceneData[];
  liveVideoRef: RefObject<HTMLVideoElement | null>;
  previewScene: SceneData | null;
  tab: EditorTab;
  captionSettings: CaptionSettings;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  testEffectActive: boolean;
  outgoingVideoRef: RefObject<HTMLVideoElement | null>;
  transitionState: TransitionState | null;
  testOverlayActive: boolean;
  activeOverlayChips: string[];
  overlayIntensity: Record<string, number>;
  watermarkText: string;
  waveformPosition: string;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSeek: (sec: number) => void;
  onSetVolume: (vol: number) => void;
  onSetMuted: (muted: boolean) => void;
  onSetPlaybackRate: (rate: number) => void;
  dockHeight: number;
  headerHeight: number;
}) {
  const { t } = useTranslation();
  const containerRef  = useRef<HTMLDivElement | null>(null);
  const chromeHeaderRef = useRef<HTMLDivElement | null>(null);
  const chromeFooterRef = useRef<HTMLDivElement | null>(null);
  const [chromeHeight, setChromeHeight] = useState(0);
  /* ── Measure the center-column content width the player sits in (the
   *    `w-full max-w-6xl` wrapper above the player). The fit math clamps the
   *    video width to this so the wrapper's `max-width: 100%` never engages —
   *    without it, narrow layouts silently clamp the width while the canvas
   *    keeps its fixed height, distorting the aspect box and letterboxing the
   *    video tiny inside it. Observing the PARENT (not the player itself)
   *    avoids a measurement feedback loop. ── */
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [columnWidth, setColumnWidth] = useState(0);
  useEffect(() => {
    const parent = outerRef.current?.parentElement;
    if (!parent) return;
    const update = () => setColumnWidth(parent.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const [isFullscreen,       setIsFullscreen      ] = useState(false);
  const [pipActive,          setPipActive         ] = useState(false);
  const [pipError,           setPipError          ] = useState<string | null>(null);
  const blurVideoRef = useRef<HTMLVideoElement | null>(null);
  /* Ambient glow layer — a blurred, dimmed mirror of the playing video rendered
   * behind the whole player frame (always on, not just fitMode=blur). */
  const ambientVideoRef = useRef<HTMLVideoElement | null>(null);

  /* ── Master player: LOCKED IN — docked inline in the center column, never a
   *    floating overlay. Fullscreen replaces the docked player entirely;
   *    minimize/hide are independent presentation states on top of it. ── */
  const isMinimized = !!settings.masterPlayerMinimized && !isFullscreen;
  const isHidden = !!settings.masterPlayerHidden && !isFullscreen;
  const aspect = floatPlayerAspect((settings.export.format ?? "9:16") as VideoFormat);

  const [isResizingFloat, setIsResizingFloat] = useState(false);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const resizeStartRef = useRef({ startX: 0, startWidth: 0 });

  /* ── Recompute the docked player's size whenever the browser window itself is
   *    resized, so the height clamp against the available viewport band stays fresh
   *    (e.g. rotating a device or resizing the browser). ── */
  const [, forceViewportRecalc] = useState(0);
  useEffect(() => {
    const onResize = () => forceViewportRecalc((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const savedWidth = Math.min(MASTER_PLAYER_MAX_WIDTH, Math.max(MASTER_PLAYER_MIN_WIDTH, settings.masterPlayerSize || MASTER_PLAYER_DEFAULT_WIDTH));
  const rawFloatWidth = isMinimized ? MINIMIZED_CHIP_WIDTH : (resizeWidth ?? savedWidth);
  /* ── Master player fit — every aspect ratio, every viewport.
   *    computeMasterPlayerFit (src/lib/master-player-size.ts, unit-tested) guarantees:
   *      · video height + chrome (drag header + transport rows, measured live)
   *        never exceeds the band between the top toolbar and the timeline dock,
   *        so transport controls are ALWAYS fully visible — never cut off;
   *      · video width never exceeds the measured center-column width, so the
   *        canvas aspect-ratio box stays exact (no silent max-width clamp
   *        distorting the box and letterboxing the video tiny inside it);
   *      · landscape formats still grow to a readable height when space allows.
   *    The old inline math floored the width at MASTER_PLAYER_MIN_WIDTH even when
   *    the band couldn't fit that height (short viewport + 9:16), pushing the
   *    transport rows below the fold. Fit now always wins over the minimum. */
  const { width: floatWidth, height: floatHeight } = computeMasterPlayerFit({
    viewportHeight: typeof window !== "undefined" ? window.innerHeight : 1080,
    headerHeight,
    dockHeight,
    chromeHeight,
    columnWidth,
    aspect,
    savedWidth: rawFloatWidth,
    minimized: isMinimized,
  });

  const toggleMinimize = () => {
    setSettings({ ...settings, masterPlayerMinimized: !settings.masterPlayerMinimized });
  };
  const toggleHidden = () => {
    setSettings({ ...settings, masterPlayerHidden: !settings.masterPlayerHidden });
  };
  const toggleTheater = () => {
    setSettings({ ...settings, masterPlayerTheater: !settings.masterPlayerTheater });
  };
  /* Theater mode dims the editor around the player (spotlight). Suppressed in
   * fullscreen, where the whole screen is already the stage. */
  const theaterOn = !!settings.masterPlayerTheater && !isFullscreen;

  /* ── Resize: drag the bottom-right handle to grow/shrink the docked player,
   *    the aspect ratio is always locked to the project's export format. ── */
  const handleResizeStart = (e: React.PointerEvent) => {
    if (isFullscreen || isMinimized || isHidden) return;
    e.stopPropagation();
    resizeStartRef.current = { startX: e.clientX, startWidth: savedWidth };
    setResizeWidth(savedWidth);
    setIsResizingFloat(true);
  };

  useEffect(() => {
    if (!isResizingFloat) return;
    const onMove = (e: PointerEvent) => {
      const delta = e.clientX - resizeStartRef.current.startX;
      const next = Math.min(MASTER_PLAYER_MAX_WIDTH, Math.max(MASTER_PLAYER_MIN_WIDTH, resizeStartRef.current.startWidth + delta));
      setResizeWidth(next);
    };
    const onUp = () => {
      setIsResizingFloat(false);
      setResizeWidth((w) => {
        if (w != null) setSettings({ ...settings, masterPlayerSize: w });
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isResizingFloat, settings, setSettings]);

  /* Locked in: the player lives in the normal page flow inside the center column —
   * no fixed positioning, no floating over the top bar or rail. When hidden we keep
   * the (empty) container mounted with display:none so the video element persists. */
  const floatStyle: React.CSSProperties | undefined = isFullscreen
    ? undefined
    : isHidden
      ? { display: "none" }
      : {
          width: "100%",
          maxWidth: "100%",
        };

  /* ── Controls auto-hide (fullscreen only) ── */
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFullscreenRef  = useRef(false);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);

  const showControls = () => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isFullscreenRef.current) {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  };

  /* Reset / start hide-timer on fullscreen toggle */
  useEffect(() => {
    if (!isFullscreen) {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      setControlsVisible(true);
    } else {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
    return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
  }, [isFullscreen]);

  /* ── Format / Fit-Mode cycling ── */
  const { toast } = useToast();

  const cycleFormat = () => {
    const curr = (settings.export.format ?? "9:16") as VideoFormat;
    const idx  = CYCLE_FORMATS.indexOf(curr);
    const next = CYCLE_FORMATS[(idx + 1) % CYCLE_FORMATS.length]!;
    setSettings({ ...settings, export: { ...settings.export, format: next } });
    const vf = VIDEO_FORMATS.find((v) => v.id === next);
    toast({ description: `Format: ${next} · ${vf?.label ?? next}`, duration: 2000 });
  };

  const cycleFitMode = () => {
    const curr = (settings.export.fitMode ?? "fill") as FitMode;
    const idx  = CYCLE_FIT_MODES.indexOf(curr);
    const next = CYCLE_FIT_MODES[(idx + 1) % CYCLE_FIT_MODES.length]!;
    setSettings({ ...settings, export: { ...settings.export, fitMode: next } });
    toast({ description: t("videoEditor.fitModeToast", { label: t(FIT_TOAST[next]) }), duration: 2000 });
  };

  /* ── Transport: volume / mute / speed / loop ── */
  const [volume,   setVolume  ] = useState(1);
  const [muted,    setMuted   ] = useState(false);
  const [speed,    setSpeed   ] = useState(1);
  const [loop,     setLoop    ] = useState(false);
  const loopRef = useRef(loop);
  useEffect(() => { loopRef.current = loop; }, [loop]);

  /* ── Transport: scrubable progress bar ── */
  const scrubRef        = useRef<HTMLDivElement | null>(null);
  const isDraggingRef   = useRef(false);

  /* ── Auto PiP state — default ON, persisted to localStorage ── */
  const [autoPiP,            setAutoPiP           ] = useState<boolean>(() => {
    try { const s = localStorage.getItem("bdv:autoPiP"); return s === null ? true : s === "true"; }
    catch { return true; }
  });
  const [keepOnTabSwitch,    setKeepOnTabSwitch   ] = useState(false);

  /* ── Measure the actual rendered height of the header + footer chrome (drag handle,
   *    transport rows, etc.) so the outer pinned container's fixed height can add this
   *    on top of the video's target height, instead of the flex layout stealing space
   *    from — and potentially collapsing to zero — the video canvas. ── */
  useEffect(() => {
    const headerEl = chromeHeaderRef.current;
    const footerEl = chromeFooterRef.current;
    const recompute = () => {
      const h = (headerEl?.getBoundingClientRect().height ?? 0) + (footerEl?.getBoundingClientRect().height ?? 0);
      setChromeHeight(h);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (headerEl) ro.observe(headerEl);
    if (footerEl) ro.observe(footerEl);
    return () => ro.disconnect();
  }, [isMinimized, isFullscreen, autoPiP, pipError]);
  /* Return-to-browser tracking */
  const [wasPlayingBeforePiP,setWasPlayingBeforePiP] = useState(false);
  const [lastKnownTime,      setLastKnownTime     ] = useState(0);
  const [lastKnownScene,     setLastKnownScene    ] = useState(-1);
  const [lastKnownCaption,   setLastKnownCaption  ] = useState<string | null>(null);
  const [returnedFromPiP,    setReturnedFromPiP   ] = useState(false);
  const [playbackRestored,   setPlaybackRestored  ] = useState(false);
  const [docHidden,          setDocHidden         ] = useState(false);
  const [browserFocused,     setBrowserFocused    ] = useState(true);

  const pipSupported = typeof document !== "undefined" && !!document.pictureInPictureEnabled;

  /* ── Ambient-glow + blur-bg video sync.
   *    The ambient layer always mirrors the main video (cinematic backdrop behind
   *    the player frame); the in-canvas blur layer only exists when fitMode=blur.
   *    Refs are read live each tick so the layers can mount/unmount (minimize,
   *    fullscreen, fit-mode switches) without re-subscribing. ── */
  const fitMode = settings.export.fitMode ?? "fill";
  useEffect(() => {
    const main = liveVideoRef.current;
    if (!main) return;

    const targets = (): HTMLVideoElement[] => {
      const list: HTMLVideoElement[] = [];
      const ambient = ambientVideoRef.current;
      if (ambient) list.push(ambient);
      if (fitMode === "blur") {
        const blur = blurVideoRef.current;
        if (blur) list.push(blur);
      }
      return list;
    };

    const syncSrc = () => {
      for (const v of targets()) {
        if (v.src !== main.src) {
          v.src = main.src;
          v.load();
        }
      }
    };
    syncSrc();
    main.addEventListener("emptied", syncSrc);
    main.addEventListener("loadedmetadata", syncSrc);

    let raf: number;
    const syncTime = () => {
      syncSrc(); // re-attach src if a mirror layer remounted (minimize/fullscreen/fit-mode)
      for (const v of targets()) {
        if (v.readyState >= 2 && Math.abs(v.currentTime - main.currentTime) > 0.15) {
          v.currentTime = main.currentTime;
        }
        if (main.paused !== v.paused) {
          if (main.paused) v.pause();
          else             v.play().catch(() => { /* ignore */ });
        }
      }
      raf = requestAnimationFrame(syncTime);
    };
    raf = requestAnimationFrame(syncTime);

    return () => {
      cancelAnimationFrame(raf);
      main.removeEventListener("emptied", syncSrc);
      main.removeEventListener("loadedmetadata", syncSrc);
    };
  }, [fitMode, liveVideoRef]);

  /* Refs — callbacks always see latest values without re-subscribing */
  const autoPiPRef          = useRef(autoPiP); /* matches lazy-init state */
  const keepOnTabSwitchRef  = useRef(false);
  const isPlayingRef        = useRef(false);
  const prevTabRef          = useRef<EditorTab>(tab);
  const wasPlayingRef       = useRef(false);
  const engRef              = useRef<SharedPreviewState | null>(null);

  useEffect(() => { autoPiPRef.current         = autoPiP;               }, [autoPiP]);
  useEffect(() => { keepOnTabSwitchRef.current = keepOnTabSwitch;       }, [keepOnTabSwitch]);
  useEffect(() => { isPlayingRef.current       = eng?.isPlaying ?? false; }, [eng?.isPlaying]);
  useEffect(() => { engRef.current             = eng;                   }, [eng]);
  /* Persist Auto PiP preference to localStorage whenever it changes */
  useEffect(() => { try { localStorage.setItem("bdv:autoPiP", String(autoPiP)); } catch {} }, [autoPiP]);

  /* Fullscreen */
  useEffect(() => {
    const onFSChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  /* ── Video error recovery — if the media pipeline dies (black frame /
   *    "Unable to play media"), reload the current source and resume where
   *    it left off instead of staying dead until a page reload. ── */
  useEffect(() => {
    const v = liveVideoRef.current;
    if (!v) return;
    let attempts = 0;
    const onError = () => {
      if (attempts >= 2 || !v.src) return; // don't loop on a truly broken source
      attempts += 1;
      const resumeAt = v.currentTime;
      const wasPlaying = !v.paused;
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta);
        try { v.currentTime = Math.max(0, resumeAt); } catch { /* metadata race */ }
        if (wasPlaying) void v.play().catch(() => {});
      };
      v.addEventListener("loadedmetadata", onMeta);
      v.load();
    };
    v.addEventListener("error", onError);
    return () => v.removeEventListener("error", onError);
  }, []);

  /* ── PiP events + visibilitychange + focus/blur ── */
  useEffect(() => {
    const v = liveVideoRef.current;
    if (!v) return;

    /* Save state when entering PiP */
    const onEnter = () => {
      const playing = !v.paused;
      wasPlayingRef.current = playing;
      setWasPlayingBeforePiP(playing);
      setLastKnownTime(v.currentTime);
      setLastKnownScene(engRef.current?.activeSceneIndex ?? -1);
      setLastKnownCaption(engRef.current?.activeCaption?.text ?? null);
      setPipActive(true);
      setReturnedFromPiP(false);
      setPlaybackRestored(false);
    };

    /* Reconnect to master player when PiP closes */
    const onLeave = () => {
      setPipActive(false);
      setReturnedFromPiP(true);
      /* If we were playing before, ensure video keeps playing */
      if (wasPlayingRef.current) {
        if (v.paused) {
          v.play()
            .then(() => setPlaybackRestored(true))
            .catch((e) => {
              setPipError(t("videoEditor.pipResumeError", { msg: e instanceof Error ? e.message : String(e) }));
              setPlaybackRestored(false);
            });
        } else {
          setPlaybackRestored(true);
        }
      }
    };

    /* visibilitychange — enter PiP when browser is hidden.
       Never while fullscreen: PiP and fullscreen fight over the same media
       pipeline and the video can die with "Unable to play media". */
    const onVisibility = () => {
      const hidden = document.hidden;
      setDocHidden(hidden);
      if (hidden && autoPiPRef.current && !document.fullscreenElement && !document.pictureInPictureElement && !v.paused && canAutoPiP(v)) {
        v.requestPictureInPicture().catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setPipError(t("videoEditor.pipBlockedError", { msg }));
        });
      }
      /* When returning visible: leavepictureinpicture fires naturally; playback is restored there */
    };

    /* pagehide / pageshow */
    const onPageHide = () => {
      setDocHidden(true);
      if (autoPiPRef.current && !document.fullscreenElement && !document.pictureInPictureElement && !v.paused && canAutoPiP(v)) {
        v.requestPictureInPicture().catch(() => {});
      }
    };
    const onPageShow = () => {
      setDocHidden(false);
      /* playback restore handled by leavepictureinpicture */
    };

    /* focus / blur */
    const onFocus = () => setBrowserFocused(true);
    const onBlur  = () => {
      setBrowserFocused(false);
      if (autoPiPRef.current && !document.fullscreenElement && !document.pictureInPictureElement && !v.paused && canAutoPiP(v)) {
        v.requestPictureInPicture().catch(() => {});
      }
    };

    v.addEventListener("enterpictureinpicture", onEnter);
    v.addEventListener("leavepictureinpicture", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide",  onPageHide);
    window.addEventListener("pageshow",  onPageShow);
    window.addEventListener("focus",     onFocus);
    window.addEventListener("blur",      onBlur);

    return () => {
      v.removeEventListener("enterpictureinpicture", onEnter);
      v.removeEventListener("leavepictureinpicture", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide",  onPageHide);
      window.removeEventListener("pageshow",  onPageShow);
      window.removeEventListener("focus",     onFocus);
      window.removeEventListener("blur",      onBlur);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Auto PiP — editor-tab switch (off by default; the master player stays
   * fixed in the workspace unless the user opts in) */
  useEffect(() => {
    const lv = liveVideoRef.current;
    if (
      prevTabRef.current !== tab &&
      autoPiPRef.current &&
      keepOnTabSwitchRef.current &&
      isPlayingRef.current &&
      pipSupported &&
      !document.pictureInPictureElement &&
      canAutoPiP(lv)
    ) {
      lv.requestPictureInPicture().catch((e) => {
        setPipError(t("videoEditor.autoPipError", { msg: e instanceof Error ? e.message : String(e) }));
      });
    }
    prevTabRef.current = tab;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current.requestFullscreen();
  }

  async function togglePiP() {
    setPipError(null);
    const v = liveVideoRef.current;
    if (!v) return;
    if (!pipSupported) { setPipError(t("videoEditor.pipNotSupported")); return; }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (e) {
      setPipError(t("videoEditor.pipFailedError", { msg: e instanceof Error ? e.message : String(e) }));
    }
  }

  async function enableAutoPiP() {
    if (!pipSupported) { setPipError("Picture-in-Picture is not supported in this browser."); return; }
    setAutoPiP(true);
    autoPiPRef.current = true;
    setPipError(null);
    setReturnedFromPiP(false);
    setPlaybackRestored(false);
    const v = liveVideoRef.current;
    if (!v) return;
    try {
      if (!document.pictureInPictureElement) await v.requestPictureInPicture();
    } catch {
      setPipError(t("videoEditor.pipNeedsClick"));
    }
  }

  function disableAutoPiP() {
    setAutoPiP(false);
    autoPiPRef.current = false;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    setReturnedFromPiP(false);
    setPlaybackRestored(false);
  }

  const isPlaying     = eng?.isPlaying ?? false;
  const currentTime   = eng?.currentTime ?? 0;
  const duration      = eng?.audioDuration ?? 0;
  const sceneIdx      = eng?.activeSceneIndex ?? -1;
  const currentScene  = sceneIdx >= 0 ? scenes[sceneIdx] : null;
  const activeCaption = eng?.activeCaption ?? null;

  /* When engine is running use engine scene; otherwise use the static preview scene */
  const displayScene    = eng ? currentScene : previewScene;
  const displaySceneIdx = eng ? sceneIdx : (previewScene ? scenes.indexOf(previewScene) : -1);

  const clipLoaded    = !!displayScene?.demoClipUrl;
  const captionLoaded = !!activeCaption;
  const hasScenes     = scenes.length > 0;

  /* ── Transport callbacks ─────────────────────────────────────── */

  const seek = useCallback((sec: number) => {
    /* Only clamp to duration when we actually know it; otherwise let TLP handle bounds */
    const clamped = Math.max(0, duration > 0 ? Math.min(sec, duration) : sec);
    onSeek(clamped);
  }, [onSeek, duration]);

  const seekFromPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrubRef.current;
    if (!el || !duration) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(frac * duration);
  }, [seek, duration]);

  const handleScrubDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    seekFromPointer(e);
  }, [seekFromPointer]);

  const handleScrubMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    seekFromPointer(e);
  }, [seekFromPointer]);

  const handleScrubUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const rewind = useCallback((sec: number) => seek(currentTime - sec), [seek, currentTime]);
  const ff     = useCallback((sec: number) => seek(currentTime + sec), [seek, currentTime]);

  const sceneOffsets = useMemo(
    () => buildSceneOffsets(scenes, duration),
    [scenes, duration],
  );

  /* Mirror TLP's sceneAt(): scan backwards, first offset <= currentTime wins */
  const activeSceneIdx = useMemo(() => {
    for (let i = sceneOffsets.length - 1; i >= 0; i--) {
      if (currentTime >= (sceneOffsets[i] ?? 0)) return i;
    }
    return 0;
  }, [currentTime, sceneOffsets]);

  /* Refs so callbacks always read the latest values, no stale closure capture */
  const currentTimeRef2  = useRef(currentTime);
  const sceneOffsetsRef2 = useRef(sceneOffsets);
  useEffect(() => { currentTimeRef2.current  = currentTime;   }, [currentTime]);
  useEffect(() => { sceneOffsetsRef2.current = sceneOffsets;  }, [sceneOffsets]);

  /* Debug state for scene skip — shown in status row */
  const [skipDebug, setSkipDebug] = useState<{
    action: string; before: number; target: number; idx: number; count: number;
  } | null>(null);

  const prevClip = useCallback(() => {
    const offs = sceneOffsetsRef2.current;
    const ct   = currentTimeRef2.current;
    console.log('[PrevScene] clicked — ct:', ct.toFixed(3), 'offsets:', offs, 'duration:', duration);
    let idx = 0;
    for (let i = offs.length - 1; i >= 0; i--) { if (ct >= (offs[i] ?? 0)) { idx = i; break; } }
    const activeStart = offs[idx] ?? 0;
    const target = ct > activeStart + 1.0
      ? activeStart
      : idx > 0 ? (offs[idx - 1] ?? 0) : 0;
    console.log('[PrevScene] idx:', idx, 'activeStart:', activeStart.toFixed(3), '→ target:', target.toFixed(3));
    setSkipDebug({ action: 'prev', before: ct, target, idx, count: offs.length });
    seek(target);
  }, [seek, duration]);

  const nextClip = useCallback(() => {
    const offs = sceneOffsetsRef2.current;
    const ct   = currentTimeRef2.current;
    console.log('[NextScene] clicked — ct:', ct.toFixed(3), 'offsets:', offs, 'duration:', duration);
    if (offs.length === 0) { console.log('[NextScene] no offsets, aborting'); return; }
    let idx = 0;
    for (let i = offs.length - 1; i >= 0; i--) { if (ct >= (offs[i] ?? 0)) { idx = i; break; } }
    const target = idx < offs.length - 1 ? (offs[idx + 1] ?? 0) : (offs[offs.length - 1] ?? 0);
    console.log('[NextScene] idx:', idx, '→ target:', target.toFixed(3));
    setSkipDebug({ action: 'next', before: ct, target, idx, count: offs.length });
    seek(target);
  }, [seek, duration]);

  const frameStep = useCallback((dir: 1 | -1) => {
    seek(currentTime + dir / 30);
  }, [seek, currentTime]);

  const cycleSpeed = useCallback(() => {
    const idx = (PLAYBACK_SPEEDS as readonly number[]).indexOf(speed);
    const next = (PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length] ?? 1) as number;
    setSpeed(next);
    onSetPlaybackRate(next);
  }, [speed, onSetPlaybackRate]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    onSetMuted(next);
  }, [muted, onSetMuted]);

  const handleVolume = useCallback((vol: number) => {
    setVolume(vol);
    onSetVolume(vol);
    if (muted && vol > 0) { setMuted(false); onSetMuted(false); }
  }, [muted, onSetVolume, onSetMuted]);

  /* ── Player-level loop: when enabled and playback reaches the end, restart
   *    from the top instead of stopping. Uses a ref so the engine tick never
   *    sees a stale value. ── */
  useEffect(() => {
    if (loopRef.current && isPlaying && duration > 0 && currentTime >= duration - 0.3) {
      seek(0);
    }
  }, [currentTime, isPlaying, duration, seek]);

  /* ── Keyboard shortcuts (global when not in an input) ────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      switch (e.key) {
        case " ":          e.preventDefault(); onTogglePlay(); break;
        case "Home":       e.preventDefault(); onRestart();   break;
        case "ArrowLeft":  e.preventDefault(); e.shiftKey ? prevClip() : rewind(5);   break;
        case "ArrowRight": e.preventDefault(); e.shiftKey ? nextClip() : ff(5);       break;
        case ",":          e.preventDefault(); frameStep(-1); break;
        case ".":          e.preventDefault(); frameStep(1);  break;
        case "m": case "M": e.preventDefault(); toggleMute(); break;
        case "f": case "F": e.preventDefault(); void toggleFullscreen(); break;
        case "p": case "P": e.preventDefault(); void togglePiP(); break;
        case "j": case "J": e.preventDefault(); rewind(10); break;
        case "l": case "L": e.preventDefault(); ff(10); break;
        case "t": case "T": e.preventDefault(); toggleTheater(); break;
        case "Escape":
          if (theaterOn && !document.fullscreenElement) { e.preventDefault(); toggleTheater(); }
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTogglePlay, onRestart, prevClip, nextClip, rewind, ff, frameStep, toggleMute, toggleFullscreen, toggleTheater, theaterOn]);

  /* ── Effects layer computation ── */
  const activeEffects   = settings.effects;
  const aiEffectsApplied = settings.aiEdit.applied && activeEffects.length > 0;

  const effectsCssFilter = testEffectActive
    ? "grayscale(100%)"
    : buildEffectFilter(activeEffects);

  const effectsTransform = testEffectActive ? "scale(1.25)" : undefined;

  /* True Camera Shake preview: CSS keyframe wobble on the effects wrapper.
   * The burned export is a real crop-wobble (TRUE_CAMERA_SHAKE_FFMPEG) —
   * this approximates its ±1.2% amplitude so WYSIWYG roughly holds. */
  const shakePreviewActive =
    !testEffectActive && activeEffects.includes("Camera Shake");

  /* ── Pro Tools live preview (per-clip) ──
   * Mirrors the server-side buildProToolsFilterChain() so the preview matches
   * the burned export. Chroma key uses a canvas (CSS can't key a color). */
  const displayProTools = useMemo(() => {
    if (!displayScene) return null;
    return getClipEdit(settings, displayScene.id).proTools;
  }, [displayScene, settings]);

  const proToolsCssFilter = displayProTools
    ? buildProToolsCssFilter(displayProTools.colorCorrection)
    : "";
  const proToolsTransform = displayProTools
    ? buildProToolsTransform(displayProTools)
    : "";
  const proToolsClipPath = displayProTools
    ? buildProToolsClipPath(displayProTools, null)
    : undefined;
  const chromaActive = displayProTools?.chromaKey.enabled ?? false;

  const combinedCssFilter = [effectsCssFilter, proToolsCssFilter].filter(Boolean).join(" ") || undefined;
  const combinedTransform = [effectsTransform, proToolsTransform].filter(Boolean).join(" ") || undefined;

  /* Speed preview: match the clip's playback rate on the master player. */
  useEffect(() => {
    const v = liveVideoRef.current;
    if (v && displayProTools) {
      const rate = Math.min(4, Math.max(0.25, displayProTools.speed || 1));
      if (v.playbackRate !== rate) v.playbackRate = rate;
    }
  }, [displayProTools?.speed, displayScene?.id]);

  const overlayColor = testEffectActive
    ? "rgba(220,30,30,0.55)"
    : null;

  const testText = testEffectActive ? t("videoEditor.effectTestActive") : null;

  /* ── Before/after compare slider ──────────────────────────────────
   * When on, a raw mirror of the live video (no filters, no overlays, no
   * test badges) renders underneath the effected composition; the effected
   * layer is clipped to the right of a draggable split so both sides stay
   * frame-synced. LEFT = before (raw), RIGHT = after (effected). */
  const [compareOn, setCompareOn] = useState(false);
  const [comparePos, setComparePos] = useState(COMPARE_POS_DEFAULT);
  const compareVideoRef = useRef<HTMLVideoElement | null>(null);
  const compareTrackRef = useRef<HTMLDivElement | null>(null);
  const compareDraggingRef = useRef(false);

  /* Mirror the live video into the "before" layer — same pattern as the
   * ambient-glow sync: re-attach src on remount, chase currentTime each
   * frame, mirror play/pause. Only runs while compare mode is on. */
  useEffect(() => {
    if (!compareOn) return;
    const main = liveVideoRef.current;
    const mirror = compareVideoRef.current;
    if (!main || !mirror) return;

    const syncSrc = () => {
      if (mirror.src !== main.src) {
        mirror.src = main.src;
        mirror.load();
      }
    };
    syncSrc();
    main.addEventListener("emptied", syncSrc);
    main.addEventListener("loadedmetadata", syncSrc);

    let raf = 0;
    const tick = () => {
      syncSrc(); // re-attach src if the mirror remounted
      if (mirror.readyState >= 2 && Math.abs(mirror.currentTime - main.currentTime) > 0.15) {
        mirror.currentTime = main.currentTime;
      }
      if (main.paused !== mirror.paused) {
        if (main.paused) mirror.pause();
        else mirror.play().catch(() => { /* main is already playing; ignore */ });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      main.removeEventListener("emptied", syncSrc);
      main.removeEventListener("loadedmetadata", syncSrc);
    };
  }, [compareOn, liveVideoRef]);

  const setPosFromClientX = useCallback((clientX: number) => {
    const el = compareTrackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setComparePos(comparePosFromClientX(clientX, rect.left, rect.width));
  }, []);

  const handleCompareDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    compareDraggingRef.current = true;
    setPosFromClientX(e.clientX);
  }, [setPosFromClientX]);

  const handleCompareMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!compareDraggingRef.current) return;
    setPosFromClientX(e.clientX);
  }, [setPosFromClientX]);

  const endCompareDrag = useCallback(() => {
    compareDraggingRef.current = false;
  }, []);

  const handleCompareKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? COMPARE_KEY_STEP_LARGE : COMPARE_KEY_STEP;
    if (e.key === "ArrowLeft") {
      e.preventDefault(); e.stopPropagation();
      setComparePos((p) => clampComparePos(p - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault(); e.stopPropagation();
      setComparePos((p) => clampComparePos(p + step));
    } else if (e.key === "Home") {
      e.preventDefault(); e.stopPropagation();
      setComparePos(COMPARE_POS_MIN);
    } else if (e.key === "End") {
      e.preventDefault(); e.stopPropagation();
      setComparePos(COMPARE_POS_MAX);
    }
  }, []);

  /* The compare toggle only appears when at least one visual effect is
   * actually altering the picture — otherwise it's clutter. */
  const showCompareToggle = hasActiveVisualEffects({
    testEffectActive,
    testOverlayActive,
    effectCount: activeEffects.length,
    overlayChipCount: activeOverlayChips.length,
    soloPreviewOverlay: settings.soloPreviewOverlay ?? null,
  });

  /* If the last effect is removed while comparing, drop out of compare mode
   * (the toggle is gone, so the user couldn't exit otherwise). */
  useEffect(() => {
    if (!showCompareToggle && compareOn) setCompareOn(false);
  }, [showCompareToggle, compareOn]);

  /* ── Cinema transport button styles ── */
  const tBtnSm = "flex items-center justify-center h-7 w-7 rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.09] hover:border-[#C9A84C]/30 transition-colors shrink-0";

  return (
    <>
      {/* Persistent affordance to bring the player back once it's been hidden.
          Rendered in-flow where the docked player normally sits. */}
      {isHidden && !isFullscreen && (
        <button
          type="button"
          onClick={toggleHidden}
          data-testid="master-player-show-tab"
          title={t("videoEditor.showMasterPlayer")}
          className="mx-auto flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-black/90 border border-white/20 text-white/70 hover:text-white hover:border-primary/50 shadow-2xl transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">{t("videoEditor.showPlayer")}</span>
        </button>
      )}
    {/* ── Visual mode: true focus mode. The background is essentially blacked out
        so ONLY the master player is visible. The player wrapper below is raised
        above this overlay via z-index. ── */}
    {theaterOn && !isHidden && (
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 55,
          background:
            "radial-gradient(ellipse 55% 52% at 50% 42%, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.985) 72%)",
        }}
      />
    )}
    <div
      ref={outerRef}
      style={floatStyle}
      className={`relative ${theaterOn && !isHidden ? "z-[60]" : ""}`}
    >
      {/* ── Ambient glow: blurred, dimmed mirror of the playing video, bleeding
          out from behind the gold frame. Hidden when minimized/fullscreen. ── */}
      {!isFullscreen && !isMinimized && (
        <div
          aria-hidden
          className="absolute -inset-10 md:-inset-14 pointer-events-none select-none"
          style={{ zIndex: 0 }}
        >
          <video
            ref={ambientVideoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ filter: "blur(70px) brightness(0.5) saturate(1.3)", transform: "scale(1.06)" }}
          />
        </div>
      )}
    <div
      ref={containerRef}
      onMouseMove={showControls}
      className={`relative ${
        isFullscreen
          ? "bg-black flex flex-col"
          : `rounded-2xl p-[1.5px] bg-gradient-to-br from-[#f7dd7f] via-[#C9A84C]/60 to-[#6e5623] flex flex-col transition-shadow duration-300 ${
              isResizingFloat
                ? "shadow-[0_0_90px_-10px_rgba(201,168,76,0.65),0_30px_70px_-20px_rgba(0,0,0,0.95)]"
                : "shadow-[0_0_70px_-12px_rgba(201,168,76,0.35),0_30px_70px_-20px_rgba(0,0,0,0.95)]"
            }`
      }`}
      style={{ zIndex: 1 }}
    >
      <div className={isFullscreen ? "flex flex-col h-full bg-black" : "rounded-[calc(1rem-1.5px)] bg-black overflow-hidden flex flex-col"}>
      {!isFullscreen && (
        <div
          ref={chromeHeaderRef}
          className="flex items-center justify-between px-2 py-1 bg-black/80 border-b border-white/[0.1] select-none shrink-0"
          title="Master Player"
        >
          <span className="flex items-center gap-1 text-[9px] font-bold text-white/50 uppercase tracking-wider">
            {!isMinimized && "Master Player"}
          </span>
          <span className="flex items-center gap-0.5">
            {/* Before/after compare — only when an effect is actually altering the picture */}
            {showCompareToggle && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setCompareOn((v) => !v)}
                data-testid="master-player-compare-toggle"
                title={compareOn ? t("videoEditor.exitCompare") : t("videoEditor.compareEffects")}
                aria-pressed={compareOn}
                className={`flex items-center justify-center h-5 w-5 rounded transition-colors ${
                  compareOn
                    ? "text-[#f7dd7f] bg-[#C9A84C]/20"
                    : "text-white/50 hover:text-white hover:bg-white/[0.1]"
                }`}
              >
                <Columns2 className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleTheater}
              data-testid="master-player-theater-toggle"
              title={theaterOn ? t("videoEditor.exitVisualMode") : t("videoEditor.visualMode")}
              className={`flex items-center justify-center h-5 w-5 rounded transition-colors ${
                theaterOn
                  ? "text-[#f7dd7f] bg-[#C9A84C]/20"
                  : "text-white/50 hover:text-white hover:bg-white/[0.1]"
              }`}
            >
              <Theater className="h-3 w-3" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleMinimize}
              data-testid="master-player-minimize-toggle"
              title={isMinimized ? t("videoEditor.restorePlayer") : t("videoEditor.minimizePlayer")}
              className="flex items-center justify-center h-5 w-5 rounded text-white/50 hover:text-white hover:bg-white/[0.1] transition-colors"
            >
              {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleHidden}
              data-testid="master-player-hide-toggle"
              title={t("videoEditor.hidePlayer")}
              className="flex items-center justify-center h-5 w-5 rounded text-white/50 hover:text-white hover:bg-white/[0.1] transition-colors"
            >
              <EyeOff className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}
      {/* ── Video area — MasterVideoElement is ALWAYS in DOM ── */}
      {(() => {
        const fmt    = settings.export.format ?? "9:16";
        const arCss  = formatAspectCss(fmt);
        const canvas = (
      <div
        data-testid="master-player-canvas"
        ref={compareTrackRef}
        className="bg-black relative overflow-hidden shrink-0 [container-type:size]"
        style={{ aspectRatio: arCss, width: isFullscreen ? "100%" : floatWidth, height: isFullscreen ? "100%" : "auto", maxWidth: "100%", marginLeft: "auto", marginRight: "auto" }}
      >
        {/* ── Blur-background layer (fit mode = blur) ── */}
        {fitMode === "blur" && !isFullscreen && !isMinimized && (
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ transform: "scale(1.08)", zIndex: 0 }}
          >
            <video
              ref={blurVideoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ filter: "blur(22px) brightness(0.52)", willChange: "filter" }}
            />
          </div>
        )}

        {/* ── BEFORE layer (compare mode): a raw mirror of the live video —
            no CSS filters, no zoom, no overlays, no test badges. It stays in
            sync with the main video via the compare rAF loop above. ── */}
        {compareOn && (
          <div className="absolute inset-0" style={{ zIndex: 1 }} aria-hidden="true">
            <video
              ref={compareVideoRef}
              playsInline
              muted
              data-testid="master-player-compare-before-video"
              className={`w-full h-full ${fitMode === "fill" ? "object-cover" : "object-contain"}`}
            />
          </div>
        )}

        {/* ── AFTER layer: the full effected composition. In compare mode it is
            clipped to the right of the split (LEFT = before, RIGHT = after);
            otherwise it fills the canvas exactly as it always has. ── */}
        <div
          className="absolute inset-0"
          data-testid="master-player-after-layer"
          style={compareOn ? { clipPath: compareClipPath(comparePos), zIndex: 2 } : { zIndex: 2 }}
        >
        {/* ── Effects-wrapped video layer — filter + zoom applied here only.
            Pro Tools per-clip grade/geometry/crop layer in on top of effects. ── */}
        <div
          className="absolute inset-0"
          style={{
            filter: combinedCssFilter,
            transform: combinedTransform,
            clipPath: proToolsClipPath,
            transformOrigin: "center center",
            transition: "filter 0.3s ease, transform 0.4s ease",
            animation: shakePreviewActive ? "bdv-cam-shake 0.55s linear infinite" : undefined,
            zIndex: 1,
          }}
        >
          <MasterVideoElement videoRef={liveVideoRef} fitMode={fitMode} />
          {/* Animated film grain — preview of the export's real grain (see FILM_GRAIN_FFMPEG) */}
          {activeEffects.includes("Film Grain") && (
            <div
              className="absolute inset-0 pointer-events-none bdv-film-grain"
              style={{ zIndex: 2 }}
              aria-hidden
            />
          )}
          {/* True Cinematic Bars — real DOM black bars, exactly matching the
              burned drawbox chain (12.5% top + 12.5% bottom). */}
          {activeEffects.includes("Cinematic Bars") && (
            <>
              <div
                className="absolute top-0 left-0 right-0 bg-black pointer-events-none"
                style={{ height: "12.5%", zIndex: 2 }}
                aria-hidden
              />
              <div
                className="absolute bottom-0 left-0 right-0 bg-black pointer-events-none"
                style={{ height: "12.5%", zIndex: 2 }}
                aria-hidden
              />
            </>
          )}
          {/* True VHS preview — scanlines + tracking-line sweep. The burned
              export adds real tape noise + chromatic aberration on top
              ("preview approximates — export is the real thing"). */}
          {activeEffects.includes("VHS") && (
            <>
              <div
                className="absolute inset-0 pointer-events-none bdv-vhs-scanlines"
                style={{ zIndex: 2 }}
                aria-hidden
              />
              <div
                className="absolute left-0 right-0 pointer-events-none bdv-vhs-trackline"
                style={{ zIndex: 2 }}
                aria-hidden
              />
            </>
          )}
          {/* Chroma key preview draws FROM the video element via canvas — the
              video stays mounted (hidden) as the frame source. */}
          {chromaActive && displayProTools && (
            <div className="absolute inset-0" style={{ zIndex: 2 }}>
              <ChromaKeyPreview
                videoRef={liveVideoRef}
                settings={displayProTools.chromaKey}
              />
            </div>
          )}
          {/* Outgoing video + CSS transition overlay */}
          <TransitionCompositor
            outgoingVideoRef={outgoingVideoRef}
            transitionState={transitionState}
          />
        </div>

        {/* ── Animated overlay chip effects (Rain, Smoke, Sparks, etc.) ── */}
        <ActiveOverlayEffects
          activeOverlays={activeOverlayChips}
          intensity={overlayIntensity}
          testActive={testOverlayActive}
          isPlaying={eng?.isPlaying ?? false}
          watermarkText={settings.watermarkText ?? "Bow Down Visuals"}
          watermarkType={settings.watermarkType ?? "logo"}
          watermarkPosition={settings.watermarkPosition ?? "bottom-right"}
          watermarkSize={settings.watermarkSize ?? "medium"}
          watermarkMargin={settings.watermarkMargin ?? 16}
          watermarkShowOnPreview={settings.watermarkShowOnPreview ?? true}
          brandingWatermark={settings.branding?.watermark ?? null}
          waveformPosition={settings.waveformPosition ?? "bottom-safe"}
          overlayQualityMode={settings.overlayQualityMode ?? "music-video"}
          overlayProtectCaptions={settings.overlayProtectCaptions ?? true}
          soloPreviewOverlay={settings.soloPreviewOverlay ?? null}
        />

        {/* ── Structured overlay layer (timed items + test badge) ── */}
        <OverlayLayer
          items={settings.overlayItems}
          currentTime={eng?.currentTime ?? 0}
          testOverlay={testOverlayActive ? { content: "OVERLAY TEST", color: "#C9A84C", textColor: "#000000" } : null}
        />

        {/* ── Color overlay (test = red, future: tint grades) ── */}
        {overlayColor && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: overlayColor, zIndex: 10 }}
          />
        )}

        {/* ── "EFFECT TEST ACTIVE" text overlay ── */}
        {testText && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 20 }}
          >
            <div style={{
              background: "rgba(0,0,0,0.85)",
              color: "#ff4444",
              fontWeight: 900,
              fontSize: "clamp(13px,3.5vw,24px)",
              padding: "0.45rem 1.4rem",
              borderRadius: "0.5rem",
              border: "2px solid #ff4444",
              letterSpacing: "0.1em",
              textShadow: "0 0 20px rgba(255,68,68,0.8)",
            }}>
              {testText}
            </div>
          </div>
        )}
        </div>{/* ── end AFTER layer ── */}

        {/* ── Pro Tools reverse badge — reverse playback can't be previewed in
            HTML video; the flip happens at export time. ── */}
        {displayProTools?.reverse && (
          <div className="absolute top-3 left-3 pointer-events-none" style={{ zIndex: 30 }}>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest
              bg-black/70 border border-[#C9A84C]/50 text-[#C9A84C]">
              <Repeat className="h-3 w-3" /> Reversed on export
            </div>
          </div>
        )}

        {/* ── Compare split handle + Before/After tags ── */}
        {compareOn && (
          <>
            {/* split line */}
            <div
              className="absolute inset-y-0 pointer-events-none"
              style={{ left: `${clampComparePos(comparePos)}%`, zIndex: 30 }}
              aria-hidden="true"
            >
              <div className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-[#f7dd7f] shadow-[0_0_14px_rgba(201,168,76,0.9)]" />
            </div>
            {/* drag handle — pointer drag + full keyboard support */}
            <button
              type="button"
              role="slider"
              aria-label={t("videoEditor.comparePositionLabel")}
              aria-valuemin={COMPARE_POS_MIN}
              aria-valuemax={COMPARE_POS_MAX}
              aria-valuenow={clampComparePos(comparePos)}
              aria-valuetext={`${clampComparePos(comparePos)} percent after`}
              data-testid="master-player-compare-handle"
              onPointerDown={handleCompareDown}
              onPointerMove={handleCompareMove}
              onPointerUp={endCompareDrag}
              onPointerCancel={endCompareDrag}
              onKeyDown={handleCompareKeyDown}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 h-10 w-10 rounded-full bg-black/85 border-2 border-[#f7dd7f] text-[#f7dd7f] flex items-center justify-center cursor-ew-resize touch-none shadow-[0_0_18px_rgba(201,168,76,0.5)] hover:scale-105 transition-transform"
              style={{ left: `${clampComparePos(comparePos)}%` }}
            >
              <ChevronsLeftRight className="h-4 w-4" />
            </button>
            {/* Before / After tags */}
            <div className="absolute top-1/2 -translate-y-1/2 left-2 z-30 pointer-events-none px-2 py-0.5 rounded-md bg-black/70 border border-white/15 text-[10px] font-black uppercase tracking-widest text-white/80">
              Before
            </div>
            <div className="absolute top-1/2 -translate-y-1/2 right-2 z-30 pointer-events-none px-2 py-0.5 rounded-md bg-[#C9A84C]/90 text-[10px] font-black uppercase tracking-widest text-black">
              After
            </div>
          </>
        )}

        {/* No-clip placeholder — over the (empty) video */}
        {!clipLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/20 pointer-events-none">
            <Film className="h-12 w-12" />
            <p className="text-sm font-medium text-center px-6">
              {scenes.length === 0
                ? t("videoEditor.generateScenesToPreview")
                : eng
                  ? t("videoEditor.activeSceneNoClip")
                  : t("videoEditor.clickPreviewHint")}
            </p>
          </div>
        )}

        {/* ── Caption safe-area guide box ── */}
        {captionSettings.showSafeArea && (
          <div
            className="absolute pointer-events-none"
            style={{
              top: "7%", bottom: "7%", left: "5%", right: "5%",
              border: "1.5px dashed rgba(201,168,76,0.55)",
              borderRadius: "4px",
              zIndex: 28,
            }}
          >
            <span style={{
              position: "absolute", top: 3, left: 5,
              fontSize: "clamp(7px, 1.2cqw, 10px)",
              color: "rgba(201,168,76,0.75)",
              fontFamily: "monospace", fontWeight: "bold",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>            {t("videoEditor.captionSafeArea")}</span>
          </div>
        )}

        {/* Caption overlay — styled from captionSettings */}
        {activeCaption && (() => {
          const { containerStyle, wrapperStyle, textStyle, animClass, maxWidth } = buildCaptionOverlayStyle(captionSettings);
          const lineClamp = Number(captionSettings.maxLines ?? "2");
          const karaokeWords = captionSettings.stylePreset === "karaoke-word"
            ? getValidCaptionWords(activeCaption)
            : null;
          const clampStyle: React.CSSProperties = {
            ...textStyle,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: lineClamp,
            overflow: "hidden",
            wordBreak: "break-word",
            overflowWrap: "break-word",
          };
          return (
            <div className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ ...containerStyle, zIndex: 27 }}>
              <div
                key={activeCaption.id}
                className={`text-center leading-snug ${animClass}`}
                style={{ ...wrapperStyle, maxWidth }}
                data-testid="master-caption-text"
              >
                {karaokeWords ? (
                  <span style={clampStyle}>
                    {karaokeWords.map((w, i) => {
                      const ws = activeCaption.startSec + w.start;
                      const we = activeCaption.startSec + w.end;
                      const isActive = currentTime >= ws && currentTime < we;
                      const isSung = currentTime >= we;
                      return (
                        <span
                          key={i}
                          style={{
                            color: isActive ? "#FFD700" : isSung ? "#ffffff" : "rgba(255,255,255,0.42)",
                            textShadow: isActive
                              ? "0 0 14px rgba(255,215,0,.75), 2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000"
                              : "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000",
                            display: "inline-block",
                            transform: isActive ? "scale(1.12)" : "scale(1)",
                            transition: "transform 0.12s ease, color 0.12s ease",
                          }}
                        >
                          {w.word}{i < karaokeWords.length - 1 ? "\u00A0" : ""}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span style={clampStyle}>{activeCaption.text}</span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Scene badge — top-left, slim and on-brand */}
        {displayScene && displaySceneIdx >= 0 && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/55 border border-[#C9A84C]/25 backdrop-blur-sm pointer-events-none">
            <Film className="h-2.5 w-2.5 text-[#C9A84C]/80" />
            <span className="text-[9px] font-bold text-white/60 max-w-[200px] truncate tracking-wide">
              Scene {displaySceneIdx + 1}/{scenes.length}
              {displayScene.section ? ` · ${displayScene.section}` : ""}
            </span>
          </div>
        )}

        {/* Playing indicator — top-right, only while actually playing.
            The paused state is already communicated by the big play button. */}
        {isPlaying && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <Volume2 className="h-3 w-3 text-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">{t("videoEditor.liveBadge")}</span>
          </div>
        )}

        {/* Big play button overlay — not playing, has scenes */}
        {!isPlaying && hasScenes && (
          <button
            type="button"
            onClick={onTogglePlay}
            className="absolute inset-0 flex items-center justify-center"
            aria-label={t("videoEditor.startPreview")}
          >
            <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors backdrop-blur-sm">
              <Play className="h-6 w-6 text-primary ml-0.5" />
            </div>
          </button>
        )}
      </div>
        );
        /* Fullscreen: center canvas with correct aspect ratio; non-fullscreen: raw canvas */
        return isFullscreen
          ? <div className="flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden">{canvas}</div>
          : canvas;
      })()}

      <div ref={chromeFooterRef}>
      {/* ── Minimized chip — condensed play/pause only, distinct from auto-PiP ── */}
      {isMinimized && (
        <div className="flex items-center justify-center gap-1 px-2 py-1.5 border-t border-white/[0.06] shrink-0">
          <button type="button" onClick={onTogglePlay} disabled={!hasScenes}
            className="flex items-center justify-center h-6 w-6 rounded-md bg-primary/20 hover:bg-primary/30 border border-primary/30 transition-colors text-primary disabled:opacity-30 shrink-0"
            title={t("videoEditor.playPauseSpace")}>
            {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
        </div>
      )}

      {/* ── Transport bar — floating glass console pinned to the bottom of the
          player (always visible docked; auto-hides in fullscreen; hidden while
          minimized). Utility row: scene nav + player settings (compact,
          secondary). Main row: ONE clean line — play/pause · seek · time ·
          volume · fullscreen. ── */}
      {!isMinimized && (
      <div className={`mx-1 mt-0.5 rounded-xl border border-[#C9A84C]/25 bg-black/55 backdrop-blur-xl px-1.5 py-1 shadow-[0_12px_44px_-12px_rgba(0,0,0,0.9)] transition-all duration-300 ${
        isFullscreen
          ? `shrink-0 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`
          : ""
      }`}>
        {/* Utility row — scene navigation + player settings (compact, secondary) */}
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {/* Restart */}
          <button type="button" onClick={onRestart} disabled={!hasScenes}
            className={tBtnSm} title={t("videoEditor.restartTitle")}>
            <RotateCcw className="h-3 w-3" />
          </button>
          {/* Prev Scene */}
          <button type="button" onClick={prevClip} disabled={!hasScenes}
            className={tBtnSm} title={t("videoEditor.prevSceneTitle")}>
            <Rewind className="h-3 w-3" />
          </button>
          {/* Back 10s */}
          <button type="button" onClick={() => rewind(10)} disabled={!hasScenes}
            className={`${tBtnSm} min-w-[1.75rem] px-1 text-[9px] font-black tabular-nums`} title={t("videoEditor.back10sTitle")}>-10</button>
          {/* Frame step back */}
          <button type="button" onClick={() => frameStep(-1)} disabled={!hasScenes}
            className={tBtnSm} title={t("videoEditor.stepBackTitle")}>
            <StepBack className="h-3 w-3" />
          </button>
          {/* Frame step forward */}
          <button type="button" onClick={() => frameStep(1)} disabled={!hasScenes}
            className={tBtnSm} title={t("videoEditor.stepForwardTitle")}>
            <StepForward className="h-3 w-3" />
          </button>
          {/* Forward 10s */}
          <button type="button" onClick={() => ff(10)} disabled={!hasScenes}
            className={`${tBtnSm} min-w-[1.75rem] px-1 text-[9px] font-black tabular-nums`} title={t("videoEditor.forward10sTitle")}>+10</button>
          {/* Next Scene */}
          <button type="button" onClick={nextClip} disabled={!hasScenes}
            className={tBtnSm} title={t("videoEditor.nextSceneTitle")}>
            <FastForward className="h-3 w-3" />
          </button>
          {/* Loop */}
          <button type="button" onClick={() => setLoop((v) => !v)} disabled={!hasScenes}
            className={`flex items-center justify-center h-7 w-7 rounded-lg border transition-colors shrink-0 disabled:opacity-30 ${
              loop
                ? "border-[#C9A84C]/60 bg-[#C9A84C]/20 text-[#f7dd7f] shadow-[0_0_12px_rgba(201,168,76,0.4)]"
                : "border-white/[0.08] bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.09] hover:border-[#C9A84C]/30"
            }`}
            title={loop ? t("videoEditor.loopOnTitle") : t("videoEditor.loopOffTitle")}>
            <Repeat className="h-3 w-3" />
          </button>
          {/* Playback speed */}
          <button type="button" onClick={cycleSpeed}
            className={`${tBtnSm} min-w-[2.25rem] px-1.5 text-[9px] font-black tabular-nums`}
            title={t("videoEditor.speedTitle", { speed })}>
            {speed}x
          </button>
          {/* Aspect Ratio cycle */}
          <button type="button" onClick={cycleFormat}
            className={tBtnSm}
            title={t("videoEditor.aspectRatioTitle", { format: settings.export.format ?? "9:16" })}>
            {FORMAT_ICONS_MAP[(settings.export.format ?? "9:16") as VideoFormat]}
          </button>
          {/* Fit Mode cycle */}
          <button type="button" onClick={cycleFitMode}
            className={`${tBtnSm} min-w-[2rem] px-1`}
            title={t("videoEditor.fitTitle", { label: t(FIT_TOAST[(settings.export.fitMode ?? "fill") as FitMode]) })}>
            <span className="text-[7px] font-black tracking-widest uppercase leading-none">
              {t(FIT_BADGE[(settings.export.fitMode ?? "fill") as FitMode])}
            </span>
          </button>
          {/* PiP — one button, manual only; Auto PiP toggled via settings row below */}
          <button type="button" onClick={() => void togglePiP()}
            className={`flex items-center justify-center h-7 w-7 rounded-lg border transition-colors shrink-0 ${
              pipActive
                ? "border-[#C9A84C]/50 bg-[#C9A84C]/15 text-[#f7dd7f]"
                : "border-white/[0.08] bg-white/[0.04] text-white/50 hover:text-white/85 hover:bg-white/[0.08]"
            }`}
            title={pipActive ? t("videoEditor.exitPipTitle") : t("videoEditor.pipTitle")}>
            <PictureInPicture2 className="h-3 w-3" />
          </button>
        </div>
        {/* ── Main transport row — one clean line at the bottom of the player:
            play/pause · seek · time · volume · fullscreen ── */}
        <div className="flex items-center gap-1.5 mt-1">
          {/* Play / Pause — hero button */}
          <button type="button" onClick={onTogglePlay} disabled={!hasScenes}
            className="flex items-center justify-center h-8 w-8 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black shadow-[0_0_22px_rgba(201,168,76,0.55)] hover:brightness-110 active:scale-95 transition-all shrink-0 disabled:opacity-30"
            title={t("videoEditor.playPauseSpace")}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>
          {/* Scrubable progress bar — flexible width */}
          <div
            ref={scrubRef}
            className="relative flex-1 min-w-[40px] h-3 rounded-full cursor-pointer bg-white/[0.08] group select-none"
            onPointerDown={handleScrubDown}
            onPointerMove={handleScrubMove}
            onPointerUp={handleScrubUp}
            onPointerLeave={handleScrubUp}
          >
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#C9A84C]/80 to-[#f7dd7f]/90 rounded-full transition-none pointer-events-none"
              style={{ width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : "0%" }} />
            <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-[#f7dd7f] shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ left: duration > 0 ? `calc(${Math.min(100, (currentTime / duration) * 100)}% - 7px)` : "0" }} />
          </div>
          {/* Time display — current / total */}
          <span className="shrink-0 text-[11px] font-mono tabular-nums text-white/70">
            {fmtSecs(currentTime)}<span className="text-white/25">/</span>{fmtSecs(duration || 0)}
          </span>
          {/* Mute */}
          <button type="button" onClick={toggleMute}
            className={tBtnSm} title={muted ? "Unmute (M)" : "Mute (M)"}>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          {/* Volume slider */}
          <input
            type="range" min={0} max={1} step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolume(Number(e.target.value))}
            className="w-12 sm:w-14 accent-[#C9A84C] cursor-pointer shrink-0"
            title={t("videoEditor.volumeTitle", { pct: Math.round((muted ? 0 : volume) * 100) })}
          />
          {/* Fullscreen — launches from the pinned player */}
          <button type="button" onClick={toggleFullscreen}
            className={`flex items-center justify-center h-7 w-7 rounded-lg border transition-colors shrink-0 ${
              isFullscreen
                ? "border-[#C9A84C]/50 bg-[#C9A84C]/15 text-[#f7dd7f]"
                : "border-white/[0.08] bg-white/[0.04] text-white/50 hover:text-white hover:bg-white/[0.08]"
            }`}
            title={isFullscreen ? t("videoEditor.exitFullscreen") : t("videoEditor.fullscreen")}>
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      )}

      {/* Auto PiP sub-settings — hidden in fullscreen / while minimized */}
      {!isFullscreen && !isMinimized && (
        <div className="px-3 py-1.5 border-t border-white/[0.06] bg-white/[0.02] flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] font-bold text-white/30 shrink-0">{t("videoEditor.autoPipLabel")}</span>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoPiP}
              onChange={(e) => { if (e.target.checked) void enableAutoPiP(); else disableAutoPiP(); }}
              className="accent-primary w-3 h-3"
            />
            <span className="text-[10px] text-white/50">{t("videoEditor.enableAutoPip")}</span>
          </label>
          {autoPiP && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepOnTabSwitch}
                onChange={(e) => setKeepOnTabSwitch(e.target.checked)}
                className="accent-primary w-3 h-3"
              />
              <span className="text-[10px] text-white/50">{t("videoEditor.onTabSwitch")}</span>
            </label>
          )}
        </div>
      )}

      {/* Scene jump + PiP debug status — dev-only diagnostics, hidden in fullscreen / while minimized */}
      {import.meta.env.DEV && !isFullscreen && !isMinimized && (
        <div className="px-4 py-1 border-t border-white/[0.04] bg-black/20 flex flex-wrap items-center gap-x-4 gap-y-0.5">
          {([
            ["scenes",        `${sceneOffsets.length} pts`],
            ["scene",         `${activeSceneIdx + 1}/${sceneOffsets.length}`],
            ["scene start",   `${(sceneOffsets[activeSceneIdx] ?? 0).toFixed(2)}s`],
            ["prev start",    activeSceneIdx > 0 ? `${(sceneOffsets[activeSceneIdx - 1] ?? 0).toFixed(2)}s` : "—"],
            ["next start",    activeSceneIdx < sceneOffsets.length - 1 ? `${(sceneOffsets[activeSceneIdx + 1] ?? 0).toFixed(2)}s` : "—"],
            ...(skipDebug ? [
              ["last skip",   skipDebug.action],
              ["before",      `${skipDebug.before.toFixed(2)}s`],
              ["→ target",    `${skipDebug.target.toFixed(2)}s`],
              ["seek used",   "shared OK"],
            ] as [string, string][] : [
              ["last skip",   "—"],
            ] as [string, string][]),
            ["pip auto",      autoPiP      ? "enabled" : "off"],
            ["pip active",    pipActive    ? "yes OK"   : "no"],
          ] as [string, string][]).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="text-[8px] font-mono text-white/20">{k}</span>
              <span className={`text-[8px] font-bold ${v.includes("OK") || v === "enabled" ? "text-green-400/50" : v === "—" || v === "no" || v === "off" ? "text-white/20" : "text-[#C9A84C]/50"}`}>{v}</span>
            </span>
          ))}
        </div>
      )}

      {/* Playback Animation Debug — dev-only diagnostics, hidden in fullscreen / while minimized */}
      {import.meta.env.DEV && !isFullscreen && !isMinimized && (
        <div className="px-4 py-1 border-t border-white/[0.04] bg-black/20 flex flex-wrap items-center gap-x-4 gap-y-0.5">
          <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest shrink-0">Anim</span>
          {([
            ["isPlaying",    (eng?.isPlaying ?? false) ? "yes OK" : "no"],
            ["isScrubbing",  isDraggingRef.current ? "yes" : "no"],
            ["master t",     `${(eng?.currentTime ?? 0).toFixed(2)}s`],
            ["audio t",      `${(eng?.currentTime ?? 0).toFixed(2)}s`],
            ["loops active", (eng?.isPlaying ?? false) ? "yes" : "no"],
            ["overlays",     (eng?.isPlaying ?? false) ? "running" : "paused OK"],
            ["waveform",     (eng?.isPlaying ?? false) ? "running" : "paused OK"],
            ["captions",     (eng?.isPlaying ?? false) ? "running" : "paused OK"],
            ["effects",      (eng?.isPlaying ?? false) ? "running" : "paused OK"],
          ] as [string, string][]).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="text-[8px] font-mono text-white/20">{k}</span>
              <span className={`text-[8px] font-bold ${
                v.includes("OK") ? "text-green-400/50"
                : v === "no" || v === "paused" ? "text-white/20"
                : v === "yes" ? "text-yellow-400/50"
                : "text-[#C9A84C]/50"
              }`}>{v}</span>
            </span>
          ))}
        </div>
      )}

      {/* Error message — PiP or Auto PiP, hidden in fullscreen / while minimized */}
      {pipError && !isFullscreen && !isMinimized && (
        <div className="px-4 py-2 border-t border-red-500/20 bg-red-500/[0.06] text-[10px] text-red-400 font-mono flex items-start gap-1.5">
          <AlertCircle className="h-3 w-3 shrink-0 mt-px" />
          <span>{pipError}</span>
        </div>
      )}
      </div>
      </div>
      {/* ── end inner (rounded, clipped) layer ── */}

      {/* ── Resize handle — drag to grow/shrink; aspect ratio stays locked to export format ── */}
      {!isFullscreen && !isMinimized && !isHidden && (
        <div
          onPointerDown={handleResizeStart}
          data-testid="master-player-resize-handle"
          title={t("videoEditor.dragToResize")}
          className={`absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize flex items-end justify-end p-0.5 ${
            isResizingFloat ? "opacity-100" : "opacity-40 hover:opacity-90"
          } transition-opacity`}
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 1 L1 9 M9 5 L5 9 M9 9 L9 9" />
          </svg>
        </div>
      )}
    </div>
    {/* ── end gold frame ── */}
    </div>
    {/* ── end ambient wrapper ── */}
    </>
  );
}

/* ─────────────────────── [DELETED: LivePreviewPanel] ─────────────────────── */
/* LivePreviewPanel has been removed. The single MasterPreviewPlayer above the
   tab nav is now the sole preview surface. TimelinePreviewPlayer is always kept
   in the DOM (hidden when not on the timeline tab) so audio persists. */


/* ─────────────────────── TAB / MODE BUTTONS ─────────────────────── */

/* ─────────────────────── SAVE INDICATOR ─────────────────────── */

function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useTranslation();
  if (state === "saving") return <span className="flex items-center gap-1.5 text-xs text-white/40"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("videoEditor.saving")}</span>;
  if (state === "saved") return <span className="flex items-center gap-1.5 text-xs text-green-400/80"><Check className="h-3.5 w-3.5" /> {t("videoEditor.saved")}</span>;
  if (state === "unsaved") return <span className="flex items-center gap-1.5 text-xs text-amber-400/90" data-testid="unsaved-indicator"><span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" /> {t("videoEditor.unsavedChanges")}</span>;
  if (state === "error") return <span className="flex items-center gap-1.5 text-xs text-red-400/80"><CloudOff className="h-3.5 w-3.5" /> {t("videoEditor.saveFailed")}</span>;
  return null;
}

/* ─────────────────────── NO PROJECT ─────────────────────── */

function NoProject() {
  const { t } = useTranslation();
  return (
    <div className="py-20 text-center space-y-4">
      <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center mx-auto">
        <Clapperboard className="h-8 w-8 text-white/20" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-white">{t("videoEditor.noProjectSelected")}</h2>
        <p className="text-white/45 max-w-sm mx-auto">{t("videoEditor.noProjectDesc")}</p>
      </div>
      <Link href="/my-projects"><Button className="gold-glow font-semibold gap-2"><ArrowLeft className="h-4 w-4" /> {t("videoEditor.goToMyProjects")}</Button></Link>
    </div>
  );
}
