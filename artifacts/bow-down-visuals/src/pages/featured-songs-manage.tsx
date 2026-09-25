import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2, Upload, Trash2, ArrowUp, ArrowDown, Music2, ShieldCheck, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { formatTime, type FeaturedTrack } from "@/lib/featured-songs";

/* ──────────────────────────────────────────────
   Featured Songs Manager — owner-only page at /featured-songs.
   Upload tracks, reorder, and remove them from the homepage playlist.
   The Bow Down Visuals theme song is the built-in default and shows
   automatically whenever the playlist is empty.
   ────────────────────────────────────────────── */

const GOLD = "#DAA520";

interface ManageTrack extends FeaturedTrack {
  builtin?: boolean;
}

export default function FeaturedSongsManagePage() {
  const { getAccessToken } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tracks, setTracks] = useState<ManageTrack[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadTracks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/featured-songs");
      const data = (await res.json()) as { tracks?: FeaturedTrack[]; default?: boolean };
      setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      setIsDefault(data.default === true);
    } catch {
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/status", { headers: await authHeaders() });
        const data = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) {
          setIsAdmin(res.ok && data.isAdmin === true);
          if (res.ok && data.isAdmin === true) await loadTracks();
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders, loadTracks]);

  /* Read the uploaded file's duration in the browser so the playlist
     can show it without a server round-trip. */
  function readDuration(f: File): Promise<string | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(f);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const label = formatTime(audio.duration);
        URL.revokeObjectURL(url);
        resolve(label);
      };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      audio.src = url;
    });
  }

  async function handleUpload() {
    if (!file) { setError("Choose an audio file first."); return; }
    if (!title.trim()) { setError("Give the track a title."); return; }
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const duration_label = await readDuration(file);
      const form = new FormData();
      form.append("track", file);
      form.append("title", title.trim());
      if (artist.trim()) form.append("artist", artist.trim());
      if (duration_label) form.append("duration_label", duration_label);
      const res = await fetch("/api/featured-songs", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json()) as { track?: FeaturedTrack; error?: string };
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setMessage(`Added "${data.track?.title}".`);
      setTitle("");
      setArtist("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadTracks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Remove "${title}" from the playlist?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/featured-songs/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("Delete failed.");
      setMessage(`Removed "${title}".`);
      await loadTracks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const ids = tracks.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setTracks(ids.map((tid) => tracks.find((t) => t.id === tid)!));
    try {
      const res = await fetch("/api/featured-songs/reorder", {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Reorder failed.");
    } catch {
      await loadTracks();
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="max-w-3xl mx-auto px-5 py-16">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="h-6 w-6" style={{ color: GOLD }} />
          <h1 className="text-3xl font-semibold tracking-tight">Featured Songs</h1>
        </div>
        <p className="text-white/50 mb-8">
          Manage the homepage playlist. The theme song plays automatically
          whenever the playlist is empty.
        </p>

        {checking ? (
          <div className="flex items-center gap-2 text-white/40">
            <Loader2 className="h-5 w-5 animate-spin" /> Checking access…
          </div>
        ) : !isAdmin ? (
          <p className="text-red-400/80">Not authorized. This page is for the site owner only.</p>
        ) : (
          <div className="space-y-8">
            {message && (
              <p className="text-sm text-green-400/90 bg-green-400/10 border border-green-400/20 rounded-xl px-4 py-3">
                {message}
              </p>
            )}
            {error && (
              <p className="text-sm text-red-400/90 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            {/* Upload card */}
            <div
              className="rounded-2xl p-6 space-y-4"
              style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(218,165,32,0.20)" }}
            >
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <Upload className="h-4 w-4" style={{ color: GOLD }} /> Add a track
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Input
                  placeholder="Track title *"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
                <Input
                  placeholder="Artist (default: Bow Down Visuals)"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm text-white/60 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-yellow-500/15 file:text-yellow-400 hover:file:bg-yellow-500/25 file:cursor-pointer"
              />
              {file && (
                <p className="text-xs text-white/40">
                  {file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
              <Button
                onClick={handleUpload}
                disabled={uploading || !file || !title.trim()}
                className="font-semibold text-black"
                style={{ background: `linear-gradient(135deg, #9B7515, ${GOLD})` }}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {uploading ? "Uploading…" : "Upload track"}
              </Button>
            </div>

            {/* Track list */}
            <div
              className="rounded-2xl p-6"
              style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(218,165,32,0.20)" }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <Music2 className="h-4 w-4" style={{ color: GOLD }} />
                  Playlist order
                </h2>
                <button
                  onClick={loadTracks}
                  className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 text-white/40">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : tracks.length === 0 ? (
                <p className="text-white/40 text-sm">
                  No uploaded tracks — the homepage is playing the theme song by default.
                </p>
              ) : (
                <div className="space-y-2">
                  {isDefault && (
                    <p className="text-xs text-white/40 mb-2">
                      Showing the built-in theme song (playlist is empty — upload a track to take over).
                    </p>
                  )}
                  {tracks.map((t, i) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.07]"
                    >
                      <span className="text-xs font-mono text-white/30 w-6">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white/90 truncate">{t.title}</p>
                        <p className="text-xs text-white/40 truncate">{t.artist}</p>
                      </div>
                      <span className="text-xs font-mono text-white/35">{t.duration_label ?? "—"}</span>
                      {!isDefault && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => move(t.id, -1)}
                            disabled={i === 0}
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-25"
                            aria-label="Move up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => move(t.id, 1)}
                            disabled={i === tracks.length - 1}
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-25"
                            aria-label="Move down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(t.id, t.title)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-400/10"
                            aria-label={`Remove ${t.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
