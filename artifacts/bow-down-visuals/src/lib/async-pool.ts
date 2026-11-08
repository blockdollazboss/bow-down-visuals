/**
 * async-pool.ts — bounded-parallel map for multi-file work (stack300 #70).
 *
 * The multi-file audio upload loops (ArrangementStudio tracks, StemList
 * stems) used to `await` each upload inside the loop, so N files took the
 * SUM of all upload times. mapWithConcurrency runs up to `limit` workers
 * at once while writing each result back to its input index, so the
 * caller's ordering (track order, stem order) is exactly the file order
 * the user picked — parallelism changes speed only, never the result.
 *
 * Error semantics match the old loops: the first rejection rejects the
 * whole map (the caller toasts and adds nothing); work already in flight
 * settles in the background, exactly like the uploads the old loop had
 * already finished before a later file failed.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
