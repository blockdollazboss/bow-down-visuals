import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Film, Volume2, ListVideo,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine } from "@/lib/editor-settings";

/* ── helpers ─────────────────────────────────────── */

/** Parse "0:05-0:10" → duration in seconds. Defaults to 5. */
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

/* ── types ───────────────────────────────────────── */

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

/* ── component ───────────────────────────────────── */

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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Refs mirror state so event callbacks never see stale values */
  const modeRef = useRef<PreviewMode>("timeline");
  const sceneIdxRef = useRef(0);
  const playingRef = useRef(false);
  modeRef.current = mode;
  sceneIdxRef.current = sceneIdx;
  playingRef.current = playing;

  /* Derived values */
  const durations = scenes.map((s) => parseSceneDuration(s.timestamp));
  const startOffsets = durations.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : (acc[i - 1] ?? 0) + (durations[i - 1] ?? 5));
    return acc;
  }, []);
  const totalDuration =
    (startOffsets[scenes.length - 1] ?? 0) + (durations[scenes.length - 1] ?? 0);
  const timelineTime = (startOffsets[sceneIdx] ?? 0) + sceneLocalTime;
  const currentScene = scenes[sceneIdx];
  const hasClip = !!currentScene?.demoClipUrl;
  const sceneDuration = durations[sceneIdx] ?? 5;

  const activeLine =
    captionLines.find((l) => l.startSec <= timelineTime && timelineTime < l.endSec) ?? null;

  /* Muted callback ref — muting via attribute is unreliable in some browsers */
  const setVideoRefCb = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* Advance to next scene or stop */
  function advanceScene() {
    const curMode = modeRef.current;
    const curIdx = sceneIdxRef.current;
    if (curMode === "timeline" && curIdx < scenes.length - 1) {
      setSceneIdx(curIdx + 1);
      /* sceneLocalTime reset + video play handled by the sceneIdx effect below */
    } else {
      setPlaying(false);
      setSceneLocalTime(0);
    }
  }

  /* When sceneIdx changes while playing, start the new scene */
  useEffect(() => {
    setSceneLocalTime(0);
    if (!playingRef.current) return;
    const scene = scenes[sceneIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.currentTime = 0;
      void videoRef.current.play().catch(() => {});
    }
    /* If no clip, the timer effect below picks up because playing && !hasClip */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdx]);

  /* JS timer for placeholder (no-clip) scenes */
  useEffect(() => {
    if (playing && !hasClip) {
      timerRef.current = setInterval(() => {
        setSceneLocalTime((t) => parseFloat((t + 0.1).toFixed(1)));
      }, 100);
      return () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      };
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, hasClip, sceneIdx]);

  /* Detect end of placeholder scene */
  useEffect(() => {
    if (!playing || hasClip) return;
    if (sceneLocalTime >= sceneDuration) {
      advanceScene();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneLocalTime]);

  /* ── control helpers ── */

  function doPlay() {
    setPlaying(true);
    if (hasClip && videoRef.current) {
      videoRef.current.muted = true;
      void videoRef.current.play().catch(() => setPlaying(false));
    }
  }

  function doPause() {
    setPlaying(false);
    if (videoRef.current) videoRef.current.pause();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function startTimeline() {
    setMode("timeline");
    setSceneIdx(0);
    setSceneLocalTime(0);
    setPlaying(true);
    if (scenes[0]?.demoClipUrl && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.currentTime = 0;
      void videoRef.current.play().catch(() => {});
    }
  }

  function startScenePreview() {
    setMode("scene");
    setSceneIdx(initialIdx);
    setSceneLocalTime(0);
    setPlaying(true);
    if (scenes[initialIdx]?.demoClipUrl && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.currentTime = 0;
      void videoRef.current.play().catch(() => {});
    }
  }

  function jumpToScene(i: number) {
    setSceneIdx(i);
    setSceneLocalTime(0);
    if (playing) {
      const scene = scenes[i];
      if (scene?.demoClipUrl && videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.currentTime = 0;
        void videoRef.current.play().catch(() => {});
      }
    }
  }

  /* ── caption overlay style ── */
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
      ? "top-3 items-start"
      : captionSettings?.position === "Center"
        ? "top-1/2 -translate-y-1/2 items-center"
        : "bottom-6 items-end";

  /* ── render ── */
  return (
    <div
      className="rounded-xl border border-primary/20 bg-[#080808] overflow-hidden"
      data-testid="timeline-preview-player"
    >
      {/* Preview area */}
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
            data-testid="timeline-preview-video"
          />
        ) : (
          /* Placeholder card for scenes without clips */
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#0f0a00] to-[#050505]">
            <div className="h-16 w-16 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center">
              <Film className="h-7 w-7 text-white/20" />
            </div>
            <div className="text-center px-6">
              <p className="text-sm font-bold text-white/40">
                {currentScene?.section || `Scene ${sceneIdx + 1}`}
              </p>
              {currentScene?.lyricLine && (
                <p className="text-xs text-white/20 mt-1 italic">
                  &ldquo;{currentScene.lyricLine}&rdquo;
                </p>
              )}
              <p className="text-[10px] text-white/15 mt-2">No clip generated yet</p>
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
          <div className={`absolute left-0 right-0 px-4 flex flex-col justify-center pointer-events-none ${posClass}`}>
            <div
              className="text-center inline-block mx-auto max-w-[90%] leading-snug"
              data-testid="timeline-caption-text"
              style={captionStyle}
            >
              {activeLine.text}
            </div>
          </div>
        )}

        {/* Scene badge — top left */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 border border-white/10 backdrop-blur-sm">
          <Film className="h-3 w-3 text-primary/60" />
          <span className="text-[10px] font-bold text-white/70">
            Scene {sceneIdx + 1}/{scenes.length}
            {currentScene?.section ? ` · ${currentScene.section}` : ""}
          </span>
        </div>

        {/* Active badge — top right */}
        {playing && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">
              {mode === "timeline" ? "Timeline Preview Active" : "Scene Preview Active"}
            </span>
          </div>
        )}

        {/* Big play button when paused */}
        {!playing && (
          <button
            type="button"
            onClick={doPlay}
            className="absolute inset-0 flex items-center justify-center"
            aria-label="Play preview"
          >
            <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors backdrop-blur-sm">
              <Play className="h-6 w-6 text-primary ml-0.5" />
            </div>
          </button>
        )}
      </div>

      {/* Controls */}
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

        {/* Playback controls row */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="preview-restart-btn"
            title="Restart"
            onClick={() => { setSceneIdx(mode === "scene" ? initialIdx : 0); setSceneLocalTime(0); if (!playing) setPlaying(true); else doPlay(); }}
            className="p-1.5 rounded text-white/40 hover:text-white/70 transition-colors"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="preview-play-pause-btn"
            onClick={playing ? doPause : doPlay}
            aria-label={playing ? "Pause" : "Play"}
            className="p-1.5 rounded text-white/70 hover:text-white transition-colors"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            data-testid="preview-next-scene-btn"
            title="Next scene"
            onClick={() => jumpToScene(Math.min(scenes.length - 1, sceneIdx + 1))}
            disabled={sceneIdx >= scenes.length - 1}
            className="p-1.5 rounded text-white/40 hover:text-white/70 disabled:opacity-20 transition-colors"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          {/* Progress bar */}
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full"
              style={{ width: `${totalDuration > 0 ? Math.min(100, (timelineTime / totalDuration) * 100) : 0}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-white/30 shrink-0">
            {fmt(timelineTime)}
          </span>
        </div>

        {/* Status messages */}
        <div className="space-y-1 text-[10px]">
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
            <span className="text-white/25">
              Playing Scene {sceneIdx + 1} of {scenes.length}
            </span>
          </div>

          {activeLine ? (
            <div className="text-primary/70 font-medium truncate" data-testid="timeline-current-caption">
              Current caption: {activeLine.text}
            </div>
          ) : captionLines.length > 0 && playing ? (
            <div className="text-white/20">No caption at {fmt(timelineTime)}</div>
          ) : null}

          <div className="flex items-center justify-between text-white/20">
            <span>Current time: {fmt(timelineTime)}</span>
            <span>Scene: {fmt(sceneLocalTime)} / {fmt(sceneDuration)}</span>
          </div>

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
            <button
              key={s.id}
              type="button"
              onClick={() => jumpToScene(i)}
              data-testid={`timeline-scene-pill-${i}`}
              title={s.section || `Scene ${i + 1}`}
              className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-all ${
                i === sceneIdx
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-white/[0.08] bg-white/[0.02] text-white/30 hover:text-white/60"
              }`}
            >
              <span>{s.section || `#${i + 1}`}</span>
              {!s.demoClipUrl && (
                <span className="text-white/20 text-[8px]">no clip</span>
              )}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
