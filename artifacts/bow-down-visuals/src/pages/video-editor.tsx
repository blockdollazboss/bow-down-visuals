import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  ArrowLeft, Loader2, Clapperboard, Sparkles, SlidersHorizontal,
  Check, CloudOff, Save, Film, ListVideo, Music2, Captions, Wand2, Download,
  CheckCircle2, Circle, Layers,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ClipSequencePlayer } from "@/components/ClipSequencePlayer";
import type { SceneData } from "@/lib/scene-parser";
import {
  normalizeEditorSettings,
  sceneHasClip,
  type EditorSettings,
} from "@/lib/editor-settings";
import { AutoEditPanel } from "@/components/editor/AutoEditPanel";
import { ClipsSection } from "@/components/editor/sections/ClipsSection";
import { CaptionsSection } from "@/components/editor/sections/CaptionsSection";
import { EffectsSection } from "@/components/editor/sections/EffectsSection";
import { ExportSection } from "@/components/editor/sections/ExportSection";
import { MusicStudio } from "@/components/editor/music/MusicStudio";
import { BrandingSection } from "@/components/editor/sections/BrandingSection";

type EditorTab = "clips" | "timeline" | "music" | "captions" | "effects" | "branding" | "export";

interface LoadedProject {
  id: string;
  title: string;
  artist_name: string | null;
  song_title: string | null;
  input_data: Record<string, unknown> | null;
  output_data: {
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

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<LoadedProject | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(normalizeEditorSettings(null));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tab, setTab] = useState<EditorTab>("clips");
  const [clipMode, setClipMode] = useState<"auto" | "manual">("auto");

  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setScenes(data.project.output_data?.scenes ?? []);
        setSettings(normalizeEditorSettings(data.project.output_data?.editorSettings));
        // Mark hydrated AFTER state is set so the first genuine user edit autosaves.
        hydrated.current = true;
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectId, getAccessToken]);

  /* ── Debounced autosave on scenes / settings change ── */
  useEffect(() => {
    if (loading || !project) return;
    // Don't autosave during/until hydration completes (set true after load).
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(() => { void persist(); }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, settings, loading, project]);

  /** Returns true on success, false on failure. */
  async function persist(): Promise<boolean> {
    if (!project) return false;
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          scenes,
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

  const artistName = project?.artist_name ?? (project?.input_data?.["artistName"] as string | undefined) ?? "";
  const songTitle = project?.song_title ?? (project?.input_data?.["songTitle"] as string | undefined) ?? "";
  const audioUrl =
    (project?.input_data?.["audioUrl"] as string | undefined) ??
    (project?.input_data?.["audio_url"] as string | undefined) ??
    null;

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-yellow-600/[0.07] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-8 md:py-12">
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
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7">
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

            {/* Status checklist */}
            <StatusChecklist
              planLoaded={scenes.length > 0}
              clipsLoaded={scenes.some((s) => sceneHasClip(s))}
              audioLoaded={!!audioUrl || settings.musicStudio.stems.length > 0}
              timelineReady={scenes.some((s) => s.approved && sceneHasClip(s))}
              exportReady={scenes.some((s) => s.approved && sceneHasClip(s))}
            />

            {/* Top nav tabs */}
            <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] mb-7">
              <TabButton active={tab === "clips"} onClick={() => setTab("clips")} icon={<Film className="h-4 w-4" />} label="Clips" testId="tab-clips" />
              <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")} icon={<ListVideo className="h-4 w-4" />} label="Timeline" testId="tab-timeline" />
              <TabButton active={tab === "music"} onClick={() => setTab("music")} icon={<Music2 className="h-4 w-4" />} label="Music Studio" testId="tab-music" />
              <TabButton active={tab === "captions"} onClick={() => setTab("captions")} icon={<Captions className="h-4 w-4" />} label="Captions" testId="tab-captions" />
              <TabButton active={tab === "effects"} onClick={() => setTab("effects")} icon={<Wand2 className="h-4 w-4" />} label="Effects" testId="tab-effects" />
              <TabButton active={tab === "branding"} onClick={() => setTab("branding")} icon={<Layers className="h-4 w-4" />} label="Branding" testId="tab-branding" />
              <TabButton active={tab === "export"} onClick={() => setTab("export")} icon={<Download className="h-4 w-4" />} label="Export" testId="tab-export" />
            </div>

            {tab === "clips" && (
              <div className="space-y-6">
                <div className="inline-flex p-1 rounded-xl border border-white/[0.08] bg-white/[0.03]">
                  <ModeButton active={clipMode === "auto"} onClick={() => setClipMode("auto")} icon={<Sparkles className="h-4 w-4" />} label="AI Auto Edit" testId="clip-mode-auto" />
                  <ModeButton active={clipMode === "manual"} onClick={() => setClipMode("manual")} icon={<SlidersHorizontal className="h-4 w-4" />} label="Manual Clips" testId="clip-mode-manual" />
                </div>
                {clipMode === "auto" ? (
                  <AutoEditPanel scenes={scenes} settings={settings} onChange={setSettings} artistName={artistName} songTitle={songTitle} />
                ) : (
                  <ClipsSection scenes={scenes} setScenes={setScenes} settings={settings} setSettings={setSettings} />
                )}
              </div>
            )}

            {tab === "timeline" && (
              <ClipSequencePlayer
                scenes={scenes.filter((s) => s.approved && sceneHasClip(s))}
                allScenes={scenes}
                title="Timeline Preview"
                emptyTitle="No approved clips to preview yet."
                emptyHint="Generate Runway clips on your scenes, then approve them — approved clips play here in order."
              />
            )}

            {tab === "music" && (
              <MusicStudio settings={settings} onChange={setSettings} artistName={artistName} songTitle={songTitle} />
            )}

            {tab === "captions" && (
              <CaptionsSection settings={settings} setSettings={setSettings} />
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

function ModeButton({
  active, onClick, icon, label, testId,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors ${
        active ? "bg-primary text-black" : "text-white/50 hover:text-white/80"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatusChecklist({
  planLoaded, clipsLoaded, audioLoaded, timelineReady, exportReady,
}: {
  planLoaded: boolean; clipsLoaded: boolean; audioLoaded: boolean; timelineReady: boolean; exportReady: boolean;
}) {
  const items: { label: string; done: boolean }[] = [
    { label: "Music video plan loaded", done: planLoaded },
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
              <p className={`text-[10px] font-bold uppercase tracking-wider ${item.done ? "text-green-400/80" : "text-white/30"}`}>{item.done ? "Yes" : "No"}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="flex items-center gap-1.5 text-xs text-white/40"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>;
  if (state === "saved") return <span className="flex items-center gap-1.5 text-xs text-green-400/80"><Check className="h-3.5 w-3.5" /> Saved</span>;
  if (state === "error") return <span className="flex items-center gap-1.5 text-xs text-red-400/80"><CloudOff className="h-3.5 w-3.5" /> Save failed</span>;
  return null;
}

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
