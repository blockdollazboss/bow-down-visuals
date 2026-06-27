import { useRef, useCallback, useEffect, useState } from "react";
import { Clock, Zap, ArrowRightLeft } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine, AppliedTransition } from "@/lib/editor-settings";

/* ── Duration parser (same logic as TimelinePreviewPlayer) ──────── */
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

/* ─────────────────────────────────────────────────────────────────── */

export interface VideoTimelineProps {
  scenes: SceneData[];
  currentTimeSec: number;
  totalDurationSec?: number;
  captionLines?: CaptionLine[];
  effects?: string[];
  appliedTransitions?: AppliedTransition[];
  activeSceneIndex?: number;
  onSeek?: (sec: number) => void;
  onSceneClick?: (sceneId: string, startSec: number) => void;
}

export function VideoTimeline({
  scenes,
  currentTimeSec,
  totalDurationSec,
  captionLines = [],
  effects = [],
  appliedTransitions = [],
  activeSceneIndex,
  onSeek,
  onSceneClick,
}: VideoTimelineProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const durs = scenes.map((s) => parseDur(s.timestamp));
  const offsets = buildOffsets(durs);
  const total = (totalDurationSec ?? durs.reduce((a, b) => a + b, 0)) || 1;

  const timeToPercent = (t: number) => Math.max(0, Math.min(100, (t / total) * 100));

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const strip = stripRef.current;
      if (!strip) return;
      const rect = strip.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek?.(pct * total);
    },
    [total, onSeek],
  );

  const onPlayheadMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => seekFromEvent(e.clientX);
    const onUp = () => setIsDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, seekFromEvent]);

  const onStripClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    seekFromEvent(e.clientX);
  };

  const hasEffects = effects.length > 0;

  /* Determine active scene index from currentTimeSec if not provided */
  const computedActiveIdx =
    activeSceneIndex ??
    (() => {
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (currentTimeSec >= (offsets[i] ?? 0)) return i;
      }
      return 0;
    })();

  if (scenes.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Timeline</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-white/30 font-mono">{fmtSec(currentTimeSec)} / {fmtSec(total)}</span>
          <span className="text-[10px] text-white/20">{scenes.length} scenes</span>
        </div>
      </div>

      {/* Scrollable timeline strip */}
      <div className="overflow-x-auto">
        <div
          ref={stripRef}
          className="relative flex cursor-crosshair select-none"
          style={{ minWidth: `${Math.max(scenes.length * 60, 300)}px` }}
          onClick={onStripClick}
        >
          {/* Clip blocks */}
          {scenes.map((scene, i) => {
            const dur = durs[i] ?? 5;
            const startSec = offsets[i] ?? 0;
            const isActive = i === computedActiveIdx;
            const hasClip = !!(scene.demoClipUrl || scene.thumbnailUrl);
            const transition = appliedTransitions.find((t) => t.sceneIndex === i + 1);

            return (
              <div
                key={scene.id}
                className={`relative border-r border-white/[0.06] shrink-0 transition-colors duration-150 ${
                  isActive
                    ? "bg-primary/[0.10] border-t-2 border-t-primary"
                    : "bg-white/[0.015] border-t-2 border-t-transparent hover:bg-white/[0.035]"
                }`}
                style={{ flex: dur, minWidth: 60 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSceneClick?.(scene.id, startSec);
                  onSeek?.(startSec);
                }}
                title={`Scene ${i + 1} · ${scene.section || scene.lyricLine || ""} · ${dur.toFixed(1)}s`}
              >
                {/* Thumbnail background */}
                {scene.thumbnailUrl && (
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{ backgroundImage: `url(${scene.thumbnailUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                  />
                )}

                <div className="relative z-10 p-1.5 pb-1 flex flex-col h-full min-h-[72px]">
                  {/* Scene number badge */}
                  <div className="flex items-center gap-1 mb-1">
                    <span
                      className={`inline-flex items-center justify-center h-4 min-w-[16px] rounded px-1 text-[9px] font-black shrink-0 ${
                        isActive ? "bg-primary text-black" : "bg-white/10 text-white/60"
                      }`}
                    >
                      {i + 1}
                    </span>
                    {hasClip && (
                      <span className="h-1 w-1 rounded-full bg-green-400/70 shrink-0" title="Has clip" />
                    )}
                    {!hasClip && (
                      <span className="h-1 w-1 rounded-full bg-white/20 shrink-0" title="No clip" />
                    )}
                  </div>

                  {/* Section title */}
                  <p className="text-[9px] font-semibold text-white/55 truncate leading-tight flex-1">
                    {scene.section || scene.lyricLine || `Scene ${i + 1}`}
                  </p>

                  {/* Duration + markers row */}
                  <div className="flex items-center gap-1 mt-auto pt-0.5 flex-wrap">
                    <span className="text-[8px] font-mono text-white/30 shrink-0">{dur.toFixed(1)}s</span>
                    {hasEffects && (
                      <span title="Effect active">
                        <Zap className="h-2 w-2 text-amber-400/60 shrink-0" />
                      </span>
                    )}
                    {transition && transition.transitionType !== "Cut" && (
                      <span title={`Transition: ${transition.transitionType}`}>
                        <ArrowRightLeft className="h-2 w-2 text-blue-400/60 shrink-0" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Right-edge transition tick */}
                {i < scenes.length - 1 && (
                  <div
                    className={`absolute top-0 right-0 w-0.5 h-full ${
                      transition && transition.transitionType !== "Cut" ? "bg-blue-500/40" : "bg-white/[0.04]"
                    }`}
                  />
                )}
              </div>
            );
          })}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px z-20 pointer-events-none"
            style={{
              left: `${timeToPercent(currentTimeSec)}%`,
              background: "rgba(201,168,76,1)",
              boxShadow: "0 0 6px rgba(201,168,76,0.6)",
            }}
          >
            {/* Handle (draggable) */}
            <div
              className="absolute -top-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-[#C9A84C] bg-black cursor-ew-resize pointer-events-auto"
              style={{ boxShadow: "0 0 8px rgba(201,168,76,0.8)" }}
              onMouseDown={onPlayheadMouseDown}
            />
          </div>
        </div>

        {/* Caption markers row */}
        {captionLines.length > 0 && (
          <div className="relative h-3 bg-white/[0.01] border-t border-white/[0.04]" style={{ minWidth: `${Math.max(scenes.length * 60, 300)}px` }}>
            {captionLines.map((line, i) => {
              const leftPct = timeToPercent(line.startSec);
              const widthPct = Math.max(0.3, timeToPercent(line.endSec) - leftPct);
              return (
                <div
                  key={i}
                  className="absolute top-0.5 h-2 rounded-full bg-primary/30"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={line.text}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer legend */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-white/[0.04]">
        <div className="flex items-center gap-1">
          <div className="h-1 w-3 rounded-full bg-primary/40" />
          <span className="text-[9px] text-white/25">captions</span>
        </div>
        {hasEffects && (
          <div className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5 text-amber-400/50" />
            <span className="text-[9px] text-white/25">effects on</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <ArrowRightLeft className="h-2.5 w-2.5 text-blue-400/40" />
          <span className="text-[9px] text-white/25">transition</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Clock className="h-2.5 w-2.5 text-white/20" />
          <span className="text-[9px] text-white/25">click to seek · drag playhead to scrub</span>
        </div>
      </div>
    </div>
  );
}
