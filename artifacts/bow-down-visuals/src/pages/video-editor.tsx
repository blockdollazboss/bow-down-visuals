import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import {
  ArrowLeft, Loader2, Clapperboard,
  Check, CloudOff, Save, Film, ListVideo, Music2, Captions, Wand2, Download,
  CheckCircle2, Circle, Layers, Monitor, Eye, Volume2, Palette, Play,
  RefreshCw,
} from "lucide-react";
import { HelpPanel } from "@/components/HelpPanel";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ClipSequencePlayer } from "@/components/ClipSequencePlayer";
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
  const [rebuildStatus, setRebuildStatus] = useState<"idle" | "rebuilding" | "done" | "error">("idle");
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const hydrated  = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current ref so persist() never uses a stale scenes closure
  const scenesRef = useRef<SceneData[]>([]);

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

  const artistName = project?.artist_name ?? (project?.input_data?.["artistName"] as string | undefined) ?? "";
  const songTitle = project?.song_title ?? (project?.input_data?.["songTitle"] as string | undefined) ?? "";
  const audioUrl =
    (project?.input_data?.["audioUrl"] as string | undefined) ??
    (project?.input_data?.["audio_url"] as string | undefined) ??
    null;

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
  const lyricsForCaptions = projectLyrics ?? (sceneLyricsJoined || null);

  /* ── Song duration from project metadata ── */
  const songDuration =
    (project?.input_data?.["songDuration"] as number | undefined) ??
    (project?.input_data?.["duration"] as number | undefined) ??
    null;

  const previewScene = scenes.find((s) => s.id === previewSceneId) ?? null;
  const approvedCount = scenes.filter((s) => s.approved && sceneHasClip(s)).length;

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

            {/* ── Mobile preview panel (shown above tabs on small screens) ── */}
            <div className="lg:hidden mb-5">
              <LivePreviewPanel
                tab={tab}
                previewScene={previewScene}
                scenes={scenes}
                approvedCount={approvedCount}
                audioUrl={audioUrl}
                settings={settings}
                artistName={artistName}
                songTitle={songTitle}
                onGoToTimeline={() => setTab("timeline")}
                onSetPreviewSceneId={setPreviewSceneId}
              />
            </div>

            {/* ── Two-column layout: editor left + preview right ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">

              {/* LEFT: tabs + content */}
              <div>
                {/* Active Artist pill */}
                {activeArtist && (
                  <div className="flex items-center gap-2.5 px-3 py-2 mb-4 rounded-xl border border-green-500/25 bg-green-500/[0.06]">
                    <div className="h-7 w-7 rounded-lg overflow-hidden shrink-0">
                      {activeArtist.reference_image_url ? (
                        <img src={activeArtist.reference_image_url} alt={activeArtist.artist_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-primary/20 flex items-center justify-center">
                          <span className="text-[10px] font-black text-primary">{activeArtist.artist_name[0]?.toUpperCase()}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-green-400 truncate">Active Artist: {activeArtist.artist_name}</p>
                      {(activeArtist.artist_type || activeArtist.genre) && (
                        <p className="text-[10px] text-white/35 truncate">{[activeArtist.artist_type, activeArtist.genre].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                    {consistencyPrompt && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-green-400/70 shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> Consistency Lock Active
                      </span>
                    )}
                  </div>
                )}

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

                    <ClipGeneratorSection
                      scenes={scenes}
                      setScenes={setScenes}
                      settings={settings}
                      setSettings={setSettings}
                      artistVault={activeArtist}
                      projectId={projectId}
                      onPreview={(id) => setPreviewSceneId(id)}
                      previewSceneId={previewSceneId}
                    />
                  </div>
                )}

                {tab === "timeline" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setTab("timeline")}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-primary/10 border border-primary/25 text-primary hover:bg-primary/15 transition-colors"
                      >
                        <Play className="h-4 w-4" /> Preview Timeline
                      </button>
                    </div>
                    <ClipSequencePlayer
                      scenes={scenes.filter((s) => s.approved && sceneHasClip(s))}
                      allScenes={scenes}
                      title="Timeline Preview"
                      emptyTitle="No approved clips to preview yet."
                      emptyHint="Generate Runway clips on your scenes, then approve them — approved clips play here in order."
                    />
                  </div>
                )}

                {tab === "music" && (
                  <MusicStudio settings={settings} onChange={setSettings} artistName={artistName} songTitle={songTitle} />
                )}

                {tab === "captions" && (
                  <CaptionsSection
                    settings={settings}
                    setSettings={setSettings}
                    lyrics={lyricsForCaptions ?? undefined}
                    songDuration={songDuration ?? undefined}
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
              </div>

              {/* RIGHT: sticky live preview panel (desktop only) */}
              <div className="hidden lg:block lg:sticky lg:top-24">
                <LivePreviewPanel
                  tab={tab}
                  previewScene={previewScene}
                  scenes={scenes}
                  approvedCount={approvedCount}
                  audioUrl={audioUrl}
                  settings={settings}
                  artistName={artistName}
                  songTitle={songTitle}
                  onGoToTimeline={() => setTab("timeline")}
                  onSetPreviewSceneId={setPreviewSceneId}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── LIVE PREVIEW PANEL ─────────────────────── */

function LivePreviewPanel({
  tab, previewScene, scenes, approvedCount, audioUrl, settings, artistName, songTitle, onGoToTimeline, onSetPreviewSceneId,
}: {
  tab: EditorTab;
  previewScene: SceneData | null;
  scenes: SceneData[];
  approvedCount: number;
  audioUrl: string | null;
  settings: EditorSettings;
  artistName: string;
  songTitle: string;
  onGoToTimeline: () => void;
  onSetPreviewSceneId: (id: string) => void;
}) {
  /* demoClipUrl is the canonical field on SceneData */
  const clipUrl = previewScene?.demoClipUrl ?? null;

  const clipCount = scenes.filter(sceneHasClip).length;

  /* Shared video player used by clips / captions / effects / music tabs */
  function VideoPlayer({ overlay, filterStyle }: { overlay?: ReactNode; filterStyle?: string }) {
    if (!clipUrl) {
      return (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] aspect-video flex flex-col items-center justify-center text-center gap-3 p-4">
          <Eye className="h-7 w-7 text-white/15" />
          <div>
            <p className="text-sm font-semibold text-white/30">
              {scenes.length === 0 ? "No scenes loaded yet." : "Select a video clip to preview."}
            </p>
            <p className="text-[11px] text-white/20 mt-1">
              {scenes.length > 0 ? "Click Preview on a scene with a clip." : "Generate a music video plan first."}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl overflow-hidden bg-black border border-white/[0.07] aspect-video relative">
        <video
          key={clipUrl}
          src={clipUrl}
          controls
          playsInline
          className="w-full h-full object-contain"
          style={filterStyle ? { filter: filterStyle } : undefined}
          data-testid="preview-video-player"
        />
        {overlay}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden" data-testid="live-preview-panel">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
        <Monitor className="h-4 w-4 text-primary/70" />
        <span className="text-xs font-black text-white/60 uppercase tracking-widest">Live Preview</span>
        <span className="ml-auto text-[10px] font-bold text-primary/50 uppercase tracking-wider">{tab}</span>
      </div>

      <div className="p-4 space-y-3">

        {/* ── CLIPS tab ── */}
        {tab === "clips" && (
          <>
            <VideoPlayer />
            {clipUrl && previewScene && (
              <div className="px-0.5">
                <p className="text-xs font-bold text-white/70 truncate">{previewScene.section || "Scene"}</p>
                <p className="text-[11px] text-white/35 truncate mt-0.5">{previewScene.lyricLine || previewScene.action || "—"}</p>
              </div>
            )}
            {!clipUrl && previewScene?.demoClipUrl === undefined && previewScene && (
              <p className="text-[11px] text-red-400/70 px-0.5">Clip video URL missing. Regenerate this clip.</p>
            )}
            {scenes.length > 0 && (
              <div className="flex items-center justify-between text-[11px] text-white/25 px-0.5">
                <span>{clipCount} of {scenes.length} scenes have clips</span>
                <span>{scenes.filter((s) => s.approved).length} approved</span>
              </div>
            )}
          </>
        )}

        {/* ── TIMELINE tab ── */}
        {tab === "timeline" && (
          <>
            {approvedCount > 0 ? (
              <>
                <div className="flex items-center gap-2 px-0.5 mb-1">
                  <Play className="h-3.5 w-3.5 text-primary/70" />
                  <span className="text-xs font-bold text-white/60">{approvedCount} clip{approvedCount !== 1 ? "s" : ""} in timeline</span>
                </div>
                <ClipSequencePlayer
                  scenes={scenes.filter((s) => s.approved && sceneHasClip(s))}
                  allScenes={scenes}
                  title=""
                  emptyTitle=""
                  emptyHint=""
                />
              </>
            ) : (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 text-center space-y-3">
                <ListVideo className="h-8 w-8 text-primary/30 mx-auto" />
                <p className="text-sm font-bold text-white/50">No clips in timeline yet</p>
                <p className="text-xs text-white/30 leading-relaxed">
                  Timeline preview is in beta. Approve clips on the Clips tab to build your timeline.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── MUSIC / AUDIO tab ── */}
        {tab === "music" && (
          <>
            <VideoPlayer
              overlay={
                <div className="absolute top-2 left-2 right-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/75 border border-white/10 text-[10px] text-white/70">
                  <Volume2 className="h-3 w-3 text-blue-400 shrink-0" />
                  Runway clips are silent. Your song audio is added during final export.
                </div>
              }
            />
            {(audioUrl || settings.musicStudio.stems.length > 0) ? (
              <div className="rounded-lg border border-green-500/20 bg-green-500/[0.06] px-3 py-2 text-center">
                <p className="text-xs font-bold text-green-400">✓ Audio source loaded</p>
                <p className="text-[10px] text-green-400/60 mt-0.5">
                  {settings.musicStudio.stems.length > 0
                    ? `${settings.musicStudio.stems.length} stem${settings.musicStudio.stems.length !== 1 ? "s" : ""} mixed`
                    : "Track uploaded"}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center">
                <p className="text-xs text-white/30">No audio loaded yet</p>
              </div>
            )}
          </>
        )}

        {/* ── CAPTIONS tab ── */}
        {tab === "captions" && (
          <>
            {clipUrl ? (
              <VideoPlayer
                overlay={
                  settings.captions.mode !== "none" ? (
                    <div
                      className={`absolute left-0 right-0 px-3 pb-3 flex justify-center pointer-events-none ${
                        settings.captions.position === "top" ? "top-3" : "bottom-3"
                      }`}
                    >
                      <div
                        className="px-3 py-1 rounded-md text-center max-w-[90%]"
                        style={{
                          fontSize: "14px",
                          color: settings.captions.textColor || "#ffffff",
                          background: settings.captions.background ? "rgba(0,0,0,0.7)" : "transparent",
                          textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                        }}
                      >
                        {songTitle ? `♪ ${songTitle}` : "Your captions appear here"}
                      </div>
                    </div>
                  ) : null
                }
              />
            ) : (
              /* No clip yet — show the caption mock with a dark background */
              <div className="rounded-xl border border-white/[0.07] bg-black aspect-video flex items-end p-4 overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60" />
                {settings.captions.mode !== "none" ? (
                  <div className="relative z-10 w-full flex justify-center">
                    <div
                      className="px-3 py-1.5 rounded-lg text-center"
                      style={{
                        fontSize: "14px",
                        color: settings.captions.textColor || "#ffffff",
                        background: settings.captions.background ? "rgba(0,0,0,0.6)" : "transparent",
                      }}
                    >
                      {songTitle ? `♪ ${songTitle}` : "Select a clip before previewing captions."}
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 w-full text-center">
                    <p className="text-xs text-white/25">Captions off — select a mode to preview</p>
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-white/30 text-center">
              Mode: <span className="text-white/50 font-semibold capitalize">{settings.captions.mode}</span>
              {settings.captions.position && <> · {settings.captions.position}</>}
            </p>
          </>
        )}

        {/* ── EFFECTS tab ── */}
        {tab === "effects" && (
          <>
            <VideoPlayer
              filterStyle={buildEffectFilter(settings.effects)}
              overlay={
                settings.effects.length > 0 ? (
                  <div className="absolute top-2 right-2 flex flex-wrap gap-1 justify-end pointer-events-none max-w-[85%]">
                    {settings.effects.slice(0, 3).map((fx) => (
                      <span key={fx} className="px-2 py-0.5 rounded-full bg-black/75 border border-violet-400/30 text-[10px] font-bold text-violet-200/80">
                        {fx}
                      </span>
                    ))}
                    {settings.effects.length > 3 && (
                      <span className="px-2 py-0.5 rounded-full bg-black/75 border border-white/15 text-[10px] font-bold text-white/40">
                        +{settings.effects.length - 3} more
                      </span>
                    )}
                  </div>
                ) : null
              }
            />
            {settings.effects.length > 0 ? (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-center">
                <p className="text-xs font-bold text-violet-300">
                  ✓ {settings.effects.length} effect{settings.effects.length !== 1 ? "s" : ""} active — CSS preview applied
                </p>
                <p className="text-[10px] text-violet-300/50 mt-0.5">
                  Preview only. Final render quality applied at export.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-white/30 text-center">
                Select effects above to see an instant CSS preview on your clip.
              </p>
            )}
          </>
        )}

        {/* ── BRANDING tab ── */}
        {tab === "branding" && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-3">
            <Palette className="h-8 w-8 text-yellow-400/50 mx-auto" />
            <p className="text-sm font-bold text-white/60 text-center">Branding Preview</p>
            {artistName && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/[0.05] px-3 py-2">
                <p className="text-[10px] font-bold text-yellow-400/60 uppercase tracking-wider mb-1">Artist</p>
                <p className="text-sm font-bold text-white/80">{artistName}</p>
              </div>
            )}
            {settings.branding.titleOverlay?.artistNameText && (
              <p className="text-xs text-white/35 text-center">@{settings.branding.titleOverlay.artistNameText}</p>
            )}
            {!artistName && !settings.branding.titleOverlay?.artistNameText && (
              <p className="text-xs text-white/25 text-center">Add your handles in Branding to preview overlays.</p>
            )}
          </div>
        )}

        {/* ── EXPORT tab ── */}
        {tab === "export" && (
          <>
            {clipUrl && (
              <div className="rounded-xl overflow-hidden bg-black border border-white/[0.07] aspect-video">
                <video key={clipUrl} src={clipUrl} controls playsInline className="w-full h-full object-contain" />
              </div>
            )}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
              <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-2">Export Summary</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                  <span className="text-white/40">Approved clips</span>
                  <span className={`font-bold ${approvedCount > 0 ? "text-green-400" : "text-white/25"}`}>
                    {approvedCount > 0 ? `${approvedCount} ready` : "None yet"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                  <span className="text-white/40">Audio</span>
                  <span className={`font-bold ${audioUrl || settings.musicStudio.stems.length > 0 ? "text-green-400" : "text-white/25"}`}>
                    {audioUrl ? "Uploaded track" : settings.musicStudio.stems.length > 0 ? "Mixed stems" : "None"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                  <span className="text-white/40">Captions</span>
                  <span className="font-bold text-white/50 capitalize">{settings.captions.mode}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                  <span className="text-white/40">Effects</span>
                  <span className="font-bold text-white/50">{settings.effects.length > 0 ? `${settings.effects.length} active` : "None"}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-white/40">Format</span>
                  <span className="font-bold text-white/50">{settings.export.format} · {settings.export.resolution}</span>
                </div>
              </div>
              {approvedCount === 0 && (
                <p className="text-[11px] text-white/25 text-center pt-1">Approve clips on the Clips tab to export.</p>
              )}
            </div>
          </>
        )}

        {/* ── Quick clip switcher (all tabs except timeline) ── */}
        {tab !== "timeline" && clipCount > 1 && (
          <div className="pt-1 border-t border-white/[0.05]">
            <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3" /> Switch clip
            </p>
            <div className="flex flex-wrap gap-1.5">
              {scenes.filter(sceneHasClip).map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSetPreviewSceneId(s.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                    previewScene?.id === s.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-white/10 bg-white/[0.02] text-white/30 hover:text-white/60"
                  }`}
                >
                  {s.section || `#${i + 1}`}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

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
