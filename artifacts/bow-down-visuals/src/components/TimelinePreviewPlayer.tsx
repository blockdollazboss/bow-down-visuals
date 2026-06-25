/**
 * TimelinePreviewPlayer
 *
 * Architecture: ONE master clock drives everything.
 *   masterTime → currentSceneIdx (time-based lookup)
 *   masterTime → activeLine      (time-based lookup)
 *   Audio plays continuously — never restarted on scene change.
 *   Video clips play from 0 each time their scene becomes active.
 */
import {
  useState, useEffect, useRef, type CSSProperties,
} from "react";
import {
  Play, Pause, SkipBack, Film, Volume2, ListVideo,
  ChevronDown, ChevronUp,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine } from "@/lib/editor-settings";

/* ─── helpers ──────────────────────────────────────────────────── */

function parseDur(ts: string): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) { const s = +m[1]*60 + +m[2], e = +m[3]*60 + +m[4]; return e > s ? e - s : 5; }
  return 5;
}

function fmt(s: number): string {
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
}

/** Which scene index contains `t`? */
function sceneAt(t: number, offsets: number[], durs: number[]): number {
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (t >= offsets[i] && t < offsets[i] + durs[i]) return i;
  }
  // t past end → clamp to last
  return Math.max(0, offsets.length - 1);
}

/* ─── types ────────────────────────────────────────────────────── */

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

/* ─── component ─────────────────────────────────────────────────── */

