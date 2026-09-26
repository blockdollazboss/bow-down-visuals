import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  FolderOpen, Trash2, Loader2, Music, Video, Film, Download,
  Image as ImageIcon, Mic2, Copy, Check, X, ArrowLeft, FileText, FileDown, BarChart2,
  FileEdit, Play, ExternalLink, Clock, RefreshCcw, History,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { downloadTxt, downloadPdf } from "@/lib/export-utils";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { MusicVideoTimeline } from "@/components/MusicVideoTimeline";
import { OpenVideoEditorButton } from "@/components/OpenVideoEditorButton";
import type { SceneData } from "@/lib/scene-parser";
import { deriveProjectContext } from "@/lib/prompt-improve";
import { usePageTitle } from "@/hooks/use-page-title";

/** Project types that can be opened in the Video Editor. */
function isVideoProject(projectType: string): boolean {
  return projectType === "Make a Music Video" || projectType === "Make Song + Video";
}

/* Display names for project types — stored values stay stable so old
   projects keep working; only what the user sees changes. */
const TYPE_DISPLAY_NAMES: Record<string, string> = {
  "Make Song + Video": "Start from Scratch",
  "Make a Music Video": "Video for My Song",
};
function displayProjectType(projectType: string): string {
  return TYPE_DISPLAY_NAMES[projectType] ?? projectType;
}

interface ExportRecord {
  final_video_url: string;
  export_status: string;
  export_created_at: string;
  clips_used: number;
  audio_used: boolean;
  timeline_order?: string[];
}

interface Project {
  id: string;
  title: string;
  project_type: string;
  artist_name: string | null;
  song_title: string | null;
  genre: string | null;
  mood: string | null;
  input_data: Record<string, unknown> | null;
  output_data: {
    result?: string;
    songStructure?: SongStructure;
    scenes?: SceneData[];
    final_video_url?: string;
    export_status?: string;
    export_created_at?: string;
    clips_used?: number;
    audio_used?: boolean;
    timeline_order?: string[];
  } | null;
  credits_used: number;
  created_at: string;
}

