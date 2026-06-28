/**
 * StudioEditorSection — Bow Down Studio Editor (MVP)
 *
 * CapCut-style music video timeline editor.
 * Audio clock drives everything — the same audio element from
 * TimelinePreviewPlayer is the source of truth; this section
 * reads currentTime/isPlaying from the parent and calls
 * onSeek / onTogglePlay / onRestart for transport control.
 *
 * MVP features:
 *   • Time ruler + fake waveform (visual, click-to-seek)
 *   • Up to 12 clip blocks positioned by scene timestamps
 *   • Drag trim handles on selected clip (updates settings.clips)
 *   • Selected clip detail panel with trim sliders
 *   • Lock Timeline → generates JSON snapshot
 *   • Master Player Stable status panel
 */

import { useState, useRef, useMemo, useCallback } from "react";
import {
  Play, Pause, SkipBack, Lock, Download, ZoomIn, ZoomOut,
  Film, ChevronDown, ChevronUp, Copy, Check,
  AlertCircle, Music2,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings } from "@/lib/editor-settings";
import { Button } from "@/components/ui/button";

/* ─── Types ────────────────────────────────────────────────────────── */

export type LockedTimelineClip = {
  sceneIdx: number;
  sceneId: string;
  title: string;
  url: string | null;
  startSec: number;
  endSec: number;
  dur: number;
  trimStart: number;
  trimEnd: number;
  lipSyncOffsetSec: number;
};

export type LockedTimeline = {
  id: string;
  version: 1;
  createdAt: string;
  audioDuration: number | null;
  clipCount: number;
  audioStartsAt: 0;
  clips: LockedTimelineClip[];
};

/* ─── Helpers ───────────────────────────────────────────────────────── */

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

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function genId(): string {
  return `tl_${Math.random().toString(36).slice(2, 8)}`;
}

const CLIP_COLORS = [
  "#7c3aed", "#2563eb", "#059669", "#d97706", "#dc2626",
  "#0891b2", "#7e22ce", "#1d4ed8", "#047857", "#b45309",
  "#b91c1c", "#0e7490",
];

/* ─── Fake Waveform ─────────────────────────────────────────────────── */

