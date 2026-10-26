import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  useCallback, type ReactNode,
} from "react";
import { recordPlay, resolveMedia, type MediaKind, type StreamTrack } from "@/lib/streaming";
import {
  StemPlaybackEngine, fetchTrackStemPlayback, normalizeStemDescriptors,
  initialStemMix, type StemDescriptor, type StemMixState,
} from "@/lib/stems-player";

/* ─── Site-wide streaming audio player (Worker 2) ───
   One HTMLAudioElement lives in this provider, mounted above the router in
   AppShell, so playback survives page navigation. Queue persists to
   localStorage. Video pages use native <video> separately — only audio
   queue items run through here.
   Media-neutral: songs, podcast episodes, DJ mixes, voiceovers — any audio. */

export interface QueueItem {
  kind: MediaKind;
  id: string;
  title: string;
  artistName: string;
  artwork: string | null;
  src: string; // resolved playable audio URL
  /** N14 Stems Player — stems this track carries (keys + labels only,
      never URLs). undefined = unknown (the provider probes the
      playback endpoint when the item becomes current); null = known
      to carry none; an array = exactly those stems exist. */
  stems?: StemDescriptor[] | null;
}

interface PlayerCtx {
  current: QueueItem | null;
  queue: QueueItem[];
  index: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  queueOpen: boolean;
  setQueueOpen: (v: boolean) => void;
  playItems: (items: QueueItem[], startIndex?: number) => void;
  addToQueue: (item: QueueItem) => void;
  playNext: (item: QueueItem) => void;
  removeFromQueue: (i: number) => void;
  clearQueue: () => void;
  next: () => void;
  prev: () => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  /* N14 Stems Player: the ACTIVE item's stems (null whenever the
     current track carries none or stem mode isn't running — controls
     render only from this, so absence is honest), the fan's mix, and
     the mute/solo toggles (gain-only; they never restart playback). */
  stems: StemDescriptor[] | null;
  stemMix: StemMixState;
  toggleStemMute: (key: string) => void;
  toggleStemSolo: (key: string) => void;
}

const Ctx = createContext<PlayerCtx | null>(null);

const QUEUE_KEY = "bdv_stream_queue";
const VOL_KEY = "bdv_stream_volume";

export function trackToQueueItem(t: StreamTrack, artistName: string): QueueItem {
  return {
    kind: "track",
    id: String(t.id),
    title: t.title ?? "Untitled",
    artistName,
    artwork: t.artwork_url,
    src: resolveMedia(t.audio_url),
    /* From the track DETAIL payload this is known exactly (array or
       null); normalizeStemDescriptors returns null for no stems. */
    stems: normalizeStemDescriptors(t.stems),
  };
}

export function useStreamingPlayer(): PlayerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStreamingPlayer must be used inside StreamingPlayerProvider");
  return ctx;
}

/** Non-throwing hook for components that may render outside the provider. */
export function useStreamingPlayerOptional(): PlayerCtx | null {
  return useContext(Ctx);
}

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q) => q && q.id && q.src && q.title);
  } catch {
    return [];
  }
}

