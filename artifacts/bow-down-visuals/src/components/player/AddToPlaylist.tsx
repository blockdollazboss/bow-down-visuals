import { useEffect, useState } from "react";
import { X, ListMusic, Plus, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchMyPlaylists, createPlaylist, addItemToPlaylist,
  type MediaKind, type MyPlaylist,
} from "@/lib/streaming";

/* ─── Add-to-playlist modal (Worker 2) ───
   Lets a signed-in viewer save any audio/video upload to one of their
   playlists or a brand-new one. Best-effort: the playlist API contract is
   proposed to Worker 1 (see lib/streaming.ts); when the endpoints aren't
   live yet the modal says so instead of failing silently. */

export function AddToPlaylist({
  kind, id, title, open, onClose,
}: {
  kind: MediaKind;
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const { user, getAccessToken } = useAuth();
  const [playlists, setPlaylists] = useState<MyPlaylist[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAddedId(null);
    setError(null);
    setPlaylists(null);
    (async () => {
      if (!user) return;
      setLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) return;
        const list = await fetchMyPlaylists({ Authorization: `Bearer ${token}` });
        setPlaylists(list);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, user, getAccessToken]);

  if (!open) return null;

  async function authed() {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }

  async function handleAdd(pl: MyPlaylist) {
    const headers = await authed();
    if (!headers) return;
    setError(null);
    const ok = await addItemToPlaylist(pl.id, kind, id, headers);
    if (ok) {
      setAddedId(pl.id);
      setTimeout(onClose, 900);
    } else {
      setError("Couldn't add it — the playlist API isn't live yet. Try again soon.");
    }
  }

  async function handleCreate() {
    const t = newTitle.trim();
    if (!t || creating) return;
    const headers = await authed();
    if (!headers) return;
    setCreating(true);
    setError(null);
    try {
      const pl = await createPlaylist(t, headers);
      if (!pl) {
        setError("Couldn't create that playlist — the playlist API isn't live yet.");
        return;
      }
      setPlaylists((ps) => (ps ? [pl, ...ps] : [pl]));
      setNewTitle("");
      await handleAdd(pl);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-label="Add to playlist">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-[#14110b] border border-[#e8c86a]/30 shadow-[0_20px_60px_rgba(0,0,0,.8)] p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-[#e8c86a]">Save to playlist</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-white/45 mb-4 truncate">"{title}" — file it where it belongs.</p>

        {!user ? (
          <p className="text-sm text-white/50 rounded-xl bg-white/5 border border-white/10 px-4 py-4 text-center">
            Sign in to build playlists — your cheat-code library awaits.
          </p>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[#e8c86a]" />
          </div>
        ) : playlists === null ? (
          <p className="text-sm text-white/50 rounded-xl border border-dashed border-white/15 px-4 py-6 text-center">
            Playlists are still wiring up behind the scenes — check back soon.
          </p>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                placeholder="New playlist name…"
                maxLength={80}
                className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e8c86a]/60"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
                className="rounded-xl bg-[#e8c86a] text-black px-3 py-2 text-sm font-bold disabled:opacity-40 hover:bg-[#f5d67e] flex items-center gap-1"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {playlists.length === 0 ? (
                <p className="text-sm text-white/40 text-center py-4">
                  No playlists yet — name one above and claim it.
                </p>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => handleAdd(pl)}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors text-left"
                  >
                    {pl.cover_url ? (
                      <img src={pl.cover_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-[#e8c86a]/10 flex items-center justify-center">
                        <ListMusic className="h-5 w-5 text-[#e8c86a]/60" />
                      </div>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-white/85 truncate">{pl.title}</span>
                      {pl.item_count != null && (
                        <span className="block text-xs text-white/35">{pl.item_count} items</span>
                      )}
                    </span>
                    {addedId === pl.id && <Check className="h-5 w-5 text-emerald-400" />}
                  </button>
                ))
              )}
            </div>
          </>
        )}
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
