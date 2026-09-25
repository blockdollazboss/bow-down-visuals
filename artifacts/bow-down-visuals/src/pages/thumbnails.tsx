import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import {
  Image as ImageIcon, ArrowLeft, Loader2, Trash2, Download,
  X, Calendar, Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";

interface LibraryThumbnail {
  id: string;
  thumbnail_url: string | null;
  artist_name: string | null;
  song_title: string | null;
  action_label: string | null;
  credits_used: number | null;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function Thumbnails() {
  usePageTitle("Thumbnail Library", "Browse and manage your generated thumbnails.");
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [thumbnails, setThumbnails] = useState<LibraryThumbnail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LibraryThumbnail | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/thumbnails", { headers });
      if (!res.ok) throw new Error("Failed to load thumbnails");
      const data = await res.json();
      setThumbnails(data.thumbnails ?? []);
    } catch {
      setError("Could not load your thumbnail library.");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/thumbnails/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Delete failed");
      setThumbnails((prev) => prev.filter((t) => t.id !== id));
      if (lightbox?.id === id) setLightbox(null);
      setConfirmDeleteId(null);
      toast({ title: "Removed from library" });
    } catch {
      toast({ title: "Could not delete", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>
      <div className="relative z-10 max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" /> Back to Dashboard
        </Link>

        <div className="mb-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
                <ImageIcon className="h-5 w-5 text-primary" />
              </div>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">Thumbnail Library</h1>
            <p className="text-white/50 text-lg max-w-2xl">Every AI thumbnail you've generated, saved and ready to download.</p>
          </div>
          <Link href="/thumbnail">
            <Button className="gold-glow font-bold rounded-xl gap-2">
              <Sparkles className="h-4 w-4" /> Make a Thumbnail
            </Button>
          </Link>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && thumbnails.length === 0 && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-12 text-center">
            <ImageIcon className="h-10 w-10 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 font-medium mb-2">No thumbnails yet</p>
            <p className="text-white/30 text-sm mb-6">Generate your first AI thumbnail and it'll live here forever.</p>
            <Link href="/thumbnail">
              <Button className="gold-glow font-bold rounded-xl">Open Thumbnail Maker</Button>
            </Link>
          </div>
        )}

        {!loading && !error && thumbnails.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {thumbnails.map((t) => (
              <div
                key={t.id}
                className="group rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-primary/30 transition-colors"
              >
                <button
                  onClick={() => setLightbox(t)}
                  className="block w-full aspect-video bg-black/40 overflow-hidden cursor-pointer"
                  aria-label={`View ${t.song_title ?? "thumbnail"} full size`}
                >
                  {t.thumbnail_url ? (
                    <img
                      src={t.thumbnail_url}
                      alt={t.action_label ?? "AI-generated thumbnail"}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-white/15" />
                    </div>
                  )}
                </button>
                <div className="p-4">
                  <p className="text-white font-semibold text-sm truncate">
                    {t.song_title ?? t.action_label ?? "Untitled thumbnail"}
                  </p>
                  <p className="text-white/40 text-xs mt-1 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" /> {formatDate(t.created_at)}
                    {t.artist_name && <span className="text-white/25">· {t.artist_name}</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    {t.thumbnail_url && (
                      <a href={t.thumbnail_url} download target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-1.5">
                          <Download className="h-3.5 w-3.5" /> Download
                        </Button>
                      </a>
                    )}
                    {confirmDeleteId === t.id ? (
                      <span className="flex items-center gap-2 ml-auto">
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={deletingId === t.id}
                          className="text-xs font-bold text-red-400 hover:text-red-300 px-2 py-1"
                        >
                          {deletingId === t.id ? "Removing…" : "Confirm remove"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-white/40 hover:text-white px-2 py-1"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(t.id)}
                        title="Remove from library (the file itself is never deleted)"
                        className="ml-auto flex items-center gap-1.5 text-xs text-white/35 hover:text-red-400 transition-colors px-2 py-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-5xl w-full rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-3 right-3 z-10 h-9 w-9 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            {lightbox.thumbnail_url && (
              <img
                src={lightbox.thumbnail_url}
                alt={lightbox.action_label ?? "AI-generated thumbnail"}
                className="w-full max-h-[75vh] object-contain bg-black"
              />
            )}
            <div className="p-4 md:p-5 flex items-center gap-3 flex-wrap border-t border-white/[0.06]">
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">
                  {lightbox.song_title ?? lightbox.action_label ?? "Untitled thumbnail"}
                </p>
                <p className="text-white/40 text-xs mt-0.5">
                  {formatDate(lightbox.created_at)}
                  {lightbox.artist_name && ` · ${lightbox.artist_name}`}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {lightbox.thumbnail_url && (
                  <a href={lightbox.thumbnail_url} download target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-1.5">
                      <Download className="h-3.5 w-3.5" /> Download
                    </Button>
                  </a>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(lightbox.id)}
                  disabled={deletingId === lightbox.id}
                  className="border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {deletingId === lightbox.id ? "Removing…" : "Remove"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
