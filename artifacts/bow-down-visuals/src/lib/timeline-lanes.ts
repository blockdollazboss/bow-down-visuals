/* ── True multi-track timeline lanes (Stack 5 #1) ──────────────────────────
 * The lane model is the timeline's editable structure for everything that
 * is NOT the main clip track:
 *   • overlay lanes (1..n) — OverlayItem clips you can add/move/trim/split/delete
 *   • one caption lane     — CaptionLine blocks as track items
 *   • one adjustment lane  — adjustment-layer clips (grade/effects over the cut)
 *   • one music lane       — the song, carrying the ducking control (#5)
 *
 * The main clip track stays the scenes array (the timeline's source of
 * truth). Legacy projects (single clip track + `overlayItems` timed list +
 * `captions.lines` timed list) migrate into lanes WITHOUT losing content:
 * every legacy overlay item lands on overlay lane 1 in its original order,
 * every caption line lands on the caption lane, and `lanesToOverlayItems` /
 * `lanesToCaptionLines` project lanes back to the exact legacy shapes the
 * export pipeline already renders — so export stays truthful by construction.
 */

import type { CaptionLine, OverlayItem } from "@/lib/editor-settings";

export type LaneKind = "overlay" | "captions" | "adjustment" | "music";

export interface LaneItemBase {
  id: string;
  /** Seconds on the full timeline. */
  startSec: number;
  endSec: number;
}

/** An overlay clip on an overlay lane — the full legacy OverlayItem payload. */
export interface OverlayLaneItem extends LaneItemBase {
  overlay: OverlayItem;
}

/** A caption block on the caption lane — the full legacy CaptionLine payload. */
export interface CaptionLaneItem extends LaneItemBase {
  line: CaptionLine;
}

/** An adjustment-layer clip: its grade/effects apply to everything beneath
 *  it for its time window at export (see server lane-export.ts). */
export interface AdjustmentLaneItem extends LaneItemBase {
  /** Color-correction sliders (-100..100), same vocabulary as Pro Tools. */
  colorCorrection: {
    brightness: number; contrast: number; saturation: number;
    temperature: number; tint: number; highlights: number;
    shadows: number; vibrance: number; exposure: number;
  };
  /** Global effect names (settings.effects vocabulary) applied in-window. */
  effects: string[];
}

export interface TimelineLanes {
  version: 1;
  overlayLanes: { id: string; name: string; items: OverlayLaneItem[] }[];
  captionLane: { items: CaptionLaneItem[] };
  adjustmentLane: { items: AdjustmentLaneItem[] };
}

export const NEUTRAL_ADJUSTMENT_CC = {
  brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vibrance: 0, exposure: 0,
};

