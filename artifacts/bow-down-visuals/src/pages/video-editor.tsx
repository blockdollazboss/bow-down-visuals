import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useSearch } from "wouter";
import {
  ArrowLeft, Loader2, Clapperboard,
  Check, CloudOff, Save, Film, ListVideo, Music2, Captions, Wand2, Download,
  CheckCircle2, Circle, Layers, Play, Pause,
  RefreshCw, Zap, SkipBack, Maximize, Minimize, PictureInPicture2,
  Volume2, VolumeX, Rewind, FastForward, SkipForward,
  Crop, Smartphone, Monitor, Square, Instagram, ChevronDown, ChevronUp, Bug, Mic2,
  Move, Minimize2, Maximize2, EyeOff, Eye, Sparkles, AlertCircle,
} from "lucide-react";

import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ClipSequencePlayer } from "@/components/ClipSequencePlayer";
import { TimelinePreviewPlayer, type SharedPreviewState, type TimelinePlayerHandle } from "@/components/TimelinePreviewPlayer";
import { parseScenesWithMode, parseScenes, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import {
  normalizeEditorSettings,
  sceneHasClip,
  getClipEdit,
  formatAspectCss,
  formatDimensions,
  FORMAT_PRESET_LABELS,
  VIDEO_FORMATS,
  MASTER_PLAYER_SNAP_POSITIONS,
  MASTER_PLAYER_MIN_WIDTH,
  MASTER_PLAYER_MAX_WIDTH,
  MASTER_PLAYER_DEFAULT_WIDTH,
  MASTER_PLAYER_MIN_HEIGHT,
  type EditorSettings,
  type VideoFormat,
  type FitMode,
  type MasterPlayerSnapPosition,
} from "@/lib/editor-settings";
import { TransitionCompositor, type TransitionState } from "@/components/TransitionCompositor";
import { OverlayLayer } from "@/components/OverlayLayer";
import { ActiveOverlayEffects } from "@/components/ActiveOverlayEffects";
import { ClipGeneratorSection } from "@/components/editor/sections/ClipGeneratorSection";
import { CaptionsSection } from "@/components/editor/sections/CaptionsSection";
import { EffectsSection } from "@/components/editor/sections/EffectsSection";
import { ExportSection } from "@/components/editor/sections/ExportSection";
import { MusicStudio } from "@/components/editor/music/MusicStudio";
import { BrandingSection } from "@/components/editor/sections/BrandingSection";
import { LipSyncSection } from "@/components/editor/sections/LipSyncSection";
import { TimelineSection } from "@/components/editor/sections/TimelineSection";
import { StudioEditorSection } from "@/components/editor/sections/StudioEditorSection";
import { TimelineDock } from "@/components/editor/TimelineDock";
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

type EditorTab = "clips" | "timeline" | "music" | "captions" | "effects" | "branding" | "export" | "lip-sync" | "studio";

/* ── CSS filter maps for effects live preview ── */
const EFFECT_CSS_FILTERS: Record<string, string> = {
  "Film Grain":        "contrast(108%) brightness(97%)",
  "Glow":              "brightness(118%) saturate(140%)",
  "Blur":              "blur(2px)",
  "Sharpen":           "contrast(125%) brightness(103%)",
  "Vignette":          "brightness(82%)",
  "Black & White":     "grayscale(100%)",
  "Neon Glow":         "hue-rotate(270deg) saturate(180%) brightness(115%)",
  "VHS":               "saturate(75%) contrast(112%) hue-rotate(8deg) brightness(92%)",
  "Cinematic Bars":    "brightness(83%) contrast(112%)",
  "Camera Shake":      "contrast(108%) saturate(105%)",
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
  input_data: Record<string, unknown> | null;
  output_data: {
    result?: string;
    scenes?: SceneData[];
    editorSettings?: Partial<EditorSettings>;
    transcriptText?: string;
  } | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function VideoEditor() {
  const search = useSearch();
  const projectId = new URLSearchParams(search).get("project");
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const { activeArtist, consistencyPrompt } = useActiveArtist();
  const { isSimple } = useUserMode();
  /** Simple mode hides the technical/advanced panels behind the top-bar mode toggle;
   *  the underlying settings/tabs are untouched so switching to Advanced reveals everything. */
  const SIMPLE_VISIBLE_TABS: EditorTab[] = ["music", "clips", "timeline", "export"];

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<LoadedProject | null>(null);
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(normalizeEditorSettings(null));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tab, setRawTab] = useState<EditorTab>("clips");
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
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  /** Current rendered height of the bottom TimelineDock (0 when no project is loaded), so the floating
   *  master player's bottom-anchored snap positions can clear it instead of overlapping it. */
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    if (!project) setDockHeight(0);
  }, [project]);
  /** Current rendered height of the sticky top nav bar, so the floating master player's
   *  top-anchored snap positions can clear it instead of overlapping it. */
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
        if (!res.ok) throw new Error(res.status === 404 ? "Project not found" : "Failed to load project");
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
        hydrated.current = true;
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load project");
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

  /* ── Debounced autosave on scenes / settings change ── */
  useEffect(() => {
    if (loading || !project) return;
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(() => { void persist(); }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, settings, loading, project]);

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
        ? { title: "Saved", description: "Editor changes saved to your project." }
        : { title: "Save failed", description: "Could not save your changes. Please try again.", variant: "destructive" },
    );
  }

  async function rebuildScenesFromPlan() {
    console.log("[Rebuild] Rebuild Scenes button clicked");
    console.log("[Rebuild] Project id:", project?.id ?? "none");
    console.log("[Rebuild] Saved project content:", rawResult ? `found (${rawResult.length} chars)` : "MISSING");

    // Show rebuilding state FIRST so the UI responds immediately
    setRebuildStatus("rebuilding");
    setRebuildError(null);

    if (!rawResult) {
      console.log("[Rebuild] No saved plan found — cannot rebuild");
      setRebuildStatus("error");
      setRebuildError("No saved plan found for this project.");
      return;
    }

    try {
      // Try the breakdown section first; fall back to the full result
      let breakdown = extractBreakdownContent(rawResult);
      if (breakdown) {
        console.log("[Rebuild] Scene breakdown found:", `${breakdown.length} chars`);
      } else {
        console.log("[Rebuild] Scene breakdown not found in header — using full plan text as fallback");
        breakdown = rawResult;
      }

      const { scenes: parsed, mode: parseMode } = parseScenesWithMode(breakdown);
      console.log("[Rebuild] Parser mode used:", parseMode);
      console.log("[Rebuild] Number of scenes parsed:", parsed.length);

      if (parsed.length === 0) {
        console.log("[Rebuild] No scenes could be parsed");
        setRebuildStatus("error");
        setRebuildError("Could not find scene breakdown in saved project. The saved plan must contain Timestamp or AI Video Prompt fields for each scene.");
        return;
      }

      // Update the ref BEFORE setScenes so the autosave timer
      // that will fire ~1.2 s later gets the fresh array, not stale []
      scenesRef.current = parsed;
      setScenes(parsed);
      setRebuildStatus("done");

      // ── Hard save immediately (do not rely only on the debounced autosave) ──
      if (project) {
        console.log("[Rebuild] Save started — sending", parsed.length, "scenes to Supabase");
        try {
          const token = await getAccessToken();
          const patchRes = await fetch(`/api/projects/${project.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
            body: JSON.stringify({ scenes: parsed }),
          });
          if (patchRes.ok) {
            console.log("[Rebuild] Save success");
            setSaveState("saved");

            // Verify: re-fetch the project and confirm the scenes are there
            try {
              const verifyToken = await getAccessToken();
              const verifyRes = await fetch(`/api/projects/${project.id}`, {
                headers: { Authorization: `Bearer ${verifyToken ?? ""}` },
              });
              if (verifyRes.ok) {
                const { project: fresh } = (await verifyRes.json()) as { project: LoadedProject };
                const savedCount = fresh.output_data?.scenes?.length ?? 0;
                console.log("[Rebuild] Reload scenes count:", savedCount);
                if (savedCount === 0) {
                  console.log("[Rebuild] WARNING — verify returned 0 scenes even though save reported ok");
                }
              }
            } catch (verErr) {
              console.log("[Rebuild] Could not verify save:", verErr);
            }
          } else {
            const errText = await patchRes.text().catch(() => String(patchRes.status));
            console.log("[Rebuild] Save failed:", patchRes.status, errText);
            toast({
              title: "Scenes rebuilt but save failed",
              description: `Scenes are visible now but may not survive a refresh. Error: ${patchRes.status} — ${errText.slice(0, 120)}`,
              variant: "destructive",
            });
          }
        } catch (saveErr) {
          const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
          console.log("[Rebuild] Save error:", msg);
          toast({
            title: "Scenes rebuilt but save failed",
            description: `Scenes are visible now but may not survive a refresh. ${msg}`,
            variant: "destructive",
          });
        }
      }

      toast({ title: `${parsed.length} scenes rebuilt and saved`, description: "Scene cards are ready. Click Create Video Clip on any scene to generate a Runway clip." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.log("[Rebuild] Unexpected error:", msg);
      setRebuildStatus("error");
      setRebuildError(`Could not parse scenes: ${msg}`);
      toast({ title: "Could not parse scenes", description: msg, variant: "destructive" });
    }
  }

  /* ── Generate scenes straight from the song's audio (no text plan needed) ── */
  async function generateScenesFromSong() {
    if (!previewAudioUrl) return;
    setAutoSceneStatus("generating");
    setAutoSceneError(null);
    try {
      const { scenes: newScenes } = await runAudioSceneFlow({
        lyrics: lyricsForCaptions ?? "",
        audioUrl: previewAudioUrl,
        audioFile: null,
        songStructure: null,
        getAccessToken,
      });
      scenesRef.current = newScenes;
      setScenes(newScenes);
      setAutoSceneStatus("idle");
      toast({ title: `${newScenes.length} scenes generated from your song`, description: "Scene cards are ready. Click Create Video Clip on any scene to generate a Runway clip." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate scenes from this song.";
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
        toast({ title: "Sync failed", description: errMsg, variant: "destructive" });
        return;
      }
      const synced = json.synced ?? 0;
      if (synced === 0) {
        setSyncState("done");
        setSyncMsg(json.message ?? "No new clips to attach.");
        toast({ title: "Nothing to sync", description: json.message ?? "All scenes already have clips or no matching clips were found." });
        return;
      }
      /* Update local scenes state from the server response */
      if (json.scenes && json.scenes.length > 0) {
        scenesRef.current = json.scenes;
        setScenes(json.scenes);
      }
      setSyncState("done");
      setSyncMsg(`Synced ${synced} clip${synced !== 1 ? "s" : ""}.`);
      toast({
        title: `${synced} clip${synced !== 1 ? "s" : ""} synced!`,
        description: "Scenes updated with your generated clips. Clip Ready will now appear.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSyncState("error");
      setSyncMsg(msg);
      toast({ title: "Sync failed", description: msg, variant: "destructive" });
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
    ? AUDIO_EXPORT_BUTTONS.find((button) => button.id === missingMixExportType)?.label ?? "Render mix"
    : "Render mix";

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
      title: "Character consistency applied!",
      description: `Consistency prompt added to ${scenes.length} scene prompt${scenes.length !== 1 ? "s" : ""}.`,
    });
  }

  /* ── Context-aware tips for the Help Panel ── */
  const helpTips = [
    !previewScene && scenes.length > 0
      ? "You have scenes but no clip is selected. Click Preview on any scene in the Clips tab."
      : null,
    !audioUrl && settings.musicStudio.stems.length === 0
      ? "No audio loaded yet. Go to the Music tab and upload your song."
      : null,
    settings.captions.lines.length === 0
      ? "No captions yet. Go to Captions and click Generate Captions From Lyrics."
      : null,
    settings.effects.length > 0
      ? `${settings.effects.length} effect${settings.effects.length !== 1 ? "s" : ""} selected. Check the Effects tab to see the live CSS preview.`
      : "No effects selected. Go to Effects and pick a color grade or look.",
    approvedCount > 0
      ? `${approvedCount} clip${approvedCount !== 1 ? "s" : ""} approved. Go to Export when you are ready.`
      : "No clips approved yet. Approve clips in the Clips tab to build your timeline.",
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar onHeightChange={setHeaderHeight} />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-yellow-600/[0.07] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-5 md:px-8 py-8 md:py-12 pb-40">
        <Link href="/my-projects" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-6 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Projects
        </Link>

        {!projectId ? (
          <NoProject />
        ) : loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        ) : loadError ? (
          <div className="py-20 text-center space-y-3">
            <p className="text-red-400 font-semibold">{loadError}</p>
            <Link href="/my-projects"><Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">Back to Projects</Button></Link>
          </div>
        ) : (
          <>
            {/* Header — full width */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Clapperboard className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-black text-white tracking-tight">Video Editor</h1>
                  <p className="text-sm text-white/40">{project?.title || "Untitled project"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <SaveIndicator state={saveState} />
                <Button onClick={saveNow} size="sm" variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2" data-testid="btn-save-editor">
                  <Save className="h-4 w-4" /> Save
                </Button>
              </div>
            </div>

            {/* Status checklist — full width */}
            <StatusChecklist
              planLoaded={scenes.length > 0}
              sceneCount={scenes.length}
              clipsLoaded={scenes.some((s) => sceneHasClip(s))}
              audioLoaded={!!audioUrl || settings.musicStudio.stems.length > 0}
              timelineReady={scenes.some((s) => s.approved && sceneHasClip(s))}
              exportReady={scenes.some((s) => s.approved && sceneHasClip(s))}
            />

            {/* ── Two-column layout: sticky player left · scrollable tabs right ── */}
            <div className="flex flex-col lg:flex-row gap-6 lg:items-start">

              {/* LEFT: sticky master player column */}
              <div className="w-full lg:w-[50%] lg:sticky lg:top-[76px] lg:self-start shrink-0 space-y-3">

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
                      🔒 Locked
                    </div>
                  )}
                </div>
              );
            })()}

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

            {selectedMixMissing && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07]"
                data-testid="video-audio-fallback-warning"
              >
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-amber-300">Video audio fallback active</p>
                  <p className="text-[11px] text-amber-200/65 mt-0.5 leading-relaxed">
                    {VIDEO_AUDIO_SOURCE_LABELS[settings.musicStudio.videoAudio.source]} is selected, but it has not been rendered yet.
                    Preview and export are using{" "}
                    {previewAudioResolution.fallbackSource === "project-audio"
                      ? "the uploaded song"
                      : previewAudioResolution.fallbackSource === "first-stem"
                      ? "the first uploaded stem"
                      : "no audio"}{" "}
                    instead.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={requestMissingMixRender}
                  disabled={directAudioExportStatus.status === "rendering"}
                  data-testid="btn-render-missing-video-audio"
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 underline hover:text-amber-200 transition-colors disabled:opacity-60 disabled:no-underline"
                >
                  {directAudioExportStatus.status === "rendering" ? (
                    <><Loader2 className="h-3 w-3 animate-spin no-underline" /> Rendering…</>
                  ) : canDirectRenderMissingMix ? (
                    "Render mix"
                  ) : (
                    "Open Music Studio"
                  )}
                </button>
                {directAudioExportStatus.status === "error" &&
                  directAudioExportStatus.exportType === missingMixExportType && (
                    <p className="basis-full text-[10px] text-red-300/85 mt-1">
                      {directAudioExportStatus.message}
                    </p>
                  )}
              </div>
            )}

            {/* ── Collapsible Debug Panel — below master player, collapsed by default ── */}
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <button
                type="button"
                onClick={() => setDebugOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
              >
                <Bug className="h-3 w-3 text-white/20" />
                <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest flex-1">Debug Panel</span>
                {debugOpen ? <ChevronUp className="h-3 w-3 text-white/20" /> : <ChevronDown className="h-3 w-3 text-white/20" />}
              </button>
              {debugOpen && (
                <div className="px-3 pb-3 border-t border-white/[0.05] pt-2 space-y-0.5">
                  {([
                    ["scenes",         `${scenes.length} total · ${scenes.filter(s => sceneHasClip(s)).length} with clip`],
                    ["audio url",      previewAudioUrl ? "loaded ✓" : "none"],
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
                    ["playing",           previewEngineState?.isPlaying ? "yes ✓" : "no"],
                    ["transport synced",  "yes ✓"],
                    ["save state",        saveState],
                    ["master player",     "connected ✓"],
                    ["timeline",          "connected ✓"],
                    ["export order",      "timeline order ✓"],
                    ["lip sync enabled",  settings.lipSync.enabled ? "yes" : "no"],
                    ["lip sync selected", settings.lipSync.selectedSceneId ? `scene ${scenes.findIndex(s => s.id === settings.lipSync.selectedSceneId) + 1}` : "none"],
                    ["lip sync audio",    settings.lipSync.audioSource],
                    ["lip sync provider", (import.meta.env.VITE_LIP_SYNC_API_KEY as string | undefined) ? "connected ✓" : "not connected"],
                    ["lip sync done",     `${scenes.filter(s => getClipEdit(settings, s.id).lipSyncStatus === "done").length} / ${scenes.length}`],
                    ["lip sync result",   (() => { const ce = settings.lipSync.selectedSceneId ? getClipEdit(settings, settings.lipSync.selectedSceneId) : null; return ce?.lipSyncUrl ? "saved ✓" : "none"; })()],
                    ["lip sync error",    (() => { const ce = settings.lipSync.selectedSceneId ? getClipEdit(settings, settings.lipSync.selectedSceneId) : null; return ce?.lipSyncError?.slice(0, 40) ?? "—"; })()],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-mono text-white/25">{label}</span>
                      <span className={`text-[9px] font-bold shrink-0 ${
                        value.includes("✓") ? "text-green-400/70"
                          : value === "none" || value === "no" || value === "unknown" ? "text-white/25"
                          : "text-[#C9A84C]/70"
                      }`}>{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

              </div>{/* /left-panel */}

              {/* RIGHT: scrollable tabs column */}
              <div className="flex-1 min-w-0">

            {/* Tab nav — ordered as a guided flow: song → scenes → arrange → polish → export */}
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] mb-6">
              <TabButton step={1} active={tab === "music"} onClick={() => setTab("music")} icon={<Music2 className="h-4 w-4" />} label="Song" testId="tab-music" />
              <TabButton step={2} active={tab === "clips"} onClick={() => setTab("clips")} icon={<Film className="h-4 w-4" />} label="Clips" testId="tab-clips" />
              <TabButton step={3} active={tab === "timeline"} onClick={() => setTab("timeline")} icon={<ListVideo className="h-4 w-4" />} label="Timeline" testId="tab-timeline" />
              {!isSimple && (
                <>
                  <TabButton step={4} active={tab === "captions"} onClick={() => setTab("captions")} icon={<Captions className="h-4 w-4" />} label="Captions" testId="tab-captions" />
                  <TabButton step={5} active={tab === "effects"} onClick={() => setTab("effects")} icon={<Wand2 className="h-4 w-4" />} label="Effects" testId="tab-effects" />
                  <TabButton step={6} active={tab === "branding"} onClick={() => setTab("branding")} icon={<Layers className="h-4 w-4" />} label="Branding" testId="tab-branding" />
                  <TabButton step={7} active={tab === "lip-sync"} onClick={() => setTab("lip-sync")} icon={<Mic2 className="h-4 w-4" />} label="Lip Sync" testId="tab-lip-sync" />
                </>
              )}
              <TabButton step={isSimple ? 4 : 8} active={tab === "export"} onClick={() => setTab("export")} icon={<Download className="h-4 w-4" />} label="Export" testId="tab-export" />
              {!isSimple && (
                <>
                  <div className="w-px self-stretch bg-white/[0.08] mx-1" aria-hidden="true" />
                  <TabButton active={tab === "studio"} onClick={() => setTab("studio")} icon={<Clapperboard className="h-4 w-4" />} label="Advanced" testId="tab-studio" />
                </>
              )}
            </div>

            {/* ── Timeline tab — always in DOM so audio keeps playing across tab switches ── */}
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
              <TimelineSection
                scenes={scenes}
                settings={settings}
                setSettings={setSettings}
                onPreviewTransition={handlePreviewTransition}
                onGoToClips={() => setTab("clips")}
                onGoToEffects={() => setTab("effects")}
                isSimple={isSimple}
              />
            )}

            {tab === "clips" && (
                  <div className="space-y-6">
                    {/* Apply consistency banner */}
                    {consistencyPrompt && scenes.length > 0 && (
                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/25 bg-primary/[0.06]">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-primary">Character Consistency Lock is active</p>
                          <p className="text-[10px] text-white/40 mt-0.5">
                            {activeArtist ? `${activeArtist.artist_name}'s consistency prompt will be added to all scene prompts.` : "A consistency prompt is saved."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={applyConsistencyToAllScenes}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Apply to All Scenes
                        </button>
                      </div>
                    )}
                    {/* Generate Scenes From Song — surfaced when there's no saved plan to rebuild
                        from, but the song's audio + lyrics are already available. */}
                    {scenes.length === 0 && !rawResult && (
                      previewAudioUrl && lyricsForCaptions && lyricsForCaptions.trim().length > 10 ? (
                        <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-primary shrink-0" /> Generate scenes from your song
                            </p>
                            <p className="text-xs text-white/40 mt-0.5">
                              We'll analyze your song's structure and beats to build a timed scene list automatically — no text plan needed.
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
                              ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating scenes…</>
                              : <><Clapperboard className="h-4 w-4" /> Generate Scenes From Song</>}
                          </button>
                          {autoSceneStatus === "error" && autoSceneError && (
                            <p className="text-xs text-red-400/80 basis-full">{autoSceneError}</p>
                          )}
                        </div>
                      ) : !previewAudioUrl ? (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white/60">No song loaded yet</p>
                            <p className="text-[10px] text-white/35 mt-0.5">Add your song in the Song tab first, then come back here to build scenes.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setTab("music")}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors"
                          >
                            <Music2 className="h-3.5 w-3.5" /> Go to Song
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
                              <p className="text-xs font-bold text-amber-400">No scenes loaded — saved plan found</p>
                              <p className="text-[10px] text-white/40 mt-0.5">This project has a saved video plan. Click "Rebuild Scenes" to parse scene cards from it.</p>
                            </>
                          ) : rebuildStatus === "done" ? (
                            <>
                              <p className="text-xs font-bold text-green-400">{scenes.length} scenes loaded from saved plan</p>
                              <p className="text-[10px] text-white/40 mt-0.5">Scenes parsed from your saved video plan and saved automatically.</p>
                            </>
                          ) : rebuildStatus === "error" ? (
                            <>
                              <p className="text-xs font-bold text-red-400">Could not parse scenes</p>
                              <p className="text-[10px] text-white/40 mt-0.5">{rebuildError ?? "The saved plan may not include a scene-by-scene breakdown."}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-xs font-bold text-white/50">Saved plan available</p>
                              <p className="text-[10px] text-white/35 mt-0.5">Re-parse scene cards from the saved video plan text.</p>
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
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Rebuilding…</>
                          ) : (
                            <><RefreshCw className="h-3.5 w-3.5" /> Rebuild Scenes</>
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
                          title="Scan your generated clips and attach any matching ones to scenes that are missing a clip — no credits charged"
                        >
                          {syncState === "syncing" ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…</>
                          ) : (
                            <><Zap className="h-3.5 w-3.5" /> Sync Missing Clips</>
                          )}
                        </button>
                      </div>
                    )}

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
                    />
                  </div>
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
              />
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

            {tab === "export" && (
              <ExportSection
                scenes={scenes}
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
              />
            )}

            {tab === "studio" && (
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
            )}

              </div>{/* /right-panel */}
            </div>{/* /two-col */}
          </>
        )}
      </div>

      {project && (
        <TimelineDock
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
        />
      )}
    </div>
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
    cs.animation === "fade"      ? "bdv-caption-fade"
    : cs.animation === "pop"     ? "bdv-caption-pop"
    : cs.animation === "bounce"  ? "bdv-caption-bounce"
    : cs.animation === "slide-up" ? "bdv-caption-slide-up"
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
  };

  const ps = presets[cs.stylePreset] ?? presets["clean-white"]!;
  return { containerStyle, wrapperStyle: ps.wrapperStyle, textStyle: { fontSize, ...ps.textStyle }, animClass, maxWidth };
}

