import { Layers, Plus, Scissors, Trash2 } from "lucide-react";
import type { EditorSettings, OverlayItem } from "@/lib/editor-settings";
import {
  resolveLanes, moveLaneItem, trimLaneItem, splitLaneItem, deleteLaneItem,
  addOverlayLane, newLaneItemId, NEUTRAL_ADJUSTMENT_CC,
  type TimelineLanes, type AdjustmentLaneItem,
} from "@/lib/timeline-lanes";
import { EditorCard } from "@/components/editor/controls";

/* ── Multi-track lanes (Stack 5 #1 + #6) ──────────────────────────────────
 * Docks inside the Timeline tab, under the Scene Timeline card — the lane
 * family already lives there. Overlay + caption tracks are real editable
 * tracks (add / move / trim / split / delete); the adjustment lane holds
 * adjustment-layer clips whose grade applies over the cut at export.
 * Edits write settings.lanes AND the legacy projections (overlayItems /
 * captions.lines) in the same update, so every existing consumer (preview,
 * export) sees the same truth the lanes show. */

export function ensureLanes(settings: EditorSettings): TimelineLanes {
  return resolveLanes({
    lanes: settings.lanes,
    overlayItems: settings.overlayItems,
    captionLines: settings.captions.lines,
  });
}

/** Write lanes + their legacy projections back into settings atomically. */
export function commitLanes(settings: EditorSettings, lanes: TimelineLanes): EditorSettings {
  return {
    ...settings,
    lanes,
    overlayItems: lanes.overlayLanes.flatMap((lane) =>
      lane.items.map((it) => ({ ...it.overlay, startTime: it.startSec, endTime: it.endSec }))),
    captions: {
      ...settings.captions,
      lines: lanes.captionLane.items.map((it) => ({ ...it.line, startSec: it.startSec, endSec: it.endSec })),
    },
  };
}

const num = "w-16 bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[11px] text-white/80";
const rowBtn = "inline-flex items-center gap-1 text-[10px] font-bold text-white/50 hover:text-white border border-white/10 rounded px-1.5 py-1";

