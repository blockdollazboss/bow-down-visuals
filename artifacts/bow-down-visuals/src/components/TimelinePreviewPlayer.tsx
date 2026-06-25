/**
 * TimelinePreviewPlayer
 *
 * ONE master clock (requestAnimationFrame) drives everything.
 *   masterTime → activeSceneIdx  (time-based lookup)
 *   masterTime → activeLine      (time-based caption lookup)
 *   Audio plays continuously — never restarted on scene change.
 *
 * Fullscreen: fullscreens the WHOLE container div (not the <video>) so the
 * HTML caption overlay remains visible. Native <video> fullscreen is NOT used
 * because it strips all HTML overlays, hiding captions.
 *
 * PiP: a warning is shown; PiP cannot show HTML overlays.
 */
import {
  useState, useEffect, useRef, useCallback, type CSSProperties,
} from "react";
import {
  Play, Pause, SkipBack, Film, Volume2, ListVideo,
  ChevronDown, ChevronUp, Maximize, Minimize, Info,
  Eye, Tv2,
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

function buildOffsets(durs: number[]): number[] {
  return durs.map((_, i) => i === 0 ? 0 : durs.slice(0, i).reduce((a, b) => a + b, 0));
}

function sceneAt(t: number, offsets: number[]): number {
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (t >= offsets[i]) return i;
  }
  return 0;
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
  scenes, captionLines, audioUrl, initialSceneId, captionSettings,
}: TimelinePreviewPlayerProps) {

  /* ── Scene timing ── */
  const durs     = scenes.map(s => parseDur(s.timestamp));
  const offsets  = buildOffsets(durs);
  const totalDur = durs.reduce((a, b) => a + b, 0);
  const initialIdx = Math.max(0, scenes.findIndex(s => s.id === initialSceneId));

  /* ── React state ── */
  const [masterTime,    setMasterTime   ] = useState(0);
  const [sceneIdx,      setSceneIdx     ] = useState(0);
  const [mode,          setMode         ] = useState<"timeline"|"scene">("timeline");
  const [playing,       setPlaying      ] = useState(false);
  const [audioReady,    setAudioReady   ] = useState(false);
  const [audioPlaying,  setAudioPlaying ] = useState(false);
  const [lastError,     setLastError    ] = useState<string|null>(null);
  const [debugOpen,     setDebugOpen    ] = useState(false);
  const [tickCount,     setTickCount    ] = useState(0);
  const [playTrigger,   setPlayTrigger  ] = useState(0);
  const [isFullscreen,  setIsFullscreen ] = useState(false);
  const [burnPreview,   setBurnPreview  ] = useState(false);

  /* ── Refs ── */
  const masterTimeRef  = useRef(0);
  const sceneIdxRef    = useRef(0);
  const playingRef     = useRef(false);
  const modeRef        = useRef<"timeline"|"scene">("timeline");
  const offsRef        = useRef(offsets);
  const dursRef        = useRef(durs);
  const totalDurRef    = useRef(totalDur);
  const scenesRef      = useRef(scenes);
  const rafRef         = useRef<number|null>(null);
  const videoRef       = useRef<HTMLVideoElement|null>(null);
  const audioRef       = useRef<HTMLAudioElement|null>(null);
  const containerRef   = useRef<HTMLDivElement|null>(null);
  const wallStartRef   = useRef(0);
  const masterStartRef = useRef(0);
  const lastUpdateRef  = useRef(0);
  const stopAtRef      = useRef(Infinity);

  /* Sync refs every render */
  offsRef.current     = offsets;
  dursRef.current     = durs;
  totalDurRef.current = totalDur;
  scenesRef.current   = scenes;
  sceneIdxRef.current = sceneIdx;
  playingRef.current  = playing;
  modeRef.current     = mode;

  /* ── Derived ── */
  const currentScene = scenes[sceneIdx];
  const hasClip      = !!currentScene?.demoClipUrl;
  const activeLine   = captionLines.find(
    l => l.startSec <= masterTime && masterTime < l.endSec
  ) ?? null;

  /* ── Stable video callback ref — MUST NOT be inline (cycles on every render) ── */
  const setVideoEl = useCallback((el: HTMLVideoElement|null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* ── rAF tick ── */
  function tick(timestamp: number) {
    if (!playingRef.current) return;
    const elapsed = (timestamp - wallStartRef.current) / 1000;
    const next    = masterStartRef.current + elapsed;
    masterTimeRef.current = next;

    if (timestamp - lastUpdateRef.current >= 100) {
      lastUpdateRef.current = timestamp;
      setMasterTime(next);
      setTickCount(t => t + 1);
      if (modeRef.current === "timeline") {
        const newIdx = sceneAt(next, offsRef.current);
        if (newIdx !== sceneIdxRef.current) {
          sceneIdxRef.current = newIdx;
          setSceneIdx(newIdx);
        }
      }
    }

    if (next >= stopAtRef.current) {
      playingRef.current = false;
      setPlaying(false);
      setMasterTime(stopAtRef.current);
      if (audioRef.current) { audioRef.current.pause(); setAudioPlaying(false); }
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  /* ── Effect: play clip when scene changes ── */
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

  /* ── Fullscreen tracking ── */
  useEffect(() => {
    function onFSChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  /* ── Cleanup ── */
  useEffect(() => {
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  /* ── Audio readiness ── */
  useEffect(() => { setAudioReady(!!audioUrl); }, [audioUrl]);

  /* ─── Helpers ──────────────────────────────────────────────── */

  function stopRaf() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }

  function launchClock(fromTime: number, stopAt: number, startIdx: number) {
    stopRaf();
    masterTimeRef.current  = fromTime;
    masterStartRef.current = fromTime;
    wallStartRef.current   = performance.now();
    lastUpdateRef.current  = 0;
    stopAtRef.current      = stopAt;
    sceneIdxRef.current    = startIdx;
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
    setPlayTrigger(t => t + 1);
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = 0;
      audioRef.current.play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio: ${e.message}`));
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
        .catch((e: Error) => setLastError(`Audio: ${e.message}`));
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
    launchClock(masterTimeRef.current, stopAtRef.current, sceneIdxRef.current);
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
    if (audioRef.current && audioUrl) audioRef.current.currentTime = newTime;
    if (wasPlaying) {
      if (audioRef.current && audioUrl) {
        audioRef.current.play().then(() => setAudioPlaying(true)).catch(() => {});
      }
      launchClock(newTime, stopAtRef.current, i);
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

  /* Normal overlay style */
  const capStyleOverlay: CSSProperties = {
    fontSize: "clamp(14px,3vw,22px)", fontWeight: 800,
    color: captionSettings?.textColor || "#fff",
    background: captionSettings?.background ? "rgba(0,0,0,0.72)" : "transparent",
    textShadow: captionSettings?.outline
      ? "0 0 8px #000,1px 1px 0 #000,-1px -1px 0 #000"
      : "0 2px 8px rgba(0,0,0,0.9)",
    padding: "0.2rem 0.75rem", borderRadius: "0.4rem", letterSpacing: "0.01em",
  };

  /* Burn-preview style: simulates final rendered text (solid, no transparency) */
  const capStyleBurn: CSSProperties = {
    fontSize: "clamp(14px,3vw,22px)", fontWeight: 900,
    color: captionSettings?.textColor || "#fff",
    background: "rgba(0,0,0,0.85)",
    textShadow: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 2px 6px rgba(0,0,0,1)",
    padding: "0.25rem 0.9rem", borderRadius: "0.3rem",
    letterSpacing: "0.02em", border: "1px solid rgba(255,255,255,0.08)",
  };

  const capStyle = burnPreview ? capStyleBurn : capStyleOverlay;
  const posClass =
    captionSettings?.position === "Top"    ? "top-3"
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
      {/* Hidden audio */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onCanPlayThrough={() => setAudioReady(true)}
          onEnded={() => setAudioPlaying(false)}
        />
      )}

      {/* ── Preview area ─────────────────────────────────────── */}
      <div className={`relative bg-black ${isFullscreen ? "flex-1 min-h-0" : "aspect-video"}`}>

        {hasClip ? (
          <video
            ref={setVideoEl}
            key={currentScene?.demoClipUrl}
            src={currentScene?.demoClipUrl ?? undefined}
            playsInline loop={false}
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

        {/* Caption overlay — visible in normal view AND custom fullscreen */}
        {activeLine && (
          <div className={`absolute left-0 right-0 px-4 flex justify-center pointer-events-none ${posClass}`}>
            <div style={capStyle} className="text-center leading-snug max-w-[90%]"
              data-testid="timeline-caption-text">
              {burnPreview && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-black text-amber-400/70 uppercase tracking-widest whitespace-nowrap">
                  burn preview
                </span>
              )}
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

        {/* Fullscreen toggle button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Custom fullscreen (captions stay visible)"}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 border border-white/10 text-white/50 hover:text-white/90 hover:bg-black/80 transition-colors backdrop-blur-sm"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </button>

        {/* Playing badge */}
        {playing && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">
              {mode === "scene" ? "Scene Preview" : "Timeline"}
            </span>
          </div>
        )}

        {/* Overlay play button */}
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
      <div className={`px-4 py-3 border-t border-white/[0.05] space-y-3 ${isFullscreen ? "overflow-y-auto max-h-64 shrink-0" : ""}`}>

        {/* Overlay / fullscreen explanation */}
        {!isFullscreen && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[10px] text-white/35 leading-relaxed">
            <Info className="h-3 w-3 shrink-0 mt-0.5 text-white/25" />
            <span>
              Captions are <strong className="text-white/50">HTML overlays</strong> — visible in normal view and in{" "}
              <button type="button" onClick={toggleFullscreen} className="text-primary/70 underline underline-offset-2 hover:text-primary transition-colors">
                Custom Fullscreen ↗
              </button>
              . Browser native fullscreen and Picture-in-Picture may hide overlays.
              Burn captions into the final video via the <strong className="text-white/50">Export</strong> tab.
            </span>
          </div>
        )}

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
          <button type="button" data-testid="preview-restart-btn" onClick={startTimeline}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70 transition-colors">
            <SkipBack className="h-3.5 w-3.5" /> Restart
          </button>
          <button type="button" data-testid="preview-pause-btn"
            onClick={playing ? pauseTimeline : resumeTimeline}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70 transition-colors">
            {playing
              ? <><Pause className="h-3.5 w-3.5" /> Pause</>
              : <><Play  className="h-3.5 w-3.5" /> Resume</>}
          </button>
          <button type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Custom fullscreen"}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              isFullscreen
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
            }`}>
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Burn-preview caption toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setBurnPreview(b => !b)}
            title="Preview how captions will look when burned into the final video"
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              burnPreview
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/60"
            }`}>
            <Eye className="h-3.5 w-3.5" />
            {burnPreview ? "Showing: Burned-In Caption Style" : "Preview Burned-In Caption Style"}
          </button>
        </div>

        {burnPreview && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] text-[10px] text-amber-300/70 leading-relaxed">
            <Eye className="h-3 w-3 shrink-0 mt-0.5 text-amber-400/60" />
            <span>
              Showing how captions will appear when permanently burned into the exported video file.
              This style uses solid backgrounds and thick text shadows to remain readable on any clip.
            </span>
          </div>
        )}

        {/* PiP warning */}
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[10px] text-white/30 leading-relaxed">
          <Tv2 className="h-3 w-3 shrink-0 mt-0.5 text-white/20" />
          <span>
            <strong className="text-white/40">Picture-in-Picture</strong> cannot show preview captions (browser limitation).
            Use the Custom Fullscreen button instead, or export with burned-in captions.
          </span>
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

        {/* Audio status */}
        <div className="text-[10px] flex items-center gap-1.5">
          {audioUrl ? (
            <span className={`flex items-center gap-1.5 ${audioPlaying ? "text-blue-400/70" : "text-white/30"}`}>
              <Volume2 className="h-3 w-3 shrink-0" />
              {audioPlaying
                ? "Audio playing — not restarted between scenes"
                : `Audio ${audioReady ? "ready" : "loading…"} — starts when Preview Timeline begins`}
            </span>
          ) : (
            <span className="text-white/20">No song audio. Timeline plays silently.</span>
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

        {/* Debug panel */}
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
              <DR label="current scene"    v={`${sceneIdx+1}/${scenes.length} · "${currentScene?.section||"—"}" · ${fmt(offsets[sceneIdx]??0)}–${fmt((offsets[sceneIdx]??0)+(durs[sceneIdx]??5))}`} />
              <DR label="has clip"         v={hasClip ? "yes" : "no"} />
              <DR label="captions loaded"  v={`${captionLines.length}`} />
              <DR label="audio loaded"     v={audioReady ? "yes" : audioUrl ? "loading…" : "no"} />
              <DR label="audio playing"    v={audioPlaying ? "YES" : "no"} hi={audioPlaying} />
              <DR label="current caption"  v={
                activeLine
                  ? `"${activeLine.text.slice(0,40)}" (${activeLine.startSec.toFixed(1)}–${activeLine.endSec.toFixed(1)}s)`
                  : captionLines.length > 0
                    ? `none at ${masterTime.toFixed(1)}s`
                    : "no captions"
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
