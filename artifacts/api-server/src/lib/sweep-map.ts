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

/**
 * TTL eviction for value maps that carry their own timestamp
 * (OOM fix, 2026-10-25). The diagnosis found the same shape in a
 * dozen modules: entries `.set()` on a hot path, the TTL consulted
 * only on read, nothing ever deleting — one retained entry per user
 * / track / key for the life of the process, summing to the steady
 * heap climb behind the day's nine OOM kills. `atOf` extracts the
 * entry's timestamp: `{ at, ... }` caches, `{ last, ... }` token
 * buckets, hit-window arrays (age = newest hit, the last element —
 * callers keep the arrays window-pruned and ascending).
 */
export function sweepTtlEntries<K, V>(map: Map<K, V>, olderThanMs: number, atOf: (value: V) => number, now: number = Date.now()): number {
  let removed = 0;
  for (const [key, value] of map) {
    if (now - atOf(value) > olderThanMs) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Sweep only once the map is past `threshold` entries (amortized). */
export function sweepTtlIfLarge<K, V>(map: Map<K, V>, threshold: number, olderThanMs: number, atOf: (value: V) => number, now: number = Date.now()): number {
  if (map.size <= threshold) return 0;
  return sweepTtlEntries(map, olderThanMs, atOf, now);
}

/**
 * Hard bound, as a backstop behind TTL sweeps: evict the
 * least-recently-touched entries until the map is at `cap`. With
 * `atOf`, recency is the value's timestamp; without it, Map
 * insertion order (oldest first). Runs the sort only when the map
 * is already oversized, so the hot path stays free.
 */
export function capMapSize<K, V>(map: Map<K, V>, cap: number, atOf?: (value: V) => number): number {
  if (map.size <= cap) return 0;
  let removed = 0;
  if (atOf) {
    const byAge = [...map.entries()].sort((a, b) => atOf(a[1]) - atOf(b[1]));
    for (const [key] of byAge) {
      if (map.size <= cap) break;
      map.delete(key);
      removed++;
    }
  } else {
    for (const key of map.keys()) {
      if (map.size <= cap) break;
      map.delete(key);
      removed++;
    }
  }
  return removed;
}
