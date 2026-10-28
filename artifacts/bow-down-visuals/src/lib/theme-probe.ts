/**
 * theme-probe.ts — availability state machine for the site theme song.
 *
 * Why this exists (theme-player-diagnosis §2): ThemePlayerContext used to
 * decide availability with a SINGLE HEAD probe at page load, never
 * retried. Any transient failure (one flaky moment on the transport)
 * marked the theme "missing" for the whole session, the widget showed
 * "— coming soon", and the row hid its controls entirely — a dead end
 * with nothing to press. The track itself was healthy all along.
 *
 * This controller owns availability so it can be unit-tested without a
 * DOM: the context injects the real HEAD fetch, tests inject scripted
 * outcomes. Behaviour:
 *   - a failed probe is never terminal: reprobe() retries on demand;
 *   - while the widget is open ("watching"), failures retry on a
 *     backoff (2s → 5s → 10s → 20s → 30s cap) until one succeeds;
 *   - success at any point flips to "ready" and fires onReady once;
 *   - a media-element error is reported in via reportElementError()
 *     and can likewise be healed by a later successful probe;
 *   - once "ready", availability is proven — probes stop (a later
 *     element error is the only way back out, via reportElementError).
 */

export type ThemeAvailability = "probing" | "ready" | "missing" | "error";

export interface ThemeProbeSnapshot {
  status: ThemeAvailability;
  /** A HEAD probe is in flight right now. */
  checking: boolean;
}

export interface ThemeProbeOptions {
  /** Resolves true when the track is reachable. Rejections count as unreachable. */
  head: () => Promise<boolean>;
  onChange: (snap: ThemeProbeSnapshot) => void;
  /** Fired on each flip into "ready" from a non-ready state. */
  onReady?: () => void;
  /** Retry delays while watched; the last value repeats as the cap. */
  backoffMs?: readonly number[];
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export const THEME_PROBE_BACKOFF_MS: readonly number[] = [
  2_000, 5_000, 10_000, 20_000, 30_000,
];

export class ThemeProbe {
  private status: ThemeAvailability = "probing";
  private checking = false;
  private watching = false;
  private backoffStep = 0;
  private timer: unknown = null;
  private disposed = false;

  constructor(private readonly opts: ThemeProbeOptions) {}

  get snapshot(): ThemeProbeSnapshot {
    return { status: this.status, checking: this.checking };
  }

  /** The one boot probe. */
  start(): void {
    this.runProbe();
  }

  /**
   * Retry now (tap-to-retry, widget open). Resets the backoff so an
   * impatient user isn't stuck waiting out a long delay. No-op once
   * the track is proven ready.
   */
  reprobe(): void {
    if (this.disposed || this.status === "ready") return;
    this.backoffStep = 0;
    this.runProbe();
  }

  /**
   * The widget opened/closed. Opening while unavailable probes again
   * immediately, and settle() keeps re-arming the backoff for as long
   * as the widget stays open. Closing stops the loop.
   */
  setWatching(watching: boolean): void {
    if (this.disposed || watching === this.watching) return;
    this.watching = watching;
    if (!watching) {
      this.clearTimer();
      return;
    }
    if (this.status === "missing" || this.status === "error") {
      this.backoffStep = 0;
      this.runProbe();
    }
  }

  /** The <audio> element itself errored (decode/network on the media). */
  reportElementError(): void {
    if (this.disposed || this.status === "error") return;
    this.status = "error";
    this.emit();
    this.armBackoff();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private emit(): void {
    this.opts.onChange(this.snapshot);
  }

  private runProbe(): void {
    if (this.disposed || this.checking) return; // coalesce concurrent probes
    if (this.status === "ready") return;        // availability already proven
    this.clearTimer();
    this.checking = true;
    this.emit();
    let result: Promise<boolean>;
    try {
      result = this.opts.head();
    } catch {
      result = Promise.resolve(false);
    }
    result.then(
      (ok) => this.settle(ok),
      () => this.settle(false),
    );
  }

  private settle(ok: boolean): void {
    if (this.disposed) return;
    this.checking = false;
    if (ok) {
      this.status = "ready";
      this.backoffStep = 0;
      this.clearTimer();
      this.emit();
      this.opts.onReady?.();
      return;
    }
    /* A failed probe means "not reachable right now" — the honest
       bucket is missing, whether we arrived from probing or from an
       element error. It stays recoverable via reprobe/backoff. */
    this.status = "missing";
    this.emit();
    this.armBackoff();
  }

  private armBackoff(): void {
    if (this.disposed || !this.watching || this.checking) return;
    if (this.status !== "missing" && this.status !== "error") return;
    if (this.timer !== null) return;
    const schedule = this.opts.backoffMs ?? THEME_PROBE_BACKOFF_MS;
    const delay = schedule[Math.min(this.backoffStep, schedule.length - 1)];
    this.backoffStep += 1;
    const setT =
      this.opts.setTimeoutFn ??
      ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timer = setT(() => {
      this.timer = null;
      this.runProbe();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    const clearT =
      this.opts.clearTimeoutFn ??
      ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
    clearT(this.timer);
    this.timer = null;
  }
}

/**
 * One play() attempt that never throws: true = playback actually
 * started. Callers use the boolean to surface failures honestly
 * instead of the old `.catch(() => {})` swallow.
 */
export async function attemptPlay(audio: {
  play: () => Promise<void>;
}): Promise<boolean> {
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}