function extractLyricsFromProject(project: Project): string | null {
  const inputLyrics = project.input_data?.["lyrics"];
  if (typeof inputLyrics === "string" && inputLyrics.length > 10) return inputLyrics;
  const inputExisting = project.input_data?.["existingLyrics"];
  if (typeof inputExisting === "string" && inputExisting.length > 10) return inputExisting;
  const result = project.output_data?.result ?? "";
  const match = result.match(/##\s*FULL LYRICS\s*\n([\s\S]+?)(?=\n##|$)/i);
  if (match) {
    const extracted = match[1].trim();
    if (extracted.length > 10) return extracted;
  }
  return null;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  "Make a Song":       <Music className="h-4 w-4" />,
  "Make a Music Video":<Video className="h-4 w-4" />,
  "Make Song + Video": <Mic2 className="h-4 w-4" />,
  "Promo Clip Maker":  <Film className="h-4 w-4" />,
  "Thumbnail Maker":   <ImageIcon className="h-4 w-4" />,
};

const TYPE_COLORS: Record<string, string> = {
  "Make a Song":        "text-yellow-400",
  "Make a Music Video": "text-blue-400",
  "Make Song + Video":  "text-pink-400",
  "Promo Clip Maker":   "text-green-400",
  "Thumbnail Maker":    "text-yellow-400",
};

/* ─── Result Modal ─── */
function ResultModal({
  project,
  onClose,
  onScenesSaved,
  onExportComplete,
}: {
  project: Project;
  onClose: () => void;
  onScenesSaved?: (scenes: SceneData[]) => void;
  onExportComplete?: (record: ExportRecord) => void;
}) {
  const { getAccessToken } = useAuth();
  const content = project.output_data?.result ?? "";
  const [copied, setCopied] = useState(false);
  const [localSongStructure, setLocalSongStructure] = useState<SongStructure | null>(
    project.output_data?.songStructure ?? null
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [modalScenes, setModalScenes] = useState<SceneData[]>(project.output_data?.scenes ?? []);

  const audioUrl =
    (project.input_data?.["audioUrl"] as string | undefined) ??
    (project.input_data?.["audio_url"] as string | undefined) ??
    null;

  const { videoStyle, platform, artistVault: artistVaultPayload } = deriveProjectContext(
    project.input_data,
  );

  const existingExport: ExportRecord | null =
    project.output_data?.final_video_url
      ? {
          final_video_url: project.output_data.final_video_url,
          export_status: project.output_data.export_status ?? "completed",
          export_created_at: project.output_data.export_created_at ?? "",
          clips_used: project.output_data.clips_used ?? 0,
          audio_used: project.output_data.audio_used ?? false,
          timeline_order: project.output_data.timeline_order,
        }
      : null;

  const lyrics = extractLyricsFromProject(project);

  async function handleAnalyze() {
    if (!lyrics) return;
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
      setLocalSongStructure(data);
    } catch {
      setAnalyzeError("Analysis failed. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleTxt() {
    downloadTxt({
      projectType: project.project_type,
      artistName:  project.artist_name,
      songTitle:   project.song_title,
      genre:       project.genre,
      mood:        project.mood,
      createdAt:   project.created_at,
      result:      content,
    });
  }

  function handlePdf() {
    downloadPdf({
      projectType: project.project_type,
      artistName:  project.artist_name,
      songTitle:   project.song_title,
      genre:       project.genre,
      mood:        project.mood,
      createdAt:   project.created_at,
      result:      content,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm overflow-y-auto p-4 py-10">
      <div className="w-full max-w-3xl bg-[#0d0d0d] border border-white/[0.08] rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div>
            <p className="text-xs text-primary font-bold uppercase tracking-widest mb-0.5">
              {displayProjectType(project.project_type)}
            </p>
            <h2 className="text-lg font-black text-white">{project.title}</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isVideoProject(project.project_type) && (
              <OpenVideoEditorButton
                projectId={project.id}
                size="sm"
                testId="btn-modal-open-video-editor"
              />
            )}
            <Button size="sm" variant="outline" onClick={handleCopy}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2"
              data-testid="btn-modal-copy">
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied!" : "Copy All"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleTxt}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2"
              data-testid="btn-modal-txt">
              <FileText className="h-4 w-4" /> TXT
            </Button>
            <Button size="sm" variant="outline" onClick={handlePdf}
              className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 gap-2"
              data-testid="btn-modal-pdf">
              <FileDown className="h-4 w-4" /> PDF
            </Button>
            <button onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-colors"
              data-testid="btn-modal-close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Analyze Song Sections (shown when lyrics exist) */}
        {lyrics && (
          <div className="px-6 pt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors border border-primary/25 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {analyzing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing...</>
                ) : localSongStructure ? (
                  <><BarChart2 className="h-4 w-4" /> Re-analyze Sections</>
                ) : (
                  <><BarChart2 className="h-4 w-4" /> Find Hook &amp; Verses</>
                )}
              </button>
              {localSongStructure && !analyzing && (
                <span className="text-xs text-primary/60 flex items-center gap-1.5">
                  <Check className="h-3 w-3" /> Analysis complete
                </span>
              )}
              {analyzeError && <p className="text-xs text-red-400/80">{analyzeError}</p>}
            </div>
            {localSongStructure && (
              <div className="mt-4">
                <SongSectionAnalysis analysis={localSongStructure} />
              </div>
            )}
          </div>
        )}

        {/* Music Video Timeline (shown when scenes were saved with the project) */}
        {modalScenes.length > 0 && (
          <div className="px-6 pb-4">
            <MusicVideoTimeline
              scenes={modalScenes}
              onScenesChange={setModalScenes}
              projectId={project.id}
              audioUrl={audioUrl}
              onSaveSuccess={() => onScenesSaved?.(modalScenes)}
              existingExport={existingExport}
              onExportComplete={onExportComplete}
              artistVault={artistVaultPayload}
              videoStyle={videoStyle}
              platform={platform}
            />
          </div>
        )}

        <div className="p-6">
          {content ? (
            <pre className="whitespace-pre-wrap font-sans text-sm text-white/70 leading-relaxed">
              {content}
            </pre>
          ) : (
            <p className="text-white/30 italic text-sm">No content saved.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Project Card ─── */
function ProjectCard({
  project,
  onDelete,
  onOpen,
}: {
  project: Project;
  onDelete: (id: string) => void;
  onOpen: (project: Project) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const content = project.output_data?.result ?? "";
  const preview = content.slice(0, 260).replace(/##\s+/g, "").trim();
  const date = new Date(project.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const displayTitle =
    project.title ||
    [project.artist_name, project.song_title].filter(Boolean).join(" — ") ||
    project.project_type;

  const iconColor = TYPE_COLORS[project.project_type] ?? "text-primary";
  const icon = TYPE_ICONS[project.project_type] ?? <FolderOpen className="h-4 w-4" />;

  function handleDelete() {
    if (!confirm(`Delete "${displayTitle}"? This cannot be undone.`)) return;
    setDeleting(true);
    onDelete(project.id);
  }

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-primary/20 transition-all overflow-hidden ${
        deleting ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <div className="p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={iconColor}>{icon}</span>
              <span className="text-xs font-semibold text-white/40">{displayProjectType(project.project_type)}</span>
              <span className="text-white/15 text-xs">·</span>
              <span className="text-xs text-white/30">{date}</span>
              {project.credits_used > 0 && (
                <Badge className="text-[10px] border-white/10 bg-white/5 text-white/35 ml-1">
                  {project.credits_used} credit{project.credits_used !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <h3 className="text-base font-bold text-white truncate">{displayTitle}</h3>
            {(project.genre || project.mood) && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {project.genre && (
                  <span className="text-[11px] bg-white/[0.04] border border-white/[0.07] text-white/40 px-2 py-0.5 rounded-full">
                    {project.genre}
                  </span>
                )}
                {project.mood && (
                  <span className="text-[11px] bg-white/[0.04] border border-white/[0.07] text-white/40 px-2 py-0.5 rounded-full">
                    {project.mood}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isVideoProject(project.project_type) && (
              <OpenVideoEditorButton
                projectId={project.id}
                size="sm"
                className="h-8 px-3 text-xs"
                testId={`btn-open-video-editor-card-${project.id}`}
              />
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpen(project)}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 h-8 px-3 text-xs gap-1.5"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Open
            </Button>
            <button
              onClick={handleDelete}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/5 transition-colors"
              title="Delete project"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {(() => {
          const savedScenes = (project.output_data?.scenes ?? []) as { demoClipUrl?: string | null; provider?: string | null }[];
          const clipCount = savedScenes.filter((s) => s.demoClipUrl).length;
          if (clipCount === 0) return null;
          return (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400">
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                {clipCount} Runway clip{clipCount !== 1 ? "s" : ""} saved
              </span>
            </div>
          );
        })()}

        {preview && (
          <p className="text-white/35 text-sm leading-relaxed mt-3 line-clamp-2">{preview}</p>
        )}
      </div>
    </div>
  );
}

/* ─── Draft types ─── */
interface DraftRow {
  id: string;
  workflow_type: string;
  title: string | null;
  updated_at: string;
  draft_data: {
    formValues?: Record<string, string>;
    rawResult?: string;
    scenes?: SceneData[];
  };
}

interface ClipRow {
  id: string;
  title: string | null;
  prompt: string | null;
  final_prompt: string | null;
  video_url: string | null;
  runway_job_id: string | null;
  project_id: string | null;
  status: string;
  created_at: string;
}

const WORKFLOW_LABELS: Record<string, string> = {
  "make-video":    "Video for My Song",
  "song-and-video": "Start from Scratch",
};
const WORKFLOW_PATHS: Record<string, string> = {
  "make-video":    "/make-video",
  "song-and-video": "/song-and-video",
};

/* ─── Draft card ─── */
function DraftCard({ draft, onDelete }: { draft: DraftRow; onDelete: (id: string) => void }) {
  const [, navigate] = useLocation();
  const [deleting, setDeleting] = useState(false);
  const date = new Date(draft.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = new Date(draft.updated_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const label = WORKFLOW_LABELS[draft.workflow_type] ?? draft.workflow_type;
  const path  = WORKFLOW_PATHS[draft.workflow_type] ?? "/dashboard";
  const title = draft.title ?? draft.draft_data?.formValues?.["artistName"] ?? "Unsaved Draft";

  function handleRecover() {
    navigate(path);
  }

  function handleDelete() {
    if (!confirm(`Delete this draft? This cannot be undone.`)) return;
    setDeleting(true);
    onDelete(draft.id);
  }

  function handleDownload() {
    try {
      const blob = new Blob([JSON.stringify(draft.draft_data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `bdv-draft-${draft.id.slice(0,8)}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }

  return (
    <div className={`rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.03] p-5 transition-all ${deleting ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <FileEdit className="h-3.5 w-3.5 text-yellow-400/70 shrink-0" />
            <span className="text-[11px] font-semibold text-yellow-400/60">{label}</span>
            <span className="text-white/15 text-xs">·</span>
            <Clock className="h-3 w-3 text-white/25 shrink-0" />
            <span className="text-xs text-white/30">{date} {time}</span>
          </div>
          <h3 className="text-base font-bold text-white truncate">{title}</h3>
          {draft.draft_data?.rawResult && (
            <p className="text-xs text-green-400/60 mt-1 flex items-center gap-1">
              <Check className="h-3 w-3" /> Generated content included
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button onClick={handleDownload} title="Download Backup JSON"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors">
            <Download className="h-4 w-4" />
          </button>
          <Button size="sm" onClick={handleRecover}
            className="h-8 px-3 text-xs gap-1.5 bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 hover:bg-yellow-500/25">
            <RefreshCcw className="h-3.5 w-3.5" /> Recover
          </Button>
          <button onClick={handleDelete}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/5 transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Clip card ─── */
function ClipCard({ clip, onDelete }: { clip: ClipRow; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const date = new Date(clip.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  function handleDelete() {
    if (!confirm("Delete this clip? This cannot be undone.")) return;
    setDeleting(true);
    onDelete(clip.id);
  }

  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden transition-all ${deleting ? "opacity-40 pointer-events-none" : ""}`}>
      {clip.video_url && (
        <div className="aspect-video bg-black">
          <video
            src={clip.video_url}
            className="w-full h-full object-cover"
            controls
            preload="metadata"
          />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white/40 mb-1">{date}</p>
            {clip.title && <p className="text-sm font-bold text-white truncate">{clip.title}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {clip.video_url && (
              <a href={clip.video_url} target="_blank" rel="noopener noreferrer"
                className="h-7 w-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
                title="Open video URL">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {clip.project_id && (
              <Link href={`/video-editor?project=${clip.project_id}`}>
                <button className="h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] text-white/40 hover:text-primary hover:bg-primary/5 transition-colors font-semibold">
                  <Play className="h-3 w-3" /> Editor
                </button>
              </Link>
            )}
            <button onClick={handleDelete}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/5 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {clip.prompt && (
          <button onClick={() => setShowPrompt(!showPrompt)}
            className="text-[11px] text-white/30 hover:text-white/50 transition-colors text-left w-full">
            {showPrompt ? "Hide prompt ▲" : "Show prompt ▼"}
          </button>
        )}
        {showPrompt && clip.prompt && (
          <p className="text-xs text-white/45 mt-2 leading-relaxed line-clamp-4">{clip.prompt}</p>
        )}
      </div>
    </div>
  );
}

interface GenerationHistoryRow {
  id:              string;
  generation_type: string | null;
  credits_used:    number | null;
  save_status:     string;
  refunded:        boolean;
  project_id:      string | null;
  created_at:      string;
  artist_name:     string | null;
  song_title:      string | null;
  video_url:       string | null;
  thumbnail_url:   string | null;
  scene_id:        string | null;
  action_label:    string | null;
  result_preview:  string | null;
  result_content:  string | null;
}

/* ─── Page ─── */
export default function MyProjects() {
  usePageTitle("My Projects", "All your songs, videos, and creative projects in one place.");
  const { user, getAccessToken } = useAuth();
  const [tab, setTab] = useState<"projects" | "drafts" | "clips" | "history">("projects");

  const [history, setHistory]             = useState<GenerationHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError]   = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projLoading, setProjLoading] = useState(true);
  const [projError, setProjError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);

  const [clips, setClips] = useState<ClipRow[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [clipsError, setClipsError] = useState<string | null>(null);

  const [openProject, setOpenProject] = useState<Project | null>(null);

  useEffect(() => {
    if (user) {
      void loadProjects();
      void loadDrafts();
      void loadClips();
      void loadHistory();
    }
  }, [user]);

  async function loadProjects() {
    setProjLoading(true);
    setProjError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/projects", { headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!res.ok) throw new Error("Failed to load projects");
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects);
    } catch (err) {
      setProjError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setProjLoading(false);
    }
  }

  async function loadDrafts() {
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/drafts", { headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!res.ok) throw new Error("Failed to load drafts");
      const data = (await res.json()) as { drafts: DraftRow[] };
      setDrafts(data.drafts);
    } catch (err) {
      setDraftsError(err instanceof Error ? err.message : "Failed to load drafts");
    } finally {
      setDraftsLoading(false);
    }
  }

  async function loadClips() {
    setClipsLoading(true);
    setClipsError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generated-clips", { headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!res.ok) throw new Error("Failed to load clips");
      const data = (await res.json()) as { clips: ClipRow[] };
      setClips(data.clips);
    } catch (err) {
      setClipsError(err instanceof Error ? err.message : "Failed to load clips");
    } finally {
      setClipsLoading(false);
    }
  }

  async function handleDeleteProject(id: string) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/projects/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` } });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (openProject?.id === id) setOpenProject(null);
    } catch { alert("Failed to delete project. Please try again."); }
  }

  async function handleDeleteDraft(id: string) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/drafts/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` } });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch { alert("Failed to delete draft. Please try again."); }
  }

  async function handleDeleteClip(id: string) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/generated-clips/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` } });
      setClips((prev) => prev.filter((c) => c.id !== id));
    } catch { alert("Failed to delete clip. Please try again."); }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generation-history", { headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!res.ok) throw new Error("Failed to load generation history");
      const data = (await res.json()) as { history: GenerationHistoryRow[] };
      setHistory(data.history);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load generation history");
    } finally {
      setHistoryLoading(false);
    }
  }

  const TABS = [
    { id: "projects" as const, label: "Projects",          count: projects.length },
    { id: "drafts"   as const, label: "Drafts",            count: drafts.length },
    { id: "clips"    as const, label: "Generated Clips",   count: clips.length },
    { id: "history"  as const, label: "Generation History", count: history.length },
  ];

  return (
    <div className="min-h-screen bg-black text-white">

      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      {openProject && (
        <ResultModal
          project={openProject}
          onClose={() => setOpenProject(null)}
          onScenesSaved={(savedScenes) => {
            const up = { ...openProject, output_data: { ...openProject.output_data, scenes: savedScenes } };
            setOpenProject(up);
            setProjects((prev) => prev.map((p) => (p.id === openProject.id ? up : p)));
          }}
          onExportComplete={(record) => {
            const up = { ...openProject, output_data: { ...openProject.output_data, ...record } };
            setOpenProject(up);
            setProjects((prev) => prev.map((p) => (p.id === openProject.id ? up : p)));
          }}
        />
      )}

      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-10 md:py-14">

        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <FolderOpen className="h-5 w-5 text-white" />
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2">My Projects</h1>
          <p className="text-white/50 text-base max-w-2xl">
            Saved projects, unsaved drafts, and all your generated Runway clips — all in one place.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-8 border-b border-white/[0.06] pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
                tab === t.id
                  ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  tab === t.id ? "bg-primary/20 text-primary" : "bg-white/5 text-white/30"
                }`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── PROJECTS TAB ── */}
        {tab === "projects" && (
          projLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            </div>
          ) : projError ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-red-400 font-semibold">{projError}</p>
              <Button onClick={() => void loadProjects()} variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10">Try again</Button>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-24 space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
                <FolderOpen className="h-8 w-8 text-white/20" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">No saved projects yet</h2>
                <p className="text-white/45 max-w-xs">Generate content and click Save Project — it will appear here.</p>
              </div>
              <Link href="/dashboard">
                <Button className="gold-glow font-semibold gap-2"><Music className="h-4 w-4" /> Go to Dashboard</Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} onDelete={handleDeleteProject} onOpen={setOpenProject} />
              ))}
            </div>
          )
        )}

        {/* ── DRAFTS TAB ── */}
        {tab === "drafts" && (
          draftsLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            </div>
          ) : draftsError ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-red-400 font-semibold">{draftsError}</p>
              <Button onClick={() => void loadDrafts()} variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10">Try again</Button>
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-24 space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
                <FileEdit className="h-8 w-8 text-white/20" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">No drafts saved</h2>
                <p className="text-white/45 max-w-xs">
                  Drafts are saved automatically as you work. Start a project and your progress will appear here.
                </p>
              </div>
              <Link href="/dashboard">
                <Button className="gold-glow font-semibold gap-2"><Music className="h-4 w-4" /> Start a Project</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-white/30 mb-4">
                Drafts are auto-saved as you work. Click Recover to return to that project and pick up where you left off.
              </p>
              {drafts.map((draft) => (
                <DraftCard key={draft.id} draft={draft} onDelete={handleDeleteDraft} />
              ))}
            </div>
          )
        )}

        {/* ── GENERATED CLIPS TAB ── */}
        {tab === "clips" && (
          clipsLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            </div>
          ) : clipsError ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-red-400 font-semibold">{clipsError}</p>
              <Button onClick={() => void loadClips()} variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10">Try again</Button>
            </div>
          ) : clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-24 space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
                <Video className="h-8 w-8 text-white/20" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">No generated clips yet</h2>
                <p className="text-white/45 max-w-xs">
                  Generate Runway clips in your music video project — they'll be saved here automatically.
                </p>
              </div>
              <Link href="/make-video">
                <Button className="gold-glow font-semibold gap-2"><Video className="h-4 w-4" /> Video for My Song</Button>
              </Link>
            </div>
          ) : (
            <div>
              <p className="text-xs text-white/30 mb-5">
                {clips.length} clip{clips.length !== 1 ? "s" : ""} saved — auto-saved the moment each Runway job completes.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {clips.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} onDelete={handleDeleteClip} />
                ))}
              </div>
            </div>
          )
        )}

        {/* ── GENERATION HISTORY TAB ── */}
        {tab === "history" && (
          historyLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            </div>
          ) : historyError ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-red-400 font-semibold">{historyError}</p>
              <Button onClick={() => void loadHistory()} variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10">Try again</Button>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-24 space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
                <History className="h-8 w-8 text-white/20" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">No generation history yet</h2>
                <p className="text-white/45 max-sm:max-w-xs">
                  No generation history yet. Your AI generations will appear here after you create something.
                </p>
              </div>
              <Link href="/dashboard">
                <Button className="gold-glow font-semibold gap-2"><Music className="h-4 w-4" /> Start Generating</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-white/30 mb-4">
                {history.length} generation{history.length !== 1 ? "s" : ""} logged — newest first.
              </p>
              {history.map((row) => {
                const isClip = row.generation_type === "runway_video_clip" || row.generation_type === "lip_sync_clip";
                const isThumbnail = row.generation_type === "thumbnail";
                const typeLabel =
                  row.action_label ??
                  (row.generation_type === "runway_video_clip"    ? "Runway Video Clip"    :
                   row.generation_type === "lip_sync_clip"        ? "Lip Sync Clip"        :
                   row.generation_type === "thumbnail"            ? "Thumbnail"            :
                   row.generation_type === "lyrics"               ? "Lyrics"               :
                   row.generation_type === "video_plan"           ? "Video Plan"           :
                   row.generation_type === "scene_prompt"         ? "Scene Prompt"         :
                   row.generation_type === "captions"             ? "Captions"             :
                   row.generation_type === "promo_clip"           ? "Promo Clip"           :
                   row.generation_type === "thumbnail_prompt"     ? "Thumbnail Prompt"     :
                   row.generation_type ?? "Generation");
                const projectLabel = row.artist_name && row.song_title
                  ? `${row.artist_name} — ${row.song_title}`
                  : row.artist_name ?? row.song_title ?? null;
                const statusColor =
                  row.save_status === "saved"       ? "text-green-400 bg-green-400/10 border-green-400/20" :
                  row.save_status === "save_failed" ? "text-red-400 bg-red-400/10 border-red-400/20"       :
                  "text-white/40 bg-white/5 border-white/10";
                const statusLabel =
                  row.save_status === "saved"       ? "Saved" :
                  row.save_status === "save_failed" ? "Save Failed" :
                  row.save_status === "charged"     ? "Generated" : row.save_status;
                return (
                  <div key={row.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
                    {/* Clip video preview (if video_url exists) */}
                    {isClip && row.video_url && (
                      <div className="rounded-lg overflow-hidden bg-black border border-white/[0.06]">
                        <video
                          src={row.video_url}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full max-h-56 object-contain"
                        />
                      </div>
                    )}

                    {/* Thumbnail image preview */}
                    {isThumbnail && row.thumbnail_url && (
                      <div className="rounded-lg overflow-hidden bg-black border border-white/[0.06]">
                        <img
                          src={row.thumbnail_url}
                          alt={typeLabel}
                          className="w-full max-h-56 object-contain"
                        />
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white/70">{typeLabel}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>{statusLabel}</span>
                          {row.refunded && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-amber-400 bg-amber-400/10 border-amber-400/20">Credits Refunded</span>
                          )}
                          {row.credits_used != null && row.credits_used > 0 && (
                            <span className="text-[10px] text-white/30">{row.credits_used} credit{row.credits_used !== 1 ? "s" : ""}</span>
                          )}
                        </div>
                        {projectLabel && (
                          <p className="text-sm font-semibold text-white truncate">{projectLabel}</p>
                        )}
                        {!isClip && row.result_preview && (
                          <p className="text-[11px] text-white/30 line-clamp-2">{row.result_preview}</p>
                        )}
                        <p className="text-[10px] text-white/20">{new Date(row.created_at).toLocaleString()}</p>
                      </div>

                      <div className="flex flex-row sm:flex-col gap-2 shrink-0 flex-wrap">
                        {/* Preview Clip button */}
                        {row.video_url && (
                          <a
                            href={row.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button size="sm" variant="outline"
                              className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 text-xs gap-1.5 w-full">
                              <Play className="h-3.5 w-3.5" /> Preview Clip
                            </Button>
                          </a>
                        )}

                        {/* Open Project button */}
                        {row.project_id && (
                          <Link href={`/video-editor?project=${row.project_id}`}>
                            <Button size="sm" variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 text-xs gap-1.5 w-full">
                              <FolderOpen className="h-3.5 w-3.5" /> Open Project
                            </Button>
                          </Link>
                        )}

                        {/* Copy Content (text generations) */}
                        {!isClip && row.result_content && (
                          <Button size="sm" variant="outline"
                            className="border-white/10 bg-white/5 text-white hover:bg-white/10 text-xs gap-1.5"
                            onClick={() => { void navigator.clipboard.writeText(row.result_content ?? ""); }}>
                            <Copy className="h-3.5 w-3.5" /> Copy Content
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

      </div>
    </div>
  );
}