/** Icon shown on the Aspect Ratio cycle button for each format. */
const FORMAT_ICONS_MAP: Record<VideoFormat, React.ReactNode> = {
  "9:16":  <Smartphone className="h-3.5 w-3.5" />,
  "16:9":  <Monitor   className="h-3.5 w-3.5" />,
  "1:1":   <Square    className="h-3.5 w-3.5" />,
  "4:5":   <Instagram className="h-3.5 w-3.5" />,
};

/** Ordered list for Aspect Ratio cycling. */
const CYCLE_FORMATS: VideoFormat[] = ["9:16", "16:9", "1:1", "4:5"];

/** Ordered list for Fit Mode cycling. */
const CYCLE_FIT_MODES: FitMode[] = ["fill", "fit", "blur"];

/** Edge margin (px) for floating snap anchors, and the fixed width of the minimized chip. */
const FLOAT_PLAYER_MARGIN = 16;
const MINIMIZED_CHIP_WIDTH = 96;

function floatPlayerAspect(fmt: VideoFormat): number {
  switch (fmt) {
    case "16:9": return 16 / 9;
    case "1:1": return 1;
    case "4:5": return 4 / 5;
    case "9:16":
    default: return 9 / 16;
  }
}

/** Pixel rect (top/left) for a given snap anchor, given the floating box's fixed size.
 *  `bottomSafeArea` (e.g. the TimelineDock's height) is subtracted from bottom-anchored
 *  positions so the floating box clears other fixed bottom chrome instead of overlapping it.
 *  `topSafeArea` (the sticky top nav bar's height) is added to top-anchored positions so the
 *  floating box always renders fully below the header instead of overlapping/hiding behind it.
 *  Every returned `top` — including the vertically-centered anchors — is clamped to the
 *  [topSafeArea, bottomSafeArea] band so the player can NEVER render under the top toolbar or
 *  over the timeline dock, regardless of anchor or aspect ratio. Callers are responsible for
 *  keeping `h` at or below the available band height (see `floatWidth` sizing in
 *  MasterPreviewPlayer) — this function only positions the box, it cannot shrink it. */