export function StreamingPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /* N14 Stems Player: when the current track carries stems, a
     StemPlaybackEngine (one element per stem, kept in sync) replaces
     the single master element as the playback source. */
  const stemEngineRef = useRef<StemPlaybackEngine | null>(null);
  const stemActiveRef = useRef(false);
  const stemRunRef = useRef(0);
  const volumeRef = useRef(0.8);
  const mutedRef = useRef(false);
  const [stemStems, setStemStems] = useState<StemDescriptor[] | null>(null);
  const [stemMix, setStemMix] = useState<StemMixState>({});

  const [queue, setQueue] = useState<QueueItem[]>(() => loadQueue());
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(VOL_KEY));
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8;
    } catch {
      return 0.8;
    }
  });
  const [queueOpen, setQueueOpen] = useState(false);

  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  /** Shared end-of-item advance (master element + stem engine). */
  const advanceAfterEnded = useCallback(() => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (i + 1 < q.length) {
      indexRef.current = i + 1;
      setIndex(i + 1);
    } else {
      setPlaying(false);
    }
  }, []);
  const advanceRef = useRef(advanceAfterEnded);
  advanceRef.current = advanceAfterEnded;

  const teardownStemEngine = useCallback(() => {
    stemRunRef.current += 1;
    stemEngineRef.current?.dispose();
    stemEngineRef.current = null;
    stemActiveRef.current = false;
    setStemStems(null);
    setStemMix({});
  }, []);

  /* Create the single audio element once. */
  useEffect(() => {
    const el = new Audio();
    el.preload = "metadata";
    el.volume = volume;
    audioRef.current = el;
    const onTime = () => setCurrentTime(el.currentTime);
    const onDur = () => setDuration(el.duration || 0);
    const onEnded = () => advanceRef.current();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.pause();
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Persist queue (never playback position). */
  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, 200)));
    } catch { /* quota — drop silently */ }
  }, [queue]);

  /* Swap the audio source whenever the current item changes. */
  const current = queue[index] ?? null;
  const currentKey = current ? `${current.kind}:${current.id}` : null;
  const playedRef = useRef<string | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!current || !current.src) {
      teardownStemEngine();
      el.pause();
      setPlaying(false);
      return;
    }
    if (playedRef.current === currentKey) return;
    playedRef.current = currentKey;
    teardownStemEngine();
    setCurrentTime(0);
    setDuration(0);
    const startMaster = () => {
      el.src = current.src;
      el.load();
      recordPlay(current.kind, current.id);
      el.play().catch(() => setPlaying(false));
    };
    /* N14: a track that carries stems plays through the stem engine
       (all stems together, fan mix on gains). Known-none (stems ===
       null) and non-tracks go straight to the master element; an
       unknown/array stem set probes the playback endpoint first and
       falls back to the master when no playable stems come back. */
    if (current.kind !== "track" || current.stems === null) {
      startMaster();
      return;
    }
    const run = stemRunRef.current;
    fetchTrackStemPlayback(current.id).then((playable) => {
      if (run !== stemRunRef.current || playedRef.current !== currentKey) return;
      if (playable.length === 0) { startMaster(); return; }
      el.pause();
      const mix = initialStemMix(playable);
      const engine = new StemPlaybackEngine(undefined, {
        onTime: (t) => setCurrentTime(t),
        onDuration: (d) => setDuration(d),
        onEnded: () => advanceRef.current(),
        onPlayState: (p) => setPlaying(p),
      });
      stemEngineRef.current = engine;
      stemActiveRef.current = true;
      setStemStems(playable.map(({ key, label }) => ({ key, label })));
      setStemMix(mix);
      engine.setMasterVolume(volumeRef.current, mutedRef.current);
      engine.load(playable, mix);
      recordPlay(current.kind, current.id);
      void engine.play();
    }).catch(() => { if (run === stemRunRef.current) startMaster(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const playItems = useCallback((items: QueueItem[], startIndex = 0) => {
    if (!items.length) return;
    const i = Math.max(0, Math.min(startIndex, items.length - 1));
    setQueue(items);
    setIndex(i);
    queueRef.current = items;
    indexRef.current = i;
  }, []);

  const addToQueue = useCallback((item: QueueItem) => {
    setQueue((q) => {
      const next = [...q, item];
      queueRef.current = next;
      return next;
    });
  }, []);

  const playNext = useCallback((item: QueueItem) => {
    setQueue((q) => {
      const at = indexRef.current;
      const next = [...q.slice(0, at + 1), item, ...q.slice(at + 1)];
      queueRef.current = next;
      return next;
    });
  }, []);

  const removeFromQueue = useCallback((i: number) => {
    setQueue((q) => {
      const next = q.filter((_, j) => j !== i);
      queueRef.current = next;
      const at = indexRef.current;
      if (i < at) {
        indexRef.current = at - 1;
        setIndex(at - 1);
      } else if (i === at && next.length === 0) {
        playedRef.current = null;
      }
      if (indexRef.current >= next.length) {
        indexRef.current = Math.max(0, next.length - 1);
        setIndex(Math.max(0, next.length - 1));
      }
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    queueRef.current = [];
    setIndex(0);
    indexRef.current = 0;
    playedRef.current = null;
    teardownStemEngine();
    audioRef.current?.pause();
  }, [teardownStemEngine]);

  const next = useCallback(() => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (i + 1 < q.length) {
      indexRef.current = i + 1;
      setIndex(i + 1);
    }
  }, []);

  const prev = useCallback(() => {
    const engine = stemActiveRef.current ? stemEngineRef.current : null;
    const el = audioRef.current;
    const pos = engine ? engine.currentTime : (el?.currentTime ?? 0);
    // Restart within the first 3s; otherwise go to the previous item.
    if (pos > 3) {
      if (engine) engine.seek(0);
      else if (el) el.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const i = indexRef.current;
    if (i > 0) {
      indexRef.current = i - 1;
      setIndex(i - 1);
    } else if (engine) {
      engine.seek(0);
      setCurrentTime(0);
    } else if (el) {
      el.currentTime = 0;
      setCurrentTime(0);
    }
  }, []);

  const play = useCallback(() => {
    if (stemActiveRef.current && stemEngineRef.current) { void stemEngineRef.current.play(); return; }
    audioRef.current?.play().catch(() => {});
  }, []);
  const pause = useCallback(() => {
    if (stemActiveRef.current && stemEngineRef.current) { stemEngineRef.current.pause(); return; }
    audioRef.current?.pause();
  }, []);
  const toggle = useCallback(() => {
    if (stemActiveRef.current && stemEngineRef.current) {
      const engine = stemEngineRef.current;
      if (engine.playing) engine.pause();
      else void engine.play();
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const seek = useCallback((t: number) => {
    if (stemActiveRef.current && stemEngineRef.current) {
      stemEngineRef.current.seek(t);
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(t, el.duration || t));
    setCurrentTime(el.currentTime);
  }, []);

  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(1, v));
    setVolumeState(c);
    volumeRef.current = c;
    if (audioRef.current) audioRef.current.volume = c;
    try { localStorage.setItem(VOL_KEY, String(c)); } catch { /* noop */ }
    let m = mutedRef.current;
    if (c > 0 && m) {
      m = false;
      mutedRef.current = false;
      if (audioRef.current) audioRef.current.muted = false;
      setMuted(false);
    }
    stemEngineRef.current?.setMasterVolume(c, m);
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    const el = audioRef.current;
    if (el) el.muted = nextMuted;
    stemEngineRef.current?.setMasterVolume(volumeRef.current, nextMuted);
    setMuted(nextMuted);
  }, []);

  /* Stem mix toggles: update state + gains on the live engine.
     Gain-only — playback position and play state are never touched. */
  const toggleStemMute = useCallback((key: string) => {
    setStemMix((prev) => {
      const next = { ...prev, [key]: { solo: prev[key]?.solo ?? false, muted: !(prev[key]?.muted ?? false) } };
      stemEngineRef.current?.applyMix(next);
      return next;
    });
  }, []);

  const toggleStemSolo = useCallback((key: string) => {
    setStemMix((prev) => {
      const next = { ...prev, [key]: { muted: prev[key]?.muted ?? false, solo: !(prev[key]?.solo ?? false) } };
      stemEngineRef.current?.applyMix(next);
      return next;
    });
  }, []);

  const value = useMemo<PlayerCtx>(() => ({
    current, queue, index, playing, currentTime, duration, volume, muted,
    queueOpen, setQueueOpen,
    playItems, addToQueue, playNext, removeFromQueue, clearQueue,
    next, prev, toggle, play, pause, seek, setVolume, toggleMute,
    stems: stemStems, stemMix, toggleStemMute, toggleStemSolo,
  }), [current, queue, index, playing, currentTime, duration, volume, muted,
      queueOpen, playItems, addToQueue, playNext, removeFromQueue, clearQueue,
      next, prev, toggle, play, pause, seek, setVolume, toggleMute,
      stemStems, stemMix, toggleStemMute, toggleStemSolo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
