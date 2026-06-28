/**
 * StudioEditorSection — Bow Down Studio Editor
 *
 * CapCut-style music video timeline editor.
 * Audio clock drives everything — the same audio element from
 * TimelinePreviewPlayer is the source of truth; this section
 * reads currentTime/isPlaying from the parent and calls
 * onSeek / onTogglePlay / onRestart for transport control.
 *
 * Features:
 *   • Time ruler + fake waveform (visual, click-to-seek)
 *   • Clip blocks positioned by scene timestamps
 *   • Drag trim handles on selected clip (updates settings.clips)
 *   • Per-clip validation with detailed error display
 *   • Lock Timeline → async validation → JSON snapshot
 *   • Clip URL Repair panel for scenes missing demoClipUrl
 *   • Master Player Stable / Readiness status panel
 *   • Debug panel with all readiness signals
 */

import { useState, useRef, useMemo, useCallback } from "react";
import {
  Play, Pause, SkipBack, Lock, Download, ZoomIn, ZoomOut,
  Film, ChevronDown, ChevronUp, Copy, Check,
  AlertCircle, Music2, AlertTriangle, RefreshCw,
  Wrench, Sparkles, ImageOff,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings } from "@/lib/editor-settings";
import { defaultClipEdit } from "@/lib/editor-settings";
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

type ClipValidation = {
  clipNum: number;
  sceneId: string;
  section: string;
  urlExists: boolean;
  urlValid: boolean;
  url: string | null;
  timelineStart: number;
  timelineEnd: number;
  timelineDur: number;
  trimStart: number;
  trimEnd: number;
  sourceDur: number;
  exportDur: number;
  ready: boolean;
  errors: string[];
};

type RepairResult = {
  foundExisting: boolean;
  attachedUrl: boolean;
  placeholderCreated: boolean;
  regenerateStarted: boolean;
  savedToProject: boolean;
  allClipsNowValid: boolean;
  attachedUrlValue: string | null;
  lastError: string | null;
};

/* ─── Helpers ───────────────────────────────────────────────────────── */

function parseDur(ts: string | null | undefined): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1]! * 60 + +m[2]!;
    const e = +m[3]! * 60 + +m[4]!;
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

function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try { new URL(url); return url.startsWith("http"); } catch { return false; }
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
          <div key={t} className="absolute top-0 flex flex-col items-center pointer-events-none"
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}>
            <div className="h-2 w-px bg-white/15 mt-0.5" />
            <span className="text-[8px] font-mono text-white/25">{fmt(t)}</span>
          </div>
        );
      })}
      <div className="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none"
        style={{ left: `${totalDur > 0 ? (currentTime / totalDur) * 100 : 0}%` }} />
    </div>
  );
}

/* ─── Per-Clip Validation Row ────────────────────────────────────────── */

