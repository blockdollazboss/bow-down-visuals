/**
 * frame-stall.ts — stall detection for the background-effects render
 * loop. Pure logic (no DOM, no timers): the caller feeds it the loop
 * clock whenever a frame lands matte-composited (noteMatte) and
 * whenever a loop pass produces no composite (noteMiss), and acts on
 * the returned edge signals.
 *
 * Why this exists: the render loop's failure modes are all silent —
 * an engine whose inference hangs, an engine that resolves null
 * mattes forever, per-frame inference errors the loop swallows so
 * the next frame can retry, a video element that never becomes
 * ready. Every one of them reads the same way from the canvas: no
 * matte-composited frame for a while. Without a verdict, the canvas
 * stays blank while the studio copy claims the feed is live.
 *
 * Behaviour:
 *  - Misses are measured against the last landed matte — or, before
 *    the first one, against the (re)start anchor — so all of the
 *    failure modes above count toward the same clock, including the
 *    time an inference sits in flight (a hung inference notes its
 *    misses from the loop passes it blocks).
 *  - noteMiss returns true exactly ONCE, on the pass that crosses
 *    the threshold: the caller reports the episode (once) and falls
 *    back to painting the raw camera until a matte lands again.
 *  - noteMatte returns true exactly ONCE when a matte lands while
 *    stalled: the caller leaves the fallback and restores the live
 *    engine status — the effects look is only claimed again once
 *    frames actually flow composited.
 *  - reset() is the new-session / new-engine boundary: the grace
 *    clock restarts and any active episode is forgotten (the engine
 *    swap reports its own status, so no stale episode may fire or
 *    clear against the new engine).
 */

/** No-composite window after which the engine reads as stalled. */
export const FRAME_STALL_THRESHOLD_MS = 2000;

export class FrameStallTracker {
  private readonly _thresholdMs: number;
  private _anchor: number;
  private _stalled = false;

  constructor(anchor: number, thresholdMs: number = FRAME_STALL_THRESHOLD_MS) {
    this._anchor = anchor;
    this._thresholdMs = thresholdMs;
  }

  /** New session / new engine: restart the grace clock, forget any
   *  active stall episode. */
  reset(anchor: number): void {
    this._anchor = anchor;
    this._stalled = false;
  }

  /** Is a stall episode currently active (raw fallback showing)? */
  get stalled(): boolean {
    return this._stalled;
  }

  /** A matte-composited frame landed at `now`. True iff this ends a
   *  stall episode. */
  noteMatte(now: number): boolean {
    this._anchor = now;
    if (!this._stalled) return false;
    this._stalled = false;
    return true;
  }

  /** A loop pass at `now` produced no matte composite. True iff this
   *  pass crosses the stall threshold (once per episode). */
  noteMiss(now: number): boolean {
    if (this._stalled) return false;
    if (now - this._anchor < this._thresholdMs) return false;
    this._stalled = true;
    return true;
  }
}
