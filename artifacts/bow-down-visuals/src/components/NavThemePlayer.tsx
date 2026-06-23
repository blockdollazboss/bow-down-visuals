import { useState, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";
import { getThemeAudio, AUDIO_SRC } from "@/lib/themeAudio";

const GOLD       = "#DAA520";
const GOLD_LIGHT = "#FFD700";
const GOLD_DARK  = "#9B7515";
const GOLD_GLOW  = "rgba(218,165,32,";

function EqBarsSmall({ active }: { active: boolean }) {
  return (
    <>
      <style>{`
        @keyframes eq1s { 0%,100%{height:2px} 50%{height:9px} }
        @keyframes eq2s { 0%,100%{height:4px} 50%{height:7px} }
        @keyframes eq3s { 0%,100%{height:7px} 50%{height:3px} }
        @keyframes eq4s { 0%,100%{height:3px} 50%{height:8px} }
        .eq-sm { width:2px; border-radius:1px; }
      `}</style>
      <div className="flex items-end gap-[2px]" aria-hidden="true" style={{ height: 9 }}>
        {[
          { anim: "eq1s", dur: "0.55s", delay: "0s"    },
          { anim: "eq2s", dur: "0.70s", delay: "0.10s" },
          { anim: "eq3s", dur: "0.60s", delay: "0.20s" },
          { anim: "eq4s", dur: "0.65s", delay: "0.05s" },
        ].map((b, i) => (
          <div
            key={i}
            className="eq-sm"
            style={{
              height: active ? undefined : 2,
              background: `linear-gradient(to top, ${GOLD_DARK}, ${GOLD_LIGHT})`,
              animation: active ? `${b.anim} ${b.dur} ease-in-out ${b.delay} infinite` : "none",
            }}
          />
        ))}
      </div>
    </>
  );
}

export function NavThemePlayer() {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const audio = getThemeAudio();

    const onPlay  = () => { if (!cancelled) setPlaying(true); };
    const onPause = () => { if (!cancelled) setPlaying(false); };
    audio.addEventListener("play",  onPlay);
    audio.addEventListener("pause", onPause);

    setPlaying(!audio.paused);

    fetch(AUDIO_SRC, { method: "HEAD" })
      .then((r) => {
        if (cancelled || !r.ok) return;
        setReady(true);
        if (audio.paused) {
          audio.muted = false;
          audio.play()
            .then(() => { if (!cancelled) setPlaying(true); })
            .catch(() => {
              audio.muted = true;
              audio.play().catch(() => {});
            });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      audio.removeEventListener("play",  onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = getThemeAudio();
    if (playing) {
      audio.pause();
    } else {
      audio.muted = false;
      audio.play().catch(() => {});
    }
  }, [playing]);

  if (!ready) return null;

  return (
    <div
      className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl shrink-0"
      style={{
        background: "rgba(0,0,0,0.50)",
        border: `1px solid ${GOLD_GLOW}0.18)`,
        backdropFilter: "blur(12px)",
      }}
      role="region"
      aria-label="Theme song player"
    >
      <button
        onClick={togglePlay}
        aria-label={playing ? "Pause theme" : "Play theme"}
        className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-110 active:scale-95"
        style={{
          background: `linear-gradient(135deg, ${GOLD_DARK}, ${GOLD})`,
          boxShadow: `0 0 8px ${GOLD_GLOW}0.50)`,
        }}
      >
        {playing
          ? <Pause className="h-2.5 w-2.5 text-black" fill="black" />
          : <Play  className="h-2.5 w-2.5 text-black" fill="black" style={{ marginLeft: 1 }} />
        }
      </button>

      <div className="flex flex-col gap-0.5 min-w-0">
        <p
          className="text-[8px] font-black uppercase tracking-[0.15em] leading-none whitespace-nowrap"
          style={{ color: `${GOLD_GLOW}0.70)` }}
        >
          BOW DOWN VISUALS
        </p>
        <EqBarsSmall active={playing} />
      </div>
    </div>
  );
}
