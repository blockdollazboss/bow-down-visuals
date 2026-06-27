/**
 * TimelinePreviewPlayer — v5 "audio-as-master-clock"
 *
 * The AUDIO ELEMENT is the master clock.
 * - audio.ontimeupdate fires ~4× per second while audio plays
 * - We read audio.currentTime and derive EVERYTHING from it:
 *     sceneIdx  = which scene is active right now
 *     activeLine = which caption line is active right now
 * - No setInterval, no rAF, no separate timer state
 * - Audio never restarts between scenes; it runs straight through
 *
 * Fallback: if no audioUrl is provided, a setInterval ticks at 100ms
 * so scenes and captions still advance silently.
 *
 * Scene durations: if all timestamps parse to the 5s default AND
 * audioDuration is known, scenes are distributed evenly across the song.
 */
import {
  useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle,
  type CSSProperties, type RefObject,
} from "react";
import {
  Play, Pause, SkipBack, Film, Volume2, ListVideo,
  ChevronDown, ChevronUp, Maximize, Minimize, Info, Eye, Tv2,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine } from "@/lib/editor-settings";

/* ─── helpers ─────────────────────────────────────────────────── */

function parseDur(ts: string | null | undefined): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1] * 60 + +m[2];
    const e = +m[3] * 60 + +m[4];
    return e > s ? e - s : 5;
  }
  return 5;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function buildOffsets(durs: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of durs) { out.push(acc); acc += d; }
  return out;
}

/** Return index of the active scene for time t using cumulative offsets + durations. */
function sceneAt(t: number, offsets: number[], durs: number[]): number {
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (t >= offsets[i]) return i;
  }
  return 0;
}

/* ─── component ───────────────────────────────────────────────── */

/** State broadcast to the parent after every audio tick so Live Preview can mirror it */
export interface SharedPreviewState {
  isPlaying: boolean;
  currentTime: number;
  audioDuration: number | null;
  activeSceneIndex: number;
  activeCaption: CaptionLine | null;
}

/** Imperative handle exposed via ref so the master player can control audio */
export interface TimelinePlayerHandle {
  /** Toggle play/pause — resumes from current position or starts from 0 */
  togglePlay: () => void;
  /** Restart playback from the beginning */
  restart: () => void;
  /** Seek to ~1s before the given scene's boundary and play through its transition. */
  previewTransition: (sceneIndex: number) => void;
}

export interface TimelinePreviewPlayerProps {
  scenes: SceneData[];
  captionLines: CaptionLine[];
  audioUrl?: string | null;
  initialSceneId?: string | null;
  captionSettings?: {
    textColor?: string;
    background?: boolean;
    outline?: boolean;
    position?: string;
    fontSize?: string;
  };
  /** Called after each audio tick so the parent can mirror state in the Live Preview panel */
  onEngineUpdate?: (state: SharedPreviewState) => void;
  /** When provided, TimelinePreviewPlayer drives this external video element instead of
   *  rendering its own preview area. Pass liveVideoRef from the master player so the
   *  single video element at the top always shows the active clip. */
  externalVideoRef?: RefObject<HTMLVideoElement | null>;
  /** When set, TLP writes the departing clip's src here before switching the main video. */
  outgoingVideoRef?: RefObject<HTMLVideoElement | null>;
  /** Fired after a scene switch while playing. Receives (oldSceneIdx, newSceneIdx). */
  onSceneChange?: (oldIdx: number, newIdx: number) => void;
}

