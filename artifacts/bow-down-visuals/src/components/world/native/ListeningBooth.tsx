import { useCallback, useEffect, useState } from "react";
import { Check, Download, Link2, ListMusic, ListPlus, Pause, Play, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  addItemToPlaylist,
  copyText,
  createPlaylist,
  fetchMyPlaylists,
  fetchPlaylist,
  fetchTrack,
  fetchVideo,
  mintStoreDownloadLink,
  recordPlay,
  shareUrl,
  type MediaKind,
} from "@/lib/streaming";
import {
  downloadMintCopy,
  isSameShelfItem,
  parseDownloadMint,
  parseMyMusic,
  parseShelfPlaylists,
  parseShelfPurchases,
  playInputFromMyMusic,
  playInputFromTrack,
  playInputFromVideo,
  playInputsFromPlaylist,
  shelfDetailLine,
  shelfIsPlayable,
  shelfJukeboxTrackId,
  shelfPagePath,
  shelfReceiptLine,
  type MyMusicTrack,
  type ShelfDownloadMint,
  type ShelfPlayInput,
  type ShelfPlaylistSummary,
  type ShelfPurchase,
} from "@/lib/world/shelf";
import type { ShelfPlayerController } from "./ShelfPlayer";
import { NativeShelf, NativeShelfRow } from "./NativeShelf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";

/* ─── The Listening Booth — the Shelf pattern (NATIVE-PLAN §3.2) ────
   Your purchased library on a shelf, playable where you stand.
   Rows ride GET /api/store/purchases — the exact data layer the
   /my-music page uses (pages/my-music.tsx) — fetched with the
   member token (the host's useAuthHeaders pattern). Per song:
   • Play it here — resolves the item through the media rails the
     /track/:id and /watch/:id pages use (GET /api/media/:kind/:id
     via lib/streaming) and hands it to the ONE in-world player
     (ShelfPlayer, owned by the StationPanel host; the Charts
     board's Play lands on this same player).
   • Queue next (2.12) — the same resolution, onto the player's
     up-next queue instead of the speakers.
   • Put it on the jukebox — the existing `jukebox.add` socket
     intent (StationPanel's onJukeboxAdd → world-client), with the
     catalog-form track id. Tracks only; the jukebox is audio.
   • Add to a playlist (2.12) — the SITE's playlist rails
     (GET/POST /api/playlists… in routes/creator-platform.ts, spoken
     by lib/streaming's fetchMyPlaylists / createPlaylist /
     addItemToPlaylist). No parallel playlist store exists or was
     invented.
   • Download link + receipt (2.16) — POST /api/store/token is the
     token's legitimate use: a delivery link the buyer explicitly
     mints. Its `url` is an HTML delivery page that burns one of
     the link's uses when opened — the UI says so before and after
     the mint. It is NEVER a playback source.
   • Share — copies the track's site link to the clipboard (the
     walker's choice to send it — never a page the palace opens).
 *
 * Below the shelf: your playlists (play one here — first item on
 * the player, the rest as the queue) and Your Songs (2.14) — your
 * own tracks from GET /api/world/my-music, unpublished included and
 * badged, playable only because that endpoint enforces ownership
 * server-side. Non-media purchases (courses, packs) sit on the
 * shelf honestly: share-only, no fake Play button. */

export interface ListeningBoothProps {
  isLight: boolean;
  /** The one in-world player (see ShelfPlayer's seam note). */
  shelfPlayer: ShelfPlayerController;
  /** The jukebox.add socket intent, exactly as the Jukebox panel
   *  receives it from the host. */
  onJukeboxAdd: (trackId: string) => void;
}

/** What the add-to-playlist picker is adding. */
interface PickerTarget {
  kind: MediaKind;
  id: string;
  title: string;
}

