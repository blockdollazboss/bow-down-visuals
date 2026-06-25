/**
 * TimelinePreviewPlayer
 *
 * ONE master clock (requestAnimationFrame) drives everything.
 *   masterTime → activeSceneIdx  (time-based lookup, no manual advance)
 *   masterTime → activeLine      (time-based caption lookup)
 *   Audio plays continuously — never restarted on scene change.
 *
 * Key design choices:
 *  - rAF instead of setInterval: wall-clock accurate, never throttled
 *  - setVideoEl is stable (useCallback) — video ref never cycles on re-render
 *  - All live values read from refs inside the rAF callback (no stale closures)
 *  - React state updated max ~10×/sec (every 100ms) for caption / scene display
 */
import {
  useState, useEffect, useRef, useCallback, type CSSProperties,
} from "react";
import {
  Play, Pause, SkipBack, Film, Volume2, ListVideo,
  ChevronDown, ChevronUp,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine } from "@/lib/editor-settings";

/* ─── helpers ─────────────────────────────────────────────────── */

function parseDur(ts: string | null | undefined): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) { const s = +m[1]*60 + +m[2], e = +m[3]*60 + +m[4]; return e > s ? e - s : 5; }
  return 5;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
}

/** Return which scene index is active at time `t`. */
function sceneAt(t: number, offsets: number[], durs: number[]): number {
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (t >= offsets[i]) return i;   // first scene whose start <= t
  }
  return 0;
}

function buildOffsets(durs: number[]): number[] {
  return durs.map((_, i) => i === 0 ? 0 : durs.slice(0, i).reduce((a, b) => a + b, 0));
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
  };
}

/* ─── component ───────────────────────────────────────────────── */

