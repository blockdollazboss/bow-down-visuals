/**
 * TimelineDock — persistent full-width bottom timeline for the Studio editor.
 *
 * Always mounted (visible across every editor tab, not just "Studio"), and
 * spans the entire bottom of the viewport left-to-right. Wraps the master
 * player's audio clock (currentTime/isPlaying/onSeek/onTogglePlay/onRestart)
 * and provides:
 *   - Beat-grid detection + snapping for trims, split, and export range.
 *   - Drag-to-reorder clips (dnd-kit, flex-basis layout keeps them
 *     back-to-back — no gaps or overlaps are structurally possible).
 *   - Split tool at the playhead.
 *   - Drag-to-fade audio handles (replaces the old boolean fade toggle).
 *   - Drag-select export range, synced with ExportSection's exportRange.
 *   - Zoom.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Play, Pause, SkipBack, ZoomIn, ZoomOut, Scissors, Film, Music2,
  AlertTriangle, RotateCcw, PlusSquare, RefreshCw, LayoutList, Waves, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SceneData } from "@/lib/scene-parser";
import { computeSceneTimings, computeManualTimings } from "@/lib/scene-timing";
import type { EditorSettings, ExportRangeMode, AudioVideoSyncMode } from "@/lib/editor-settings";
import { defaultClipEdit, TIMELINE_DOCK_DEFAULT_HEIGHT, TIMELINE_DOCK_MIN_HEIGHT, TIMELINE_DOCK_MAX_HEIGHT } from "@/lib/editor-settings";
import { detectBeatGrid, snapToBeat, type BeatGrid } from "@/lib/beat-grid";
import { Shuffle, ListOrdered } from "lucide-react";

/** Audio/video sync mode options — migrated from the removed VideoTimeline component. */
const SYNC_MODES: {
  id: AudioVideoSyncMode;
  label: string;
  short: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  { id: "keep-as-is",   label: "Keep As-Is",             short: "Keep",        icon: <RotateCcw className="h-3 w-3" />,   desc: "No changes. Audio and video each use their own real length. Nothing is stretched." },
  { id: "trim-audio",   label: "Trim Audio to Video",    short: "Trim Audio",  icon: <Scissors className="h-3 w-3" />,    desc: "Audio is cut at the end of the last video clip. An optional fade-out is applied." },
  { id: "extend-video", label: "Extend Video to Song",   short: "Extend Video",icon: <PlusSquare className="h-3 w-3" />,  desc: "Extra empty clip slots are shown for the remaining song length. Add clips to fill them." },
  { id: "loop-clips",   label: "Loop Clips to Song",     short: "Loop Clips",  icon: <RefreshCw className="h-3 w-3" />,   desc: "Existing clips repeat from the beginning until they cover the full song duration." },
  { id: "auto-fit",     label: "Auto-Fit Clips to Song", short: "Auto-Fit",    icon: <LayoutList className="h-3 w-3" />,  desc: "Clips are evenly distributed across the entire song duration. No gaps, no overlap." },
  { id: "fade-audio",   label: "Fade Audio at Video End",short: "Fade Audio",  icon: <Waves className="h-3 w-3" />,       desc: "Clips play as-is. When the last clip ends, the audio fades out naturally." },
];

const CLIP_COLORS = [
  "#7c3aed", "#2563eb", "#059669", "#d97706", "#dc2626",
  "#0891b2", "#7e22ce", "#1d4ed8", "#047857", "#b45309",
  "#b91c1c", "#0e7490",
];

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function genId(): string {
  return `sc_${Math.random().toString(36).slice(2, 10)}`;
}

function tsRange(startSec: number, endSec: number): string {
  const f = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return `${f(startSec)}-${f(endSec)}`;
}

interface TimelineDockProps {
  scenes: SceneData[];
  setScenes?: (s: SceneData[]) => void;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  currentTime: number;
  audioDuration: number | null;
  isPlaying: boolean;
  audioUrl: string | null;
  onSeek: (sec: number) => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  selectedIdx: number | null;
  setSelectedIdx: (i: number | null) => void;
  /** Reports the dock's current rendered height (px) so other floating UI can avoid overlapping it. */
  onHeightChange?: (height: number) => void;
}

