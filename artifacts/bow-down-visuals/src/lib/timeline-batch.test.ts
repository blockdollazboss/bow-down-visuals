/**
 * timeline-batch.test.ts — stack1100 X2 (stash@{2} hand-port).
 *
 * lib/timeline-batch holds the pure selection + batch-edit math behind
 * TimelineDock's clip multi-select: shift+click builds a batch (stored as
 * scene ids, so splits / reorders / single-clip ops can never make the
 * batch point at the wrong clip), and Delete / Ctrl+D act on the whole
 * batch through the same seam the toolbar buttons call. These tests pin
 * the math itself: click semantics (ported from the stash WIP, including
 * its plain-click toggle-off), batch resolution against the live scenes
 * array, and the delete / duplicate array transforms.
 */
import { describe, expect, it } from "vitest";
import {
  batchIndices,
  clickSelection,
  deleteBatch,
  duplicateBatch,
  toggleMultiId,
  type BatchSelection,
} from "./timeline-batch";
import type { ClipEdit } from "./editor-settings";

interface FakeScene { id: string; sceneNumber: number }
const scene = (id: string, sceneNumber: number): FakeScene => ({ id, sceneNumber });
const SCENES: FakeScene[] = [scene("a", 1), scene("b", 2), scene("c", 3), scene("d", 4)];
const edit = (trimStart: number): ClipEdit => ({ trimStart }) as ClipEdit;
const sel = (anchorIdx: number | null, multiIds: string[] = []): BatchSelection => ({
  anchorIdx,
  multiIds: new Set(multiIds),
});

describe("toggleMultiId", () => {
  it("adds an absent id and removes a present one, never mutating the input", () => {
    const start = new Set(["a"]);
    const added = toggleMultiId(start, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...toggleMultiId(added, "a")]).toEqual(["b"]);
    expect([...start]).toEqual(["a"]);
  });
});

describe("clickSelection — plain clicks keep the pre-batch behaviour", () => {
  it("clicking an unselected clip anchors it and clears any batch", () => {
    expect(clickSelection(sel(null), 2, "c", false)).toEqual(sel(2));
    expect(clickSelection(sel(0, ["c"]), 2, "c", false)).toEqual(sel(2));
  });
  it("clicking the anchor with an empty batch toggles it off", () => {
    expect(clickSelection(sel(1), 1, "b", false)).toEqual(sel(null));
  });
  it("clicking the anchor with a live batch keeps the anchor, clears the batch", () => {
    expect(clickSelection(sel(1, ["c"]), 1, "b", false)).toEqual(sel(1));
  });
});

describe("clickSelection — shift+click builds the batch", () => {
  it("adds then removes a clip, anchor untouched", () => {
    const on = clickSelection(sel(0), 2, "c", true);
    expect(on).toEqual(sel(0, ["c"]));
    expect(clickSelection(on, 2, "c", true)).toEqual(sel(0));
  });
  it("with no anchor, shift+click behaves as a plain click", () => {
    expect(clickSelection(sel(null), 2, "c", true)).toEqual(sel(2));
  });
  it("shift+clicking the anchor itself falls through to the plain behaviour", () => {
    expect(clickSelection(sel(1), 1, "b", true)).toEqual(sel(null));
    expect(clickSelection(sel(1, ["c"]), 1, "b", true)).toEqual(sel(1));
  });
});

describe("batchIndices", () => {
  it("anchor only, batch only, and the sorted union", () => {
    expect(batchIndices(SCENES, sel(2))).toEqual([2]);
    expect(batchIndices(SCENES, sel(null, ["d", "b"]))).toEqual([1, 3]);
    expect(batchIndices(SCENES, sel(3, ["b"]))).toEqual([1, 3]);
  });
  it("drops ids whose scene is gone and out-of-range anchors", () => {
    expect(batchIndices(SCENES, sel(null, ["zzz"]))).toEqual([]);
    expect(batchIndices(SCENES, sel(99, ["b"]))).toEqual([1]);
    expect(batchIndices(SCENES, sel(null))).toEqual([]);
  });
  it("an anchor that is also in the batch appears once", () => {
    expect(batchIndices(SCENES, sel(1, ["b", "c"]))).toEqual([1, 2]);
  });
});

describe("deleteBatch", () => {
  it("removes the scenes and exactly their clip edits", () => {
    const clips: Record<string, ClipEdit> = { a: edit(1), b: edit(2), c: edit(3) };
    const out = deleteBatch(SCENES, clips, [1, 3]);
    expect(out.scenes.map((s) => s.id)).toEqual(["a", "c"]);
    expect(Object.keys(out.clips).sort()).toEqual(["a", "c"]);
    expect(out.clips.a).toBe(clips.a);
  });
  it("tolerates unsorted / duplicated indices and never mutates the inputs", () => {
    const clips: Record<string, ClipEdit> = { b: edit(2) };
    const out = deleteBatch(SCENES, clips, [1, 1]);
    expect(out.scenes.map((s) => s.id)).toEqual(["a", "c", "d"]);
    expect(SCENES).toHaveLength(4);
    expect(Object.keys(clips)).toEqual(["b"]);
  });
});

describe("duplicateBatch", () => {
  it("inserts a copy directly after each original, whatever the index order", () => {
    let n = 0;
    const out = duplicateBatch(SCENES, {}, [2, 0], () => `new-${++n}`);
    expect(out.scenes.map((s) => s.id)).toEqual(["a", "new-2", "b", "c", "new-1", "d"]);
    expect(out.firstCopyIdx).toBe(1);
  });
  it("copies carry sceneNumber + 0.5 and a copy of the clip edit, keyed by the new id", () => {
    const clips: Record<string, ClipEdit> = { b: edit(7) };
    const out = duplicateBatch(SCENES, clips, [1], () => "copy-b");
    expect(out.scenes[2]).toEqual({ id: "copy-b", sceneNumber: 2.5 });
    expect(out.clips["copy-b"]).toEqual(edit(7));
    expect(out.clips["copy-b"]).not.toBe(clips.b);
    expect(out.firstCopyIdx).toBe(2);
  });
  it("a clip with no edit gains none; inputs are never mutated", () => {
    const clips: Record<string, ClipEdit> = {};
    const out = duplicateBatch(SCENES, clips, [0], () => "copy-a");
    expect(Object.keys(out.clips)).toEqual([]);
    expect(SCENES.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });
});
