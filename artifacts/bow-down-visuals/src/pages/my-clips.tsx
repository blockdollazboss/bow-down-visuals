import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Video, ArrowLeft, Loader2, Trash2, Copy, Check,
  Calendar, Film, AlertCircle, X, Layers, ChevronRight,
  CheckCircle2, Link2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";

interface GeneratedClip {
  id: string;
  project_id: string | null;
  scene_id: string | null;
  title: string | null;
  prompt: string | null;
  final_prompt: string | null;
  runway_job_id: string | null;
  video_url: string;
  thumbnail_url: string | null;
  status: string;
  created_at: string;
}

interface ProjectOption {
  id: string;
  title: string;
  artist_name: string | null;
  song_title: string | null;
  output_data: {
    scenes?: SceneItem[];
  } | null;
}

interface SceneItem {
  id: string;
  sceneNumber?: number;
  section?: string;
  timestamp?: string;
  lyricLine?: string;
  demoClipUrl?: string | null;
  generationStatus?: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-primary transition-colors px-2 py-1 rounded hover:bg-primary/10"
    >
      {copied ? <><Check className="h-3 w-3 text-green-400" /> Copied</> : <><Copy className="h-3 w-3" /> Copy URL</>}
    </button>
  );
}

/* ─── Attach Modal ─────────────────────────────────────────────────────────── */
interface AttachModalProps {
  clip: GeneratedClip;
  onClose: () => void;
  onSuccess: (clipId: string) => void;
  getAccessToken: () => Promise<string | null>;
}

