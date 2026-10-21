/**
 * sweep-map.ts — TTL eviction for the small process-local timestamp maps
 * (Lane F audit, Flag S-4). Several route modules keep a
 * Map<string, number> of "last seen at" timestamps for pacing/throttle
 * decisions; the entries are only ever read back within a short window,
 * after which an entry is indistinguishable from an absent one — but
 * nothing ever deleted them, so the maps grew for the life of the
 * process (and some keys are client-mintable).
 *
 * The pattern: callers sweep opportunistically when the map passes a
 * size threshold, so the sweep cost is amortized and bounded. Entries
 * older than the TTL are deleted; the return value is how many died.
 */
export function sweepStaleEntries(map: Map<string, number>, olderThanMs: number, now: number = Date.now()): number {
  let removed = 0;
  for (const [key, at] of map) {
    if (now - at > olderThanMs) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Sweep only once the map is past `threshold` entries (amortized). */
export function sweepIfLarge(map: Map<string, number>, threshold: number, olderThanMs: number, now: number = Date.now()): number {
  if (map.size <= threshold) return 0;
  return sweepStaleEntries(map, olderThanMs, now);
}