function TimeFields({ start, end, onStart, onEnd }: {
  start: number; end: number;
  onStart: (v: number) => void; onEnd: (v: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" step={0.1} min={0} value={start} className={num}
        onChange={(e) => onStart(Number(e.target.value))} title="Start (seconds) — moves the item" />
      <span className="text-white/30 text-[10px]">→</span>
      <input type="number" step={0.1} min={0} value={end} className={num}
        onChange={(e) => onEnd(Number(e.target.value))} title="End (seconds) — trims the item" />
    </span>
  );
}

export function LanesPanel({ settings, setSettings }: {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
}) {
  const lanes = ensureLanes(settings);
  const commit = (next: TimelineLanes) => setSettings(commitLanes(settings, next));

  const patchOverlayLane = (laneId: string, items: TimelineLanes["overlayLanes"][number]["items"]) =>
    commit({ ...lanes, overlayLanes: lanes.overlayLanes.map((l) => (l.id === laneId ? { ...l, items } : l)) });
  const patchCaptions = (items: TimelineLanes["captionLane"]["items"]) =>
    commit({ ...lanes, captionLane: { items } });
  const patchAdjustment = (items: AdjustmentLaneItem[]) =>
    commit({ ...lanes, adjustmentLane: { items } });

  function addTextOverlay(laneId: string) {
    const lane = lanes.overlayLanes.find((l) => l.id === laneId);
    if (!lane) return;
    const start = lane.items.length ? Math.max(...lane.items.map((i) => i.endSec)) : 0;
    const overlay: OverlayItem = {
      id: newLaneItemId("ov"), sceneId: null, startTime: start, endTime: start + 3,
      type: "text", content: "New overlay", source: null, position: "bottom-center",
      size: 50, opacity: 100, animation: "fade-in-out", zIndex: 0, color: "#000000", textColor: "#ffffff",
    };
    const item = { id: overlay.id, startSec: start, endSec: start + 3, overlay };
    patchOverlayLane(laneId, [...lane.items, item]);
  }

  function addAdjustment() {
    const start = lanes.adjustmentLane.items.length ? Math.max(...lanes.adjustmentLane.items.map((i) => i.endSec)) : 0;
    patchAdjustment([...lanes.adjustmentLane.items, {
      id: newLaneItemId("adj"), startSec: start, endSec: start + 5,
      colorCorrection: { ...NEUTRAL_ADJUSTMENT_CC }, effects: [],
    }]);
  }

  return (
    <EditorCard title="Timeline Lanes" subtitle="Overlay, caption & adjustment tracks — edits here are what export renders"
      icon={<Layers className="h-4 w-4" />} className="!bg-black !border-white/10">
      <div className="space-y-4">
        {lanes.overlayLanes.map((lane) => (
          <div key={lane.id}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">{lane.name}</p>
              <span className="flex gap-1.5">
                <button type="button" className={rowBtn} onClick={() => addTextOverlay(lane.id)}>
                  <Plus className="h-3 w-3" /> Text overlay
                </button>
                {lane.id === lanes.overlayLanes[lanes.overlayLanes.length - 1]!.id && (
                  <button type="button" className={rowBtn} onClick={() => commit(addOverlayLane(lanes))}>
                    <Plus className="h-3 w-3" /> Lane
                  </button>
                )}
              </span>
            </div>
            {lane.items.length === 0 && <p className="text-[11px] text-white/30">No items on this lane yet.</p>}
            <div className="space-y-1.5">
              {lane.items.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                  <input value={it.overlay.content} aria-label="Overlay text"
                    onChange={(e) => patchOverlayLane(lane.id, lane.items.map((x) => x.id === it.id
                      ? { ...x, overlay: { ...x.overlay, content: e.target.value } } : x))}
                    className="flex-1 min-w-24 bg-transparent text-[11px] text-white/80 focus:outline-none" />
                  <TimeFields start={it.startSec} end={it.endSec}
                    onStart={(v) => patchOverlayLane(lane.id, moveLaneItem(lane.items, it.id, v))}
                    onEnd={(v) => patchOverlayLane(lane.id, trimLaneItem(lane.items, it.id, "end", v))} />
                  <button type="button" className={rowBtn} title="Split at midpoint"
                    onClick={() => patchOverlayLane(lane.id, splitLaneItem(lane.items, it.id, (it.startSec + it.endSec) / 2,
                      (left) => ({ ...left, id: newLaneItemId("ov"), overlay: { ...left.overlay, id: newLaneItemId("ov") } })))}>
                    <Scissors className="h-3 w-3" /> Split
                  </button>
                  <button type="button" className={rowBtn} title="Delete item"
                    onClick={() => patchOverlayLane(lane.id, deleteLaneItem(lane.items, it.id))}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Caption lane */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">Captions lane</p>
          {lanes.captionLane.items.length === 0 && (
            <p className="text-[11px] text-white/30">No caption blocks yet — generate or add captions in the Captions tab and they land here as track items.</p>
          )}
          <div className="space-y-1.5">
            {lanes.captionLane.items.map((it) => (
              <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <input value={it.line.text} aria-label="Caption text"
                  onChange={(e) => patchCaptions(lanes.captionLane.items.map((x) => x.id === it.id
                    ? { ...x, line: { ...x.line, text: e.target.value, words: undefined } } : x))}
                  className="flex-1 min-w-24 bg-transparent text-[11px] text-white/80 focus:outline-none" />
                <TimeFields start={it.startSec} end={it.endSec}
                  onStart={(v) => patchCaptions(moveLaneItem(lanes.captionLane.items, it.id, v))}
                  onEnd={(v) => patchCaptions(trimLaneItem(lanes.captionLane.items, it.id, "end", v))} />
                <button type="button" className={rowBtn} title="Split at midpoint"
                  onClick={() => patchCaptions(splitLaneItem(lanes.captionLane.items, it.id, (it.startSec + it.endSec) / 2,
                    (left) => ({ ...left, id: newLaneItemId("cap"), line: { ...left.line, id: newLaneItemId("cap") } })))}>
                  <Scissors className="h-3 w-3" /> Split
                </button>
                <button type="button" className={rowBtn} title="Delete caption block"
                  onClick={() => patchCaptions(deleteLaneItem(lanes.captionLane.items, it.id))}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Adjustment lane (#6) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Adjustment lane</p>
            <button type="button" className={rowBtn} onClick={addAdjustment}>
              <Plus className="h-3 w-3" /> Adjustment clip
            </button>
          </div>
          <p className="text-[11px] text-white/35 mb-1.5">
            An adjustment clip grades everything under it for its time window at export. Trim or move it like any lane item.
          </p>
          <div className="space-y-1.5">
            {lanes.adjustmentLane.items.map((it) => (
              <div key={it.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <TimeFields start={it.startSec} end={it.endSec}
                    onStart={(v) => patchAdjustment(moveLaneItem(lanes.adjustmentLane.items, it.id, v))}
                    onEnd={(v) => patchAdjustment(trimLaneItem(lanes.adjustmentLane.items, it.id, "end", v))} />
                  <button type="button" className={rowBtn} title="Delete adjustment clip"
                    onClick={() => patchAdjustment(deleteLaneItem(lanes.adjustmentLane.items, it.id))}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["contrast", "saturation", "temperature"] as const).map((key) => (
                    <label key={key} className="text-[10px] text-white/50">
                      {key} {it.colorCorrection[key] > 0 ? "+" : ""}{it.colorCorrection[key]}
                      <input type="range" min={-100} max={100} value={it.colorCorrection[key]}
                        onChange={(e) => patchAdjustment(lanes.adjustmentLane.items.map((x) => x.id === it.id
                          ? { ...x, colorCorrection: { ...x.colorCorrection, [key]: Number(e.target.value) } } : x))}
                        className="w-full h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </EditorCard>
  );
}
