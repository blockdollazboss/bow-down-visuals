import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  getMyReferralCode,
  mintStoreDownloadLink,
  recordPlay,
  shareUrl,
  type MediaKind,
} from "@/lib/streaming";
import {
  downloadMintCopy,
  isSameShelfItem,
  myMusicSharePath,
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
     invented. A playlist can also be STARTED on its own from the
     Your Playlists area (2.12's "build playlists from the shelf" as
     a first-class act, not only as a side effect of adding a
     track): the area renders as soon as playlists load — empty
     included — with a name field that creates an empty list the
     shelf's Add-to-playlist chips then fill.
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
 * shelf honestly: share-only, no fake Play button.
 *
 * Track extras on Your Songs (2.15): a PUBLISHED song also carries
 * Share — the website's own share surface (shareUrl + the walker's
 * referral code: the link the /track/:id share menu and the owner's
 * Get Paid finale build). Unpublished songs carry none: their
 * public page doesn't exist yet, and a dead-end link is not an
 * extra. Lyrics and stems are not wired, because the site stores
 * neither per profile track — lyrics live on library songs and
 * distribution releases (neither keyed to a track), stems are a
 * paid splitter job's output (already benched at the Audio Desk).
 * No honest rail, no pretend button. */

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
  const { t } = useTranslation();
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
      if (ok) onDone(t("worldAudioDesk.addedToPlaylistNote", { title: target.title, list: title }));
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

  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
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
        {t("worldAudioDesk.pickerTitle", { title: target.title })}
      </p>
      {failed ? (
        <p className={`mt-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldAudioDesk.pickerFailedNote")}
        </p>
      ) : lists === null ? (
        <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>{t("worldAudioDesk.openingPlaylists")}</p>
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
              {t("worldAudioDesk.noPlaylistsYetPicker")}
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
          placeholder={t("worldAudioDesk.newPlaylistPlaceholder")}
          aria-label={t("worldAudioDesk.newPlaylistAria")}
          maxLength={80}
          data-testid="world-shelf-playlist-new-name"
          className={`min-w-0 flex-1 rounded-full border px-3 py-1.5 text-xs outline-none bdv-touch-target ${
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
          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          <Plus className="h-3.5 w-3.5" /> {t("worldAudioDesk.createAndAddBtn")}
        </button>
        <button type="button" onClick={onClose} className={chipBtn}>
          {t("worldAudioDesk.doneBtn")}
        </button>
      </div>
    </div>
  );
}

export function ListeningBooth({ isLight, shelfPlayer, onJukeboxAdd }: ListeningBoothProps) {
  const { t, i18n } = useTranslation();
  const { getAccessToken } = useAuth();
  const [purchases, setPurchases] = useState<ShelfPurchase[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [sharedMusicId, setSharedMusicId] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  const [playlists, setPlaylists] = useState<ShelfPlaylistSummary[] | null>(null);
  /* Per-shelf honest failure flags (Stack-200 D2 A15): the purchases
     shelf already had one (`failed`); the side shelves used to collapse
     a failed load into setX([]) — "No playlists yet" on a read error. */
  const [playlistsFailed, setPlaylistsFailed] = useState(false);
  const [myMusicFailed, setMyMusicFailed] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [creatingList, setCreatingList] = useState(false);
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
       my-music hiccup never takes the bought shelf down with it.
       Degrading is not lying, though: a failed side-shelf read raises
       its failed flag (loaded entries survive a failed reload) instead
       of dressing up as an empty shelf. */
    try {
      const mine = await fetchMyPlaylists(await authHeaders());
      if (mine === null) {
        setPlaylists((cur) => cur ?? []);
        setPlaylistsFailed(true);
      } else {
        setPlaylists(parseShelfPlaylists({ playlists: mine }));
        setPlaylistsFailed(false);
      }
    } catch {
      setPlaylists((cur) => cur ?? []);
      setPlaylistsFailed(true);
    }
    try {
      const res = await fetch("/api/world/my-music", { headers: await authHeaders() });
      if (!res.ok) throw new Error("my-music");
      setMyMusic(parseMyMusic(await res.json().catch(() => ({}))));
      setMyMusicFailed(false);
    } catch {
      setMyMusic((cur) => cur ?? []);
      setMyMusicFailed(true);
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
        setNote(t("worldAudioDesk.purchaseUnplayableNote", { title: p.title }));
        return;
      }
      shelfPlayer.play(input);
      recordPlay(input.kind, input.id);
    } catch {
      setNote(t("worldAudioDesk.playerStumbledNote"));
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
        setNote(t("worldAudioDesk.queueUnplayableNote", { title: p.title }));
        return;
      }
      shelfPlayer.queueNext(input);
      setNote(
        shelfPlayer.current
          ? t("worldAudioDesk.queueUpNextNote", { title: p.title })
          : t("worldAudioDesk.queueQueuedNote", { title: p.title }),
      );
    } catch {
      setNote(t("worldAudioDesk.queueStumbledNote"));
    } finally {
      setResolvingId(null);
    }
  };

  const playMyMusic = (row: MyMusicTrack) => {
    const input = playInputFromMyMusic(row);
    if (!input) {
      setNote(t("worldAudioDesk.noPlayableFile", { title: row.title }));
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
        : t("worldAudioDesk.playingForYouAlone", { title: row.title }),
    );
  };

  const queueNextMyMusic = (row: MyMusicTrack) => {
    const input = playInputFromMyMusic(row);
    if (!input) return;
    shelfPlayer.queueNext(input);
    setNote(t("worldAudioDesk.upNextNote", { title: row.title }));
  };

  const playPlaylist = async (pl: ShelfPlaylistSummary) => {
    if (resolvingId) return;
    setResolvingId(pl.id);
    setNote(null);
    try {
      const r = await fetchPlaylist(pl.id);
      const inputs = r ? playInputsFromPlaylist(r.playlist) : [];
      if (inputs.length === 0) {
        setNote(t("worldAudioDesk.playlistEmptyNote", { title: pl.title }));
        return;
      }
      const [first, ...rest] = inputs;
      shelfPlayer.play(first!);
      shelfPlayer.replaceQueue(rest);
      recordPlay(first!.kind, first!.id);
      setNote(
        rest.length > 0
          ? t("worldAudioDesk.playlistOnManyNote", { title: pl.title, count: inputs.length })
          : t("worldAudioDesk.playlistOnOneNote", { title: pl.title }),
      );
    } catch {
      setNote(t("worldAudioDesk.playlistOpenFailedNote"));
    } finally {
      setResolvingId(null);
    }
  };

  /** Start a playlist of its own (2.12): an empty list, created on
   *  the site's rails from the Booth — the shelf's Add-to-playlist
   *  chips fill it afterwards. The create rail needs a creator
   *  profile; a refusal says so honestly and changes nothing. */
  const startPlaylist = async () => {
    const title = newListTitle.trim();
    if (!title || creatingList) return;
    setCreatingList(true);
    setNote(null);
    try {
      const created = await createPlaylist(title, await authHeaders());
      if (!created) {
        setNote(t("worldAudioDesk.startPlaylistFailedProfileNote"));
        return;
      }
      setNewListTitle("");
      setNote(t("worldAudioDesk.playlistStartedNote", { title: created.title ?? title }));
      void load();
    } catch {
      setNote(t("worldAudioDesk.startPlaylistFailedNote"));
    } finally {
      setCreatingList(false);
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
        setNote(t("worldAudioDesk.mintFailedNote", { title: p.title }));
        return;
      }
      setMints((prev) => ({ ...prev, [p.id]: mint }));
    } catch {
      setNote(t("worldAudioDesk.mintStumbledNote"));
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
      setNote(t("worldAudioDesk.linkCopyFailedNote"));
    }
  };

  /** Share one of your own songs (track extras, 2.15): the
   *  website's share surface — the referral-coded link to its
   *  public page, exactly what the /track/:id share menu and the
   *  Get Paid finale copy. Published rows only: the seam returns
   *  no path for an unpublished song, whose page doesn't exist. */
  const shareMyMusic = async (row: MyMusicTrack) => {
    const path = myMusicSharePath(row);
    if (!path) return;
    const code = await getMyReferralCode(getAccessToken);
    const ok = await copyText(shareUrl(path, code));
    if (ok) {
      setSharedMusicId(row.id);
      setTimeout(() => setSharedMusicId((cur) => (cur === row.id ? null : cur)), 2500);
    } else {
      setNote(t("worldAudioDesk.linkCopyFailedNote"));
    }
  };

  const putOnJukebox = (p: ShelfPurchase) => {
    const trackId = shelfJukeboxTrackId(p);
    if (!trackId) return;
    onJukeboxAdd(trackId);
    setQueuedId(p.id);
    setNote(t("worldAudioDesk.jukeboxOnItsWayNote", { title: p.title }));
    setTimeout(() => setQueuedId((cur) => (cur === p.id ? null : cur)), 2500);
  };

  if (failed) {
    return (
      <NativeErrorState
        isLight={isLight}
        title={t("worldAudioDesk.shelfErrorTitle")}
        message={t("worldAudioDesk.shelfErrorMessage")}
        onRetry={() => setTick((n) => n + 1)}
      />
    );
  }
  if (purchases === null) {
    return <NativeLoadingState isLight={isLight} message={t("worldAudioDesk.shelfLoading")} />;
  }

  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
  const sectionTitle = `px-1 pt-4 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  const allEmpty = purchases.length === 0 && (playlists ?? []).length === 0 && (myMusic ?? []).length === 0;

  /* Your Playlists (2.12): rendered as soon as the lists load —
     EMPTY INCLUDED — so building a playlist is always one name
     away at the Booth, never hidden behind owning one already.
     The block rides both returns (the bare-shelf empty state and
     the full shelf) so the build path never disappears. */
  const shelfRetryLine = (testid: string) => (
    <p className={`flex flex-wrap items-center gap-2 px-1 pt-1 text-xs ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid={testid}>
      {t("worldAudioDesk.shelfLoadErrorLine")}
      <button type="button" onClick={() => setTick((n) => n + 1)} className={chipBtn}>
        {t("worldAudioDesk.shelfRetryBtn")}
      </button>
    </p>
  );
  const myMusicFailedBlock = myMusicFailed && (
    <>
      <p className={sectionTitle}>{t("worldAudioDesk.yourSongsHeading")}</p>
      {shelfRetryLine("world-shelf-mymusic-load-error")}
    </>
  );

  const playlistsBlock = playlists !== null && (
    <>
      <p className={sectionTitle}>{t("worldAudioDesk.yourPlaylistsHeading")}</p>
      {playlistsFailed && shelfRetryLine("world-shelf-playlists-load-error")}
      {playlists.length === 0 ? (
        playlistsFailed ? null : (
          <p className={`px-1 pt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("worldAudioDesk.noPlaylistsYetBooth")}
          </p>
        )
      ) : (
        <NativeShelf>
          {playlists.map((pl) => (
            <NativeShelfRow
              key={pl.id}
              isLight={isLight}
              title={pl.title}
              detail={t("worldAudioDesk.playlistItemCount", { count: pl.itemCount })}
              artworkUrl={pl.coverUrl}
              action={
                <button
                  type="button"
                  data-testid="world-shelf-playlist-play"
                  onClick={() => void playPlaylist(pl)}
                  disabled={resolvingId === pl.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                >
                  <Play className="h-3.5 w-3.5" />
                  {resolvingId === pl.id ? t("worldAudioDesk.openingBtn") : t("worldAudioDesk.playItHere")}
                </button>
              }
            />
          ))}
        </NativeShelf>
      )}
      <div className="mt-2 flex items-center gap-2 px-1">
        <input
          type="text"
          value={newListTitle}
          onChange={(e) => setNewListTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void startPlaylist(); }}
          placeholder={t("worldAudioDesk.newPlaylistPlaceholder")}
          maxLength={80}
          data-testid="world-shelf-playlist-start-name"
          aria-label={t("worldAudioDesk.newPlaylistAria")}
          className={`min-w-0 flex-1 rounded-full border px-3 py-1.5 text-xs outline-none bdv-touch-target ${
            isLight
              ? "border-[#7A5A12]/30 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
              : "border-white/15 bg-white/5 text-white placeholder:text-white/35"
          }`}
        />
        <button
          type="button"
          data-testid="world-shelf-playlist-start"
          disabled={creatingList || !newListTitle.trim()}
          onClick={() => void startPlaylist()}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          <Plus className="h-3.5 w-3.5" /> {t("worldAudioDesk.startPlaylistBtn")}
        </button>
      </div>
    </>
  );

  if (allEmpty && !playlistsFailed && !myMusicFailed && playlists !== null && myMusic !== null) {
    return (
      <div>
        <NativeEmptyState
          isLight={isLight}
          message={t("worldAudioDesk.shelfEmptyMessage")}
          detail={t("worldAudioDesk.shelfEmptyDetail")}
        />
        {playlistsBlock}
        {note && (
          <p className={`px-1 pt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
        )}
      </div>
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
                  detail={shelfDetailLine(p, {
                    lang: i18n.language,
                    kindLabels: { track: t("worldAudioDesk.kindSong"), video: t("worldAudioDesk.kindVideo") },
                  })}
                  artworkUrl={p.artworkUrl}
                  action={
                    <>
                      {playable ? (
                        <button
                          type="button"
                          data-testid="world-shelf-play"
                          onClick={() => void playHere(p)}
                          disabled={resolvingId === p.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                        >
                          {isCurrent && shelfPlayer.playing ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {resolvingId === p.id ? t("worldAudioDesk.openingBtn") : isCurrent ? (shelfPlayer.playing ? t("worldAudioDesk.pauseLabel") : t("worldAudioDesk.resumeLabel")) : t("worldAudioDesk.playItHere")}
                        </button>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                          <ListMusic className="h-3.5 w-3.5" /> {t("worldAudioDesk.notPlayableHere")}
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
                          <ListPlus className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldAudioDesk.queueNext")}
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
                          <ListMusic className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldAudioDesk.addToPlaylistBtn")}
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
                          {queuedId === p.id ? t("worldAudioDesk.onJukeboxBtn") : t("worldAudioDesk.putOnJukeboxBtn")}
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
                        {mintBusyId === p.id ? t("worldAudioDesk.makingLinkBtn") : mint ? t("worldAudioDesk.makeFreshLinkBtn") : t("worldAudioDesk.downloadLinkBtn")}
                      </button>
                      <button
                        type="button"
                        data-testid="world-shelf-share"
                        onClick={() => void share(p)}
                        className={chipBtn}
                      >
                        <Link2 className="h-3.5 w-3.5 text-[#d4af37]" />
                        {sharedId === p.id ? t("worldAudioDesk.linkCopiedBtn") : t("worldAudioDesk.shareBtn")}
                      </button>
                    </>
                  }
                />
                {/* The receipt (2.16): every purchase carries its
                    receipt line right on the shelf. */}
                <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                  {shelfReceiptLine(p, { lang: i18n.language, receiptTemplate: t("worldAudioDesk.receiptLabel") })}
                </p>
                {mint && (
                  <div
                    className={`mx-1 mt-1 rounded-xl border p-2.5 ${isLight ? "border-[#7A5A12]/25 bg-white/50" : "border-white/10 bg-white/[.03]"}`}
                    data-testid="world-shelf-download-mint"
                  >
                    <p className={`text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                      {downloadMintCopy(mint, {
                        lang: i18n.language,
                        strings: {
                          start: t("worldAudioDesk.mintCopyStart"),
                          usesCount: t("worldAudioDesk.mintUsesCount"),
                          usesLimited: t("worldAudioDesk.mintUsesLimited"),
                          expiresPart: t("worldAudioDesk.mintExpiresPart"),
                          end: t("worldAudioDesk.mintCopyEnd"),
                        },
                      })}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <code className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-[11px] ${isLight ? "bg-black/[.04] text-[#2a1e07]" : "bg-white/[.06] text-white/80"}`}>
                        {mint.url}
                      </code>
                      <button type="button" data-testid="world-shelf-download-copy" onClick={() => void copyMint(p)} className={chipBtn}>
                        {mintCopiedId === p.id ? <Check className="h-3.5 w-3.5 text-[#d4af37]" /> : <Link2 className="h-3.5 w-3.5 text-[#d4af37]" />}
                        {mintCopiedId === p.id ? t("worldAudioDesk.copiedBtn") : t("worldAudioDesk.copyLinkBtn")}
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

      {playlistsBlock}

      {myMusicFailedBlock}

      {(myMusic ?? []).length > 0 && (
        <>
          <p className={sectionTitle}>{t("worldAudioDesk.yourSongsHeading")}</p>
          <NativeShelf>
            {(myMusic ?? []).map((row) => {
              const input = playInputFromMyMusic(row);
              const isCurrent = !!input && !!shelfPlayer.current && isSameShelfItem(shelfPlayer.current, input);
              const sharePath = myMusicSharePath(row);
              return (
                <div key={row.id}>
                  <NativeShelfRow
                    isLight={isLight}
                    title={row.title}
                    detail={[
                      row.artistName ?? t("worldAudioDesk.youFallback"),
                      row.genre,
                      row.isPublished ? t("worldAudioDesk.publishedLabel") : t("worldAudioDesk.notPublishedDetail"),
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
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                        >
                          {isCurrent && shelfPlayer.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          {isCurrent ? (shelfPlayer.playing ? t("worldAudioDesk.pauseLabel") : t("worldAudioDesk.resumeLabel")) : t("worldAudioDesk.playItHere")}
                        </button>
                        <button
                          type="button"
                          data-testid="world-my-music-queue-next"
                          onClick={() => queueNextMyMusic(row)}
                          className={chipBtn}
                        >
                          <ListPlus className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldAudioDesk.queueNext")}
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
                          <ListMusic className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldAudioDesk.addToPlaylistBtn")}
                        </button>
                        {sharePath && (
                          <button
                            type="button"
                            data-testid="world-my-music-share"
                            onClick={() => void shareMyMusic(row)}
                            className={chipBtn}
                          >
                            <Link2 className="h-3.5 w-3.5 text-[#d4af37]" />
                            {sharedMusicId === row.id ? t("worldAudioDesk.linkCopiedBtn") : t("worldAudioDesk.shareBtn")}
                          </button>
                        )}
                        {!row.isPublished && (
                          <span className="inline-flex items-center rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
                            {t("worldAudioDesk.notPublishedBadge")}
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
        {t("worldAudioDesk.shelfFooterNote")}
      </p>
    </div>
  );
}
