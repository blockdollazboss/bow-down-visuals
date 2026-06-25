import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useSearch } from "wouter";
import {
  ArrowLeft, Loader2, Clapperboard,
  Check, CloudOff, Save, Film, ListVideo, Music2, Captions, Wand2, Download,
  CheckCircle2, Circle, Layers, Play, Pause,
  RefreshCw, Zap, SkipBack,
} from "lucide-react";
import { HelpPanel } from "@/components/HelpPanel";
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
  type EditorSettings,
} from "@/lib/editor-settings";
import { ClipGeneratorSection } from "@/components/editor/sections/ClipGeneratorSection";
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
  "Warm Grade":        "sepia(40%) saturate(135%) brightness(108%)",
  "Cool Grade":        "hue-rotate(195deg) saturate(115%) brightness(94%)",
  "Teal & Orange":     "hue-rotate(20deg) saturate(165%) contrast(110%)",
  "Moody Desaturated": "saturate(40%) contrast(120%) brightness(88%)",
  "Vibrant Pop":       "saturate(210%) brightness(108%) contrast(106%)",
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
  const [tab, setTab] = useState<EditorTab>("clips");
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

  /* ── Drive the master preview <video> element imperatively ──────────
     Single effect in VideoEditor so the video element is shared across
     ALL tabs. Fires on engine scene-change, play/pause, or clip selection.  */
  useEffect(() => {
    const v = liveVideoRef.current;
    if (!v) return;
    const eng = previewEngineState;

    if (eng?.isPlaying) {
      const engClip = (scenes[eng.activeSceneIndex] ?? null)?.demoClipUrl ?? null;
      if (engClip) {
        if (v.src !== engClip) { v.src = engClip; v.currentTime = 0; }
        void v.play().catch(() => {});
      } else {
        v.pause();
        v.removeAttribute("src");
      }
    } else if (eng && !eng.isPlaying) {
      v.pause();
    } else {
      // Engine not started — show the selected preview clip (static)
      const clip = previewScene?.demoClipUrl ?? null;
      if (clip && v.src !== clip) { v.src = clip; v.currentTime = 0; }
      else if (!clip) { v.pause(); v.removeAttribute("src"); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewEngineState?.activeSceneIndex, previewEngineState?.isPlaying, previewScene?.demoClipUrl]);

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
      <HelpPanel page="video-editor" />

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

            {/* Active Artist pill — full width */}
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
              onTogglePlay={() => timelinePlayerRef.current?.togglePlay()}
              onRestart={() => timelinePlayerRef.current?.restart()}
            />

            {/* Tab nav */}
            <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] mb-7">
              <TabButton active={tab === "clips"} onClick={() => setTab("clips")} icon={<Film className="h-4 w-4" />} label="Clips" testId="tab-clips" />
              <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")} icon={<ListVideo className="h-4 w-4" />} label="Timeline" testId="tab-timeline" />
              <TabButton active={tab === "music"} onClick={() => setTab("music")} icon={<Music2 className="h-4 w-4" />} label="Music Mixer" testId="tab-music" />
              <TabButton active={tab === "captions"} onClick={() => setTab("captions")} icon={<Captions className="h-4 w-4" />} label="Captions" testId="tab-captions" />
              <TabButton active={tab === "effects"} onClick={() => setTab("effects")} icon={<Wand2 className="h-4 w-4" />} label="Effects" testId="tab-effects" />
              <TabButton active={tab === "branding"} onClick={() => setTab("branding")} icon={<Layers className="h-4 w-4" />} label="Branding" testId="tab-branding" />
              <TabButton active={tab === "export"} onClick={() => setTab("export")} icon={<Download className="h-4 w-4" />} label="Export" testId="tab-export" />
            </div>

            {/* ── Timeline tab — always in DOM so audio keeps playing across tab switches ── */}
            <div className={tab === "timeline" ? "" : "hidden"}>
              {scenes.length > 0 ? (
                <TimelinePreviewPlayer
                  ref={timelinePlayerRef}
                  scenes={scenes}
                  captionLines={settings.captions.lines}
                  audioUrl={previewAudioUrl}
                  initialSceneId={previewSceneId}
                  captionSettings={settings.captions}
                  onEngineUpdate={setPreviewEngineState}
                />
              ) : (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-8 text-center space-y-3">
                  <ListVideo className="h-8 w-8 text-primary/30 mx-auto" />
                  <p className="text-sm font-bold text-white/50">No scenes yet</p>
                  <p className="text-xs text-white/30 leading-relaxed">
                    Generate a music video plan first, then come back to preview the full timeline.
                  </p>
                </div>
              )}
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
              />
            )}

            {tab === "effects" && (
              <EffectsSection scenes={scenes} settings={settings} setSettings={setSettings} />
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
              <ExportSection scenes={scenes} settings={settings} setSettings={setSettings} projectId={project!.id} audioUrl={audioUrl} onGoToMusicStudio={() => setTab("music")} />
            )}
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

