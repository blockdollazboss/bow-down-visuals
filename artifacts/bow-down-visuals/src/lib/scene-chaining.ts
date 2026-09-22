import type { SceneData } from "@/lib/scene-parser";

/**
 * Resolves the clip URL that scene `index` should chain from, based on the
 * *current visual order* of `scenes` — never the original AI-plan order.
 *
 * This must stay index-derived (scenes[index - 1]) rather than reading any
 * stored/stale "previous scene id" reference, so that drag-reorder,
 * duplicate, and delete operations on the scenes array automatically keep
 * chaining correct with zero extra bookkeeping.
 */
export function getPreviousClipUrl(scenes: SceneData[], index: number): string | null {
  if (index <= 0) return null;
  return scenes[index - 1]?.demoClipUrl ?? null;
}
