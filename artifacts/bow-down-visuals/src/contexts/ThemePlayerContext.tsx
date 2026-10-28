import {
  createContext, useContext, useEffect, useRef, useState, useCallback,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { attachThemeAnalyser } from "@/lib/theme-analyser";
import { mediaUrl } from "@/lib/media-cdn";
import {
  ThemeProbe,
  attemptPlay,
  type ThemeAvailability,
  type ThemeProbeSnapshot,
} from "@/lib/theme-probe";

const AUDIO_SRC = mediaUrl("audio/bow-down-visuals-theme.mp3");

type Status = ThemeAvailability;

interface ThemePlayerCtx {
  status: Status;
  /** A theme-track availability probe is in flight right now. */
  checking: boolean;
  /** The last user-initiated play() attempt was rejected (autoplay
      policy, decode, network). Surfaced by the widget row; cleared by
      the next attempt or any successful play. */
  playFailed: boolean;
  playing: boolean;
  muted: boolean;
  volume: number;
  togglePlay: () => void;
  toggleMute: () => void;
  setVolume: (v: number) => void;
  /** Retry the availability probe now (tap-to-retry in the widget row). */
  reprobe: () => void;
  /** The playlist widget opened/closed — opening re-probes an
      unavailable theme and keeps retrying on backoff while open. */
  setWidgetOpen: (open: boolean) => void;
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
  const probeRef       = useRef<ThemeProbe | null>(null);
  /* The <audio> element itself errored since the last ready flip —
     a successful re-probe must reload the element, not just relabel. */
  const elementErrored = useRef(false);
  const [snap,    setSnap]    = useState<ThemeProbeSnapshot>({ status: "probing", checking: false });
  const status = snap.status;
  const [playFailed, setPlayFailed] = useState(false);
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
      .then(() => { setPlaying(true); setMuted(false); setPlayFailed(false); attachThemeAnalyser(audio); })
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

    audio.addEventListener("error", () => {
      elementErrored.current = true;
      probeRef.current?.reportElementError();
    });

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
        .then(() => { setPlaying(true); setMuted(false); setPlayFailed(false); attachThemeAnalyser(a); removeUnlock(); })
        .catch(() => {});
    };
    document.addEventListener("click",      unlock);
    document.addEventListener("keydown",    unlock);
    document.addEventListener("touchstart", unlock, { passive: true });

    /*
     * Availability lives in ThemeProbe (lib/theme-probe.ts): the boot
     * probe below is only the FIRST attempt. A failure is no longer
     * terminal for the session — the widget re-probes on open and on
     * backoff, and the row offers tap-to-retry (see BowDownAIGuide).
     */
    const probe = new ThemeProbe({
      head: () => fetch(AUDIO_SRC, { method: "HEAD" }).then((r) => r.ok),
      onChange: (s) => {
        setSnap(s);
        /* Probe says the track is back but the element previously
           errored: reload it so a fresh fetch replaces the dead one. */
        if (s.status === "ready" && elementErrored.current) {
          elementErrored.current = false;
          audio.load();
        }
      },
      /* Attempt 1: unmuted autoplay (works after any prior user gesture).
         tryAutoplay no-ops anywhere but the public area. */
      onReady: () => tryAutoplay(),
    });
    probeRef.current = probe;
    probe.start();

    return () => {
      removeUnlock();
      probe.dispose();
      probeRef.current = null;
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
      /* Muted videos (banner loops, ambient hero clips) make no sound —
         ducking the theme for them just causes skipping. Only duck for
         media the user can actually hear. */
      const other = e.target as HTMLMediaElement | null;
      if (other && other.muted) return;
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
      /* Don't resume the theme inside the logged-in app — it's a
         public-area feature. */
      if (!isPublicAreaRef.current) { pausedByMedia.current = false; return; }

      /* Check no other media element is still playing */
      const stillPlaying = Array.from(
        document.querySelectorAll<HTMLMediaElement>("audio, video")
      ).some((el) => el !== audio && !el.paused && !el.ended);

      if (stillPlaying) return;

      pausedByMedia.current = false;
      audio.muted  = false;
      audio.volume = audioRef.current?.volume ?? 0.65;
      audio.play()
        .then(() => { setPlaying(true); setMuted(false); setPlayFailed(false); attachThemeAnalyser(audio); })
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
      /* Honest state: claim "playing" only once playback actually
         starts. A rejection (autoplay policy, decode, network) used to
         be swallowed while the UI claimed playing — now it flips
         playFailed so the row can show it and the user can retry. */
      setPlayFailed(false);
      void attemptPlay(audio).then((ok) => {
        if (ok) {
          setPlaying(true);
          attachThemeAnalyser(audio);
        } else {
          setPlaying(false);
          setPlayFailed(true);
        }
      });
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
      setPlayFailed(false);
      void attemptPlay(audio).then((ok) => {
        if (ok) {
          setPlaying(true);
          attachThemeAnalyser(audio);
        } else {
          setPlayFailed(true);
        }
      });
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

  /* ── Availability retries (widget-driven) ── */
  const reprobe = useCallback(() => {
    probeRef.current?.reprobe();
  }, []);

  const setWidgetOpen = useCallback((open: boolean) => {
    probeRef.current?.setWatching(open);
  }, []);

  return (
    <Ctx.Provider value={{
      status, checking: snap.checking, playFailed, playing, muted, volume,
      togglePlay, toggleMute, setVolume, reprobe, setWidgetOpen,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useThemePlayer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemePlayer must be inside ThemePlayerProvider");
  return ctx;
}
