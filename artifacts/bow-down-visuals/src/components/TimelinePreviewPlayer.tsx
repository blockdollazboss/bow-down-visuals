/**
 * TimelinePreviewPlayer — v4 "single-interval" architecture
 *
 * One setInterval runs for the lifetime of the component.
 * On every tick it checks playingRef.current — if false, it returns
 * immediately (no-op).  If true, it advances currentTime by 0.1s and
 * calls setCurrentTime().  Everything else (scene index, caption line)
 * is derived from currentTime in the render; no separate state for
 * those values.
 *
 * Audio and video are controlled imperatively in the button handlers,
 * never in effects — effects can fire at the wrong time, imperatively
 * calling .play()/.pause() at the moment the user clicks is always
 * correct.
 *
 * Fullscreen uses requestFullscreen() on the whole container div (not
 * the <video> element) so the HTML caption overlay stays visible.
 */
import {
  useState, useEffect, useRef, useCallback,
  type CSSProperties,
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
    const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
    return e > s ? e - s : 5;
  }
  return 5;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Cumulative start times for each scene. */
function buildOffsets(durs: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of durs) { out.push(acc); acc += d; }
  return out;
}

/** Which scene should be active at time t? */
function sceneAt(t: number, offsets: number[], durs: number[]): number {
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (t >= offsets[i] && t < offsets[i] + durs[i]) return i;
  }
  // t is past the last scene's end — stay on last
  return Math.max(0, offsets.length - 1);
}

/* ─── types ───────────────────────────────────────────────────── */

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
}

/* ─── component ───────────────────────────────────────────────── */

