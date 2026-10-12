/* ─── Beat → Visual Vibes handoff ──────────────────────────────────────────
   The beat maker renders a WAV blob and stashes it here (module-level, so it
   survives SPA navigation), then routes to /video-editor?beathandoff=<id>.
   The editor picks it up one-shot and adds it as a timeline audio stem. */

export interface BeatHandoff {
  id: string;
  blob: Blob;
  url: string;
  title: string;
  bpm: number;
  durationSec: number;
  createdAt: number;
}

const cache = new Map<string, BeatHandoff>();

export function stashBeatHandoff(entry: Omit<BeatHandoff, "id" | "createdAt">): string {
  const id = `beat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // Prune entries older than 30 minutes so the map can't grow unbounded.
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of cache) {
    if (v.createdAt < cutoff) {
      URL.revokeObjectURL(v.url);
      cache.delete(k);
    }
  }
  cache.set(id, { ...entry, id, createdAt: Date.now() });
  return id;
}

/** One-shot pickup — removes the entry from the cache. */
export function takeBeatHandoff(id: string): BeatHandoff | null {
  const entry = cache.get(id) ?? null;
  if (entry) cache.delete(id);
  return entry;
}