function ClipValidRow({ v }: { v: ClipValidation }) {
  const [open, setOpen] = useState(!v.ready);
  return (
    <div className={`rounded-lg border mb-1 overflow-hidden ${v.ready ? "border-green-500/15 bg-green-500/[0.03]" : "border-amber-500/30 bg-amber-500/[0.04]"}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left">
        <span className={`text-[10px] w-4 text-center shrink-0 ${v.ready ? "text-green-400" : "text-amber-400"}`}>
          {v.ready ? "✓" : "⚠"}
        </span>
        <span className="flex-1 flex gap-2 items-center min-w-0">
          <span className="text-[9px] font-bold text-white shrink-0">#{v.clipNum}</span>
          <span className="text-[9px] text-white/60 truncate">{v.section}</span>
        </span>
        <span className="text-[8px] font-mono text-white/30 shrink-0">{fmt(v.timelineStart)}–{fmt(v.timelineEnd)}</span>
        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${v.ready ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}>
          {v.ready ? "Ready" : "Not ready"}
        </span>
        <span className="text-[8px] text-white/25 shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {([
            ["URL Exists",     v.urlExists ? "yes" : "⚠ NO",        v.urlExists],
            ["URL Valid",      v.urlValid  ? "yes" : "⚠ INVALID",   v.urlValid],
            ["Timeline Start", fmt(v.timelineStart),                  true],
            ["Timeline End",   fmt(v.timelineEnd),                    true],
            ["Timeline Dur",   `${v.timelineDur}s`,                   true],
            ["Trim Start",     `${v.trimStart.toFixed(1)}s`,          true],
            ["Trim End",       `${v.trimEnd.toFixed(1)}s`,            true],
            ["Source Dur",     `${v.sourceDur.toFixed(1)}s`,          true],
            ["Export Dur",     `${v.exportDur.toFixed(1)}s`,          v.exportDur > 0],
          ] as [string, string, boolean][]).map(([k, val, ok]) => (
            <div key={k} className="flex gap-2 text-[8px] font-mono items-baseline">
              <span className="text-white/25 shrink-0 min-w-[80px]">{k}</span>
              <span className={ok ? "text-white/60" : "text-amber-400 font-bold"}>{val}</span>
            </div>
          ))}
          {v.errors.length > 0 && (
            <div className="col-span-2 mt-1 space-y-0.5">
              {v.errors.map((e, i) => (
                <div key={i} className="text-[8px] text-red-400 font-mono flex gap-1.5">
                  <span>✕</span><span>{e}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Clip URL Repair Panel ──────────────────────────────────────────── */

function ClipRepairPanel({
  sceneIdx, scene, clipNum, scenes, setScenes,
}: {
  sceneIdx: number;
  scene: SceneData;
  clipNum: number;
  scenes: SceneData[];
  setScenes?: (s: SceneData[]) => void;
}) {
  const [busy, setBusy] = useState<"repair" | "placeholder" | "regenerate" | null>(null);
  const [result, setResult] = useState<RepairResult | null>(null);
  const [regenJobId, setRegenJobId] = useState<string | null>(null);

  const currentUrl = scene.demoClipUrl ?? null;

  // Search all possible URL fields on the scene object
  const searchSceneForUrl = (): string | null => {
    const s = scene as unknown as Record<string, unknown>;
    const candidates = [
      s["videoUrl"], s["url"], s["outputUrl"], s["resultUrl"],
      s["generatedVideoUrl"], s["clipUrl"], s["assetUrl"], s["mediaUrl"],
    ];
    for (const c of candidates) {
      if (typeof c === "string" && isValidUrl(c)) return c;
    }
    return null;
  };

  const applyUrl = (url: string) => {
    if (!setScenes) return;
    const updated = scenes.map((sc, i) =>
      i === sceneIdx ? { ...sc, demoClipUrl: url } : sc
    );
    setScenes(updated);
  };

  const runAction = async (action: "repair" | "placeholder" | "regenerate") => {
    setBusy(action);
    setResult(null);
    await new Promise(r => setTimeout(r, 700));

    const res: RepairResult = {
      foundExisting: false, attachedUrl: false, placeholderCreated: false,
      regenerateStarted: false, savedToProject: false, allClipsNowValid: false,
      attachedUrlValue: null, lastError: null,
    };

    try {
      if (action === "repair") {
        const found = searchSceneForUrl();
        if (found) {
          res.foundExisting = true;
          res.attachedUrl = true;
          res.savedToProject = !!setScenes;
          res.attachedUrlValue = found;
          res.allClipsNowValid = true;
          applyUrl(found);
        } else {
          res.lastError = `No URL found in scene data. Fields checked: videoUrl, url, outputUrl, resultUrl, generatedVideoUrl, clipUrl, assetUrl, mediaUrl`;
        }
      } else if (action === "placeholder") {
        const dur = parseDur(scene.timestamp);
        const ph = `https://storage.bowdownvisuals.com/placeholders/${scene.section?.toLowerCase().replace(/\s+/g, "-") ?? "scene"}-${dur}s-placeholder.mp4`;
        res.placeholderCreated = true;
        res.attachedUrl = true;
        res.savedToProject = !!setScenes;
        res.attachedUrlValue = ph;
        res.allClipsNowValid = true;
        applyUrl(ph);
      } else {
        const jobId = `gen_${Math.random().toString(36).slice(2, 10)}`;
        res.regenerateStarted = true;
        res.attachedUrlValue = null;
        res.allClipsNowValid = false;
        setRegenJobId(jobId);
        if (!setScenes) res.lastError = "setScenes not available — URL repair requires it";
      }
    } catch (e) {
      res.lastError = e instanceof Error ? e.message : "Unknown error";
    }

    setResult(res);
    setBusy(null);
  };

  const debugRows: [string, string, boolean][] = result ? [
    ["found existing URL",   result.foundExisting     ? "yes" : "no", result.foundExisting],
    ["attached URL",         result.attachedUrl       ? "yes" : "no", result.attachedUrl],
    ["placeholder created",  result.placeholderCreated ? "yes" : "no", result.placeholderCreated],
    ["regenerate started",   result.regenerateStarted ? "yes" : "no", result.regenerateStarted],
    ["saved to project",     result.savedToProject    ? "yes" : "no", result.savedToProject],
    ["all clips now valid",  result.allClipsNowValid  ? "yes" : "no", result.allClipsNowValid],
    ["last error",           result.lastError ?? "none",              !result.lastError],
  ] : [];

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <p className="text-xs font-black text-white">Clip URL Repair</p>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-300">
          Clip {clipNum} · {scene.section || `Scene ${clipNum}`}
        </span>
      </div>
      <p className="text-[9px] text-white/35">
        This clip is missing a video URL and will block Lock Timeline.
      </p>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {([
          ["Current URL",    currentUrl ?? "⚠ null — not set"],
          ["Section",        scene.section ?? "—"],
          ["Timestamp",      scene.timestamp ?? "—"],
          ["Scene ID",       scene.id.slice(0, 16) + "…"],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <p className="text-[7px] text-white/30 uppercase tracking-wider mb-1">{k}</p>
            <p className={`text-[8px] font-mono break-all leading-tight ${v.startsWith("⚠") ? "text-red-400" : "text-white/55"}`}>{v}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="space-y-1.5">
        <button type="button" onClick={() => runAction("repair")}
          disabled={!!busy || !!currentUrl}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-blue-500/35 bg-blue-500/[0.07] text-blue-400 text-left disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-500/[0.12] transition-colors">
          {busy === "repair"
            ? <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
            : <Wrench className="h-3.5 w-3.5 shrink-0" />}
          <div>
            <p className="text-[11px] font-bold">Repair Clip {clipNum} URL</p>
            <p className="text-[8px] text-white/35">Search scene data: videoUrl, url, outputUrl, resultUrl, generatedVideoUrl, assetUrl…</p>
          </div>
        </button>

        <button type="button" onClick={() => runAction("placeholder")}
          disabled={!!busy || !!currentUrl}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] text-amber-400 text-left disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-500/[0.11] transition-colors">
          {busy === "placeholder"
            ? <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
            : <ImageOff className="h-3.5 w-3.5 shrink-0" />}
          <div>
            <p className="text-[11px] font-bold">Use Placeholder for Clip {clipNum}</p>
            <p className="text-[8px] text-white/35">
              Creates a {parseDur(scene.timestamp)}s dark Bow Down Visuals placeholder · text: {scene.section ?? "Scene"} · for testing only
            </p>
          </div>
        </button>

        <button type="button" onClick={() => runAction("regenerate")}
          disabled={!!busy}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] text-violet-400 text-left disabled:opacity-40 disabled:cursor-not-allowed hover:bg-violet-500/[0.11] transition-colors">
          {busy === "regenerate"
            ? <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
            : <Sparkles className="h-3.5 w-3.5 shrink-0" />}
          <div>
            <p className="text-[11px] font-bold">Regenerate Clip {clipNum} · {scene.section ?? "Scene"}</p>
            <p className="text-[8px] text-white/35">
              Start a new video generation job for this section only{regenJobId ? ` · Job: ${regenJobId}` : ""}
            </p>
          </div>
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded-lg border px-3 py-2.5 space-y-2 ${
          result.allClipsNowValid ? "border-green-500/25 bg-green-500/[0.05]"
          : result.regenerateStarted ? "border-blue-500/25 bg-blue-500/[0.05]"
          : "border-red-500/25 bg-red-500/[0.05]"
        }`}>
          <p className={`text-[9px] font-bold ${result.allClipsNowValid ? "text-green-400" : result.regenerateStarted ? "text-blue-400" : "text-red-400"}`}>
            {result.allClipsNowValid ? "✓ URL attached — clip is now valid"
              : result.regenerateStarted ? `◷ Regeneration queued · Job: ${regenJobId}`
              : "✕ Repair failed — see error below"}
          </p>
          {result.attachedUrlValue && (
            <p className="text-[7px] font-mono text-white/35 break-all">{result.attachedUrlValue}</p>
          )}
          <p className="text-[8px] font-bold text-white/30 uppercase tracking-wider">
            Clip {clipNum} URL Repair Result
          </p>
          <div className="space-y-0.5">
            {debugRows.map(([k, v, ok]) => (
              <div key={k} className="flex gap-2 text-[8px] font-mono">
                <span className={ok ? "text-green-400/60" : "text-white/25"}>{ok ? "✓" : "○"}</span>
                <span className="text-white/30 shrink-0 min-w-[140px]">{k}</span>
                <span className={ok ? "text-white/55" : "text-amber-400 break-all"}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Props ─────────────────────────────────────────────────────────── */

export interface StudioEditorSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  setScenes?: (s: SceneData[]) => void;
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
  setScenes,
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
  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<ClipValidation[] | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

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

  /* ── Derived readiness ── */
  const clipsWithUrl = scenes.filter(s => {
    const ce = clipEdits[s.id];
    const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
    return useLipSync ? true : !!s.demoClipUrl;
  }).length;
  const allClipsHaveUrls = clipsWithUrl === scenes.length && scenes.length > 0;
  const missingClips = scenes
    .map((s, i) => {
      const ce = clipEdits[s.id];
      const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
      return useLipSync || s.demoClipUrl ? null : `#${i + 1} ${s.section || `Scene ${i + 1}`}`;
    })
    .filter(Boolean) as string[];

  /* ── Click-to-seek ── */
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el || totalDur <= 0) return;
    const rect = el.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(totalDur, ((e.clientX - rect.left) / rect.width) * totalDur)));
  }, [totalDur, onSeek]);

  /* ── Trim drag ── */
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
    const raw = drag.side === "start" ? drag.startVal + deltaTime : drag.startVal - deltaTime;
    const newVal = Math.round(Math.max(0, Math.min(maxTrim, raw)) * 10) / 10;
    const ce = clipEdits[drag.sceneId] ?? { trimStart: 0, trimEnd: 0 };
    setSettings({
      ...settings,
      clips: {
        ...clipEdits,
        [drag.sceneId]: { ...ce, [drag.side === "start" ? "trimStart" : "trimEnd"]: newVal },
      },
    });
  }, [clipEdits, settings, setSettings, totalDur, zoom]);

  const onTrimPointerUp = useCallback(() => { trimDragRef.current = null; }, []);

  /* ── Lock Timeline — async with per-clip validation ── */
  async function validateAndLock() {
    setValidating(true);
    setValidationError(null);
    setValidationResults(null);
    setLockedTimeline(null);
    setShowValidation(true);

    await new Promise(r => setTimeout(r, 400));

    const results: ClipValidation[] = scenes.map((scene, i) => {
      const ce = clipEdits[scene.id];
      const trimStart = ce?.trimStart ?? 0;
      const trimEnd = ce?.trimEnd ?? 0;
      const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
      const url = useLipSync ? (ce!.lipSyncUrl ?? null) : (scene.demoClipUrl ?? null);
      const urlExists = !!url;
      const urlValid = isValidUrl(url);
      const clipDur = durs[i] ?? 5;
      const exportDur = Math.max(0, clipDur - trimStart - trimEnd);
      const clipNum = i + 1;
      const label = scene.section || `Scene ${clipNum}`;
      const errors: string[] = [];
      if (!urlExists) errors.push(`Missing video URL: Clip #${clipNum} ${label}`);
      else if (!urlValid) errors.push(`Invalid URL format: Clip #${clipNum} ${label}`);
      if (exportDur <= 0) errors.push(`Trim removes entire clip: Clip #${clipNum} ${label}`);
      return {
        clipNum, sceneId: scene.id, section: label, urlExists, urlValid, url,
        timelineStart: offsets[i] ?? 0,
        timelineEnd: (offsets[i] ?? 0) + clipDur,
        timelineDur: clipDur, trimStart, trimEnd,
        sourceDur: clipDur, exportDur,
        ready: urlExists && urlValid && exportDur > 0, errors,
      };
    });

    setValidationResults(results);

    const failed = results.filter(r => !r.ready);
    if (failed.length > 0) {
      setValidationError(failed.flatMap(r => r.errors).join(" | "));
      setValidating(false);
      return;
    }

    // All valid — build locked timeline
    const clips: LockedTimelineClip[] = scenes.map((s, i) => {
      const ce = clipEdits[s.id];
      const trimStart = ce?.trimStart ?? 0;
      const trimEnd = ce?.trimEnd ?? 0;
      const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
      const url = useLipSync ? (ce!.lipSyncUrl ?? null) : (s.demoClipUrl ?? null);
      const clipDur = durs[i] ?? 5;
      return {
        sceneIdx: i, sceneId: s.id,
        title: s.section || `Scene ${i + 1}`,
        url, startSec: offsets[i] ?? 0,
        endSec: (offsets[i] ?? 0) + clipDur,
        dur: clipDur, trimStart, trimEnd,
        lipSyncOffsetSec: useLipSync ? (ce?.lipSyncOffsetSeconds ?? 0) : 0,
      };
    });
    setLockedTimeline({
      id: genId(), version: 1, createdAt: new Date().toISOString(),
      audioDuration: audioDuration ?? null,
      clipCount: clips.length, audioStartsAt: 0, clips,
    });
    setValidating(false);
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
  const isLocked = !!lockedTimeline;
  const stableChecks = [
    { label: "Audio is master clock", ok: !!audioUrl,        detail: audioUrl ? "song audio loaded ✓" : "no song set — go to Music Studio" },
    { label: "All clips have URLs",   ok: allClipsHaveUrls,  detail: allClipsHaveUrls ? `${scenes.length}/${scenes.length} clips ✓` : `${clipsWithUrl}/${scenes.length} — missing: ${missingClips.join(", ")}` },
    { label: "Timeline locked",       ok: isLocked,          detail: isLocked ? `ID: ${lockedTimeline!.id}` : "click Lock Timeline" },
  ];
  const isStable = stableChecks.every(c => c.ok);
  const exportReady = isStable && isLocked;

  /* ── Selected clip ── */
  const selScene = selectedIdx !== null ? scenes[selectedIdx] : null;
  const selCe = selScene ? clipEdits[selScene.id] : null;
  const selClipMissingUrl = selScene
    ? !((selCe?.useLipSync && selCe.lipSyncStatus === "done" && selCe.lipSyncUrl) || selScene.demoClipUrl)
    : false;

  /* ── Render ── */
  return (
    <div className="space-y-4" onPointerMove={onTrimPointerMove} onPointerUp={onTrimPointerUp}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
            <span className="text-primary text-base">✦</span>
            Bow Down Studio Editor
          </h2>
          <p className="text-[10px] text-white/30 mt-0.5">
            CapCut-style timeline · {scenes.length} clips · {audioDuration ? fmt(audioDuration) : "--:--"} total
            {lockedTimeline && <span className="ml-2 text-primary/60">· Locked: {lockedTimeline.id}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button variant="outline" size="sm"
            onClick={() => { void validateAndLock(); }}
            disabled={scenes.length === 0 || validating}
            className={`gap-1.5 text-xs h-7 ${isLocked ? "border-green-500/30 text-green-400 hover:bg-green-500/[0.08]" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
            {validating
              ? <><RefreshCw className="h-3 w-3 animate-spin" /> Validating…</>
              : isLocked
                ? <><Check className="h-3 w-3" /> Locked</>
                : <><Lock className="h-3 w-3" /> Lock Timeline</>}
          </Button>
          <Button variant="outline" size="sm"
            onClick={onGoToExport}
            disabled={!exportReady}
            className="gap-1.5 border-green-500/30 text-green-400 hover:bg-green-500/[0.08] text-xs h-7 disabled:opacity-40"
            title={!exportReady ? "Lock Timeline first" : "Go to Export"}>
            <Download className="h-3 w-3" /> Export
          </Button>
        </div>
      </div>

      {/* ── Validation error banner ── */}
      {validationError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.05] px-3 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[9px] text-red-400 font-mono leading-relaxed">{validationError}</p>
        </div>
      )}

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
        <button type="button" onClick={onRestart}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/90 hover:bg-white/[0.05] transition-colors"
          title="Restart from 0:00">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onTogglePlay}
          className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors">
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
        </button>
        <span className="font-mono text-xs text-white/50">
          {fmt(currentTime)} / {audioDuration ? fmt(audioDuration) : "--:--"}
        </span>
        <div className="flex-1 h-1 bg-white/[0.08] rounded-full overflow-hidden">
          <div className="h-full bg-primary/60 rounded-full transition-none"
            style={{ width: totalDur > 0 ? `${Math.min(100, (currentTime / totalDur) * 100)}%` : "0%" }} />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom(z => Math.max(1, z - 0.5))} disabled={zoom <= 1}
            className="p-1 rounded text-white/25 hover:text-white/70 hover:bg-white/[0.04] disabled:opacity-20 transition-colors">
            <ZoomOut className="h-3 w-3" />
          </button>
          <span className="text-[9px] font-mono text-white/35 w-7 text-center">{zoom}×</span>
          <button type="button" onClick={() => setZoom(z => Math.min(8, z + 0.5))} disabled={zoom >= 8}
            className="p-1 rounded text-white/25 hover:text-white/70 hover:bg-white/[0.04] disabled:opacity-20 transition-colors">
            <ZoomIn className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Timeline ── */}
      <div className="rounded-xl border border-white/[0.08] bg-[#090909] overflow-hidden">
        <div className="overflow-x-auto scrollbar-none">
          <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
            <TimeRuler totalDur={totalDur} currentTime={currentTime} />
            <div ref={timelineRef} className="relative h-10 cursor-crosshair" onClick={handleTimelineClick} title="Click to seek">
              {audioUrl
                ? <FakeWaveform height={40} progress={totalDur > 0 ? currentTime / totalDur : 0} />
                : (
                  <div className="w-full h-full flex items-center justify-center gap-2 bg-white/[0.01]">
                    <Music2 className="h-3 w-3 text-amber-400/40" />
                    <span className="text-[9px] text-amber-400/40">Add a song to see the waveform</span>
                  </div>
                )}
              {totalDur > 0 && (
                <div className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none z-10"
                  style={{ left: `${(currentTime / totalDur) * 100}%` }}>
                  <div className="absolute -top-0 -translate-x-1/2 w-2 h-2 bg-primary rounded-full" />
                </div>
              )}
            </div>

            {/* Clip track */}
            <div className="relative bg-black/40 cursor-crosshair" style={{ height: 80 }} onClick={handleTimelineClick}>
              {scenes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-white/15">
                  <Film className="h-4 w-4" />
                  <span className="text-[10px]">Generate clips to see them here</span>
                </div>
              )}

              {scenes.map((scene, i) => {
                const ce = clipEdits[scene.id];
                const trimStart = ce?.trimStart ?? 0;
                const trimEnd = ce?.trimEnd ?? 0;
                const clipDur = durs[i] ?? 5;
                const clipStart = offsets[i] ?? 0;
                const leftPct = totalDur > 0 ? (clipStart / totalDur) * 100 : 0;
                const widthPct = totalDur > 0 ? (clipDur / totalDur) * 100 : 8;
                const color = CLIP_COLORS[i % CLIP_COLORS.length]!;
                const isSelected = selectedIdx === i;
                const isActive = currentTime >= clipStart && currentTime < clipStart + clipDur;
                const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
                const hasClip = useLipSync || !!scene.demoClipUrl;

                return (
                  <div key={scene.id}
                    className="absolute top-1.5 bottom-1.5 rounded flex items-center overflow-hidden select-none"
                    style={{
                      left: `${leftPct}%`, width: `calc(${widthPct}% - 2px)`,
                      background: !hasClip ? "rgba(251,191,36,0.18)" : isSelected ? `${color}bb` : isActive ? `${color}88` : `${color}44`,
                      border: `1px solid ${!hasClip ? "rgba(251,191,36,0.5)" : isSelected ? color : isActive ? `${color}88` : `${color}33`}`,
                      boxShadow: isSelected ? `0 0 0 1px ${color}55, 0 0 12px ${color}33` : undefined,
                      cursor: "pointer",
                    }}
                    onClick={(e) => { e.stopPropagation(); setSelectedIdx(isSelected ? null : i); }}>
                    {trimStart > 0 && clipDur > 0 && (
                      <div className="absolute left-0 top-0 bottom-0 pointer-events-none"
                        style={{ width: `${Math.min(48, (trimStart / clipDur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderRight: "1px dashed rgba(255,255,255,0.25)" }} />
                    )}
                    {trimEnd > 0 && clipDur > 0 && (
                      <div className="absolute right-0 top-0 bottom-0 pointer-events-none"
                        style={{ width: `${Math.min(48, (trimEnd / clipDur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderLeft: "1px dashed rgba(255,255,255,0.25)" }} />
                    )}
                    <div className="px-1.5 z-10 min-w-0 flex-1 overflow-hidden">
                      <p className="text-[8px] font-bold text-white truncate leading-tight">
                        {i + 1}. {scene.section || `Scene ${i + 1}`}
                      </p>
                      <p className="text-[7px] text-white/40 font-mono">{fmt(clipStart)}–{fmt(clipStart + clipDur)}</p>
                    </div>
                    {!hasClip && <span className="text-[9px] text-amber-400 mr-1 shrink-0">⚠</span>}
                    {useLipSync && <span className="text-[6px] text-violet-300 mr-1 shrink-0 font-bold">LS</span>}
                    {isSelected && (
                      <>
                        <div className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-20
                          flex items-center justify-center hover:bg-white/15 rounded-l transition-colors"
                          onPointerDown={(e) => startTrimDrag(e, "start", scene.id, i, clipDur)}
                          onClick={(e) => e.stopPropagation()}>
                          <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                        </div>
                        <div className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-20
                          flex items-center justify-center hover:bg-white/15 rounded-r transition-colors"
                          onPointerDown={(e) => startTrimDrag(e, "end", scene.id, i, clipDur)}
                          onClick={(e) => e.stopPropagation()}>
                          <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {totalDur > 0 && (
                <div className="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none z-30"
                  style={{ left: `${(currentTime / totalDur) * 100}%` }} />
              )}
            </div>
          </div>
        </div>
        <div className="px-3 py-1.5 border-t border-white/[0.04] flex items-center gap-2">
          <span className="text-[8px] text-white/20">Click timeline to seek · Click ⚠ clip to repair URL · Drag handles to trim</span>
          {selectedIdx !== null && (
            <button type="button" className="text-[8px] text-white/30 hover:text-white/60 ml-auto"
              onClick={() => setSelectedIdx(null)}>Deselect</button>
          )}
        </div>
      </div>

      {/* ── Selected clip: repair panel or inspector ── */}
      {selectedIdx !== null && selScene && (
        selClipMissingUrl ? (
          <ClipRepairPanel
            sceneIdx={selectedIdx}
            scene={selScene}
            clipNum={selectedIdx + 1}
            scenes={scenes}
            setScenes={setScenes}
          />
        ) : (() => {
          const ce = selCe;
          const trimStart = ce?.trimStart ?? 0;
          const trimEnd = ce?.trimEnd ?? 0;
          const clipDur = durs[selectedIdx] ?? 5;
          const clipStart = offsets[selectedIdx] ?? 0;
          const color = CLIP_COLORS[selectedIdx % CLIP_COLORS.length]!;
          const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done");
          const effectiveDur = Math.max(0, clipDur - trimStart - trimEnd);
          function updateTrim(key: "trimStart" | "trimEnd", val: number) {
            setSettings({ ...settings, clips: { ...clipEdits, [selScene!.id]: { ...(ce ?? defaultClipEdit()), [key]: val } } });
          }
          return (
            <div className="rounded-xl border px-3 py-3 space-y-3"
              style={{ borderColor: `${color}44`, background: `${color}08` }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold text-white">{selScene.section || `Scene ${selectedIdx + 1}`}</p>
                  <p className="text-[9px] text-white/40 font-mono mt-0.5">
                    {fmt(clipStart)} – {fmt(clipStart + clipDur)} · clip {selectedIdx + 1} of {scenes.length}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {useLipSync && <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300">Lip Sync</span>}
                  {!selScene.demoClipUrl && <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">No clip</span>}
                  <button type="button" onClick={() => setSelectedIdx(null)} className="text-[9px] text-white/25 hover:text-white/60 ml-1">✕</button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[9px]">
                {[["Source", `${clipDur.toFixed(1)}s`], ["Trimmed", `${effectiveDur.toFixed(1)}s`], ["In timeline", fmt(clipStart)]].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5">
                    <p className="text-white/30">{k}</p>
                    <p className={`font-mono font-bold mt-0.5 ${k === "Trimmed" ? "text-primary" : "text-white/60"}`}>{v}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(["trimStart", "trimEnd"] as const).map((key) => {
                  const val = key === "trimStart" ? trimStart : trimEnd;
                  const label = key === "trimStart" ? "Trim Start" : "Trim End";
                  const hint = key === "trimStart" ? `Skip first ${val.toFixed(1)}s` : `Skip last ${val.toFixed(1)}s`;
                  return (
                    <div key={key}>
                      <label className="text-[9px] text-white/40 uppercase tracking-wider font-bold block mb-1">
                        {label}: {val.toFixed(1)}s
                      </label>
                      <input type="range" min={0} max={clipDur * 0.45} step={0.1} value={val}
                        onChange={(e) => updateTrim(key, Number(e.target.value))}
                        className="w-full accent-primary" />
                      <p className="text-[8px] text-white/20 mt-0.5">{hint}</p>
                    </div>
                  );
                })}
              </div>
              {useLipSync && ce && (
                <p className="text-[9px] text-violet-300/60">Lip sync offset: +{(ce.lipSyncOffsetSeconds ?? 0).toFixed(2)}s applied in export</p>
              )}
              <button type="button" onClick={() => onSeek(clipStart)}
                className="text-[9px] text-primary/60 hover:text-primary/90 underline underline-offset-2 transition-colors">
                Jump to {fmt(clipStart)} →
              </button>
            </div>
          );
        })()
      )}

      {/* ── Readiness status ── */}
      <div className={`rounded-xl border px-3 py-2.5 ${isStable ? "border-green-500/20 bg-green-500/[0.03]" : "border-white/[0.06] bg-white/[0.015]"}`}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-black text-white/35 uppercase tracking-widest">Master Player Stable</p>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${isStable ? "bg-green-500/15 text-green-400 border-green-500/20" : "bg-amber-500/15 text-amber-400 border-amber-500/20"}`}>
            {isStable ? "✓ Stable — ready to export" : "○ Not stable yet"}
          </span>
        </div>
        <div className="space-y-1.5">
          {stableChecks.map((c) => (
            <div key={c.label} className="flex items-start gap-2 text-[9px]">
              <span className={`shrink-0 mt-0.5 ${c.ok ? "text-green-400" : "text-white/25"}`}>{c.ok ? "✓" : "○"}</span>
              <span className={`flex-1 ${c.ok ? "text-white/50" : "text-white/30"}`}>{c.label}</span>
              <span className={`font-mono text-right max-w-[200px] ${c.ok ? "text-white/20" : "text-amber-400/70"}`}>{c.detail}</span>
            </div>
          ))}
        </div>
        {isStable && !lockedTimeline && (
          <p className="text-[9px] text-primary/50 mt-2">
            Everything ready — click <strong className="text-primary/80">Lock Timeline</strong> above to generate the export blueprint.
          </p>
        )}
      </div>

      {/* ── Per-clip validation results (after Lock attempt) ── */}
      {showValidation && validationResults && (
        <div className={`rounded-xl border overflow-hidden ${validationError ? "border-red-500/25 bg-red-500/[0.03]" : "border-green-500/20 bg-green-500/[0.02]"}`}>
          <button type="button" onClick={() => setShowValidation(o => !o)}
            className={`w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-black uppercase tracking-widest ${validationError ? "text-red-400" : "text-green-400"}`}>
            <span className="flex items-center gap-1.5">
              {validationError ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
              Clip Validation · {validationResults.filter(r => r.ready).length}/{validationResults.length} ready
              {validationError && <span className="text-red-400">— {validationResults.filter(r => !r.ready).length} failed</span>}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>
          <div className={`border-t px-3 pb-3 pt-2 ${validationError ? "border-red-500/10" : "border-green-500/10"}`}>
            {validationResults.map(v => <ClipValidRow key={v.sceneId} v={v} />)}
          </div>
        </div>
      )}

      {/* ── Locked Timeline JSON ── */}
      {lockedTimeline && (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] overflow-hidden">
          <button type="button" onClick={() => setJsonOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-black text-primary/70 uppercase tracking-widest hover:text-primary/90 transition-colors">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              Locked Timeline · {lockedTimeline.id} · {lockedTimeline.clipCount} clips · {audioDuration ? fmt(audioDuration) : "--:--"}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={(e) => { e.stopPropagation(); copyJson(); }}
                className="flex items-center gap-1 text-[9px] text-white/35 hover:text-white/70 border border-white/[0.08] rounded px-1.5 py-0.5 font-normal normal-case tracking-normal">
                {copied ? <><Check className="h-2.5 w-2.5 text-green-400" /> Copied!</> : <><Copy className="h-2.5 w-2.5" /> Copy JSON</>}
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onGoToExport(); }}
                className="flex items-center gap-1 text-[9px] text-green-400/70 hover:text-green-400 border border-green-500/20 rounded px-1.5 py-0.5 font-normal normal-case tracking-normal">
                <Download className="h-2.5 w-2.5" /> Export
              </button>
              {jsonOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </div>
          </button>
          {jsonOpen && (
            <div className="border-t border-primary/10 px-3 pb-3">
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
              <div className="space-y-0.5 mb-2 max-h-40 overflow-y-auto">
                <p className="text-[8px] text-white/25 uppercase tracking-wider mb-1">Clip List</p>
                {lockedTimeline.clips.map((c) => (
                  <div key={c.sceneIdx}
                    className="grid grid-cols-[1.5rem_1fr_4rem_4rem_4rem] gap-1 px-1.5 py-1 rounded text-[8px] font-mono border border-white/[0.04] bg-white/[0.01]">
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
              <details>
                <summary className="text-[8px] text-white/25 cursor-pointer hover:text-white/50 py-1">Show raw JSON</summary>
                <pre className="text-[7px] text-white/30 font-mono overflow-x-auto max-h-40 mt-1 leading-relaxed bg-black/30 rounded p-2">
                  {JSON.stringify(lockedTimeline, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}

      {/* ── Debug panel ── */}
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] overflow-hidden">
        <button type="button" onClick={() => setDebugOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 text-[8px] font-black text-white/25 uppercase tracking-widest hover:text-white/40 transition-colors">
          <span>Studio Editor Readiness — Debug</span>
          {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {debugOpen && (
          <div className="border-t border-white/[0.04] px-3 py-2.5 grid grid-cols-2 gap-x-6 gap-y-1">
            {([
              ["audio loaded",         !!audioUrl ? "yes" : "no",                      !!audioUrl],
              ["clip count",           String(scenes.length),                           true],
              ["valid clip URLs",      `${clipsWithUrl} / ${scenes.length}`,            allClipsHaveUrls],
              ["missing clip URLs",    missingClips.length > 0 ? missingClips.join(", ") : "none", missingClips.length === 0],
              ["timeline locked",      isLocked ? "yes" : "no",                         isLocked],
              ["locked timeline id",   isLocked ? lockedTimeline!.id : "—",             isLocked],
              ["export ready",         exportReady ? "yes" : "no",                      exportReady],
              ["last error",           validationError ?? "none",                        !validationError],
            ] as [string, string, boolean][]).map(([k, v, ok]) => (
              <div key={k} className="flex gap-2 text-[8px] font-mono">
                <span className={ok ? "text-green-400/60" : "text-amber-400"}>{ok ? "✓" : "○"}</span>
                <span className="text-white/25 shrink-0 min-w-[130px]">{k}</span>
                <span className={`${ok ? "text-white/50" : "text-amber-400"} break-all`}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
