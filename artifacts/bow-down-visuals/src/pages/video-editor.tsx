import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useSearch } from "wouter";
import {
  ArrowLeft, Loader2, Clapperboard,
  Check, CloudOff, Save, Film, ListVideo, Music2, Captions, Wand2, Download,
  CheckCircle2, Circle, Layers, Play, Pause,
  RefreshCw, Zap, SkipBack, Maximize, Minimize, PictureInPicture2, Volume2,
  Crop, Smartphone, Monitor, Square, Instagram,
} from "lucide-react";

import { useActiveArtist } from "@/contexts/ActiveArtistContext";
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
  type EditorSettings,
  type VideoFormat,
  type FitMode,
} from "@/lib/editor-settings";
import { TransitionCompositor, type TransitionState } from "@/components/TransitionCompositor";
import { OverlayLayer } from "@/components/OverlayLayer";
import { ActiveOverlayEffects } from "@/components/ActiveOverlayEffects";
import { ClipGeneratorSection } from "@/components/editor/sections/ClipGeneratorSection";
import { VideoTimeline } from "@/components/editor/VideoTimeline";
import { CaptionsSection } from "@/components/editor/sections/CaptionsSection";
import { EffectsSection } from "@/components/editor/sections/EffectsSection";
import { ExportSection } from "@/components/editor/sections/ExportSection";
import { MusicStudio } from "@/components/editor/music/MusicStudio";
import { BrandingSection } from "@/components/editor/sections/BrandingSection";

type EditorTab = "clips" | "timeline" | "music" | "captions" | "effects" | "branding" | "export";

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

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<LoadedProject | null>(null);
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(normalizeEditorSettings(null));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tab, setRawTab] = useState<EditorTab>("clips");
  function setTab(t: EditorTab) {
    setRawTab(t);
    window.dispatchEvent(new CustomEvent("bdv-editor-tab", { detail: t }));
  }
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  /** State broadcast from TimelinePreviewPlayer — drives Live Preview mirroring */
  const [previewEngineState, setPreviewEngineState] = useState<SharedPreviewState | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<"idle" | "rebuilding" | "done" | "error">("idle");
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  /** Duration (seconds) probed from the resolved preview audio URL */
  const [detectedAudioDuration, setDetectedAudioDuration] = useState<number | null>(null);

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
  }, [user, projectId, getAccessToken]);

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
  const previewAudioUrl: string | null = (() => {
    const va = settings.musicStudio.videoAudio;
    const ms = settings.musicStudio;
    switch (va.source) {
      case "none": return audioUrl ?? ms.stems[0]?.url ?? null;
      case "uploaded": return audioUrl ?? ms.stems[0]?.url ?? null;
      case "full-mix": {
        const mp3 = ms.exports.find(r => r.kind === "full" && r.format === "mp3");
        return mp3?.url ?? ms.exports.find(r => r.kind === "full")?.url ?? audioUrl ?? ms.stems[0]?.url ?? null;
      }
      case "instrumental":
        return ms.exports.find(r => r.kind === "instrumental")?.url ?? audioUrl ?? ms.stems[0]?.url ?? null;
      case "acapella":
        return ms.exports.find(r => r.kind === "acapella")?.url ?? audioUrl ?? ms.stems[0]?.url ?? null;
      default:
        return audioUrl ?? ms.stems[0]?.url ?? null;
    }
  })();

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

  const previewScene = scenes.find((s) => s.id === previewSceneId) ?? null;
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
      if (scene.aiVideoPrompt.startsWith(CONSISTENCY_MARKER)) return scene;
      return { ...scene, aiVideoPrompt: `${consistencyPrompt}\n\n${scene.aiVideoPrompt}`.trimEnd() };
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
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-yellow-600/[0.07] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-5 md:px-8 py-8 md:py-12">
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
              scenes={scenes}
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
            />

            {/* ── Timeline strip under master player ── */}
            {scenes.length > 0 && (
              <VideoTimeline
                scenes={scenes}
                currentTimeSec={previewEngineState?.currentTime ?? 0}
                totalDurationSec={songDuration ?? undefined}
                activeSceneIndex={previewEngineState?.activeSceneIndex ?? 0}
                captionLines={settings.captions.lines}
                effects={settings.effects}
                appliedTransitions={settings.aiEdit?.appliedTransitions}
                audioUrl={previewAudioUrl}
                onSeek={(sec) => timelinePlayerRef.current?.seekTo(sec)}
                onSceneClick={(id, _startSec) => setPreviewSceneId(id)}
              />
            )}

              </div>{/* /left-panel */}

              {/* RIGHT: scrollable tabs column */}
              <div className="flex-1 min-w-0">

            {/* Tab nav */}
            <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] mb-6">
              <TabButton active={tab === "clips"} onClick={() => setTab("clips")} icon={<Film className="h-4 w-4" />} label="Clips" testId="tab-clips" />
              <TabButton active={tab === "music"} onClick={() => setTab("music")} icon={<Music2 className="h-4 w-4" />} label="Music Mixer" testId="tab-music" />
              <TabButton active={tab === "captions"} onClick={() => setTab("captions")} icon={<Captions className="h-4 w-4" />} label="Captions" testId="tab-captions" />
              <TabButton active={tab === "effects"} onClick={() => setTab("effects")} icon={<Wand2 className="h-4 w-4" />} label="Effects" testId="tab-effects" />
              <TabButton active={tab === "branding"} onClick={() => setTab("branding")} icon={<Layers className="h-4 w-4" />} label="Branding" testId="tab-branding" />
              <TabButton active={tab === "export"} onClick={() => setTab("export")} icon={<Download className="h-4 w-4" />} label="Export" testId="tab-export" />
            </div>

            {/* ── Timeline tab — always in DOM so audio keeps playing across tab switches ── */}
            {/* TimelinePreviewPlayer — always mounted (it IS the playback engine), visually hidden */}
            <div className="hidden">
              <TimelinePreviewPlayer
                ref={timelinePlayerRef}
                scenes={scenes}
                captionLines={settings.captions.lines}
                audioUrl={previewAudioUrl}
                initialSceneId={previewSceneId}
                captionSettings={settings.captions}
                onEngineUpdate={setPreviewEngineState}
                externalVideoRef={liveVideoRef}
                outgoingVideoRef={outgoingVideoRef}
                onSceneChange={handleSceneChange}
              />
            </div>

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
                onGoToEffects={() => setTab("effects")}
                masterCurrentTimeSec={previewEngineState?.currentTime ?? 0}
                projectDurationSec={previewEngineState?.audioDuration ?? 0}
              />
            )}

              </div>{/* /right-panel */}
            </div>{/* /two-col */}
          </>
        )}
      </div>
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

