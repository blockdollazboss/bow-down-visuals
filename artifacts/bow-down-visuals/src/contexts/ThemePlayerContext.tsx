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
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const [status,  setStatus]  = useState<Status>("probing");
  const [playing, setPlaying] = useState(false);
  const [muted,   setMuted]   = useState(false);
  const [volume,  setVolumeState] = useState(0.65);

  /*
   * Intent flags — track WHY playback state changed.
   * manuallyPaused / manuallyMuted = user explicitly chose this state.
   * pausedByMedia = we auto-paused because another media element started.
   */
  const manuallyPaused = useRef(false);
  const manuallyMuted  = useRef(false);
  const pausedByMedia  = useRef(false);

  /* ── Boot: create audio, attempt unmuted autoplay ── */
  useEffect(() => {
    const audio = new Audio(AUDIO_SRC);
    audio.loop    = true;
    audio.preload = "auto";
    audio.volume  = 0.65;
    audio.muted   = false;
    audioRef.current = audio;

    audio.addEventListener("error", () => setStatus("error"));

    fetch(AUDIO_SRC, { method: "HEAD" })
      .then((r) => {
        if (!r.ok) { setStatus("missing"); return; }
        setStatus("ready");

        /* Attempt 1: unmuted autoplay (works after any prior user gesture) */
        audio.play()
          .then(() => { setPlaying(true); setMuted(false); })
          .catch(() => {
            /*
             * Browser blocked autoplay. Register a one-shot interaction
             * listener — the moment the user clicks/taps/keys anywhere,
             * start playing unmuted. Never fall back to muted.
             */
            const unlock = () => {
              if (manuallyPaused.current) return; // user already said no
              audio.muted  = false;
              audio.volume = 0.65;
              audio.play()
                .then(() => { setPlaying(true); setMuted(false); })
                .catch(() => {});
              document.removeEventListener("click",   unlock);
              document.removeEventListener("keydown", unlock);
              document.removeEventListener("touchstart", unlock);
            };
            document.addEventListener("click",      unlock, { once: true });
            document.addEventListener("keydown",    unlock, { once: true });
            document.addEventListener("touchstart", unlock, { once: true, passive: true });
          });
      })
      .catch(() => setStatus("missing"));

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  /* ── Detect other media playing on the page ── */
  useEffect(() => {
    /*
     * Called whenever any non-theme audio/video element fires "play".
     * We duck the theme out immediately.
     */
    function onOtherPlay(e: Event) {
      const audio = audioRef.current;
      if (!audio || e.target === audio) return;
      if (!playing) return; // theme already stopped — nothing to do
      pausedByMedia.current = true;
      audio.pause();
      setPlaying(false);
    }

    /*
     * Called whenever any non-theme audio/video fires "pause" or "ended".
     * Only resume if WE auto-paused it and the user hasn't manually
     * paused or muted since then.
     */
    function onOtherStop(e: Event) {
      const audio = audioRef.current;
      if (!audio || e.target === audio) return;
      if (!pausedByMedia.current) return;
      if (manuallyPaused.current || manuallyMuted.current) return;

      /* Check no other media element is still playing */
      const stillPlaying = Array.from(
        document.querySelectorAll<HTMLMediaElement>("audio, video")
      ).some((el) => el !== audio && !el.paused && !el.ended);

      if (stillPlaying) return;

      pausedByMedia.current = false;
      audio.muted  = false;
      audio.volume = audioRef.current?.volume ?? 0.65;
      audio.play()
        .then(() => { setPlaying(true); setMuted(false); })
        .catch(() => {});
    }

    /* Attach to all existing media elements */
    function attachTo(el: HTMLMediaElement) {
      el.addEventListener("play",  onOtherPlay);
      el.addEventListener("pause", onOtherStop);
      el.addEventListener("ended", onOtherStop);
    }

    function detachFrom(el: HTMLMediaElement) {
      el.removeEventListener("play",  onOtherPlay);
      el.removeEventListener("pause", onOtherStop);
      el.removeEventListener("ended", onOtherStop);
    }

    /* Seed existing elements */
    document.querySelectorAll<HTMLMediaElement>("audio, video").forEach(attachTo);

    /* Watch for new ones added dynamically */
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLMediaElement) attachTo(node);
          if (node instanceof Element) {
            node.querySelectorAll<HTMLMediaElement>("audio, video").forEach(attachTo);
          }
        }
        for (const node of Array.from(m.removedNodes)) {
          if (node instanceof HTMLMediaElement) detachFrom(node);
          if (node instanceof Element) {
            node.querySelectorAll<HTMLMediaElement>("audio, video").forEach(detachFrom);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLMediaElement>("audio, video").forEach(detachFrom);
    };
  }, [playing]);

  /* ── User controls ── */
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      manuallyPaused.current = true;
      pausedByMedia.current  = false;
      audio.pause();
      setPlaying(false);
    } else {
      manuallyPaused.current = false;
      audio.muted  = manuallyMuted.current;
      audio.volume = volume;
      audio.play().catch(() => {});
      setPlaying(true);
    }
  }, [playing, volume]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !muted;
    manuallyMuted.current = next;
    audio.muted = next;
    setMuted(next);
    /* Unmuting should also ensure playback starts if paused */
    if (!next && !playing && !manuallyPaused.current) {
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
      manuallyMuted.current = false;
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