let laneSeq = 0;
export function newLaneItemId(prefix = "lane"): string {
  laneSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${laneSeq}-${Math.random().toString(36).slice(2, 7)}`;
}

const clampTime = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n * 1000) / 1000) : 0);

/** Sanitize one lane item's window: finite, start ≥ 0, end > start (min 0.1s). */
export function sanitizeWindow<T extends LaneItemBase>(item: T): T {
  const startSec = clampTime(item.startSec);
  const endSec = Math.max(startSec + 0.1, clampTime(item.endSec));
  return { ...item, startSec, endSec };
}

const byStart = <T extends LaneItemBase>(a: T, b: T) => a.startSec - b.startSec || a.endSec - b.endSec;

/* ── Migration: legacy timed lists → lanes ─────────────────────────────── */

/**
 * Build the lane model from a legacy project shape. Pure and lossless:
 * overlay order is preserved (stable sort by start, then original index),
 * caption text/words/confidence ride along untouched inside `line`.
 */
export function migrateLegacyToLanes(input: {
  overlayItems?: OverlayItem[] | null;
  captionLines?: CaptionLine[] | null;
  adjustmentItems?: AdjustmentLaneItem[] | null;
}): TimelineLanes {
  const overlays = (input.overlayItems ?? []).map((ov, i) => ({
    item: sanitizeWindow<OverlayLaneItem>({
      id: ov.id || newLaneItemId("ov"),
      startSec: ov.startTime,
      endSec: ov.endTime,
      overlay: ov,
    }),
    i,
  }));
  overlays.sort((a, b) => byStart(a.item, b.item) || a.i - b.i);

  const captions = (input.captionLines ?? []).map((line) =>
    sanitizeWindow<CaptionLaneItem>({
      id: line.id || newLaneItemId("cap"),
      startSec: line.startSec,
      endSec: line.endSec,
      line,
    }),
  );
  captions.sort(byStart);

  return {
    version: 1,
    overlayLanes: [{ id: "overlay-1", name: "Overlay 1", items: overlays.map((o) => o.item) }],
    captionLane: { items: captions },
    adjustmentLane: {
      items: (input.adjustmentItems ?? []).map((a) => sanitizeWindow({ ...a })).sort(byStart),
    },
  };
}

/** Validate/sanitize a stored lanes blob (project JSON may be partial/old). */
export function sanitizeLanes(raw: unknown): TimelineLanes | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TimelineLanes>;
  if (!Array.isArray(r.overlayLanes) && !r.captionLane && !r.adjustmentLane) return null;
  const lanes = migrateLegacyToLanes({});
  if (Array.isArray(r.overlayLanes)) {
    lanes.overlayLanes = r.overlayLanes.map((lane, li) => ({
      id: typeof lane?.id === "string" && lane.id ? lane.id : `overlay-${li + 1}`,
      name: typeof lane?.name === "string" && lane.name ? lane.name : `Overlay ${li + 1}`,
      items: (Array.isArray(lane?.items) ? lane.items : [])
        .filter((it): it is OverlayLaneItem => !!it && typeof it === "object" && !!(it as OverlayLaneItem).overlay)
        .map((it) => sanitizeWindow({ ...it, overlay: { ...it.overlay, startTime: it.startSec, endTime: it.endSec } }))
        .sort(byStart),
    }));
    if (lanes.overlayLanes.length === 0) lanes.overlayLanes = [{ id: "overlay-1", name: "Overlay 1", items: [] }];
  }
  if (r.captionLane && Array.isArray(r.captionLane.items)) {
    lanes.captionLane.items = r.captionLane.items
      .filter((it): it is CaptionLaneItem => !!it && typeof it === "object" && !!(it as CaptionLaneItem).line)
      .map((it) => sanitizeWindow({ ...it, line: { ...it.line, startSec: it.startSec, endSec: it.endSec } }))
      .sort(byStart);
  }
  if (r.adjustmentLane && Array.isArray(r.adjustmentLane.items)) {
    lanes.adjustmentLane.items = r.adjustmentLane.items
      .filter((it): it is AdjustmentLaneItem => !!it && typeof it === "object")
      .map((it) => sanitizeWindow({
        ...it,
        colorCorrection: { ...NEUTRAL_ADJUSTMENT_CC, ...(it.colorCorrection ?? {}) },
        effects: Array.isArray(it.effects) ? it.effects : [],
      }))
      .sort(byStart);
  }
  return lanes;
}

/* ── Lane → legacy projections (what export consumes) ──────────────────── */

/** Flatten overlay lanes back to the timed list export renders. Lane order
 *  breaks ties so higher lanes (later in the array) draw on top via zIndex. */
export function lanesToOverlayItems(lanes: TimelineLanes): OverlayItem[] {
  const out: OverlayItem[] = [];
  lanes.overlayLanes.forEach((lane, laneIdx) => {
    for (const item of lane.items) {
      out.push({ ...item.overlay, startTime: item.startSec, endTime: item.endSec, zIndex: item.overlay.zIndex ?? laneIdx });
    }
  });
  return out.sort((a, b) => a.startTime - b.startTime);
}

export function lanesToCaptionLines(lanes: TimelineLanes): CaptionLine[] {
  return lanes.captionLane.items.map((item) => ({ ...item.line, startSec: item.startSec, endSec: item.endSec }));
}

/**
 * Sync check between lanes and the legacy lists. Lane edits always write
 * both shapes, so they stay equal; if another editor (Captions tab, motion
 * graphics) changed the legacy lists, the projections diverge and the
 * caller should re-migrate from legacy — last writer wins, nothing is
 * silently dropped from export.
 */
export function lanesAreInSync(
  lanes: TimelineLanes,
  overlayItems: OverlayItem[] | null | undefined,
  captionLines: CaptionLine[] | null | undefined,
): boolean {
  const projOv = lanesToOverlayItems(lanes);
  const legacyOv = overlayItems ?? [];
  if (projOv.length !== legacyOv.length) return false;
  for (let i = 0; i < projOv.length; i++) {
    const a = projOv[i]!, b = legacyOv[i]!;
    if (a.id !== b.id || a.startTime !== b.startTime || a.endTime !== b.endTime || a.content !== b.content) return false;
  }
  const projCap = lanesToCaptionLines(lanes);
  const legacyCap = captionLines ?? [];
  if (projCap.length !== legacyCap.length) return false;
  for (let i = 0; i < projCap.length; i++) {
    const a = projCap[i]!, b = legacyCap[i]!;
    if (a.id !== b.id || a.startSec !== b.startSec || a.endSec !== b.endSec || a.text !== b.text) return false;
  }
  return true;
}

/** Resolve the effective lanes for a project: stored lanes when in sync,
 *  otherwise a fresh migration from the legacy lists (keeping any stored
 *  adjustment items, which have no legacy counterpart). */
export function resolveLanes(input: {
  lanes?: TimelineLanes | null;
  overlayItems?: OverlayItem[] | null;
  captionLines?: CaptionLine[] | null;
}): TimelineLanes {
  if (input.lanes && lanesAreInSync(input.lanes, input.overlayItems, input.captionLines)) return input.lanes;
  const migrated = migrateLegacyToLanes(input);
  if (input.lanes) migrated.adjustmentLane = input.lanes.adjustmentLane;
  return migrated;
}

/* ── Generic lane-item operations (overlay + caption + adjustment) ─────── */

export function moveLaneItem<T extends LaneItemBase>(items: T[], id: string, newStartSec: number): T[] {
  return items
    .map((it) => {
      if (it.id !== id) return it;
      const dur = it.endSec - it.startSec;
      const startSec = clampTime(newStartSec);
      return sanitizeWindow({ ...it, startSec, endSec: startSec + dur });
    })
    .sort(byStart);
}

export function trimLaneItem<T extends LaneItemBase>(
  items: T[], id: string, edge: "start" | "end", toSec: number,
): T[] {
  return items
    .map((it) => {
      if (it.id !== id) return it;
      return edge === "start"
        ? sanitizeWindow({ ...it, startSec: Math.min(clampTime(toSec), it.endSec - 0.1) })
        : sanitizeWindow({ ...it, endSec: Math.max(clampTime(toSec), it.startSec + 0.1) });
    })
    .sort(byStart);
}

/** Split an item at `atSec` (must be strictly inside). Returns [left, right]
 *  replacements with fresh ids for the right half; no-op outside the window. */
export function splitLaneItem<T extends LaneItemBase>(
  items: T[], id: string, atSec: number, makeRight: (left: T) => T,
): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (it.id !== id || atSec <= it.startSec + 0.05 || atSec >= it.endSec - 0.05) {
      out.push(it);
      continue;
    }
    const left = sanitizeWindow({ ...it, endSec: atSec });
    const right = sanitizeWindow({ ...makeRight(left), startSec: atSec, endSec: it.endSec });
    out.push(left, right);
  }
  return out.sort(byStart);
}

export function deleteLaneItem<T extends LaneItemBase>(items: T[], id: string): T[] {
  return items.filter((it) => it.id !== id);
}

export function addOverlayLane(lanes: TimelineLanes): TimelineLanes {
  const n = lanes.overlayLanes.length + 1;
  return { ...lanes, overlayLanes: [...lanes.overlayLanes, { id: `overlay-${n}-${Date.now().toString(36)}`, name: `Overlay ${n}`, items: [] }] };
}

/** True when two items on the same lane overlap in time (editor warning). */
export function laneHasOverlap<T extends LaneItemBase>(items: T[]): boolean {
  const sorted = [...items].sort(byStart);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.startSec < sorted[i - 1]!.endSec - 0.001) return true;
  }
  return false;
}