function getSnapAnchorRect(pos: MasterPlayerSnapPosition, w: number, h: number, bottomSafeArea = 0, topSafeArea = 0): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;
  const m = FLOAT_PLAYER_MARGIN;
  const minTop = m + topSafeArea;
  const maxTop = Math.max(minTop, vh - h - m - bottomSafeArea);
  const midX = (vw - w) / 2;
  const midY = Math.min(maxTop, Math.max(minTop, (vh - h) / 2));
  const quarterLeft = vw * 0.25 - w / 2;
  const quarterRight = vw * 0.75 - w / 2;
  const top = minTop;
  const bottom = maxTop;
  switch (pos) {
    case "top-left": return { top, left: m };
    case "top-left-quarter": return { top, left: quarterLeft };
    case "top-center": return { top, left: midX };
    case "top-right-quarter": return { top, left: quarterRight };
    case "top-right": return { top, left: vw - w - m };
    case "right-center": return { top: midY, left: vw - w - m };
    case "bottom-right": return { top: bottom, left: vw - w - m };
    case "bottom-right-quarter": return { top: bottom, left: quarterRight };
    case "bottom-center": return { top: bottom, left: midX };
    case "bottom-left-quarter": return { top: bottom, left: quarterLeft };
    case "bottom-left": return { top: bottom, left: m };
    case "left-center": return { top: midY, left: m };
  }
}