function FakeWaveform({ height = 40, progress = 0 }: { height?: number; progress?: number }) {
  const segments = 240;
  const points = useMemo(() => Array.from({ length: segments }, (_, i) => {
    const t = i / segments;
    const h =
      0.25 * Math.abs(Math.sin(t * 13.1 + 0.4)) +
      0.35 * Math.abs(Math.sin(t * 27.8 + 2.1)) +
      0.25 * Math.abs(Math.sin(t * 53.2 + 5.7)) +
      0.15 * Math.abs(Math.sin(t * 91.0 + 8.3));
    return Math.min(1, Math.max(0.08, h));
  }), []);

  const W = 1000;
  const barW = W / segments;
  const played = Math.min(W, progress * W);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <defs>
        <clipPath id="wf-played">
          <rect x={0} y={0} width={played} height={height} />
        </clipPath>
        <clipPath id="wf-unplayed">
          <rect x={played} y={0} width={W - played} height={height} />
        </clipPath>
      </defs>
      {points.map((h, i) => {
        const x = i * barW;
        const barH = h * height;
        const y = (height - barH) / 2;
        return (
          <g key={i}>
            <rect x={x} y={y} width={Math.max(1, barW - 0.8)} height={barH}
              fill="rgba(201,168,76,0.85)" clipPath="url(#wf-played)" />
            <rect x={x} y={y} width={Math.max(1, barW - 0.8)} height={barH}
              fill="rgba(201,168,76,0.22)" clipPath="url(#wf-unplayed)" />
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Time Ruler ────────────────────────────────────────────────────── */

function TimeRuler({ totalDur, currentTime }: { totalDur: number; currentTime: number }) {
  if (totalDur <= 0) return null;
  const step = totalDur <= 60 ? 5 : totalDur <= 180 ? 15 : totalDur <= 360 ? 30 : 60;
  const ticks: number[] = [];
  for (let t = 0; t <= totalDur + 0.01; t += step) ticks.push(Math.round(t));

  return (
    <div className="relative h-6 border-b border-white/[0.05] select-none bg-white/[0.01]">
      {ticks.map((t) => {
        const pct = (t / totalDur) * 100;
        return (
          <div
            key={t}
            className="absolute top-0 flex flex-col items-center pointer-events-none"
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
          >
            <div className="h-2 w-px bg-white/15 mt-0.5" />
            <span className="text-[8px] font-mono text-white/25">{fmt(t)}</span>
          </div>
        );
      })}
      <div
        className="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none"
        style={{ left: `${totalDur > 0 ? (currentTime / totalDur) * 100 : 0}%` }}
      />
    </div>
  );
}

/* ─── Props ─────────────────────────────────────────────────────────── */

export interface StudioEditorSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  currentTime: number;
  audioDuration: number | null;
  isPlaying: boolean;
  onSeek: (sec: number) => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  onGoToExport: () => void;
  onGoToMusic: () => void;
  /** Resolved audio URL (from previewAudioUrl in parent) — drives waveform visibility */
  audioUrl?: string | null;
}

/* ─── Component ─────────────────────────────────────────────────────── */

export function StudioEditorSection({
  scenes,
  settings,
  setSettings,
  currentTime,
  audioDuration,
  isPlaying,
  onSeek,
  onTogglePlay,
  onRestart,
  onGoToExport,
  onGoToMusic,
  audioUrl = null,
}: StudioEditorSectionProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [lockedTimeline, setLockedTimeline] = useState<LockedTimeline | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const trimDragRef = useRef<{
    side: "start" | "end";
    sceneId: string;
    sceneIdx: number;
    startX: number;
    startVal: number;
    clipDur: number;
  } | null>(null);

  /* ── Compute clip positions from timestamps ── */
  const rawDurs = scenes.map(s => parseDur(s.timestamp));
  const allDefault = rawDurs.length > 0 && rawDurs.every(d => d === 5);
  const durs: number[] = (allDefault && audioDuration != null && audioDuration > 0)
    ? scenes.map(() => audioDuration / scenes.length)
    : rawDurs;

  const totalDur = audioDuration ?? durs.reduce((a, b) => a + b, 0);

  const offsets: number[] = [];
  let acc = 0;
  for (const d of durs) { offsets.push(acc); acc += d; }

  const clipEdits = settings.clips ?? {};

  /* ── Click-to-seek on waveform/ruler ── */
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el || totalDur <= 0) return;
    const rect = el.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(totalDur, frac * totalDur)));
  }, [totalDur, onSeek]);

  /* ── Trim drag (pointer-capture approach) ── */
  const startTrimDrag = useCallback((
    e: React.PointerEvent,
    side: "start" | "end",
    sceneId: string,
    sceneIdx: number,
    clipDur: number,
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const ce = clipEdits[sceneId];
    trimDragRef.current = {
      side, sceneId, sceneIdx,
      startX: e.clientX,
      startVal: side === "start" ? (ce?.trimStart ?? 0) : (ce?.trimEnd ?? 0),
      clipDur,
    };
  }, [clipEdits]);

  const onTrimPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = trimDragRef.current;
    if (!drag) return;
    const el = timelineRef.current;
    if (!el || totalDur <= 0) return;
    const pxPerSec = (el.getBoundingClientRect().width * zoom) / totalDur;
    const deltaTime = (e.clientX - drag.startX) / pxPerSec;
    const maxTrim = drag.clipDur * 0.45;
    const raw = drag.side === "start"
      ? drag.startVal + deltaTime
      : drag.startVal - deltaTime;
    const newVal = Math.round(Math.max(0, Math.min(maxTrim, raw)) * 10) / 10;

    const ce = clipEdits[drag.sceneId] ?? { trimStart: 0, trimEnd: 0 };
    setSettings({
      ...settings,
      clips: {
        ...clipEdits,
        [drag.sceneId]: {
          ...ce,
          [drag.side === "start" ? "trimStart" : "trimEnd"]: newVal,
        },
      },
    });
  }, [clipEdits, settings, setSettings, totalDur, zoom]);

  const onTrimPointerUp = useCallback(() => {
    trimDragRef.current = null;
  }, []);

  /* ── Lock Timeline ── */
  function lockTimeline() {
    const clips: LockedTimelineClip[] = scenes.map((s, i) => {
      const ce = clipEdits[s.id];
      const trimStart = ce?.trimStart ?? 0;
      const trimEnd   = ce?.trimEnd   ?? 0;
      const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
      const url = useLipSync ? ce!.lipSyncUrl! : s.demoClipUrl ?? null;
      const clipDur = durs[i] ?? 5;
      return {
        sceneIdx: i,
        sceneId: s.id,
        title: s.section || `Scene ${i + 1}`,
        url,
        startSec: offsets[i] ?? 0,
        endSec: (offsets[i] ?? 0) + clipDur,
        dur: clipDur,
        trimStart,
        trimEnd,
        lipSyncOffsetSec: useLipSync ? (ce?.lipSyncOffsetSeconds ?? 0) : 0,
      };
    });
    const tl: LockedTimeline = {
      id: genId(),
      version: 1,
      createdAt: new Date().toISOString(),
      audioDuration: audioDuration ?? null,
      clipCount: clips.length,
      audioStartsAt: 0,
      clips,
    };
    setLockedTimeline(tl);
    setJsonOpen(true);
  }

  /* ── Copy JSON ── */
  function copyJson() {
    if (!lockedTimeline) return;
    void navigator.clipboard.writeText(JSON.stringify(lockedTimeline, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  /* ── Stable status ── */
  const clipsWithUrl = scenes.filter(s => !!s.demoClipUrl).length;
  const stableChecks = [
    { label: "Audio is master clock", ok: !!audioUrl, detail: audioUrl ? "song audio loaded ✓" : "no song set — go to Music Studio" },
    { label: "All clips have URLs",   ok: clipsWithUrl === scenes.length && scenes.length > 0, detail: `${clipsWithUrl}/${scenes.length} clips` },
    { label: "Timeline locked",       ok: !!lockedTimeline, detail: lockedTimeline ? `ID: ${lockedTimeline.id}` : "click Lock Timeline" },
  ];
  const isStable = stableChecks.every(c => c.ok);

  /* ── Render ── */
  return (
    <div
      className="space-y-4"
      onPointerMove={onTrimPointerMove}
      onPointerUp={onTrimPointerUp}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
            <span className="text-primary text-base">✦</span>
            Bow Down Studio Editor
          </h2>
          <p className="text-[10px] text-white/30 mt-0.5">
            CapCut-style timeline · {scenes.length} clips · {audioDuration ? fmt(audioDuration) : "--:--"} total
            {lockedTimeline && <span className="ml-2 text-primary/60">· Timeline locked: {lockedTimeline.id}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={lockTimeline}
            disabled={scenes.length === 0}
            className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10 text-xs h-7"
          >
            <Lock className="h-3 w-3" />
            Lock Timeline
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onGoToExport}
            disabled={!lockedTimeline}
            className="gap-1.5 border-green-500/30 text-green-400 hover:bg-green-500/[0.08] text-xs h-7 disabled:opacity-40"
            title={!lockedTimeline ? "Lock the timeline first" : "Go to Export"}
          >
            <Download className="h-3 w-3" />
            Export
          </Button>
        </div>
      </div>

      {/* ── No-audio notice ── */}
      {!audioUrl && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-bold text-amber-300">No song audio set</p>
            <p className="text-[9px] text-white/40 mt-0.5">
              The audio element is the master clock. Go to{" "}
              <button type="button" onClick={onGoToMusic} className="text-amber-300 underline hover:text-amber-200">
                Music Studio
              </button>{" "}
              and set a song to enable the timeline.
            </p>
          </div>
        </div>
      )}

      {/* ── Transport ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <button
          type="button"
          onClick={onRestart}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/90 hover:bg-white/[0.05] transition-colors"
          title="Restart from 0:00"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors"
        >
          {isPlaying
            ? <Pause className="h-3.5 w-3.5" />
            : <Play  className="h-3.5 w-3.5 ml-0.5" />}
        </button>
        <span className="font-mono text-xs text-white/50">
          {fmt(currentTime)} / {audioDuration ? fmt(audioDuration) : "--:--"}
        </span>

        {/* progress mini-bar */}
        <div className="flex-1 h-1 bg-white/[0.08] rounded-full overflow-hidden">
          <div
            className="h-full bg-primary/60 rounded-full transition-none"
            style={{ width: totalDur > 0 ? `${Math.min(100, (currentTime / totalDur) * 100)}%` : "0%" }}
          />
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom(z => Math.max(1, z - 0.5))}
            disabled={zoom <= 1}
            className="p-1 rounded text-white/25 hover:text-white/70 hover:bg-white/[0.04] disabled:opacity-20 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <span className="text-[9px] font-mono text-white/35 w-7 text-center">{zoom}×</span>
          <button
            type="button"
            onClick={() => setZoom(z => Math.min(8, z + 0.5))}
            disabled={zoom >= 8}
            className="p-1 rounded text-white/25 hover:text-white/70 hover:bg-white/[0.04] disabled:opacity-20 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Timeline ── */}
      <div className="rounded-xl border border-white/[0.08] bg-[#090909] overflow-hidden">
        <div className="overflow-x-auto scrollbar-none">
          <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>

            {/* Time ruler */}
            <TimeRuler totalDur={totalDur} currentTime={currentTime} />

            {/* Waveform — click to seek */}
            <div
              ref={timelineRef}
              className="relative h-10 cursor-crosshair"
              onClick={handleTimelineClick}
              title="Click to seek"
            >
              {audioUrl
                ? <FakeWaveform height={40} progress={totalDur > 0 ? currentTime / totalDur : 0} />
                : (
                  <div className="w-full h-full flex items-center justify-center gap-2 bg-white/[0.01]">
                    <Music2 className="h-3 w-3 text-amber-400/40" />
                    <span className="text-[9px] text-amber-400/40">Add a song to see the waveform</span>
                  </div>
                )
              }
              {/* Playhead */}
              {totalDur > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none z-10"
                  style={{ left: `${(currentTime / totalDur) * 100}%` }}
                >
                  <div className="absolute -top-0 -translate-x-1/2 w-2 h-2 bg-primary rounded-full" />
                </div>
              )}
            </div>

            {/* Clip track */}
            <div
              className="relative bg-black/40 cursor-crosshair"
              style={{ height: 80 }}
              onClick={handleTimelineClick}
            >
              {scenes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-white/15">
                  <Film className="h-4 w-4" />
                  <span className="text-[10px]">Generate clips to see them here</span>
                </div>
              )}

              {scenes.map((scene, i) => {
                const ce          = clipEdits[scene.id];
                const trimStart   = ce?.trimStart ?? 0;
                const trimEnd     = ce?.trimEnd   ?? 0;
                const clipDur     = durs[i] ?? 5;
                const clipStart   = offsets[i] ?? 0;
                const leftPct     = totalDur > 0 ? (clipStart / totalDur) * 100 : 0;
                const widthPct    = totalDur > 0 ? (clipDur  / totalDur) * 100 : 8;
                const color       = CLIP_COLORS[i % CLIP_COLORS.length]!;
                const isSelected  = selectedIdx === i;
                const isActive    = currentTime >= clipStart && currentTime < clipStart + clipDur;
                const hasClip     = !!scene.demoClipUrl;

                return (
                  <div
                    key={scene.id}
                    className="absolute top-1.5 bottom-1.5 rounded flex items-center overflow-hidden select-none"
                    style={{
                      left: `${leftPct}%`,
                      width: `calc(${widthPct}% - 2px)`,
                      background: isSelected
                        ? `${color}bb`
                        : isActive
                          ? `${color}88`
                          : `${color}44`,
                      border: `1px solid ${isSelected ? color : isActive ? `${color}88` : `${color}33`}`,
                      boxShadow: isSelected ? `0 0 0 1px ${color}55, 0 0 12px ${color}33` : undefined,
                      cursor: "pointer",
                    }}
                    onClick={(e) => { e.stopPropagation(); setSelectedIdx(isSelected ? null : i); }}
                  >
                    {/* Trim left overlay */}
                    {trimStart > 0 && clipDur > 0 && (
                      <div
                        className="absolute left-0 top-0 bottom-0 pointer-events-none"
                        style={{
                          width: `${Math.min(48, (trimStart / clipDur) * 100)}%`,
                          background: "rgba(0,0,0,0.6)",
                          borderRight: "1px dashed rgba(255,255,255,0.25)",
                        }}
                      />
                    )}
                    {/* Trim right overlay */}
                    {trimEnd > 0 && clipDur > 0 && (
                      <div
                        className="absolute right-0 top-0 bottom-0 pointer-events-none"
                        style={{
                          width: `${Math.min(48, (trimEnd / clipDur) * 100)}%`,
                          background: "rgba(0,0,0,0.6)",
                          borderLeft: "1px dashed rgba(255,255,255,0.25)",
                        }}
                      />
                    )}

                    {/* Clip label */}
                    <div className="px-1.5 z-10 min-w-0 flex-1 overflow-hidden">
                      <p className="text-[8px] font-bold text-white truncate leading-tight">
                        {i + 1}. {scene.section || `Scene ${i + 1}`}
                      </p>
                      <p className="text-[7px] text-white/40 font-mono">
                        {fmt(clipStart)}–{fmt(clipStart + clipDur)}
                      </p>
                    </div>

                    {!hasClip && (
                      <Film className="h-2.5 w-2.5 text-white/20 shrink-0 mr-1" />
                    )}

                    {/* Trim handles — only on selected clip */}
                    {isSelected && (
                      <>
                        <div
                          className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-20
                            flex items-center justify-center hover:bg-white/15 rounded-l transition-colors"
                          onPointerDown={(e) => startTrimDrag(e, "start", scene.id, i, clipDur)}
                          onClick={(e) => e.stopPropagation()}
                          title="Drag to trim start"
                        >
                          <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                        </div>
                        <div
                          className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-20
                            flex items-center justify-center hover:bg-white/15 rounded-r transition-colors"
                          onPointerDown={(e) => startTrimDrag(e, "end", scene.id, i, clipDur)}
                          onClick={(e) => e.stopPropagation()}
                          title="Drag to trim end"
                        >
                          <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Playhead over clips */}
              {totalDur > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none z-30"
                  style={{ left: `${(currentTime / totalDur) * 100}%` }}
                />
              )}
            </div>

          </div>
        </div>
        <div className="px-3 py-1.5 border-t border-white/[0.04] flex items-center gap-2">
          <span className="text-[8px] text-white/20">Click timeline to seek · Click clip to select · Drag handles to trim</span>
          {selectedIdx !== null && (
            <button
              type="button"
              className="text-[8px] text-white/30 hover:text-white/60 ml-auto"
              onClick={() => setSelectedIdx(null)}
            >
              Deselect
            </button>
          )}
        </div>
      </div>

      {/* ── Selected clip panel ── */}
      {selectedIdx !== null && scenes[selectedIdx] && (() => {
        const scene    = scenes[selectedIdx]!;
        const ce       = clipEdits[scene.id];
        const trimStart = ce?.trimStart ?? 0;
        const trimEnd   = ce?.trimEnd   ?? 0;
        const clipDur   = durs[selectedIdx] ?? 5;
        const clipStart = offsets[selectedIdx] ?? 0;
        const color     = CLIP_COLORS[selectedIdx % CLIP_COLORS.length]!;
        const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done");
        const effectiveDur = Math.max(0, clipDur - trimStart - trimEnd);

        function updateTrim(key: "trimStart" | "trimEnd", val: number) {
          const updated = {
            ...clipEdits,
            [scene.id]: { ...(ce ?? { trimStart: 0, trimEnd: 0 }), [key]: val },
          };
          setSettings({ ...settings, clips: updated });
        }

        return (
          <div
            className="rounded-xl border px-3 py-3 space-y-3"
            style={{ borderColor: `${color}44`, background: `${color}08` }}
          >
            {/* Header row */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold text-white">{scene.section || `Scene ${selectedIdx + 1}`}</p>
                <p className="text-[9px] text-white/40 font-mono mt-0.5">
                  {fmt(clipStart)} – {fmt(clipStart + clipDur)} · clip {selectedIdx + 1} of {scenes.length}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {useLipSync && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300">Lip Sync</span>
                )}
                {!scene.demoClipUrl && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">No clip</span>
                )}
                <button type="button" onClick={() => setSelectedIdx(null)}
                  className="text-[9px] text-white/25 hover:text-white/60 ml-1">✕</button>
              </div>
            </div>

            {/* Duration summary */}
            <div className="grid grid-cols-3 gap-2 text-center text-[9px]">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5">
                <p className="text-white/30">Source</p>
                <p className="font-mono font-bold text-white/60">{clipDur.toFixed(1)}s</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5">
                <p className="text-white/30">Trimmed</p>
                <p className="font-mono font-bold text-primary">{effectiveDur.toFixed(1)}s</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5">
                <p className="text-white/30">In timeline</p>
                <p className="font-mono font-bold text-white/60">{fmt(clipStart)}</p>
              </div>
            </div>

            {/* Trim sliders */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-white/40 uppercase tracking-wider font-bold block mb-1">
                  Trim Start: {trimStart.toFixed(1)}s
                </label>
                <input
                  type="range" min={0} max={clipDur * 0.45} step={0.1}
                  value={trimStart}
                  onChange={(e) => updateTrim("trimStart", Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-[8px] text-white/20 mt-0.5">Skip first {trimStart.toFixed(1)}s of clip</p>
              </div>
              <div>
                <label className="text-[9px] text-white/40 uppercase tracking-wider font-bold block mb-1">
                  Trim End: {trimEnd.toFixed(1)}s
                </label>
                <input
                  type="range" min={0} max={clipDur * 0.45} step={0.1}
                  value={trimEnd}
                  onChange={(e) => updateTrim("trimEnd", Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-[8px] text-white/20 mt-0.5">Skip last {trimEnd.toFixed(1)}s of clip</p>
              </div>
            </div>

            {useLipSync && ce && (
              <p className="text-[9px] text-violet-300/60">
                Lip sync offset: +{(ce.lipSyncOffsetSeconds ?? 0).toFixed(2)}s applied in export
              </p>
            )}

            <button
              type="button"
              onClick={() => onSeek(clipStart)}
              className="text-[9px] text-primary/60 hover:text-primary/90 underline underline-offset-2 transition-colors"
            >
              Jump to {fmt(clipStart)} →
            </button>
          </div>
        );
      })()}

      {/* ── Master Player Stable ── */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-black text-white/35 uppercase tracking-widest">Master Player Stable</p>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
            isStable
              ? "bg-green-500/15 text-green-400 border border-green-500/20"
              : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
          }`}>
            {isStable ? "✓ Stable — ready to export" : "○ Not stable yet"}
          </span>
        </div>
        <div className="space-y-1">
          {stableChecks.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[9px]">
              <span className={c.ok ? "text-green-400" : "text-white/25"}>
                {c.ok ? "✓" : "○"}
              </span>
              <span className={c.ok ? "text-white/50" : "text-white/30"}>{c.label}</span>
              <span className="text-white/20 ml-auto font-mono">{c.detail}</span>
            </div>
          ))}
        </div>
        {isStable && !lockedTimeline && (
          <p className="text-[9px] text-primary/50 mt-2">
            Everything ready — click <strong className="text-primary/80">Lock Timeline</strong> above to generate the export blueprint.
          </p>
        )}
      </div>

      {/* ── Locked Timeline JSON ── */}
      {lockedTimeline && (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] overflow-hidden">
          <button
            type="button"
            onClick={() => setJsonOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-black
              text-primary/70 uppercase tracking-widest hover:text-primary/90 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              Locked Timeline · {lockedTimeline.id} · {lockedTimeline.clipCount} clips · {audioDuration ? fmt(audioDuration) : "--:--"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); copyJson(); }}
                className="flex items-center gap-1 text-[9px] text-white/35 hover:text-white/70
                  border border-white/[0.08] rounded px-1.5 py-0.5 font-normal normal-case tracking-normal"
              >
                {copied
                  ? <><Check className="h-2.5 w-2.5 text-green-400" /> Copied!</>
                  : <><Copy className="h-2.5 w-2.5" /> Copy JSON</>}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onGoToExport(); }}
                className="flex items-center gap-1 text-[9px] text-green-400/70 hover:text-green-400
                  border border-green-500/20 rounded px-1.5 py-0.5 font-normal normal-case tracking-normal"
              >
                <Download className="h-2.5 w-2.5" /> Export
              </button>
              {jsonOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </div>
          </button>

          {jsonOpen && (
            <div className="border-t border-primary/10 px-3 pb-3">
              {/* Summary table */}
              <div className="grid grid-cols-3 gap-2 py-2 mb-2">
                {[
                  ["Version", "1"],
                  ["Audio start", "0:00.0 (0.00s)"],
                  ["Total duration", audioDuration ? `${fmt(audioDuration)} (${audioDuration.toFixed(1)}s)` : "unknown"],
                  ["Clip count", String(lockedTimeline.clipCount)],
                  ["Locked at", new Date(lockedTimeline.createdAt).toLocaleTimeString()],
                  ["Export ready", isStable ? "✓ Yes" : "○ No"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
                    <p className="text-[8px] text-white/25 uppercase tracking-wider">{k}</p>
                    <p className="text-[9px] font-mono text-white/60 mt-0.5">{v}</p>
                  </div>
                ))}
              </div>

              {/* Clip list */}
              <div className="space-y-0.5 mb-2 max-h-40 overflow-y-auto">
                <p className="text-[8px] text-white/25 uppercase tracking-wider mb-1">Clip List</p>
                {lockedTimeline.clips.map((c) => (
                  <div key={c.sceneIdx}
                    className="grid grid-cols-[1.5rem_1fr_4rem_4rem_4rem] gap-1 px-1.5 py-1 rounded
                      text-[8px] font-mono border border-white/[0.04] bg-white/[0.01]">
                    <span className="text-white/25">{c.sceneIdx + 1}</span>
                    <span className="text-white/50 truncate">{c.title}</span>
                    <span className="text-white/35 text-right">{fmt(c.startSec)}</span>
                    <span className="text-white/35 text-right">{c.dur.toFixed(1)}s</span>
                    <span className="text-right">
                      {c.url ? <span className="text-green-400/60">✓ url</span> : <span className="text-amber-400/60">no url</span>}
                    </span>
                  </div>
                ))}
              </div>

              {/* Raw JSON */}
              <details>
                <summary className="text-[8px] text-white/25 cursor-pointer hover:text-white/50 py-1">
                  Show raw JSON
                </summary>
                <pre className="text-[7px] text-white/30 font-mono overflow-x-auto max-h-40 mt-1 leading-relaxed bg-black/30 rounded p-2">
                  {JSON.stringify(lockedTimeline, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}

      {/* ── What's coming ── */}
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] px-3 py-2.5">
        <p className="text-[9px] font-black text-white/25 uppercase tracking-widest mb-1.5">Coming Next</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            "True audio waveform (WaveSurfer)",
            "Drag to reorder clips",
            "Split clip at playhead",
            "Replace clip",
            "Transition editor",
            "Effects on timeline",
            "Export from locked timeline directly",
          ].map(label => (
            <span key={label} className="text-[8px] px-2 py-0.5 rounded-full border border-white/[0.06] text-white/20">
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