export function TimelinePreviewPlayer({
  scenes, captionLines, audioUrl, initialSceneId, captionSettings,
}: TimelinePreviewPlayerProps) {

  /* ── Compute scene timing (pure, no side-effects) ── */
  const durs    = scenes.map(s => parseDur(s.timestamp));
  const offsets = durs.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : (acc[i-1] ?? 0) + (durs[i-1] ?? 5));
    return acc;
  }, []);
  const totalDur = (offsets[scenes.length-1] ?? 0) + (durs[scenes.length-1] ?? 0);

  /* ── React state (display only) ── */
  const [masterTime,  setMasterTime ] = useState(0);
  const [sceneIdx,    setSceneIdx   ] = useState(0);
  const [playing,     setPlaying    ] = useState(false);
  const [audioReady,  setAudioReady ] = useState(false);
  const [audioPlaying,setAudioPlaying] = useState(false);
  const [lastError,   setLastError  ] = useState<string | null>(null);
  const [debugOpen,   setDebugOpen  ] = useState(true);
  /** Bumped on every startTimeline / restartTimeline so useEffect fires even
   *  when sceneIdx doesn't change (already at 0). */
  const [playTrigger, setPlayTrigger] = useState(0);

  /* ── Refs (live values, no stale closures) ── */
  const masterTimeRef  = useRef(0);
  const sceneIdxRef    = useRef(0);
  const playingRef     = useRef(false);
  const offsRef        = useRef(offsets);
  const dursRef        = useRef(durs);
  const totalDurRef    = useRef(totalDur);
  const scenesRef      = useRef(scenes);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef       = useRef<HTMLVideoElement | null>(null);
  const audioRef       = useRef<HTMLAudioElement | null>(null);

  /* Keep refs in sync every render */
  offsRef.current     = offsets;
  dursRef.current     = durs;
  totalDurRef.current = totalDur;
  scenesRef.current   = scenes;
  sceneIdxRef.current = sceneIdx;
  playingRef.current  = playing;

  /* ── Derived display ── */
  const currentScene = scenes[sceneIdx];
  const hasClip      = !!currentScene?.demoClipUrl;
  const activeLine   = captionLines.find(
    l => l.startSec <= masterTime && masterTime < l.endSec,
  ) ?? null;

  /* ── Muted video callback ref ── */
  const setVideoEl = (el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) el.muted = true;
  };

  /* ── Timer helpers ── */
  function stopTimer() {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function startMasterClock() {
    stopTimer();
    timerRef.current = setInterval(() => {
      if (!playingRef.current) return;

      const next = parseFloat((masterTimeRef.current + 0.1).toFixed(2));
      masterTimeRef.current = next;

      /* Update caption display on every tick */
      setMasterTime(next);

      /* End of timeline? */
      if (next >= totalDurRef.current) {
        stopTimer();
        playingRef.current = false;
        setPlaying(false);
        audioRef.current?.pause();
        setAudioPlaying(false);
        return;
      }

      /* Scene change? */
      const newIdx = sceneAt(next, offsRef.current, dursRef.current);
      if (newIdx !== sceneIdxRef.current) {
        sceneIdxRef.current = newIdx;
        setSceneIdx(newIdx);      // triggers useEffect([sceneIdx, playTrigger])
      }
    }, 100);
  }

  /* ── Effect: play clip when scene changes ── */
  useEffect(() => {
    if (!playingRef.current) return;
    const scene = scenesRef.current[sceneIdx];
    if (scene?.demoClipUrl && videoRef.current) {
      const v = videoRef.current;
      v.muted = true;
      v.currentTime = 0;
      v.play().catch((e: Error) => setLastError(`Clip scene ${sceneIdx+1}: ${e.message}`));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdx, playTrigger]);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => stopTimer(), []);

  /* ── Audio element ready ── */
  useEffect(() => {
    setAudioReady(!!audioUrl);
  }, [audioUrl]);

  /* ─── Control functions ──────────────────────────────────────── */

  function startTimeline() {
    stopTimer();
    masterTimeRef.current = 0;
    sceneIdxRef.current   = 0;
    playingRef.current    = true;

    setMasterTime(0);
    setSceneIdx(0);
    setPlaying(true);
    setLastError(null);
    setPlayTrigger(t => t + 1); // force useEffect even if sceneIdx stays 0

    /* Audio — start from 0, play continuously */
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = 0;
      audioRef.current.play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio preview failed: ${e.message}`));
    }

    startMasterClock();
  }

  function pauseTimeline() {
    stopTimer();
    playingRef.current = false;
    setPlaying(false);
    if (videoRef.current) videoRef.current.pause();
    if (audioRef.current) { audioRef.current.pause(); setAudioPlaying(false); }
  }

  function resumeTimeline() {
    if (masterTimeRef.current >= totalDurRef.current) return; // already at end
    playingRef.current = true;
    setPlaying(true);
    setLastError(null);

    if (hasClip && videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.play().catch((e: Error) => setLastError(`Clip: ${e.message}`));
    }
    if (audioRef.current && audioUrl) {
      audioRef.current.play()
        .then(() => setAudioPlaying(true))
        .catch((e: Error) => setLastError(`Audio: ${e.message}`));
    }

    startMasterClock();
  }

  function restartTimeline() {
    startTimeline(); // same as start from 0
  }

  function jumpToScene(i: number) {
    const wasPlaying = playingRef.current;
    stopTimer();

    const newTime = offsets[i] ?? 0;
    masterTimeRef.current = newTime;
    sceneIdxRef.current   = i;

    setMasterTime(newTime);
    setSceneIdx(i);
    setLastError(null);
    setPlayTrigger(t => t + 1);

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = newTime;
    }

    if (wasPlaying) {
      playingRef.current = true;
      setPlaying(true);
      if (audioRef.current && audioUrl) {
        audioRef.current.play().then(() => setAudioPlaying(true)).catch(() => {});
      }
      startMasterClock();
    }
  }

  /* ─── Caption style ──────────────────────────────────────────── */
  const capStyle: CSSProperties = {
    fontSize: "clamp(14px,3vw,20px)", fontWeight: 800,
    color: captionSettings?.textColor || "#ffffff",
    background: captionSettings?.background ? "rgba(0,0,0,0.72)" : "transparent",
    textShadow: captionSettings?.outline
      ? "0 0 8px #000,1px 1px 0 #000,-1px -1px 0 #000"
      : "0 2px 8px rgba(0,0,0,0.9)",
    letterSpacing: "0.01em", padding: "0.2rem 0.75rem", borderRadius: "0.4rem",
  };
  const posClass = captionSettings?.position === "Top"   ? "top-3"
    : captionSettings?.position === "Center" ? "top-1/2 -translate-y-1/2"
    : "bottom-6";

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div className="rounded-xl border border-primary/20 bg-[#080808] overflow-hidden">

      {/* Hidden audio element — plays continuously across scenes */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onCanPlayThrough={() => setAudioReady(true)}
          onEnded={() => setAudioPlaying(false)}
        />
      )}

      {/* ── Preview area ── */}
      <div className="relative aspect-video bg-black">
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
              setLastError(`Video error scene ${sceneIdx+1}: code ${code}`);
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
              <p className="font-mono text-[11px] text-primary/50">
                {fmt(masterTime - (offsets[sceneIdx] ?? 0))} / {fmt(durs[sceneIdx] ?? 5)}
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

        {/* Playing badge */}
        {playing && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/90 pointer-events-none">
            <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
            <span className="text-[10px] font-black text-black uppercase tracking-wide">Timeline Preview Active</span>
          </div>
        )}

        {/* Overlay play button (resume) */}
        {!playing && (
          <button type="button" onClick={resumeTimeline}
            className="absolute inset-0 flex items-center justify-center" aria-label="Play">
            <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors backdrop-blur-sm">
              <Play className="h-6 w-6 text-primary ml-0.5" />
            </div>
          </button>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="px-4 py-3 border-t border-white/[0.05] space-y-3">

        {/* Primary buttons */}
        <div className="flex gap-2">
          <button type="button" data-testid="preview-timeline-btn" onClick={startTimeline}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
              playing ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
            }`}>
            <ListVideo className="h-3.5 w-3.5" /> Preview Timeline
          </button>
          <button type="button" data-testid="preview-pause-btn"
            onClick={playing ? pauseTimeline : resumeTimeline}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70 transition-colors">
            {playing ? <><Pause className="h-3.5 w-3.5" /> Pause Timeline</> : <><Play className="h-3.5 w-3.5" /> Resume Timeline</>}
          </button>
          <button type="button" data-testid="preview-restart-btn" onClick={restartTimeline}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70 transition-colors">
            <SkipBack className="h-3.5 w-3.5" /> Restart
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary/70 rounded-full transition-none"
              style={{ width: `${totalDur > 0 ? Math.min(100, masterTime / totalDur * 100) : 0}%` }} />
          </div>
          <span className="text-[10px] font-mono text-white/30 shrink-0 w-20 text-right">
            {fmt(masterTime)} / {fmt(totalDur)}
          </span>
        </div>

        {/* Audio status */}
        <div className="text-[10px] flex items-center gap-1.5">
          {audioUrl ? (
            <div className={`flex items-center gap-1.5 ${audioPlaying ? "text-blue-400/70" : "text-white/30"}`}>
              <Volume2 className="h-3 w-3 shrink-0" />
              {audioPlaying ? "Audio playing continuously" : "Audio loaded — plays when Preview Timeline starts"}
            </div>
          ) : (
            <span className="text-white/20">No song audio selected. Timeline preview will play silently.</span>
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

        {/* ── Debug / Status panel ── */}
        <div className="border border-white/[0.07] rounded-lg overflow-hidden">
          <button type="button" onClick={() => setDebugOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors">
            <span>Timeline Preview Status</span>
            {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {debugOpen && (
            <div className="px-3 pb-3 space-y-0.5 font-mono text-[10px] border-t border-white/[0.06]">
              <DR label="scenes loaded"    v={String(scenes.length)} />
              <DR label="captions loaded"  v={String(captionLines.length)} />
              <DR label="audio loaded"     v={audioReady ? "yes" : audioUrl ? "loading…" : "no"} />
              <DR label="audio playing"    v={audioPlaying ? "YES" : "no"} hi={audioPlaying} />
              <DR label="playing"          v={playing ? "YES" : "no"} hi={playing} />
              <DR label="current time"     v={`${masterTime.toFixed(2)}s`} hi={playing} />
              <DR label="total duration"   v={`${totalDur.toFixed(1)}s`} />
              <DR label="current scene"    v={`${sceneIdx+1} of ${scenes.length} · ${currentScene?.section||"—"} (${fmt(offsets[sceneIdx]??0)}–${fmt((offsets[sceneIdx]??0)+(durs[sceneIdx]??5))})`} />
              <DR label="has clip"         v={hasClip ? "yes (video)" : "no (timer)"} />
              <DR label="current caption"  v={
                activeLine
                  ? `"${activeLine.text}" (${activeLine.startSec.toFixed(1)}–${activeLine.endSec.toFixed(1)}s)`
                  : captionLines.length > 0 ? `none at ${masterTime.toFixed(1)}s` : "no captions"
              } hi={!!activeLine} />
              <DR label="last error"       v={lastError ?? "none"} err={!!lastError} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/* ─── Debug row ────────────────────────────────────────────────── */
function DR({ label, v, hi, err }: { label: string; v: string; hi?: boolean; err?: boolean }) {
  return (
    <div className="flex gap-2 pt-0.5">
      <span className="text-white/25 shrink-0 w-[130px]">{label}:</span>
      <span className={err ? "text-red-400" : hi ? "text-primary/80" : "text-white/50"}>{v}</span>
    </div>
  );
}
