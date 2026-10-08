import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Link, useRoute } from "wouter";
import {
  Play, Pause, Volume2, VolumeX, Maximize, ArrowLeft,
  Eye, Clapperboard, Layers,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { JsonLd } from "@/components/seo/json-ld";
import { useStreamingPlayerOptional } from "@/contexts/StreamingPlayerContext";
import { MediaActions } from "@/components/player/MediaActions";
import { CommentThread } from "@/components/player/CommentThread";
import {
  fetchVideo, fetchMoreFromArtist, formatCount, formatDuration, formatSeriesLabel,
  recordPlay, resolveMedia,
  type StreamVideo, type StreamProfileRef,
} from "@/lib/streaming";

/* ─── Video watch page — /watch/:id (Worker 2) ───
   First-class video: native <video> with custom gold controls, S1 E3 series
   labeling, up-next queue, views/likes/comments/share, more-from-creator.
   Vertical-neutral: works for YouTubers, filmmakers, educators, streamers… */

function VideoControls({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [vol, setVol] = useState(1);
  const [show, setShow] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => { setPlaying(true); poke(); };
    const onPause = () => { setPlaying(false); setShow(true); };
    const onTime = () => setTime(v.currentTime);
    const onDur = () => setDur(v.duration || 0);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onDur);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onDur);
    };
  }, [videoRef]);

  function poke() {
    setShow(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShow(false), 2600);
  }
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seekTo = (clientX: number) => {
    const el = barRef.current;
    const v = videoRef.current;
    if (!el || !v || !dur) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = ratio * dur;
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const fullscreen = () => {
    const wrap = videoRef.current?.closest("[data-video-wrap]") as HTMLElement | null;
    if (!wrap) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrap.requestFullscreen?.().catch(() => {});
  };

  const pct = dur > 0 ? (time / dur) * 100 : 0;

  return (
    <>
      <button
        className="absolute inset-0 w-full h-full cursor-pointer"
        onClick={toggle}
        onMouseMove={poke}
        aria-label={playing ? "Pause" : "Play"}
      />
      {!playing && (
        <button
          onClick={toggle}
          className="absolute inset-0 m-auto h-20 w-20 rounded-full bg-[#e8c86a] text-black flex items-center justify-center shadow-[0_0_40px_rgba(232,200,106,.6)] hover:scale-105 transition-transform"
          aria-label="Play video"
        >
          <Play className="h-10 w-10 fill-black ml-1" />
        </button>
      )}
      <div
        className={`absolute bottom-0 inset-x-0 px-4 pb-3 pt-10 bg-gradient-to-t from-black/90 to-transparent transition-opacity duration-300 ${
          show || !playing ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onMouseMove={poke}
      >
        <div
          ref={barRef}
          className="group relative h-5 flex items-center cursor-pointer touch-none"
          onPointerDown={(e: RPointerEvent) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seekTo(e.clientX);
          }}
          onPointerMove={(e: RPointerEvent) => { if (e.buttons === 1) seekTo(e.clientX); }}
          role="slider" aria-label="Seek video" aria-valuenow={Math.round(time)} aria-valuemax={Math.round(dur)}
        >
          <div className="h-1 w-full rounded-full bg-white/20 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8a6a1f,#e8c86a)" }} />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <button onClick={toggle} className="text-white hover:text-[#e8c86a]" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>
          <button onClick={toggleMute} className="text-white hover:text-[#e8c86a]" aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <input
            type="range" min={0} max={1} step={0.01} value={vol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVol(v);
              const el = videoRef.current;
              if (el) { el.volume = v; el.muted = false; setMuted(false); }
            }}
            className="w-20 accent-[#e8c86a] hidden sm:block"
            aria-label="Volume"
          />
          <span className="text-xs text-white/70 tabular-nums">{formatDuration(time)} / {formatDuration(dur)}</span>
          <div className="flex-1" />
          <button onClick={fullscreen} className="text-white hover:text-[#e8c86a]" aria-label="Fullscreen">
            <Maximize className="h-5 w-5" />
          </button>
        </div>
      </div>
    </>
  );
}

export default function StreamWatchPage() {
  const [, params] = useRoute("/watch/:id");
  const id = params?.id ?? "";
  const videoRef = useRef<HTMLVideoElement>(null);
  const sitePlayer = useStreamingPlayerOptional();

  const [video, setVideo] = useState<StreamVideo | null>(null);
  const [artist, setArtist] = useState<StreamProfileRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ended, setEnded] = useState(false);
  const [upNext, setUpNext] = useState<Array<{ kind: "track" | "video"; id: string; title: string; thumb: string | null; plays: number; season?: number | null; episode?: number | null }>>([]);
  const countedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setEnded(false);
    fetchVideo(id).then((res) => {
      if (!alive) return;
      if (!res) { setNotFound(true); return; }
      setVideo(res.video);
      setArtist(res.artist ?? null);
      // Pause site-wide audio — two soundtracks is never the move.
      sitePlayer?.pause();
      if (countedRef.current !== String(res.video.id)) {
        countedRef.current = String(res.video.id);
        recordPlay("video", String(res.video.id));
      }
      if (res.video.profile_id) {
        fetchMoreFromArtist(res.video.profile_id, "video", String(res.video.id), 10).then((m) => {
          if (alive) setUpNext(m);
        });
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => setEnded(true);
    const onPlay = () => setEnded(false);
    v.addEventListener("ended", onEnded);
    v.addEventListener("play", onPlay);
    return () => {
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("play", onPlay);
    };
  }, [video?.id]);

  usePageTitle(
    video ? `${video.title}${artist ? ` — ${artist.display_name}` : ""}` : "Watch",
    video ? `${video.description ?? video.title} — streamed on Bow Down Visuals.` : "Watch creator video on Bow Down Visuals."
  );

  const artistName = artist?.display_name ?? "Creator";
  const src = video ? resolveMedia(video.video_url) : "";
  const seriesLabel = video ? formatSeriesLabel(video.season_number, video.episode_number) : "";
  const nextUp = upNext[0];

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/40">Loading video…</p>
      </div>
    );
  }

  if (notFound || !video) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <Clapperboard className="h-12 w-12 text-[#e8c86a]/40 mx-auto mb-4" />
          <p className="text-xl font-bold mb-2">This video didn't make the cut</p>
          <p className="text-white/40 text-sm mb-6">Removed by its creator or a bad link. Plenty more where that came from.</p>
          <Link href="/showcase"><span className="text-[#e8c86a] underline text-sm">Back to the showcase</span></Link>
        </div>
      </div>
    );
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: video.description ?? video.title,
    contentUrl: src,
    thumbnailUrl: video.thumbnail_url ?? undefined,
    url: `https://bowdownvisuals.com/watch/${video.id}`,
    creator: { "@type": "Person", name: artistName },
    interactionStatistic: [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/WatchAction", userInteractionCount: video.view_count },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: video.like_count },
    ],
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={jsonLd} />
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-8">
        <Link href="/showcase" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-[#e8c86a] mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="grid lg:grid-cols-[1fr_340px] gap-8">
          <div className="min-w-0">
            {/* Player */}
            <div data-video-wrap className="relative aspect-video rounded-2xl overflow-hidden bg-black border border-[#e8c86a]/25 shadow-[0_20px_60px_rgba(0,0,0,.6)] group">
              <video
                ref={videoRef}
                src={src}
                poster={video.thumbnail_url ?? undefined}
                className="absolute inset-0 w-full h-full"
                playsInline
                preload="metadata"
              />
              <VideoControls videoRef={videoRef} />
              {ended && nextUp && (
                <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center text-center px-6 gap-3">
                  <p className="text-sm uppercase tracking-widest text-[#e8c86a]">Up next</p>
                  <p className="text-xl font-bold">{nextUp.title}</p>
                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={() => videoRef.current?.play().catch(() => {})}
                      className="rounded-full bg-[#e8c86a] text-black font-bold px-6 py-2.5 text-sm hover:bg-[#f5d67e]"
                    >
                      Replay
                    </button>
                    <Link href={`/watch/${nextUp.id}`} className="rounded-full border border-white/25 text-white font-semibold px-6 py-2.5 text-sm hover:border-[#e8c86a] hover:text-[#e8c86a]">
                      Play next
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Meta */}
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {seriesLabel && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-black bg-[#e8c86a] rounded-full px-3 py-1">
                    <Layers className="h-3.5 w-3.5" /> {seriesLabel}
                  </span>
                )}
                {video.series_title && (
                  <span className="text-xs text-white/50 uppercase tracking-wider">{video.series_title}</span>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-black leading-tight">{video.title}</h1>
              <p className="mt-2 text-white/60 text-sm">
                by {artist?.slug ? (
                  <Link href={`/creator/${artist.slug}`} className="text-[#e8c86a] hover:underline font-semibold">{artistName}</Link>
                ) : (
                  <span className="text-[#e8c86a] font-semibold">{artistName}</span>
                )}
                <span className="mx-2 text-white/20">•</span>
                <span className="inline-flex items-center gap-1.5"><Eye className="h-4 w-4" /> {formatCount(video.view_count)} views</span>
                {video.duration_sec ? <><span className="mx-2 text-white/20">•</span>{formatDuration(video.duration_sec)}</> : null}
              </p>

              <div className="mt-4">
                <MediaActions
                  kind="video"
                  id={String(video.id)}
                  title={video.title}
                  artistName={artistName}
                  sharePath={`/watch/${video.id}`}
                  likeCount={video.like_count}
                  showRepost={false}
                  size="lg"
                />
              </div>

              {video.description && (
                <p className="mt-5 text-sm text-white/60 whitespace-pre-wrap leading-relaxed rounded-xl bg-white/[.03] border border-white/10 p-4">
                  {video.description}
                </p>
              )}
            </div>

            <CommentThread kind="video" mediaId={String(video.id)} />
          </div>

          {/* Up next */}
          <aside className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#e8c86a] mb-4">Up next</h2>
            {upNext.length === 0 ? (
              <p className="text-sm text-white/40 rounded-xl border border-dashed border-white/15 px-4 py-6 text-center">
                Nothing queued after this — yet. This creator's catalog is still warming up.
              </p>
            ) : (
              <div className="space-y-3">
                {upNext.map((m) => {
                  const sLabel = formatSeriesLabel(m.season, m.episode);
                  return (
                    <Link key={m.id} href={`/watch/${m.id}`} className="flex gap-3 group">
                      <div className="relative w-40 shrink-0 aspect-video rounded-lg overflow-hidden bg-white/5 border border-white/10 group-hover:border-[#e8c86a]/50 transition-colors">
                        {m.thumb ? (
                          <img src={m.thumb} alt={m.title} loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Clapperboard className="h-6 w-6 text-[#e8c86a]/40" />
                          </div>
                        )}
                        {sLabel && (
                          <span className="absolute bottom-1 left-1 text-[10px] font-bold bg-black/80 text-[#e8c86a] rounded px-1.5 py-0.5">{sLabel}</span>
                        )}
                      </div>
                      <div className="min-w-0 py-0.5">
                        <p className="text-sm text-white/85 font-medium line-clamp-2 group-hover:text-[#e8c86a]">{m.title}</p>
                        <p className="text-xs text-white/40 mt-1">{artistName} • {formatCount(m.plays)} views</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
