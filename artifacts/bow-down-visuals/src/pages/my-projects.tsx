import { useEffect, useState } from "react";
import { Link } from "wouter";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FolderOpen, Trash2, Loader2, Music, Video, Film,
  Image as ImageIcon, Mic2, Copy, Check, X, ArrowLeft, FileText, FileDown, BarChart2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { downloadTxt, downloadPdf } from "@/lib/export-utils";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { MusicVideoTimeline } from "@/components/MusicVideoTimeline";
import type { SceneData } from "@/lib/scene-parser";

interface Project {
  id: string;
  title: string;
  project_type: string;
  artist_name: string | null;
  song_title: string | null;
  genre: string | null;
  mood: string | null;
  input_data: Record<string, unknown> | null;
  output_data: { result?: string; songStructure?: SongStructure; scenes?: SceneData[] } | null;
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
function ResultModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { getAccessToken } = useAuth();
  const content = project.output_data?.result ?? "";
  const [copied, setCopied] = useState(false);
  const [localSongStructure, setLocalSongStructure] = useState<SongStructure | null>(
    project.output_data?.songStructure ?? null
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [modalScenes, setModalScenes] = useState<SceneData[]>(project.output_data?.scenes ?? []);

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
              {project.project_type}
            </p>
            <h2 className="text-lg font-black text-white">{project.title}</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
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
                  <><BarChart2 className="h-4 w-4" /> Analyze Song Sections</>
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
              <span className="text-xs font-semibold text-white/40">{project.project_type}</span>
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

/* ─── Page ─── */
export default function MyProjects() {
  const { user, getAccessToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openProject, setOpenProject] = useState<Project | null>(null);

  useEffect(() => {
    if (user) loadProjects();
  }, [user]);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/projects", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error("Failed to load projects");
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/projects/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (openProject?.id === id) setOpenProject(null);
    } catch {
      alert("Failed to delete project. Please try again.");
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      {openProject && (
        <ResultModal project={openProject} onClose={() => setOpenProject(null)} />
      )}

      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-10 md:py-14">

        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <FolderOpen className="h-5 w-5 text-white" />
            </div>
            {!loading && (
              <Badge className="bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-wide">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            My Projects
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Every song, video plan, promo pack, and thumbnail you've saved — all in one place.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-red-400 font-semibold">{error}</p>
            <Button
              onClick={loadProjects}
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              Try again
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-24 space-y-5">
            <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
              <FolderOpen className="h-8 w-8 text-white/20" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">No saved projects yet</h2>
              <p className="text-white/45 max-w-xs">
                Generate something, then hit Save Project to store it here for later.
              </p>
            </div>
            <Link href="/dashboard">
              <Button className="gold-glow font-semibold gap-2">
                <Music className="h-4 w-4" /> Go to Dashboard
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onDelete={handleDelete}
                onOpen={setOpenProject}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
