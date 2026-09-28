import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Music, Video, Mic, Loader2, Trash2, Download, Eye } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

interface Generation {
  id: string;
  type: string;
  title: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  prompt: string | null;
  credits_spent: number;
  created_at: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <ImageIcon className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  song: <Music className="h-4 w-4" />,
  voice: <Mic className="h-4 w-4" />,
};

const TYPE_LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  song: "Song",
  voice: "Voice",
};

export default function Generations() {
  usePageTitle("My Generations");
  const { getAccessToken } = useAuth();
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/generations", {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (res.ok) {
          const data = await res.json();
          setGenerations(data.generations ?? []);
        }
      } catch {
        /* show empty state */
      } finally {
        setLoading(false);
      }
    })();
  }, [getAccessToken]);

  const filtered = filter === "all"
    ? generations
    : generations.filter((g) => g.type === filter);

  const handleDelete = async (id: string) => {
    if (!confirm("Hide this generation? It will be preserved and can be restored.")) return;
    try {
      const token = await getAccessToken();
      await fetch(`/api/generations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      setGenerations((prev) => prev.filter((g) => g.id !== id));
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="content-panel mx-4 my-4 md:mx-6 md:my-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold text-white mb-2">My Generations</h1>
      <p className="text-white/60 text-sm mb-6">
        Every image, video, song, and voice you generate is automatically saved here.
      </p>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {["all", "image", "video", "song", "voice"].map((t) => (
          <Button
            key={t}
            variant={filter === t ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(t)}
            className={filter === t ? "bg-gold text-black" : ""}
          >
            {t === "all" ? "All" : TYPE_LABELS[t] ?? t}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <ImageIcon className="h-12 w-12 mx-auto text-white/20 mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">No generations yet</h2>
          <p className="text-white/50 text-sm">
            Your AI generations will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((gen) => (
            <div
              key={gen.id}
              className="bg-black/40 rounded-xl overflow-hidden border border-gold/20 hover:border-gold/40 transition-colors"
            >
              {/* Thumbnail */}
              <div className="aspect-square bg-black/60 flex items-center justify-center overflow-hidden">
                {gen.thumbnail_url || gen.file_url ? (
                  gen.type === "video" ? (
                    <video
                      src={gen.file_url ?? undefined}
                      poster={gen.thumbnail_url ?? undefined}
                      className="w-full h-full object-cover"
                      muted
                    />
                  ) : (
                    <img
                      src={gen.thumbnail_url ?? gen.file_url ?? ""}
                      alt={gen.title ?? gen.type}
                      className="w-full h-full object-cover"
                    />
                  )
                ) : (
                  <div className="text-white/20">
                    {TYPE_ICONS[gen.type] ?? <ImageIcon className="h-8 w-8" />}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  {TYPE_ICONS[gen.type]}
                  <span className="text-xs font-semibold text-gold">
                    {TYPE_LABELS[gen.type] ?? gen.type}
                  </span>
                  <span className="text-xs text-white/40 ml-auto">
                    {gen.credits_spent}VB
                  </span>
                </div>
                {gen.title && (
                  <p className="text-sm text-white font-medium truncate mb-1">
                    {gen.title}
                  </p>
                )}
                <p className="text-xs text-white/40 mb-3">
                  {new Date(gen.created_at).toLocaleDateString()}
                </p>
                <div className="flex gap-2">
                  {gen.file_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => window.open(gen.file_url!, "_blank")}
                    >
                      <Eye className="h-3 w-3 mr-1" /> View
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(gen.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