export function TimelinePreviewPlayer({
  scenes,
  captionLines,
  audioUrl,
  initialSceneId,
  captionSettings,
}: TimelinePreviewPlayerProps) {

  /* ── Scene timing (recomputed each render — pure) ── */
  const durs    = scenes.map(s => parseDur(s.timestamp));
  const offsets = buildOffsets(durs);
  const totalDur = durs.reduce((a, b) => a + b, 0);

  /* ── Single source of truth: currentTime ── */
  const [currentTime,  setCurrentTime ] = useState(0);
  const [playing,      setPlaying     ] = useState(false);
  const [audioReady,   setAudioReady  ] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [lastError,    setLastError   ] = useState<string | null>(null);
  const [debugOpen,    setDebugOpen   ] = useState(false);
  const [tickCount,    setTickCount   ] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [burnPreview,  setBurnPreview ] = useState(false);
  /** In "scene" mode only one scene plays; in "timeline" all scenes play */
  const [mode,         setMode        ] = useState<"timeline" | "scene">("timeline");
  /** Timeline stops at this time (totalDur in timeline mode, scene-end in scene mode) */
  const [stopAt,       setStopAt      ] = useState(Infinity);

  /* ── Derived (pure, from state — no extra state needed) ── */
  const sceneIdx    = mode === "timeline"
    ? sceneAt(currentTime, offsets, durs)
    : Math.max(0, scenes.findIndex(s => s.id === initialSceneId));
  const currentScene = scenes[sceneIdx];
  const hasClip      = !!currentScene?.demoClipUrl;
  const activeLine   = captionLines.find(
    l => l.startSec <= currentTime && currentTime < l.endSec,
  ) ?? null;

  /* ── Refs ─────────────────────────────────────────────────── */
  const currentTimeRef = useRef(0);
  const playingRef     = useRef(false);
  const stopAtRef      = useRef(Infinity);
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const videoRef       = useRef<HTMLVideoElement | null>(null);
  const containerRef   = useRef<HTMLDivElement | null>(null);

  /* Sync state → refs on every render so the interval always sees fresh values */
  currentTimeRef.current = currentTime;
  playingRef.current     = playing;
  stopAtRef.current      = stopAt;

  /* ── Stable video callback ref (inline fn would cycle on every render) ── */
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* ── ONE interval — runs for the entire life of the component ──
     It checks playingRef.current; if false it's a no-op.
     This avoids all the start/stop interval management bugs.        */
  useEffect(() => {
    const id = setInterval(() => {
      if (!playingRef.current) return;

      /* Advance by 0.1 s using functional update to always get latest value */
      setCurrentTime(prev => {
        const next = parseFloat((prev + 0.1).toFixed(1));
        currentTimeRef.current = next;

        if (next >= stopAtRef.current) {
          /* End of timeline / scene — stop */
          playingRef.current = false;
          setPlaying(false);
          setAudioPlaying(false);
          if (audioRef.current) audioRef.current.pause();
          return stopAtRef.current;
        }
        return next;
      });

      setTickCount(t => t + 1);
    }, 100);

    return () => clearInterval(id);
  }, []); // ← empty deps: created once, never recreated

  /* ── Video: play clip when scene changes or playback starts ── */
  const prevSceneIdxRef = useRef(-1);
  useEffect(() => {
    const changed = sceneIdx !== prevSceneIdxRef.current;
    prevSceneIdxRef.current = sceneIdx;
    if (!playing) return;         // don't auto-play if we're paused
    if (!changed && playing) return; // only handle scene-change, not every re-render
    const scene = scenes[sceneIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip ${sceneIdx + 1}: ${e.message}`));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdx, playing]);

  /* ── Fullscreen change tracking ── */
  useEffect(() => {
    const onFSChange = () => setIsFullscreen(
      document.fullscreenElement === containerRef.current,
    );
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  /* ── Audio readiness ── */
  useEffect(() => { setAudioReady(!!audioUrl); }, [audioUrl]);

  /* ── Pause audio when component unmounts ── */
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  /* ─── Control functions ────────────────────────────────────── */

  /** Start or restart the full timeline from t=0 */
  function startTimeline() {
    const stop = totalDur > 0 ? totalDur : 300; // fallback 5 min if no duration info
    stopAtRef.current = stop;
    currentTimeRef.current = 0;
    playingRef.current = true;

    setCurrentTime(0);
    setStopAt(stop);
    setMode("timeline");
    setPlaying(true);
    setLastError(null);

    /* Audio — seek to 0 and play */
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = 0;
      audioRef.current
        .play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio: ${e.message}`));
    }

    /* Video — play first scene clip if available */
    const firstScene = scenes[0];
    if (firstScene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip 1: ${e.message}`));
    }
  }

  /** Play only the selected scene */
  function startScenePreview() {
    const idx   = Math.max(0, scenes.findIndex(s => s.id === initialSceneId));
    const start = offsets[idx] ?? 0;
    const end   = start + (durs[idx] ?? 5);

    stopAtRef.current = end;
    currentTimeRef.current = start;
    playingRef.current = true;

    setCurrentTime(start);
    setStopAt(end);
    setMode("scene");
    setPlaying(true);
    setLastError(null);

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = start;
      audioRef.current
        .play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio: ${e.message}`));
    }

    const scene = scenes[idx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip: ${e.message}`));
    }
  }

  function pauseTimeline() {
    playingRef.current = false;
    setPlaying(false);
    audioRef.current?.pause();
    setAudioPlaying(false);
    videoRef.current?.pause();
  }

  function resumeTimeline() {
    if (currentTimeRef.current >= stopAtRef.current) return;
    playingRef.current = true;
    setPlaying(true);

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = currentTimeRef.current;
      audioRef.current
        .play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio: ${e.message}`));
    }
    if (hasClip && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.play().catch((e: Error) => setLastError(`Clip: ${e.message}`));
    }
  }

  function jumpToScene(i: number) {
    const newTime = offsets[i] ?? 0;
    currentTimeRef.current = newTime;
    setCurrentTime(newTime);
    setMode("timeline");

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = newTime;
      if (playing) {
        audioRef.current.play().then(() => setAudioPlaying(true)).catch(() => {});
      }
    }
    const scene = scenes[i];
    if (playing && scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current.requestFullscreen();
    }
  }

  /* ─── Caption style ─────────────────────────────────────────── */

  const capStyleOverlay: CSSProperties = {
    fontSize: "clamp(14px,3vw,22px)", fontWeight: 800,
    color: captionSettings?.textColor || "#fff",
    background: captionSettings?.background ? "rgba(0,0,0,0.72)" : "transparent",
    textShadow: captionSettings?.outline
      ? "0 0 8px #000,1px 1px 0 #000,-1px -1px 0 #000"
      : "0 2px 8px rgba(0,0,0,0.9)",
    padding: "0.2rem 0.75rem", borderRadius: "0.4rem", letterSpacing: "0.01em",
  };

  const capStyleBurn: CSSProperties = {
    fontSize: "clamp(14px,3vw,22px)", fontWeight: 900,
    color: captionSettings?.textColor || "#fff",
    background: "rgba(0,0,0,0.85)",
    textShadow: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000",
    padding: "0.25rem 0.9rem", borderRadius: "0.3rem",
    letterSpacing: "0.02em", border: "1px solid rgba(255,255,255,0.08)",
  };

  const capStyle = burnPreview ? capStyleBurn : capStyleOverlay;
  const posClass =
    captionSettings?.position === "Top"     ? "top-3"
    : captionSettings?.position === "Center" ? "top-1/2 -translate-y-1/2"
    : "bottom-6";

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
      {/* Hidden audio element — plays continuously across scene changes */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onCanPlayThrough={() => setAudioReady(true)}
          onEnded={() => { setAudioPlaying(false); setPlaying(false); }}
        />
      )}

      {/* ── Preview area ─────────────────────────────────────── */}
      <div className={`relative bg-black ${isFullscreen ? "flex-1 min-h-0" : "aspect-video"}`}>

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
            <p className="text-sm font-bold text-white/40 text-center px-4">
              {currentScene?.section || `Scene ${sceneIdx + 1}`}
            </p>
            {currentScene?.lyricLine && (
              <p className="text-xs text-white/20 italic text-center px-6 max-w-xs">
                &ldquo;{currentScene.lyricLine}&rdquo;
              </p>
            )}
            {playing && (
              <p className="font-mono text-[11px] text-primary/60">
                {fmt(currentTime - (offsets[sceneIdx] ?? 0))} / {fmt(durs[sceneIdx] ?? 5)}
              </p>
            )}
          </div>
        )}

        {/* Caption overlay — visible in normal view AND custom fullscreen */}
        {activeLine && (
          <div className={`absolute left-0 right-0 px-4 flex justify-center pointer-events-none ${posClass}`}>
            {burnPreview && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-black text-amber-400/70 uppercase tracking-widest whitespace-nowrap">
                burn preview
              </div>
            )}
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
          title={isFullscreen ? "Exit fullscreen" : "Custom fullscreen (captions stay visible)"}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 border border-white/10 text-white/50 hover:text-white/90 hover:bg-black/80 transition-colors backdrop-blur-sm"
        >
          {isFullscreen
            ? <Minimize className="h-3.5 w-3.5" />
            : <Maximize className="h-3.5 w-3.5" />}
        </button>

        {/* Playing badge */}
        {playing && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">
              {mode === "scene" ? "Scene Preview" : "Timeline Active"}
            </span>
          </div>
        )}

        {/* Overlay play button (shown when paused) */}
        {!playing && (
          <button
            type="button"
            onClick={resumeTimeline}
            className="absolute inset-0 flex items-center justify-center"
            aria-label="Resume"
          >
            <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors backdrop-blur-sm">
              <Play className="h-6 w-6 text-primary ml-0.5" />
            </div>
          </button>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────── */}
      <div className={`px-4 py-3 border-t border-white/[0.05] space-y-3 ${isFullscreen ? "overflow-y-auto max-h-64 shrink-0" : ""}`}>

        {/* Caption overlay note */}
        {!isFullscreen && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[10px] text-white/35 leading-relaxed">
            <Info className="h-3 w-3 shrink-0 mt-0.5 text-white/25" />
            <span>
              Captions are <strong className="text-white/50">HTML overlays</strong> — visible here and in{" "}
              <button type="button" onClick={toggleFullscreen} className="text-primary/60 underline hover:text-primary transition-colors">
                Custom Fullscreen ↗
              </button>
              . Browser native fullscreen hides overlays.
              To burn captions into the exported file, use the <strong className="text-white/50">Export</strong> tab.
            </span>
          </div>
        )}

        {/* Primary: Preview Timeline / Preview Scene */}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="preview-timeline-btn"
            onClick={startTimeline}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "timeline" && playing
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
            }`}
          >
            <ListVideo className="h-3.5 w-3.5" /> Preview Timeline
          </button>
          <button
            type="button"
            data-testid="preview-scene-btn"
            onClick={startScenePreview}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "scene" && playing
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
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
            title={isFullscreen ? "Exit fullscreen" : "Custom fullscreen"}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              isFullscreen
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
            }`}
          >
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Burn caption preview toggle */}
        <button
          type="button"
          onClick={() => setBurnPreview(b => !b)}
          title="See how captions will look when burned into the final video"
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
            <strong className="text-white/40">Picture-in-Picture</strong> cannot show HTML caption overlays (browser limitation).
            Use Custom Fullscreen, or burn captions into the exported video via the Export tab.
          </span>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full transition-none"
              style={{ width: `${stopAt > 0 && isFinite(stopAt) ? Math.min(100, currentTime / stopAt * 100) : 0}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-white/30 shrink-0 w-[84px] text-right">
            {fmt(currentTime)} / {fmt(isFinite(stopAt) ? stopAt : totalDur)}
          </span>
        </div>

        {/* Audio status */}
        <div className="flex items-center gap-1.5 text-[10px]">
          {audioUrl ? (
            <span className={`flex items-center gap-1.5 ${audioPlaying ? "text-blue-400/70" : "text-white/30"}`}>
              <Volume2 className="h-3 w-3 shrink-0" />
              {audioPlaying
                ? "Audio playing — does not restart between scenes"
                : `Audio ${audioReady ? "ready" : "loading…"} — starts when Preview Timeline begins`}
            </span>
          ) : (
            <span className="text-white/20 flex items-center gap-1.5">
              <Volume2 className="h-3 w-3 shrink-0" />
              No audio selected — timeline plays silently
            </span>
          )}
        </div>

        {/* Error */}
        {lastError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400 font-mono break-all">
            ⚠ {lastError}
          </div>
        )}

        {/* Scene pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpToScene(i)}
              data-testid={`timeline-scene-pill-${i}`}
              className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-all ${
                i === sceneIdx
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-white/[0.08] bg-white/[0.02] text-white/30 hover:text-white/60"
              }`}
            >
              <span>{s.section || `#${i + 1}`}</span>
              {!s.demoClipUrl && <span className="text-white/20 text-[8px]">no clip</span>}
            </button>
          ))}
        </div>

        {/* ── Status / Debug panel ── */}
        <div className="border border-white/[0.07] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setDebugOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors"
          >
            <span>Timeline Preview Status</span>
            {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {debugOpen && (
            <div className="px-3 pb-3 space-y-0.5 font-mono text-[10px] border-t border-white/[0.06]">
              <DR label="timer ticks"     v={String(tickCount)} hi={playing} />
              <DR label="playing"         v={playing ? "YES" : "no"} hi={playing} />
              <DR label="mode"            v={mode} />
              <DR label="current time"    v={`${currentTime.toFixed(1)}s`} hi={playing} />
              <DR label="stop at"         v={`${isFinite(stopAt) ? stopAt.toFixed(1) : "∞"}s`} />
              <DR label="total duration"  v={`${totalDur.toFixed(1)}s`} />
              <DR label="total scenes"    v={String(scenes.length)} />
              <DR label="current scene"   v={`${sceneIdx + 1}/${scenes.length} · "${currentScene?.section || "—"}" · ${fmt(offsets[sceneIdx] ?? 0)}–${fmt((offsets[sceneIdx] ?? 0) + (durs[sceneIdx] ?? 5))}`} />
              <DR label="has clip"        v={hasClip ? "yes" : "no"} />
              <DR label="total captions"  v={String(captionLines.length)} />
              <DR label="audio loaded"    v={audioReady ? "yes" : audioUrl ? "loading…" : "no"} />
              <DR label="audio playing"   v={audioPlaying ? "YES" : "no"} hi={audioPlaying} />
              <DR label="current caption" v={
                activeLine
                  ? `"${activeLine.text.slice(0, 40)}" (${activeLine.startSec.toFixed(1)}–${activeLine.endSec.toFixed(1)}s)`
                  : captionLines.length > 0
                    ? `none at ${currentTime.toFixed(1)}s`
                    : "no captions loaded"
              } hi={!!activeLine} />
              <DR label="scene offsets"   v={offsets.map(o => `${o.toFixed(0)}s`).join(" · ")} />
              <DR label="last error"      v={lastError ?? "none"} err={!!lastError} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/* ─── Debug row ───────────────────────────────────────────────── */
function DR({
  label, v, hi, err,
}: { label: string; v: string; hi?: boolean; err?: boolean }) {
  return (
    <div className="flex gap-2 pt-0.5">
      <span className="text-white/25 shrink-0 w-[130px]">{label}:</span>
      <span className={err ? "text-red-400" : hi ? "text-primary/80" : "text-white/50"}>{v}</span>
    </div>
  );
}
