import { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";

const AUDIO_SRC = `${import.meta.env.BASE_URL}audio/bow-down-visuals-theme.mp3`;

const GOLD       = "#DAA520";
const GOLD_LIGHT = "#FFD700";
const GOLD_DARK  = "#9B7515";
const GOLD_GLOW  = "rgba(218,165,32,";

type Status = "probing" | "ready" | "missing" | "playing" | "error";

function EqBars({ active, size = "md" }: { active: boolean; size?: "sm" | "md" }) {
  const h = size === "sm" ? 10 : 14;
  const barH = size === "sm" ? [2, 5, 8, 4, 7] : [3, 6, 10, 5, 8];
  return (
    <>
      <style>{`
        @keyframes eq1 { 0%,100%{height:3px}  50%{height:14px} }
        @keyframes eq2 { 0%,100%{height:6px}  50%{height:10px} }
        @keyframes eq3 { 0%,100%{height:10px} 50%{height:4px}  }
        @keyframes eq4 { 0%,100%{height:5px}  50%{height:13px} }
        @keyframes eq5 { 0%,100%{height:8px}  50%{height:3px}  }
        .eq-bar { width:3px; border-radius:2px; transition:height 0.3s; }
      `}</style>
      <div className="flex items-end gap-[3px]" aria-hidden="true" style={{ height: h }}>
        {[
          { anim: "eq1", dur: "0.55s", delay: "0.00s", base: barH[0] },
          { anim: "eq2", dur: "0.70s", delay: "0.08s", base: barH[1] },
          { anim: "eq3", dur: "0.60s", delay: "0.16s", base: barH[2] },
          { anim: "eq4", dur: "0.65s", delay: "0.04s", base: barH[3] },
          { anim: "eq5", dur: "0.50s", delay: "0.12s", base: barH[4] },
        ].map((b, i) => (
          <div
            key={i}
            className="eq-bar"
            style={{
              height: active ? undefined : b.base,
              background: `linear-gradient(to top, ${GOLD_DARK}, ${GOLD_LIGHT})`,
              animation: active
                ? `${b.anim} ${b.dur} ease-in-out ${b.delay} infinite`
                : "none",
            }}
          />
        ))}
      </div>
    </>
  );
}

function useThemeAudio() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<Status>("probing");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.65);

  useEffect(() => {
    let cancelled = false;
    fetch(AUDIO_SRC, { method: "HEAD" })
      .then((r) => { if (!cancelled) setStatus(r.ok ? "ready" : "missing"); })
      .catch(() => { if (!cancelled) setStatus("missing"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = false;
    audio.play()
      .then(() => { setPlaying(true); setMuted(false); })
      .catch(() => {
        audio.muted = true;
        audio.play()
          .then(() => { setPlaying(true); setMuted(true); })
          .catch(() => {});
      });
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) { audio.pause(); audio.currentTime = 0; }
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      if (!audio.error) audio.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      if (!audio.error) {
        audio.muted = false;
        setMuted(false);
        audio.volume = volume;
        audio.play().catch(() => {});
      }
    }
  }, [playing, volume]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !muted;
    audio.muted = next;
    setMuted(next);
  }, [muted]);

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
      if (v > 0 && muted) {
        audioRef.current.muted = false;
        setMuted(false);
      }
    }
  }, [muted]);

  return { audioRef, status, playing, muted, volume, togglePlay, toggleMute, handleVolume };
}

/* ──────────────────────────────────────────────
   NavThemePlayer — compact bar for the top navbar
   ────────────────────────────────────────────── */
export function NavThemePlayer() {
  const { audioRef, status, playing, muted, togglePlay, toggleMute } = useThemeAudio();

  if (status === "probing" || status === "missing") return null;

  return (
    <>
      <style>{`
        .nav-play-btn {
          background: linear-gradient(135deg, ${GOLD_DARK}, ${GOLD});
          box-shadow: 0 0 10px ${GOLD_GLOW}0.45);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .nav-play-btn:hover {
          transform: scale(1.10);
          box-shadow: 0 0 18px ${GOLD_GLOW}0.70);
        }
        .nav-play-btn:active { transform: scale(0.94); }
        .nav-mute-btn { color: rgba(255,255,255,0.32); transition: color 0.15s; }
        .nav-mute-btn:hover { color: ${GOLD}; }
      `}</style>

      <audio ref={audioRef} src={AUDIO_SRC} loop preload="metadata" />

      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl shrink-0"
        style={{
          background: "rgba(0,0,0,0.45)",
          border: `1px solid ${GOLD_GLOW}0.18)`,
          backdropFilter: "blur(10px)",
        }}
        role="region"
        aria-label="Theme song player"
      >
        {/* Play / Pause */}
        <button
          className="nav-play-btn h-7 w-7 rounded-full flex items-center justify-center shrink-0"
          onClick={togglePlay}
          aria-label={playing ? "Pause theme" : "Play theme"}
        >
          {playing
            ? <Pause className="h-3 w-3 text-black" fill="black" />
            : <Play  className="h-3 w-3 text-black" fill="black" style={{ marginLeft: 1 }} />
          }
        </button>

        {/* EQ bars */}
        <EqBars active={playing && !muted} size="sm" />

        {/* Mute */}
        <button
          onClick={toggleMute}
          className="nav-mute-btn"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted
            ? <VolumeX className="h-3.5 w-3.5" />
            : <Volume2  className="h-3.5 w-3.5" />
          }
        </button>
      </div>
    </>
  );
}

