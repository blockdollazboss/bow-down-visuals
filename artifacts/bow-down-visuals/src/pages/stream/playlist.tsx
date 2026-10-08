import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  Play, Pause, ArrowLeft, ListMusic, ListPlus, ListVideo,
  Music2, Clapperboard, UserPlus, UserCheck, Layers, Share2,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { JsonLd } from "@/components/seo/json-ld";
import { useAuth } from "@/contexts/AuthContext";
import { useStreamingPlayer, trackToQueueItem, type QueueItem } from "@/contexts/StreamingPlayerContext";
import { ShareMenu } from "@/components/player/MediaActions";
import { CommentThread } from "@/components/player/CommentThread";
import {
  fetchPlaylist, fetchTrack, fetchVideo, formatCount, formatDuration, formatSeriesLabel,
  resolveMedia, togglePlaylistFollow,
  type StreamPlaylist, type StreamProfileRef, type MediaKind,
} from "@/lib/streaming";

/* ─── Playlist page — /playlist/:id (Worker 2) ───
   Audio AND video mix freely. Play-all feeds the site-wide audio queue for
   audio items; video items play on their watch pages. kind='series'
   playlists group videos by season with S1 E3 labeling. */

interface ResolvedItem {
  kind: MediaKind;
  id: string;
  title: string;
  thumb: string | null;
  duration: number | null;
  plays: number;
  src: string; // playable audio src (audio items only)
  artwork: string | null;
  season?: number | null;
  episode?: number | null;
  price?: number | null;
}

async function resolveItems(pl: StreamPlaylist, artistName: string): Promise<ResolvedItem[]> {
  if (pl.resolved_items && pl.resolved_items.length) {
    return pl.resolved_items.map((r) => {
      if (r.kind === "track") {
        const t = r.item;
        return {
          kind: "track" as const, id: String(t.id), title: t.title ?? "Untitled",
          thumb: t.artwork_url, duration: t.duration_sec, plays: t.play_count,
          src: resolveMedia(t.audio_url), artwork: t.artwork_url,
          price: t.download_price_cents ?? null,
        };
      }
      const v = r.item;
      return {
        kind: "video" as const, id: String(v.id), title: v.title ?? "Untitled",
        thumb: v.thumbnail_url, duration: v.duration_sec, plays: v.view_count,
        src: "", artwork: v.thumbnail_url,
        season: v.season_number ?? null, episode: v.episode_number ?? null,
      };
    });
  }
  // Fall back to per-item fetches (bounded — playlists are capped at 200 server-side).
  const refs = (pl.items ?? []).slice(0, 60);
  const out: ResolvedItem[] = [];
  await Promise.all(refs.map(async (ref) => {
    try {
      if (ref.kind === "track") {
        const r = await fetchTrack(String(ref.id));
        if (r) out.push({
          kind: "track", id: String(r.track.id), title: r.track.title ?? "Untitled",
          thumb: r.track.artwork_url, duration: r.track.duration_sec, plays: r.track.play_count,
          src: resolveMedia(r.track.audio_url), artwork: r.track.artwork_url,
          price: r.track.download_price_cents ?? null,
        });
      } else {
        const r = await fetchVideo(String(ref.id));
        if (r) out.push({
          kind: "video", id: String(r.video.id), title: r.video.title ?? "Untitled",
          thumb: r.video.thumbnail_url, duration: r.video.duration_sec, plays: r.video.view_count,
          src: "", artwork: r.video.thumbnail_url,
          season: r.video.season_number ?? null, episode: r.video.episode_number ?? null,
        });
      }
    } catch { /* skip missing items */ }
  }));
  // Preserve the playlist's original order.
  const order = new Map(refs.map((r, i) => [`${r.kind}:${r.id}`, i]));
  out.sort((a, b) => (order.get(`${a.kind}:${a.id}`) ?? 999) - (order.get(`${b.kind}:${b.id}`) ?? 999));
  return out;
}