function AddToPlaylistPicker({
  isLight,
  target,
  authHeaders,
  onClose,
  onDone,
}: {
  isLight: boolean;
  target: PickerTarget;
  authHeaders: () => Promise<Record<string, string>>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [lists, setLists] = useState<ShelfPlaylistSummary[] | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mine = await fetchMyPlaylists(await authHeaders()).catch(() => null);
      if (cancelled) return;
      if (mine === null) setFailed(true);
      else setLists(parseShelfPlaylists({ playlists: mine }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);

  const add = async (playlistId: string, title: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await addItemToPlaylist(playlistId, target.kind, target.id, await authHeaders());
      if (ok) onDone(`“${target.title}” is on “${title}” now — play the playlist any time from your shelf.`);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const created = await createPlaylist(title, await authHeaders());
      if (!created) {
        setFailed(true);
        return;
      }
      await add(created.id, created.title ?? title);
    } finally {
      setBusy(false);
    }
  };

  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

  return (
    <div
      className={`mt-2 rounded-xl border p-3 ${isLight ? "border-[#7A5A12]/25 bg-white/50" : "border-white/10 bg-white/[.03]"}`}
      data-testid="world-shelf-playlist-picker"
    >
      <p className={`text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
        Add “{target.title}” to a playlist
      </p>
      {failed ? (
        <p className={`mt-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          The playlist rails didn&rsquo;t answer — if you haven&rsquo;t set up a creator profile yet, playlists
          start there. Nothing was changed.
        </p>
      ) : lists === null ? (
        <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>Opening your playlists…</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {lists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              data-testid="world-shelf-playlist-add"
              disabled={busy}
              onClick={() => void add(pl.id, pl.title)}
              className={chipBtn}
            >
              <ListPlus className="h-3.5 w-3.5 text-[#d4af37]" /> {pl.title} · {pl.itemCount}
            </button>
          ))}
          {lists.length === 0 && (
            <span className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              No playlists yet — start one below.
            </span>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void createAndAdd(); }}
          placeholder="New playlist name…"
          maxLength={80}
          data-testid="world-shelf-playlist-new-name"
          className={`min-w-0 flex-1 rounded-full border px-3 py-1.5 text-xs outline-none ${
            isLight
              ? "border-[#7A5A12]/30 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
              : "border-white/15 bg-white/5 text-white placeholder:text-white/35"
          }`}
        />
        <button
          type="button"
          data-testid="world-shelf-playlist-create"
          disabled={busy || !newTitle.trim()}
          onClick={() => void createAndAdd()}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Create &amp; add
        </button>
        <button type="button" onClick={onClose} className={chipBtn}>
          Done
        </button>
      </div>
    </div>
  );
}

