/* ─── Viral-spike detection (orphan wave: viral-spike response kit) ─────
   Pure velocity math over TIMESTAMPED samples of a real cumulative view
   counter (showcase_items.views / profile_videos.view_count).

   SIGNAL HONESTY — the rule this module exists to keep: the site stores
   only cumulative view totals today, never a per-content view history.
   A "velocity" derived from one cumulative number would be invented, so
   this detector refuses to guess: with too few samples, too short a
   recent span, or too short a measured baseline it returns
   `insufficient_data` with the reason, and a kit is never built on it.
   The two paths that can fire without a measured baseline say so in the
   verdict itself: `first_surge` (no baseline history yet, gain alone is
   large) and `baseline_silent` (baseline window measured, zero views in
   it, multiplier reported as null — never as Infinity). */

export interface ViewSample {
  /** Epoch milliseconds when the cumulative counter was read. */
  atMs: number;
  /** Cumulative views at that moment (monotonic unless the counter reset). */
  views: number;
}

export interface SpikeConfig {
  /** Trailing window treated as "now" for the velocity comparison. */
  recentWindowHours: number;
  /** Window before the recent one used for the baseline velocity. */
  baselineWindowHours: number;
  /** Minimum views gained inside the recent window before speed matters. */
  minRecentGain: number;
  /** Recent velocity must be at least this multiple of baseline velocity. */
  minMultiplier: number;
  /** Baseline must be measured over at least this span to be trusted. */
  minBaselineSpanHours: number;
  /** Minimum recent span — two samples minutes apart prove nothing. */
  minRecentSpanHours: number;
  /** With no trustworthy baseline, this absolute gain alone is a surge. */
  firstSurgeGain: number;
  /** After a kit fires for a piece of content, stay quiet this long. */
  cooldownHours: number;
}

export const DEFAULT_SPIKE_CONFIG: SpikeConfig = {
  recentWindowHours: 6,
  baselineWindowHours: 72,
  minRecentGain: 100,
  minMultiplier: 5,
  minBaselineSpanHours: 12,
  minRecentSpanHours: 1,
  firstSurgeGain: 500,
  cooldownHours: 24,
};

export type InsufficientReason =
  | "needs_at_least_two_samples"
  | "recent_span_too_short"
  | "baseline_too_short";

export type NoSpikeReason = "gain_below_minimum" | "velocity_below_multiplier";

export type SpikeBasis = "measured_multiplier" | "baseline_silent" | "first_surge";

export interface SpikeNumbers {
  recentGain: number;
  recentSpanHours: number;
  recentVelocityPerHour: number;
  baselineGain: number | null;
  baselineSpanHours: number | null;
  baselineVelocityPerHour: number | null;
  /** Null whenever there is no honest multiple to report. */
  multiplier: number | null;
  /** True when a counter reset was seen and earlier samples were dropped. */
  counterResetSeen: boolean;
}

export type SpikeVerdict =
  | { status: "spike"; basis: SpikeBasis; numbers: SpikeNumbers }
  | { status: "no_spike"; reason: NoSpikeReason; numbers: SpikeNumbers }
  | { status: "insufficient_data"; reason: InsufficientReason; numbers: SpikeNumbers | null };

const HOUR_MS = 3_600_000;

interface CleanedSamples {
  samples: ViewSample[];
  counterResetSeen: boolean;
}

/** Sort, dedupe, drop junk, and cut everything before a counter reset —
 *  a reset counter (re-upload, platform recount) makes older totals
 *  incomparable, so velocity is measured only on the post-reset segment. */
export function cleanSamples(input: readonly ViewSample[]): CleanedSamples {
  const valid = input
    .filter((s) => Number.isFinite(s.atMs) && Number.isFinite(s.views) && s.views >= 0)
    .map((s) => ({ atMs: s.atMs, views: s.views }))
    .sort((a, b) => a.atMs - b.atMs);
  const deduped: ViewSample[] = [];
  for (const s of valid) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.atMs === s.atMs) {
      prev.views = Math.max(prev.views, s.views);
    } else {
      deduped.push({ ...s });
    }
  }
  let counterResetSeen = false;
  let segmentStart = 0;
  for (let i = 1; i < deduped.length; i++) {
    if (deduped[i]!.views < deduped[i - 1]!.views) {
      counterResetSeen = true;
      segmentStart = i;
    }
  }
  return { samples: deduped.slice(segmentStart), counterResetSeen };
}

