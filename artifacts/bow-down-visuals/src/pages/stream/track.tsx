import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Play, Pause, ArrowLeft, ListPlus, ListVideo, Music2, Eye, Clock } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { JsonLd } from "@/components/seo/json-ld";
import { useStreamingPlayer, trackToQueueItem } from "@/contexts/StreamingPlayerContext";
import { MediaActions } from "@/components/player/MediaActions";
import { MediaLinkBar } from "@/components/player/MediaLinkBar";
import { GetPaidFinale, EarnEmptyState } from "@/components/player/GetPaidFinale";
import { useAuth } from "@/contexts/AuthContext";
import { useMinStars } from "@/lib/creator-level";
import { Waveform } from "@/components/player/Waveform";
import { EmbedButton } from "@/components/player/EmbedButton";
import { CommentThread } from "@/components/player/CommentThread";
import {
  fetchTrack, fetchMoreFromArtist, formatCount, formatDuration, resolveMedia,
  type StreamTrack, type StreamProfileRef,
} from "@/lib/streaming";

/* ─── Track (audio) page — /track/:id (Worker 2) ───
   Media-neutral: plays any audio — songs, podcast episodes, DJ mixes,
   voiceovers. Big artwork, waveform, global player feed, stats,
   like/repost/share, comments, more-from-creator, paid download. */