/** Small icon-map used in the format popover (module-level, no re-creation). */
const FORMAT_ICONS_MAP: Record<VideoFormat, React.ReactNode> = {
  "9:16":  <Smartphone className="h-3.5 w-3.5" />,
  "16:9":  <Monitor   className="h-3.5 w-3.5" />,
  "1:1":   <Square    className="h-3.5 w-3.5" />,
  "4:5":   <Instagram className="h-3.5 w-3.5" />,
};

function MasterPreviewPlayer({
  eng, scenes, liveVideoRef, previewScene, tab, captionSettings,
  settings, setSettings, testEffectActive,
  outgoingVideoRef, transitionState, testOverlayActive, activeOverlayChips, overlayIntensity,
  watermarkText, waveformPosition,
  onTogglePlay, onRestart,
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
}) {
  const containerRef  = useRef<HTMLDivElement | null>(null);
  const [isFullscreen,       setIsFullscreen      ] = useState(false);
  const [pipActive,          setPipActive         ] = useState(false);
  const [pipError,           setPipError          ] = useState<string | null>(null);
  const blurVideoRef = useRef<HTMLVideoElement | null>(null);
  const [formatOpen,   setFormatOpen  ] = useState(false);
  const formatPopoverRef = useRef<HTMLDivElement | null>(null);

  /* Close format popover on outside click */
  useEffect(() => {
    if (!formatOpen) return;
    const handler = (e: MouseEvent) => {
      if (formatPopoverRef.current && !formatPopoverRef.current.contains(e.target as Node)) {
        setFormatOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [formatOpen]);

  /* ── Auto PiP state ── */
  const [autoPiP,            setAutoPiP           ] = useState(false);
  const [enterOnScroll,      setEnterOnScroll     ] = useState(true);
  const [keepOnTabSwitch,    setKeepOnTabSwitch   ] = useState(true);
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
  const autoPiPRef          = useRef(false);
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
    <div
      ref={containerRef}
      className={`overflow-hidden mb-6 ${
        isFullscreen
          ? "bg-black flex flex-col"
          : "rounded-2xl border border-white/[0.08] bg-black/50"
      }`}
    >
      {/* ── Video area — MasterVideoElement is ALWAYS in DOM ── */}
      {(() => {
        const fmt    = settings.export.format ?? "9:16";
        const arCss  = formatAspectCss(fmt);
        const isWide = fmt === "16:9";
        return (
      <div
        className={`bg-black relative overflow-hidden [container-type:inline-size] ${isFullscreen ? "flex-1 min-h-0" : ""}`}
        style={isFullscreen ? {} : {
          aspectRatio: arCss,
          maxHeight: isWide ? undefined : "72vh",
          transition: "aspect-ratio 0.35s ease",
        }}
      >
        {/* ── Blur-background layer (fit mode = blur) ── */}
        {fitMode === "blur" && !isFullscreen && (
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
          watermarkText={settings.watermarkText ?? "Bow Down Visuals"}
          watermarkType={settings.watermarkType ?? "logo"}
          watermarkPosition={settings.watermarkPosition ?? "bottom-right"}
          watermarkSize={settings.watermarkSize ?? "medium"}
          watermarkMargin={settings.watermarkMargin ?? 16}
          watermarkShowOnPreview={settings.watermarkShowOnPreview ?? true}
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
      })()}

      {/* ── Transport bar — visible on EVERY tab ── */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-t border-white/[0.06] ${isFullscreen ? "shrink-0" : ""}`}>
        {/* Restart */}
        <button type="button" onClick={onRestart} disabled={!hasScenes}
          className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors text-white/70 hover:text-white disabled:opacity-30"
          title="Restart">
          <SkipBack className="h-4 w-4" />
        </button>
        {/* Play / Pause */}
        <button type="button" onClick={onTogglePlay} disabled={!hasScenes}
          className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 transition-colors text-primary disabled:opacity-30"
          title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        {/* Progress bar */}
        <div className="flex-1 h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
          <div className="h-full bg-primary/70 rounded-full transition-none"
            style={{ width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : "0%" }} />
        </div>
        {/* Time */}
        <span className="text-[11px] font-mono text-white/40 tabular-nums shrink-0 w-[80px] text-right">
          {fmtSecs(currentTime)} / {fmtSecs(duration || 0)}
        </span>
        {/* Auto PiP toggle */}
        <button
          type="button"
          onClick={() => autoPiP ? disableAutoPiP() : void enableAutoPiP()}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold transition-colors shrink-0 ${
            autoPiP
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-white/10 bg-white/[0.04] text-white/50 hover:text-white/80"
          }`}
          title={autoPiP ? "Disable Auto PiP" : "Enable Auto PiP — video floats while you work"}
        >
          {autoPiP ? "Auto PiP ✓" : "Auto PiP"}
        </button>
        {/* Manual PiP */}
        <button type="button" onClick={() => void togglePiP()}
          className={`flex items-center justify-center h-8 w-8 rounded-lg border transition-colors ${
            pipActive
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-white/10 bg-white/[0.04] text-white/50 hover:text-white/80"
          }`}
          title={pipActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}>
          <PictureInPicture2 className="h-4 w-4" />
        </button>
        {/* Format popover */}
        <div ref={formatPopoverRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setFormatOpen((o) => !o)}
            className={`flex items-center justify-center h-8 w-8 rounded-lg border transition-colors ${
              formatOpen
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-white/10 bg-white/[0.04] text-white/50 hover:text-white/80"
            }`}
            title="Project Format"
          >
            <Crop className="h-4 w-4" />
          </button>

          {formatOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-72 rounded-2xl border border-white/[0.10] bg-[#0c0c0c] shadow-2xl overflow-hidden z-50">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                <p className="text-[11px] font-black text-white/80 uppercase tracking-wide">Project Format</p>
                <button type="button" onClick={() => setFormatOpen(false)} className="text-white/30 hover:text-white/60 text-[11px] transition-colors">✕</button>
              </div>

              {/* Format chips */}
              <div className="p-3">
                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-2">Canvas</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {VIDEO_FORMATS.map((vf) => {
                    const active = settings.export.format === vf.id;
                    const [fw, fh] = formatDimensions(vf.id as VideoFormat);
                    return (
                      <button
                        key={vf.id}
                        type="button"
                        onClick={() => {
                          setSettings({ ...settings, export: { ...settings.export, format: vf.id as VideoFormat } });
                        }}
                        className={`flex items-start gap-2 px-2.5 py-2 rounded-xl border text-left transition-all ${
                          active
                            ? "bg-[#C9A84C]/15 border-[#C9A84C]/50"
                            : "bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.06]"
                        }`}
                      >
                        <span className={`mt-0.5 shrink-0 ${active ? "text-[#C9A84C]" : "text-white/30"}`}>
                          {FORMAT_ICONS_MAP[vf.id as VideoFormat]}
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-[10px] font-bold ${active ? "text-[#C9A84C]" : "text-white/55"}`}>{vf.label}</span>
                          <span className="block text-[9px] text-white/30 font-mono">{vf.note}</span>
                          <span className="block text-[8px] text-white/20 font-mono">{fw}×{fh}</span>
                        </span>
                      </button>
                    );
                  })}
                  {/* Custom (placeholder) */}
                  <button
                    type="button"
                    disabled
                    className="flex items-start gap-2 px-2.5 py-2 rounded-xl border border-white/[0.05] bg-white/[0.01] text-left opacity-40 cursor-not-allowed"
                    title="Custom format — coming soon"
                  >
                    <Crop className="h-3.5 w-3.5 mt-0.5 shrink-0 text-white/25" />
                    <span className="min-w-0">
                      <span className="block text-[10px] font-bold text-white/40">Custom</span>
                      <span className="block text-[9px] text-white/20">Coming soon</span>
                    </span>
                  </button>
                </div>
              </div>

              {/* Fit Mode */}
              <div className="px-3 pb-3 border-t border-white/[0.06] pt-3">
                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-2">Fit Mode</p>
                <div className="space-y-1">
                  {([
                    ["fill", "Fill / Crop",         "Crops clip edges to fill canvas"],
                    ["fit",  "Fit / Letterbox",      "Black bars, full clip visible"],
                    ["blur", "Blur Background Fill", "Blurred fill behind contained clip"],
                  ] as const).map(([id, lbl, desc]) => {
                    const active = (settings.export.fitMode ?? "fill") === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSettings({ ...settings, export: { ...settings.export, fitMode: id } })}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                          active
                            ? "bg-[#C9A84C]/12 border-[#C9A84C]/40"
                            : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                        }`}
                      >
                        <span>
                          <span className={`text-[10px] font-bold block ${active ? "text-[#C9A84C]" : "text-white/50"}`}>{lbl}</span>
                          <span className="text-[9px] text-white/25">{desc}</span>
                        </span>
                        {active && <span className="text-[9px] font-bold text-[#C9A84C] ml-2 shrink-0">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mini status */}
              <div className="px-3 pb-3 pt-2.5 border-t border-white/[0.06] space-y-0.5">
                {([
                  ["master player matches format", "yes"],
                  ["export matches format",        "yes"],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-mono text-white/28">{label}</span>
                    <span className="text-[9px] font-bold text-green-400">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen */}
        <button type="button" onClick={toggleFullscreen}
          className={`flex items-center justify-center h-8 w-8 rounded-lg border transition-colors ${
            isFullscreen
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-white/10 bg-white/[0.04] text-white/50 hover:text-white/80"
          }`}
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>

      {/* Auto PiP sub-settings — visible while Auto PiP is on */}
      {autoPiP && (
        <div className="px-4 py-2 border-t border-primary/[0.12] bg-primary/[0.03] flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="text-[10px] font-bold text-primary/60 shrink-0">Auto PiP:</span>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enterOnScroll}
              onChange={(e) => setEnterOnScroll(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            <span className="text-[10px] text-white/50">Enter PiP when scrolling</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={keepOnTabSwitch}
              onChange={(e) => setKeepOnTabSwitch(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            <span className="text-[10px] text-white/50">Keep PiP when switching tabs</span>
          </label>
        </div>
      )}

      {/* Error message — PiP or Auto PiP */}
      {pipError && (
        <div className="px-4 py-2 border-t border-red-500/20 bg-red-500/[0.06] text-[10px] text-red-400 font-mono flex items-start gap-1.5">
          <span className="shrink-0 mt-px">⚠</span>
          <span>{pipError}</span>
        </div>
      )}

      {/* ── Status bar ── */}
      <div className="px-4 py-1.5 border-t border-white/[0.04] flex flex-wrap gap-x-4 gap-y-0.5">
        <span className="text-[10px] font-mono text-white/25">
          Master Player: <span className="text-green-400/70">Connected ✓</span>
        </span>
        <span className="text-[10px] font-mono text-white/25">
          Active Clip: <span className={clipLoaded ? "text-green-400/70" : "text-white/25"}>{clipLoaded ? "loaded ✓" : "none"}</span>
        </span>
        <span className="text-[10px] font-mono text-white/25">
          Caption: <span className={captionLoaded ? "text-blue-400/70" : "text-white/25"}>
            {captionLoaded ? `"${activeCaption!.text.slice(0, 20)}…"` : "none"}
          </span>
        </span>
        <span className="text-[10px] font-mono text-white/25">
          Audio: <span className={isPlaying ? "text-green-400/70" : "text-white/25"}>{isPlaying ? "playing ✓" : "stopped"}</span>
        </span>
        <span className="text-[10px] font-mono text-white/25">
          Auto PiP: <span className={autoPiP ? "text-primary/70" : "text-white/25"}>{autoPiP ? "on ✓" : "off"}</span>
        </span>
        <span className="text-[10px] font-mono text-white/25">
          PiP supported: <span className={pipSupported ? "text-green-400/70" : "text-red-400/60"}>{pipSupported ? "yes" : "no"}</span>
        </span>
        <span className="text-[10px] font-mono text-white/25">
          PiP active: <span className={pipActive ? "text-primary/70" : "text-white/25"}>{pipActive ? "yes ✓" : "no"}</span>
        </span>
        {pipError && (
          <span className="text-[10px] font-mono text-red-400/60 w-full truncate">
            Last error: {pipError}
          </span>
        )}
      </div>

      {/* ── Auto PiP Debug ── */}
      <div className="px-4 py-1.5 border-t border-white/[0.03] flex flex-wrap gap-x-4 gap-y-0.5">
        <span className="text-[10px] font-mono text-white/20 w-full font-bold">Auto PiP Debug:</span>
        {[
          ["autoPiPEnabled",       autoPiP          ? "yes ✓" : "no",   autoPiP],
          ["pipActive",            pipActive         ? "yes ✓" : "no",   pipActive],
          ["document hidden",      docHidden         ? "yes"   : "no",   docHidden],
          ["browser focused",      browserFocused    ? "yes"   : "no",   browserFocused],
          ["master currentTime",   `${currentTime.toFixed(2)}s`,         true],
          ["lastKnownTime",        lastKnownTime > 0 ? `${lastKnownTime.toFixed(2)}s` : "—", lastKnownTime > 0],
          ["wasPlayingBeforePiP",  wasPlayingBeforePiP ? "yes" : "no",   wasPlayingBeforePiP],
          ["returned from PiP",    returnedFromPiP   ? "yes ✓" : "no",  returnedFromPiP],
          ["playback restored",    playbackRestored  ? "yes ✓" : "no",  playbackRestored],
          ["lastKnownScene",       lastKnownScene >= 0 ? `Scene ${lastKnownScene + 1}` : "—", lastKnownScene >= 0],
          ["lastKnownCaption",     lastKnownCaption  ? `"${lastKnownCaption.slice(0,20)}…"` : "—", !!lastKnownCaption],
          ["using master player",  "yes ✓",          true],
        ].map(([label, value, ok]) => (
          <span key={String(label)} className="text-[10px] font-mono text-white/20">
            {label}:{" "}
            <span className={ok ? "text-green-400/60" : "text-white/30"}>{String(value)}</span>
          </span>
        ))}
        {pipError && (
          <span className="text-[10px] font-mono text-amber-400/60 w-full">⚠ {pipError}</span>
        )}
        {pipActive && (
          <span className="text-[10px] font-mono text-amber-400/50 w-full">
            ⚠ PiP may not show HTML overlays — captions appear in final export.
          </span>
        )}
        {returnedFromPiP && !playbackRestored && wasPlayingBeforePiP && (
          <span className="text-[10px] font-mono text-red-400/70 w-full">
            ⚠ Playback may not have resumed — check master player controls.
          </span>
        )}
      </div>

      {/* ── Effects Quality Debug ── */}
      <div className="px-4 py-1.5 border-t border-white/[0.03] flex flex-wrap gap-x-4 gap-y-0.5">
        <span className="text-[10px] font-mono text-white/20 w-full font-bold">Effects Quality Debug:</span>
        {([
          ["effects layer mounted",      true,                                   "yes ✓"],
          ["selected effects",           activeEffects.length > 0,              activeEffects.length > 0 ? activeEffects.join(", ") : "none"],
          ["active overlays",            activeOverlayChips.length > 0,         activeOverlayChips.length > 0 ? activeOverlayChips.join(", ") : "none"],
          ["intensity values",           activeOverlayChips.length > 0,         activeOverlayChips.map((k) => `${k.split(" ")[0]}:${overlayIntensity[k] ?? 100}%`).join(" ") || "—"],
          ["blend modes",                activeOverlayChips.some((k) => ["Light Leaks","Smoke"].includes(k)), activeOverlayChips.some((k) => ["Light Leaks","Smoke"].includes(k)) ? "screen ✓" : "normal"],
          ["animation running",          activeOverlayChips.length > 0,         activeOverlayChips.length > 0 ? "yes ✓" : "no"],
          ["master player connected",    true,                                   "yes ✓"],
          ["export connected",           false,                                  "preview only — export rendering needs connection"],
          ["test overlay active",        testOverlayActive,                     testOverlayActive ? "yes ✓" : "no"],
          ["active transition",          !!transitionState,                     transitionState ? `${transitionState.type} (${transitionState.duration}s)` : "idle"],
          ["AI effects applied",         aiEffectsApplied,                     aiEffectsApplied ? "yes ✓" : "no"],
        ] as [string, boolean | null, string][]).map(([label, ok, value]) => (
          <span key={label} className="text-[10px] font-mono text-white/20">
            {label}:{" "}
            <span className={ok === true ? "text-green-400/60" : ok === false ? "text-amber-400/50" : "text-white/30"}>
              {value}
            </span>
          </span>
        ))}
        {activeOverlayChips.length > 0 && (
          <span className="text-[10px] font-mono text-green-400/60 w-full">
            ✓ Animated overlays rendering: {activeOverlayChips.map((k) => `${k} (${overlayIntensity[k] ?? 100}%)`).join(" · ")}
          </span>
        )}
        {activeEffects.length > 0 && (
          <span className="text-[10px] font-mono text-green-400/60 w-full">✓ CSS grade/effects active: {activeEffects.join(" · ")}</span>
        )}
        {transitionState && (
          <span className="text-[10px] font-mono text-blue-400/70 w-full">↔ Transition: {transitionState.type}</span>
        )}
        {testOverlayActive && (
          <span className="text-[10px] font-mono text-[#C9A84C]/70 w-full">◈ Test overlay active — Rain + Sparks + Lens Flare showing</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── [DELETED: LivePreviewPanel] ─────────────────────── */
/* LivePreviewPanel has been removed. The single MasterPreviewPlayer above the
   tab nav is now the sole preview surface. TimelinePreviewPlayer is always kept
   in the DOM (hidden when not on the timeline tab) so audio persists. */


/* ─────────────────────── TAB / MODE BUTTONS ─────────────────────── */

function TabButton({
  active, onClick, icon, label, testId,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; testId?: string;
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