export function TimelinePreviewPlayer({
  scenes, captionLines, audioUrl, initialSceneId, captionSettings,
}: TimelinePreviewPlayerProps) {

  /* ── scene timing (recomputed each render, refs kept in sync) ── */
  const durs     = scenes.map(s => parseDur(s.timestamp));
  const offsets  = buildOffsets(durs);
  const totalDur = durs.reduce((a, b) => a + b, 0);
  const initialIdx = Math.max(0, scenes.findIndex(s => s.id === initialSceneId));

  /* ── React state — display only ── */
  const [masterTime,    setMasterTime   ] = useState(0);
  const [sceneIdx,      setSceneIdx     ] = useState(0);
  const [mode,          setMode         ] = useState<"timeline"|"scene">("timeline");
  const [playing,       setPlaying      ] = useState(false);
  const [audioReady,    setAudioReady   ] = useState(false);
  const [audioPlaying,  setAudioPlaying ] = useState(false);
  const [lastError,     setLastError    ] = useState<string|null>(null);
  const [debugOpen,     setDebugOpen    ] = useState(true);
  const [tickCount,     setTickCount    ] = useState(0);
  /** Bumped to force useEffect([sceneIdx, playTrigger]) even when sceneIdx stays 0 */
  const [playTrigger,   setPlayTrigger  ] = useState(0);

  /* ── Refs — live values for rAF callback (no stale closures) ── */
  const masterTimeRef = useRef(0);
  const sceneIdxRef   = useRef(0);
  const playingRef    = useRef(false);
  const modeRef       = useRef<"timeline"|"scene">("timeline");
  const offsRef       = useRef(offsets);
  const dursRef       = useRef(durs);
  const totalDurRef   = useRef(totalDur);
  const scenesRef     = useRef(scenes);
  const rafRef        = useRef<number|null>(null);
  const videoRef      = useRef<HTMLVideoElement|null>(null);
  const audioRef      = useRef<HTMLAudioElement|null>(null);
  /* Wall-clock start for accurate elapsed time */
  const wallStartRef  = useRef(0);
  const masterStartRef= useRef(0);
  /* Last time we pushed a React state update (throttle to 100ms) */
  const lastUpdateRef = useRef(0);
  /* Stop time for scene-only mode */
  const stopAtRef     = useRef(Infinity);

  /* Sync refs every render (runs synchronously, before effects) */
  offsRef.current    = offsets;
  dursRef.current    = durs;
  totalDurRef.current= totalDur;
  scenesRef.current  = scenes;
  sceneIdxRef.current= sceneIdx;
  playingRef.current = playing;
  modeRef.current    = mode;

  /* ── Derived display ── */
  const currentScene = scenes[sceneIdx];
  const hasClip      = !!currentScene?.demoClipUrl;
  const activeLine   = captionLines.find(
    l => l.startSec <= masterTime && masterTime < l.endSec
  ) ?? null;

  /* ── Stable video callback ref (MUST be stable — inline fn breaks video) ── */
  const setVideoEl = useCallback((el: HTMLVideoElement|null) => {
    videoRef.current = el;
    if (el) { el.muted = true; }
  }, []); // empty deps → created once, never cycles on re-render

  /* ── rAF tick ── */
  function tick(timestamp: number) {
    if (!playingRef.current) return;

    /* Accurate wall-clock elapsed time (avoids floating-point drift) */
    const elapsed = (timestamp - wallStartRef.current) / 1000;
    const next    = masterStartRef.current + elapsed;
    masterTimeRef.current = next;

    /* Throttle React state updates to ≤10fps */
    const shouldUpdate = timestamp - lastUpdateRef.current >= 100;
    if (shouldUpdate) {
      lastUpdateRef.current = timestamp;
      setMasterTime(next);
      setTickCount(t => t + 1);

      /* Scene change? (timeline mode only) */
      if (modeRef.current === "timeline") {
        const newIdx = sceneAt(next, offsRef.current, dursRef.current);
        if (newIdx !== sceneIdxRef.current) {
          sceneIdxRef.current = newIdx;
          setSceneIdx(newIdx);
        }
      }
    }

    /* Stop at end (or scene end in scene-preview mode) */
    if (next >= stopAtRef.current) {
      playingRef.current = false;
      setPlaying(false);
      setMasterTime(stopAtRef.current);
      if (audioRef.current) { audioRef.current.pause(); setAudioPlaying(false); }
      return; // don't schedule next frame
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  /* ── Effect: play clip when sceneIdx changes (or playTrigger bumps) ── */
  useEffect(() => {
    if (!playingRef.current) return;
    const scene = scenesRef.current[sceneIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) =>
        setLastError(`Clip scene ${sceneIdx+1}: ${e.message}`)
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdx, playTrigger]);

  /* ── Cleanup ── */
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ── Audio element readiness ── */
  useEffect(() => {
    setAudioReady(!!audioUrl);
  }, [audioUrl]);

  /* ─── Control helpers ──────────────────────────────────────── */

  function stopRaf() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }

  function launchClock(fromTime: number, stopAt: number, startSceneIdx: number) {
    stopRaf();
    masterTimeRef.current  = fromTime;
    masterStartRef.current = fromTime;
    wallStartRef.current   = performance.now();
    lastUpdateRef.current  = 0;
    stopAtRef.current      = stopAt;
    sceneIdxRef.current    = startSceneIdx;
    playingRef.current     = true;
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }

  function startTimeline() {
    setLastError(null);
    setMode("timeline");
    modeRef.current = "timeline";
    setMasterTime(0);
    setSceneIdx(0);
    setPlayTrigger(t => t + 1); // force useEffect even if sceneIdx stays 0

    /* Audio from beginning */
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = 0;
      audioRef.current.play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio preview failed: ${e.message}`));
    }

    launchClock(0, totalDurRef.current, 0);
  }

  function startScenePreview() {
    const idx   = initialIdx;
    const start = offsRef.current[idx] ?? 0;
    const end   = start + (dursRef.current[idx] ?? 5);

    setLastError(null);
    setMode("scene");
    modeRef.current = "scene";
    setMasterTime(start);
    setSceneIdx(idx);
    setPlayTrigger(t => t + 1);

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = start;
      audioRef.current.play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio preview failed: ${e.message}`));
    }

    launchClock(start, end, idx);
  }

  function pauseTimeline() {
    stopRaf();
    playingRef.current = false;
    setPlaying(false);
    if (videoRef.current) videoRef.current.pause();
    if (audioRef.current) { audioRef.current.pause(); setAudioPlaying(false); }
  }

  function resumeTimeline() {
    if (masterTimeRef.current >= stopAtRef.current) return;
    setLastError(null);

    if (hasClip && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.play().catch((e: Error) => setLastError(`Clip: ${e.message}`));
    }
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = masterTimeRef.current;
      audioRef.current.play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio: ${e.message}`));
    }

    /* Resume from current masterTime */
    launchClock(masterTimeRef.current, stopAtRef.current, sceneIdxRef.current);
  }

  function restartTimeline() {
    startTimeline();
  }

  function jumpToScene(i: number) {
    const wasPlaying = playingRef.current;
    stopRaf();
    playingRef.current = false;

    const newTime = offsRef.current[i] ?? 0;
    masterTimeRef.current = newTime;
    sceneIdxRef.current   = i;

    setMasterTime(newTime);
    setSceneIdx(i);
    setPlayTrigger(t => t + 1);
    setLastError(null);

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = newTime;
    }

    if (wasPlaying) {
      if (audioRef.current && audioUrl) {
        audioRef.current.play()
          .then(() => setAudioPlaying(true))
          .catch(() => {});
      }
      launchClock(newTime, stopAtRef.current, i);
    }
  }

  /* ─── Caption style ─────────────────────────────────────────── */
  const capStyle: CSSProperties = {
    fontSize: "clamp(14px,3vw,20px)", fontWeight: 800,
    color: captionSettings?.textColor || "#fff",
    background: captionSettings?.background ? "rgba(0,0,0,0.72)" : "transparent",
    textShadow: captionSettings?.outline
      ? "0 0 8px #000,1px 1px 0 #000,-1px -1px 0 #000"
      : "0 2px 8px rgba(0,0,0,0.9)",
    padding: "0.2rem 0.75rem", borderRadius: "0.4rem", letterSpacing: "0.01em",
  };
  const posClass =
    captionSettings?.position === "Top"    ? "top-3"
    : captionSettings?.position === "Center" ? "top-1/2 -translate-y-1/2"
    : "bottom-6";

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div className="rounded-xl border border-primary/20 bg-[#080808] overflow-hidden">

      {/* Hidden audio — plays continuously across scene changes */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onCanPlayThrough={() => setAudioReady(true)}
          onEnded={() => { setAudioPlaying(false); }}
        />
      )}

      {/* ── Preview area ─────────────────────────────────────── */}
      <div className="relative aspect-video bg-black">

        {hasClip ? (
          <video
            ref={setVideoEl}           /* stable callback — won't cycle on re-render */
            key={currentScene?.demoClipUrl}
            src={currentScene?.demoClipUrl ?? undefined}
            playsInline
            loop={false}
            className="w-full h-full object-contain"
            onError={(e) => {
              const code = (e.currentTarget as HTMLVideoElement).error?.code ?? "?";
              setLastError(`Video error scene ${sceneIdx+1}: code ${code}`);
            }}
            data-testid="timeline-preview-video"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#0f0a00] to-[#050505]">
            <div className="h-16 w-16 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center">
              <Film className="h-7 w-7 text-white/20" />
            </div>
            <p className="text-sm font-bold text-white/40 text-center px-4">
              {currentScene?.section || `Scene ${sceneIdx+1}`}
            </p>
            {currentScene?.lyricLine && (
              <p className="text-xs text-white/20 italic text-center px-6 max-w-xs">
                &ldquo;{currentScene.lyricLine}&rdquo;
              </p>
            )}
            {playing && (
              <p className="font-mono text-[11px] text-primary/60">
                {fmt(masterTime - (offsets[sceneIdx]??0))} / {fmt(durs[sceneIdx]??5)}
              </p>
            )}
          </div>
        )}

        {/* Caption overlay */}
        {activeLine && (
          <div className={`absolute left-0 right-0 px-4 flex justify-center pointer-events-none ${posClass}`}>
            <div style={capStyle} className="text-center leading-snug max-w-[90%]"
              data-testid="timeline-caption-text">
              {activeLine.text}
            </div>
          </div>
        )}

        {/* Scene badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/70 border border-white/10 backdrop-blur-sm">
          <Film className="h-3 w-3 text-primary/60" />
          <span className="text-[10px] font-bold text-white/70">
            Scene {sceneIdx+1}/{scenes.length}
            {currentScene?.section ? ` · ${currentScene.section}` : ""}
          </span>
        </div>

        {/* Playing / mode badge */}
        {playing && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">
              {mode === "timeline" ? "Timeline Active" : "Scene Preview Active"}
            </span>
          </div>
        )}

        {/* Overlay play button — shown when paused */}
        {!playing && (
          <button type="button" onClick={resumeTimeline}
            className="absolute inset-0 flex items-center justify-center" aria-label="Play">
            <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors backdrop-blur-sm">
              <Play className="h-6 w-6 text-primary ml-0.5" />
            </div>
          </button>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-white/[0.05] space-y-3">

        {/* Mode buttons */}
        <div className="flex gap-2">
          <button type="button" data-testid="preview-timeline-btn" onClick={startTimeline}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "timeline" && playing
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
            }`}>
            <ListVideo className="h-3.5 w-3.5" /> Preview Timeline
          </button>
          <button type="button" data-testid="preview-scene-btn" onClick={startScenePreview}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              mode === "scene" && playing
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
            }`}>
            <Film className="h-3.5 w-3.5" /> Preview Scene
          </button>
        </div>

        {/* Playback controls */}
        <div className="flex gap-2">
          <button type="button" data-testid="preview-restart-btn" onClick={restartTimeline}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70 transition-colors">
            <SkipBack className="h-3.5 w-3.5" /> Restart Timeline
          </button>
          <button type="button" data-testid="preview-pause-btn"
            onClick={playing ? pauseTimeline : resumeTimeline}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70 transition-colors">
            {playing
              ? <><Pause className="h-3.5 w-3.5" /> Pause Timeline</>
              : <><Play  className="h-3.5 w-3.5" /> Resume Timeline</>}
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary/70 rounded-full transition-none"
              style={{ width: `${totalDur > 0 ? Math.min(100, masterTime/totalDur*100) : 0}%` }} />
          </div>
          <span className="text-[10px] font-mono text-white/30 shrink-0 w-[84px] text-right">
            {fmt(masterTime)} / {fmt(totalDur)}
          </span>
        </div>

        {/* Audio status line */}
        <div className="text-[10px] flex items-center gap-1.5">
          {audioUrl ? (
            <span className={`flex items-center gap-1.5 ${audioPlaying ? "text-blue-400/70" : "text-white/30"}`}>
              <Volume2 className="h-3 w-3 shrink-0" />
              {audioPlaying
                ? "Audio playing continuously — does not restart between scenes"
                : `Audio loaded${audioReady ? "" : " (loading…)"} — plays when Preview Timeline starts`}
            </span>
          ) : (
            <span className="text-white/20">
              No song audio selected. Timeline preview will play silently.
            </span>
          )}
        </div>

        {/* Error banner */}
        {lastError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400 font-mono break-all">
            ⚠ {lastError}
          </div>
        )}

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
              <span>{s.section || `#${i+1}`}</span>
              {!s.demoClipUrl && <span className="text-white/20 text-[8px]">no clip</span>}
            </button>
          ))}
        </div>

        {/* ── Debug / Status panel ─────────────────────────────── */}
        <div className="border border-white/[0.07] rounded-lg overflow-hidden">
          <button type="button" onClick={() => setDebugOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors">
            <span>Timeline Preview Status</span>
            {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {debugOpen && (
            <div className="px-3 pb-3 space-y-0.5 font-mono text-[10px] border-t border-white/[0.06]">
              <DR label="timer ticks"      v={String(tickCount)} hi={playing} />
              <DR label="playing"          v={playing ? "YES" : "no"} hi={playing} />
              <DR label="mode"             v={mode} />
              <DR label="current time"     v={`${masterTime.toFixed(2)}s`} hi={playing} />
              <DR label="total duration"   v={`${totalDur.toFixed(1)}s (${scenes.length} scenes)`} />
              <DR label="current scene"    v={`${sceneIdx+1} of ${scenes.length} · "${currentScene?.section||"—"}" · ${fmt(offsets[sceneIdx]??0)}–${fmt((offsets[sceneIdx]??0)+(durs[sceneIdx]??5))}`} />
              <DR label="has clip"         v={hasClip ? "yes (video)" : "no (timer)"} />
              <DR label="scenes loaded"    v={String(scenes.length)} />
              <DR label="captions loaded"  v={String(captionLines.length)} />
              <DR label="audio loaded"     v={audioReady ? "yes" : audioUrl ? "loading…" : "no"} />
              <DR label="audio playing"    v={audioPlaying ? "YES" : "no"} hi={audioPlaying} />
              <DR label="current caption"  v={
                activeLine
                  ? `"${activeLine.text.slice(0,40)}" (${activeLine.startSec.toFixed(1)}–${activeLine.endSec.toFixed(1)}s)`
                  : captionLines.length > 0
                    ? `none at ${masterTime.toFixed(1)}s (${captionLines.length} captions loaded)`
                    : "no captions loaded"
              } hi={!!activeLine} />
              <DR label="scene offsets"    v={offsets.map(o => `${o.toFixed(0)}s`).join(", ")} />
              <DR label="last error"       v={lastError ?? "none"} err={!!lastError} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/* ─── Debug row ───────────────────────────────────────────────── */
function DR({ label, v, hi, err }: { label: string; v: string; hi?: boolean; err?: boolean }) {
  return (
    <div className="flex gap-2 pt-0.5">
      <span className="text-white/25 shrink-0 w-[130px]">{label}:</span>
      <span className={err ? "text-red-400" : hi ? "text-primary/80" : "text-white/50"}>{v}</span>
    </div>
  );
}