export default function StreamTrackPage() {
  const [, params] = useRoute("/track/:id");
  const id = params?.id ?? "";
  const player = useStreamingPlayer();
  const { user } = useAuth();
  const canSeekWave = useMinStars(3);

  const [track, setTrack] = useState<StreamTrack | null>(null);
  const [artist, setArtist] = useState<StreamProfileRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [more, setMore] = useState<Array<{ kind: "track" | "video"; id: string; title: string; thumb: string | null; plays: number }>>([]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    fetchTrack(id).then((res) => {
      if (!alive) return;
      if (!res) { setNotFound(true); return; }
      setTrack(res.track);
      setArtist(res.artist ?? null);
      if (res.track.profile_id) {
        fetchMoreFromArtist(res.track.profile_id, "track", String(res.track.id), 8).then((m) => {
          if (alive) setMore(m);
        });
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  usePageTitle(
    track ? `${track.title}${artist ? ` — ${artist.display_name}` : ""}` : "Audio",
    track ? `Listen to "${track.title}"${artist ? ` by ${artist.display_name}` : ""} — streamed on Bow Down Visuals.` : "Stream creator audio on Bow Down Visuals."
  );

  const artistName = artist?.display_name ?? "Creator";
  const src = track ? resolveMedia(track.audio_url) : "";
  const isCurrent = player.current?.kind === "track" && player.current?.id === String(track?.id);
  const waveProgress = isCurrent && player.duration > 0 ? player.currentTime / player.duration : 0;

  function handlePlay() {
    if (!track) return;
    if (isCurrent) { player.toggle(); return; }
    player.playItems([trackToQueueItem(track, artistName)], 0);
  }

  function handleQueueAll() {
    if (!track) return;
    const items = [trackToQueueItem(track, artistName)];
    player.playItems(items, 0);
    more.forEach((m) => {
      if (m.kind === "track") player.addToQueue({ kind: "track", id: m.id, title: m.title, artistName, artwork: m.thumb, src: "" });
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/40">Loading audio…</p>
      </div>
    );
  }

  if (notFound || !track) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <EarnEmptyState what="drop" />
          <p className="text-white/30 text-xs mt-2">Looking for something specific? It may have been removed by its creator.</p>
          <Link href="/showcase"><span className="text-[#e8c86a] underline text-sm">Back to the showcase</span></Link>
      </div>
    );
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AudioObject",
    name: track.title,
    contentUrl: src,
    thumbnailUrl: track.artwork_url ?? undefined,
    url: `https://bowdownvisuals.com/track/${track.id}`,
    creator: { "@type": "Person", name: artistName },
    interactionStatistic: [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/ListenAction", userInteractionCount: track.play_count },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: track.like_count },
    ],
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={jsonLd} />
      <div className="mx-auto max-w-4xl px-4 md:px-6 py-8">
        <Link href="/showcase" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-[#e8c86a] mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="grid md:grid-cols-[320px_1fr] gap-8">
          {/* Artwork */}
          <div className="relative">
            {track.artwork_url ? (
              <img src={track.artwork_url} alt={track.title} className="w-full aspect-square rounded-2xl object-cover border border-[#e8c86a]/25 shadow-[0_20px_60px_rgba(0,0,0,.6)]" />
            ) : (
              <div className="w-full aspect-square rounded-2xl bg-gradient-to-br from-[#e8c86a]/25 to-black border border-[#e8c86a]/25 flex items-center justify-center">
                <Music2 className="h-20 w-20 text-[#e8c86a]/50" />
              </div>
            )}
            <button
              onClick={handlePlay}
              className="absolute bottom-4 right-4 h-14 w-14 rounded-full bg-[#e8c86a] text-black flex items-center justify-center hover:bg-[#f5d67e] transition-colors shadow-[0_0_30px_rgba(232,200,106,.5)]"
              aria-label={isCurrent && player.playing ? "Pause" : "Play"}
            >
              {isCurrent && player.playing ? <Pause className="h-7 w-7 fill-black" /> : <Play className="h-7 w-7 fill-black ml-0.5" />}
            </button>
          </div>

          {/* Meta */}
          <div className="min-w-0">
            {track.genre && (
              <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[#e8c86a] border border-[#e8c86a]/40 rounded-full px-3 py-1 mb-3">
                {track.genre}
              </span>
            )}
            <h1 className="text-3xl md:text-4xl font-black leading-tight">{track.title}</h1>
            <p className="mt-2 text-white/60">
              by {artist?.slug ? (
                <Link href={`/artist/${artist.slug}`} className="text-[#e8c86a] hover:underline font-semibold">{artistName}</Link>
              ) : (
                <span className="text-[#e8c86a] font-semibold">{artistName}</span>
              )}
            </p>

            <div data-min-stars="2" className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/45">
              <span className="flex items-center gap-1.5"><Eye className="h-4 w-4" /> {formatCount(track.play_count)} plays</span>
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {formatDuration(track.duration_sec)}</span>
            </div>

            <div className="mt-5">
              <Waveform
                cacheKey={`track:${track.id}`}
                src={src || undefined}
                progress={waveProgress}
                height={80}
                interactive={isCurrent && canSeekWave}
                onSeek={(r) => { if (isCurrent && player.duration) player.seek(r * player.duration); }}
              />
            </div>

            <div className="mt-5">
              <MediaActions
                kind="track"
                id={String(track.id)}
                title={track.title}
                artistName={artistName}
                sharePath={`/track/${track.id}`}
                likeCount={track.like_count}
                repostCount={track.repost_count}
                downloadPriceCents={track.download_price_cents}
                size="lg"
              />
            </div>

            <div className="mt-3">
              <EmbedButton kind="track" id={String(track.id)} artistSlug={artist?.slug} title={track.title} />
            </div>

            <div className="mt-4">
              <MediaLinkBar kind="track" id={String(track.id)} artistSlug={artist?.slug} artistName={artistName} />
            </div>

            <div data-min-stars="3" className="mt-4 flex gap-2">
              <button
                onClick={handleQueueAll}
                className="flex items-center gap-2 text-sm text-white/60 hover:text-[#e8c86a] border border-white/10 hover:border-[#e8c86a]/50 rounded-full px-4 py-2 transition-colors"
              >
                <ListVideo className="h-4 w-4" /> Play with more from {artistName}
              </button>
              <button
                onClick={() => track && player.addToQueue(trackToQueueItem(track, artistName))}
                className="flex items-center gap-2 text-sm text-white/60 hover:text-[#e8c86a] border border-white/10 hover:border-[#e8c86a]/50 rounded-full px-4 py-2 transition-colors"
              >
                <ListPlus className="h-4 w-4" /> Add to queue
              </button>
            </div>

            {track.tags && track.tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {track.tags.map((t) => (
                  <span key={t} className="text-xs text-white/50 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">#{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <CommentThread kind="track" mediaId={String(track.id)} />

        {more.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-white mb-4">More from {artistName}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {more.map((m) => (
                <Link key={m.id} href={`/track/${m.id}`} className="group">
                  <div className="aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10 group-hover:border-[#e8c86a]/50 transition-colors">
                    {m.thumb ? (
                      <img src={m.thumb} alt={m.title} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music2 className="h-8 w-8 text-[#e8c86a]/40" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-white/80 truncate group-hover:text-[#e8c86a]">{m.title}</p>
                  <p className="text-xs text-white/40">{formatCount(m.plays)} plays</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        <GetPaidFinale
          title={track.title}
          artistName={artistName}
          artistSlug={artist?.slug}
          isOwner={!!track.is_owner || (!!user && !!track.owner_user_id && track.owner_user_id === user.id)}
          sharePath={`/track/${track.id}`}
          downloadPriceCents={track.download_price_cents}
        />
      </div>
    </div>
  );
}