/** Finds the nearest of the 12 fixed snap anchors to a given (top, left) position. */
function findNearestSnapPosition(pos: { top: number; left: number }, w: number, h: number, bottomSafeArea = 0, topSafeArea = 0): MasterPlayerSnapPosition {
  let best: MasterPlayerSnapPosition = MASTER_PLAYER_SNAP_POSITIONS[0]!;
  let bestDist = Infinity;
  for (const candidate of MASTER_PLAYER_SNAP_POSITIONS) {
    const rect = getSnapAnchorRect(candidate, w, h, bottomSafeArea, topSafeArea);
    const dist = (rect.top - pos.top) ** 2 + (rect.left - pos.left) ** 2;
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  return best;
}

/** Short badge label shown on the Fit Mode button. */
const FIT_BADGE: Record<FitMode, string> = { fill: "FILL", fit: "FIT", blur: "BLUR" };

/** Toast-friendly label for each Fit Mode. */
const FIT_TOAST: Record<FitMode, string> = {
  fill: "Fill / Crop",
  fit:  "Fit / Letterbox",
  blur: "Blur Background Fill",
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
  const containerRef  = useRef<HTMLDivElement | null>(null);
  const chromeHeaderRef = useRef<HTMLDivElement | null>(null);
  const chromeFooterRef = useRef<HTMLDivElement | null>(null);
  const [chromeHeight, setChromeHeight] = useState(0);
  const [isFullscreen,       setIsFullscreen      ] = useState(false);
  const [pipActive,          setPipActive         ] = useState(false);
  const [pipError,           setPipError          ] = useState<string | null>(null);
  const blurVideoRef = useRef<HTMLVideoElement | null>(null);

  /* ── Master player: always floating (no docked/inline mode), draggable, snaps to
   *    nearest of 12 anchors on release. Fullscreen replaces the floating chrome
   *    entirely; minimize/hide are independent presentation states on top of it. ── */
  const isFloating = !isFullscreen;
  const isMinimized = !!settings.masterPlayerMinimized && !isFullscreen;
  const isHidden = !!settings.masterPlayerHidden && !isFullscreen;
  const aspect = floatPlayerAspect((settings.export.format ?? "9:16") as VideoFormat);

  const [isDraggingFloat, setIsDraggingFloat] = useState(false);
  const [floatDragPos, setFloatDragPos] = useState<{ top: number; left: number } | null>(null);
  const floatDragOffsetRef = useRef({ dx: 0, dy: 0 });

  const [isResizingFloat, setIsResizingFloat] = useState(false);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const resizeStartRef = useRef({ startX: 0, startWidth: 0 });

  /* ── Recompute the floating anchor whenever the browser window itself is resized.
   *    getSnapAnchorRect() reads window.innerWidth/innerHeight at render time, so without
   *    this listener a viewport resize (e.g. rotating a device, resizing the browser)
   *    would leave the master player positioned against stale viewport dimensions —
   *    on a short viewport that can make it overlap the bottom TimelineDock. ── */
  const [, forceViewportRecalc] = useState(0);
  useEffect(() => {
    const onResize = () => forceViewportRecalc((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const savedWidth = Math.min(MASTER_PLAYER_MAX_WIDTH, Math.max(MASTER_PLAYER_MIN_WIDTH, settings.masterPlayerSize || MASTER_PLAYER_DEFAULT_WIDTH));
  const rawFloatWidth = isMinimized ? MINIMIZED_CHIP_WIDTH : (resizeWidth ?? savedWidth);
  /* The vertical band the player is allowed to occupy — strictly between the top toolbar and
   * the timeline dock, with the usual float margin on both ends. `chromeHeight` (the drag-handle
   * header + transport rows measured live below) is subtracted so it's the VIDEO height that's
   * bounded, not just the whole float box, matching how `floatTotalHeight` is computed below. */
  const availableBandHeight = typeof window !== "undefined"
    ? Math.max(1, window.innerHeight - headerHeight - dockHeight - FLOAT_PLAYER_MARGIN * 2 - chromeHeight)
    : Infinity;
  /* For wide/landscape formats (e.g. 16:9), the stored width alone can produce a very short,
   * easy-to-miss player (260px wide -> ~146px tall). Grow the effective width so the rendered
   * height never drops below MASTER_PLAYER_MIN_HEIGHT, capped at MASTER_PLAYER_MAX_WIDTH so it
   * never overflows past the normal max footprint. It's also capped by `availableBandHeight` —
   * converted to an equivalent max width via the locked aspect ratio — so the player's rendered
   * size can never be taller than the space between the top toolbar and the timeline dock,
   * regardless of aspect ratio (a portrait 9:16 player at a wide width can otherwise be taller
   * than a short viewport's usable vertical band). */
  const maxWidthForBand = Math.max(MASTER_PLAYER_MIN_WIDTH, availableBandHeight * aspect);
  const floatWidth = isMinimized
    ? rawFloatWidth
    : Math.min(MASTER_PLAYER_MAX_WIDTH, maxWidthForBand, Math.max(rawFloatWidth, MASTER_PLAYER_MIN_HEIGHT * aspect));
  const floatHeight = Math.round(floatWidth / aspect);

  const toggleMinimize = () => {
    setSettings({ ...settings, masterPlayerMinimized: !settings.masterPlayerMinimized });
  };
  const toggleHidden = () => {
    setSettings({ ...settings, masterPlayerHidden: !settings.masterPlayerHidden });
  };

  const handleFloatDragStart = (e: React.PointerEvent) => {
    if (!isFloating || isHidden) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    floatDragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setFloatDragPos({ top: rect.top, left: rect.left });
    setIsDraggingFloat(true);
  };

  useEffect(() => {
    if (!isDraggingFloat) return;
    const onMove = (e: PointerEvent) => {
      const left = Math.min(Math.max(e.clientX - floatDragOffsetRef.current.dx, 0), window.innerWidth - floatWidth);
      const top = Math.min(Math.max(e.clientY - floatDragOffsetRef.current.dy, 0), window.innerHeight - (floatHeight + chromeHeight));
      setFloatDragPos({ top, left });
    };
    const onUp = () => {
      setIsDraggingFloat(false);
      setFloatDragPos((pos) => {
        if (pos) {
          const nearest = findNearestSnapPosition(pos, floatWidth, floatHeight + chromeHeight, dockHeight, headerHeight);
          setSettings({ ...settings, masterPlayerSnapPosition: nearest });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDraggingFloat, floatWidth, floatHeight, chromeHeight, settings, setSettings, dockHeight, headerHeight]);

  /* ── Resize: drag the bottom-right handle to grow/shrink the floating player,
   *    the aspect ratio is always locked to the project's export format. ── */
  const handleResizeStart = (e: React.PointerEvent) => {
    if (!isFloating || isMinimized || isHidden) return;
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

  /* Total on-screen footprint = the video's own target height (floatHeight) PLUS the
   * natural height of the surrounding chrome (drag-handle header + transport rows below),
   * measured live via ResizeObserver. Without this, a fixed container height equal to just
   * floatHeight would force the flex layout to steal space from — and can collapse to
   * zero — the video canvas to make room for the header/controls. */
  const floatTotalHeight = floatHeight + chromeHeight;
  const floatAnchorRect = getSnapAnchorRect(settings.masterPlayerSnapPosition, floatWidth, floatTotalHeight, dockHeight, headerHeight);
  const floatStyle: React.CSSProperties | undefined = isFloating
    ? {
        position: "fixed",
        top: isHidden ? -9999 : (floatDragPos ? floatDragPos.top : floatAnchorRect.top),
        left: isHidden ? -9999 : (floatDragPos ? floatDragPos.left : floatAnchorRect.left),
        width: floatWidth,
        height: floatTotalHeight,
        zIndex: 60,
        transition: (floatDragPos || isResizingFloat || isHidden) ? "none" : "top 0.2s ease, left 0.2s ease, width 0.15s ease, height 0.15s ease",
        pointerEvents: isHidden ? "none" : undefined,
        visibility: isHidden ? "hidden" : "visible",
      }
    : undefined;

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
    toast({ description: `Fit Mode: ${FIT_TOAST[next]}`, duration: 2000 });
  };

  /* ── Transport: volume / mute / speed ── */
  const [volume,   setVolume  ] = useState(1);
  const [muted,    setMuted   ] = useState(false);
  const [speed,    setSpeed   ] = useState(1);

  /* ── Transport: scrubable progress bar ── */
  const scrubRef        = useRef<HTMLDivElement | null>(null);
  const isDraggingRef   = useRef(false);

  /* ── Auto PiP state — default ON, persisted to localStorage ── */
  const [autoPiP,            setAutoPiP           ] = useState<boolean>(() => {
    try { const s = localStorage.getItem("bdv:autoPiP"); return s === null ? true : s === "true"; }
    catch { return true; }
  });
  const [enterOnScroll,      setEnterOnScroll     ] = useState(true);
  const [keepOnTabSwitch,    setKeepOnTabSwitch   ] = useState(true);

  /* ── Measure the actual rendered height of the header + footer chrome (drag handle,
   *    transport rows, etc.) so the outer floating container's fixed height can add this
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
  }, [isFloating, isMinimized, isFullscreen, autoPiP, pipError]);
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

  /* ── Blur-bg video sync — mirrors liveVideoRef src/time when fitMode=blur ── */
  const fitMode = settings.export.fitMode ?? "fill";
  useEffect(() => {
    if (fitMode !== "blur") return;
    const main = liveVideoRef.current;
    const blur = blurVideoRef.current;
    if (!main || !blur) return;

    const syncSrc = () => {
      if (blur.src !== main.src) {
        blur.src = main.src;
        blur.load();
      }
    };
    syncSrc();
    main.addEventListener("emptied", syncSrc);
    main.addEventListener("loadedmetadata", syncSrc);

    let raf: number;
    const syncTime = () => {
      if (blur.readyState >= 2 && Math.abs(blur.currentTime - main.currentTime) > 0.15) {
        blur.currentTime = main.currentTime;
      }
      if (main.paused !== blur.paused) {
        if (main.paused) blur.pause();
        else             blur.play().catch(() => { /* ignore */ });
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
  const enterOnScrollRef    = useRef(true);
  const keepOnTabSwitchRef  = useRef(true);
  const isPlayingRef        = useRef(false);
  const prevTabRef          = useRef<EditorTab>(tab);
  const wasPlayingRef       = useRef(false);
  const engRef              = useRef<SharedPreviewState | null>(null);

  useEffect(() => { autoPiPRef.current         = autoPiP;               }, [autoPiP]);
  useEffect(() => { enterOnScrollRef.current   = enterOnScroll;         }, [enterOnScroll]);
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
              setPipError(`Could not resume after PiP: ${e instanceof Error ? e.message : String(e)}`);
              setPlaybackRestored(false);
            });
        } else {
          setPlaybackRestored(true);
        }
      }
    };

    /* visibilitychange — enter PiP when browser is hidden */
    const onVisibility = () => {
      const hidden = document.hidden;
      setDocHidden(hidden);
      if (hidden && autoPiPRef.current && !document.pictureInPictureElement && !v.paused) {
        v.requestPictureInPicture().catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setPipError(`Browser blocked automatic PiP. Click Enable Auto PiP again. (${msg})`);
        });
      }
      /* When returning visible: leavepictureinpicture fires naturally; playback is restored there */
    };

    /* pagehide / pageshow */
    const onPageHide = () => {
      setDocHidden(true);
      if (autoPiPRef.current && !document.pictureInPictureElement && !v.paused) {
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
      if (autoPiPRef.current && !document.pictureInPictureElement && !v.paused) {
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

  /* Auto PiP — IntersectionObserver: enter PiP when player scrolls out of view */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pipSupported) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (
        !entry?.isIntersecting &&
        autoPiPRef.current &&
        enterOnScrollRef.current &&
        isPlayingRef.current &&
        !document.pictureInPictureElement
      ) {
        liveVideoRef.current?.requestPictureInPicture().catch((e) => {
          setPipError(`Auto PiP: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    }, { threshold: 0.15 });
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipSupported]);

  /* Auto PiP — editor-tab switch */
  useEffect(() => {
    if (
      prevTabRef.current !== tab &&
      autoPiPRef.current &&
      keepOnTabSwitchRef.current &&
      isPlayingRef.current &&
      pipSupported &&
      !document.pictureInPictureElement
    ) {
      liveVideoRef.current?.requestPictureInPicture().catch((e) => {
        setPipError(`Auto PiP: ${e instanceof Error ? e.message : String(e)}`);
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
    if (!pipSupported) { setPipError("Picture-in-Picture is not supported in this browser."); return; }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (e) {
      setPipError(`PiP failed: ${e instanceof Error ? e.message : String(e)}`);
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
      setPipError("Auto PiP needs one click first. Press the PiP button to allow it.");
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
    setSkipDebug({ action: '⏮ prev', before: ct, target, idx, count: offs.length });
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
    setSkipDebug({ action: '⏭ next', before: ct, target, idx, count: offs.length });
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
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTogglePlay, onRestart, prevClip, nextClip, rewind, ff, frameStep, toggleMute, toggleFullscreen]);

  /* ── Effects layer computation ── */
  const activeEffects   = settings.effects;
  const aiEffectsApplied = settings.aiEdit.applied && activeEffects.length > 0;

  const effectsCssFilter = testEffectActive
    ? "grayscale(100%)"
    : buildEffectFilter(activeEffects);

  const effectsTransform = testEffectActive ? "scale(1.25)" : undefined;

  const overlayColor = testEffectActive
    ? "rgba(220,30,30,0.55)"
    : null;

  const testText = testEffectActive ? "EFFECT TEST ACTIVE" : null;

  return (
    <>
      {/* Persistent affordance to bring the player back once it's been hidden off-screen. */}
      {isHidden && (
        <button
          type="button"
          onClick={toggleHidden}
          data-testid="master-player-show-tab"
          title="Show master player"
          style={{ position: "fixed", top: floatAnchorRect.top, left: floatAnchorRect.left, zIndex: 61 }}
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-black/90 border border-white/20 text-white/70 hover:text-white hover:border-primary/50 shadow-2xl transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Show Player</span>
        </button>
      )}
    <div
      ref={containerRef}
      onMouseMove={showControls}
      className={`overflow-hidden ${isFloating ? "" : "mb-6"} ${
        isFullscreen
          ? "bg-black flex flex-col"
          : `rounded-2xl border shadow-2xl flex flex-col ${isDraggingFloat ? "border-primary/60 cursor-grabbing" : "border-white/[0.15] bg-black"}`
      }`}
      style={floatStyle}
    >
      {isFloating && (
        <div
          ref={chromeHeaderRef}
          onPointerDown={handleFloatDragStart}
          className="flex items-center justify-between px-2 py-1 bg-black/80 border-b border-white/[0.1] cursor-grab active:cursor-grabbing select-none shrink-0"
          title="Drag to reposition — release to snap"
        >
          <span className="flex items-center gap-1 text-[9px] font-bold text-white/50 uppercase tracking-wider">
            <Move className="h-3 w-3" /> {!isMinimized && "Master Player"}
          </span>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleMinimize}
              data-testid="master-player-minimize-toggle"
              title={isMinimized ? "Restore master player" : "Minimize master player"}
              className="flex items-center justify-center h-5 w-5 rounded text-white/50 hover:text-white hover:bg-white/[0.1] transition-colors"
            >
              {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleHidden}
              data-testid="master-player-hide-toggle"
              title="Hide master player"
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
        className="bg-black relative overflow-hidden shrink-0 [container-type:size]"
        style={{ aspectRatio: arCss, height: isFullscreen ? "100%" : floatHeight, maxWidth: "100%" }}
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

        {/* ── Effects-wrapped video layer — filter + zoom applied here only ── */}
        <div
          className="absolute inset-0"
          style={{
            filter: effectsCssFilter || undefined,
            transform: effectsTransform,
            transformOrigin: "center center",
            transition: "filter 0.3s ease, transform 0.4s ease",
            zIndex: 1,
          }}
        >
          <MasterVideoElement videoRef={liveVideoRef} fitMode={fitMode} />
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

        {/* No-clip placeholder — over the (empty) video */}
        {!clipLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/20 pointer-events-none">
            <Film className="h-12 w-12" />
            <p className="text-sm font-medium text-center px-6">
              {scenes.length === 0
                ? "Generate scenes to preview"
                : eng
                  ? "Active scene has no clip — audio still playing"
                  : "Click Preview on a clip card, or press Play to start"}
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
            }}>Caption Safe Area</span>
          </div>
        )}

        {/* Caption overlay — styled from captionSettings */}
        {activeCaption && (() => {
          const { containerStyle, wrapperStyle, textStyle, animClass, maxWidth } = buildCaptionOverlayStyle(captionSettings);
          const lineClamp = Number(captionSettings.maxLines ?? "2");
          return (
            <div className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ ...containerStyle, zIndex: 27 }}>
              <div
                key={activeCaption.id}
                className={`text-center leading-snug ${animClass}`}
                style={{ ...wrapperStyle, maxWidth }}
                data-testid="master-caption-text"
              >
                <span style={{
                  ...textStyle,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: lineClamp,
                  overflow: "hidden",
                  wordBreak: "break-word",
                  overflowWrap: "break-word",
                }}>{activeCaption.text}</span>
              </div>
            </div>
          );
        })()}

        {/* Scene badge — top-left */}
        {displayScene && displaySceneIdx >= 0 && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/70 border border-white/10 backdrop-blur-sm pointer-events-none">
            <Film className="h-3 w-3 text-primary/60" />
            <span className="text-[10px] font-bold text-white/70 max-w-[200px] truncate">
              Scene {displaySceneIdx + 1}/{scenes.length}
              {displayScene.section ? ` · ${displayScene.section}` : ""}
            </span>
          </div>
        )}

        {/* Playing indicator / audio status — top-right */}
        {isPlaying ? (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <Volume2 className="h-3 w-3 text-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">Live</span>
          </div>
        ) : eng && !isPlaying ? (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 border border-white/10 backdrop-blur-sm pointer-events-none">
            <span className="text-[10px] font-bold text-white/50">Paused</span>
          </div>
        ) : null}

        {/* Big play button overlay — not playing, has scenes */}
        {!isPlaying && hasScenes && (
          <button
            type="button"
            onClick={onTogglePlay}
            className="absolute inset-0 flex items-center justify-center"
            aria-label="Start preview"
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
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}>
            {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
        </div>
      )}

      {/* ── Transport bar — PRIMARY ROW (always visible, including fullscreen; hidden while minimized) ── */}
      {!isMinimized && (
      <div className={`flex items-center gap-1.5 px-2.5 py-2 border-t border-white/[0.06] transition-all duration-300 ${
        isFullscreen
          ? `shrink-0 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`
          : ""
      }`}>
        {/* Restart */}
        <button type="button" onClick={onRestart} disabled={!hasScenes}
          className="flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 disabled:opacity-30"
          title="Restart (Home)">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        {/* Prev Clip */}
        <button type="button" onClick={prevClip} disabled={!hasScenes}
          className="flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 disabled:opacity-30"
          title="Previous Scene (Shift+←)">
          <Rewind className="h-3.5 w-3.5" />
        </button>
        {/* Rewind 5s */}
        <button type="button" onClick={() => rewind(5)} disabled={!hasScenes}
          className="flex items-center justify-center h-7 min-w-[1.75rem] px-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-[9px] font-black text-white/50 hover:text-white hover:bg-white/[0.07] transition-colors disabled:opacity-30 tabular-nums"
          title="Rewind 5s (←)">-5</button>
        {/* Play / Pause */}
        <button type="button" onClick={onTogglePlay} disabled={!hasScenes}
          className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 transition-colors text-primary disabled:opacity-30 shrink-0"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        {/* FF 5s */}
        <button type="button" onClick={() => ff(5)} disabled={!hasScenes}
          className="flex items-center justify-center h-7 min-w-[1.75rem] px-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-[9px] font-black text-white/50 hover:text-white hover:bg-white/[0.07] transition-colors disabled:opacity-30 tabular-nums"
          title="Forward 5s (→)">+5</button>
        {/* Next Clip */}
        <button type="button" onClick={nextClip} disabled={!hasScenes}
          className="flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 disabled:opacity-30"
          title="Next Scene (Shift+→)">
          <FastForward className="h-3.5 w-3.5" />
        </button>
        {/* Scrubable progress bar */}
        <div
          ref={scrubRef}
          className="relative flex-1 h-3 rounded-full cursor-pointer bg-white/[0.08] group select-none"
          onPointerDown={handleScrubDown}
          onPointerMove={handleScrubMove}
          onPointerUp={handleScrubUp}
          onPointerLeave={handleScrubUp}
        >
          <div className="absolute inset-y-0 left-0 bg-primary/70 rounded-full transition-none pointer-events-none"
            style={{ width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : "0%" }} />
          <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-primary shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: duration > 0 ? `calc(${Math.min(100, (currentTime / duration) * 100)}% - 7px)` : "0" }} />
        </div>
        {/* Timecode */}
        <span className="text-[10px] font-mono text-white/40 tabular-nums shrink-0">
          {fmtSecs(currentTime)} / {fmtSecs(duration || 0)}
        </span>
        {/* Aspect Ratio cycle */}
        <button type="button" onClick={cycleFormat}
          className="flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0"
          title={`Aspect Ratio: ${settings.export.format ?? "9:16"} — click to cycle`}>
          {FORMAT_ICONS_MAP[(settings.export.format ?? "9:16") as VideoFormat]}
        </button>
        {/* Fit Mode cycle */}
        <button type="button" onClick={cycleFitMode}
          className="flex items-center justify-center h-7 min-w-[2rem] px-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0"
          title={`Fit: ${FIT_TOAST[(settings.export.fitMode ?? "fill") as FitMode]} — click to cycle`}>
          <span className="text-[7px] font-black tracking-widest uppercase leading-none">
            {FIT_BADGE[(settings.export.fitMode ?? "fill") as FitMode]}
          </span>
        </button>
        {/* Fullscreen — launches from the floating player */}
        <button type="button" onClick={toggleFullscreen}
          className={`flex items-center justify-center h-7 w-7 rounded-md border transition-colors shrink-0 ${
            isFullscreen
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white hover:bg-white/[0.07]"
          }`}
          title={isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"}>
          {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </button>
      </div>
      )}

      {/* ── Transport bar — EXTENDED ROW (hidden in fullscreen / while minimized) ── */}
      {!isFullscreen && !isMinimized && (
        <div className="flex items-center gap-1.5 px-2.5 pb-2 flex-wrap">
          {/* Rewind 10s */}
          <button type="button" onClick={() => rewind(10)} disabled={!hasScenes}
            className="flex items-center justify-center h-7 min-w-[1.75rem] px-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-[9px] font-black text-white/45 hover:text-white hover:bg-white/[0.07] transition-colors disabled:opacity-30 tabular-nums"
            title="Rewind 10s">-10</button>
          {/* Frame step back */}
          <button type="button" onClick={() => frameStep(-1)} disabled={!hasScenes}
            className="flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/45 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 disabled:opacity-30"
            title="Step 1 Frame Back (,)">
            <SkipBack className="h-3 w-3" />
          </button>
          {/* Frame step forward */}
          <button type="button" onClick={() => frameStep(1)} disabled={!hasScenes}
            className="flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/45 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 disabled:opacity-30"
            title="Step 1 Frame Forward (.)">
            <SkipForward className="h-3 w-3" />
          </button>
          {/* FF 10s */}
          <button type="button" onClick={() => ff(10)} disabled={!hasScenes}
            className="flex items-center justify-center h-7 min-w-[1.75rem] px-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-[9px] font-black text-white/45 hover:text-white hover:bg-white/[0.07] transition-colors disabled:opacity-30 tabular-nums"
            title="Forward 10s">+10</button>
          <span className="w-px h-4 bg-white/[0.08] shrink-0 mx-0.5" />
          {/* Mute */}
          <button type="button" onClick={toggleMute}
            className="flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/50 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0"
            title={muted ? "Unmute (M)" : "Mute (M)"}>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          {/* Volume slider */}
          <input
            type="range" min={0} max={1} step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolume(Number(e.target.value))}
            className="w-16 accent-primary cursor-pointer"
            title={`Volume: ${Math.round((muted ? 0 : volume) * 100)}%`}
          />
          <span className="w-px h-4 bg-white/[0.08] shrink-0 mx-0.5" />
          {/* Playback speed */}
          <button type="button" onClick={cycleSpeed}
            className="flex items-center justify-center h-7 min-w-[2.25rem] px-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[9px] font-black text-white/50 hover:text-white hover:bg-white/[0.07] transition-colors tabular-nums"
            title={`Speed: ${speed}× — click to cycle`}>
            {speed}×
          </button>
          <span className="w-px h-4 bg-white/[0.08] shrink-0 mx-0.5" />
          {/* PiP — one button, manual only; Auto PiP toggled via settings row below */}
          <button type="button" onClick={() => void togglePiP()}
            className={`flex items-center justify-center h-7 w-7 rounded-md border transition-colors shrink-0 ${
              pipActive
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-white/[0.08] bg-white/[0.03] text-white/45 hover:text-white/80"
            }`}
            title={pipActive ? "Exit Picture-in-Picture (P)" : "Picture-in-Picture (P)"}>
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Auto PiP sub-settings — hidden in fullscreen / while minimized */}
      {!isFullscreen && !isMinimized && (
        <div className="px-4 py-2 border-t border-white/[0.06] bg-white/[0.02] flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="text-[10px] font-bold text-white/30 shrink-0">Auto PiP:</span>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoPiP}
              onChange={(e) => { if (e.target.checked) void enableAutoPiP(); else disableAutoPiP(); }}
              className="accent-primary w-3 h-3"
            />
            <span className="text-[10px] text-white/50">Enable Auto PiP</span>
          </label>
          {autoPiP && (<>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enterOnScroll}
                onChange={(e) => setEnterOnScroll(e.target.checked)}
                className="accent-primary w-3 h-3"
              />
              <span className="text-[10px] text-white/50">On scroll</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepOnTabSwitch}
                onChange={(e) => setKeepOnTabSwitch(e.target.checked)}
                className="accent-primary w-3 h-3"
              />
              <span className="text-[10px] text-white/50">On tab switch</span>
            </label>
          </>)}
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
              ["seek used",   "shared ✓"],
            ] as [string, string][] : [
              ["last skip",   "—"],
            ] as [string, string][]),
            ["pip auto",      autoPiP      ? "enabled" : "off"],
            ["pip active",    pipActive    ? "yes ✓"   : "no"],
          ] as [string, string][]).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="text-[8px] font-mono text-white/20">{k}</span>
              <span className={`text-[8px] font-bold ${v.includes("✓") || v === "enabled" ? "text-green-400/50" : v === "—" || v === "no" || v === "off" ? "text-white/20" : "text-[#C9A84C]/50"}`}>{v}</span>
            </span>
          ))}
        </div>
      )}

      {/* Playback Animation Debug — dev-only diagnostics, hidden in fullscreen / while minimized */}
      {import.meta.env.DEV && !isFullscreen && !isMinimized && (
        <div className="px-4 py-1 border-t border-white/[0.04] bg-black/20 flex flex-wrap items-center gap-x-4 gap-y-0.5">
          <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest shrink-0">Anim</span>
          {([
            ["isPlaying",    (eng?.isPlaying ?? false) ? "yes ✓" : "no"],
            ["isScrubbing",  isDraggingRef.current ? "yes" : "no"],
            ["master t",     `${(eng?.currentTime ?? 0).toFixed(2)}s`],
            ["audio t",      `${(eng?.currentTime ?? 0).toFixed(2)}s`],
            ["loops active", (eng?.isPlaying ?? false) ? "yes" : "no"],
            ["overlays",     (eng?.isPlaying ?? false) ? "running" : "paused ✓"],
            ["waveform",     (eng?.isPlaying ?? false) ? "running" : "paused ✓"],
            ["captions",     (eng?.isPlaying ?? false) ? "running" : "paused ✓"],
            ["effects",      (eng?.isPlaying ?? false) ? "running" : "paused ✓"],
          ] as [string, string][]).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="text-[8px] font-mono text-white/20">{k}</span>
              <span className={`text-[8px] font-bold ${
                v.includes("✓") ? "text-green-400/50"
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
          <span className="shrink-0 mt-px">⚠</span>
          <span>{pipError}</span>
        </div>
      )}
      </div>

      {/* ── Resize handle — drag to grow/shrink; aspect ratio stays locked to export format ── */}
      {isFloating && !isMinimized && !isHidden && (
        <div
          onPointerDown={handleResizeStart}
          data-testid="master-player-resize-handle"
          title="Drag to resize"
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
    </>
  );
}

/* ─────────────────────── [DELETED: LivePreviewPanel] ─────────────────────── */
/* LivePreviewPanel has been removed. The single MasterPreviewPlayer above the
   tab nav is now the sole preview surface. TimelinePreviewPlayer is always kept
   in the DOM (hidden when not on the timeline tab) so audio persists. */


/* ─────────────────────── TAB / MODE BUTTONS ─────────────────────── */

function TabButton({
  active, onClick, icon, label, testId, step,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; testId?: string; step?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${
        active ? "bg-primary text-black" : "text-white/50 hover:text-white/80"
      }`}
    >
      {step != null && (
        <span
          className={`flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-black shrink-0 ${
            active ? "bg-black/20 text-black" : "bg-white/10 text-white/50"
          }`}
        >
          {step}
        </span>
      )}
      {icon}
      {label}
    </button>
  );
}

/* ─────────────────────── STATUS CHECKLIST ─────────────────────── */

function StatusChecklist({
  planLoaded, sceneCount, clipsLoaded, audioLoaded, timelineReady, exportReady,
}: {
  planLoaded: boolean; sceneCount: number; clipsLoaded: boolean; audioLoaded: boolean; timelineReady: boolean; exportReady: boolean;
}) {
  const items: { label: string; sub?: string; done: boolean }[] = [
    { label: "Music video plan loaded", sub: planLoaded ? `${sceneCount} scene${sceneCount !== 1 ? "s" : ""} loaded` : undefined, done: planLoaded },
    { label: "Runway clips loaded", done: clipsLoaded },
    { label: "Audio/stems uploaded", done: audioLoaded },
    { label: "Timeline ready", done: timelineReady },
    { label: "Export ready", done: exportReady },
  ];
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 mb-5" data-testid="editor-status-checklist">
      <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-3">Project Status</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {items.map((item) => (
          <div
            key={item.label}
            data-testid={`status-${item.label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
              item.done ? "border-green-500/25 bg-green-500/[0.06]" : "border-white/[0.07] bg-white/[0.02]"
            }`}
          >
            {item.done ? (
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-white/25 shrink-0" />
            )}
            <div className="min-w-0">
              <p className={`text-xs font-semibold leading-tight ${item.done ? "text-white/85" : "text-white/55"}`}>{item.label}</p>
              {item.sub ? (
                <p className="text-[10px] font-bold text-green-400/80 truncate">{item.sub}</p>
              ) : (
                <p className={`text-[10px] font-bold uppercase tracking-wider ${item.done ? "text-green-400/80" : "text-white/30"}`}>{item.done ? "Yes" : "No"}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── SAVE INDICATOR ─────────────────────── */

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="flex items-center gap-1.5 text-xs text-white/40"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>;
  if (state === "saved") return <span className="flex items-center gap-1.5 text-xs text-green-400/80"><Check className="h-3.5 w-3.5" /> Saved</span>;
  if (state === "error") return <span className="flex items-center gap-1.5 text-xs text-red-400/80"><CloudOff className="h-3.5 w-3.5" /> Save failed</span>;
  return null;
}

/* ─────────────────────── NO PROJECT ─────────────────────── */

function NoProject() {
  return (
    <div className="py-20 text-center space-y-4">
      <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center mx-auto">
        <Clapperboard className="h-8 w-8 text-white/20" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-white">No project selected</h2>
        <p className="text-white/45 max-w-sm mx-auto">Choose a saved music video project or generate a music video plan first.</p>
      </div>
      <Link href="/my-projects"><Button className="gold-glow font-semibold gap-2"><ArrowLeft className="h-4 w-4" /> Go to My Projects</Button></Link>
    </div>
  );
}