export default function StreamPlaylistPage() {
  const [, params] = useRoute("/playlist/:id");
  const id = params?.id ?? "";
  const player = useStreamingPlayer();
  const { user, getAccessToken } = useAuth();

  const [playlist, setPlaylist] = useState<StreamPlaylist | null>(null);
  const [owner, setOwner] = useState<StreamProfileRef | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    fetchPlaylist(id).then(async (res) => {
      if (!alive) return;
      if (!res) { setNotFound(true); return; }
      setPlaylist(res.playlist);
      setOwner(res.owner ?? null);
      setFollowers(res.playlist.follower_count ?? 0);
      const resolved = await resolveItems(res.playlist, res.owner?.display_name ?? "Creator");
      if (alive) setItems(resolved);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  usePageTitle(
    playlist ? `${playlist.title} — Playlist` : "Playlist",
    playlist ? `${playlist.description ?? playlist.title} — a creator playlist on Bow Down Visuals.` : "Creator playlists on Bow Down Visuals."
  );

  const isSeries = (playlist?.kind ?? "").toLowerCase() === "series";
  const ownerName = owner?.display_name ?? "Creator";

  const audioItems = useMemo(() => items.filter((i) => i.kind === "track" && i.src), [items]);
  const videoCount = useMemo(() => items.filter((i) => i.kind === "video").length, [items]);
  const totalSecs = useMemo(() => items.reduce((n, i) => n + (i.duration ?? 0), 0), [items]);

  /* Season grouping for series playlists. */
  const seasons = useMemo(() => {
    if (!isSeries) return null;
    const groups = new Map<number | string, ResolvedItem[]>();
    for (const i of items) {
      const key = i.season ?? "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
    return [...groups.entries()].sort((a, b) => {
      const sa = a[0] === "other" ? 999 : Number(a[0]);
      const sb = b[0] === "other" ? 999 : Number(b[0]);
      return sa - sb;
    });
  }, [isSeries, items]);

  function toQueueItem(i: ResolvedItem): QueueItem {
    return { kind: "track", id: i.id, title: i.title, artistName: ownerName, artwork: i.artwork, src: i.src };
  }

  function playAll(fromIndex = 0) {
    const queue = audioItems.map(toQueueItem);
    if (!queue.length) return;
    player.playItems(queue, Math.min(fromIndex, queue.length - 1));
  }

  async function handleFollow() {
    if (!user || !playlist) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const prev = following;
      setFollowing(!prev);
      setFollowers((n) => n + (prev ? -1 : 1));
      const res = await togglePlaylistFollow(String(playlist.id), prev, { Authorization: `Bearer ${token}` });
      setFollowing(res.following);
      if (res.count != null) setFollowers(res.count);
    } catch {
      setFollowing((v) => !v);
    }
  }

  const firstVideo = items.find((i) => i.kind === "video");
  const isPlayingPlaylist = player.current?.kind === "track" && audioItems.some((i) => i.id === player.current?.id);

  function ItemRow({ item, position }: { item: ResolvedItem; position: number }) {
    const isCurrentAudio = player.current?.kind === "track" && player.current?.id === item.id;
    const seriesLabel = formatSeriesLabel(item.season, item.episode);
    const inner = (
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-white/5 ${isCurrentAudio ? "bg-[#e8c86a]/10" : ""}`}>
        <span className="w-6 text-center text-xs text-white/30 tabular-nums shrink-0">{position + 1}</span>
        {item.thumb ? (
          <img src={item.thumb} alt="" loading="lazy" className="h-11 w-11 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="h-11 w-11 rounded-lg bg-[#e8c86a]/10 flex items-center justify-center shrink-0">
            {item.kind === "video" ? <Clapperboard className="h-5 w-5 text-[#e8c86a]/50" /> : <Music2 className="h-5 w-5 text-[#e8c86a]/50" />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm truncate ${isCurrentAudio ? "text-[#e8c86a] font-semibold" : "text-white/85"}`}>{item.title}</p>
          <p className="text-xs text-white/40 flex items-center gap-2">
            {item.kind === "video" ? (
              <><Clapperboard className="h-3 w-3" /> Video • {formatCount(item.plays)} views</>
            ) : (
              <><Music2 className="h-3 w-3" /> Audio • {formatCount(item.plays)} plays</>
            )}
            {seriesLabel && <span className="text-[#e8c86a]/80 font-semibold">{seriesLabel}</span>}
          </p>
        </div>
        <span className="text-xs text-white/30 tabular-nums shrink-0">{formatDuration(item.duration)}</span>
      </div>
    );

    if (item.kind === "video") {
      return <Link href={`/watch/${item.id}`}>{inner}</Link>;
    }
    return (
      <div className="group relative">
        <button
          className="w-full text-left"
          onClick={() => {
            const queue = audioItems.map(toQueueItem);
            const idx = queue.findIndex((q) => q.id === item.id);
            player.playItems(queue, Math.max(0, idx));
          }}
        >
          {inner}
        </button>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-1 bg-black/70 rounded-full px-1">
          <button
            onClick={() => player.playNext(toQueueItem(item))}
            className="p-1.5 text-white/60 hover:text-[#e8c86a]" title="Play next" aria-label="Play next"
          >
            <ListVideo className="h-4 w-4" />
          </button>
          <button
            onClick={() => player.addToQueue(toQueueItem(item))}
            className="p-1.5 text-white/60 hover:text-[#e8c86a]" title="Add to queue" aria-label="Add to queue"
          >
            <ListPlus className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/40">Loading playlist…</p>
      </div>
    );
  }

  if (notFound || !playlist) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <ListMusic className="h-12 w-12 text-[#e8c86a]/40 mx-auto mb-4" />
          <p className="text-xl font-bold mb-2">Playlist not found</p>
          <p className="text-white/40 text-sm mb-6">Private, deleted, or a bad link — the cheat code keeps moving either way.</p>
          <Link href="/showcase"><span className="text-[#e8c86a] underline text-sm">Back to the showcase</span></Link>
        </div>
      </div>
    );
  }

  const cover = playlist.cover_url ?? items[0]?.thumb ?? null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: playlist.title,
    description: playlist.description ?? playlist.title,
    url: `https://bowdownvisuals.com/playlist/${playlist.id}`,
    numberOfItems: items.length,
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={jsonLd} />
      <div className="mx-auto max-w-4xl px-4 md:px-6 py-8">
        <Link href="/showcase" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-[#e8c86a] mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="grid md:grid-cols-[280px_1fr] gap-8">
          <div>
            {cover ? (
              <img src={cover} alt={playlist.title} className="w-full aspect-square rounded-2xl object-cover border border-[#e8c86a]/25 shadow-[0_20px_60px_rgba(0,0,0,.6)]" />
            ) : (
              <div className="w-full aspect-square rounded-2xl bg-gradient-to-br from-[#e8c86a]/25 to-black border border-[#e8c86a]/25 flex items-center justify-center">
                {isSeries ? <Clapperboard className="h-16 w-16 text-[#e8c86a]/50" /> : <ListMusic className="h-16 w-16 text-[#e8c86a]/50" />}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-widest text-[#e8c86a]">
                {isSeries ? "Series" : "Playlist"}
              </span>
              {!playlist.is_public && (
                <span className="text-xs text-white/40 border border-white/15 rounded-full px-2 py-0.5">Private</span>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl font-black leading-tight">{playlist.title}</h1>
            {playlist.description && <p className="mt-2 text-white/55 text-sm leading-relaxed">{playlist.description}</p>}
            <p className="mt-3 text-sm text-white/45">
              by {owner?.slug ? (
                <Link href={`/artist/${owner.slug}`} className="text-[#e8c86a] hover:underline font-semibold">{ownerName}</Link>
              ) : (
                <span className="text-[#e8c86a] font-semibold">{ownerName}</span>
              )}
              <span className="mx-2 text-white/20">•</span>
              {items.length} {items.length === 1 ? "item" : "items"}
              {audioItems.length > 0 && videoCount > 0 && (
                <span className="text-white/35"> ({audioItems.length} audio · {videoCount} video)</span>
              )}
              {totalSecs > 0 && <><span className="mx-2 text-white/20">•</span>{formatDuration(totalSecs)}</>}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => (isPlayingPlaylist && player.playing ? player.pause() : playAll())}
                disabled={audioItems.length === 0}
                className="flex items-center gap-2 rounded-full bg-[#e8c86a] text-black font-bold px-6 py-3 text-sm hover:bg-[#f5d67e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPlayingPlaylist && player.playing ? <Pause className="h-5 w-5 fill-black" /> : <Play className="h-5 w-5 fill-black" />}
                {isPlayingPlaylist && player.playing ? "Pause" : "Play all"}
              </button>
              <button
                onClick={handleFollow}
                title={user ? (following ? "Unfollow playlist" : "Follow playlist") : "Sign in to follow"}
                className={`flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition-colors ${
                  following
                    ? "border-[#e8c86a] bg-[#e8c86a]/15 text-[#e8c86a]"
                    : "border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]"
                }`}
              >
                {following ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {following ? "Following" : "Follow"} <span className="text-white/40">({formatCount(followers)})</span>
              </button>
              <div className="relative">
                <button
                  onClick={() => setShareOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-white/15 text-white/70 hover:border-[#e8c86a]/60 hover:text-[#e8c86a] px-5 py-3 text-sm font-semibold transition-colors"
                >
                  <Share2 className="h-4 w-4" /> Share
                </button>
                {shareOpen && (
                  <ShareMenu title={playlist.title} artistName={ownerName} sharePath={`/playlist/${playlist.id}`} onClose={() => setShareOpen(false)} />
                )}
              </div>
            </div>
            {audioItems.length === 0 && items.length > 0 && (
              <p className="mt-3 text-xs text-white/40">
                This one's all video — hit any episode to watch. Audio uploads join the play-all queue.
              </p>
            )}
          </div>
        </div>

        {/* Items */}
        <section className="mt-10">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center">
              <ListMusic className="h-10 w-10 text-[#e8c86a]/40 mx-auto mb-3" />
              <p className="text-white/70 font-semibold">An empty playlist? Bold strategy.</p>
              <p className="text-sm text-white/40 mt-1">The curator hasn't dropped anything in here yet — check back when the heat lands.</p>
            </div>
          ) : seasons ? (
            seasons.map(([season, group]) => (
              <div key={String(season)} className="mb-8">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#e8c86a] mb-3">
                  <Layers className="h-4 w-4" />
                  {season === "other" ? "More episodes" : `Season ${season}`}
                  <span className="text-white/30 font-normal">({group.length})</span>
                </h2>
                <div className="space-y-1">
                  {group.map((item, i) => <ItemRow key={`${item.kind}:${item.id}`} item={item} position={i} />)}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-1">
              {items.map((item, i) => <ItemRow key={`${item.kind}:${item.id}`} item={item} position={i} />)}
            </div>
          )}
        </section>

        {firstVideo && (
          <p className="mt-6 text-xs text-white/35 text-center">
            Videos play on their own watch pages — audio rides the cheat-code player bar below. 🎬
          </p>
        )}
      </div>
    </div>
  );
}
