/**
 * TimelinePreviewPlayer — auto-advance, caption-synced timeline preview.
 *
 * Architecture: one stable `setInterval` (started via useCallback + empty deps)
 * reads ALL live values from refs, never from stale closures.
 * React state is only for display (not for playback decisions).
 */
import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Film, Volume2, ListVideo,
  ChevronDown, ChevronUp,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine } from "@/lib/editor-settings";

/* ── helpers ─────────────────────────────────────────────────────── */

function parseSceneDuration(ts: string): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
    return e > s ? e - s : 5;
  }
  return 5;
}

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

type Mode = "scene" | "timeline";

export interface TimelinePreviewPlayerProps {
  scenes: SceneData[];
  captionLines: CaptionLine[];
  audioUrl?: string | null;
  initialSceneId?: string | null;
  captionSettings?: { textColor?: string; background?: boolean; outline?: boolean; position?: string };
}

/* ── component ─────────────────────────────────────────────────── */

export function TimelinePreviewPlayer({
  scenes, captionLines, audioUrl, initialSceneId, captionSettings,
}: TimelinePreviewPlayerProps) {
  const initialIdx = Math.max(0, scenes.findIndex((s) => s.id === initialSceneId));

  /* ── React state — display only ── */
  const [mode, setMode] = useState<Mode>("timeline");
  const [sceneIdx, setSceneIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sceneLocalTime, setSceneLocalTime] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(true);

  /* ── Refs — live values used inside callbacks, never stale ── */
  const scenesRef    = useRef(scenes);
  const modeRef      = useRef<Mode>("timeline");
  const sceneIdxRef  = useRef(0);
  const playingRef   = useRef(false);
  const advancingRef = useRef(false);          // prevents simultaneous double-advance
  const videoRef     = useRef<HTMLVideoElement | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Keep refs in sync — runs synchronously during every render */
  scenesRef.current  = scenes;
  modeRef.current    = mode;
  sceneIdxRef.current = sceneIdx;
  playingRef.current  = playing;

  /* Ref to the advance function so the timer can always call the latest version */
  const advanceFnRef = useRef<() => void>(() => {});

  /* ── Derived display values ─────────────────────────────────── */
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
  const activeLine    = captionLines.find(
    (l) => l.startSec <= timelineTime && timelineTime < l.endSec,
  ) ?? null;

  /* ── Muted callback ref (attribute alone is unreliable) ── */
  const setVideoRefCb = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* ── stopTimer ─────────────────────────────────────────────── */
  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /* ── startTimer — STABLE (empty deps). Reads everything from refs. ── */
  const startTimer = useCallback(() => {
    /* Always clear before starting so we never have two intervals */
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }

    timerRef.current = setInterval(() => {
      if (!playingRef.current || advancingRef.current) return;

      const idx   = sceneIdxRef.current;
      const scene = scenesRef.current[idx];
      if (!scene) return;

      const hasClipNow = !!scene.demoClipUrl;
      const dur        = parseSceneDuration(scene.timestamp);

      if (hasClipNow) {
        /* Clip scene — video drives sceneLocalTime via onTimeUpdate.
           We only check video.ended here as a fallback in case onEnded
           didn't fire (e.g. Runway clip ended before React wired it up). */
        const v = videoRef.current;
        if (v && v.ended && !advancingRef.current) {
          advanceFnRef.current(); // advance to next scene
        }
      } else {
        /* No-clip scene — drive timer ourselves */
        setSceneLocalTime((prev) => {
          const next = parseFloat((prev + 0.1).toFixed(1));
          if (next >= dur) {
            /* Can't call setState inside setState — use setTimeout(0) */
            setTimeout(() => advanceFnRef.current(), 0);
            return dur; // cap; will reset to 0 when next scene starts
          }
          return next;
        });
      }
    }, 100);
  }, [stopTimer]); // stopTimer is also stable

  /* ── advanceToNext — advance one scene or stop at end ─────── */
  function advanceToNext() {
    if (advancingRef.current) return;   // guard: only one advance at a time
    advancingRef.current = true;
    stopTimer();                         // stop current interval immediately

    const idx   = sceneIdxRef.current;
    const mode  = modeRef.current;
    const total = scenesRef.current.length;

    if (mode === "timeline" && idx < total - 1) {
      const nextIdx = idx + 1;
      sceneIdxRef.current = nextIdx;    // update ref immediately (before React batch)
      setSceneIdx(nextIdx);
      setSceneLocalTime(0);
      /* useEffect([sceneIdx]) will call startTimer() + play() for us */
    } else {
      /* End of timeline (or scene-mode finished) */
      advancingRef.current = false;
      playingRef.current   = false;
      setPlaying(false);
      setSceneLocalTime(0);
    }
  }

  /* Keep advanceFnRef current (so the interval always calls the latest) */
  advanceFnRef.current = advanceToNext;

  /* ── Effect: sceneIdx changed → start next scene ─────────── */
  useEffect(() => {
    if (!playingRef.current) return;

    advancingRef.current = false;       // advance complete; new scene ready
    setSceneLocalTime(0);

    const scene = scenesRef.current[sceneIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Video play failed (scene ${sceneIdx + 1}): ${e.message}`));
    }

    /* Restart the timer for the new scene */
    startTimer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdx, startTimer]); // startTimer is stable → no infinite loop

  /* ── Effect: cleanup on unmount ── */
  useEffect(() => () => stopTimer(), [stopTimer]);

  /* ── Control functions ──────────────────────────────────────── */

  function beginFrom(idx: number, newMode: Mode) {
    stopTimer();
    advancingRef.current = false;

    modeRef.current   = newMode;
    sceneIdxRef.current = idx;
    playingRef.current  = true;

    setMode(newMode);
    setPlaying(true);
    setLastError(null);
    setSceneLocalTime(0);

    const wasAlreadyAtIdx = sceneIdx === idx;
    setSceneIdx(idx);

    if (wasAlreadyAtIdx) {
      /* setSceneIdx(idx) won't trigger useEffect([sceneIdx]) when value is unchanged.
         Handle video play + timer start manually. */
      advancingRef.current = false;
      const scene = scenesRef.current[idx];
      if (scene?.demoClipUrl && videoRef.current) {
        const v = videoRef.current;
        v.muted = true;
        v.currentTime = 0;
        v.play().catch((e: Error) => setLastError(`Video play failed: ${e.message}`));
      }
      startTimer();
    }
    /* Otherwise useEffect([sceneIdx]) handles it */
  }

  const startTimeline    = () => beginFrom(0, "timeline");
  const startScenePreview = () => beginFrom(initialIdx, "scene");

  function doPause() {
    stopTimer();
    playingRef.current = false;
    setPlaying(false);
    if (videoRef.current) videoRef.current.pause();
  }

  function doResume() {
    setLastError(null);
    playingRef.current = true;
    setPlaying(true);
    if (hasClip && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.play().catch((e: Error) => setLastError(`Video play failed: ${e.message}`));
    }
    startTimer();
  }

  function restartCurrent() {
    beginFrom(modeRef.current === "scene" ? initialIdx : 0, modeRef.current);
  }

  function jumpToScene(i: number) {
    stopTimer();
    advancingRef.current = false;
    sceneIdxRef.current  = i;
    setSceneLocalTime(0);

    const wasAlready = sceneIdx === i;
    setSceneIdx(i);

    if (wasAlready && playingRef.current) {
      advancingRef.current = false;
      const scene = scenesRef.current[i];
      if (scene?.demoClipUrl && videoRef.current) {
        const v = videoRef.current;
        v.muted = true; v.currentTime = 0;
        v.play().catch((e: Error) => setLastError(e.message));
      }
      startTimer();
    }
  }

  /* ── Caption style ─────────────────────────────────────────── */
  const captionStyle: CSSProperties = {
    fontSize: "clamp(14px, 3vw, 20px)", fontWeight: 800,
    color: captionSettings?.textColor || "#ffffff",
    background: captionSettings?.background ? "rgba(0,0,0,0.72)" : "transparent",
    textShadow: captionSettings?.outline
      ? "0 0 8px rgba(0,0,0,1), 1px 1px 0 #000, -1px -1px 0 #000"
      : "0 2px 8px rgba(0,0,0,0.9)",
    letterSpacing: "0.01em", padding: "0.2rem 0.75rem", borderRadius: "0.4rem",
  };
  const posClass = captionSettings?.position === "Top" ? "top-3"
    : captionSettings?.position === "Center" ? "top-1/2 -translate-y-1/2"
    : "bottom-6";

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="rounded-xl border border-primary/20 bg-[#080808] overflow-hidden" data-testid="timeline-preview-player">

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
            onEnded={advanceToNext}
            onPlay={() => { playingRef.current = true; setPlaying(true); }}
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
            <div className="text-center px-6">
              <p className="text-sm font-bold text-white/40">
                {currentScene?.section || `Scene ${sceneIdx + 1}`}
              </p>
              {currentScene?.lyricLine && (
                <p className="text-xs text-white/20 mt-1 italic">&ldquo;{currentScene.lyricLine}&rdquo;</p>
              )}
              <p className="text-[10px] text-white/15 mt-2">No clip — timer-driven</p>
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
            <div data-testid="timeline-caption-text" style={captionStyle}
              className="text-center leading-snug max-w-[90%]">
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

        {/* Overlay play button — always shows; calls doResume to respect current mode */}
        {!playing && (
          <button type="button" onClick={doResume}
            className="absolute inset-0 flex items-center justify-center" aria-label="Play">
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
          <button type="button" data-testid="preview-scene-btn" onClick={startScenePreview}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "scene" && playing ? "border-primary/50 bg-primary/15 text-primary"
              : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"}`}>
            <Film className="h-3.5 w-3.5" /> Preview Scene
          </button>
          <button type="button" data-testid="preview-timeline-btn" onClick={startTimeline}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "timeline" && playing ? "border-primary/50 bg-primary/15 text-primary"
              : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"}`}>
            <ListVideo className="h-3.5 w-3.5" /> Preview Timeline
          </button>
        </div>

        {/* Playback row */}
        <div className="flex items-center gap-2">
          <button type="button" data-testid="preview-restart-btn" title="Restart" onClick={restartCurrent}
            className="p-1.5 rounded text-white/40 hover:text-white/70 transition-colors">
            <SkipBack className="h-4 w-4" />
          </button>
          <button type="button" data-testid="preview-play-pause-btn"
            onClick={playing ? doPause : doResume} aria-label={playing ? "Pause" : "Resume"}
            className="p-1.5 rounded text-white/70 hover:text-white transition-colors">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button type="button" data-testid="preview-next-scene-btn" title="Next scene"
            onClick={() => jumpToScene(Math.min(scenes.length - 1, sceneIdx + 1))}
            disabled={sceneIdx >= scenes.length - 1}
            className="p-1.5 rounded text-white/40 hover:text-white/70 disabled:opacity-20 transition-colors">
            <SkipForward className="h-4 w-4" />
          </button>

          {/* Progress bar */}
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary/70 rounded-full transition-none"
              style={{ width: `${totalDuration > 0 ? Math.min(100, timelineTime / totalDuration * 100) : 0}%` }} />
          </div>
          <span className="text-[10px] font-mono text-white/30 shrink-0">{fmt(timelineTime)}</span>
        </div>

        {/* Error banner */}
        {lastError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400 font-mono break-all">
            ⚠ {lastError}
          </div>
        )}

        {/* Status */}
        <div className="space-y-0.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span>
              {playing
                ? <span className="text-primary font-bold" data-testid="timeline-status-active">
                    ◉ {mode === "timeline" ? "Timeline Preview Active" : "Scene Preview Active"}
                  </span>
                : <span className="text-white/35" data-testid="timeline-status-ready">
                    {mode === "timeline" ? "Timeline Preview ready" : "Scene Preview ready"}
                  </span>}
            </span>
            <span className="text-white/25">Scene {sceneIdx + 1} of {scenes.length}</span>
          </div>
          {activeLine && (
            <div className="text-primary/70 font-medium truncate" data-testid="timeline-current-caption">
              Caption: {activeLine.text}
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
                i === sceneIdx ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/[0.08] bg-white/[0.02] text-white/30 hover:text-white/60"}`}>
              <span>{s.section || `#${i + 1}`}</span>
              {!s.demoClipUrl && <span className="text-white/20 text-[8px]">no clip</span>}
            </button>
          ))}
        </div>

        {/* ── Debug / Status panel ── */}
        <div className="border border-white/[0.07] rounded-lg overflow-hidden">
          <button type="button" onClick={() => setDebugOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors">
            <span>Timeline Preview Status</span>
            {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {debugOpen && (
            <div className="px-3 pb-3 space-y-0.5 font-mono text-[10px] border-t border-white/[0.06]">
              <DR label="scenes loaded"     v={String(scenes.length)} />
              <DR label="captions loaded"   v={String(captionLines.length)} />
              <DR label="audio loaded"      v={audioUrl ? "yes" : "no"} />
              <DR label="preview mode"      v={mode} hi />
              <DR label="playing"           v={playing ? "YES" : "no"} hi={playing} />
              <DR label="current scene"     v={`${sceneIdx + 1} of ${scenes.length} · ${currentScene?.section || "—"}`} />
              <DR label="has clip"          v={hasClip ? "yes (video)" : "no (timer)"} />
              <DR label="scene duration"    v={`${sceneDuration.toFixed(1)}s  ts="${currentScene?.timestamp || "none"}"`} />
              <DR label="scene local time"  v={`${sceneLocalTime.toFixed(2)}s`} hi={playing} />
              <DR label="timeline time"     v={`${timelineTime.toFixed(2)}s / ${totalDuration.toFixed(1)}s`} hi={playing} />
              <DR label="current caption"
                v={activeLine
                  ? `"${activeLine.text}" (${activeLine.startSec.toFixed(1)}–${activeLine.endSec.toFixed(1)}s)`
                  : captionLines.length > 0 ? `none at ${timelineTime.toFixed(1)}s` : "no captions loaded"}
                hi={!!activeLine}
              />
              <DR label="last error"        v={lastError ?? "none"} err={!!lastError} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/* ── Debug row ─────────────────────────────────────────────────── */
function DR({ label, v, hi, err }: { label: string; v: string; hi?: boolean; err?: boolean }) {
  return (
    <div className="flex gap-2 pt-0.5">
      <span className="text-white/25 shrink-0 w-[130px]">{label}:</span>
      <span className={err ? "text-red-400" : hi ? "text-primary/80" : "text-white/50"}>{v}</span>
    </div>
  );
}
