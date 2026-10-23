/**
 * perf-ladder.ts — inference performance governor. Pure logic (no
 * DOM, no timers): the caller feeds it one inference duration per
 * completed frame and acts on the returned decision.
 *
 * Its studio job (background-changer.ts, 'auto' quality): walk the
 * matte-refinement steps — sustained slowness sheds edge work,
 * sustained speed restores it — so the edge cleanup stays bounded
 * by what the device can actually hold.
 *
 * Behaviour:
 *  - A warmup window is ignored (JIT / shader compile spikes are
 *    not a verdict on the machine).
 *  - Sustained slowness (EMA of inference time above `slowMs`,
 *    judged on an evaluation boundary) steps the caller DOWN its
 *    internal quality steps. At the last step, the decision is
 *    'degrade' — the caller decides what that means; the studio
 *    steps its output canvas down a size (1080p → 720p) once.
 *  - Sustained speed (EMA below `fastMs` for many consecutive
 *    evaluations) steps back UP, with wide hysteresis so the
 *    caller never oscillates around a boundary.
 */

export type PerfAction = "none" | "step-down" | "step-up" | "degrade";

export interface PerfLadderOptions {
  /** Highest internal step index (0-based count - 1). */
  maxStep: number;
  /** EMA above this (ms) counts as slow. Default 46 (~<20fps of
   *  pure inference inside a 30fps frame budget). */
  slowMs?: number;
  /** EMA below this (ms) counts as fast. Default 12. */
  fastMs?: number;
  /** Frames ignored at start / after every step change. Default 12. */
  warmupFrames?: number;
  /** Frames between evaluations. Default 24. */
  evalEvery?: number;
  /** Consecutive fast evaluations required to step up. Default 10. */
  upEvals?: number;
}

export class PerfLadder {
  /** Current internal quality step (0 = best). */
  step = 0;
  private readonly _maxStep: number;
  private readonly _slowMs: number;
  private readonly _fastMs: number;
  private readonly _warmup: number;
  private readonly _evalEvery: number;
  private readonly _upEvals: number;
  private _ema: number | null = null;
  private _frames = 0;
  private _goodEvals = 0;

  constructor(options: PerfLadderOptions) {
    this._maxStep = Math.max(0, options.maxStep);
    this._slowMs = options.slowMs ?? 46;
    this._fastMs = options.fastMs ?? 12;
    this._warmup = options.warmupFrames ?? 12;
    this._evalEvery = options.evalEvery ?? 24;
    this._upEvals = options.upEvals ?? 10;
  }

  reset(): void {
    this.step = 0;
    this._ema = null;
    this._frames = 0;
    this._goodEvals = 0;
  }

  /** The running EMA of inference ms (null until the first sample). */
  get emaMs(): number | null {
    return this._ema;
  }

  /** Feed one completed frame's inference duration. */
  sample(ms: number): PerfAction {
    this._ema = this._ema === null ? ms : this._ema + 0.12 * (ms - this._ema);
    this._frames++;
    if (this._frames <= this._warmup) return "none";
    if ((this._frames - this._warmup) % this._evalEvery !== 0) return "none";

    if (this._ema > this._slowMs) {
      this._goodEvals = 0;
      this._frames = 0;
      this._ema = null;
      if (this.step < this._maxStep) {
        this.step++;
        return "step-down";
      }
      return "degrade";
    }
    if (this._ema < this._fastMs) {
      this._goodEvals++;
      if (this._goodEvals >= this._upEvals && this.step > 0) {
        this.step--;
        this._goodEvals = 0;
        this._frames = 0;
        this._ema = null;
        return "step-up";
      }
    } else {
      this._goodEvals = 0;
    }
    return "none";
  }
}
