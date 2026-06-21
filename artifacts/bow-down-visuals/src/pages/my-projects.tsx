import { useEffect, useState } from "react";
import { Link } from "wouter";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FolderOpen, Trash2, Loader2, Music, Video, Film, Image as ImageIcon,
  Mic2, Copy, CheckCheck, ChevronDown, ChevronUp,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Project {
  id: string;
  title: string;
  type: string;
  content: string;
  credits_used: number;
  created_at: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  "Make a Song": <Music className="h-4 w-4" />,
  "Make a Music Video": <Video className="h-4 w-4" />,
  "Make Song + Video": <Mic2 className="h-4 w-4" />,
  "Promo Clip Maker": <Film className="h-4 w-4" />,
  "Thumbnail Maker": <ImageIcon className="h-4 w-4" />,
};

const TYPE_COLORS: Record<string, string> = {
  "Make a Song": "text-purple-400",
  "Make a Music Video": "text-blue-400",
  "Make Song + Video": "text-pink-400",
  "Promo Clip Maker": "text-green-400",
  "Thumbnail Maker": "text-yellow-400",
};

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const preview = project.content.slice(0, 280).replace(/##\s+/g, "").trim();
  const date = new Date(project.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  function handleCopy() {
    navigator.clipboard.writeText(project.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDelete() {
    if (!confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    onDelete(project.id);
  }

  const iconColor = TYPE_COLORS[project.type] ?? "text-primary";
  const icon = TYPE_ICONS[project.type] ?? <FolderOpen className="h-4 w-4" />;

  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-primary/20 transition-all overflow-hidden ${deleting ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="p-5 md:p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={iconColor}>{icon}</span>
              <span className="text-xs font-semibold text-white/40">{project.type}</span>
              <span className="text-white/15 text-xs">·</span>
              <span className="text-xs text-white/30">{date}</span>
              <Badge className="text-[10px] border-white/10 bg-white/5 text-white/40 ml-1">
                {project.credits_used} credit{project.credits_used !== 1 ? "s" : ""}
              </Badge>
            </div>
            <h3 className="text-base font-bold text-white truncate">{project.title}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleCopy}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-white/5 transition-colors"
              title="Copy content"
            >
              {copied ? <CheckCheck className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              onClick={handleDelete}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/5 transition-colors"
              title="Delete project"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="text-white/45 text-sm leading-relaxed line-clamp-3">{preview}</p>

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 mt-3 text-xs font-semibold text-primary/60 hover:text-primary transition-colors"
        >
          {expanded
            ? <><ChevronUp className="h-3.5 w-3.5" /> Hide full content</>
            : <><ChevronDown className="h-3.5 w-3.5" /> Show full content</>
          }
        </button>
      </div>

      {expanded && (
        <div className="px-5 md:px-6 pb-5 border-t border-white/[0.05] pt-4">
          <pre className="text-white/55 text-sm leading-relaxed whitespace-pre-wrap font-sans">{project.content}</pre>
        </div>
      )}
    </div>
  );
}

export default function MyProjects() {
  const { user, getAccessToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    } catch {
      alert("Failed to delete project. Please try again.");
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-purple-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Header */}
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
            Every song, video plan, promo pack, and thumbnail you've generated — all saved here automatically.
          </p>
        </div>

        {/* Content */}
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
              <h2 className="text-xl font-bold text-white">No projects yet</h2>
              <p className="text-white/45 max-w-xs">
                Generate your first song, music video, or promo pack and it will be saved here automatically.
              </p>
            </div>
            <Link href="/dashboard">
              <Button className="purple-glow font-semibold gap-2">
                <Music className="h-4 w-4" /> Go to Dashboard
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/[0.05] text-center">
          <p className="text-white/20 text-sm">© 2026 Bow Down Visuals. Create the Song. Create the Video. Promote the Release.</p>
        </div>
      </div>
    </div>
  );
}
