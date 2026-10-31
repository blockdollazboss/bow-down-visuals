/* ── Timeline clip multi-select + batch edits (stack1100 X2) ─────────────
 * The pure selection / batch math behind TimelineDock's clip batch ops,
 * hand-ported from the stash@{2} WIP into the dock-drag seam idiom: the
 * component owns state and side effects; every decision lives here where
 * it is unit-tested.
 *
 * The batch is stored as scene IDS, not indices (the one deliberate
 * divergence from the WIP): splits, reorders, and single-clip ops shift
 * indices, and an index-based batch would silently retarget the wrong
 * clips. Ids resolve against the live scenes array at op time, so a
 * stale id — a scene deleted since it was shift-clicked — just drops
 * out of the batch instead of hitting a neighbour.
 *
 * Click semantics are the WIP's, verbatim:
 *  • plain click anchors a clip; clicking the anchor with an empty
 *    batch toggles it off; clicking the anchor with a live batch keeps
 *    the anchor and clears the batch.
 *  • shift+click (with an anchor, on a different clip) toggles that
 *    clip in/out of the batch; every other shift+click falls through
 *    to the plain behaviour. */

import type { ClipEdit } from "@/lib/editor-settings";

export interface BatchSelection {
  anchorIdx: number | null;
  multiIds: ReadonlySet<string>;
}

/** Toggle one scene id in a batch set. Never mutates the input. */
export function toggleMultiId(multiIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(multiIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Resolve a click on clip `idx` (scene `sceneId`) into the next selection. */
export function clickSelection(
  sel: BatchSelection,
  idx: number,
  sceneId: string,
  shiftKey: boolean,
): BatchSelection {
  if (shiftKey && sel.anchorIdx !== null && sel.anchorIdx !== idx) {
    return { anchorIdx: sel.anchorIdx, multiIds: toggleMultiId(sel.multiIds, sceneId) };
  }
  if (sel.anchorIdx === idx && sel.multiIds.size === 0) {
    return { anchorIdx: null, multiIds: new Set() };
  }
  return { anchorIdx: idx, multiIds: new Set() };
}

/** The batch as sorted scene indices: the anchor plus every multi id
 *  that still resolves to a scene. Out-of-range anchors and vanished
 *  ids drop out; the anchor never appears twice. */
export function batchIndices<T extends { id: string }>(
  scenes: readonly T[],
  sel: BatchSelection,
): number[] {
  const out = new Set<number>();
  if (sel.anchorIdx !== null && sel.anchorIdx >= 0 && sel.anchorIdx < scenes.length) {
    out.add(sel.anchorIdx);
  }
  scenes.forEach((s, i) => {
    if (sel.multiIds.has(s.id)) out.add(i);
  });
  return [...out].sort((a, b) => a - b);
}

/** Remove the scenes at `idxs` and exactly their clip edits. */
export function deleteBatch<T extends { id: string }>(
  scenes: readonly T[],
  clips: Record<string, ClipEdit>,
  idxs: readonly number[],
): { scenes: T[]; clips: Record<string, ClipEdit> } {
  const drop = new Set(idxs);
  const removedIds = new Set<string>();
  const nextScenes = scenes.filter((s, i) => {
    if (drop.has(i)) {
      removedIds.add(s.id);
      return false;
    }
    return true;
  });
  const nextClips: Record<string, ClipEdit> = {};
  for (const [id, ce] of Object.entries(clips)) {
    if (!removedIds.has(id)) nextClips[id] = ce;
  }
  return { scenes: nextScenes, clips: nextClips };
}

/** Insert a copy directly after each scene at `idxs` (processed from the
 *  end so earlier indices stay valid, whatever order `idxs` arrives in).
 *  A copy mirrors the dock's single-clip duplicate: sceneNumber + 0.5 and
 *  the clip edit copied verbatim under the new id — a scene with no edit
 *  gains none. `firstCopyIdx` is where the first copy lands (the caller
 *  selects it). */
export function duplicateBatch<T extends { id: string; sceneNumber: number }>(
  scenes: readonly T[],
  clips: Record<string, ClipEdit>,
  idxs: readonly number[],
  makeId: () => string,
): { scenes: T[]; clips: Record<string, ClipEdit>; firstCopyIdx: number } {
  const sorted = [...new Set(idxs)]
    .filter((i) => i >= 0 && i < scenes.length)
    .sort((a, b) => a - b);
  const nextScenes = [...scenes];
  const nextClips: Record<string, ClipEdit> = { ...clips };
  for (let k = sorted.length - 1; k >= 0; k--) {
    const i = sorted[k]!;
    const orig = scenes[i]!;
    const newId = makeId();
    nextScenes.splice(i + 1, 0, { ...orig, id: newId, sceneNumber: orig.sceneNumber + 0.5 });
    const ce = clips[orig.id];
    if (ce) nextClips[newId] = { ...ce };
  }
  return { scenes: nextScenes, clips: nextClips, firstCopyIdx: sorted.length ? sorted[0]! + 1 : -1 };
}
