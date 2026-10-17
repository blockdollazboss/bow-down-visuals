import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, ListMusic, MessageCircle, Pause, Play } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchComments,
  toggleLike,
  type MediaComment,
} from "@/lib/streaming";
import {
  clampShelfSeek,
  formatShelfClock,
  isSameShelfItem,
  shelfPreviewComments,
  type ShelfPlayInput,
} from "@/lib/world/shelf";
import { NativeCard } from "./NativeCard";

/* ─── The Shelf player — THE one in-world personal player (§3.2) ────
   Mirrors the jukebox's wiring in pages/world.tsx: one media
   element, owned above the panels that feed it, driven by plain
   state (current / playing / position / duration) — never by a
   mounted website page. The difference is scope: the jukebox
   element is room-wide and lives in the world page; this one is
   personal and lives in the StationPanel host, passed to native
   surfaces as ONE prop bundle (`shelfPlayer`) in the same shape
   the jukebox's state + intents travel (jukebox / onJukeboxAdd /
   onJukeboxPlayPause … on StationPanelProps).
 *
 * THE SEAM FOR OTHER LANES (Charts §3.1 first): a native surface
 * that wants to play a track calls
 *   shelfPlayer.play({ kind, id, title, artistName, artworkUrl,
 *                      src, pagePath, likeCount, commentCount })
 * with `src` resolved through the media rails (lib/streaming
 * fetchTrack/fetchVideo → resolveMedia, or shelfPlayInput in
 * lib/world/shelf.ts). The Now Playing card below renders for
 * whatever the player holds, whichever station set it — so a
 * Charts Play press shows the same card the Booth shows. If a
 * future lane needs playback to survive the panel closing, hoist
 * useShelfPlayer into pages/world.tsx and pass the controller in
 * through StationPanel's optional `shelfPlayer` prop — the shape
 * does not change. */

export interface ShelfPlayerController {
  current: ShelfPlayInput | null;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  /** Start (or restart) an item on the one player. */
  play: (input: ShelfPlayInput) => void;
  /** Pause when playing, resume when paused — the current item only. */
  toggle: () => void;
  /** Seek the current item (clamped to its span). */
  seek: (targetSec: number) => void;
  /** Stop and clear the player (the card goes away). */
  stop: () => void;
  /** Card-facing wiring (the Now Playing card registers its media
   *  element here; the transport intents drive that element
   *  exactly as world.tsx drives the jukebox's). Other lanes only
   *  need the state + play/toggle/seek/stop above. */
  registerElement: (el: HTMLMediaElement | null) => void;
  syncPlaying: (playing: boolean) => void;
  syncPosition: (sec: number) => void;
  syncDuration: (sec: number) => void;
}