function AttachModal({ clip, onClose, getAccessToken, onSuccess }: AttachModalProps) {
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [selectedScene, setSelectedScene] = useState<SceneItem | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachedInfo, setAttachedInfo] = useState<{ section: string | null; index: number } | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/projects", {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) throw new Error("Failed to load projects");
        const data = await res.json() as { projects: ProjectOption[] };
        /* Show ALL projects — the server now handles scenes-missing gracefully */
        const allProjects = data.projects ?? [];
        setProjects(allProjects);

        /* Pre-select project if clip has project_id */
        if (clip.project_id) {
          const match = allProjects.find((p) => p.id === clip.project_id);
          if (match) {
            setSelectedProject(match);
            /* Pre-select scene if clip has scene_id — fall back to first scene */
            const scenes = match.output_data?.scenes ?? [];
            if (clip.scene_id) {
              const sceneMatch = scenes.find((s) => s.id === clip.scene_id);
              if (sceneMatch) {
                setSelectedScene(sceneMatch);
              } else if (scenes.length > 0) {
                /* scene_id stale (scenes were rebuilt) — pick by index guess */
                setSelectedScene(scenes[scenes.length - 1] ?? null);
              }
            }
          }
        }
      } catch {
        toast({ title: "Could not load projects", variant: "destructive" });
      } finally {
        setLoadingProjects(false);
      }
    })();
  }, [clip.project_id, clip.scene_id, getAccessToken, toast]);

  async function handleAttach() {
    if (!selectedProject || !selectedScene) return;
    setAttaching(true);
    setAttachError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/projects/${selectedProject.id}/scene-clip`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          clipUrl:     clip.video_url,
          clipId:      clip.id,
          sceneId:     selectedScene.id,
          sceneNumber: selectedScene.sceneNumber ?? null,
          sceneTitle:  selectedScene.section ?? null,
        }),
      });
      const json = await res.json() as {
        success?: boolean;
        error?: string;
        scene?: { index: number; section: string | null };
      };
      if (!res.ok || !json.success) {
        const errMsg = json.error ?? `Server error ${res.status}`;
        setAttachError(errMsg);
        toast({ title: "Could not attach clip", description: errMsg, variant: "destructive" });
        return;
      }
      setAttachedInfo({ section: json.scene?.section ?? null, index: json.scene?.index ?? 0 });
      onSuccess(clip.id);
      toast({
        title: "Clip attached — Clip Ready!",
        description: `Attached to Scene ${json.scene?.index ?? ""}${json.scene?.section ? ` (${json.scene.section})` : ""}. Open the Video Editor to see it.`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setAttachError(errMsg);
      toast({ title: "Attach failed", description: errMsg, variant: "destructive" });
    } finally {
      setAttaching(false);
    }
  }

  const scenes = selectedProject?.output_data?.scenes ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.10] bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <Link2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Attach to Project Scene</p>
              <p className="text-[11px] text-white/35">No credits charged</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-white/30 hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Clip preview */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-black border border-white/[0.06] overflow-hidden shrink-0">
              <video src={clip.video_url} className="w-full h-full object-cover" muted />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{clip.title || "Runway Clip"}</p>
              <p className="text-[10px] text-white/35">{formatDate(clip.created_at)}</p>
            </div>
          </div>

          {loadingProjects ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-6">
              <Layers className="h-8 w-8 text-white/20 mx-auto mb-2" />
              <p className="text-sm text-white/50 font-medium">No projects with scenes found</p>
              <p className="text-[11px] text-white/30 mt-1">Open the Video Editor and rebuild scenes first.</p>
            </div>
          ) : attachedInfo ? (
            /* Success state */
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-12 w-12 rounded-full bg-green-400/15 border border-green-400/25 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white">Clip Ready</p>
                <p className="text-[11px] text-white/45 mt-0.5">
                  Attached to Scene {attachedInfo.index}{attachedInfo.section ? ` — ${attachedInfo.section}` : ""}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Project selector */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Project</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProject(p); setSelectedScene(null); }}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center justify-between transition-colors ${
                        selectedProject?.id === p.id
                          ? "border-primary/40 bg-primary/10 text-white"
                          : "border-white/[0.07] bg-white/[0.02] text-white/60 hover:text-white hover:border-white/15"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{p.title}</p>
                        {(p.artist_name || p.song_title) && (
                          <p className="text-[10px] text-white/35 truncate">
                            {[p.artist_name, p.song_title].filter(Boolean).join(" — ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className="text-[10px] text-white/30">{(p.output_data?.scenes ?? []).length} scenes</span>
                        {selectedProject?.id === p.id && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Scene selector */}
              {selectedProject && scenes.length === 0 && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-3 text-center">
                  <p className="text-xs font-bold text-amber-400">No scenes saved yet</p>
                  <p className="text-[10px] text-white/35 mt-0.5">
                    Open the Video Editor, load your scenes, then come back and attach.
                  </p>
                  <Link
                    href={`/video-editor?project=${selectedProject.id}`}
                    className="inline-flex items-center gap-1 mt-2 text-[10px] font-bold text-primary hover:underline"
                    onClick={onClose}
                  >
                    <ChevronRight className="h-3 w-3" /> Open Video Editor
                  </Link>
                </div>
              )}
              {selectedProject && scenes.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-white/40 uppercase tracking-wider">Scene</p>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {scenes.map((scene) => {
                      const hasClip = !!scene.demoClipUrl && scene.generationStatus === "completed";
                      return (
                        <button
                          key={scene.id}
                          onClick={() => setSelectedScene(scene)}
                          className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center justify-between transition-colors ${
                            selectedScene?.id === scene.id
                              ? "border-primary/40 bg-primary/10 text-white"
                              : "border-white/[0.07] bg-white/[0.02] text-white/60 hover:text-white hover:border-white/15"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">
                              Scene {scene.sceneNumber ?? "?"}{scene.section ? ` — ${scene.section}` : ""}
                            </p>
                            {scene.timestamp && (
                              <p className="text-[10px] text-white/35">{scene.timestamp}</p>
                            )}
                            {scene.lyricLine && (
                              <p className="text-[10px] text-white/25 truncate mt-0.5 italic">"{scene.lyricLine}"</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {hasClip && (
                              <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-1.5 py-0.5">
                                Has clip
                              </span>
                            )}
                            {selectedScene?.id === scene.id && <Check className="h-3.5 w-3.5 text-primary" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Inline error — shown below scene picker */}
              {attachError && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/[0.05] px-3 py-2.5">
                  <p className="text-[11px] font-bold text-red-400">Could not attach clip</p>
                  <p className="text-[10px] text-white/40 mt-0.5 break-words">{attachError}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!attachedInfo && !loadingProjects && projects.length > 0 && (
          <div className="px-5 pb-4 flex items-center justify-between gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white/40 border border-white/[0.07] bg-white/[0.02] hover:text-white/70 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAttach}
              disabled={!selectedProject || !selectedScene || attaching}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              {attaching ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Attaching…</>
              ) : (
                <><Link2 className="h-4 w-4" /> Attach Clip</>
              )}
            </button>
          </div>
        )}
        {attachedInfo && (
          <div className="px-5 pb-4 flex gap-2">
            <Link href={`/video-editor?project=${selectedProject?.id ?? ""}`} className="flex-1">
              <button className="w-full py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                <ChevronRight className="h-4 w-4" /> Open Video Editor
              </button>
            </Link>
            <button
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl text-sm font-bold text-white/40 border border-white/[0.07] bg-white/[0.02] hover:text-white/70 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Clip Card ────────────────────────────────────────────────────────────── */
function ClipCard({
  clip,
  onDelete,
  onAttach,
}: {
  clip: GeneratedClip;
  onDelete: (id: string) => void;
  onAttach: (clip: GeneratedClip) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] overflow-hidden">
      {/* Video preview */}
      <div className="relative bg-black aspect-[9/16] max-h-72 w-full overflow-hidden">
        <video
          src={clip.video_url}
          controls
          playsInline
          className="w-full h-full object-contain"
        />
      </div>

      {/* Info */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate">
              {clip.title || "Runway Clip"}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Calendar className="h-3 w-3 text-white/30 shrink-0" />
              <p className="text-[11px] text-white/35">{formatDate(clip.created_at)}</p>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-bold text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            Ready
          </span>
        </div>

        {/* Prompt toggle */}
        {clip.prompt && (
          <div>
            <button
              onClick={() => setShowPrompt((s) => !s)}
              className="text-[10px] text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
            >
              <Film className="h-3 w-3" />
              {showPrompt ? "Hide prompt" : "Show prompt"}
            </button>
            {showPrompt && (
              <p className="mt-1.5 text-[11px] text-white/45 leading-relaxed bg-white/[0.02] border border-white/[0.05] rounded-lg px-3 py-2">
                {clip.prompt}
              </p>
            )}
          </div>
        )}

        {/* Attach button */}
        <button
          onClick={() => onAttach(clip)}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold text-primary border border-primary/25 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-colors"
        >
          <Link2 className="h-3.5 w-3.5" />
          Attach to Project Scene
        </button>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1 border-t border-white/[0.05]">
          <CopyBtn text={clip.video_url} />
          <div className="flex items-center gap-1">
            {confirmDelete ? (
              <>
                <span className="text-[10px] text-white/40 mr-1">Delete?</span>
                <button
                  onClick={() => { onDelete(clip.id); setConfirmDelete(false); }}
                  className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors px-2 py-1"
                >Yes</button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[10px] text-white/30 hover:text-white/60 transition-colors px-2 py-1"
                >No</button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-white/25 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/5 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function MyClips() {
  usePageTitle("My Clips", "Your generated promo clips library.");
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const [clips, setClips] = useState<GeneratedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachingClip, setAttachingClip] = useState<GeneratedClip | null>(null);

  const stableGetAccessToken = useCallback(getAccessToken, [getAccessToken]);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/generated-clips", {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { clips: GeneratedClip[] };
        setClips(data.clips ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load clips");
      } finally {
        setLoading(false);
      }
    })();
  }, [getAccessToken]);

  async function handleDelete(id: string) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/generated-clips/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      setClips((prev) => prev.filter((c) => c.id !== id));
      toast({ title: "Clip deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">

      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-yellow-600/6 rounded-full blur-[100px]" />
      </div>

      {/* Attach Modal */}
      {attachingClip && (
        <AttachModal
          clip={attachingClip}
          onClose={() => setAttachingClip(null)}
          getAccessToken={stableGetAccessToken}
          onSuccess={() => { /* toast already shown inside */ }}
        />
      )}

      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Header */}
        <Link href="/my-projects" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to My Projects
        </Link>

        <div className="mb-8 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <Video className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">My Generated Clips</h1>
              <p className="text-white/35 text-sm">
                {loading ? "Loading…" : `${clips.length} clip${clips.length !== 1 ? "s" : ""} generated`}
              </p>
            </div>
          </div>
          <Link href="/make-video">
            <Button className="gold-glow font-bold gap-2">
              <Video className="h-4 w-4" /> Generate New Clip
            </Button>
          </Link>
        </div>

        {/* Explainer */}
        {!loading && clips.length > 0 && (
          <div className="mb-6 flex items-start gap-3 p-3.5 rounded-xl border border-primary/15 bg-primary/5">
            <Link2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[12px] text-white/50 leading-relaxed">
              Use <span className="text-primary font-semibold">Attach to Project Scene</span> on any clip to link it to a scene in your Video Editor — no credits charged.
              Open the Video Editor afterwards to see <span className="text-green-400 font-semibold">Clip Ready</span> on the scene card.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/25 bg-red-500/5">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && clips.length === 0 && (
          <div className="text-center py-20">
            <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Film className="h-7 w-7 text-white/20" />
            </div>
            <h2 className="text-lg font-bold text-white/60 mb-2">No clips yet</h2>
            <p className="text-sm text-white/30 mb-6 max-w-sm mx-auto">
              Generated Runway clips auto-save here. Generate your first clip from the Scene Studio.
            </p>
            <Link href="/make-video">
              <Button className="gold-glow font-bold gap-2">
                <Video className="h-4 w-4" /> Video for My Song
              </Button>
            </Link>
          </div>
        )}

        {/* Grid */}
        {!loading && clips.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                onDelete={handleDelete}
                onAttach={setAttachingClip}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
