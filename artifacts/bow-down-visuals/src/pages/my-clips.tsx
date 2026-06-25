import { useEffect, useState } from "react";
import { Link } from "wouter";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import {
  Video, ArrowLeft, Loader2, Trash2, Copy, Check,
  Calendar, Film, AlertCircle, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

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

function ClipCard({ clip, onDelete }: { clip: GeneratedClip; onDelete: (id: string) => void }) {
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

export default function MyClips() {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const [clips, setClips] = useState<GeneratedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-yellow-600/6 rounded-full blur-[100px]" />
      </div>

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
                <Video className="h-4 w-4" /> Make a Music Video
              </Button>
            </Link>
          </div>
        )}

        {/* Grid */}
        {!loading && clips.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clips.map((clip) => (
              <ClipCard key={clip.id} clip={clip} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