function MasterVideoElement({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  return (
    <video
      ref={videoRef}
      playsInline
      className="w-full h-full object-contain"
      data-testid="master-preview-video"
    />
  );
}

function MasterPreviewPlayer({
  eng, scenes, liveVideoRef, previewScene, tab, onTogglePlay, onRestart,
}: {
  eng: SharedPreviewState | null;
  scenes: SceneData[];
  liveVideoRef: RefObject<HTMLVideoElement | null>;
  previewScene: SceneData | null;
  tab: EditorTab;
  onTogglePlay: () => void;
  onRestart: () => void;
}) {
  const isTimelineTab = tab === "timeline";
  const isPlaying = eng?.isPlaying ?? false;
  const currentTime = eng?.currentTime ?? 0;
  const duration = eng?.audioDuration ?? 0;
  const currentSceneIdx = eng?.activeSceneIndex ?? -1;
  const currentScene = currentSceneIdx >= 0 ? scenes[currentSceneIdx] : null;

  const clipUrl = isTimelineTab
    ? (currentScene?.demoClipUrl ?? null)
    : (previewScene?.demoClipUrl ?? null);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/50 overflow-hidden mb-6">
      {/* Video area */}
      <div className="aspect-video bg-black relative">
        {clipUrl ? (
          <MasterVideoElement videoRef={liveVideoRef} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/20">
            <Film className="h-12 w-12" />
            <p className="text-sm font-medium">
              {scenes.length === 0 ? "Generate scenes to preview" : "Select a scene with a clip"}
            </p>
          </div>
        )}

        {/* Timeline overlay */}
        {isTimelineTab && eng && (
          <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
            {currentScene && (
              <div className="px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm text-[11px] font-bold text-white/90 max-w-[60%] truncate">
                Scene {currentSceneIdx + 1} · {currentScene.section || currentScene.lyricLine || "Untitled"}
              </div>
            )}
            <div className="ml-auto px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm text-[11px] font-mono text-white/80">
              {fmtSecs(currentTime)} / {fmtSecs(duration)}
            </div>
          </div>
        )}

        {/* Clips-tab overlay */}
        {!isTimelineTab && previewScene && (
          <div className="absolute top-3 left-3 pointer-events-none">
            <div className="px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm text-[11px] font-bold text-white/90 max-w-xs truncate">
              {previewScene.section || previewScene.lyricLine || "Preview"}
            </div>
          </div>
        )}
      </div>

      {/* Transport controls — timeline tab only */}
      {isTimelineTab && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onRestart}
            className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors text-white/70 hover:text-white"
            title="Restart"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={scenes.length === 0}
            className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 transition-colors text-primary disabled:opacity-40"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <div className="flex-1 h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full transition-all"
              style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }}
            />
          </div>
          <span className="text-xs font-mono text-white/40 tabular-nums">
            {fmtSecs(currentTime)} / {fmtSecs(duration)}
          </span>
        </div>
      )}
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