/** Value/anchor at or before a moment: the latest sample not after it. */
function anchorAtOrBefore(samples: ViewSample[], atMs: number): ViewSample | null {
  let best: ViewSample | null = null;
  for (const s of samples) {
    if (s.atMs <= atMs) best = s;
    else break;
  }
  return best;
}

function gainBetween(samples: ViewSample[], fromMs: number, toMs: number) {
  const end = anchorAtOrBefore(samples, toMs);
  if (!end) return null;
  const start = anchorAtOrBefore(samples, fromMs) ?? samples.find((s) => s.atMs <= toMs) ?? null;
  if (!start || start.atMs === end.atMs) return null;
  const spanHours = (end.atMs - start.atMs) / HOUR_MS;
  if (spanHours <= 0) return null;
  return { gain: end.views - start.views, spanHours, start, end };
}

export function detectSpike(
  input: readonly ViewSample[],
  config: SpikeConfig = DEFAULT_SPIKE_CONFIG,
  nowMs?: number,
): SpikeVerdict {
  const { samples, counterResetSeen } = cleanSamples(input);
  if (samples.length < 2) {
    return { status: "insufficient_data", reason: "needs_at_least_two_samples", numbers: null };
  }
  const now = nowMs ?? samples[samples.length - 1]!.atMs;
  const recentStartMs = now - config.recentWindowHours * HOUR_MS;

  const recent = gainBetween(samples, recentStartMs, now);
  if (!recent) {
    return { status: "insufficient_data", reason: "needs_at_least_two_samples", numbers: null };
  }
  const recentVelocity = recent.gain / recent.spanHours;

  const baseline = gainBetween(samples, recentStartMs - config.baselineWindowHours * HOUR_MS, recentStartMs);
  const baselineVelocity = baseline ? baseline.gain / baseline.spanHours : null;

  const numbers: SpikeNumbers = {
    recentGain: recent.gain,
    recentSpanHours: recent.spanHours,
    recentVelocityPerHour: recentVelocity,
    baselineGain: baseline?.gain ?? null,
    baselineSpanHours: baseline?.spanHours ?? null,
    baselineVelocityPerHour: baselineVelocity,
    multiplier:
      baselineVelocity !== null && baselineVelocity > 0 ? recentVelocity / baselineVelocity : null,
    counterResetSeen,
  };

  if (recent.spanHours < config.minRecentSpanHours) {
    return { status: "insufficient_data", reason: "recent_span_too_short", numbers };
  }
  if (recent.gain < config.minRecentGain) {
    return { status: "no_spike", reason: "gain_below_minimum", numbers };
  }

  const baselineTrustworthy =
    baseline !== null && baseline.spanHours >= config.minBaselineSpanHours;

  if (!baselineTrustworthy) {
    // No honest baseline exists yet. The only claim allowed is the plain
    // absolute one, and it must clear the higher first-surge bar.
    if (recent.gain >= config.firstSurgeGain) {
      return { status: "spike", basis: "first_surge", numbers };
    }
    return { status: "insufficient_data", reason: "baseline_too_short", numbers };
  }

  if (baselineVelocity === 0) {
    return { status: "spike", basis: "baseline_silent", numbers };
  }
  if (numbers.multiplier !== null && numbers.multiplier >= config.minMultiplier) {
    return { status: "spike", basis: "measured_multiplier", numbers };
  }
  return { status: "no_spike", reason: "velocity_below_multiplier", numbers };
}

/** True while a kit that already fired for this content is still fresh —
 *  EVERYTHING SMART: one spike, one kit, no repeated interruptions. */
export function isInCooldown(
  lastFiredAtMs: number | null | undefined,
  nowMs: number,
  config: SpikeConfig = DEFAULT_SPIKE_CONFIG,
): boolean {
  if (lastFiredAtMs === null || lastFiredAtMs === undefined || !Number.isFinite(lastFiredAtMs)) {
    return false;
  }
  return nowMs - lastFiredAtMs < config.cooldownHours * HOUR_MS;
}
