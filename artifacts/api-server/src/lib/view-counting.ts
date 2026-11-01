/**
 * View-count dedup (stack1100 lane X5, counter consistency round 2).
 *
 * A family of read doors stamps a counter as a side effect of a GET:
 * beats plays, album views, bio-page views, showcase views, and
 * content-plan views. Those counters are PURE counters — no row
 * source exists to reconcile them against, by design — so their
 * truth is their minting bound. Until now the only bound was the
 * global per-IP limiter (300 requests/min), which lets one address
 * mint hundreds of "views" of the SAME item by refreshing, and the
 * numbers feed discovery surfaces (an album's view count is a
 * social-proof figure; a beat's plays sit on its public card).
 *
 * The house standard for counted engagements is one count per
 * source per item per window — the play doors' stated 1-per-60s.
 * Views get the same treatment here: the first view from an IP
 * inside the window counts; repeats within the window are served
 * the standing count without minting.
 *
 * In-process and best-effort BY DESIGN: a restart or a second
 * instance only ever loosens the bound back toward the global
 * limiter, never below one count per window per instance — the same
 * trust shape as the rate limiters these doors already live behind.
 * The map is size-bounded with a lazy sweep so it cannot grow
 * without limit.
 */
const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;
const seen = new Map<string, number>();

export function viewKey(surface: string, id: string, ip: string | undefined): string {
  return `${surface}:${id}:${ip ?? "unknown"}`;
}

/** True exactly once per key per window — the caller mints the view
 *  only when this says yes, and echoes "+1" in its response only
 *  then, so the number a reader sees always matches what landed. */
export function shouldCountView(key: string, now: number = Date.now()): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  seen.set(key, now);
  if (seen.size > MAX_KEYS) {
    for (const [k, t] of seen) {
      if (now - t >= WINDOW_MS) seen.delete(k);
    }
  }
  return true;
}

/** Test seam: forget all recorded views. */
export function resetViewCounting(): void {
  seen.clear();
}