export const TimelinePreviewPlayer = forwardRef<TimelinePlayerHandle, TimelinePreviewPlayerProps>(
function TimelinePreviewPlayer({
  scenes,
  captionLines,
  audioUrl,
  initialSceneId,
  captionSettings,
  onEngineUpdate,
  externalVideoRef,
  outgoingVideoRef,
  onSceneChange,
}: TimelinePreviewPlayerProps, ref) {

  /* ── Core state ── */
  const [currentTime,   setCurrentTime  ] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [playing,       setPlaying      ] = useState(false);
  const [audioReady,    setAudioReady   ] = useState(false);
  const [audioPlaying,  setAudioPlaying ] = useState(false);
  const [lastError,     setLastError    ] = useState<string | null>(null);
  const [needsUserTap,  setNeedsUserTap ] = useState(false); // autoplay blocked
  const [debugOpen,     setDebugOpen    ] = useState(false);
  const [isFullscreen,  setIsFullscreen ] = useState(false);
  const [burnPreview,   setBurnPreview  ] = useState(false);
  const [mode,          setMode         ] = useState<"timeline" | "scene">("timeline");

  /* ── Scene timing ─────────────────────────────────────────────
     If every scene has the 5-second default duration (meaning no
     real timestamps were set) AND we know the audio duration, we
     distribute the audio duration evenly across all scenes.      */
  const rawDurs  = scenes.map(s => parseDur(s.timestamp));
  const allDefaultDurs = rawDurs.length > 0 && rawDurs.every(d => d === 5);

  const durs: number[] = (allDefaultDurs && audioDuration != null && audioDuration > 0)
    ? scenes.map(() => audioDuration / scenes.length)
    : rawDurs;

  const offsets  = buildOffsets(durs);
  const totalDur = durs.reduce((a, b) => a + b, 0);

  /* ── Derived from currentTime (no extra state) ── */
  const sceneIdx    = mode === "timeline"
    ? sceneAt(currentTime, offsets, durs)
    : Math.max(0, scenes.findIndex(s => s.id === initialSceneId));
  const currentScene = scenes[sceneIdx];
  const hasClip      = !!currentScene?.demoClipUrl;
  const activeLine   = captionLines.find(
    l => l.startSec <= currentTime && currentTime < l.endSec,
  ) ?? null;

  /* ── Stable ref for onEngineUpdate — avoids stale closure issues ── */
  const onEngineUpdateRef = useRef(onEngineUpdate);
  onEngineUpdateRef.current = onEngineUpdate;

  /* ── Broadcast shared engine state after every meaningful change ──
     Fires when playing, currentTime, audioDuration, sceneIdx, or activeLine changes.
     LivePreviewPanel reads this to mirror scenes/captions/time without a second audio element. */
  useEffect(() => {
    onEngineUpdateRef.current?.({
      isPlaying: playing,
      currentTime,
      audioDuration,
      activeSceneIndex: sceneIdx,
      activeCaption: activeLine ?? null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentTime, audioDuration, sceneIdx, activeLine?.id]);

  /* ── Refs ── */
  const audioRef         = useRef<HTMLAudioElement | null>(null);
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  // Use the parent-provided ref when given (so the master player's <video> is the target)
  // otherwise fall back to an internal ref for standalone rendering.
  const videoRef: RefObject<HTMLVideoElement | null> = externalVideoRef ?? internalVideoRef;
  const containerRef  = useRef<HTMLDivElement | null>(null);
  const playingRef    = useRef(false);      // for the no-audio fallback interval
  const currentTimeRef = useRef(0);
  const totalDurRef   = useRef(totalDur);
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  playingRef.current    = playing;
  currentTimeRef.current = currentTime;
  totalDurRef.current   = totalDur;

  /* ── Stable video callback ref ── */
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* ── No-audio fallback: setInterval when no audioUrl ── */
  useEffect(() => {
    if (audioUrl) return; // audio is the clock when audioUrl is present
    if (!playing) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setCurrentTime(prev => {
        const next = parseFloat((prev + 0.1).toFixed(1));
        currentTimeRef.current = next;
        if (next >= totalDurRef.current) {
          playingRef.current = false;
          setPlaying(false);
          return totalDurRef.current;
        }
        return next;
      });
    }, 100);
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [playing, audioUrl]);

  /* ── Video: restart clip when scene index changes while playing ── */
  const prevSceneIdxRef = useRef(-999);
  useEffect(() => {
    if (!playing) return;
    if (sceneIdx === prevSceneIdxRef.current) return;
    const prevIdx = prevSceneIdxRef.current;
    prevSceneIdxRef.current = sceneIdx;

    // Copy departing clip to outgoing video BEFORE switching the main ref.
    if (prevIdx >= 0 && outgoingVideoRef?.current && videoRef.current?.src) {
      const og = outgoingVideoRef.current;
      og.src = videoRef.current.src;
      og.currentTime = videoRef.current.currentTime;
      og.muted = true;
      og.play().catch(() => { /* silent — outgoing video is decorative */ });
    }

    const scene = scenes[sceneIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      // Always set src imperatively — required when using externalVideoRef
      // because the external <video> element doesn't get a src via React props.
      v.src = scene.demoClipUrl;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip ${sceneIdx + 1}: ${e.message}`));
    }

    // Notify parent so it can trigger CSS transition.
    if (prevIdx >= 0) {
      onSceneChange?.(prevIdx, sceneIdx);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdx, playing]);

  /* ── Fullscreen tracking ── */
  useEffect(() => {
    const onFSChange = () => setIsFullscreen(
      document.fullscreenElement === containerRef.current,
    );
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => {
    audioRef.current?.pause();
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  /* ─── Audio event handlers ────────────────────────────────── */

  /** This is the master clock tick — fires ~4× per second while audio plays */
  function onTimeUpdate() {
    const t = audioRef.current?.currentTime ?? 0;
    setCurrentTime(t);
    currentTimeRef.current = t;
  }

  function onAudioEnded() {
    setPlaying(false);
    setAudioPlaying(false);
  }

  function onLoadedMetadata() {
    const dur = audioRef.current?.duration;
    if (dur && isFinite(dur)) setAudioDuration(dur);
    setAudioReady(true);
  }

  function onCanPlayThrough() {
    setAudioReady(true);
  }

  function onAudioError() {
    const err = audioRef.current?.error;
    const msg = err ? `Audio load error (code ${err.code}): ${err.message}` : "Audio failed to load";
    setLastError(msg);
  }

  /* ─── Control functions ────────────────────────────────────── */

  function doAudioPlay(fromTime = 0): void {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.currentTime = fromTime;
    const p = audio.play();
    p.then(() => {
      setAudioPlaying(true);
      setNeedsUserTap(false);
      setLastError(null);
    }).catch((e: Error) => {
      if (e.name === "NotAllowedError") {
        setNeedsUserTap(true);
        setLastError("Autoplay blocked by browser. Tap the button below to start.");
      } else {
        setLastError(`Audio playback failed: ${e.message}`);
      }
    });
  }

  function startTimeline() {
    setMode("timeline");
    setLastError(null);
    setNeedsUserTap(false);
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setPlaying(true);
    prevSceneIdxRef.current = -999; // force video effect to fire for scene 0

    doAudioPlay(0);

    // If no audio, interval handles the clock (via the useEffect above)
    // Start first scene's clip
    const firstScene = scenes[0];
    if (firstScene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.src = firstScene.demoClipUrl; // set src imperatively (required for externalVideoRef)
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip 1: ${e.message}`));
    }
  }

  /** Called when the user taps the "Tap to Start" button after autoplay is blocked */
  function tapToStart() {
    setNeedsUserTap(false);
    doAudioPlay(currentTimeRef.current);
  }

  function startScenePreview() {
    const idx   = Math.max(0, scenes.findIndex(s => s.id === initialSceneId));
    const start = offsets[idx] ?? 0;

    setMode("scene");
    setLastError(null);
    setNeedsUserTap(false);
    setCurrentTime(start);
    currentTimeRef.current = start;
    setPlaying(true);
    prevSceneIdxRef.current = -999;

    doAudioPlay(start);

    const scene = scenes[idx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.src = scene.demoClipUrl; // set src imperatively (required for externalVideoRef)
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip: ${e.message}`));
    }
  }

  function pauseTimeline() {
    setPlaying(false);
    audioRef.current?.pause();
    setAudioPlaying(false);
    videoRef.current?.pause();
  }

  function resumeTimeline() {
    setPlaying(true);
    doAudioPlay(currentTimeRef.current);
    if (hasClip && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
    }
  }

  function jumpToScene(i: number) {
    const newTime = offsets[i] ?? 0;
    setCurrentTime(newTime);
    currentTimeRef.current = newTime;
    setMode("timeline");
    prevSceneIdxRef.current = -999;
    if (playing) doAudioPlay(newTime);
    else if (audioRef.current) audioRef.current.currentTime = newTime;
  }

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current.requestFullscreen();
  }

  /** Seek ~1s before a scene boundary and play so its transition renders. */
  function previewTransition(sceneIndex: number) {
    const boundary = offsets[sceneIndex] ?? 0;
    const start = Math.max(0, boundary - 1);
    setMode("timeline");
    setLastError(null);
    setNeedsUserTap(false);
    setCurrentTime(start);
    currentTimeRef.current = start;
    setPlaying(true);
    // Force the scene-change effect to fire as playback crosses into sceneIndex.
    prevSceneIdxRef.current = -999;
    doAudioPlay(start);

    const startIdx = sceneAt(start, offsets, durs);
    const scene = scenes[startIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.src = scene.demoClipUrl;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip: ${e.message}`));
    }
  }

  /* ─── Imperative handle for master player ─────────────────── */
  useImperativeHandle(ref, () => ({
    togglePlay() {
      if (playing) {
        pauseTimeline();
      } else if (currentTimeRef.current > 0) {
        resumeTimeline();
      } else {
        startTimeline();
      }
    },
    restart: startTimeline,
    previewTransition,
  }));

  /* ─── Caption style ─────────────────────────────────────────── */

  const capStyleOverlay: CSSProperties = {
    fontSize: "clamp(14px,3vw,22px)", fontWeight: 800,
    color: captionSettings?.textColor || "#fff",
    background: captionSettings?.background ? "rgba(0,0,0,0.72)" : "transparent",
    textShadow: captionSettings?.outline
      ? "0 0 8px #000,1px 1px 0 #000,-1px -1px 0 #000"
      : "0 2px 8px rgba(0,0,0,0.9)",
    padding: "0.2rem 0.75rem", borderRadius: "0.4rem",
  };

  const capStyleBurn: CSSProperties = {
    fontSize: "clamp(14px,3vw,22px)", fontWeight: 900,
    color: captionSettings?.textColor || "#fff",
    background: "rgba(0,0,0,0.85)",
    textShadow: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000",
    padding: "0.25rem 0.9rem", borderRadius: "0.3rem", letterSpacing: "0.02em",
    border: "1px solid rgba(255,255,255,0.08)",
  };

  const capStyle = burnPreview ? capStyleBurn : capStyleOverlay;
  const posClass =
    captionSettings?.position === "Top"     ? "top-3"
    : captionSettings?.position === "Center" ? "top-1/2 -translate-y-1/2"
    : "bottom-6";

  const effectiveDur = audioDuration ?? (isFinite(totalDur) && totalDur > 0 ? totalDur : null);

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? "bg-[#080808] flex flex-col w-full h-full overflow-hidden"
          : "rounded-xl border border-primary/20 bg-[#080808] overflow-hidden"
      }
    >
      {/* Hidden audio element — IS the master clock */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onCanPlayThrough={onCanPlayThrough}
          onEnded={onAudioEnded}
          onError={onAudioError}
          onPlay={() => setAudioPlaying(true)}
          onPause={() => setAudioPlaying(false)}
        />
      )}

      {/* ── Preview area — hidden when externalVideoRef is provided ──────
           When externalVideoRef is set the parent (MasterPreviewPlayer) owns
           the <video> element and displays it at the top. We only render the
           audio engine + controls, not a second preview area here.          */}
      {!externalVideoRef && <div
        className={`relative bg-black ${isFullscreen ? "flex-1 min-h-0" : "aspect-video"}`}
      >
        {hasClip ? (
          <video
            ref={setVideoEl}
            key={currentScene?.demoClipUrl}
            src={currentScene?.demoClipUrl ?? undefined}
            playsInline
            loop={false}
            className="w-full h-full object-contain"
            onError={(e) => {
              const code = (e.currentTarget as HTMLVideoElement).error?.code ?? "?";
              setLastError(`Video error scene ${sceneIdx + 1}: code ${code}`);
            }}
            data-testid="timeline-preview-video"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#0f0a00] to-[#050505]">
            <div className="h-16 w-16 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center">
              <Film className="h-7 w-7 text-white/20" />
            </div>
            <p className="text-sm font-bold text-white/50">
              Scene {sceneIdx + 1}: {currentScene?.section || "—"}
            </p>
            {currentScene?.lyricLine && (
              <p className="text-xs text-white/25 italic text-center px-6 max-w-xs">
                &ldquo;{currentScene.lyricLine}&rdquo;
              </p>
            )}
            {playing && (
              <p className="font-mono text-[11px] text-primary/50">
                {fmt(currentTime - (offsets[sceneIdx] ?? 0))} / {fmt(durs[sceneIdx] ?? 5)}
              </p>
            )}
            <p className="text-[10px] text-white/20">No clip — audio and captions still playing</p>
          </div>
        )}

        {/* Caption overlay */}
        {activeLine && (
          <div
            className={`absolute left-0 right-0 px-4 flex justify-center pointer-events-none ${posClass}`}
          >
            <div
              style={capStyle}
              className="text-center leading-snug max-w-[90%]"
              data-testid="timeline-caption-text"
            >
              {activeLine.text}
            </div>
          </div>
        )}

        {/* Scene badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/70 border border-white/10 backdrop-blur-sm">
          <Film className="h-3 w-3 text-primary/60" />
          <span className="text-[10px] font-bold text-white/70">
            Scene {sceneIdx + 1}/{scenes.length}
            {currentScene?.section ? ` · ${currentScene.section}` : ""}
          </span>
        </div>

        {/* Fullscreen toggle */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 border border-white/10 text-white/50 hover:text-white/90 hover:bg-black/80 transition-colors backdrop-blur-sm"
        >
          {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </button>

        {/* Playing indicator */}
        {playing && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">
              {mode === "scene" ? "Scene Preview" : "Timeline Active"}
            </span>
          </div>
        )}

        {/* Overlay play button when stopped */}
        {!playing && !needsUserTap && (
          <button
            type="button"
            onClick={currentTime > 0 ? resumeTimeline : startTimeline}
            className="absolute inset-0 flex items-center justify-center"
            aria-label="Start preview"
          >
            <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors backdrop-blur-sm">
              <Play className="h-6 w-6 text-primary ml-0.5" />
            </div>
          </button>
        )}

        {/* Tap-to-start overlay — shown when autoplay is blocked */}
        {needsUserTap && (
          <button
            type="button"
            onClick={tapToStart}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm"
            data-testid="tap-to-start-btn"
          >
            <div className="h-16 w-16 rounded-full bg-primary/20 border-2 border-primary/60 flex items-center justify-center hover:bg-primary/30 transition-colors">
              <Volume2 className="h-7 w-7 text-primary" />
            </div>
            <p className="text-sm font-black text-white">Tap to Start Timeline Preview</p>
            <p className="text-xs text-white/40 text-center max-w-xs px-4">
              Browser blocked autoplay. Tap anywhere on this area to start audio.
            </p>
          </button>
        )}
      </div>}

      {/* ── Controls ─────────────────────────────────────────── */}
      <div
        className={`px-4 py-3 border-t border-white/[0.05] space-y-3 ${isFullscreen ? "overflow-y-auto max-h-64 shrink-0" : ""}`}
      >
        {/* Caption overlay info */}
        {!isFullscreen && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[10px] text-white/35 leading-relaxed">
            <Info className="h-3 w-3 shrink-0 mt-0.5 text-white/25" />
            <span>
              Captions are <strong className="text-white/50">HTML overlays</strong> — visible in normal view and{" "}
              <button type="button" onClick={toggleFullscreen} className="text-primary/60 underline hover:text-primary transition-colors">
                Custom Fullscreen ↗
              </button>.
              Browser native fullscreen hides overlays. To embed them permanently, use the <strong className="text-white/50">Export</strong> tab.
            </span>
          </div>
        )}

        {/* Primary buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="preview-timeline-btn"
            onClick={startTimeline}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold border transition-colors ${
              mode === "timeline" && playing
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.04] text-white/60 hover:text-white/90 hover:border-white/20"
            }`}
          >
            <ListVideo className="h-3.5 w-3.5" /> Preview Timeline
          </button>
          <button
            type="button"
            data-testid="preview-scene-btn"
            onClick={startScenePreview}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold border transition-colors ${
              mode === "scene" && playing
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.04] text-white/60 hover:text-white/90 hover:border-white/20"
            }`}
          >
            <Film className="h-3.5 w-3.5" /> Preview Scene
          </button>
        </div>

        {/* Playback row */}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="preview-restart-btn"
            onClick={startTimeline}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80 transition-colors"
          >
            <SkipBack className="h-3.5 w-3.5" /> Restart
          </button>
          <button
            type="button"
            data-testid="preview-pause-btn"
            onClick={playing ? pauseTimeline : resumeTimeline}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80 transition-colors"
          >
            {playing
              ? <><Pause className="h-3.5 w-3.5" /> Pause Timeline</>
              : <><Play  className="h-3.5 w-3.5" /> Resume Timeline</>}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              isFullscreen
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
            }`}
          >
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Burn preview toggle */}
        <button
          type="button"
          onClick={() => setBurnPreview(b => !b)}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
            burnPreview
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/60"
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          {burnPreview ? "Showing: Burned-In Caption Style" : "Preview Burned-In Caption Style"}
        </button>

        {/* PiP warning */}
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[10px] text-white/30 leading-relaxed">
          <Tv2 className="h-3 w-3 shrink-0 mt-0.5 text-white/20" />
          <span>
            <strong className="text-white/40">Picture-in-Picture</strong> cannot show HTML captions (browser limitation).
            Use Custom Fullscreen or burn captions into the export.
          </span>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full transition-none"
              style={{
                width: effectiveDur && effectiveDur > 0
                  ? `${Math.min(100, (currentTime / effectiveDur) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <span className="text-[10px] font-mono text-white/30 shrink-0 w-[90px] text-right">
            {fmt(currentTime)} / {effectiveDur ? fmt(effectiveDur) : "--:--"}
          </span>
        </div>

        {/* Audio status */}
        <div className="flex items-start gap-1.5 text-[10px]">
          {audioUrl ? (
            <span className={`flex items-center gap-1.5 ${audioPlaying ? "text-blue-400/80" : "text-white/30"}`}>
              <Volume2 className="h-3 w-3 shrink-0 mt-0.5" />
              {audioPlaying
                ? "Audio playing — continuous across all scenes"
                : audioReady
                  ? "Audio ready — click Preview Timeline to start"
                  : "Audio loading…"}
            </span>
          ) : (
            <span className="text-amber-400/70 flex items-start gap-1.5">
              <Volume2 className="h-3 w-3 shrink-0 mt-0.5" />
              <span>
                <strong className="text-amber-300/90">No song audio found.</strong>{" "}
                Go to the <strong className="text-amber-300/90">Music</strong> tab, upload your song, then click{" "}
                <strong className="text-amber-300/90">"Use Song In Final Video"</strong>. Captions are still playing via timer.
              </span>
            </span>
          )}
        </div>

        {/* Error display */}
        {lastError && !needsUserTap && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400 font-mono break-all">
            ⚠ {lastError}
          </div>
        )}

        {/* Scene pills — clicking jumps the audio clock */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpToScene(i)}
              data-testid={`timeline-scene-pill-${i}`}
              title={`Jump to ${fmt(offsets[i] ?? 0)}`}
              className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-all ${
                i === sceneIdx
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-white/[0.08] bg-white/[0.02] text-white/30 hover:text-white/60"
              }`}
            >
              <span>{s.section || `#${i + 1}`}</span>
              <span className="text-white/20 text-[8px]">{fmt(offsets[i] ?? 0)}</span>
              {!s.demoClipUrl && <span className="text-white/15 text-[8px]">no clip</span>}
            </button>
          ))}
        </div>

        {/* ── Debug panel ── */}
        <div className="border border-white/[0.07] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setDebugOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors"
          >
            <span>Timeline Debug</span>
            {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {debugOpen && (
            <div className="px-3 pb-3 space-y-0.5 font-mono text-[10px] border-t border-white/[0.06]">
              <DR label="previewMode"         v={mode} />
              <DR label="audio URL/path"      v={audioUrl ? "found ✓" : "MISSING — no song set"} hi={!!audioUrl} err={!audioUrl} />
              <DR label="audio loaded"        v={audioReady ? "yes" : audioUrl ? "loading…" : "no"} hi={audioReady} />
              <DR label="audio playing"       v={audioPlaying ? "YES" : "no"} hi={audioPlaying} />
              <DR label="audio currentTime"   v={`${currentTime.toFixed(2)}s`} hi={playing} />
              <DR label="audio duration"      v={audioDuration != null ? `${audioDuration.toFixed(2)}s` : "unknown"} />
              <DR label="scene timing"        v={allDefaultDurs && audioDuration != null ? "evenly distributed" : "from timestamps"} />
              <DR label="scenes loaded"       v={String(scenes.length)} />
              <DR label="active scene index"  v={String(sceneIdx)} />
              <DR label="active scene title"  v={currentScene?.section || "—"} />
              <DR label="scene range"         v={`${fmt(offsets[sceneIdx] ?? 0)}–${fmt((offsets[sceneIdx] ?? 0) + (durs[sceneIdx] ?? 5))}`} />
              <DR label="has clip"            v={hasClip ? "yes" : "no clip — placeholder shown"} />
              <DR label="captions loaded"     v={String(captionLines.length)} />
              <DR label="active caption"      v={
                activeLine
                  ? `"${activeLine.text.slice(0, 50)}" (${activeLine.startSec.toFixed(1)}–${activeLine.endSec.toFixed(1)}s)`
                  : captionLines.length > 0
                    ? `none at ${currentTime.toFixed(1)}s`
                    : "no captions loaded"
              } hi={!!activeLine} />
              <DR label="scene offsets"       v={offsets.map(o => fmt(o)).join(" · ")} />
              <DR label="needs user tap"      v={needsUserTap ? "YES — autoplay blocked" : "no"} err={needsUserTap} />
              <DR label="last error"          v={lastError ?? "none"} err={!!lastError} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
});

/* ─── Debug row ─────────────────────────────────────────────────── */
function DR({
  label, v, hi, err,
}: { label: string; v: string; hi?: boolean; err?: boolean }) {
  return (
    <div className="flex gap-2 pt-0.5">
      <span className="text-white/25 shrink-0 w-[150px]">{label}:</span>
      <span className={err ? "text-red-400" : hi ? "text-primary/80" : "text-white/50"}>{v}</span>
    </div>
  );
}