export function ListeningBooth({ isLight, shelfPlayer, onJukeboxAdd }: ListeningBoothProps) {
  const { getAccessToken } = useAuth();
  const [purchases, setPurchases] = useState<ShelfPurchase[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  const [playlists, setPlaylists] = useState<ShelfPlaylistSummary[] | null>(null);
  const [myMusic, setMyMusic] = useState<MyMusicTrack[] | null>(null);
  const [mints, setMints] = useState<Record<string, ShelfDownloadMint>>({});
  const [mintBusyId, setMintBusyId] = useState<string | null>(null);
  const [mintCopiedId, setMintCopiedId] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/store/purchases", { headers });
      if (!res.ok) throw new Error("purchases");
      setPurchases(parseShelfPurchases(await res.json().catch(() => ({}))));
    } catch {
      setFailed(true);
    }
    /* The side shelves degrade independently — a playlist or
       my-music hiccup never takes the bought shelf down with it. */
    try {
      const mine = await fetchMyPlaylists(await authHeaders());
      setPlaylists(mine === null ? [] : parseShelfPlaylists({ playlists: mine }));
    } catch {
      setPlaylists([]);
    }
    try {
      const res = await fetch("/api/world/my-music", { headers: await authHeaders() });
      setMyMusic(res.ok ? parseMyMusic(await res.json().catch(() => ({}))) : []);
    } catch {
      setMyMusic([]);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  /** Resolve a purchase through the media rails into a play input
   *  (shared by Play and Queue-next). Null = honestly unplayable. */
  const resolvePurchase = async (p: ShelfPurchase): Promise<ShelfPlayInput | null> => {
    if (p.itemKind === "video") {
      const r = await fetchVideo(p.itemId);
      return r ? playInputFromVideo(p, r.video, r.artist?.display_name ?? null, r.artist?.slug ?? null) : null;
    }
    const r = await fetchTrack(p.itemId);
    return r ? playInputFromTrack(p, r.track, r.artist?.display_name ?? null, r.artist?.slug ?? null) : null;
  };

  const playHere = async (p: ShelfPurchase) => {
    if (resolvingId) return;
    // Pressing Play on the song that's already on = pause/resume it.
    if (
      shelfPlayer.current &&
      isSameShelfItem(shelfPlayer.current, { kind: p.itemKind === "video" ? "video" : "track", id: p.itemId })
    ) {
      shelfPlayer.toggle();
      return;
    }
    setResolvingId(p.id);
    setNote(null);
    try {
      const input = await resolvePurchase(p);
      if (!input) {
        setNote(
          `“${p.title}” couldn't be opened for playing here — it may no longer be published. Your purchase is safe; its full page is one tap below.`,
        );
        return;
      }
      shelfPlayer.play(input);
      recordPlay(input.kind, input.id);
    } catch {
      setNote("The shelf player stumbled opening that one — nothing was charged or changed. Try it again.");
    } finally {
      setResolvingId(null);
    }
  };

  const queueNextPurchase = async (p: ShelfPurchase) => {
    if (resolvingId) return;
    setResolvingId(p.id);
    setNote(null);
    try {
      const input = await resolvePurchase(p);
      if (!input) {
        setNote(`“${p.title}” couldn't be queued — it may no longer be published. Your purchase is safe.`);
        return;
      }
      shelfPlayer.queueNext(input);
      setNote(
        shelfPlayer.current
          ? `“${p.title}” is up next on your player — when this one ends, that's the moment it lands.`
          : `“${p.title}” is queued — press Play on anything and it follows.`,
      );
    } catch {
      setNote("The queue stumbled — nothing was charged or changed. Try it again.");
    } finally {
      setResolvingId(null);
    }
  };

  const playMyMusic = (row: MyMusicTrack) => {
    const input = playInputFromMyMusic(row);
    if (!input) {
      setNote(`“${row.title}” has no playable file yet — finish the upload and it plays here.`);
      return;
    }
    if (shelfPlayer.current && isSameShelfItem(shelfPlayer.current, input)) {
      shelfPlayer.toggle();
      return;
    }
    shelfPlayer.play(input);
    /* A draft hearing is not a public play — only published rows
       count one, exactly as the site counts them. */
    if (row.isPublished) recordPlay("track", row.id);
    setNote(
      row.isPublished
        ? null
        : `“${row.title}” is playing for you alone — it's yours and it isn't published yet.`,
    );
  };

  const queueNextMyMusic = (row: MyMusicTrack) => {
    const input = playInputFromMyMusic(row);
    if (!input) return;
    shelfPlayer.queueNext(input);
    setNote(`“${row.title}” is up next on your player.`);
  };

  const playPlaylist = async (pl: ShelfPlaylistSummary) => {
    if (resolvingId) return;
    setResolvingId(pl.id);
    setNote(null);
    try {
      const r = await fetchPlaylist(pl.id);
      const inputs = r ? playInputsFromPlaylist(r.playlist) : [];
      if (inputs.length === 0) {
        setNote(`“${pl.title}” has nothing playable in it yet — add a song from your shelf and it runs here.`);
        return;
      }
      const [first, ...rest] = inputs;
      shelfPlayer.play(first!);
      shelfPlayer.replaceQueue(rest);
      recordPlay(first!.kind, first!.id);
      setNote(
        rest.length > 0
          ? `“${pl.title}” is on — ${inputs.length} songs lined up, the rest waiting in Up Next.`
          : `“${pl.title}” is on.`,
      );
    } catch {
      setNote("That playlist wouldn't open — your shelf is untouched. Try it again.");
    } finally {
      setResolvingId(null);
    }
  };

  const mintDownload = async (p: ShelfPurchase) => {
    if (mintBusyId) return;
    setMintBusyId(p.id);
    setNote(null);
    try {
      const raw = await mintStoreDownloadLink(p.id, await authHeaders());
      const mint = parseDownloadMint(raw);
      if (!mint) {
        setNote(`A download link for “${p.title}” couldn't be made — the content may no longer be available. Your purchase record below still stands.`);
        return;
      }
      setMints((prev) => ({ ...prev, [p.id]: mint }));
    } catch {
      setNote("The download link wouldn't mint — nothing was spent or changed. Try it again.");
    } finally {
      setMintBusyId(null);
    }
  };

  const copyMint = async (p: ShelfPurchase) => {
    const mint = mints[p.id];
    if (!mint) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "https://bowdownvisuals.com";
    if (await copyText(`${origin}${mint.url}`)) {
      setMintCopiedId(p.id);
      setTimeout(() => setMintCopiedId((cur) => (cur === p.id ? null : cur)), 2500);
    }
  };

  const share = async (p: ShelfPurchase) => {
    const ok = await copyText(shareUrl(shelfPagePath(p)));
    if (ok) {
      setSharedId(p.id);
      setTimeout(() => setSharedId((cur) => (cur === p.id ? null : cur)), 2500);
    } else {
      setNote("The link wouldn't copy — the share rails hiccuped. The song itself is fine.");
    }
  };

  const putOnJukebox = (p: ShelfPurchase) => {
    const trackId = shelfJukeboxTrackId(p);
    if (!trackId) return;
    onJukeboxAdd(trackId);
    setQueuedId(p.id);
    setNote(`“${p.title}” is on its way to the Music Hall jukebox — the room hears it together there.`);
    setTimeout(() => setQueuedId((cur) => (cur === p.id ? null : cur)), 2500);
  };

  if (failed) {
    return (
      <NativeErrorState
        isLight={isLight}
        title="The shelf wouldn't open in the palace"
        message="Your library wouldn't load — your purchases are safe on the real rails."
        onRetry={() => setTick((n) => n + 1)}
      />
    );
  }
  if (purchases === null) {
    return <NativeLoadingState isLight={isLight} message="Lining up your shelf…" />;
  }

  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
  const sectionTitle = `px-1 pt-4 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  const allEmpty = purchases.length === 0 && (playlists ?? []).length === 0 && (myMusic ?? []).length === 0;

  if (allEmpty && playlists !== null && myMusic !== null) {
    return (
      <NativeEmptyState
        isLight={isLight}
        message="Your shelf is bare — nothing bought, made or lined up yet."
        detail="When you buy a track, video, course or any digital drop, it lands here forever, playable where you stand. Your own songs and playlists live here too."
      />
    );
  }

  return (
    <div>
      {purchases.length > 0 && (
        <NativeShelf>
          {purchases.map((p) => {
            const playable = shelfIsPlayable(p);
            const kind = p.itemKind === "video" ? "video" : "track";
            const jukeboxId = shelfJukeboxTrackId(p);
            const isCurrent =
              !!shelfPlayer.current &&
              isSameShelfItem(shelfPlayer.current, { kind, id: p.itemId });
            const mint = mints[p.id];
            return (
              <div key={p.id}>
                <NativeShelfRow
                  isLight={isLight}
                  title={p.title}
                  detail={shelfDetailLine(p)}
                  artworkUrl={p.artworkUrl}
                  action={
                    <>
                      {playable ? (
                        <button
                          type="button"
                          data-testid="world-shelf-play"
                          onClick={() => void playHere(p)}
                          disabled={resolvingId === p.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                        >
                          {isCurrent && shelfPlayer.playing ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {resolvingId === p.id ? "Opening…" : isCurrent ? (shelfPlayer.playing ? "Pause" : "Resume") : "Play it here"}
                        </button>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                          <ListMusic className="h-3.5 w-3.5" /> Not playable here
                        </span>
                      )}
                      {playable && (
                        <button
                          type="button"
                          data-testid="world-shelf-queue-next"
                          onClick={() => void queueNextPurchase(p)}
                          disabled={resolvingId === p.id}
                          className={chipBtn}
                        >
                          <ListPlus className="h-3.5 w-3.5 text-[#d4af37]" /> Queue next
                        </button>
                      )}
                      {playable && (
                        <button
                          type="button"
                          data-testid="world-shelf-add-to-playlist"
                          onClick={() =>
                            setPickerFor(pickerFor?.id === p.itemId && pickerFor?.kind === kind ? null : { kind, id: p.itemId, title: p.title })
                          }
                          className={chipBtn}
                        >
                          <ListMusic className="h-3.5 w-3.5 text-[#d4af37]" /> Add to playlist
                        </button>
                      )}
                      {jukeboxId && (
                        <button
                          type="button"
                          data-testid="world-shelf-jukebox"
                          onClick={() => putOnJukebox(p)}
                          className={chipBtn}
                        >
                          <ListMusic className="h-3.5 w-3.5 text-[#d4af37]" />
                          {queuedId === p.id ? "On the jukebox ✓" : "Put it on the jukebox"}
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="world-shelf-download"
                        onClick={() => void mintDownload(p)}
                        disabled={mintBusyId === p.id}
                        className={chipBtn}
                      >
                        <Download className="h-3.5 w-3.5 text-[#d4af37]" />
                        {mintBusyId === p.id ? "Making link…" : mint ? "Make a fresh link" : "Download link"}
                      </button>
                      <button
                        type="button"
                        data-testid="world-shelf-share"
                        onClick={() => void share(p)}
                        className={chipBtn}
                      >
                        <Link2 className="h-3.5 w-3.5 text-[#d4af37]" />
                        {sharedId === p.id ? "Link copied!" : "Share"}
                      </button>
                    </>
                  }
                />
                {/* The receipt (2.16): every purchase carries its
                    receipt line right on the shelf. */}
                <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  {shelfReceiptLine(p)}
                </p>
                {mint && (
                  <div
                    className={`mx-1 mt-1 rounded-xl border p-2.5 ${isLight ? "border-[#7A5A12]/25 bg-white/50" : "border-white/10 bg-white/[.03]"}`}
                    data-testid="world-shelf-download-mint"
                  >
                    <p className={`text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                      {downloadMintCopy(mint)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <code className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-[11px] ${isLight ? "bg-black/[.04] text-[#2a1e07]" : "bg-white/[.06] text-white/80"}`}>
                        {mint.url}
                      </code>
                      <button type="button" data-testid="world-shelf-download-copy" onClick={() => void copyMint(p)} className={chipBtn}>
                        {mintCopiedId === p.id ? <Check className="h-3.5 w-3.5 text-[#d4af37]" /> : <Link2 className="h-3.5 w-3.5 text-[#d4af37]" />}
                        {mintCopiedId === p.id ? "Copied!" : "Copy link"}
                      </button>
                    </div>
                  </div>
                )}
                {pickerFor && pickerFor.kind === kind && pickerFor.id === p.itemId && (
                  <AddToPlaylistPicker
                    isLight={isLight}
                    target={pickerFor}
                    authHeaders={authHeaders}
                    onClose={() => setPickerFor(null)}
                    onDone={(message) => {
                      setPickerFor(null);
                      setNote(message);
                      void load();
                    }}
                  />
                )}
              </div>
            );
          })}
        </NativeShelf>
      )}

      {(playlists ?? []).length > 0 && (
        <>
          <p className={sectionTitle}>Your playlists</p>
          <NativeShelf>
            {(playlists ?? []).map((pl) => (
              <NativeShelfRow
                key={pl.id}
                isLight={isLight}
                title={pl.title}
                detail={`${pl.itemCount} ${pl.itemCount === 1 ? "item" : "items"} · yours`}
                artworkUrl={pl.coverUrl}
                action={
                  <button
                    type="button"
                    data-testid="world-shelf-playlist-play"
                    onClick={() => void playPlaylist(pl)}
                    disabled={resolvingId === pl.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {resolvingId === pl.id ? "Opening…" : "Play it here"}
                  </button>
                }
              />
            ))}
          </NativeShelf>
        </>
      )}

      {(myMusic ?? []).length > 0 && (
        <>
          <p className={sectionTitle}>Your songs — published or not</p>
          <NativeShelf>
            {(myMusic ?? []).map((row) => {
              const input = playInputFromMyMusic(row);
              const isCurrent = !!input && !!shelfPlayer.current && isSameShelfItem(shelfPlayer.current, input);
              return (
                <div key={row.id}>
                  <NativeShelfRow
                    isLight={isLight}
                    title={row.title}
                    detail={[
                      row.artistName ?? "You",
                      row.genre,
                      row.isPublished ? "Published" : "Not published yet — yours only",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    artworkUrl={row.artworkUrl}
                    action={
                      <>
                        <button
                          type="button"
                          data-testid="world-my-music-play"
                          onClick={() => playMyMusic(row)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                        >
                          {isCurrent && shelfPlayer.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          {isCurrent ? (shelfPlayer.playing ? "Pause" : "Resume") : "Play it here"}
                        </button>
                        <button
                          type="button"
                          data-testid="world-my-music-queue-next"
                          onClick={() => queueNextMyMusic(row)}
                          className={chipBtn}
                        >
                          <ListPlus className="h-3.5 w-3.5 text-[#d4af37]" /> Queue next
                        </button>
                        <button
                          type="button"
                          data-testid="world-my-music-add-to-playlist"
                          onClick={() =>
                            setPickerFor(
                              pickerFor?.id === row.id && pickerFor?.kind === "track"
                                ? null
                                : { kind: "track", id: row.id, title: row.title },
                            )
                          }
                          className={chipBtn}
                        >
                          <ListMusic className="h-3.5 w-3.5 text-[#d4af37]" /> Add to playlist
                        </button>
                        {!row.isPublished && (
                          <span className="inline-flex items-center rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
                            Not published yet
                          </span>
                        )}
                      </>
                    }
                  />
                  {pickerFor && pickerFor.kind === "track" && pickerFor.id === row.id && (
                    <AddToPlaylistPicker
                      isLight={isLight}
                      target={pickerFor}
                      authHeaders={authHeaders}
                      onClose={() => setPickerFor(null)}
                      onDone={(message) => {
                        setPickerFor(null);
                        setNote(message);
                        void load();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </NativeShelf>
        </>
      )}

      {note && (
        <p className={`px-1 pt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
      )}
      <p className={`px-1 pt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        Your shelf is your bought library — the same one My Music keeps — plus your playlists and your own
        songs. Play it here and it plays for you alone; queue what&rsquo;s next and the moment lands when the
        current song ends; put it on the jukebox and the whole Music Hall hears it together.
      </p>
    </div>
  );
}
