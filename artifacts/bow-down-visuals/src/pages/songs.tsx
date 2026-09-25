import { useCallback, useEffect, useState } from "react";
import { Loader2, Upload, Music2, Sparkles, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

interface SongRecord {
  id: string;
  title: string;
  audio_url: string;
  source: string;
  parent_song_id: string | null;
  artist_vault_id: string | null;
  created_at: string;
}

interface VaultLite {
  id: string;
  artist_name: string;
  voice_id: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  upload: "Upload",
  generated: "Generated",
  remix: "Remix",
};

export default function SongsPage() {
  const { getAccessToken } = useAuth();
  const [songs, setSongs] = useState<SongRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultLite[]>([]);
  const [remixTarget, setRemixTarget] = useState<string | null>(null);
  const [remixVault, setRemixVault] = useState("");
  const [remixing, setRemixing] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadSongs = useCallback(async () => {
    try {
      const res = await fetch("/api/songs", { headers: await authHeaders() });
      const data = (await res.json()) as { songs?: SongRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load songs.");
      setSongs(data.songs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load songs.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const loadVaults = useCallback(async () => {
    try {
      const res = await fetch("/api/artist-vaults", { headers: await authHeaders() });
      const data = (await res.json()) as { vaults?: VaultLite[] };
      if (res.ok) setVaults((data.vaults ?? []).filter((v) => v.voice_id));
    } catch {
      /* vaults are optional here */
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadSongs();
    void loadVaults();
  }, [loadSongs, loadVaults]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("song", file);
      if (title.trim()) form.append("title", title.trim());
      const res = await fetch("/api/songs/upload", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json()) as { song?: SongRecord; error?: string };
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setTitle("");
      await loadSongs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemix() {
    if (!remixTarget || !remixVault) return;
    setRemixing(true);
    setError(null);
    try {
      const res = await fetch(`/api/songs/${remixTarget}/remix`, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ artistVaultId: remixVault }),
      });
      const data = (await res.json()) as { song?: SongRecord; error?: string };
      if (!res.ok) throw new Error(data.error || "Remix failed.");
      setRemixTarget(null);
      setRemixVault("");
      await loadSongs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remix failed.");
    } finally {
      setRemixing(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Music2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Songs</h1>
      </div>
      <p className="text-sm text-white/50 mb-6">
        Upload songs to your library — then strip them to vocals for a character voice,
        or remix them so the locked voice sings them.
      </p>

      {/* Upload */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 mb-6">
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-3">
          Upload a song
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title (optional)"
            disabled={uploading}
            className="flex-1 min-w-[160px] rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25"
          />
          <label
            className={`inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Choose audio file"}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Library */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      ) : songs.length === 0 ? (
        <p className="text-sm text-white/40 py-12 text-center">
          No songs yet. Upload your first one above.
        </p>
      ) : (
        <div className="space-y-3">
          {songs.map((s) => (
            <div
              key={s.id}
              className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-bold truncate">{s.title}</p>
                <span className="text-[11px] uppercase tracking-wider text-white/40 border border-white/10 rounded-full px-2 py-0.5 shrink-0">
                  {SOURCE_LABEL[s.source] ?? s.source}
                </span>
              </div>
              <audio controls src={s.audio_url} className="w-full h-8" />
              <div className="mt-2 flex items-center gap-2">
                {remixTarget === s.id ? (
                  <>
                    <select
                      value={remixVault}
                      onChange={(e) => setRemixVault(e.target.value)}
                      disabled={remixing}
                      className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                    >
                      <option value="">Sing it as…</option>
                      {vaults.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.artist_name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      onClick={() => { void handleRemix(); }}
                      disabled={remixing || !remixVault}
                      className="rounded-xl"
                    >
                      {remixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Remix (3 credits)
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setRemixTarget(null); setRemixVault(""); }}
                      disabled={remixing}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRemixTarget(s.id)}
                    className="rounded-xl border-white/15 text-white/80"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Remix with locked voice
                  </Button>
                )}
              </div>
              {remixTarget === s.id && remixing && (
                <p className="mt-2 text-xs text-white/50 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Isolating vocals and re-singing in the locked voice — a few minutes.
                </p>
              )}
              {remixTarget === s.id && vaults.length === 0 && (
                <p className="mt-2 text-xs text-white/40">
                  No artist has a locked voice yet. Lock one on an artist's page first.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
