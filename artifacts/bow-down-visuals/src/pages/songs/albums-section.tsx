import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Album as AlbumIcon, ArrowDown, ArrowUp, Check, ChevronLeft, Disc3, ExternalLink,
  ImagePlus, Link2, Loader2, Music2, Plus, Send, Share2, Sparkles, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Album/EP Builder — docked inside the Songs library ────────────────
   No new sidebar item, no new page: creators group their generated songs
   into Albums/EPs right here. Drafting is free; publishing the shareable
   page costs 300 Visual Bucs (credit-confirmed + server-enforced). */

interface SongLite {
  id: string;
  title: string;
  audio_url: string;
  source: string;
}

interface AlbumTrack {
  id: string;
  position: number;
  song_id: string;
  title: string;
  audio_url: string;
  source: string;
}

interface Album {
  id: string;
  title: string;
  slug: string | null;
  album_type: string;
  release_notes: string;
  cover_art_url: string | null;
  status: string;
  views: number;
  track_count: number;
  tracks?: AlbumTrack[];
}

const PUBLISH_COST = 300;

const inputClass =
  "w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25";

export default function AlbumsSection({
  songs,
  authHeaders,
}: {
  songs: SongLite[];
  authHeaders: () => Promise<HeadersInit>;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Album | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Editor form state
  const [title, setTitle] = useState("");
  const [albumType, setAlbumType] = useState<"album" | "ep">("album");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [coverArtUrl, setCoverArtUrl] = useState("");
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  // AI cover art
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverArtist, setCoverArtist] = useState("");
  const [coverMood, setCoverMood] = useState("");

  const loadAlbums = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/albums", { headers: await authHeaders() });
      const data = (await res.json()) as { albums?: Album[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load albums.");
      setAlbums(data.albums ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load albums.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadAlbums();
  }, [loadAlbums]);

  function openNew() {
    setEditing(null);
    setTitle("");
    setAlbumType("album");
    setReleaseNotes("");
    setCoverArtUrl("");
    setTrackIds([]);
    setCoverArtist("");
    setCoverMood("");
    setCreating(true);
    setShowPicker(false);
  }

  function openEdit(album: Album) {
    setEditing(album);
    setTitle(album.title);
    setAlbumType(album.album_type === "ep" ? "ep" : "album");
    setReleaseNotes(album.release_notes ?? "");
    setCoverArtUrl(album.cover_art_url ?? "");
    setTrackIds((album.tracks ?? []).map((t) => t.song_id));
    setCreating(true);
    setShowPicker(false);
  }

  async function loadFullAlbum(id: string): Promise<Album | null> {
    try {
      const res = await fetch(`/api/albums/${id}`, { headers: await authHeaders() });
      const data = (await res.json()) as { album?: Album; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load album.");
      return data.album ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load album.");
      return null;
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      setError("Give your album a title first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        album_type: albumType,
        release_notes: releaseNotes.trim(),
        cover_art_url: coverArtUrl.trim() || null,
        song_ids: trackIds,
      };
      let res: Response;
      if (editing) {
        res = await fetch(`/api/albums/${editing.id}`, {
          method: "PATCH",
          headers: { ...(await authHeaders()), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/albums", {
          method: "POST",
          headers: { ...(await authHeaders()), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const data = (await res.json()) as { album?: Album; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save album.");
      setCreating(false);
      setEditing(null);
      await loadAlbums();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save album.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(id: string) {
    setPublishingId(id);
    setError(null);
    try {
      // Credit-confirmed: registry /api/album-publish → 300 Visual Bucs.
      const res = await confirmedFetch(`/api/album-publish/${id}`, { method: "POST" });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json()) as { album?: Album; error?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not publish album.");
      await loadAlbums();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish album.");
    } finally {
      setPublishingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this album? The songs stay in your library.")) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not delete album.");
      }
      await loadAlbums();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete album.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleGenerateCover() {
    if (!coverArtist.trim()) {
      setError("Enter the artist name for the AI cover art.");
      return;
    }
    setGeneratingCover(true);
    setError(null);
    try {
      // Credit-confirmed: registry /api/cover-art → 200 Visual Bucs.
      const res = await confirmedFetch("/api/cover-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songTitle: title.trim() || "Untitled Album",
          artistName: coverArtist.trim(),
          mood: coverMood.trim(),
          style: "luxury-gold",
          aspectRatio: "1:1",
          tier: "standard",
        }),
      });
      if (!res) return;
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || !data.url) throw new Error(data.error || "Cover art generation failed.");
      setCoverArtUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cover art generation failed.");
    } finally {
      setGeneratingCover(false);
    }
  }

  function moveTrack(index: number, dir: -1 | 1) {
    setTrackIds((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  }

  function removeTrack(index: number) {
    setTrackIds((prev) => prev.filter((_, i) => i !== index));
  }

  const songById = useCallback(
    (id: string) => songs.find((s) => s.id === id),
    [songs],
  );

  async function copyLink(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const albumShareUrl = (slug: string | null) =>
    slug ? `${window.location.origin}/albums/${slug}` : "";

  /* ── Album editor ── */
  if (creating) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 sm:p-6">
        <button
          onClick={() => { setCreating(false); setEditing(null); }}
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white mb-5 transition"
        >
          <ChevronLeft className="h-4 w-4" /> Back to albums
        </button>
        <h2 className="text-lg font-bold mb-5">
          {editing ? "Edit album" : "New album / EP"} <span className="text-xs font-normal text-white/40">— drafting is free</span>
        </h2>

        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-white/40 font-semibold block mb-2">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Midnight Gold" className={inputClass} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-white/40 font-semibold block mb-2">Type</label>
              <div className="flex gap-2">
                {(["album", "ep"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAlbumType(t)}
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-bold uppercase tracking-wider transition ${
                      albumType === t
                        ? "border-[#c9a84c] bg-[#c9a84c]/10 text-[#e8c86a]"
                        : "border-white/10 text-white/50 hover:border-white/25"
                    }`}
                  >
                    {t === "album" ? "Album" : "EP"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-white/40 font-semibold block mb-2">Release notes</label>
              <textarea
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder="The story behind this release…"
                rows={4}
                className={`${inputClass} resize-none`}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-white/40 font-semibold block mb-2">Cover art</label>
              <div className="flex gap-2 mb-2">
                <input
                  value={coverArtUrl}
                  onChange={(e) => setCoverArtUrl(e.target.value)}
                  placeholder="Paste an image URL…"
                  className={inputClass}
                />
                {coverArtUrl && (
                  <button onClick={() => setCoverArtUrl("")} className="shrink-0 rounded-xl border border-white/10 px-3 text-white/50 hover:text-white" aria-label="Clear cover art">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/30 p-3">
                <p className="text-xs text-white/50 mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-[#e8c86a]" /> or generate with AI (200 Visual Bucs)
                </p>
                <div className="flex flex-wrap gap-2">
                  <input value={coverArtist} onChange={(e) => setCoverArtist(e.target.value)} placeholder="Artist name" className={`${inputClass} flex-1 min-w-[120px]`} />
                  <input value={coverMood} onChange={(e) => setCoverMood(e.target.value)} placeholder="Mood (optional)" className={`${inputClass} flex-1 min-w-[120px]`} />
                  <Button size="sm" onClick={() => void handleGenerateCover()} disabled={generatingCover} className="rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                    {generatingCover ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
                    {generatingCover ? "Generating…" : "Generate"}
                  </Button>
                </div>
              </div>
              {coverArtUrl && (
                <img src={coverArtUrl} alt="Album cover preview" className="mt-3 w-32 h-32 rounded-xl object-cover border border-[#c9a84c]/30" />
              )}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-white/40 font-semibold block mb-2">
              Tracklist ({trackIds.length})
            </label>
            {trackIds.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
                <Music2 className="h-8 w-8 text-white/20 mx-auto mb-2" />
                <p className="text-sm text-white/40 mb-3">No tracks yet — add songs from your library.</p>
              </div>
            ) : (
              <div className="space-y-2 mb-3">
                {trackIds.map((id, i) => {
                  const s = songById(id);
                  if (!s) return null;
                  return (
                    <div key={id} className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
                      <span className="text-xs text-white/30 font-mono w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                      <p className="flex-1 min-w-0 text-sm font-semibold truncate">{s.title}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => moveTrack(i, -1)} disabled={i === 0} className="p-1.5 text-white/50 hover:text-white disabled:opacity-20" aria-label="Move up">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => moveTrack(i, 1)} disabled={i === trackIds.length - 1} className="p-1.5 text-white/50 hover:text-white disabled:opacity-20" aria-label="Move down">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => removeTrack(i)} className="p-1.5 text-white/50 hover:text-red-400" aria-label="Remove track">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPicker((v) => !v)}
              className="rounded-xl border-white/15 text-white/80 w-full"
            >
              <Plus className="h-4 w-4 mr-1" /> {showPicker ? "Hide song picker" : "Add songs from library"}
            </Button>
            {showPicker && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/40 p-2 space-y-1">
                {songs.length === 0 && <p className="text-xs text-white/40 p-3">Your song library is empty.</p>}
                {songs.map((s) => {
                  const added = trackIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setTrackIds((prev) => (added ? prev.filter((x) => x !== s.id) : [...prev, s.id]))}
                      className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition ${
                        added ? "bg-[#c9a84c]/10 text-[#e8c86a]" : "text-white/70 hover:bg-white/[0.04]"
                      }`}
                    >
                      {added ? <Check className="h-4 w-4 shrink-0" /> : <Plus className="h-4 w-4 shrink-0 text-white/30" />}
                      <span className="truncate">{s.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-400 mt-4">{error}</p>}

        <div className="flex flex-wrap gap-2 mt-6">
          <Button onClick={() => void handleSave()} disabled={saving} className="rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {saving ? "Saving…" : editing ? "Save changes" : "Save draft (free)"}
          </Button>
          <Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  /* ── Album list ── */
  return (
    <div>
      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}

      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-white/50">
          Group your songs into albums &amp; EPs. Drafting is free — publishing costs{" "}
          <span className="text-[#e8c86a] font-bold">{PUBLISH_COST} Visual Bucs</span>.
        </p>
        <Button onClick={openNew} className="rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 shrink-0 ml-3">
          <Plus className="h-4 w-4 mr-1" /> New album
        </Button>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      ) : albums.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
          <AlbumIcon className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/50 mb-1 font-semibold">No albums yet</p>
          <p className="text-xs text-white/35 mb-4">Bundle your songs into a release — like a Suno library, but yours.</p>
          <Button onClick={openNew} className="rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
            <Plus className="h-4 w-4 mr-1" /> Create your first album
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {albums.map((album) => {
            const published = album.status === "published";
            const shareUrl = albumShareUrl(album.slug);
            return (
              <div key={album.id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                <div className="flex gap-3 mb-3">
                  {album.cover_art_url ? (
                    <img src={album.cover_art_url} alt={`${album.title} cover`} className="w-16 h-16 rounded-lg object-cover border border-[#c9a84c]/30 shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg border border-white/10 bg-white/[0.02] flex items-center justify-center shrink-0">
                      <Disc3 className="h-7 w-7 text-white/20" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold truncate">{album.title}</p>
                      <span className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border shrink-0 ${
                        published ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/10 text-white/40"
                      }`}>
                        {published ? "Published" : "Draft"}
                      </span>
                    </div>
                    <p className="text-xs text-white/40">
                      {album.album_type === "ep" ? "EP" : "Album"} · {album.track_count} track{album.track_count === 1 ? "" : "s"}
                      {published && album.views > 0 && ` · ${album.views} views`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void (async () => {
                      const full = await loadFullAlbum(album.id);
                      if (full) openEdit(full);
                    })()}
                    className="rounded-xl border-white/15 text-white/80"
                    disabled={published}
                    title={published ? "Published albums are locked" : "Edit album"}
                  >
                    Edit
                  </Button>
                  {!published ? (
                    <Button
                      size="sm"
                      onClick={() => void handlePublish(album.id)}
                      disabled={publishingId === album.id || album.track_count === 0}
                      className="rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110"
                      title={album.track_count === 0 ? "Add at least one song first" : `Publish for ${PUBLISH_COST} Visual Bucs`}
                    >
                      {publishingId === album.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                      {publishingId === album.id ? "Publishing…" : `Publish · ${PUBLISH_COST} VB`}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copyLink(`album-${album.id}`, shareUrl)}
                        className="rounded-xl border-white/15 text-white/80"
                      >
                        {copied === `album-${album.id}` ? <Check className="h-4 w-4 mr-1 text-emerald-400" /> : <Share2 className="h-4 w-4 mr-1" />}
                        {copied === `album-${album.id}` ? "Copied!" : "Share"}
                      </Button>
                      <Link href={`/albums/${album.slug}`}>
                        <Button size="sm" variant="ghost" className="rounded-xl text-white/60 hover:text-white">
                          View page <ExternalLink className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </Link>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleDelete(album.id)}
                    disabled={deletingId === album.id}
                    className="rounded-xl text-white/40 hover:text-red-400 ml-auto"
                    aria-label={`Delete ${album.title}`}
                  >
                    {deletingId === album.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>

                {/* Handoff chain */}
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.06]">
                  <span className="text-[10px] uppercase tracking-wider text-white/30 font-semibold self-center mr-1">Next:</span>
                  <Link href="/playlist-pitch">
                    <button className="text-[11px] rounded-full border border-white/10 px-2.5 py-1 text-white/50 hover:text-[#e8c86a] hover:border-[#c9a84c]/40 transition flex items-center gap-1">
                      <Link2 className="h-3 w-3" /> Pitch to playlist
                    </button>
                  </Link>
                  <Link href="/release-checklist">
                    <button className="text-[11px] rounded-full border border-white/10 px-2.5 py-1 text-white/50 hover:text-[#e8c86a] hover:border-[#c9a84c]/40 transition flex items-center gap-1">
                      <Link2 className="h-3 w-3" /> Plan release
                    </button>
                  </Link>
                  <Link href="/distribute">
                    <button className="text-[11px] rounded-full border border-white/10 px-2.5 py-1 text-white/50 hover:text-[#e8c86a] hover:border-[#c9a84c]/40 transition flex items-center gap-1">
                      <Link2 className="h-3 w-3" /> Distribute
                    </button>
                  </Link>
                  <Link href="/showcase">
                    <button className="text-[11px] rounded-full border border-white/10 px-2.5 py-1 text-white/50 hover:text-[#e8c86a] hover:border-[#c9a84c]/40 transition flex items-center gap-1">
                      <Link2 className="h-3 w-3" /> Showcase
                    </button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
