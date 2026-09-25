import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music2, ListMusic,
} from "lucide-react";
import { useThemePlayer } from "@/contexts/ThemePlayerContext";
import { LuxReveal } from "@/components/LuxReveal";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  fetchFeaturedSongs, formatTime, type FeaturedTrack,
} from "@/lib/featured-songs";

const GOLD = "#DAA520";
const GOLD_LIGHT = "#FFD700";
const GOLD_DARK = "#9B7515";
const GLOW = "rgba(218,165,32,";

/* ──────────────────────────────────────────────
   FeaturedPlaylist — homepage "Featured Songs" section.
   Replaces the old theme-song-only player: a data-driven playlist
   (GET /api/featured-songs) with play/next/prev, seek, and volume.
   No character imagery — pure gold/black luxury playlist UI.
   ────────────────────────────────────────────── */

function EqBars({ active }: { active: boolean }) {
  return (
    <>
      <style>{`
        @keyframes fplEq1 { 0%,100%{height:3px}  50%{height:14px} }
        @keyframes fplEq2 { 0%,100%{height:6px}  50%{height:10px} }
        @keyframes fplEq3 { 0%,100%{height:10px} 50%{height:4px}  }
        @keyframes fplEq4 { 0%,100%{height:5px}  50%{height:13px} }
        @keyframes fplEq5 { 0%,100%{height:8px}  50%{height:3px}  }
      `}</style>
      <div className="flex items-end gap-[3px]" aria-hidden="true" style={{ height: 14 }}>
        {[
          { anim: "fplEq1", dur: "0.55s", delay: "0.00s" },
          { anim: "fplEq2", dur: "0.70s", delay: "0.08s" },
          { anim: "fplEq3", dur: "0.60s", delay: "0.16s" },
          { anim: "fplEq4", dur: "0.65s", delay: "0.04s" },
          { anim: "fplEq5", dur: "0.50s", delay: "0.12s" },
        ].map((b, i) => (
          <div
            key={i}
            style={{
              width: 3,
              borderRadius: 2,
              height: active ? undefined : 4,
              background: `linear-gradient(to top, ${GOLD_DARK}, ${GOLD_LIGHT})`,
              animation: active ? `${b.anim} ${b.dur} ease-in-out ${b.delay} infinite` : "none",
            }}
          />
        ))}
      </div>
    </>
  );
}

