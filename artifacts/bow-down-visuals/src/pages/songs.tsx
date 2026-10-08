import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Upload, Music2, Sparkles, RefreshCw, Disc3, Check, Plus, DiscAlbum, ChevronDown, Blend, Shuffle, Clapperboard} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { CoverSongModal, type CoverSource } from "@/components/song/CoverSongModal";
import { CoverComparePlayer } from "@/components/song/CoverComparePlayer";
import AlbumsSection from "./songs/albums-section";
import { SongReworkPanel } from "@/components/SongReworkPanel";

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

interface AlbumLite {
  id: string;
  title: string;
  status: string;
  track_count: number;
}

type LibraryTab = "songs" | "albums";

const SOURCE_LABEL_KEYS: Record<string, string> = {
  upload: "songs.sourceUpload",
  generated: "songs.sourceGenerated",
  remix: "songs.sourceRemix",
  "song-remix": "songs.sourceSongRemix",
  "section-replace": "songs.sourceSectionReplace",
  cover: "songs.sourceCover",
  mashup: "songs.sourceMashup",
};

export default function SongsPage() {
  const { t } = useTranslation();
  usePageTitle(t("songs.pageTitle"), t("songs.pageDescription"));
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

  /* Cover Song (Suno Cover parity) — "Make a cover" per card, covers listed
     under their original via parent_song_id, A/B compare overlay. */
  const [coverSource, setCoverSource] = useState<CoverSource | null>(null);
  const [coversById, setCoversById] = useState<Record<string, SongRecord[]>>({});
  const [coversOpen, setCoversOpen] = useState<string | null>(null);
  const [coversLoading, setCoversLoading] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<{ original: SongRecord; cover: SongRecord } | null>(null);

  async function loadCovers(songId: string) {
    setCoversLoading(songId);
    try {
      const res = await fetch(`/api/song-cover/covers/${songId}`, { headers: await authHeaders() });
      const data = (await res.json()) as { covers?: SongRecord[] };
      if (res.ok) setCoversById((m) => ({ ...m, [songId]: data.covers ?? [] }));
    } catch {
      /* empty state shown */
    } finally {
      setCoversLoading(null);
    }
  }

  function toggleCovers(song: SongRecord) {
    if (coversOpen === song.id) { setCoversOpen(null); return; }
    setCoversOpen(song.id);
    if (!coversById[song.id]) void loadCovers(song.id);
  }

  /* Song Mashup (Suno parity) — "Mashups using this" reverse lookup. */
  const [mashupsById, setMashupsById] = useState<Record<string, SongRecord[]>>({});
  const [mashupsOpen, setMashupsOpen] = useState<string | null>(null);
  const [mashupsLoading, setMashupsLoading] = useState<string | null>(null);

  async function loadMashupsUsing(songId: string) {
    setMashupsLoading(songId);
    try {
      const res = await fetch(`/api/mashup/using/${songId}`, { headers: await authHeaders() });
      const data = (await res.json()) as { mashups?: SongRecord[] };
      if (res.ok) setMashupsById((m) => ({ ...m, [songId]: data.mashups ?? [] }));
    } catch {
      /* empty state shown */
    } finally {
      setMashupsLoading(null);
    }
  }

  function toggleMashups(song: SongRecord) {
    if (mashupsOpen === song.id) { setMashupsOpen(null); return; }
    setMashupsOpen(song.id);
    if (!mashupsById[song.id]) void loadMashupsUsing(song.id);
  }

  function handleCoverCreated(cover: { parent_song_id: string | null }) {
    void loadSongs();
    const pid = cover.parent_song_id;
    if (pid) {
      setCoversById((m) => { const n = { ...m }; delete n[pid]; return n; });
      setCoversOpen(pid);
      void loadCovers(pid);
    }
  }
  /* Suno-parity rework (Remix / Replace Section) — expands inline per card. */
  const [reworkTarget, setReworkTarget] = useState<string | null>(null);
  /* Deep-link highlight: /songs?song=<id>[&addToAlbum=1] from rework results. */
  const [highlightSong, setHighlightSong] = useState<string | null>(null);
  const [tab, setTab] = useState<LibraryTab>("songs");
  // "Add to album" picker
  const [addToAlbumSong, setAddToAlbumSong] = useState<SongRecord | null>(null);
  const [albumsLite, setAlbumsLite] = useState<AlbumLite[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [addingToAlbum, setAddingToAlbum] = useState<string | null>(null);
  const [albumActionError, setAlbumActionError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadSongs = useCallback(async () => {
    try {
      const res = await fetch("/api/songs", { headers: await authHeaders() });
      const data = (await res.json()) as { songs?: SongRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("songs.errorLoadSongs"));
      setSongs(data.songs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("songs.errorLoadSongs"));
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

  /* Deep-link: highlight a song card and optionally open the album picker
     (used by the Remix/Replace result handoff: /songs?song=<id>&addToAlbum=1). */
  useEffect(() => {
    if (loading || songs.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const q = new URLSearchParams(window.location.search);
      const songId = q.get("song");
      if (!songId || !songs.some((s) => s.id === songId)) return;
      setHighlightSong(songId);
      if (q.get("addToAlbum") === "1") {
        const target = songs.find((s) => s.id === songId);
        if (target) void openAddToAlbum(target);
      }
      timer = setTimeout(() => {
        document.getElementById(`song-card-${songId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      q.delete("song");
      q.delete("addToAlbum");
      const next = q.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
    } catch { /* malformed URL — ignore */ }
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, songs]);

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
      if (!res.ok) throw new Error(data.error || t("songs.errorUploadFailed"));
      setTitle("");
      await loadSongs();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("songs.errorUploadFailed"));
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
      if (!res.ok) throw new Error(data.error || t("songs.errorRemixFailed"));
      setRemixTarget(null);
      setRemixVault("");
      await loadSongs();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("songs.errorRemixFailed"));
    } finally {
      setRemixing(false);
    }
  }

  async function openAddToAlbum(song: SongRecord) {
    setAddToAlbumSong(song);
    setAlbumActionError(null);
    setAlbumsLoading(true);
    try {
      const res = await fetch("/api/albums", { headers: await authHeaders() });
      const data = (await res.json()) as { albums?: AlbumLite[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("songs.errorLoadSongs"));
      setAlbumsLite((data.albums ?? []).filter((a) => a.status === "draft"));
    } catch (e) {
      setAlbumActionError(e instanceof Error ? e.message : "Could not load albums.");
    } finally {
      setAlbumsLoading(false);
    }
  }

  async function handleAddToAlbum(albumId: string) {
    if (!addToAlbumSong) return;
    setAddingToAlbum(albumId);
    setAlbumActionError(null);
    try {
      // Load current tracklist, append the song, save the new order.
      const detailRes = await fetch(`/api/albums/${albumId}`, { headers: await authHeaders() });
      const detail = (await detailRes.json()) as {
        album?: { tracks?: { song_id: string }[] };
        error?: string;
      };
      if (!detailRes.ok || !detail.album) throw new Error(detail.error || "Could not load album.");
      const current = (detail.album.tracks ?? []).map((tr) => tr.song_id);
      if (current.includes(addToAlbumSong.id)) {
        setAddToAlbumSong(null);
        return; // already in the album
      }
      const res = await fetch(`/api/albums/${albumId}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ song_ids: [...current, addToAlbumSong.id] }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not add song to album.");
      setAddToAlbumSong(null);
    } catch (e) {
      setAlbumActionError(e instanceof Error ? e.message : "Could not add song to album.");
    } finally {
      setAddingToAlbum(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Music2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{t("songs.title")}</h1>
      </div>
      <p className="text-sm text-white/50 mb-6">
        {t("songs.intro")}
      </p>

      {/* Library tabs: songs | albums (Album/EP Builder docks here — no new sidebar item) */}
      <div className="flex gap-2 mb-6">
        {(["songs", "albums"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
              tab === v
                ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black"
                : "border border-white/15 text-white/60 hover:text-white hover:border-white/30"
            }`}
          >
            {v === "albums" && <Disc3 className="h-4 w-4" />}
            {v === "songs" ? t("songs.title") : "Albums"}
          </button>
        ))}
      </div>

      {tab === "albums" ? (
        <AlbumsSection songs={songs} authHeaders={authHeaders} />
      ) : (
      <>
      {/* Upload */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 mb-6">
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-3">
          {t("songs.uploadTitle")}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("songs.titlePlaceholder")}
            disabled={uploading}
            className="flex-1 min-w-[160px] rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25"
          />
          <label
            className={`inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? t("songs.uploadingLabel") : t("songs.chooseFileButton")}
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
          {t("songs.emptyLibrary")}
        </p>
      ) : (
        <div className="space-y-3">
          {songs.map((s) => (
            <div
              key={s.id}
              id={`song-card-${s.id}`}
              className={`rounded-xl bg-white/[0.03] border p-4 transition-shadow ${
                highlightSong === s.id
                  ? "border-primary/60 shadow-[0_0_28px_-8px_hsl(45_95%_50%/0.7)]"
                  : "border-white/[0.06]"
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-bold truncate">{s.title}</p>
                <span className="text-[11px] uppercase tracking-wider text-white/40 border border-white/10 rounded-full px-2 py-0.5 shrink-0">
                  {t(SOURCE_LABEL_KEYS[s.source] ?? s.source)}
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
                      <option value="">{t("songs.singItAs")}</option>
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
                      {t("songs.remixButton")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setRemixTarget(null); setRemixVault(""); }}
                      disabled={remixing}
                    >
                      {t("songs.cancelButton")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRemixTarget(s.id)}
                      className="rounded-xl border-white/15 text-white/80"
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      {t("songs.remixWithVoice")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCoverSource({ songId: s.id, title: s.title, audioUrl: s.audio_url })}
                      className="rounded-xl border-primary/40 text-primary"
                      title="Make a cover of this song in a new style"
                    >
                      <DiscAlbum className="h-4 w-4 mr-1" />
                      Make a cover
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void openAddToAlbum(s)}
                      className="rounded-xl border-white/15 text-white/80"
                      title="Add to an album or EP"
                    >
                      <Disc3 className="h-4 w-4 mr-1" />
                      Add to album
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReworkTarget(reworkTarget === s.id ? null : s.id)}
                      className="rounded-xl border-primary/40 text-primary"
                      title="Remix the arrangement or replace one section"
                    >
                      <Shuffle className="h-4 w-4 mr-1" />
                      Rework
                    </Button>
                    <Link href={`/make-song?tab=mashup&songA=${s.id}`}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-primary/40 text-primary"
                        title={t("songs.mashupWith")}
                      >
                        <Blend className="h-4 w-4 mr-1" />
                        {t("songs.mashupWith")}
                      </Button>
                    </Link>
                    <Link href={`/playlist-pitch?tab=sync&song=${encodeURIComponent(s.title)}`}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-primary/40 text-primary"
                        title={t("songs.pitchForSync")}
                      >
                        <Clapperboard className="h-4 w-4 mr-1" />
                        {t("songs.pitchForSync")}
                      </Button>
                    </Link>
                  </>
                )}
              </div>
              {/* Suno-parity rework: remix + replace-section, inline per card. */}
              {reworkTarget === s.id && (
                <SongReworkPanel
                  compact
                  source={{ songId: s.id, audioUrl: s.audio_url, title: s.title }}
                />
              )}
              {remixTarget === s.id && remixing && (
                <p className="mt-2 text-xs text-white/50 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("songs.remixingStatus")}
                </p>
              )}
              {remixTarget === s.id && vaults.length === 0 && (
                <p className="mt-2 text-xs text-white/40">
                  {t("songs.noLockedVoice")}
                </p>
              )}
              {/* Covers of this song — reverse lookup via parent_song_id. */}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => toggleCovers(s)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 hover:text-primary transition-colors"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${coversOpen === s.id ? "rotate-180" : ""}`} />
                  {coversOpen === s.id ? "Hide covers" : "Covers"}
                  {(coversById[s.id] ?? []).length > 0 && (
                    <span className="text-primary">({(coversById[s.id] ?? []).length})</span>
                  )}
                </button>
                {coversOpen === s.id && (
                  <div className="mt-2 space-y-2">
                    {coversLoading === s.id ? (
                      <p className="text-xs text-white/40 flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading covers…
                      </p>
                    ) : (coversById[s.id] ?? []).length === 0 ? (
                      <p className="text-xs text-white/40">
                        No covers yet — hit “Make a cover” to create the first one.
                      </p>
                    ) : (
                      (coversById[s.id] ?? []).map((c) => (
                        <div key={c.id} className="rounded-lg bg-black/40 border border-white/10 p-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-xs font-semibold text-white truncate">{c.title}</p>
                            <button
                              type="button"
                              onClick={() => setComparePair({ original: s, cover: c })}
                              className="text-[11px] font-bold text-primary hover:underline shrink-0"
                            >
                              Compare A/B
                            </button>
                          </div>
                          <audio controls src={c.audio_url} className="w-full h-7" />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              {/* Mashups using this song — reverse lookup via mashup_sources. */}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => toggleMashups(s)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 hover:text-primary transition-colors"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mashupsOpen === s.id ? "rotate-180" : ""}`} />
                  {t("songs.mashupsUsingThis")}
                  {(mashupsById[s.id] ?? []).length > 0 && (
                    <span className="text-primary">({(mashupsById[s.id] ?? []).length})</span>
                  )}
                </button>
                {mashupsOpen === s.id && (
                  <div className="mt-2 space-y-2">
                    {mashupsLoading === s.id ? (
                      <p className="text-xs text-white/40 flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading mashups…
                      </p>
                    ) : (mashupsById[s.id] ?? []).length === 0 ? (
                      <p className="text-xs text-white/40">
                        {t("songs.mashupsUsingThisEmpty")}
                      </p>
                    ) : (
                      (mashupsById[s.id] ?? []).map((mu) => (
                        <div key={mu.id} className="rounded-lg bg-black/40 border border-primary/20 p-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-xs font-semibold text-white truncate">{mu.title}</p>
                            <Link href={`/make-song?tab=mashup&songA=${mu.id}`}>
                              <span className="text-[11px] font-bold text-primary hover:underline shrink-0 cursor-pointer">
                                {t("songs.mashupWith")}
                              </span>
                            </Link>
                          </div>
                          <audio controls src={mu.audio_url} className="w-full h-7" />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {/* "Add to album" picker modal */}
      {addToAlbumSong && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setAddToAlbumSong(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#c9a84c]/30 bg-[#0a0a0a] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-bold mb-1">Add to album</p>
            <p className="text-xs text-white/40 mb-4 truncate">“{addToAlbumSong.title}”</p>
            {albumsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              </div>
            ) : albumsLite.length === 0 ? (
              <p className="text-xs text-white/40 py-4 text-center">
                No draft albums yet — create one on the Albums tab first.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {albumsLite.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => void handleAddToAlbum(a.id)}
                    disabled={addingToAlbum === a.id}
                    className="w-full flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-left text-white/80 hover:border-[#c9a84c]/40 hover:text-white transition disabled:opacity-50"
                  >
                    {addingToAlbum === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-[#e8c86a]" />
                    )}
                    <span className="truncate flex-1">{a.title}</span>
                    <span className="text-[10px] text-white/30 shrink-0">{a.track_count} tracks</span>
                  </button>
                ))}
              </div>
            )}
            {albumActionError && <p className="text-xs text-red-400 mt-3">{albumActionError}</p>}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddToAlbumSong(null)}
              className="mt-4 w-full rounded-xl text-white/60"
            >
              <Check className="h-4 w-4 mr-1" /> Done
            </Button>
          </div>
        </div>
      )}
      {/* Cover Song modal (Suno Cover parity) */}
      <CoverSongModal
        open={!!coverSource}
        onClose={() => setCoverSource(null)}
        source={coverSource}
        onCoverCreated={(cover) => handleCoverCreated(cover)}
      />

      {/* A/B compare overlay */}
      {comparePair && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setComparePair(null)}
        >
          <div className="w-full sm:max-w-xl" onClick={(e) => e.stopPropagation()}>
            <CoverComparePlayer
              original={{ title: comparePair.original.title, audioUrl: comparePair.original.audio_url }}
              cover={{ title: comparePair.cover.title, audioUrl: comparePair.cover.audio_url }}
            />
            <button
              type="button"
              onClick={() => setComparePair(null)}
              className="mt-3 w-full rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>

  );
}