export function TimelineDock({
  scenes, setScenes, settings, setSettings,
  currentTime, audioDuration, isPlaying, audioUrl,
  onSeek, onTogglePlay, onRestart,
  selectedIdx, setSelectedIdx,
  onHeightChange,
}: TimelineDockProps) {
  const [zoom, setZoom] = useState(1);
  const [beatGrid, setBeatGrid] = useState<BeatGrid | null>(null);
  const [beatLoading, setBeatLoading] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showSync, setShowSync] = useState(false);

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dockRootRef = useRef<HTMLDivElement | null>(null);
  const trimDragRef = useRef<{
    side: "start" | "end"; sceneId: string; startX: number; startVal: number; clipDur: number; clipStart: number;
  } | null>(null);
  const fadeDragRef = useRef<{ side: "in" | "out"; startX: number; startVal: number } | null>(null);
  const rangeDragRef = useRef<{ side: "start" | "end" } | null>(null);
  const rangeCreateRef = useRef<{ startX: number; startTime: number; moved: boolean } | null>(null);
  const cropDragRef = useRef<{ side: "start" | "end" } | null>(null);
  const moveDragRef = useRef<{ sceneId: string; startX: number; startVal: number } | null>(null);
  const resizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  /* ── Beat grid detection ── */
  useEffect(() => {
    if (!audioUrl) { setBeatGrid(null); return; }
    let cancelled = false;
    setBeatLoading(true);
    detectBeatGrid(audioUrl, audioDuration).then((grid) => {
      if (!cancelled) { setBeatGrid(grid); setBeatLoading(false); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  const clipEdits = settings.clips ?? {};
  const isManual = settings.timelineLayout === "manual";
  const manualCalc = isManual ? computeManualTimings(scenes, audioDuration, clipEdits) : null;
  const sceneTimings = isManual ? manualCalc!.timings : computeSceneTimings(scenes, audioDuration);
  const durs = sceneTimings.map((t) => t.durationSec);
  const offsets = sceneTimings.map((t) => t.startSec);
  const clipsEnd = sceneTimings.reduce((m, t) => Math.max(m, t.endSec), 0);
  const totalDur = Math.max(audioDuration ?? 0, clipsEnd) || durs.reduce((a, b) => a + b, 0);

  const va = settings.musicStudio.videoAudio;
  const exportRange = settings.export.exportRange ?? { mode: "full" as ExportRangeMode, customStartSec: 0, customEndSec: 30 };
  const songCrop = settings.musicStudio.songCrop ?? { enabled: false, startSec: 0, endSec: 0 };
  const cropEndResolved = songCrop.endSec > songCrop.startSec ? songCrop.endSec : (audioDuration ?? totalDur);

  /* ── Audio/video sync status — migrated from the removed VideoTimeline component ── */
  const syncMode = va.syncMode ?? "keep-as-is";
  const selectedSyncMode = SYNC_MODES.find((m) => m.id === syncMode) ?? SYNC_MODES[0]!;
  const syncAudioTotal = audioDuration ?? 0;
  const syncClipsTotal = clipsEnd;
  const syncDiffSec = Math.abs(syncAudioTotal - syncClipsTotal);
  const syncMismatch = syncAudioTotal > 0 && syncClipsTotal > 0 && syncDiffSec > 1.5;

  function setSyncMode(mode: AudioVideoSyncMode) {
    setSettings({
      ...settings,
      musicStudio: { ...settings.musicStudio, videoAudio: { ...va, syncMode: mode } },
    });
  }

  function snap(t: number): number {
    return snapEnabled ? snapToBeat(t, beatGrid?.beats, 0.12) : t;
  }

  /* ── Click-to-seek (suppressed if the click was actually the end of a range-create drag) ── */
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
    const el = timelineRef.current;
    if (!el || totalDur <= 0) return;
    const rect = el.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * totalDur;
    onSeek(Math.max(0, Math.min(totalDur, snap(t))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDur, onSeek, snapEnabled, beatGrid]);

  /* ── Trim drag ── */
  const startTrimDrag = useCallback((e: React.PointerEvent, side: "start" | "end", sceneId: string, clipDur: number, clipStart: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const ce = clipEdits[sceneId];
    trimDragRef.current = { side, sceneId, startX: e.clientX, startVal: side === "start" ? (ce?.trimStart ?? 0) : (ce?.trimEnd ?? 0), clipDur, clipStart };
  }, [clipEdits]);

  /* ── Fade handle drag ── */
  const startFadeDrag = useCallback((e: React.PointerEvent, side: "in" | "out") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    fadeDragRef.current = { side, startX: e.clientX, startVal: side === "in" ? va.fadeIn : va.fadeOut };
  }, [va.fadeIn, va.fadeOut]);

  /* ── Export-range handle drag ── */
  const startRangeDrag = useCallback((e: React.PointerEvent, side: "start" | "end") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    rangeDragRef.current = { side };
  }, []);

  /* ── Song crop handle drag ── */
  const startCropDrag = useCallback((e: React.PointerEvent, side: "start" | "end") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDragRef.current = { side };
  }, []);

  /* ── Freeform clip move drag (manual layout only) ── */
  const startMoveDrag = useCallback((e: React.PointerEvent, sceneId: string, curStart: number) => {
    if (!isManual) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    moveDragRef.current = { sceneId, startX: e.clientX, startVal: curStart };
  }, [isManual]);

  /* ── Dock resize drag (top-edge handle) — vertical, independent of totalDur/audio state ── */
  const startResizeDrag = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeDragRef.current = { startY: e.clientY, startHeight: settings.timelineDockHeight ?? TIMELINE_DOCK_DEFAULT_HEIGHT };
  }, [settings.timelineDockHeight]);

  /* ── Double-click the resize handle to snap the dock back to its default height ── */
  const resetDockHeight = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    resizeDragRef.current = null;
    setSettings({ ...settings, timelineDockHeight: TIMELINE_DOCK_DEFAULT_HEIGHT });
  }, [settings, setSettings]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (resizeDragRef.current) {
      const drag = resizeDragRef.current;
      // Dragging the handle up (smaller clientY) grows the dock; dragging down shrinks it.
      const deltaY = drag.startY - e.clientY;
      const newHeight = Math.round(Math.max(TIMELINE_DOCK_MIN_HEIGHT, Math.min(TIMELINE_DOCK_MAX_HEIGHT, drag.startHeight + deltaY)));
      setSettings({ ...settings, timelineDockHeight: newHeight });
      return;
    }
    const el = timelineRef.current;
    if (!el || totalDur <= 0) return;
    const rectWidth = el.getBoundingClientRect().width;
    const pxPerSec = (rectWidth * zoom) / totalDur;

    if (trimDragRef.current) {
      const drag = trimDragRef.current;
      const deltaTime = (e.clientX - drag.startX) / pxPerSec;
      const maxTrim = drag.clipDur * 0.45;
      const rawVal = drag.side === "start" ? drag.startVal + deltaTime : drag.startVal - deltaTime;
      const clampedVal = Math.max(0, Math.min(maxTrim, rawVal));
      // Snap the handle's absolute timeline position to the beat grid, then convert back to a trim duration.
      const absTime = drag.side === "start" ? drag.clipStart + clampedVal : drag.clipStart + drag.clipDur - clampedVal;
      const snappedAbs = snap(absTime);
      const snappedVal = drag.side === "start" ? snappedAbs - drag.clipStart : drag.clipStart + drag.clipDur - snappedAbs;
      const newVal = Math.round(Math.max(0, Math.min(maxTrim, snappedVal)) * 10) / 10;
      const ce = clipEdits[drag.sceneId] ?? defaultClipEdit();
      setSettings({ ...settings, clips: { ...clipEdits, [drag.sceneId]: { ...ce, [drag.side === "start" ? "trimStart" : "trimEnd"]: newVal } } });
      return;
    }
    if (fadeDragRef.current) {
      const drag = fadeDragRef.current;
      const deltaTime = (e.clientX - drag.startX) / pxPerSec;
      const maxFade = Math.min(15, totalDur / 2);
      const rawVal = drag.side === "in" ? drag.startVal + deltaTime : drag.startVal - deltaTime;
      const clampedVal = Math.max(0, Math.min(maxFade, rawVal));
      // Fade-in handle sits at absolute time = fadeIn; fade-out handle sits at absolute time = totalDur - fadeOut.
      const absTime = drag.side === "in" ? clampedVal : totalDur - clampedVal;
      const snappedAbs = snap(absTime);
      const snappedVal = drag.side === "in" ? snappedAbs : totalDur - snappedAbs;
      const newVal = Math.round(Math.max(0, Math.min(maxFade, snappedVal)) * 10) / 10;
      setSettings({
        ...settings,
        musicStudio: { ...settings.musicStudio, videoAudio: { ...va, [drag.side === "in" ? "fadeIn" : "fadeOut"]: newVal } },
      });
      return;
    }
    if (rangeDragRef.current) {
      const rect = el.getBoundingClientRect();
      const t = snap(Math.max(0, Math.min(totalDur, ((e.clientX - rect.left) / rect.width) * totalDur)));
      const cur = settings.export.exportRange ?? { mode: "custom" as ExportRangeMode, customStartSec: 0, customEndSec: totalDur };
      const next = rangeDragRef.current.side === "start"
        ? { mode: "custom" as ExportRangeMode, customStartSec: Math.min(t, cur.customEndSec - 0.3), customEndSec: cur.customEndSec }
        : { mode: "custom" as ExportRangeMode, customStartSec: cur.customStartSec, customEndSec: Math.max(t, cur.customStartSec + 0.3) };
      setSettings({ ...settings, export: { ...settings.export, exportRange: next } });
      return;
    }
    if (rangeCreateRef.current) {
      const rect = el.getBoundingClientRect();
      const create = rangeCreateRef.current;
      if (!create.moved && Math.abs(e.clientX - create.startX) < 4) return;
      create.moved = true;
      const t = snap(Math.max(0, Math.min(totalDur, ((e.clientX - rect.left) / rect.width) * totalDur)));
      const lo = Math.min(create.startTime, t);
      const hi = Math.max(create.startTime, t);
      setSettings({
        ...settings,
        export: {
          ...settings.export,
          exportRange: { mode: "custom" as ExportRangeMode, customStartSec: lo, customEndSec: Math.max(hi, lo + 0.3) },
        },
      });
      return;
    }
    if (cropDragRef.current) {
      const rect = el.getBoundingClientRect();
      const t = snap(Math.max(0, Math.min(totalDur, ((e.clientX - rect.left) / rect.width) * totalDur)));
      const cur = songCrop.enabled ? songCrop : { enabled: true, startSec: 0, endSec: audioDuration ?? totalDur };
      const next = cropDragRef.current.side === "start"
        ? { enabled: true, startSec: Math.min(t, cur.endSec - 0.5), endSec: cur.endSec }
        : { enabled: true, startSec: cur.startSec, endSec: Math.max(t, cur.startSec + 0.5) };
      setSettings({ ...settings, musicStudio: { ...settings.musicStudio, songCrop: next } });
      return;
    }
    if (moveDragRef.current) {
      const drag = moveDragRef.current;
      const deltaTime = (e.clientX - drag.startX) / pxPerSec;
      const rawVal = Math.max(0, drag.startVal + deltaTime);
      const snappedVal = Math.round(snap(rawVal) * 100) / 100;
      const ce = clipEdits[drag.sceneId] ?? defaultClipEdit();
      setSettings({ ...settings, clips: { ...clipEdits, [drag.sceneId]: { ...ce, manualStartSec: snappedVal } } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipEdits, settings, setSettings, totalDur, zoom, va, snapEnabled, beatGrid, songCrop, audioDuration]);

  const onPointerUp = useCallback(() => {
    if (rangeCreateRef.current?.moved) suppressNextClickRef.current = true;
    if (moveDragRef.current && isManual) {
      const sceneId = moveDragRef.current.sceneId;
      const result = computeManualTimings(scenes, audioDuration, clipEdits);
      const idx = scenes.findIndex((s) => s.id === sceneId);
      const t = idx >= 0 ? result.timings[idx] : null;
      if (t && t.overlapWithPrevSec > 0.05) {
        const ce = clipEdits[sceneId] ?? defaultClipEdit();
        const dur = Math.round(Math.max(0.2, Math.min(3, t.overlapWithPrevSec)) * 10) / 10;
        setSettings({
          ...settings,
          clips: {
            ...clipEdits,
            [sceneId]: {
              ...ce,
              transition: ce.transition && ce.transition !== "Cut" ? ce.transition : "Crossfade",
              transitionDuration: dur,
            },
          },
        });
      }
    }
    trimDragRef.current = null;
    fadeDragRef.current = null;
    rangeDragRef.current = null;
    rangeCreateRef.current = null;
    cropDragRef.current = null;
    moveDragRef.current = null;
    resizeDragRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManual, scenes, audioDuration, clipEdits, settings, setSettings]);

  /* ── Drag-select export range directly on the waveform (works from "full" mode too) ── */
  const startRangeCreate = useCallback((e: React.PointerEvent) => {
    const el = timelineRef.current;
    if (!el || totalDur <= 0) return;
    const rect = el.getBoundingClientRect();
    const t = snap(Math.max(0, Math.min(totalDur, ((e.clientX - rect.left) / rect.width) * totalDur)));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    rangeCreateRef.current = { startX: e.clientX, startTime: t, moved: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDur, snapEnabled, beatGrid]);

  /* ── Drag-to-reorder (back-to-back only — flex layout structurally enforces no gaps) ── */
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !setScenes) return;
    const oldIdx = scenes.findIndex((s) => s.id === active.id);
    const newIdx = scenes.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    setScenes(arrayMove(scenes, oldIdx, newIdx));
  }

  /* ── Split tool — always targets the clip currently under the playhead, independent of selection ── */
  const playheadIdx = useMemo(() => {
    for (let i = 0; i < scenes.length; i++) {
      const start = offsets[i] ?? 0;
      const dur = durs[i] ?? 0;
      if (currentTime >= start && currentTime < start + dur) return i;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, offsets, durs, currentTime]);
  const splitScene = playheadIdx !== null ? scenes[playheadIdx] : null;
  const splitStart = playheadIdx !== null ? (offsets[playheadIdx] ?? 0) : 0;
  const splitDur = playheadIdx !== null ? (durs[playheadIdx] ?? 0) : 0;
  const canSplit = !!splitScene && currentTime > splitStart + 0.3 && currentTime < splitStart + splitDur - 0.3;

  const doSplit = useCallback(() => {
    if (!splitScene || !canSplit || !setScenes || playheadIdx === null) return;
    const splitAt = snap(currentTime) - splitStart;
    const ce = clipEdits[splitScene.id] ?? defaultClipEdit();
    const origTrimStart = ce.trimStart ?? 0;
    const origTrimEnd = ce.trimEnd ?? 0;

    const firstId = splitScene.id;
    const secondId = genId();
    const secondScene: SceneData = {
      ...splitScene,
      id: secondId,
      sceneNumber: splitScene.sceneNumber + 0.5,
      timestamp: tsRange(splitStart + splitAt, splitStart + splitDur),
    };
    const firstScene: SceneData = {
      ...splitScene,
      timestamp: tsRange(splitStart, splitStart + splitAt),
    };

    const nextScenes = [...scenes];
    nextScenes[playheadIdx] = firstScene;
    nextScenes.splice(playheadIdx + 1, 0, secondScene);
    setScenes(nextScenes);

    setSettings({
      ...settings,
      clips: {
        ...clipEdits,
        [firstId]: { ...ce, trimEnd: origTrimEnd + (splitDur - splitAt) },
        [secondId]: { ...ce, trimStart: origTrimStart + splitAt, useLipSync: false, lipSyncUrl: null, lipSyncStatus: null },
      },
    });
    setSelectedIdx(playheadIdx + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitScene, canSplit, setScenes, playheadIdx, currentTime, splitStart, splitDur, clipEdits, settings, setSettings, snapEnabled, beatGrid]);

  /* ── Keyboard shortcut: "S" splits the clip under the playhead (ignored while typing) ── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "s" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!canSplit) return;
      e.preventDefault();
      doSplit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSplit, doSplit]);

  const isSelected = (i: number) => selectedIdx === i;
  const dockHidden = !!settings.timelineDockHidden;

  /* ── Report the dock's rendered height so floating UI (e.g. the master player) can avoid overlapping it ── */
  useEffect(() => {
    const el = dockRootRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange, dockHidden, showSync]);

  if (dockHidden) {
    return (
      <div ref={dockRootRef} className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none">
        <button
          type="button"
          onClick={() => setSettings({ ...settings, timelineDockHidden: false })}
          data-testid="timeline-dock-show"
          title="Show Timeline Dock"
          className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-t-lg text-[10px] font-bold text-white/50 bg-black border border-b-0 border-white/10 hover:text-white hover:bg-white/5 transition-colors shadow-[0_-4px_12px_rgba(0,0,0,0.35)]"
        >
          <ChevronUp className="h-3 w-3" /> Show Timeline
        </button>
      </div>
    );
  }

  return (
    <div
      ref={dockRootRef}
      className="fixed bottom-0 left-0 right-0 z-40 bg-black border-t border-white/10 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="timeline-dock"
    >
      {/* ── Drag handle — resizes the dock's body height; sits on the dock's top edge ──
          The tappable area extends well above the dock's visible edge (rather than deep
          into the transport row below) so it stays a large, easy-to-grab finger target on
          mobile without covering the transport row's buttons. */}
      <div
        onPointerDown={startResizeDrag}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetDockHeight}
        data-testid="timeline-dock-resize-handle"
        title="Drag to resize the timeline · double-click to reset"
        aria-label="Resize timeline"
        role="slider"
        aria-orientation="vertical"
        aria-valuemin={TIMELINE_DOCK_MIN_HEIGHT}
        aria-valuemax={TIMELINE_DOCK_MAX_HEIGHT}
        aria-valuenow={settings.timelineDockHeight ?? TIMELINE_DOCK_DEFAULT_HEIGHT}
        className="absolute -top-8 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center h-10 w-32 cursor-ns-resize touch-none select-none group"
      >
        <div className="h-1.5 w-12 rounded-full bg-border group-hover:bg-primary/60 group-active:bg-primary transition-colors" />
      </div>

      {/* ── Transport row ── */}
      <div className="flex items-center gap-2 px-3 md:px-6 py-1.5 border-b border-white/10 bg-black">
        <button type="button" onClick={onRestart}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          title="Restart from 0:00">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onTogglePlay} data-testid="timeline-dock-play"
          className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors">
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
        </button>
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {fmt(currentTime)} / {audioDuration ? fmt(audioDuration) : "--:--"}
        </span>

        <button type="button" onClick={doSplit} disabled={!canSplit}
          data-testid="timeline-dock-split" title="Split the clip under the playhead (S)"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground border border-border hover:text-foreground hover:bg-foreground/5 disabled:opacity-25 disabled:pointer-events-none transition-colors ml-1">
          <Scissors className="h-3 w-3" /> Split
        </button>

        <button type="button" onClick={() => setSnapEnabled((s) => !s)}
          className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
            snapEnabled ? "text-primary border-primary/30 bg-primary/10" : "text-muted-foreground/70 border-border"
          }`}
          title={beatGrid ? `${beatGrid.bpm.toFixed(0)} BPM detected` : beatLoading ? "Detecting beat grid…" : "No beat grid"}>
          {beatLoading ? "Beat…" : beatGrid ? `${beatGrid.bpm.toFixed(0)} BPM` : "Beat snap"}
        </button>

        <button type="button"
          onClick={() => setSettings({ ...settings, timelineLayout: isManual ? "auto" : "manual" })}
          data-testid="timeline-dock-layout-toggle"
          title={isManual ? "Freeform: clips can be dragged anywhere, gaps/overlaps allowed. Click to snap back to auto layout." : "Auto: clips are back-to-back. Click to switch to freeform placement."}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
            isManual ? "text-violet-300 border-violet-400/30 bg-violet-400/10" : "text-muted-foreground/70 border-border"
          }`}>
          {isManual ? <Shuffle className="h-3 w-3" /> : <ListOrdered className="h-3 w-3" />}
          {isManual ? "Freeform" : "Auto layout"}
        </button>

        <button type="button"
          onClick={() => setSettings({ ...settings, musicStudio: { ...settings.musicStudio, songCrop: { ...songCrop, enabled: !songCrop.enabled, endSec: songCrop.endSec > songCrop.startSec ? songCrop.endSec : (audioDuration ?? 0) } } })}
          disabled={!audioUrl}
          data-testid="timeline-dock-crop-toggle"
          title="Crop the song to a shorter window — the timeline re-baselines to the cropped section."
          className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors disabled:opacity-25 disabled:pointer-events-none ${
            songCrop.enabled ? "text-cyan-300 border-cyan-400/30 bg-cyan-400/10" : "text-muted-foreground/70 border-border"
          }`}>
          Crop song
        </button>

        <button type="button" onClick={() => setShowSync((s) => !s)}
          data-testid="timeline-dock-sync-toggle"
          title="Audio/video sync status and sync mode"
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
            showSync ? "text-primary border-primary/30 bg-primary/10" : "text-muted-foreground/70 border-border"
          }`}>
          {syncMismatch && <AlertTriangle className="h-3 w-3 text-amber-400" />}
          Sync
        </button>

        <div className="flex-1" />

        <span className="text-[9px] text-muted-foreground/60 hidden md:inline">
          {isManual ? "Drag clip anywhere · overlap for auto-transition · " : "Drag clip to reorder · "}
          drag edges to trim · drag waveform to select export range · S to split
        </span>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1}
            className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 disabled:opacity-20 transition-colors">
            <ZoomOut className="h-3 w-3" />
          </button>
          <span className="text-[9px] font-mono text-muted-foreground w-7 text-center">{zoom}×</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(8, z + 0.5))} disabled={zoom >= 8}
            className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 disabled:opacity-20 transition-colors">
            <ZoomIn className="h-3 w-3" />
          </button>
        </div>

        <button type="button" onClick={() => setSettings({ ...settings, timelineDockHidden: true })}
          data-testid="timeline-dock-hide"
          title="Hide Timeline Dock"
          className="flex items-center gap-1 p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Sync status panel — migrated from the removed VideoTimeline component ── */}
      {showSync && (
        <div className="border-b border-white/10 bg-black px-3 md:px-6 py-2 space-y-2">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-[9px] font-mono">
              <Music2 className="h-3 w-3 text-primary/60 shrink-0" />
              <span className="text-muted-foreground">Audio</span>
              <span className="text-primary font-bold">{syncAudioTotal > 0 ? fmt(syncAudioTotal) : "—"}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] font-mono">
              <Film className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              <span className="text-muted-foreground">Video</span>
              <span className="text-foreground/80 font-bold">{syncClipsTotal > 0 ? fmt(syncClipsTotal) : "—"}</span>
            </div>
            {syncMismatch ? (
              <div className="flex items-center gap-1 text-[9px] font-mono">
                <AlertTriangle className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                <span className="text-amber-400 font-bold">
                  {syncAudioTotal > syncClipsTotal ? "+" : "-"}{fmt(syncDiffSec)} diff
                </span>
              </div>
            ) : syncAudioTotal > 0 && (
              <span className="text-[9px] font-mono text-green-400/80">✓ lengths match</span>
            )}
            <span className="ml-auto text-[8px] font-black text-muted-foreground/60 uppercase tracking-widest">Sync Mode</span>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-1">
            {SYNC_MODES.map((mode) => {
              const isSelectedMode = syncMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setSyncMode(mode.id)}
                  data-testid={`timeline-dock-sync-mode-${mode.id}`}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-all ${
                    isSelectedMode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-transparent text-muted-foreground/70 hover:border-border/80 hover:text-foreground hover:bg-foreground/5"
                  }`}
                  title={mode.desc}
                >
                  <span className={`shrink-0 ${isSelectedMode ? "text-primary" : "text-muted-foreground/50"}`}>
                    {mode.icon}
                  </span>
                  <span className="text-[9px] font-bold leading-tight truncate">{mode.short}</span>
                </button>
              );
            })}
          </div>

          <p className="text-[9px] text-muted-foreground/70 leading-relaxed">
            <span className="text-primary/80 font-bold">{selectedSyncMode.label}:</span>{" "}
            {selectedSyncMode.desc}
          </p>
        </div>
      )}

      {/* ── Timeline body — height is user-resizable via the drag handle on the dock's top edge ── */}
      <div
        className="overflow-x-auto overflow-y-hidden scrollbar-none px-3 md:px-6 py-2"
        style={{ height: settings.timelineDockHeight ?? TIMELINE_DOCK_DEFAULT_HEIGHT }}
      >
        <div className="flex flex-col h-full" style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
          {/* Ruler + beat ticks */}
          <div className="relative h-4 select-none shrink-0">
            {beatGrid && totalDur > 0 && beatGrid.beats.map((b, i) => (
              <div key={i} className="absolute top-0 bottom-0 w-px bg-border" style={{ left: `${(b / totalDur) * 100}%` }} />
            ))}
            {totalDur > 0 && Array.from({ length: Math.ceil(totalDur / 5) + 1 }).map((_, i) => {
              const t = i * 5;
              if (t > totalDur) return null;
              return (
                <span key={i} className="absolute text-[8px] text-muted-foreground/60 font-mono -translate-x-1/2" style={{ left: `${(t / totalDur) * 100}%` }}>
                  {fmt(t)}
                </span>
              );
            })}
          </div>

          {/* Waveform + fade handles + export range overlay — grows/shrinks with the dock height */}
          <div ref={timelineRef} className="relative cursor-crosshair rounded bg-black overflow-hidden border border-white/5"
            style={{ flexGrow: 36, flexShrink: 1, flexBasis: 0, minHeight: 24 }}
            onClick={handleTimelineClick} onPointerDown={startRangeCreate} title="Click to seek · drag to select export range">
            {audioUrl ? (
              <TinyWaveform progress={totalDur > 0 ? currentTime / totalDur : 0} />
            ) : (
              <div className="w-full h-full flex items-center justify-center gap-2">
                <Music2 className="h-3 w-3 text-amber-400/40" />
                <span className="text-[9px] text-amber-400/40">Add a song to see the waveform</span>
              </div>
            )}

            {/* Export range shading */}
            {totalDur > 0 && (() => {
              const startPct = (exportRange.mode === "full" ? 0 : exportRange.customStartSec / totalDur) * 100;
              const endPct = (exportRange.mode === "full" ? totalDur : exportRange.customEndSec) / totalDur * 100;
              if (exportRange.mode !== "custom") return null;
              return (
                <>
                  <div className="absolute inset-y-0 bg-primary/10 pointer-events-none" style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
                  <div onPointerDown={(e) => startRangeDrag(e, "start")}
                    className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-green-400/70 cursor-ew-resize z-20 hover:bg-green-300"
                    style={{ left: `${startPct}%` }} title="Export range start" />
                  <div onPointerDown={(e) => startRangeDrag(e, "end")}
                    className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-red-400/70 cursor-ew-resize z-20 hover:bg-red-300"
                    style={{ left: `${endPct}%` }} title="Export range end" />
                </>
              );
            })()}

            {/* Fade-in handle */}
            {totalDur > 0 && va.fadeIn > 0 && (
              <div className="absolute inset-y-0 bg-gradient-to-r from-black/70 to-transparent pointer-events-none" style={{ left: 0, width: `${(va.fadeIn / totalDur) * 100}%` }} />
            )}
            {totalDur > 0 && (
              <div onPointerDown={(e) => startFadeDrag(e, "in")}
                className="absolute top-0 bottom-0 w-2 -translate-x-1/2 cursor-ew-resize z-20 flex items-center justify-center group"
                style={{ left: `${(va.fadeIn / totalDur) * 100}%` }} title={`Fade in: ${va.fadeIn.toFixed(1)}s — drag to adjust`}>
                <div className="w-0.5 h-full bg-amber-400/70 group-hover:bg-amber-300" />
              </div>
            )}

            {/* Fade-out handle */}
            {totalDur > 0 && va.fadeOut > 0 && (
              <div className="absolute inset-y-0 bg-gradient-to-l from-black/70 to-transparent pointer-events-none" style={{ right: 0, width: `${(va.fadeOut / totalDur) * 100}%` }} />
            )}
            {totalDur > 0 && (
              <div onPointerDown={(e) => startFadeDrag(e, "out")}
                className="absolute top-0 bottom-0 w-2 -translate-x-1/2 cursor-ew-resize z-20 flex items-center justify-center group"
                style={{ left: `${((totalDur - va.fadeOut) / totalDur) * 100}%` }} title={`Fade out: ${va.fadeOut.toFixed(1)}s — drag to adjust`}>
                <div className="w-0.5 h-full bg-amber-400/70 group-hover:bg-amber-300" />
              </div>
            )}

            {/* Song crop overlay — dims/excludes the discarded head + tail of the song */}
            {totalDur > 0 && songCrop.enabled && (() => {
              const startPct = (songCrop.startSec / totalDur) * 100;
              const endPct = (cropEndResolved / totalDur) * 100;
              return (
                <>
                  {startPct > 0 && <div className="absolute inset-y-0 left-0 bg-black/80 pointer-events-none z-10" style={{ width: `${startPct}%` }} />}
                  {endPct < 100 && <div className="absolute inset-y-0 right-0 bg-black/80 pointer-events-none z-10" style={{ width: `${100 - endPct}%` }} />}
                  <div onPointerDown={(e) => startCropDrag(e, "start")}
                    className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-cyan-400/80 cursor-ew-resize z-20 hover:bg-cyan-300"
                    style={{ left: `${startPct}%` }} title={`Crop start: ${fmt(songCrop.startSec)}`} />
                  <div onPointerDown={(e) => startCropDrag(e, "end")}
                    className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 bg-cyan-400/80 cursor-ew-resize z-20 hover:bg-cyan-300"
                    style={{ left: `${endPct}%` }} title={`Crop end: ${fmt(cropEndResolved)}`} />
                </>
              );
            })()}

            {totalDur > 0 && (
              <div className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none z-30" style={{ left: `${(currentTime / totalDur) * 100}%` }}>
                <div className="absolute -top-0 -translate-x-1/2 w-2 h-2 bg-primary rounded-full" />
              </div>
            )}
          </div>

          {/* Clip track — flex layout keeps clips structurally back-to-back; grows/shrinks with the dock height */}
          <div className="relative bg-black cursor-crosshair rounded mt-1 border border-white/5"
            style={{ flexGrow: 56, flexShrink: 1, flexBasis: 0, minHeight: 32 }} onClick={handleTimelineClick}>
            {scenes.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground/40">
                <Film className="h-4 w-4" />
                <span className="text-[10px]">Generate clips to see them here</span>
              </div>
            ) : isManual ? (
              <div className="relative h-full w-full">
                {scenes.map((scene, i) => {
                  const ce = clipEdits[scene.id];
                  const trimStart = ce?.trimStart ?? 0;
                  const trimEnd = ce?.trimEnd ?? 0;
                  const clipDur = durs[i] ?? 5;
                  const clipStart = offsets[i] ?? 0;
                  const timing = manualCalc!.timings[i]!;
                  const leftPct = totalDur > 0 ? (clipStart / totalDur) * 100 : 0;
                  const widthPct = totalDur > 0 ? (clipDur / totalDur) * 100 : 100 / scenes.length;
                  const color = CLIP_COLORS[i % CLIP_COLORS.length]!;
                  const selected = isSelected(i);
                  const active = currentTime >= clipStart && currentTime < clipStart + clipDur;
                  const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
                  const hasClip = useLipSync || !!scene.demoClipUrl;
                  const hasOverlap = timing.overlapWithPrevSec > 0.05;
                  const hasGap = timing.gapBeforeSec > 0.3;
                  return (
                    <div key={scene.id}
                      className="absolute top-0 bottom-0"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%`, zIndex: selected ? 15 : hasOverlap ? 10 : 5 }}
                    >
                      {hasGap && (
                        <div className="absolute -left-2 top-0 bottom-0 flex items-center pointer-events-none" title={`Gap: ${timing.gapBeforeSec.toFixed(1)}s`}>
                          <span className="text-[7px] text-white/25 font-mono -translate-x-full whitespace-nowrap">{timing.gapBeforeSec.toFixed(1)}s gap</span>
                        </div>
                      )}
                      <div
                        onPointerDown={(e) => startMoveDrag(e, scene.id, clipStart)}
                        className="relative h-full rounded flex items-center overflow-hidden select-none mx-px"
                        style={{
                          background: !hasClip ? "rgba(251,191,36,0.18)" : selected ? `${color}bb` : active ? `${color}88` : `${color}44`,
                          border: `1px solid ${hasOverlap ? "#f472b6" : !hasClip ? "rgba(251,191,36,0.5)" : selected ? color : active ? `${color}88` : `${color}33`}`,
                          boxShadow: selected ? `0 0 0 1px ${color}55, 0 0 12px ${color}33` : hasOverlap ? "0 0 0 1px #f472b655" : undefined,
                          cursor: "grab",
                        }}
                        onClick={(e) => { e.stopPropagation(); setSelectedIdx(selected ? null : i); }}
                        data-testid={`timeline-dock-clip-${i}`}
                      >
                        {trimStart > 0 && clipDur > 0 && (
                          <div className="absolute left-0 top-0 bottom-0 pointer-events-none"
                            style={{ width: `${Math.min(48, (trimStart / clipDur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderRight: "1px dashed rgba(255,255,255,0.25)" }} />
                        )}
                        {trimEnd > 0 && clipDur > 0 && (
                          <div className="absolute right-0 top-0 bottom-0 pointer-events-none"
                            style={{ width: `${Math.min(48, (trimEnd / clipDur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderLeft: "1px dashed rgba(255,255,255,0.25)" }} />
                        )}
                        <div className="px-1.5 z-10 min-w-0 flex-1 overflow-hidden pointer-events-none">
                          <p className="text-[8px] font-bold text-white truncate leading-tight">{i + 1}. {scene.section || `Scene ${i + 1}`}</p>
                          <p className="text-[7px] text-white/40 font-mono">{fmt(clipStart)}–{fmt(clipStart + clipDur)}</p>
                        </div>
                        {!hasClip && <span className="text-[9px] text-amber-400 mr-1 shrink-0 pointer-events-none">⚠</span>}
                        {useLipSync && <span className="text-[6px] text-violet-300 mr-1 shrink-0 font-bold pointer-events-none">LS</span>}
                        {hasOverlap && <span className="text-[6px] text-pink-300 mr-1 shrink-0 font-bold pointer-events-none" title={`Overlap: ${timing.overlapWithPrevSec.toFixed(1)}s → transition`}>⇄{timing.overlapWithPrevSec.toFixed(1)}s</span>}
                        {selected && (
                          <>
                            <div className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center hover:bg-white/15 rounded-l transition-colors"
                              onPointerDown={(e) => startTrimDrag(e, "start", scene.id, clipDur, clipStart)}
                              onClick={(e) => e.stopPropagation()}>
                              <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                            </div>
                            <div className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center hover:bg-white/15 rounded-r transition-colors"
                              onPointerDown={(e) => startTrimDrag(e, "end", scene.id, clipDur, clipStart)}
                              onClick={(e) => e.stopPropagation()}>
                              <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={scenes.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
                  <div className="flex h-full w-full">
                    {scenes.map((scene, i) => {
                      const ce = clipEdits[scene.id];
                      const trimStart = ce?.trimStart ?? 0;
                      const trimEnd = ce?.trimEnd ?? 0;
                      const clipDur = durs[i] ?? 5;
                      const clipStart = offsets[i] ?? 0;
                      const widthPct = totalDur > 0 ? (clipDur / totalDur) * 100 : 100 / scenes.length;
                      const color = CLIP_COLORS[i % CLIP_COLORS.length]!;
                      const selected = isSelected(i);
                      const active = currentTime >= clipStart && currentTime < clipStart + clipDur;
                      const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
                      const hasClip = useLipSync || !!scene.demoClipUrl;
                      return (
                        <SortableClip key={scene.id} id={scene.id} widthPct={widthPct}>
                          {(dragHandleProps, isDragging) => (
                            <div
                              {...dragHandleProps}
                              className="relative h-full rounded flex items-center overflow-hidden select-none mx-px"
                              style={{
                                background: !hasClip ? "rgba(251,191,36,0.18)" : selected ? `${color}bb` : active ? `${color}88` : `${color}44`,
                                border: `1px solid ${!hasClip ? "rgba(251,191,36,0.5)" : selected ? color : active ? `${color}88` : `${color}33`}`,
                                boxShadow: selected ? `0 0 0 1px ${color}55, 0 0 12px ${color}33` : undefined,
                                opacity: isDragging ? 0.6 : 1,
                                cursor: "grab",
                              }}
                              onClick={(e) => { e.stopPropagation(); setSelectedIdx(selected ? null : i); }}
                              data-testid={`timeline-dock-clip-${i}`}
                            >
                              {trimStart > 0 && clipDur > 0 && (
                                <div className="absolute left-0 top-0 bottom-0 pointer-events-none"
                                  style={{ width: `${Math.min(48, (trimStart / clipDur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderRight: "1px dashed rgba(255,255,255,0.25)" }} />
                              )}
                              {trimEnd > 0 && clipDur > 0 && (
                                <div className="absolute right-0 top-0 bottom-0 pointer-events-none"
                                  style={{ width: `${Math.min(48, (trimEnd / clipDur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderLeft: "1px dashed rgba(255,255,255,0.25)" }} />
                              )}
                              <div className="px-1.5 z-10 min-w-0 flex-1 overflow-hidden">
                                <p className="text-[8px] font-bold text-white truncate leading-tight">{i + 1}. {scene.section || `Scene ${i + 1}`}</p>
                                <p className="text-[7px] text-white/40 font-mono">{fmt(clipStart)}–{fmt(clipStart + clipDur)}</p>
                              </div>
                              {!hasClip && <span className="text-[9px] text-amber-400 mr-1 shrink-0">⚠</span>}
                              {useLipSync && <span className="text-[6px] text-violet-300 mr-1 shrink-0 font-bold">LS</span>}
                              {selected && (
                                <>
                                  <div className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center hover:bg-white/15 rounded-l transition-colors"
                                    onPointerDown={(e) => startTrimDrag(e, "start", scene.id, clipDur, clipStart)}
                                    onClick={(e) => e.stopPropagation()}>
                                    <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                                  </div>
                                  <div className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center hover:bg-white/15 rounded-r transition-colors"
                                    onPointerDown={(e) => startTrimDrag(e, "end", scene.id, clipDur, clipStart)}
                                    onClick={(e) => e.stopPropagation()}>
                                    <div className="w-0.5 h-3/4 bg-white/60 rounded-full" />
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </SortableClip>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            {totalDur > 0 && (
              <div className="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none z-30" style={{ left: `${(currentTime / totalDur) * 100}%` }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sortable clip wrapper — flexBasis keeps clips back-to-back, no gaps/overlap ── */
function SortableClip({
  id, widthPct, children,
}: {
  id: string;
  widthPct: number;
  children: (dragHandleProps: React.HTMLAttributes<HTMLElement>, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: `0 0 ${widthPct}%`,
        transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        height: "100%",
      }}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  );
}

/* ── Tiny waveform (visual only) ── */
function TinyWaveform({ progress = 0 }: { progress?: number }) {
  const segments = 200;
  const points = useMemo(() => Array.from({ length: segments }, (_, i) => {
    const t = i / segments;
    const h =
      0.25 * Math.abs(Math.sin(t * 13.1 + 0.4)) +
      0.35 * Math.abs(Math.sin(t * 27.8 + 2.1)) +
      0.25 * Math.abs(Math.sin(t * 53.2 + 5.7)) +
      0.15 * Math.abs(Math.sin(t * 91.0 + 8.3));
    return Math.max(0.08, Math.min(1, h));
  }), []);
  return (
    <div className="absolute inset-0 flex items-center gap-px px-0.5">
      {points.map((h, i) => {
        const played = i / segments < progress;
        return (
          <div key={i} className="flex-1 rounded-full" style={{ height: `${h * 100}%`, background: played ? "rgba(234,179,8,0.55)" : "rgba(255,255,255,0.12)" }} />
        );
      })}
    </div>
  );
}