/* ──────────────────────────────────────────────
   HomepageThemePlayer — kept for backwards compat
   (no longer rendered on homepage, but still exported)
   ────────────────────────────────────────────── */
export function HomepageThemePlayer() {
  const { audioRef, status, playing, muted, volume, togglePlay, toggleMute, handleVolume } = useThemeAudio();

  if (status === "probing") return null;

  if (status === "missing") {
    return (
      <div className="flex justify-center">
        <div
          className="flex items-center gap-3 px-5 py-3 rounded-2xl text-sm text-white/30 border border-white/8"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(12px)" }}
        >
          <span className="text-base">🎵</span>
          <span>Theme song not uploaded yet — drop file at <code className="text-white/40 text-xs">public/audio/bow-down-visuals-theme.mp3</code></span>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .theme-volume::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: ${GOLD};
          cursor: pointer;
          box-shadow: 0 0 6px ${GOLD_GLOW}0.7);
        }
        .theme-volume::-moz-range-thumb {
          width: 12px; height: 12px;
          border-radius: 50%;
          background: ${GOLD};
          cursor: pointer;
          border: none;
          box-shadow: 0 0 6px ${GOLD_GLOW}0.7);
        }
        .theme-volume {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
          background: linear-gradient(
            to right,
            ${GOLD} 0%,
            ${GOLD} calc(var(--vol) * 100%),
            rgba(255,255,255,0.12) calc(var(--vol) * 100%),
            rgba(255,255,255,0.12) 100%
          );
        }
        .theme-player-glow {
          box-shadow:
            0 0 0 1px ${GOLD_GLOW}0.22),
            0 0 28px ${GOLD_GLOW}0.10),
            0 4px 24px rgba(0,0,0,0.55);
        }
        .theme-play-btn {
          background: linear-gradient(135deg, ${GOLD_DARK}, ${GOLD});
          box-shadow: 0 0 18px ${GOLD_GLOW}0.50);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .theme-play-btn:hover {
          transform: scale(1.08);
          box-shadow: 0 0 26px ${GOLD_GLOW}0.70);
        }
        .theme-play-btn:active { transform: scale(0.96); }
        .theme-mute-btn { color: rgba(255,255,255,0.35); transition: color 0.15s; }
        .theme-mute-btn:hover { color: ${GOLD}; }
      `}</style>

      <audio
        ref={audioRef}
        src={AUDIO_SRC}
        loop
        preload="metadata"
      />

      <div className="flex justify-center">
        <div
          className="theme-player-glow flex items-center gap-4 px-5 py-3.5 rounded-2xl"
          style={{
            background: "rgba(0,0,0,0.60)",
            backdropFilter: "blur(16px)",
            border: `1px solid ${GOLD_GLOW}0.20)`,
            width: "min(440px, 100%)",
          }}
          role="region"
          aria-label="Homepage theme song player"
        >
          <button
            className="theme-play-btn h-11 w-11 rounded-full flex items-center justify-center shrink-0"
            onClick={togglePlay}
            aria-label={playing ? "Pause theme song" : "Play theme song"}
          >
            {playing
              ? <Pause className="h-4 w-4 text-black" fill="black" />
              : <Play  className="h-4 w-4 text-black" fill="black" style={{ marginLeft: 2 }} />
            }
          </button>

          <div className="flex-1 min-w-0 space-y-0.5">
            <p style={{ color: `${GOLD_GLOW}0.65)` }} className="text-[9px] font-bold uppercase tracking-[0.18em]">
              BOW DOWN VISUALS
            </p>
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="overflow-hidden flex-1 min-w-0">
                <style>{`
                  @keyframes marquee {
                    0%   { transform: translateX(100%); }
                    100% { transform: translateX(-100%); }
                  }
                  .marquee-text {
                    display: inline-block;
                    white-space: nowrap;
                    animation: marquee 8s linear infinite;
                  }
                `}</style>
                <p className="marquee-text text-sm font-semibold text-white/90 leading-tight">
                  www.bowdownvisuals.com
                </p>
              </div>
              <EqBars active={playing && !muted} />
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={toggleMute}
              className="theme-mute-btn"
              aria-label={muted ? "Unmute theme song" : "Mute theme song"}
            >
              {muted
                ? <VolumeX className="h-4 w-4" />
                : <Volume2  className="h-4 w-4" />
              }
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={handleVolume}
              className="theme-volume w-20"
              style={{ "--vol": volume } as React.CSSProperties}
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </>
  );
}
