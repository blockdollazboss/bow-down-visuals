import { useCallback, useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { Loader2, AlertTriangle, RotateCcw, Radio, Users, Volume2, VideoOff } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { FollowButton, useFollowStates } from "@/components/discovery/FollowButton";
import LiveChatPanel from "@/components/live/LiveChatPanel";
import PushAlertsToggle from "@/components/live/PushAlertsToggle";
import StreamSummaryCard from "@/components/live/StreamSummaryCard";
import ReachWatchPanel from "@/components/reach/ReachWatchPanel";
import { WhepPlayer } from "@/lib/stream-kit/transport";
import PartyTableSection from "@/components/artist/PartyTableSection";
import { publicOnStageGuests } from "@/lib/go-live/guest-api";

/* ─── /live/:id — watch a native broadcast ────────────────────────────────
   Playback is WebRTC (WHEP) where the transport offers it; streams from
   the site's own stage arrive as HLS — played natively where the browser
   can (Safari), through hls.js (MSE, lazy-loaded) everywhere else.
   Anything else fails honestly with a retry — never a frozen fake
   player. While live, this page heartbeats so the viewer count the
   creator sees is real, and polls for the end of the stream; once
   ended, the recording (when one was saved) becomes the replay. */

interface LiveStreamDto {
  id: string;
  title: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  viewer_count: number;
  peak_viewers: number;
  vod_url: string | null;
  creator: { id: string; slug: string; display_name: string; avatar_url: string | null } | null;
  playback: { whep_url: string | null; hls_url: string | null } | null;
}

type LoadState = "loading" | "ready" | "error" | "notfound";
type PlayState = "idle" | "connecting" | "playing" | "failed";

/* Who's on stage with the host (guest invites, 0198). The public
   roster endpoint only ever names ON-STAGE guests — backstage stays
   invisible to the audience, here as everywhere. Labeled "Guest"
   because that's what they are. */
function OnStageGuests({ streamId }: { streamId: string }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await publicOnStageGuests(streamId);
        if (!cancelled) setNames(data.on_stage.map((g) => g.display_name));
      } catch {
        /* best-effort chips */
      }
    };
    void load();
    const id = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [streamId]);
  if (names.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="on-stage-guests">
      <span className="text-xs font-bold uppercase tracking-wider text-white/40">On stage</span>
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-200"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          {name} · Guest
        </span>
      ))}
    </div>
  );
}

