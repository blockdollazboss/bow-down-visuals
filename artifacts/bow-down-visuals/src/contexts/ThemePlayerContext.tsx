import {
  createContext, useContext, useEffect, useRef, useState, useCallback,
  type ReactNode,
} from "react";

const AUDIO_SRC = `${import.meta.env.BASE_URL}audio/bow-down-visuals-theme.mp3`;

type Status = "probing" | "ready" | "missing" | "playing" | "error";

interface ThemePlayerCtx {
  status: Status;
  playing: boolean;
  muted: boolean;
  volume: number;
  togglePlay: () => void;
  toggleMute: () => void;
  setVolume: (v: number) => void;
}

const Ctx = createContext<ThemePlayerCtx | null>(null);

export function ThemePlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status,  setStatus]  = useState<Status>("probing");
  const [playing, setPlaying] = useState(false);
  const [muted,   setMuted]   = useState(true);
  const [volume,  setVolumeState] = useState(0.65);

  /* Create the audio element once and never destroy it */
  useEffect(() => {
    const audio = new Audio(AUDIO_SRC);
    audio.loop    = true;
    audio.preload = "metadata";
    audio.volume  = 0.65;
    audio.muted   = true;
    audioRef.current = audio;

    audio.addEventListener("error", () => setStatus("error"));

    /* Probe */
    fetch(AUDIO_SRC, { method: "HEAD" })
      .then((r) => {
        if (r.ok) {
          setStatus("ready");
          /* Try autoplay muted first (browsers allow this) */
          audio.play()
            .then(() => { setPlaying(true); setMuted(true); })
            .catch(() => { /* fully blocked — user must click play */ });
        } else {
          setStatus("missing");
        }
      })
      .catch(() => setStatus("missing"));

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.muted  = false;
      audio.volume = volume;
      setMuted(false);
      audio.play().catch(() => {});
      setPlaying(true);
    }
  }, [playing, volume]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !muted;
    audio.muted = next;
    setMuted(next);
    if (!next && !playing) {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  }, [muted, playing]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = v;
    if (v > 0 && muted) {
      audio.muted = false;
      setMuted(false);
    }
  }, [muted]);

  return (
    <Ctx.Provider value={{ status, playing, muted, volume, togglePlay, toggleMute, setVolume }}>
      {children}
    </Ctx.Provider>
  );
}

export function useThemePlayer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemePlayer must be inside ThemePlayerProvider");
  return ctx;
}
