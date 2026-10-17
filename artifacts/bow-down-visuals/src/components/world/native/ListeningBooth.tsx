import { useCallback, useEffect, useState } from "react";
import { Link2, ListMusic, Pause, Play } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  copyText,
  fetchTrack,
  fetchVideo,
  recordPlay,
  shareUrl,
} from "@/lib/streaming";
import {
  isSameShelfItem,
  parseShelfPurchases,
  playInputFromTrack,
  playInputFromVideo,
  shelfDetailLine,
  shelfIsPlayable,
  shelfJukeboxTrackId,
  shelfPagePath,
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
   • Put it on the jukebox — the existing `jukebox.add` socket
     intent (StationPanel's onJukeboxAdd → world-client), with the
     catalog-form track id. Tracks only; the jukebox is audio.
   • Share — copies the track's site link to the clipboard (the
     walker's choice to send it — never a page the palace opens).
 *
 * The store token (POST /api/store/token — the brief said GET;
 * the route POSTs, as /my-music does) mints a DOWNLOAD page URL,
 * not a stream, so it is deliberately not a playback source here;
 * flagged in the lane report as an unusable-for-playback payload.
 * Non-media purchases (courses, packs) sit on the shelf honestly:
 * share-only, no fake Play button. */

export interface ListeningBoothProps {
  isLight: boolean;
  /** The one in-world player (see ShelfPlayer's seam note). */
  shelfPlayer: ShelfPlayerController;
  /** The jukebox.add socket intent, exactly as the Jukebox panel
   *  receives it from the host. */
  onJukeboxAdd: (trackId: string) => void;
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

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/store/purchases", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("purchases");
      setPurchases(parseShelfPurchases(await res.json().catch(() => ({}))));
    } catch {
      setFailed(true);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load, tick]);

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
      const input =
        p.itemKind === "video"
          ? await fetchVideo(p.itemId).then((r) => (r ? playInputFromVideo(p, r.video, r.artist?.display_name ?? null) : null))
          : await fetchTrack(p.itemId).then((r) => (r ? playInputFromTrack(p, r.track, r.artist?.display_name ?? null) : null));
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
  if (purchases.length === 0) {
    return (
      <NativeEmptyState
        isLight={isLight}
        message="Your shelf is bare — nothing bought yet."
        detail="When you buy a track, video, course or any digital drop, it lands here forever, playable where you stand."
      />
    );
  }

  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

  return (
    <div>
      <NativeShelf>
        {purchases.map((p) => {
          const playable = shelfIsPlayable(p);
          const jukeboxId = shelfJukeboxTrackId(p);
          const isCurrent =
            !!shelfPlayer.current &&
            isSameShelfItem(shelfPlayer.current, {
              kind: p.itemKind === "video" ? "video" : "track",
              id: p.itemId,
            });
          return (
            <NativeShelfRow
              key={p.id}
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
          );
        })}
      </NativeShelf>
      {note && (
        <p className={`px-1 pt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
      )}
      <p className={`px-1 pt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        Your shelf is your bought library — the same one My Music keeps. Play it here and it plays for you
        alone; put it on the jukebox and the whole Music Hall hears it together.
      </p>
    </div>
  );
}
