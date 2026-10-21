/* ── Text-based editing v1 (Stack 5 #7) ──────────────────────────────────
 * Edit the cut by editing the transcript. Each transcript SEGMENT is one
 * clip segment (a scene): its text is the caption lines that fall inside
 * the scene's time window (falling back to the scene's lyric/section text).
 *
 * v1 scope, honestly: SEGMENT-level reorder + delete only — no word-level
 * surgery. Applying an edit writes the SCENES array (the timeline stays
 * the source of truth) and re-times the moved scenes' caption lines to
 * their new cumulative positions (relative offsets inside the scene are
 * preserved), so captions stay glued to the clip they were written for.
 * Deleted segments take their caption lines with them.
 */

import type { CaptionLine } from "@/lib/editor-settings";

export interface TextSegment {
  sceneId: string;
  index: number;
  startSec: number;
  endSec: number;
  /** Joined caption text for the segment (may be "" when untranscribed). */
  text: string;
  captionIds: string[];
}

/** Scene windows from cumulative durations (even split when unknown). */
export function sceneWindows<T extends { id: string }>(
  scenes: T[],
  durations: Map<string, number> | Record<string, number>,
  fallbackEach = 5,
): { scene: T; startSec: number; endSec: number }[] {
  const out: { scene: T; startSec: number; endSec: number }[] = [];
  let acc = 0;
  for (const scene of scenes) {
    const d = (durations instanceof Map ? durations.get(scene.id) : durations[scene.id]) ?? fallbackEach;
    const dur = Number.isFinite(d) && d > 0 ? d : fallbackEach;
    out.push({ scene, startSec: acc, endSec: acc + dur });
    acc += dur;
  }
  return out;
}

export function buildTextSegments<T extends { id: string; lyricLine?: string; section?: string }>(
  scenes: T[],
  captionLines: CaptionLine[],
  durations: Map<string, number> | Record<string, number>,
): TextSegment[] {
  const windows = sceneWindows(scenes, durations);
  return windows.map((w, index) => {
    const lines = captionLines.filter((l) => l.startSec >= w.startSec - 0.001 && l.startSec < w.endSec - 0.001);
    const text = lines.length > 0
      ? lines.map((l) => l.text).join(" ")
      : (w.scene.lyricLine ?? w.scene.section ?? "");
    return {
      sceneId: w.scene.id,
      index,
      startSec: Math.round(w.startSec * 1000) / 1000,
      endSec: Math.round(w.endSec * 1000) / 1000,
      text,
      captionIds: lines.map((l) => l.id),
    };
  });
}

/**
 * Reorder scenes to match `orderedSceneIds` (ids not listed keep their
 * relative order at the end) and re-time every scene's caption lines to the
 * new layout. Scenes/captions the transcript doesn't know about are kept.
 */
export function applyTextReorder<T extends { id: string }>(
  scenes: T[],
  captionLines: CaptionLine[],
  orderedSceneIds: string[],
  durations: Map<string, number> | Record<string, number>,
): { scenes: T[]; captionLines: CaptionLine[] } {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const ordered: T[] = [];
  for (const id of orderedSceneIds) {
    const s = byId.get(id);
    if (s) { ordered.push(s); byId.delete(id); }
  }
  for (const s of scenes) if (byId.has(s.id)) ordered.push(s);

  const oldWindows = sceneWindows(scenes, durations);
  const newWindows = sceneWindows(ordered, durations);
  const oldStart = new Map(oldWindows.map((w) => [w.scene.id, w.startSec]));
  const newStart = new Map(newWindows.map((w) => [w.scene.id, w.startSec]));
  const ownerOf = (line: CaptionLine): string | null => {
    for (const w of oldWindows) {
      if (line.startSec >= w.startSec - 0.001 && line.startSec < w.endSec - 0.001) return w.scene.id;
    }
    return oldWindows.length ? oldWindows[oldWindows.length - 1]!.scene.id : null;
  };
  const lines = captionLines.map((line) => {
    const owner = ownerOf(line);
    if (!owner) return line;
    const delta = (newStart.get(owner) ?? 0) - (oldStart.get(owner) ?? 0);
    if (delta === 0) return line;
    return {
      ...line,
      startSec: Math.round((line.startSec + delta) * 1000) / 1000,
      endSec: Math.round((line.endSec + delta) * 1000) / 1000,
    };
  }).sort((a, b) => a.startSec - b.startSec);
  return { scenes: ordered, captionLines: lines };
}

/** Delete one segment: removes the scene and the caption lines it owned. */
export function applyTextDelete<T extends { id: string }>(
  scenes: T[],
  captionLines: CaptionLine[],
  sceneId: string,
  durations: Map<string, number> | Record<string, number>,
): { scenes: T[]; captionLines: CaptionLine[] } {
  const remaining = scenes.filter((s) => s.id !== sceneId);
  const windows = sceneWindows(scenes, durations);
  const win = windows.find((w) => w.scene.id === sceneId);
  if (!win) return { scenes: remaining, captionLines };
  const freed = win.endSec - win.startSec;
  // Drop the deleted scene's lines; lines after it shift up by its duration.
  const keptLines = captionLines
    .filter((l) => !(l.startSec >= win.startSec - 0.001 && l.startSec < win.endSec - 0.001))
    .map((l) => (l.startSec >= win.endSec - 0.001
      ? {
          ...l,
          startSec: Math.round((l.startSec - freed) * 1000) / 1000,
          endSec: Math.round((l.endSec - freed) * 1000) / 1000,
        }
      : l))
    .sort((a, b) => a.startSec - b.startSec);
  return { scenes: remaining, captionLines: keptLines };
}