export function useShelfPlayer(): ShelfPlayerController {
  const [current, setCurrent] = useState<ShelfPlayInput | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const elementRef = useRef<HTMLMediaElement | null>(null);
  const currentRef = useRef<ShelfPlayInput | null>(null);
  currentRef.current = current;

  const play = useCallback((input: ShelfPlayInput) => {
    const same = isSameShelfItem(currentRef.current, input);
    setCurrent(input);
    setPositionSec(same ? elementRef.current?.currentTime ?? 0 : 0);
    if (!same) setDurationSec(0);
    setPlaying(true);
    const el = elementRef.current;
    if (el) {
      if (!same || el.getAttribute("src") !== input.src) {
        // The card re-renders its element keyed by src; when the
        // element already carries this src (a re-press), just play.
        if (el.getAttribute("src") === input.src) void el.play().catch(() => {});
      }
    }
  }, []);

  const toggle = useCallback(() => {
    const el = elementRef.current;
    if (!el || !currentRef.current) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seek = useCallback((targetSec: number) => {
    const el = elementRef.current;
    if (!el) return;
    const clamped = clampShelfSeek(targetSec, Number.isFinite(el.duration) ? el.duration : 0);
    try {
      el.currentTime = clamped;
    } catch {
      /* metadata not in yet — the next tick lands it */
    }
    setPositionSec(clamped);
  }, []);

  const stop = useCallback(() => {
    const el = elementRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    setCurrent(null);
    setPlaying(false);
    setPositionSec(0);
    setDurationSec(0);
  }, []);

  const registerElement = useCallback((el: HTMLMediaElement | null) => {
    elementRef.current = el;
  }, []);
  const syncPlaying = useCallback((v: boolean) => setPlaying(v), []);
  const syncPosition = useCallback((sec: number) => setPositionSec(sec), []);
  const syncDuration = useCallback((sec: number) => setDurationSec(sec), []);

  return {
    current,
    playing,
    positionSec,
    durationSec,
    play,
    toggle,
    seek,
    stop,
    registerElement,
    syncPlaying,
    syncPosition,
    syncDuration,
  };
}

/* ─── The Now Playing card ──────────────────────────────────────────
   The deeper /track/:id and /watch/:id pages fold into this card:
   artwork, a simple transport (play/pause/seek — all the existing
   player supports), like on the media rails, and comments as a
   short readable list. The full thread and the pages' extras
   (waveform, embed, up-next, Get Paid finale…) stay behind the
   card's one secondary quiet transfer — a plain new-tab link to
   the item's own page, in the TransferFooter's shape but smaller,
   because the frame's footer already carries the station's. */

export function NowPlayingCard({
  player,
  isLight,
}: {
  player: ShelfPlayerController;
  isLight: boolean;
}) {
  const { getAccessToken } = useAuth();
  const { current } = player;
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeFailed, setLikeFailed] = useState(false);
  const [comments, setComments] = useState<MediaComment[] | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  /* Register the element the transport drives (the jukebox mirror
     pattern: the element is the truth, state follows its events). */
  useEffect(() => {
    player.registerElement(mediaRef.current);
    return () => player.registerElement(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.src, current?.kind]);

  /* Per-item state resets when the player moves on. */
  useEffect(() => {
    if (!current) return;
    setLiked(false);
    setLikeCount(current.likeCount);
    setLikeFailed(false);
    setComments(null);
    let cancelled = false;
    fetchComments(current.kind, current.id)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  if (!current) return null;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const { preview, hiddenCount } = shelfPreviewComments(comments ?? []);

  const onLike = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    setLikeFailed(false);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await toggleLike(current.kind, current.id, liked, headers);
      setLiked(res.liked);
      if (res.count !== null) setLikeCount(res.count);
    } catch {
      setLikeFailed(true);
    } finally {
      setLikeBusy(false);
    }
  };

  const mediaProps = {
    src: current.src,
    autoPlay: true,
    preload: "auto" as const,
    onPlay: () => player.syncPlaying(true),
    onPause: () => player.syncPlaying(false),
    onEnded: () => player.syncPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      player.syncPosition(e.currentTarget.currentTime),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      player.syncDuration(e.currentTarget.duration || 0),
  };

  return (
    <div className="mb-3" data-testid="world-shelf-now-playing">
      <NativeCard isLight={isLight} title="Now playing — here in the palace">
        <div className="flex flex-wrap items-start gap-3">
          {current.artworkUrl ? (
            <img src={current.artworkUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#d4af37]/15">
              <ListMusic className="h-6 w-6 text-[#d4af37]" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {current.title}
            </p>
            <p className={`truncate text-xs ${muted}`}>
              {current.artistName ?? "Creator"} · {current.kind === "track" ? "Song" : "Video"} · personal
              playback — just you, not the room
            </p>
            {/* The transport: play/pause + a seek bar, as the
                existing player supports — nothing fancier. */}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                data-testid="world-shelf-playpause"
                onClick={player.toggle}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                {player.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {player.playing ? "Pause" : "Play"}
              </button>
              <input
                type="range"
                aria-label="Seek"
                min={0}
                max={Math.max(player.durationSec, 0)}
                step={0.1}
                value={Math.min(player.positionSec, player.durationSec || player.positionSec)}
                onChange={(e) => player.seek(Number(e.target.value))}
                className="min-w-24 flex-1 accent-[#d4af37]"
              />
              <span className={`text-[11px] font-semibold tabular-nums ${muted}`}>
                {formatShelfClock(player.positionSec)} / {formatShelfClock(player.durationSec)}
              </span>
              <button
                type="button"
                data-testid="world-shelf-like"
                onClick={onLike}
                disabled={likeBusy}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                  liked
                    ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]"
                    : isLight
                      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                      : "border-white/15 text-white/75 hover:text-white"
                }`}
              >
                <Heart className={`h-3.5 w-3.5 ${liked ? "fill-[#d4af37] text-[#d4af37]" : ""}`} />
                {likeCount}
              </button>
            </div>
            {likeFailed && (
              <p className={`mt-1 text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                The like didn&rsquo;t land — the song plays on; try the heart again.
              </p>
            )}
          </div>
        </div>

        {/* The media element itself: a <video> for a watch item
            (poster = its thumbnail), an <audio> for a track. One
            element, keyed by src so a new pick starts clean. */}
        {current.kind === "video" ? (
          <video
            key={current.src}
            ref={(el) => {
              mediaRef.current = el;
            }}
            {...mediaProps}
            poster={current.artworkUrl ?? undefined}
            className="mt-3 aspect-video w-full rounded-xl bg-black object-contain"
            playsInline
          />
        ) : (
          <audio
            key={current.src}
            ref={(el) => {
              mediaRef.current = el;
            }}
            {...mediaProps}
            className="hidden"
          />
        )}

        {/* Comments: a short readable list in-world; the full
            thread is the transfer's job (follow-on log). */}
        <div className="mt-3">
          <p className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            <MessageCircle className="h-3.5 w-3.5" /> Comments
          </p>
          {comments === null ? (
            <p className={`mt-1 text-xs ${muted}`}>Reading the room…</p>
          ) : preview.length === 0 ? (
            <p className={`mt-1 text-xs ${muted}`}>No comments yet — the first word is still unwritten.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {preview.map((c) => (
                <li key={c.id} className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                  <span className="font-bold">{c.display_name ?? "A listener"}</span>{" "}
                  <span className={muted}>{c.body}</span>
                </li>
              ))}
            </ul>
          )}
          {(hiddenCount > 0 || (comments !== null && comments.length > 0)) && (
            <p className={`mt-1.5 text-[11px] ${muted}`}>
              {hiddenCount > 0 ? `${hiddenCount} more in the full thread. ` : ""}
              <a
                href={current.pagePath}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="world-shelf-track-transfer"
                className="font-bold text-[#e8c86a] underline underline-offset-2"
              >
                Open the full page on the website ↗
              </a>
            </p>
          )}
        </div>
      </NativeCard>
    </div>
  );
}
