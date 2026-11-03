/* ─── Audience auto-segment (org wave #2, rank 6b) ─────────────────────
   The Promote step attaches an audience segment automatically instead
   of leaving the creator to go build one in another silo. The segment
   rail already exists — GET /api/email-list/fan-segments returns the
   preset segments with LIVE fan counts evaluated over the One Fan
   Graph (the same presets FanSegmentsPanel offers in the Email List
   desk). The auto-pick is the preset that reaches the most fans right
   now; ties keep the server's own order. Pure, so the pick is pinned
   without rendering. */

export interface AutoSegmentCandidate {
  id: string;
  name: string;
  description?: string;
  count: number;
}

/**
 * The segment to attach to a promote run: the live preset with the
 * most fans in it. Returns null when every preset is empty (a creator
 * with no fans yet has no segment to attach — the UI says exactly
 * that instead of inventing one).
 */
export function pickAutoSegment<T extends AutoSegmentCandidate>(presets: readonly T[]): T | null {
  let best: T | null = null;
  for (const p of presets) {
    if (!p || typeof p.count !== "number" || !Number.isFinite(p.count) || p.count <= 0) continue;
    if (!best || p.count > best.count) best = p;
  }
  return best;
}

/** Pull the presets array out of the fan-segments response, tolerantly. */
export function presetsFromFanSegmentsResponse(data: unknown): AutoSegmentCandidate[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as { presets?: unknown }).presets;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is AutoSegmentCandidate =>
      !!p && typeof p === "object"
      && typeof (p as AutoSegmentCandidate).id === "string"
      && typeof (p as AutoSegmentCandidate).name === "string"
      && typeof (p as AutoSegmentCandidate).count === "number",
  );
}
