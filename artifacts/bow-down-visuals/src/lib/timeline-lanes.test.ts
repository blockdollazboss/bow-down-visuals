import { describe, it, expect } from "vitest";
import {
  migrateLegacyToLanes, sanitizeLanes, lanesToOverlayItems, lanesToCaptionLines, resolveLanes, lanesAreInSync,
  moveLaneItem, trimLaneItem, splitLaneItem, deleteLaneItem, laneHasOverlap,
  type OverlayLaneItem,
} from "./timeline-lanes";
import type { CaptionLine, OverlayItem } from "./editor-settings";

const ov = (id: string, startTime: number, endTime: number): OverlayItem => ({
  id, sceneId: null, startTime, endTime, type: "text", content: `ov-${id}`,
  source: null, position: "center", size: 50, opacity: 80, animation: "none",
  zIndex: 0, color: "#000000", textColor: "#ffffff",
});
const line = (id: string, startSec: number, endSec: number): CaptionLine => ({
  id, startSec, endSec, text: `line-${id}`, words: [{ word: `line-${id}`, start: 0, end: 0.4 }],
});

describe("migrateLegacyToLanes (old-shape fixture)", () => {
  it("loads a legacy project (timed lists only) into lanes without losing content", () => {
    const lanes = migrateLegacyToLanes({
      overlayItems: [ov("b", 4, 6), ov("a", 0, 2)],
      captionLines: [line("c2", 2, 4), line("c1", 0, 2)],
    });
    expect(lanes.version).toBe(1);
    expect(lanes.overlayLanes).toHaveLength(1);
    // sorted by start, content preserved
    expect(lanes.overlayLanes[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(lanes.captionLane.items.map((i) => i.id)).toEqual(["c1", "c2"]);
    expect(lanes.captionLane.items[0]!.line.words).toHaveLength(1);
  });

  it("round-trips back to the exact legacy shapes export renders", () => {
    const overlays = [ov("a", 0, 2), ov("b", 4, 6)];
    const lines = [line("c1", 0, 2), line("c2", 2, 4)];
    const lanes = migrateLegacyToLanes({ overlayItems: overlays, captionLines: lines });
    expect(lanesToOverlayItems(lanes).map((o) => [o.id, o.startTime, o.endTime])).toEqual([
      ["a", 0, 2], ["b", 4, 6],
    ]);
    expect(lanesToCaptionLines(lanes)).toEqual(lines);
  });

  it("handles an empty legacy project", () => {
    const lanes = migrateLegacyToLanes({});
    expect(lanes.overlayLanes[0]!.items).toEqual([]);
    expect(lanes.captionLane.items).toEqual([]);
    expect(lanes.adjustmentLane.items).toEqual([]);
  });
});

describe("lane item operations", () => {
  const items: OverlayLaneItem[] = [
    { id: "a", startSec: 0, endSec: 2, overlay: ov("a", 0, 2) },
    { id: "b", startSec: 4, endSec: 7, overlay: ov("b", 4, 7) },
  ];
  it("moves preserving duration", () => {
    const moved = moveLaneItem(items, "b", 1);
    expect(moved.find((i) => i.id === "b")).toMatchObject({ startSec: 1, endSec: 4 });
  });
  it("trims either edge with a 0.1s floor", () => {
    expect(trimLaneItem(items, "a", "end", 1).find((i) => i.id === "a")!.endSec).toBe(1);
    expect(trimLaneItem(items, "a", "start", 5).find((i) => i.id === "a")!.startSec).toBe(1.9);
  });
  it("splits inside the window only", () => {
    const split = splitLaneItem(items, "b", 5, (left) => ({ ...left, id: "b2", overlay: { ...left.overlay, id: "b2" } }));
    expect(split.map((i) => [i.id, i.startSec, i.endSec])).toEqual([["a", 0, 2], ["b", 4, 5], ["b2", 5, 7]]);
    expect(splitLaneItem(items, "b", 4, (l) => l)).toHaveLength(2);
  });
  it("deletes by id", () => {
    expect(deleteLaneItem(items, "a").map((i) => i.id)).toEqual(["b"]);
  });
  it("detects overlaps", () => {
    expect(laneHasOverlap(items)).toBe(false);
    expect(laneHasOverlap(moveLaneItem(items, "b", 1))).toBe(true);
  });
});

describe("resolveLanes — last writer wins", () => {
  it("keeps stored lanes while legacy lists match their projections", () => {
    const lanes = migrateLegacyToLanes({ overlayItems: [ov("a", 0, 2)], captionLines: [line("c1", 0, 2)] });
    const resolved = resolveLanes({ lanes, overlayItems: [ov("a", 0, 2)], captionLines: [line("c1", 0, 2)] });
    expect(resolved).toBe(lanes);
    expect(lanesAreInSync(lanes, [ov("a", 0, 2)], [line("c1", 0, 2)])).toBe(true);
  });
  it("re-migrates when another editor changed the legacy lists, keeping adjustment items", () => {
    const lanes = migrateLegacyToLanes({ overlayItems: [ov("a", 0, 2)], captionLines: [] });
    lanes.adjustmentLane.items.push({
      id: "adj1", startSec: 0, endSec: 5,
      colorCorrection: { brightness: 0, contrast: 20, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, vibrance: 0, exposure: 0 },
      effects: [],
    });
    const resolved = resolveLanes({ lanes, overlayItems: [ov("a", 0, 2), ov("new", 3, 5)], captionLines: [] });
    expect(resolved.overlayLanes[0]!.items.map((i) => i.id)).toEqual(["a", "new"]);
    expect(resolved.adjustmentLane.items.map((i) => i.id)).toEqual(["adj1"]);
  });
});

describe("sanitizeLanes", () => {
  it("returns null for non-lane blobs and repairs partial blobs", () => {
    expect(sanitizeLanes(null)).toBeNull();
    expect(sanitizeLanes({ hello: 1 })).toBeNull();
    const lanes = sanitizeLanes({ captionLane: { items: [{ id: "x", startSec: 3, endSec: 1, line: line("x", 0, 1) }] } });
    expect(lanes!.captionLane.items[0]).toMatchObject({ startSec: 3, endSec: 3.1 });
    expect(lanes!.overlayLanes[0]!.items).toEqual([]);
  });
});
