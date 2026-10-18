import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Code2, Heart, ListMusic, MessageCircle, Pause, Play, Repeat2, Send, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  copyText,
  fetchComments,
  fetchMoreFromArtist,
  fetchTrack,
  fetchVideo,
  postComment,
  recordPlay,
  resolveMedia,
  toggleLike,
  toggleRepost,
  type MediaComment,
} from "@/lib/streaming";
import {
  clampShelfSeek,
  formatShelfClock,
  isSameShelfItem,
  queueUpNext,
  removeFromQueue,
  shelfEmbedCode,
  shelfPlayInput,
  takeQueueNext,
  SHELF_COMMENT_FULL_LIMIT,
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
  /** The up-next list (2.12): what's queued behind the current item,
   *  in the order it will play. */
  queue: ShelfPlayInput[];
  /** Start (or restart) an item on the one player. */
  play: (input: ShelfPlayInput) => void;
  /** Queue an item to play NEXT (front of the queue; queueing the
   *  same item again just moves it to the front). */
  queueNext: (input: ShelfPlayInput) => void;
  /** Replace the whole queue (a playlist play: first item plays,
   *  the rest land here in order). */
  replaceQueue: (items: ShelfPlayInput[]) => void;
  /** Drop one item from the queue. */
  removeQueued: (item: Pick<ShelfPlayInput, "kind" | "id">) => void;
  /** Empty the queue (the current item keeps playing). */
  clearQueue: () => void;
  /** The current item ended: play the queue's head, or go quiet. */
  advance: () => void;
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
  const [queue, setQueue] = useState<ShelfPlayInput[]>([]);
  const queueRef = useRef<ShelfPlayInput[]>([]);
  queueRef.current = queue;

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

  const queueNext = useCallback((input: ShelfPlayInput) => {
    setQueue((q) => queueUpNext(q, input));
  }, []);

  const replaceQueue = useCallback((items: ShelfPlayInput[]) => {
    setQueue([...items]);
  }, []);

  const removeQueued = useCallback((item: Pick<ShelfPlayInput, "kind" | "id">) => {
    setQueue((q) => removeFromQueue(q, item));
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  const advance = useCallback(() => {
    const { next, rest } = takeQueueNext(queueRef.current);
    if (!next) {
      setPlaying(false);
      return;
    }
    setQueue(rest);
    play(next);
    recordPlay(next.kind, next.id);
  }, [play]);

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
    setQueue([]);
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
    queue,
    play,
    queueNext,
    replaceQueue,
    removeQueued,
    clearQueue,
    advance,
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
   artwork, a simple transport (play/pause/seek), like + repost on
   the media rails, the FULL comment thread with post/reply in-world
   (2.13), the up-next queue in plain sight (2.12/2.15), embed-code
   copy and more-from-this-artist (2.15). What genuinely stays on
   the website (waveform, the Get Paid finale) sits behind the
   card's one secondary quiet transfer — a plain new-tab link to
   the item's own page, hidden for unpublished own tracks whose
   public page doesn't exist yet. */

export function NowPlayingCard({
  player,
  isLight,
}: {
  player: ShelfPlayerController;
  isLight: boolean;
}) {
  const { user, getAccessToken } = useAuth();
  const { current } = player;
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeFailed, setLikeFailed] = useState(false);
  const [comments, setComments] = useState<MediaComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postFailed, setPostFailed] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(0);
  const [repostBusy, setRepostBusy] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [moreItems, setMoreItems] = useState<Array<{ kind: "track" | "video"; id: string; title: string }> | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  /* Register the element the transport drives (the jukebox mirror
     pattern: the element is the truth, state follows its events). */
  useEffect(() => {
    player.registerElement(mediaRef.current);
    return () => player.registerElement(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.src, current?.kind]);

  /* Per-item state resets when the player moves on. The thread is
     the FULL thread now (2.13) — fetched at the endpoint's full
     limit, not the old 3-comment preview. */
  useEffect(() => {
    if (!current) return;
    setLiked(false);
    setLikeCount(current.likeCount);
    setLikeFailed(false);
    setComments(null);
    setDraft("");
    setReplyTo(null);
    setPostFailed(false);
    setReposted(false);
    setRepostCount(current.repostCount ?? 0);
    setEmbedCopied(false);
    setMoreItems(null);
    let cancelled = false;
    fetchComments(current.kind, current.id, SHELF_COMMENT_FULL_LIMIT)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    if (current.profileId) {
      fetchMoreFromArtist(current.profileId, current.kind, current.id, 6)
        .then((items) => {
          if (!cancelled) setMoreItems(items.map((m) => ({ kind: m.kind, id: m.id, title: m.title })));
        })
        .catch(() => {
          if (!cancelled) setMoreItems([]);
        });
    } else {
      setMoreItems([]);
    }
    return () => {
      cancelled = true;
    };
  }, [current]);

  if (!current) return null;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

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

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  /* Post to the thread (2.13). A Reply is a post that names the
     person it answers — the media comment rails are a flat thread
     (the website's own CommentThread posts exactly this way; there
     is no parent id on media_comments), so the reply rides as an
     @name-led comment in the same thread, never a fake nested one. */
  const onPost = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setPostFailed(false);
    try {
      const c = await postComment(current.kind, current.id, body, await authHeaders());
      setComments((prev) => [c, ...(prev ?? [])]);
      setDraft("");
      setReplyTo(null);
    } catch {
      setPostFailed(true);
    } finally {
      setPosting(false);
    }
  };

  const startReply = (c: MediaComment) => {
    const name = c.display_name ?? "A listener";
    setReplyTo(name);
    setDraft(`@${name} `);
  };

  const onRepost = async () => {
    if (repostBusy || current.kind !== "track") return;
    setRepostBusy(true);
    try {
      const res = await toggleRepost(current.id, reposted, await authHeaders());
      setReposted(res.reposted);
      if (res.count !== null) setRepostCount(res.count);
    } catch {
      /* the button just doesn't flip — no toast spam in-world */
    } finally {
      setRepostBusy(false);
    }
  };

  const onCopyEmbed = async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://bowdownvisuals.com";
    if (await copyText(shelfEmbedCode(current, origin))) {
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    }
  };

  const playMore = async (kind: "track" | "video", id: string) => {
    try {
      if (kind === "track") {
        const r = await fetchTrack(id);
        if (!r) return;
        const src = resolveMedia(r.track.audio_url);
        if (!src) return;
        player.play(
          shelfPlayInput({
            kind: "track",
            id: String(r.track.id),
            title: r.track.title,
            artistName: r.artist?.display_name ?? current.artistName,
            artworkUrl: r.track.artwork_url ?? null,
            src,
            pagePath: `/track/${encodeURIComponent(String(r.track.id))}`,
            likeCount: r.track.like_count ?? 0,
            commentCount: r.track.comment_count ?? 0,
            profileId: r.track.profile_id ?? null,
            repostCount: r.track.repost_count ?? 0,
          }),
        );
      } else {
        const r = await fetchVideo(id);
        if (!r) return;
        const src = resolveMedia(r.video.video_url);
        if (!src) return;
        player.play(
          shelfPlayInput({
            kind: "video",
            id: String(r.video.id),
            title: r.video.title,
            artistName: r.artist?.display_name ?? current.artistName,
            artworkUrl: r.video.thumbnail_url ?? null,
            src,
            pagePath: `/watch/${encodeURIComponent(String(r.video.id))}`,
            likeCount: r.video.like_count ?? 0,
            commentCount: r.video.comment_count ?? 0,
            profileId: r.video.profile_id ?? null,
          }),
        );
      }
      recordPlay(kind, id);
    } catch {
      /* a failed pick leaves the current song playing — honest */
    }
  };

  const mediaProps = {
    src: current.src,
    autoPlay: true,
    preload: "auto" as const,
    onPlay: () => player.syncPlaying(true),
    onPause: () => player.syncPlaying(false),
    onEnded: () => player.advance(),
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
            {current.unpublished && (
              <p className="mt-1">
                <span className="inline-flex items-center rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
                  Yours — not published yet
                </span>{" "}
                <span className={`text-[11px] ${muted}`}>Only you can hear this one here.</span>
              </p>
            )}
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
            {/* Extras (2.15): repost rides the track rails only —
                the server has no video repost, so videos never show
                a dead button. Embed copies the website player's
                iframe code. Both hide for unpublished own tracks:
                there is no public page to repost or embed yet. */}
            {!current.unpublished && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {current.kind === "track" && (
                  <button
                    type="button"
                    data-testid="world-shelf-repost"
                    onClick={() => void onRepost()}
                    disabled={repostBusy}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                      reposted
                        ? "border-[#d4af37] bg-[#d4af37]/15 text-[#e8c86a]"
                        : isLight
                          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                          : "border-white/15 text-white/75 hover:text-white"
                    }`}
                  >
                    <Repeat2 className="h-3.5 w-3.5" /> {reposted ? "Reposted" : "Repost"} {repostCount > 0 ? repostCount : ""}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="world-shelf-embed"
                  onClick={() => void onCopyEmbed()}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                    isLight
                      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                      : "border-white/15 text-white/75 hover:text-white"
                  }`}
                >
                  {embedCopied ? <Check className="h-3.5 w-3.5 text-[#d4af37]" /> : <Code2 className="h-3.5 w-3.5 text-[#d4af37]" />}
                  {embedCopied ? "Embed code copied!" : "Copy embed code"}
                </button>
              </div>
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

        {/* The queue (2.12 + 2.15): what's next, in plain sight,
            each row removable. When a song ends the head of this
            list is what the room hears from you next. */}
        {player.queue.length > 0 && (
          <div className="mt-3" data-testid="world-shelf-queue">
            <p className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              <ListMusic className="h-3.5 w-3.5" /> Up next
            </p>
            <ul className="mt-1 space-y-1">
              {player.queue.map((q) => (
                <li
                  key={`${q.kind}:${q.id}`}
                  className={`flex items-center gap-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-bold">{q.title}</span>{" "}
                    <span className={muted}>{q.artistName ?? "Creator"}</span>
                  </span>
                  <button
                    type="button"
                    data-testid="world-shelf-queue-remove"
                    onClick={() => player.removeQueued(q)}
                    aria-label={`Remove ${q.title} from the queue`}
                    className={`rounded-full border p-1 transition ${
                      isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/60 hover:text-white"
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* More from this artist (2.15): the profile media rail,
            each pick resolving through the same media rails and
            landing on this same player. */}
        {moreItems !== null && moreItems.length > 0 && (
          <div className="mt-3" data-testid="world-shelf-more-from-artist">
            <p className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              <ListMusic className="h-3.5 w-3.5" /> More from {current.artistName ?? "this artist"}
            </p>
            <ul className="mt-1 space-y-1">
              {moreItems.map((m) => (
                <li key={`${m.kind}:${m.id}`} className="flex items-center gap-2">
                  <span className={`min-w-0 flex-1 truncate text-xs ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                    {m.title}
                  </span>
                  <button
                    type="button"
                    data-testid="world-shelf-more-play"
                    onClick={() => void playMore(m.kind, m.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-2.5 py-1 text-[11px] font-bold text-black transition hover:scale-105"
                  >
                    <Play className="h-3 w-3" /> Play
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Comments (2.13): the FULL thread in-world — read it all,
            post, and reply without leaving. A reply names who it
            answers (the rails are a flat thread — see onPost). */}
        <div className="mt-3">
          <p className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            <MessageCircle className="h-3.5 w-3.5" /> Comments{comments !== null && comments.length > 0 ? ` · ${comments.length}` : ""}
          </p>
          {comments === null ? (
            <p className={`mt-1 text-xs ${muted}`}>Reading the room…</p>
          ) : comments.length === 0 ? (
            <p className={`mt-1 text-xs ${muted}`}>No comments yet — the first word is still unwritten.</p>
          ) : (
            <ul className="mt-1 max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {comments.map((c) => (
                <li key={c.id} className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>
                  <span className="font-bold">{c.display_name ?? "A listener"}</span>{" "}
                  <span className={muted}>{c.body}</span>{" "}
                  {user && (
                    <button
                      type="button"
                      data-testid="world-shelf-comment-reply"
                      onClick={() => startReply(c)}
                      className="font-bold text-[#e8c86a] underline-offset-2 hover:underline"
                    >
                      Reply
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {user ? (
            <div className="mt-2">
              {replyTo && (
                <p className={`mb-1 text-[11px] ${muted}`}>
                  Replying to <span className="font-bold">{replyTo}</span> —{" "}
                  <button type="button" onClick={() => { setReplyTo(null); setDraft(""); }} className="font-bold text-[#e8c86a]">
                    cancel
                  </button>
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void onPost(); }}
                  placeholder="Say something about what's playing…"
                  maxLength={500}
                  data-testid="world-shelf-comment-input"
                  className={`min-w-0 flex-1 rounded-full border px-3 py-1.5 text-xs outline-none ${
                    isLight
                      ? "border-[#7A5A12]/30 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
                      : "border-white/15 bg-white/5 text-white placeholder:text-white/35"
                  }`}
                />
                <button
                  type="button"
                  data-testid="world-shelf-comment-post"
                  onClick={() => void onPost()}
                  disabled={posting || !draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> {posting ? "Posting…" : "Post"}
                </button>
              </div>
              {postFailed && (
                <p className={`mt-1 text-[11px] font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  That comment didn&rsquo;t land — the song plays on; try posting again.
                </p>
              )}
            </div>
          ) : (
            <p className={`mt-2 text-[11px] ${muted}`}>Sign in to join the conversation — reading is open to everyone here.</p>
          )}
          {!current.unpublished && (
            <p className={`mt-1.5 text-[11px] ${muted}`}>
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
