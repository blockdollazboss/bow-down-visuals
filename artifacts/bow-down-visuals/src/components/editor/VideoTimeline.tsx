import { useRef, useCallback, useEffect, useState } from "react";
import { Clock, Zap, ArrowRightLeft, ZoomIn, ZoomOut, Music2 } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine, AppliedTransition } from "@/lib/editor-settings";

/* ── Helpers ─────────────────────────────────────────────────────── */

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

function buildOffsets(durs: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of durs) { out.push(acc); acc += d; }
  return out;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const WAVEFORM_SAMPLES = 280;
const LABEL_W = 44; /* px — track label column width */

/* ── Types ─────────────────────────────────────────────────────────── */

export interface VideoTimelineProps {
  scenes: SceneData[];
  currentTimeSec: number;
  totalDurationSec?: number;
  captionLines?: CaptionLine[];
  effects?: string[];
  appliedTransitions?: AppliedTransition[];
  activeSceneIndex?: number;
  audioUrl?: string | null;
  onSeek?: (sec: number) => void;
  onSceneClick?: (sceneId: string, startSec: number) => void;
}

/* ── Component ──────────────────────────────────────────────────────── */

export function VideoTimeline({
  scenes,
  currentTimeSec,
  totalDurationSec,
  captionLines = [],
  effects = [],
  appliedTransitions = [],
  activeSceneIndex,
  audioUrl,
  onSeek,
  onSceneClick,
}: VideoTimelineProps) {
  /* ── Refs ── */
  const clipsStripRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /* ── Zoom ── */
  const [zoom, setZoom] = useState(1);

  /* ── Sync status panel ── */
  const [showSync, setShowSync] = useState(false);

  /* ── Waveform ── */
  const [waveformData, setWaveformData]     = useState<number[] | null>(null);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [waveformError, setWaveformError]   = useState<string | null>(null);

  useEffect(() => {
    if (!audioUrl) {
      setWaveformData(null);
      setWaveformError(null);
      return;
    }
    let cancelled = false;
    let ctx: AudioContext | null = null;

    setWaveformLoading(true);
    setWaveformError(null);
    setWaveformData(null);

    const run = async () => {
      try {
        ctx = new AudioContext();
        const resp = await fetch(audioUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) return;

        const channel = decoded.getChannelData(0);
        const blockSize = Math.max(1, Math.floor(channel.length / WAVEFORM_SAMPLES));
        const data: number[] = [];
        for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
          let sum = 0;
          const start = i * blockSize;
          const end = Math.min(start + blockSize, channel.length);
          for (let j = start; j < end; j++) sum += Math.abs(channel[j] ?? 0);
          data.push(sum / Math.max(1, end - start));
        }
        const max = Math.max(...data, 0.001);
        setWaveformData(data.map((v) => v / max));
      } catch (err) {
        if (!cancelled) setWaveformError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setWaveformLoading(false);
        void ctx?.close();
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [audioUrl]);

  /* ── Durations / offsets / total ── */
  const durs       = scenes.map((s) => parseDur(s.timestamp));
  const offsets    = buildOffsets(durs);
  const scenesTotal = durs.reduce((a, b) => a + b, 0);
  const total      = Math.max(totalDurationSec ?? scenesTotal, scenesTotal, 1);

  const timeToPercent = (t: number) => Math.max(0, Math.min(100, (t / total) * 100));

  /* ── Seeking ── */
  const seekFromX = useCallback(
    (clientX: number) => {
      const strip = clipsStripRef.current;
      if (!strip) return;
      const rect = strip.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek?.(pct * total);
    },
    [total, onSeek],
  );

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => seekFromX(e.clientX);
    const onUp   = () => setIsDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, seekFromX]);

  /* ── Active scene ── */
  const computedActiveIdx =
    activeSceneIndex ??
    (() => {
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (currentTimeSec >= (offsets[i] ?? 0)) return i;
      }
      return 0;
    })();

  const hasEffects = effects.length > 0;

  if (scenes.length === 0) return null;

  /* ── Zoom helpers ── */
  const zoomIn  = () => setZoom((z) => Math.min(8, Math.round(z * 1.5 * 10) / 10));
  const zoomOut = () => setZoom((z) => Math.max(1, Math.round((z / 1.5) * 10) / 10));

  /* playhead left % (same for all tracks) */
  const playheadPct = `${timeToPercent(currentTimeSec)}%`;

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05]">
        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
        <span className="text-[10px] font-black text-white/50 uppercase tracking-widest shrink-0">Timeline</span>

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 ml-1">
          <button type="button" onClick={zoomOut} disabled={zoom <= 1} title="Zoom out"
            className="flex items-center justify-center h-5 w-5 rounded text-white/30 hover:text-white/70 disabled:opacity-20 transition-colors">
            <ZoomOut className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => setZoom(1)} title="Fit timeline"
            className="px-1.5 h-5 rounded text-[9px] font-bold text-white/30 hover:text-white/60 border border-white/[0.06] hover:border-white/20 transition-colors">
            Fit
          </button>
          <button type="button" onClick={zoomIn} disabled={zoom >= 8} title="Zoom in"
            className="flex items-center justify-center h-5 w-5 rounded text-white/30 hover:text-white/70 disabled:opacity-20 transition-colors">
            <ZoomIn className="h-3 w-3" />
          </button>
          {zoom > 1 && <span className="text-[9px] font-mono text-white/25 ml-0.5">{zoom.toFixed(1)}×</span>}
        </div>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-white/30 font-mono tabular-nums">
            {fmtSec(currentTimeSec)} / {fmtSec(total)}
          </span>
          <span className="text-[10px] text-white/20">{scenes.length} scenes</span>
          <button type="button" onClick={() => setShowSync((s) => !s)}
            className={`px-1.5 py-0.5 rounded border text-[9px] font-bold transition-colors ${
              showSync ? "border-primary/30 bg-primary/10 text-primary" : "border-white/[0.06] text-white/25 hover:text-white/50 hover:border-white/15"
            }`}>
            Sync
          </button>
        </div>
      </div>

      {/* ── Sync status panel ── */}
      {showSync && (
        <div className="px-3 py-2 border-b border-white/[0.05] bg-black/25 grid grid-cols-2 gap-x-6 gap-y-0.5">
          {([
            ["master player connected", "yes"],
            ["audio waveform loaded",   waveformData ? "yes" : waveformLoading ? "loading…" : audioUrl ? "no" : "no audio"],
            ["video track loaded",      scenes.length > 0 ? "yes" : "no"],
            ["dragged order applied",   "yes"],
            ["playhead synced",         "yes"],
            ["export order source",     "timeline order"],
          ] as const).map(([lbl, val]) => (
            <div key={lbl} className="flex items-center justify-between gap-1">
              <span className="text-[9px] font-mono text-white/28">{lbl}</span>
              <span className={`text-[9px] font-bold shrink-0 ${
                val === "yes" || val === "timeline order" ? "text-green-400"
                  : val === "loading…" ? "text-amber-400 animate-pulse"
                  : "text-white/35"
              }`}>{val}</span>
            </div>
          ))}
          <div className="col-span-2 flex items-center justify-between gap-1 border-t border-white/[0.04] pt-0.5 mt-0.5">
            <span className="text-[9px] font-mono text-white/28">current time / total</span>
            <span className="text-[9px] font-bold text-white/50 font-mono tabular-nums">
              {fmtSec(currentTimeSec)} / {fmtSec(total)}
            </span>
          </div>
        </div>
      )}

      {/* ── Scrollable multi-track area ── */}
      <div className="overflow-x-auto">
        <div style={{ width: zoom === 1 ? "100%" : `${zoom * 100}%`, minWidth: `${Math.max(scenes.length * 56, 280)}px` }}>

          {/* ── Video Clips Track ── */}
          <div className="flex border-b border-white/[0.05]">
            {/* Label */}
            <div className="shrink-0 flex flex-col items-center justify-center gap-0.5 border-r border-white/[0.06] bg-black/30"
              style={{ width: LABEL_W }}>
              <span className="text-[8px] font-bold text-white/25 uppercase tracking-widest">Video</span>
            </div>
            {/* Clip blocks */}
            <div
              ref={clipsStripRef}
              className="relative flex flex-1 cursor-crosshair select-none"
              onClick={(e) => { if (!isDragging) seekFromX(e.clientX); }}
            >
              {scenes.map((scene, i) => {
                const dur       = durs[i] ?? 5;
                const startSec  = offsets[i] ?? 0;
                const isActive  = i === computedActiveIdx;
                const hasClip   = !!(scene.demoClipUrl || scene.thumbnailUrl);
                const transition = appliedTransitions.find((t) => t.sceneIndex === i + 1);

                return (
                  <div
                    key={scene.id}
                    className={`relative border-r border-white/[0.06] shrink-0 transition-colors duration-150 ${
                      isActive
                        ? "bg-primary/[0.10] border-t-2 border-t-primary"
                        : "bg-white/[0.015] border-t-2 border-t-transparent hover:bg-white/[0.04]"
                    }`}
                    style={{ flex: dur, minWidth: 52 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSceneClick?.(scene.id, startSec);
                      onSeek?.(startSec);
                    }}
                    title={`Scene ${i + 1} · ${scene.section || scene.lyricLine || ""} · ${dur.toFixed(1)}s`}
                  >
                    {/* Thumbnail bg */}
                    {scene.thumbnailUrl && (
                      <div className="absolute inset-0 opacity-20"
                        style={{ backgroundImage: `url(${scene.thumbnailUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                    )}

                    <div className="relative z-10 p-1.5 pb-1 flex flex-col h-full min-h-[68px]">
                      {/* Scene badge */}
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className={`inline-flex items-center justify-center h-4 min-w-[16px] rounded px-1 text-[9px] font-black shrink-0 ${
                          isActive ? "bg-primary text-black" : "bg-white/10 text-white/60"
                        }`}>{i + 1}</span>
                        <span className={`h-1 w-1 rounded-full shrink-0 ${hasClip ? "bg-green-400/70" : "bg-white/20"}`}
                          title={hasClip ? "Has clip" : "No clip"} />
                      </div>

                      {/* Title */}
                      <p className="text-[9px] font-semibold text-white/55 truncate leading-tight flex-1">
                        {scene.section || scene.lyricLine || `Scene ${i + 1}`}
                      </p>

                      {/* Duration + markers */}
                      <div className="flex items-center gap-1 mt-auto pt-0.5 flex-wrap">
                        <span className="text-[8px] font-mono text-white/30 shrink-0">{dur.toFixed(1)}s</span>
                        {hasEffects && <span title="Effect active"><Zap className="h-2 w-2 text-amber-400/60 shrink-0" /></span>}
                        {transition && transition.transitionType !== "Cut" && (
                          <span title={`Transition: ${transition.transitionType}`}>
                            <ArrowRightLeft className="h-2 w-2 text-blue-400/60 shrink-0" />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Transition tick */}
                    {i < scenes.length - 1 && (
                      <div className={`absolute top-0 right-0 w-0.5 h-full ${
                        transition && transition.transitionType !== "Cut" ? "bg-blue-500/40" : "bg-white/[0.04]"
                      }`} />
                    )}
                  </div>
                );
              })}

              {/* Playhead — video track */}
              <div className="absolute top-0 bottom-0 w-px z-20 pointer-events-none"
                style={{ left: playheadPct, background: "rgba(201,168,76,1)", boxShadow: "0 0 6px rgba(201,168,76,0.6)" }}>
                {/* Draggable handle */}
                <div
                  className="absolute -top-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-[#C9A84C] bg-black cursor-ew-resize pointer-events-auto"
                  style={{ boxShadow: "0 0 8px rgba(201,168,76,0.8)" }}
                  onMouseDown={startDrag}
                />
              </div>
            </div>
          </div>

          {/* ── Caption markers track ── */}
          {captionLines.length > 0 && (
            <div className="flex border-b border-white/[0.04]">
              <div className="shrink-0 flex items-center justify-center border-r border-white/[0.06] bg-black/30"
                style={{ width: LABEL_W }}>
                <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Cap</span>
              </div>
              <div className="relative flex-1 h-3 bg-white/[0.01] cursor-crosshair"
                onClick={(e) => seekFromX(e.clientX)}>
                {captionLines.map((line, i) => {
                  const leftPct  = timeToPercent(line.startSec);
                  const widthPct = Math.max(0.3, timeToPercent(line.endSec) - leftPct);
                  return (
                    <div key={i} className="absolute top-0.5 h-2 rounded-full bg-primary/30"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }} title={line.text} />
                  );
                })}
                <div className="absolute top-0 bottom-0 w-px pointer-events-none"
                  style={{ left: playheadPct, background: "rgba(201,168,76,0.6)" }} />
              </div>
            </div>
          )}

          {/* ── Audio Waveform Track ── */}
          <div className="flex">
            {/* Label */}
            <div className="shrink-0 flex flex-col items-center justify-center gap-0.5 border-r border-white/[0.06] bg-black/30"
              style={{ width: LABEL_W }}>
              <Music2 className="h-3 w-3 text-white/20" />
              <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Audio</span>
            </div>

            {/* Waveform area */}
            <div
              className="relative flex-1 h-14 bg-black/25 cursor-crosshair overflow-hidden"
              onClick={(e) => seekFromX(e.clientX)}
              onMouseDown={startDrag}
            >
              {/* Loading */}
              {waveformLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-[9px] text-white/25 animate-pulse">Generating waveform…</span>
                </div>
              )}

              {/* Error */}
              {waveformError && !waveformLoading && (
                <div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
                  <span className="text-[9px] text-red-400/60">Audio waveform failed: {waveformError}</span>
                </div>
              )}

              {/* No audio */}
              {!audioUrl && !waveformLoading && !waveformError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-[9px] text-white/18">Add a song to see waveform</span>
                </div>
              )}

              {/* Waveform SVG */}
              {waveformData && (
                <svg
                  className="absolute inset-0 w-full h-full"
                  preserveAspectRatio="none"
                  viewBox={`0 0 ${WAVEFORM_SAMPLES} 100`}
                >
                  {/* Centre line */}
                  <line x1="0" y1="50" x2={WAVEFORM_SAMPLES} y2="50" stroke="rgba(201,168,76,0.08)" strokeWidth="0.5" />
                  {/* Bars */}
                  {waveformData.map((amp, i) => {
                    const barH = Math.max(2, amp * 88);
                    const y    = 50 - barH / 2;
                    return (
                      <rect key={i} x={i + 0.15} y={y} width={0.7} height={barH}
                        fill="rgba(201,168,76,0.42)" rx="0.2" />
                    );
                  })}
                  {/* Scenes-end marker (if audio extends beyond clips) */}
                  {totalDurationSec && totalDurationSec > scenesTotal && (
                    <line
                      x1={(scenesTotal / total) * WAVEFORM_SAMPLES}
                      y1="0"
                      x2={(scenesTotal / total) * WAVEFORM_SAMPLES}
                      y2="100"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="0.5"
                      strokeDasharray="2 2"
                    />
                  )}
                </svg>
              )}

              {/* Time ruler ticks */}
              {total > 0 && (() => {
                const steps = Math.min(20, Math.floor(total));
                return Array.from({ length: steps + 1 }, (_, idx) => {
                  const tickSec = (idx / steps) * total;
                  return (
                    <div key={idx} className="absolute top-0 flex flex-col items-start pointer-events-none"
                      style={{ left: `${(tickSec / total) * 100}%` }}>
                      <div className="w-px h-2 bg-white/10" />
                      {idx % 4 === 0 && (
                        <span className="text-[7px] font-mono text-white/20 mt-px translate-x-0.5">{fmtSec(tickSec)}</span>
                      )}
                    </div>
                  );
                });
              })()}

              {/* Playhead — audio track */}
              <div className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
                style={{ left: playheadPct, background: "rgba(201,168,76,0.9)", boxShadow: "0 0 4px rgba(201,168,76,0.5)" }} />
            </div>
          </div>

        </div>
      </div>

      {/* ── Footer legend ── */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-white/[0.04] flex-wrap">
        <div className="flex items-center gap-1">
          <div className="h-1 w-3 rounded-full bg-primary/40" />
          <span className="text-[9px] text-white/25">captions</span>
        </div>
        {hasEffects && (
          <div className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5 text-amber-400/50" />
            <span className="text-[9px] text-white/25">effects</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <ArrowRightLeft className="h-2.5 w-2.5 text-blue-400/40" />
          <span className="text-[9px] text-white/25">transition</span>
        </div>
        {waveformData && (
          <div className="flex items-center gap-1">
            <Music2 className="h-2.5 w-2.5 text-primary/40" />
            <span className="text-[9px] text-white/25">waveform loaded</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Clock className="h-2.5 w-2.5 text-white/20" />
          <span className="text-[9px] text-white/25">click or drag to scrub</span>
        </div>
      </div>

    </div>
  );
}
