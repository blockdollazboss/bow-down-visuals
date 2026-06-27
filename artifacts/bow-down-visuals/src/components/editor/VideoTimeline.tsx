import { useRef, useCallback, useEffect, useState } from "react";
import {
  Clock, Zap, ArrowRightLeft, ZoomIn, ZoomOut, Music2,
  AlertTriangle, RotateCcw, Scissors, PlusSquare, RefreshCw,
  LayoutList, Waves,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine, AppliedTransition, AudioVideoSyncMode } from "@/lib/editor-settings";

/* ── Helpers ─────────────────────────────────────────────────────── */

/** Parse timestamp into duration seconds. Returns 0 if absent/unparseable. */
function parseDurFallback(ts: string | null | undefined): number {
  if (!ts) return 0;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1] * 60 + +m[2];
    const e = +m[3] * 60 + +m[4];
    return e > s ? e - s : 0;
  }
  return 0;
}

function buildOffsets(durs: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of durs) { out.push(acc); acc += d; }
  return out;
}

function fmtSec(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const WAVEFORM_SAMPLES = 280;
const LABEL_W = 44;

/* ── Sync mode meta ────────────────────────────────────────────── */

const SYNC_MODES: {
  id: AudioVideoSyncMode;
  label: string;
  short: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    id: "keep-as-is",
    label: "Keep As-Is",
    short: "Keep",
    icon: <RotateCcw className="h-3 w-3" />,
    desc: "No changes. Audio and video each use their own real length. Nothing is stretched.",
  },
  {
    id: "trim-audio",
    label: "Trim Audio to Video",
    short: "Trim Audio",
    icon: <Scissors className="h-3 w-3" />,
    desc: "Audio is cut at the end of the last video clip. An optional fade-out is applied.",
  },
  {
    id: "extend-video",
    label: "Extend Video to Song",
    short: "Extend Video",
    icon: <PlusSquare className="h-3 w-3" />,
    desc: "Extra empty clip slots are shown for the remaining song length. Add clips to fill them.",
  },
  {
    id: "loop-clips",
    label: "Loop Clips to Song",
    short: "Loop Clips",
    icon: <RefreshCw className="h-3 w-3" />,
    desc: "Existing clips repeat from the beginning until they cover the full song duration.",
  },
  {
    id: "auto-fit",
    label: "Auto-Fit Clips to Song",
    short: "Auto-Fit",
    icon: <LayoutList className="h-3 w-3" />,
    desc: "Clips are evenly distributed across the entire song duration. No gaps, no overlap.",
  },
  {
    id: "fade-audio",
    label: "Fade Audio at Video End",
    short: "Fade Audio",
    icon: <Waves className="h-3 w-3" />,
    desc: "Clips play as-is. When the last clip ends, the audio fades out naturally.",
  },
];

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
  syncMode?: AudioVideoSyncMode;
  onSyncModeChange?: (mode: AudioVideoSyncMode) => void;
  /** Per-clip edits keyed by scene id — used to show lip sync badges. */
  clipEdits?: Record<string, import("@/lib/editor-settings").ClipEdit>;
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
  syncMode = "keep-as-is",
  onSyncModeChange,
  clipEdits,
  onSeek,
  onSceneClick,
}: VideoTimelineProps) {
  const clipsStripRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showSync, setShowSync] = useState(false);

  /* ── Waveform decode ── */
  const [waveformData, setWaveformData]                   = useState<number[] | null>(null);
  const [waveformLoading, setWaveformLoading]             = useState(false);
  const [waveformError, setWaveformError]                 = useState<string | null>(null);
  const [waveformAudioDuration, setWaveformAudioDuration] = useState<number | null>(null);

  useEffect(() => {
    if (!audioUrl) {
      setWaveformData(null);
      setWaveformError(null);
      setWaveformAudioDuration(null);
      return;
    }
    let cancelled = false;
    let ctx: AudioContext | null = null;

    setWaveformLoading(true);
    setWaveformError(null);
    setWaveformData(null);
    setWaveformAudioDuration(null);

    const run = async () => {
      try {
        ctx = new AudioContext();
        const resp = await fetch(audioUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf     = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        setWaveformAudioDuration(decoded.duration);
        const channel   = decoded.getChannelData(0);
        const blockSize = Math.max(1, Math.floor(channel.length / WAVEFORM_SAMPLES));
        const data: number[] = [];
        for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
          let sum = 0;
          const start = i * blockSize;
          const end   = Math.min(start + blockSize, channel.length);
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

  /* ── Duration accounting ──────────────────────────────────────── *
   *
   *  audioTotal   — real song duration from master player / decoder
   *  parsedDurs   — per-scene durations from timestamp strings (0 = unknown)
   *  parsedSum    — total of timestamp-based durations (may be 0)
   *  hasTimestamps— true when at least one scene carries a timestamp
   *
   * ──────────────────────────────────────────────────────────────── */

  const audioTotal: number =
    totalDurationSec ?? waveformAudioDuration ?? 0;

  const parsedDurs    = scenes.map((s) => parseDurFallback(s.timestamp));
  const hasTimestamps = parsedDurs.some((d) => d > 0);
  const parsedSum     = parsedDurs.reduce((a, b) => a + b, 0);

  /* Fallback per-scene duration when timestamps absent */
  const evenSceneDur = audioTotal > 0 && scenes.length > 0
    ? audioTotal / scenes.length
    : 5;

  /* Duration of the clips track depending on mode */
  const clipsDuration = (() => {
    if (syncMode === "auto-fit" || syncMode === "extend-video" || syncMode === "loop-clips") {
      return audioTotal > 0 ? audioTotal : parsedSum || evenSceneDur * scenes.length;
    }
    return hasTimestamps ? parsedSum : (audioTotal || evenSceneDur * scenes.length);
  })();

  const diffSec    = Math.abs(audioTotal - clipsDuration);
  const hasMismatch =
    audioTotal > 0 && clipsDuration > 0 && diffSec > 1.5;

  /* ── Compute durs/offsets/total per sync mode ── */
  const { durs, offsets, total, phantomSlots, loopedSlots } = (() => {
    const useEven = syncMode === "auto-fit" || syncMode === "extend-video" || syncMode === "loop-clips";
    const baseDurs = useEven
      ? scenes.map(() => evenSceneDur)
      : parsedDurs.map((d, i) => d > 0 ? d : (parsedDurs.find((x) => x > 0) ?? evenSceneDur) || 5);

    const baseSum = baseDurs.reduce((a, b) => a + b, 0);

    switch (syncMode) {
      case "keep-as-is": {
        const t = Math.max(audioTotal, baseSum, 1);
        return { durs: baseDurs, offsets: buildOffsets(baseDurs), total: t, phantomSlots: 0, loopedSlots: 0 };
      }
      case "trim-audio": {
        const t = Math.max(baseSum, 1);
        return { durs: baseDurs, offsets: buildOffsets(baseDurs), total: t, phantomSlots: 0, loopedSlots: 0 };
      }
      case "extend-video": {
        const t = Math.max(audioTotal, 1);
        const remaining = t - baseSum;
        const extraCount = remaining > 0 ? Math.ceil(remaining / evenSceneDur) : 0;
        return { durs: baseDurs, offsets: buildOffsets(baseDurs), total: t, phantomSlots: extraCount, loopedSlots: 0 };
      }
      case "loop-clips": {
        const t = Math.max(audioTotal, 1);
        const loopCount = baseSum > 0 ? Math.ceil((t - baseSum) / baseSum) : 0;
        return { durs: baseDurs, offsets: buildOffsets(baseDurs), total: t, phantomSlots: 0, loopedSlots: Math.max(0, loopCount) };
      }
      case "auto-fit":
      default: {
        const t = Math.max(audioTotal, baseSum, 1);
        return { durs: baseDurs, offsets: buildOffsets(baseDurs), total: t, phantomSlots: 0, loopedSlots: 0 };
      }
      case "fade-audio": {
        const t = Math.max(audioTotal, baseSum, 1);
        return { durs: baseDurs, offsets: buildOffsets(baseDurs), total: t, phantomSlots: 0, loopedSlots: 0 };
      }
    }
  })();

  /* Waveform and audio proportions */
  const waveformWidthPct: number = (() => {
    if (!audioTotal || !total) return 100;
    if (syncMode === "trim-audio") return Math.min(100, (audioTotal / total) * 100);
    return Math.min(100, (audioTotal / total) * 100);
  })();

  /* Fade overlay starts at clip end for "fade-audio" */
  const fadeStartPct: number =
    syncMode === "fade-audio" && total > 0
      ? Math.min(100, ((offsets[offsets.length - 1] ?? 0) + (durs[durs.length - 1] ?? 0)) / total * 100)
      : 100;

  /* Trim marker for "trim-audio" */
  const trimMarkerPct: number =
    syncMode === "trim-audio" && total > 0
      ? Math.min(100, (Math.min(audioTotal, total) / total) * 100)
      : -1;

  const timeToPercent = (t: number) => Math.max(0, Math.min(100, (t / total) * 100));
  const playheadPct   = `${timeToPercent(currentTimeSec)}%`;

  /* ── Seeking ── */
  const seekFromX = useCallback(
    (clientX: number) => {
      const strip = clipsStripRef.current;
      if (!strip) return;
      const rect = strip.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
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

  const zoomIn  = () => setZoom((z) => Math.min(8, Math.round(z * 1.5 * 10) / 10));
  const zoomOut = () => setZoom((z) => Math.max(1, Math.round((z / 1.5) * 10) / 10));

  const selectedMode = SYNC_MODES.find((m) => m.id === syncMode) ?? SYNC_MODES[0]!;

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05]">
        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
        <span className="text-[10px] font-black text-white/50 uppercase tracking-widest shrink-0">Timeline</span>

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

        {hasMismatch && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-yellow-500/40 bg-yellow-500/10 text-[9px] font-bold text-yellow-400">
            <AlertTriangle className="h-2.5 w-2.5" />
            {fmtSec(diffSec)} mismatch
          </span>
        )}

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-white/30 font-mono tabular-nums">
            {fmtSec(currentTimeSec)} / {audioTotal > 0 ? fmtSec(audioTotal) : "—:——"}
          </span>
          <span className="text-[10px] text-white/20">{scenes.length} scenes</span>
          <button type="button" onClick={() => setShowSync((s) => !s)}
            className={`px-1.5 py-0.5 rounded border text-[9px] font-bold transition-colors ${
              showSync
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-white/[0.06] text-white/25 hover:text-white/50 hover:border-white/15"
            }`}>
            Sync
          </button>
        </div>
      </div>

      {/* ── Sync status panel ── */}
      {showSync && (
        <div className="px-3 py-2 border-b border-white/[0.05] bg-black/25 grid grid-cols-2 gap-x-6 gap-y-0.5">
          {([
            ["audio duration",       audioTotal > 0 ? fmtSec(audioTotal) : "no audio"],
            ["waveform decoded",     waveformAudioDuration != null ? fmtSec(waveformAudioDuration) : waveformLoading ? "loading…" : "—"],
            ["video clips total",    clipsDuration > 0 ? fmtSec(clipsDuration) : "—"],
            ["audio/video diff",     hasMismatch ? fmtSec(diffSec) : "✓ matched"],
            ["sync mode",            selectedMode.label],
            ["audio stretched",      syncMode === "auto-fit" ? "no (even dist.)" : "no"],
            ["clips stretched",      "no"],
            ["shared playhead",      "yes"],
          ] as const).map(([lbl, val]) => (
            <div key={lbl} className="flex items-center justify-between gap-1">
              <span className="text-[9px] font-mono text-white/28">{lbl}</span>
              <span className={`text-[9px] font-bold shrink-0 ${
                val === "✓ matched" || val === "yes" || val === "no" ? "text-green-400"
                  : val === "loading…"                               ? "text-amber-400 animate-pulse"
                  : lbl === "audio/video diff"                       ? "text-yellow-400"
                  : val === "no audio" || val === "—"                ? "text-white/25"
                  : "text-[#C9A84C]"
              }`}>{val}</span>
            </div>
          ))}
          <div className="col-span-2 flex items-center justify-between gap-1 border-t border-white/[0.04] pt-0.5 mt-0.5">
            <span className="text-[9px] font-mono text-white/28">current / total</span>
            <span className="text-[9px] font-bold text-white/50 font-mono tabular-nums">
              {fmtSec(currentTimeSec)} / {audioTotal > 0 ? fmtSec(audioTotal) : "—:——"}
            </span>
          </div>
        </div>
      )}

      {/* ── Scrollable multi-track area ── */}
      <div className="overflow-x-auto">
        <div style={{ width: zoom === 1 ? "100%" : `${zoom * 100}%`, minWidth: `${Math.max(scenes.length * 56, 280)}px` }}>

          {/* ── Shared time ruler ── */}
          <div className="flex border-b border-white/[0.04]">
            <div className="shrink-0 border-r border-white/[0.06] bg-black/30" style={{ width: LABEL_W }} />
            <div className="relative flex-1 h-5 bg-black/20 select-none">
              {total > 0 && (() => {
                const steps = Math.min(20, Math.max(4, Math.floor(total)));
                return Array.from({ length: steps + 1 }, (_, idx) => {
                  const sec = (idx / steps) * total;
                  return (
                    <div key={idx} className="absolute top-0 bottom-0 flex flex-col justify-end pointer-events-none"
                      style={{ left: `${(sec / total) * 100}%` }}>
                      <div className={`w-px ${idx % 4 === 0 ? "h-3 bg-white/20" : "h-1.5 bg-white/10"}`} />
                      {idx % 4 === 0 && (
                        <span className="absolute bottom-0 text-[7px] font-mono text-white/30 translate-x-0.5 whitespace-nowrap">
                          {fmtSec(sec)}
                        </span>
                      )}
                    </div>
                  );
                });
              })()}
              <div className="absolute top-0 bottom-0 w-px pointer-events-none z-10"
                style={{ left: playheadPct, background: "rgba(201,168,76,0.8)" }} />
            </div>
          </div>

          {/* ── Video Clips Track ── */}
          <div className="flex border-b border-white/[0.05]">
            <div className="shrink-0 flex flex-col items-center justify-center gap-0.5 border-r border-white/[0.06] bg-black/30"
              style={{ width: LABEL_W }}>
              <span className="text-[8px] font-bold text-white/25 uppercase tracking-widest">Video</span>
            </div>

            <div
              ref={clipsStripRef}
              className="relative flex-1 cursor-crosshair select-none"
              style={{ minHeight: 68 }}
              onClick={(e) => { if (!isDragging) seekFromX(e.clientX); }}
            >
              {/* Real clip blocks */}
              {scenes.map((scene, i) => {
                const startSec  = offsets[i] ?? (i * evenSceneDur);
                const dur       = durs[i] ?? evenSceneDur;
                const leftPct   = (startSec / total) * 100;
                const widthPct  = (dur / total) * 100;
                const isActive  = i === computedActiveIdx;
                const hasClip   = !!(scene.demoClipUrl || scene.thumbnailUrl);
                const transition = appliedTransitions.find((t) => t.sceneIndex === i + 1);

                return (
                  <div
                    key={scene.id}
                    className={`absolute top-0 bottom-0 border-r border-white/[0.06] transition-colors duration-150 ${
                      isActive
                        ? "bg-primary/[0.10] border-t-2 border-t-primary"
                        : "bg-white/[0.015] border-t-2 border-t-transparent hover:bg-white/[0.04]"
                    }`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSceneClick?.(scene.id, startSec);
                      onSeek?.(startSec);
                    }}
                    title={`Scene ${i + 1} · ${scene.section || scene.lyricLine || ""} · ${dur.toFixed(1)}s`}
                  >
                    {scene.thumbnailUrl && (
                      <div className="absolute inset-0 opacity-20"
                        style={{ backgroundImage: `url(${scene.thumbnailUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                    )}
                    <div className="relative z-10 p-1.5 pb-1 flex flex-col h-full overflow-hidden">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className={`inline-flex items-center justify-center h-4 min-w-[16px] rounded px-1 text-[9px] font-black shrink-0 ${
                          isActive ? "bg-primary text-black" : "bg-white/10 text-white/60"
                        }`}>{i + 1}</span>
                        <span className={`h-1 w-1 rounded-full shrink-0 ${hasClip ? "bg-green-400/70" : "bg-white/20"}`} />
                      </div>
                      <p className="text-[9px] font-semibold text-white/55 truncate leading-tight flex-1 min-w-0">
                        {scene.section || scene.lyricLine || `Scene ${i + 1}`}
                      </p>
                      <div className="flex items-center gap-1 mt-auto pt-0.5 flex-wrap">
                        <span className="text-[8px] font-mono text-white/30 shrink-0">{dur.toFixed(1)}s</span>
                        {hasEffects && <Zap className="h-2 w-2 text-amber-400/60 shrink-0" />}
                        {transition && transition.transitionType !== "Cut" && (
                          <ArrowRightLeft className="h-2 w-2 text-blue-400/60 shrink-0" />
                        )}
                        {clipEdits?.[scene.id]?.lipSyncStatus === "done" && (
                          <span className="text-[7px] font-black text-green-400/80 bg-green-400/10 border border-green-400/20 rounded px-0.5 leading-tight shrink-0">LS✓</span>
                        )}
                        {clipEdits?.[scene.id]?.lipSyncStatus === "processing" && (
                          <span className="text-[7px] font-black text-primary/80 bg-primary/10 border border-primary/20 rounded px-0.5 leading-tight shrink-0">LS…</span>
                        )}
                        {clipEdits?.[scene.id]?.lipSyncStatus === "failed" && (
                          <span className="text-[7px] font-black text-red-400/80 bg-red-400/10 border border-red-400/20 rounded px-0.5 leading-tight shrink-0">LS✗</span>
                        )}
                      </div>
                    </div>
                    {i < scenes.length - 1 && (
                      <div className={`absolute top-0 right-0 w-0.5 h-full ${
                        transition && transition.transitionType !== "Cut" ? "bg-blue-500/40" : "bg-white/[0.04]"
                      }`} />
                    )}
                  </div>
                );
              })}

              {/* Phantom slots — extend-video mode */}
              {syncMode === "extend-video" && phantomSlots > 0 && (() => {
                const realEnd = (offsets[offsets.length - 1] ?? 0) + (durs[durs.length - 1] ?? 0);
                return Array.from({ length: phantomSlots }, (_, k) => {
                  const slotStart = realEnd + k * evenSceneDur;
                  const slotEnd   = Math.min(slotStart + evenSceneDur, total);
                  const lp = (slotStart / total) * 100;
                  const wp = ((slotEnd - slotStart) / total) * 100;
                  return (
                    <div key={`phantom-${k}`}
                      className="absolute top-0 bottom-0 border border-dashed border-white/20 border-t-2 border-t-white/15 bg-white/[0.005]"
                      style={{ left: `${lp}%`, width: `${wp}%` }}>
                      <div className="flex items-center justify-center h-full">
                        <span className="text-[8px] text-white/20 font-mono">+{k + 1}</span>
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Loop ghost clips — loop-clips mode */}
              {syncMode === "loop-clips" && loopedSlots > 0 && (() => {
                const realEnd = (offsets[offsets.length - 1] ?? 0) + (durs[durs.length - 1] ?? 0);
                const loopItems: React.ReactNode[] = [];
                let cursor = realEnd;
                let loopPass = 0;
                while (cursor < total && loopPass < loopedSlots) {
                  for (let i = 0; i < scenes.length && cursor < total; i++) {
                    const scene = scenes[i]!;
                    const dur   = durs[i] ?? evenSceneDur;
                    const end   = Math.min(cursor + dur, total);
                    const lp    = (cursor / total) * 100;
                    const wp    = ((end - cursor) / total) * 100;
                    loopItems.push(
                      <div key={`loop-${loopPass}-${i}`}
                        className="absolute top-0 bottom-0 border-r border-white/[0.04] bg-white/[0.01] border-t-2 border-t-white/10 opacity-45"
                        style={{ left: `${lp}%`, width: `${wp}%` }}>
                        <div className="p-1 flex flex-col h-full overflow-hidden">
                          <p className="text-[8px] font-mono text-white/20 truncate leading-tight">
                            ↺ {scene.section || `S${i + 1}`}
                          </p>
                        </div>
                      </div>
                    );
                    cursor = end;
                  }
                  loopPass++;
                }
                return loopItems;
              })()}

              {/* Playhead — video track */}
              <div className="absolute top-0 bottom-0 w-px z-20 pointer-events-none"
                style={{ left: playheadPct, background: "rgba(201,168,76,1)", boxShadow: "0 0 6px rgba(201,168,76,0.6)" }}>
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
            <div className="shrink-0 flex flex-col items-center justify-center gap-0.5 border-r border-white/[0.06] bg-black/30"
              style={{ width: LABEL_W }}>
              <Music2 className="h-3 w-3 text-white/20" />
              <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Audio</span>
              {waveformAudioDuration != null && (
                <span className="text-[7px] font-mono text-white/18 mt-0.5">{fmtSec(waveformAudioDuration)}</span>
              )}
            </div>

            <div
              className="relative flex-1 h-14 bg-black/25 cursor-crosshair overflow-hidden"
              onClick={(e) => seekFromX(e.clientX)}
              onMouseDown={startDrag}
            >
              {waveformLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-[9px] text-white/25 animate-pulse">Generating waveform…</span>
                </div>
              )}
              {waveformError && !waveformLoading && (
                <div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
                  <span className="text-[9px] text-red-400/60">Waveform error: {waveformError}</span>
                </div>
              )}
              {!audioUrl && !waveformLoading && !waveformError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-[9px] text-white/18">Add a song to see waveform</span>
                </div>
              )}

              {/* Waveform SVG — proportional to real audio duration */}
              {waveformData && (
                <svg
                  style={{
                    position: "absolute",
                    top: 0, left: 0, bottom: 0,
                    width: `${waveformWidthPct}%`,
                    height: "100%",
                  }}
                  preserveAspectRatio="none"
                  viewBox={`0 0 ${WAVEFORM_SAMPLES} 100`}
                >
                  <line x1="0" y1="50" x2={WAVEFORM_SAMPLES} y2="50" stroke="rgba(201,168,76,0.08)" strokeWidth="0.5" />
                  {waveformData.map((amp, i) => {
                    const barH = Math.max(2, amp * 88);
                    const y    = 50 - barH / 2;
                    return (
                      <rect key={i} x={i + 0.15} y={y} width={0.7} height={barH}
                        fill="rgba(201,168,76,0.42)" rx="0.2" />
                    );
                  })}
                </svg>
              )}

              {/* Fade-audio overlay — dims audio after clip end */}
              {syncMode === "fade-audio" && fadeStartPct < 100 && (
                <div className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left: `${fadeStartPct}%`,
                    right: 0,
                    background: "linear-gradient(to right, transparent, rgba(0,0,0,0.65))",
                  }}
                />
              )}

              {/* Trim marker — trim-audio mode */}
              {syncMode === "trim-audio" && trimMarkerPct >= 0 && (
                <div className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: `${trimMarkerPct}%` }}>
                  <div className="absolute top-0 bottom-0 w-0.5 bg-red-500/60" />
                  <div className="absolute top-1 left-1 text-[7px] font-bold text-red-400/80 whitespace-nowrap">
                    ✂ trim
                  </div>
                </div>
              )}

              {/* Playhead — audio track */}
              <div className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
                style={{ left: playheadPct, background: "rgba(201,168,76,0.9)", boxShadow: "0 0 4px rgba(201,168,76,0.5)" }} />
            </div>
          </div>

        </div>
      </div>

      {/* ── Sync Mode Picker ────────────────────────────────────── */}
      <div className="border-t border-white/[0.05] bg-black/20">

        {/* Duration summary row */}
        <div className="flex items-center gap-4 px-3 pt-2.5 pb-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 text-[9px] font-mono">
            <Music2 className="h-3 w-3 text-[#C9A84C]/60 shrink-0" />
            <span className="text-white/35">Audio</span>
            <span className="text-[#C9A84C] font-bold">{audioTotal > 0 ? fmtSec(audioTotal) : "—"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-mono">
            <span className="h-3 w-3 rounded-sm bg-white/15 shrink-0 inline-block" />
            <span className="text-white/35">Video</span>
            <span className="text-white/60 font-bold">{clipsDuration > 0 ? fmtSec(clipsDuration) : "—"}</span>
          </div>
          {hasMismatch ? (
            <div className="flex items-center gap-1 text-[9px] font-mono">
              <AlertTriangle className="h-2.5 w-2.5 text-yellow-400 shrink-0" />
              <span className="text-yellow-400 font-bold">
                {audioTotal > clipsDuration ? "+" : "-"}{fmtSec(diffSec)} diff
              </span>
            </div>
          ) : audioTotal > 0 && (
            <span className="text-[9px] font-mono text-green-400/70">✓ lengths match</span>
          )}
          <span className="ml-auto text-[8px] font-black text-white/20 uppercase tracking-widest">Sync Mode</span>
        </div>

        {/* Mode buttons */}
        <div className="grid grid-cols-3 gap-1 px-3 pb-1.5">
          {SYNC_MODES.map((mode) => {
            const isSelected = syncMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onSyncModeChange?.(mode.id)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-white/[0.06] bg-white/[0.015] text-white/35 hover:border-white/15 hover:text-white/60 hover:bg-white/[0.04]"
                }`}
                title={mode.desc}
              >
                <span className={`shrink-0 ${isSelected ? "text-primary" : "text-white/25"}`}>
                  {mode.icon}
                </span>
                <span className="text-[9px] font-bold leading-tight truncate">{mode.short}</span>
              </button>
            );
          })}
        </div>

        {/* Selected mode description */}
        <div className="px-3 pb-2.5">
          <p className="text-[9px] text-white/35 leading-relaxed">
            <span className="text-primary/70 font-bold">{selectedMode.label}:</span>{" "}
            {selectedMode.desc}
          </p>
        </div>

      </div>

      {/* ── Footer legend ── */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-white/[0.04] flex-wrap">
        <div className="flex items-center gap-1">
          <div className="h-px w-3 bg-primary/50" />
          <span className="text-[9px] text-white/25">playhead</span>
        </div>
        {captionLines.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="h-1 w-3 rounded-full bg-primary/35" />
            <span className="text-[9px] text-white/25">captions</span>
          </div>
        )}
        {hasEffects && (
          <div className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5 text-amber-400/50" />
            <span className="text-[9px] text-white/25">effects</span>
          </div>
        )}
        {waveformData && (
          <div className="flex items-center gap-1">
            <Music2 className="h-2.5 w-2.5 text-primary/40" />
            <span className="text-[9px] text-white/25">
              audio {waveformAudioDuration != null ? fmtSec(waveformAudioDuration) : "loaded"}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <Clock className="h-2.5 w-2.5 text-white/20" />
          <span className="text-[9px] text-white/25">click or drag to scrub</span>
        </div>
      </div>

    </div>
  );
}
