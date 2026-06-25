import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Film, Volume2, ListVideo, ChevronDown, ChevronUp,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine } from "@/lib/editor-settings";

/* ── helpers ─────────────────────────────────────── */

function parseSceneDuration(timestamp: string): number {
  if (!timestamp) return 5;
  const m = timestamp.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = parseInt(m[1]) * 60 + parseInt(m[2]);
    const e = parseInt(m[3]) * 60 + parseInt(m[4]);
    return e > s ? e - s : 5;
  }
  return 5;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type PreviewMode = "scene" | "timeline";

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
  };
}

export function TimelinePreviewPlayer({
  scenes,
  captionLines,
  audioUrl,
  initialSceneId,
  captionSettings,
}: TimelinePreviewPlayerProps) {
  const initialIdx = Math.max(0, scenes.findIndex((s) => s.id === initialSceneId));

  const [mode, setMode] = useState<PreviewMode>("timeline");
  const [sceneIdx, setSceneIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sceneLocalTime, setSceneLocalTime] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Guards & mirrors — updated synchronously during render */
  const modeRef = useRef<PreviewMode>("timeline");
  const sceneIdxRef = useRef(0);
  const playingRef = useRef(false);
  const advancingRef = useRef(false);   // prevents simultaneous double-advance
  modeRef.current = mode;
  sceneIdxRef.current = sceneIdx;
  playingRef.current = playing;

  /* Derived values (recomputed each render) */
  const durations = scenes.map((s) => parseSceneDuration(s.timestamp));
  const startOffsets = durations.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : (acc[i - 1] ?? 0) + (durations[i - 1] ?? 5));
    return acc;
  }, []);
  const totalDuration = (startOffsets[scenes.length - 1] ?? 0) + (durations[scenes.length - 1] ?? 0);
  const timelineTime  = (startOffsets[sceneIdx] ?? 0) + sceneLocalTime;
  const currentScene  = scenes[sceneIdx];
  const hasClip       = !!currentScene?.demoClipUrl;
  const sceneDuration = durations[sceneIdx] ?? 5;

  const activeLine =
    captionLines.find((l) => l.startSec <= timelineTime && timelineTime < l.endSec) ?? null;

  /* Callback ref — forces muted attribute on (not just prop) */
  const setVideoRefCb = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* ── core advance logic ───────────────────────────────────────────── */

  function clearTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /**
   * Advance to the next scene (or stop at end).
   * Always clears the timer first to prevent the race condition where
   * the interval fires one extra tick and triggers a double-advance.
   */
  function advanceScene() {
    if (advancingRef.current) return;   // guard: only one advance at a time
    advancingRef.current = true;
    clearTimer();                        // stop the interval BEFORE any state change

    const curMode = modeRef.current;
    const curIdx  = sceneIdxRef.current;

    if (curMode === "timeline" && curIdx < scenes.length - 1) {
      setSceneIdx(curIdx + 1);
      // advancingRef is reset inside useEffect([sceneIdx]) after the new scene starts
    } else {
      // Reached end of timeline (or scene mode ended)
      setPlaying(false);
      setSceneLocalTime(0);
      advancingRef.current = false;
    }
  }

  /* ── effects ─────────────────────────────────────────────────────── */

  /**
   * When sceneIdx changes: reset local time, reset advance guard, start new scene.
   * This is the ONLY place that calls play() after a scene advance.
   */
  useEffect(() => {
    advancingRef.current = false;        // new scene ready — reset guard
    setSceneLocalTime(0);

    if (!playingRef.current) return;

    const scene = scenes[sceneIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => {
        setLastError(`play() failed on scene ${sceneIdx + 1}: ${e.message}`);
        setPlaying(false);
      });
    }
    // No-clip scenes: timer effect below will start automatically
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdx]);

  /**
   * Timer for no-clip placeholder scenes.
   * Advances sceneLocalTime by 0.1s every 100ms.
   * When the scene duration is reached, calls advanceScene() via setTimeout
   * (cannot call it inside the setState callback).
   */
  useEffect(() => {
    clearTimer();   // clear any existing timer whenever deps change

    if (!playing || hasClip) return;

    const dur = sceneDuration;  // captured at effect time; stable until effect re-runs
    timerRef.current = setInterval(() => {
      setSceneLocalTime((t) => {
        const next = parseFloat((t + 0.1).toFixed(1));
        if (next >= dur) {
          // Schedule advance outside of setState callback
          setTimeout(() => advanceScene(), 0);
          return dur;   // cap; advanceScene will reset to 0 via sceneIdx effect
        }
        return next;
      });
    }, 100);

    return clearTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, hasClip, sceneIdx]);

  /* ── control helpers ─────────────────────────────────────────────── */

  function doPlay() {
    setLastError(null);
    setPlaying(true);
    if (hasClip && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.play().catch((e: Error) => {
        setLastError(`play() failed: ${e.message}`);
        setPlaying(false);
      });
    }
  }

  function doPause() {
    clearTimer();
    setPlaying(false);
    if (videoRef.current) videoRef.current.pause();
  }

  function startTimeline() {
    setLastError(null);
    clearTimer();
    advancingRef.current = false;
    setMode("timeline");
    setSceneLocalTime(0);
    setPlaying(true);

    // If already at scene 0, useEffect([sceneIdx]) won't fire (no change).
    // Trigger play manually here.
    if (sceneIdxRef.current === 0) {
      const scene = scenes[0];
      if (scene?.demoClipUrl && videoRef.current) {
        const v = videoRef.current;
        v.muted = true;
        v.currentTime = 0;
        v.play().catch((e: Error) => setLastError(`play() failed: ${e.message}`));
      }
    }
    setSceneIdx(0);   // triggers useEffect([sceneIdx]) if not already 0
  }

  function startScenePreview() {
    setLastError(null);
    clearTimer();
    advancingRef.current = false;
    setMode("scene");
    setSceneLocalTime(0);
    setPlaying(true);
    setSceneIdx(initialIdx);
  }

  function restartCurrent() {
    setLastError(null);
    clearTimer();
    advancingRef.current = false;
    setSceneLocalTime(0);
    setPlaying(true);
    const target = mode === "scene" ? initialIdx : 0;
    setSceneIdx(target);
    if (videoRef.current && scenes[target]?.demoClipUrl) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`play() failed: ${e.message}`));
    }
  }

  function jumpToScene(i: number) {
    clearTimer();
    advancingRef.current = false;
    setSceneLocalTime(0);
    setSceneIdx(i);
  }

  /* ── caption style ────────────────────────────────────────────────── */

  const captionStyle: CSSProperties = {
    fontSize: "clamp(14px, 3vw, 20px)",
    fontWeight: 800,
    color: captionSettings?.textColor || "#ffffff",
    background: captionSettings?.background ? "rgba(0,0,0,0.72)" : "transparent",
    textShadow: captionSettings?.outline
      ? "0 0 8px rgba(0,0,0,1), 1px 1px 0 #000, -1px -1px 0 #000"
      : "0 2px 8px rgba(0,0,0,0.9)",
    letterSpacing: "0.01em",
    padding: "0.2rem 0.75rem",
    borderRadius: "0.4rem",
  };

  const posClass =
    captionSettings?.position === "Top"
      ? "top-3"
      : captionSettings?.position === "Center"
        ? "top-1/2 -translate-y-1/2"
        : "bottom-6";

  /* ── render ─────────────────────────────────────────────────────────── */
  return (
    <div className="rounded-xl border border-primary/20 bg-[#080808] overflow-hidden" data-testid="timeline-preview-player">

      {/* ── Preview area ── */}
      <div className="relative aspect-video bg-black">
        {hasClip ? (
          <video
            ref={setVideoRefCb}
            key={currentScene?.demoClipUrl}
            src={currentScene?.demoClipUrl ?? undefined}
            playsInline
            className="w-full h-full object-contain"
            onTimeUpdate={(e) => setSceneLocalTime(e.currentTarget.currentTime)}
            onEnded={advanceScene}
            onPlay={() => setPlaying(true)}
            onError={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              setLastError(`Video error on scene ${sceneIdx + 1}: code ${v.error?.code ?? "?"}`);
            }}
            data-testid="timeline-preview-video"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#0f0a00] to-[#050505]">
            <div className="h-16 w-16 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center">
              <Film className="h-7 w-7 text-white/20" />
            </div>
            <div className="text-center px-6">
              <p className="text-sm font-bold text-white/40">
                {currentScene?.section || `Scene ${sceneIdx + 1}`}
              </p>
              {currentScene?.lyricLine && (
                <p className="text-xs text-white/20 mt-1 italic">&ldquo;{currentScene.lyricLine}&rdquo;</p>
              )}
              <p className="text-[10px] text-white/15 mt-2">No clip generated — using timer</p>
            </div>
            {playing && (
              <p className="font-mono text-[11px] text-primary/40">
                {fmt(sceneLocalTime)} / {fmt(sceneDuration)}
              </p>
            )}
          </div>
        )}

        {/* Caption overlay */}
        {activeLine && (
          <div className={`absolute left-0 right-0 px-4 flex justify-center pointer-events-none ${posClass}`}>
            <div data-testid="timeline-caption-text" style={captionStyle} className="text-center leading-snug max-w-[90%]">
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

        {/* Active badge */}
        {playing && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">
              {mode === "timeline" ? "Timeline Preview Active" : "Scene Preview Active"}
            </span>
          </div>
        )}

        {/* Big play button */}
        {!playing && (
          <button type="button" onClick={doPlay} className="absolute inset-0 flex items-center justify-center" aria-label="Play">
            <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors backdrop-blur-sm">
              <Play className="h-6 w-6 text-primary ml-0.5" />
            </div>
          </button>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="px-4 py-3 border-t border-white/[0.05] space-y-3">

        {/* Mode buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="preview-scene-btn"
            onClick={startScenePreview}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "scene" && playing
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            Preview Scene
          </button>
          <button
            type="button"
            data-testid="preview-timeline-btn"
            onClick={startTimeline}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "timeline" && playing
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
            }`}
          >
            <ListVideo className="h-3.5 w-3.5" />
            Preview Timeline
          </button>
        </div>

        {/* Playback row */}
        <div className="flex items-center gap-2">
          <button type="button" data-testid="preview-restart-btn" title="Restart" onClick={restartCurrent}
            className="p-1.5 rounded text-white/40 hover:text-white/70 transition-colors">
            <SkipBack className="h-4 w-4" />
          </button>
          <button type="button" data-testid="preview-play-pause-btn"
            onClick={playing ? doPause : doPlay}
            aria-label={playing ? "Pause" : "Play"}
            className="p-1.5 rounded text-white/70 hover:text-white transition-colors">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button type="button" data-testid="preview-next-scene-btn" title="Next scene"
            onClick={() => jumpToScene(Math.min(scenes.length - 1, sceneIdx + 1))}
            disabled={sceneIdx >= scenes.length - 1}
            className="p-1.5 rounded text-white/40 hover:text-white/70 disabled:opacity-20 transition-colors">
            <SkipForward className="h-4 w-4" />
          </button>

          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary/70 rounded-full transition-none"
              style={{ width: `${totalDuration > 0 ? Math.min(100, (timelineTime / totalDuration) * 100) : 0}%` }} />
          </div>
          <span className="text-[10px] font-mono text-white/30 shrink-0">{fmt(timelineTime)}</span>
        </div>

        {/* Error banner */}
        {lastError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400 font-mono">
            ⚠ {lastError}
          </div>
        )}

        {/* Status row */}
        <div className="space-y-0.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span>
              {playing ? (
                <span className="text-primary font-bold" data-testid="timeline-status-active">
                  ◉ {mode === "timeline" ? "Timeline Preview Active" : "Scene Preview Active"}
                </span>
              ) : (
                <span className="text-white/35" data-testid="timeline-status-ready">
                  {mode === "timeline" ? "Timeline Preview ready" : "Scene Preview ready"}
                </span>
              )}
            </span>
            <span className="text-white/25">Scene {sceneIdx + 1} of {scenes.length}</span>
          </div>

          {activeLine && (
            <div className="text-primary/70 font-medium truncate" data-testid="timeline-current-caption">
              Current caption: {activeLine.text}
            </div>
          )}

          {audioUrl && (
            <div className="flex items-center gap-1 text-blue-400/50">
              <Volume2 className="h-2.5 w-2.5 shrink-0" />
              Timeline preview uses continuous song audio while scenes change.
            </div>
          )}
        </div>

        {/* Scene pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {scenes.map((s, i) => (
            <button key={s.id} type="button" onClick={() => jumpToScene(i)}
              data-testid={`timeline-scene-pill-${i}`}
              className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-all ${
                i === sceneIdx
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-white/[0.08] bg-white/[0.02] text-white/30 hover:text-white/60"
              }`}>
              <span>{s.section || `#${i + 1}`}</span>
              {!s.demoClipUrl && <span className="text-white/20 text-[8px]">no clip</span>}
            </button>
          ))}
        </div>

        {/* ── Debug / Status panel ── */}
        <div className="border border-white/[0.07] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setDebugOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors"
          >
            <span>Timeline Preview Status</span>
            {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {debugOpen && (
            <div className="px-3 pb-3 space-y-0.5 font-mono text-[10px] border-t border-white/[0.06]">
              <DebugRow label="scenes loaded"     value={String(scenes.length)} />
              <DebugRow label="captions loaded"   value={String(captionLines.length)} />
              <DebugRow label="audio loaded"       value={audioUrl ? "yes" : "no"} />
              <DebugRow label="preview mode"       value={mode} />
              <DebugRow label="playing"            value={playing ? "yes" : "no"} highlight={playing} />
              <DebugRow label="current scene"      value={`${sceneIdx + 1} of ${scenes.length} · ${currentScene?.section || "—"}`} />
              <DebugRow label="has clip"           value={hasClip ? "yes" : "no (timer mode)"} />
              <DebugRow label="scene duration"     value={`${sceneDuration.toFixed(1)}s (from timestamp: "${currentScene?.timestamp || "none"}")`} />
              <DebugRow label="scene local time"   value={`${sceneLocalTime.toFixed(1)}s`} highlight={playing} />
              <DebugRow label="timeline time"      value={`${timelineTime.toFixed(1)}s / ${totalDuration.toFixed(1)}s`} highlight={playing} />
              <DebugRow label="current caption"
                value={activeLine ? `"${activeLine.text}" (${activeLine.startSec.toFixed(1)}–${activeLine.endSec.toFixed(1)}s)` : "none"}
                highlight={!!activeLine}
              />
              <DebugRow label="last error"         value={lastError ?? "none"} error={!!lastError} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/* ── Small debug row component ─────────────────────────────────────── */
function DebugRow({
  label, value, highlight, error,
}: { label: string; value: string; highlight?: boolean; error?: boolean }) {
  return (
    <div className="flex gap-2 pt-0.5">
      <span className="text-white/25 shrink-0 min-w-[120px]">{label}:</span>
      <span className={error ? "text-red-400" : highlight ? "text-primary/80" : "text-white/50"}>
        {value}
      </span>
    </div>
  );
}
