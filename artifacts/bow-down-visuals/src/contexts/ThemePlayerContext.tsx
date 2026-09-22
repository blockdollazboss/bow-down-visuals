import {
  createContext, useContext, useEffect, useRef, useState, useCallback,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";

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

/*
 * Public-area routes — the "home screen": landing page, login/signup,
 * pricing, waitlist, and the other marketing pages. The theme song plays
 * continuously across all of these. Anything else (the logged-in app:
 * dashboard, creators, editors…) stops it.
 * Keep in sync with the public <Route>s in App.tsx.
 */
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/pricing",
  "/waitlist",
  "/beta-access",
  "/contact",
  "/terms",
  "/privacy",
  "/refund-policy",
]);

export function ThemePlayerProvider({ children }: { children: ReactNode }) {
  /*
   * Route awareness — the theme song is a public-area feature.
   * (Provider must live inside the wouter Router for useLocation to work.)
   */
  const [pathname] = useLocation();
  const isPublicArea = PUBLIC_PATHS.has(pathname);

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

  /*
   * Public-area autoplay flags.
   * isPublicAreaRef = fresh route read for handlers/effects.
   * autoPausedByNav = we paused because the user entered the logged-in app.
   */
  const isPublicAreaRef = useRef(isPublicArea);
  const autoPausedByNav = useRef(false);
  const volumeRef       = useRef(volume);

  useEffect(() => { isPublicAreaRef.current = isPublicArea; }, [isPublicArea]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  /*
   * Shared autoplay attempt. Only ever fires in the public area,
   * never when the user paused, never while another media owns the audio.
   */
  const tryAutoplay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isPublicAreaRef.current) return; // public area only
    if (manuallyPaused.current) return;   // user said no
    if (pausedByMedia.current) return;    // another media owns the audio
    if (!audio.paused) return;            // already playing
    audio.muted  = false;
    audio.volume = volumeRef.current;
    audio.play()
      .then(() => { setPlaying(true); setMuted(false); })
      .catch(() => { /* blocked — the unlock listener below stays armed */ });
  }, []);

  /* ── Boot: create audio, attempt unmuted autoplay (public area only) ── */
  useEffect(() => {
    const audio = new Audio(AUDIO_SRC);
    audio.loop    = true;
    audio.preload = "auto";
    audio.volume  = 0.65;
    audio.muted   = false;
    audioRef.current = audio;

    audio.addEventListener("error", () => setStatus("error"));

    const removeUnlock = () => {
      document.removeEventListener("click",      unlock);
      document.removeEventListener("keydown",    unlock);
      document.removeEventListener("touchstart", unlock);
    };

    /*
     * Browser blocked autoplay: the moment the user clicks/taps/keys,
     * start playing unmuted — but ONLY in the public area. The listener
     * stays armed on other routes, so arriving at a public page later
     * still auto-plays. Never falls back to muted.
     */
    const unlock = () => {
      const a = audioRef.current;
      if (!a) { removeUnlock(); return; }
      if (manuallyPaused.current) { removeUnlock(); return; } // user already said no
      if (!isPublicAreaRef.current) return; // not public — stay armed
      if (!a.paused) { removeUnlock(); return; }
      if (pausedByMedia.current) return;
      a.muted  = false;
      a.volume = volumeRef.current;
      a.play()
        .then(() => { setPlaying(true); setMuted(false); removeUnlock(); })
        .catch(() => {});
    };
    document.addEventListener("click",      unlock);
    document.addEventListener("keydown",    unlock);
    document.addEventListener("touchstart", unlock, { passive: true });

    fetch(AUDIO_SRC, { method: "HEAD" })
      .then((r) => {
        if (!r.ok) { setStatus("missing"); return; }
        setStatus("ready");

        /* Attempt 1: unmuted autoplay (works after any prior user gesture).
           tryAutoplay no-ops anywhere but the public area. */
        tryAutoplay();
      })
      .catch(() => setStatus("missing"));

    return () => {
      removeUnlock();
      audio.pause();
      audioRef.current = null;
    };
  }, [tryAutoplay]);

  /* ── Public-area autoplay: stop when entering the logged-in app, resume on return ── */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || status !== "ready") return;
    if (isPublicArea) {
      if (manuallyPaused.current) return; // respect the user's pause
      /* Clear a stale media-duck if nothing is actually playing anymore. */
      const stillPlaying = Array.from(
        document.querySelectorAll<HTMLMediaElement>("audio, video")
      ).some((el) => el !== audio && !el.paused && !el.ended);
      if (!stillPlaying) pausedByMedia.current = false;
      autoPausedByNav.current = false;
      /* Resumes after an app-visit pause, or fresh autoplay arriving in the public area. */
      tryAutoplay();
    } else if (!audio.paused) {
      /* Entered the logged-in app to start creating: stop the theme song, full stop. */
      autoPausedByNav.current = true;
      audio.pause();
      setPlaying(false);
    }
  }, [isPublicArea, status, tryAutoplay]);

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
      autoPausedByNav.current = false;
      audio.pause();
      setPlaying(false);
    } else {
      manuallyPaused.current = false;
      autoPausedByNav.current = false;
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