export default function LiveWatch() {
  const [, params] = useRoute("/live/:id");
  const id = params?.id ?? "";
  const [stream, setStream] = useState<LiveStreamDto | null>(null);
  const [load, setLoad] = useState<LoadState>("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const [play, setPlay] = useState<PlayState>("idle");
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<WhepPlayer | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const sessionRef = useRef<string>("");
  if (!sessionRef.current) {
    sessionRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  usePageTitle(
    stream ? `${stream.title} — Live` : "Watch Live",
    stream?.creator ? `${stream.creator.display_name} is live on Bow Down Visuals.` : "Live on Bow Down Visuals.",
  );

  const fetchStream = useCallback(async (): Promise<LiveStreamDto | null> => {
    const res = await fetch(`/api/live-streams/${id}`);
    if (res.status === 404) {
      setLoad("notfound");
      return null;
    }
    if (!res.ok) throw new Error("load failed");
    const d = (await res.json()) as { stream: LiveStreamDto };
    return d.stream;
  }, [id]);

  /* Initial load (and manual retries). */
  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    (async () => {
      try {
        const s = await fetchStream();
        if (cancelled) return;
        if (s) {
          setStream(s);
          setLoad("ready");
        }
      } catch {
        if (!cancelled) setLoad("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchStream, retryNonce]);

  const isLive = stream?.status === "live";

  /* Connect the WHEP player when the stream is live. */
  useEffect(() => {
    if (!isLive || !stream?.playback) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const whepUrl = stream.playback.whep_url;
    const hlsUrl = stream.playback.hls_url;
    setPlay("connecting");
    (async () => {
      if (whepUrl) {
        try {
          const player = new WhepPlayer();
          playerRef.current = player;
          await player.play(whepUrl, video);
          if (!cancelled) setPlay("playing");
          return;
        } catch {
          playerRef.current?.stop();
          playerRef.current = null;
          if (cancelled) return;
        }
      }
      // WebRTC didn't connect (or wasn't offered) — HLS next: natively
      // where the browser can (Safari), hls.js everywhere else.
      if (hlsUrl && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
        await video.play().catch(() => undefined);
        if (!cancelled) setPlay("playing");
        return;
      }
      if (hlsUrl) {
        try {
          const { default: Hls } = await import("hls.js");
          if (cancelled) return;
          if (Hls.isSupported()) {
            const hls = new Hls({ liveSyncDurationCount: 3, maxLiveSyncPlaybackRate: 1.5 });
            hlsRef.current = hls;
            const ok = await new Promise<boolean>((resolve) => {
              hls.on(Hls.Events.MANIFEST_PARSED, () => resolve(true));
              hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (data.fatal) resolve(false);
              });
              hls.loadSource(hlsUrl);
              hls.attachMedia(video);
            });
            if (cancelled) return;
            if (ok) {
              await video.play().catch(() => undefined);
              if (!cancelled) setPlay("playing");
              return;
            }
            hls.destroy();
            hlsRef.current = null;
          }
        } catch {
          /* hls.js unavailable — fall through to the honest failure */
        }
      }
      if (!cancelled) setPlay("failed");
    })();
    return () => {
      cancelled = true;
      playerRef.current?.stop();
      playerRef.current = null;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, stream?.id, retryNonce]);

  /* Presence heartbeat + status polling while live. */
  useEffect(() => {
    if (!isLive || !stream) return;
    const sid = stream.id;
    const beat = async () => {
      try {
        await fetch(`/api/live-streams/${sid}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionRef.current }),
        });
      } catch {
        /* presence is best-effort */
      }
    };
    void beat();
    const beatTimer = setInterval(beat, 15_000);
    const pollTimer = setInterval(async () => {
      try {
        const s = await fetchStream();
        if (s) setStream(s);
      } catch {
        /* the next poll retries */
      }
    }, 15_000);
    return () => {
      clearInterval(beatTimer);
      clearInterval(pollTimer);
    };
  }, [isLive, stream?.id, fetchStream]); // eslint-disable-line react-hooks/exhaustive-deps

  const followStates = useFollowStates(stream?.creator ? [stream.creator.id] : []);

  if (load === "loading") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (load === "error") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 bg-black px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <h1 className="text-xl font-bold text-white">Couldn't load this stream.</h1>
        <p className="max-w-sm text-sm text-white/50">Something went wrong on our end — the stream may well be live, it just couldn't load right now.</p>
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)} className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105">
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (load === "notfound" || !stream) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 bg-black px-4 text-center">
        <VideoOff className="h-10 w-10 text-white/30" />
        <h1 className="text-xl font-bold text-white">That stream doesn't exist.</h1>
        <p className="max-w-sm text-sm text-white/50">The link may be off, or the stream was removed. See who's live right now instead.</p>
        <Link href="/explore" className="mt-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105">
          Explore live streams
        </Link>
      </div>
    );
  }

  const creator = stream.creator;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <div className="flex flex-col gap-5 lg:flex-row">
          <div className="min-w-0 flex-1">
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[#C9A84C]/25 bg-black">
          {isLive ? (
            <>
              <video ref={videoRef} autoPlay playsInline muted={muted} className="h-full w-full object-contain" data-testid="live-player" />
              {play === "connecting" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
                </div>
              )}
              {play === "failed" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-400" />
                  <p className="text-sm font-bold">The live feed couldn't connect.</p>
                  <p className="max-w-sm text-xs text-white/50">Your connection or browser blocked the live video. Try again — the stream is still on.</p>
                  <button type="button" onClick={() => setRetryNonce((n) => n + 1)} className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                    <RotateCcw className="h-4 w-4" /> Reconnect
                  </button>
                </div>
              )}
              <div className="absolute left-3 top-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Live
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-bold text-white">
                  <Users className="h-3.5 w-3.5" /> {stream.viewer_count} watching
                </span>
              </div>
              {muted && play === "playing" && (
                <button
                  type="button"
                  onClick={() => {
                    setMuted(false);
                    if (videoRef.current) videoRef.current.muted = false;
                  }}
                  className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-black transition hover:scale-105"
                  data-testid="btn-unmute"
                >
                  <Volume2 className="h-4 w-4" /> Tap for sound
                </button>
              )}
            </>
          ) : stream.vod_url ? (
            <video src={stream.vod_url} controls playsInline className="h-full w-full object-contain" data-testid="vod-player" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <Radio className="h-8 w-8 text-[#C9A84C]/60" />
              <p className="text-sm font-bold text-white/80">This stream has ended.</p>
              <p className="max-w-sm text-xs text-white/40">No recording was saved for this one. Catch the next show live.</p>
            </div>
          )}
        </div>

        {!isLive && <StreamSummaryCard streamId={stream.id} />}
        <ReachWatchPanel streamId={stream.id} profileId={stream.creator?.id ?? null} isLive={!!isLive} isOwner={false} />

        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black tracking-tight">{stream.title}</h1>
            <p className="mt-1 text-sm text-white/50">
              {isLive
                ? `Live now${stream.peak_viewers > 0 ? ` · peak ${stream.peak_viewers} watching` : ""}`
                : `Streamed ${stream.ended_at ? new Date(stream.ended_at).toLocaleString() : ""}${stream.vod_url ? " · replay" : ""}`}
            </p>
          </div>
          {creator && (
            <div className="flex items-center gap-3">
              <Link href={`/artist/${creator.slug}`} className="flex items-center gap-3">
                {creator.avatar_url ? (
                  <img src={creator.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e8c86a]/20 text-lg font-bold text-[#e8c86a]">
                    {creator.display_name[0] ?? "?"}
                  </span>
                )}
                <span className="text-left">
                  <span className="block font-bold hover:text-[#e8c86a]">{creator.display_name}</span>
                  <span className="block text-xs text-white/40">View profile</span>
                </span>
              </Link>
              <FollowButton profileId={creator.id} initialFollowing={followStates[creator.id]} />
              <PushAlertsToggle />
            </div>
          )}
        </div>
        {isLive && <OnStageGuests streamId={stream.id} />}
        {/* A party table homed to THIS stream stands at the stream
            (program 2.25) — the host's table, opened from in-world
            through the same summons door as the profile and the
            Kingdom Board. Renders nothing when no table is homed
            here. */}
        {creator && (
          <PartyTableSection slug={creator.slug} streamId={stream.id} className="mt-5" />
        )}
          </div>
          <LiveChatPanel streamId={stream.id} className="h-[440px] shrink-0 lg:h-auto lg:w-[340px]" />
        </div>
      </div>
    </div>
  );
}