export function FeaturedPlaylist() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playAfterSwapRef = useRef(false);
  const [tracks, setTracks] = useState<FeaturedTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.65);
  const [muted, setMuted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const theme = useThemePlayer();

  const track = tracks[index] ?? null;

  /* Load the playlist */
  useEffect(() => {
    let alive = true;
    fetchFeaturedSongs().then((t) => {
      if (alive) {
        setTracks(t);
        setLoaded(true);
      }
    });
    return () => { alive = false; };
  }, []);

  /* Silence the global theme song while the playlist owns the audio.
     Pausing it via the context marks it manually-paused, so it won't
     auto-resume when our track pauses/ends. */
  const duckThemeSong = useCallback(() => {
    if (theme.playing) theme.togglePlay();
  }, [theme]);

  /* Swap source when the track index changes */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    const shouldPlay = playing || playAfterSwapRef.current;
    playAfterSwapRef.current = false;
    audio.src = track.audio_url;
    audio.load();
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    if (shouldPlay) {
      audio.play().catch(() => setPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, track?.id]);

  const playTrack = useCallback(
    (i: number) => {
      const audio = audioRef.current;
      if (!audio || !tracks[i]) return;
      duckThemeSong();
      if (i === index) {
        if (playing) {
          audio.pause();
          setPlaying(false);
        } else {
          audio.play().then(() => setPlaying(true)).catch(() => {});
        }
        return;
      }
      playAfterSwapRef.current = true;
      setIndex(i);
      setPlaying(true);
    },
    [audioRef, tracks, index, playing, duckThemeSong],
  );

  const next = useCallback(() => {
    if (tracks.length === 0) return;
    playAfterSwapRef.current = playing;
    setIndex((i) => (i + 1) % tracks.length);
  }, [tracks.length, playing]);

  const prev = useCallback(() => {
    if (tracks.length === 0) return;
    playAfterSwapRef.current = playing;
    setIndex((i) => (i - 1 + tracks.length) % tracks.length);
  }, [tracks.length, playing]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    duckThemeSong();
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [audioRef, track, playing, duckThemeSong]);

  const onSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const v = parseFloat(e.target.value);
      audio.currentTime = v * duration;
      setCurrentTime(audio.currentTime);
    },
    [audioRef, duration],
  );

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextMuted = !muted;
    audio.muted = nextMuted;
    setMuted(nextMuted);
  }, [audioRef, muted]);

  const onVolume = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      const v = parseFloat(e.target.value);
      setVolume(v);
      if (audio) {
        audio.volume = v;
        if (v > 0 && muted) {
          audio.muted = false;
          setMuted(false);
        }
      }
    },
    [audioRef, muted],
  );

  const progress = duration > 0 ? currentTime / duration : 0;

  if (!loaded) {
    return (
      <section className="py-20 md:py-28 px-5">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-3 text-white/40">
          <Music2 className="h-5 w-5 animate-pulse" style={{ color: GOLD }} />
          <span className="text-sm">Loading featured songs…</span>
        </div>
      </section>
    );
  }

  return (
    <>
      <style>{`
        .fpl-seek {
          -webkit-appearance:none; appearance:none; height:4px; border-radius:3px;
          outline:none; cursor:pointer;
          background:linear-gradient(to right, ${GOLD} 0%, ${GOLD} calc(var(--p)*100%),
            rgba(255,255,255,0.12) calc(var(--p)*100%), rgba(255,255,255,0.12) 100%);
        }
        .fpl-seek::-webkit-slider-thumb {
          -webkit-appearance:none; width:13px; height:13px; border-radius:50%;
          background:${GOLD_LIGHT}; cursor:pointer; box-shadow:0 0 8px ${GLOW}0.8);
        }
        .fpl-seek::-moz-range-thumb {
          width:13px; height:13px; border-radius:50%; background:${GOLD_LIGHT};
          cursor:pointer; border:none; box-shadow:0 0 8px ${GLOW}0.8);
        }
        .fpl-vol {
          -webkit-appearance:none; appearance:none; height:3px; border-radius:2px;
          outline:none; cursor:pointer;
          background:linear-gradient(to right, ${GOLD} 0%, ${GOLD} calc(var(--v)*100%),
            rgba(255,255,255,0.12) calc(var(--v)*100%), rgba(255,255,255,0.12) 100%);
        }
        .fpl-vol::-webkit-slider-thumb {
          -webkit-appearance:none; width:11px; height:11px; border-radius:50%;
          background:${GOLD}; cursor:pointer; box-shadow:0 0 6px ${GLOW}0.7);
        }
        .fpl-vol::-moz-range-thumb {
          width:11px; height:11px; border-radius:50%; background:${GOLD};
          cursor:pointer; border:none; box-shadow:0 0 6px ${GLOW}0.7);
        }
        .fpl-play-btn {
          background:linear-gradient(135deg, ${GOLD_DARK}, ${GOLD});
          box-shadow:0 0 20px ${GLOW}0.50);
          transition:transform 0.15s, box-shadow 0.15s;
        }
        .fpl-play-btn:hover { transform:scale(1.08); box-shadow:0 0 28px ${GLOW}0.75); }
        .fpl-play-btn:active { transform:scale(0.95); }
        .fpl-skip { color:rgba(255,255,255,0.45); transition:color 0.15s, transform 0.15s; }
        .fpl-skip:hover { color:${GOLD}; transform:scale(1.12); }
        .fpl-skip:active { transform:scale(0.92); }
      `}</style>

      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={next}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setError("Couldn't load this track — skipping…")}
      />

      <section
        id="featured-songs"
        className="scroll-mt-20 py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent"
      >
        <LuxReveal className="max-w-4xl mx-auto">
          <div className="text-center mb-10 space-y-4">
            <MarketingBadge variant="kicker">
              <ListMusic className="h-3 w-3" /> Featured Songs
            </MarketingBadge>
            <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
              Straight from the <span style={{ color: GOLD_LIGHT }}>vault</span>
            </h2>
            <p className="text-white/50 text-lg max-w-xl mx-auto">
              Fresh drops from Bow Down Visuals artists — press play.
            </p>
          </div>

          <div
            className="rounded-3xl overflow-hidden"
            style={{
              background: "rgba(0,0,0,0.60)",
              backdropFilter: "blur(16px)",
              border: `1px solid ${GLOW}0.20)`,
              boxShadow: `0 0 40px ${GLOW}0.08), 0 8px 32px rgba(0,0,0,0.55)`,
            }}
          >
            {/* Track list */}
            <div className="divide-y divide-white/[0.06]">
              {tracks.map((t, i) => {
                const active = i === index;
                return (
                  <button
                    key={t.id}
                    onClick={() => playTrack(i)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
                    style={active ? { background: `${GLOW}0.06)` } : undefined}
                    aria-label={active && playing ? `Pause ${t.title}` : `Play ${t.title}`}
                  >
                    <span
                      className="text-xs font-mono w-6 text-center shrink-0"
                      style={{ color: active ? GOLD_LIGHT : "rgba(255,255,255,0.25)" }}
                    >
                      {active && playing ? "▶" : String(i + 1).padStart(2, "0")}
                    </span>

                    <span
                      className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: active
                          ? `linear-gradient(135deg, ${GOLD_DARK}, ${GOLD})`
                          : "rgba(255,255,255,0.05)",
                        border: `1px solid ${GLOW}${active ? "0.50" : "0.15"})`,
                      }}
                    >
                      {active && playing ? (
                        <EqBars active />
                      ) : (
                        <Music2 className="h-5 w-5" style={{ color: active ? "#000" : GOLD }} />
                      )}
                    </span>

                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-white/90 truncate">
                        {t.title}
                      </span>
                      <span className="block text-xs text-white/40 truncate mt-0.5">
                        {t.artist}
                      </span>
                    </span>

                    <span className="text-xs font-mono text-white/35 shrink-0">
                      {t.duration_label ?? "—"}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Transport bar */}
            <div
              className="px-5 py-4 space-y-3"
              style={{ borderTop: `1px solid ${GLOW}0.15)`, background: "rgba(0,0,0,0.40)" }}
            >
              {error && (
                <p className="text-xs text-red-400/80 text-center">{error}</p>
              )}

              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-white/40 w-10 text-right shrink-0">
                  {formatTime(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={Number.isFinite(progress) ? progress : 0}
                  onChange={onSeek}
                  className="fpl-seek flex-1"
                  style={{ "--p": Number.isFinite(progress) ? progress : 0 } as React.CSSProperties}
                  aria-label="Seek"
                />
                <span className="text-[11px] font-mono text-white/40 w-10 shrink-0">
                  {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {track && (
                    <p className="text-xs text-white/50 truncate">
                      <span className="font-semibold text-white/80">{track.title}</span>
                      {" — "}
                      {track.artist}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={prev} className="fpl-skip" aria-label="Previous track">
                    <SkipBack className="h-5 w-5" fill="currentColor" />
                  </button>
                  <button
                    onClick={togglePlay}
                    className="fpl-play-btn h-12 w-12 rounded-full flex items-center justify-center"
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    {playing ? (
                      <Pause className="h-5 w-5 text-black" fill="black" />
                    ) : (
                      <Play className="h-5 w-5 text-black" fill="black" style={{ marginLeft: 2 }} />
                    )}
                  </button>
                  <button onClick={next} className="fpl-skip" aria-label="Next track">
                    <SkipForward className="h-5 w-5" fill="currentColor" />
                  </button>
                </div>

                <div className="hidden sm:flex items-center gap-2 shrink-0">
                  <button
                    onClick={toggleMute}
                    className="fpl-skip"
                    aria-label={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={onVolume}
                    className="fpl-vol w-20"
                    style={{ "--v": muted ? 0 : volume } as React.CSSProperties}
                    aria-label="Volume"
                  />
                </div>
              </div>
            </div>
          </div>
        </LuxReveal>
      </section>
    </>
  );
}
