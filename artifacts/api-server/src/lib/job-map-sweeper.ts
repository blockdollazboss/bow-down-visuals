/**
 * job-map-sweeper.ts — TTL eviction for in-memory job-state Maps.
 * (2026-10-12, OOM fix.)
 *
 * ~28 route modules keep job state in module-level Maps that were
 * only ever .set() — never deleted, never swept — so they grew for
 * the life of the process (oom-investigation.md, suspect #4: the one
 * true unbounded leak). attachJobMapTtl() tracks insertion time per
 * key and evicts entries older than the TTL on a 5-minute sweep,
 * mirroring the 2h TTL precedent in routes/lip-sync.ts and
 * routes/music-export.ts. Job records are small metadata (status,
 * URLs, credits) whose results live in storage/DB, so expiring stale
 * metadata after 2h is safe; status updates mutate the stored object,
 * and a job still being polled can be re-fetched from its result URL.
 */

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h — matches lip-sync precedent
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export function attachJobMapTtl<K, V>(
  map: Map<K, V>,
  ttlMs: number = DEFAULT_TTL_MS,
): Map<K, V> {
  const stamps = new Map<K, number>();
  const origSet = map.set.bind(map);
  const origDelete = map.delete.bind(map);
  const origClear = map.clear.bind(map);

  map.set = (key: K, value: V): Map<K, V> => {
    stamps.set(key, Date.now());
    return origSet(key, value);
  };
  map.delete = (key: K): boolean => {
    stamps.delete(key);
    return origDelete(key);
  };
  map.clear = (): void => {
    stamps.clear();
    origClear();
  };

  const timer = setInterval(() => {
    const cutoff = Date.now() - ttlMs;
    for (const [key, ts] of stamps) {
      if (ts < cutoff) {
        origDelete(key);
        stamps.delete(key);
      }
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return map;
}
