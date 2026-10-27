/**
 * viral-spike.test.ts — spike-detection math for the viral-spike
 * response kit. The honesty contract is the point: insufficient or
 * untrustworthy sample history must NEVER produce a spike verdict or
 * an invented multiplier.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPIKE_CONFIG,
  cleanSamples,
  detectSpike,
  isInCooldown,
  type ViewSample,
} from "../viral-spike";

const H = 3_600_000;
const T0 = 1_700_000_000_000;

/** Flat baseline of `basePerHour` views/h for `hours`, ending at T0+hours*H. */
function steady(basePerHour: number, hours: number, startViews = 0): ViewSample[] {
  const out: ViewSample[] = [];
  for (let h = 0; h <= hours; h += 6) {
    out.push({ atMs: T0 + h * H, views: startViews + basePerHour * h });
  }
  return out;
}

describe("detectSpike — measured multiplier", () => {
  it("fires when recent velocity is ≥5× a trustworthy baseline and gain ≥100", () => {
    // Baseline: 10 views/h for 72h (720 views). Recent 6h: +900 views (150/h = 15×).
    const samples = steady(10, 72);
    const last = samples[samples.length - 1]!;
    samples.push({ atMs: last.atMs + 6 * H, views: last.views + 900 });
    const v = detectSpike(samples);
    expect(v.status).toBe("spike");
    if (v.status !== "spike") return;
    expect(v.basis).toBe("measured_multiplier");
    expect(v.numbers.recentGain).toBe(900);
    expect(v.numbers.multiplier).not.toBeNull();
    expect(v.numbers.multiplier!).toBeGreaterThanOrEqual(5);
  });

  it("does not fire on steady growth, however large the total", () => {
    // 200 views/h the whole way: huge totals, zero acceleration.
    const samples = steady(200, 78);
    const v = detectSpike(samples);
    expect(v.status).toBe("no_spike");
    if (v.status !== "no_spike") return;
    expect(v.reason).toBe("velocity_below_multiplier");
    expect(v.numbers.multiplier).toBeCloseTo(1, 1);
  });

  it("does not fire when the recent gain is below the absolute minimum", () => {
    const samples = steady(1, 72);
    const last = samples[samples.length - 1]!;
    samples.push({ atMs: last.atMs + 6 * H, views: last.views + 50 }); // fast % but tiny
    const v = detectSpike(samples);
    expect(v.status).toBe("no_spike");
    if (v.status !== "no_spike") return;
    expect(v.reason).toBe("gain_below_minimum");
  });
});

describe("detectSpike — honesty gates (no fake metrics)", () => {
  it("a single sample can never be a spike", () => {
    const v = detectSpike([{ atMs: T0, views: 1_000_000 }]);
    expect(v.status).toBe("insufficient_data");
    if (v.status !== "insufficient_data") return;
    expect(v.reason).toBe("needs_at_least_two_samples");
    expect(v.numbers).toBeNull();
  });

  it("zero samples: insufficient, not a zero-velocity claim", () => {
    const v = detectSpike([]);
    expect(v.status).toBe("insufficient_data");
  });

  it("two samples minutes apart: recent span too short to claim velocity", () => {
    const v = detectSpike([
      { atMs: T0, views: 0 },
      { atMs: T0 + 5 * 60_000, views: 5_000 },
    ]);
    expect(v.status).toBe("insufficient_data");
    if (v.status !== "insufficient_data") return;
    expect(v.reason).toBe("recent_span_too_short");
  });

  it("short baseline + moderate gain: insufficient_data, never a guessed multiplier spike", () => {
    // Only 3h of history before the recent window, gain clears the floor
    // but not the first-surge bar → the honest answer is "not enough data".
    const samples: ViewSample[] = [
      { atMs: T0, views: 0 },
      { atMs: T0 + 3 * H, views: 30 },
      { atMs: T0 + 9 * H, views: 230 }, // +200 in the recent 6h
    ];
    const v = detectSpike(samples);
    expect(v.status).toBe("insufficient_data");
    if (v.status !== "insufficient_data") return;
    expect(v.reason).toBe("baseline_too_short");
  });

  it("first surge: no baseline history but a large absolute gain fires — labelled first_surge, multiplier null", () => {
    const samples: ViewSample[] = [
      { atMs: T0, views: 10 },
      { atMs: T0 + 6 * H, views: 900 },
    ];
    const v = detectSpike(samples);
    expect(v.status).toBe("spike");
    if (v.status !== "spike") return;
    expect(v.basis).toBe("first_surge");
    expect(v.numbers.multiplier).toBeNull();
    expect(v.numbers.baselineVelocityPerHour).toBeNull();
  });

  it("silent baseline: measured baseline of zero fires as baseline_silent with multiplier null (never Infinity)", () => {
    const samples = steady(0, 72, 400); // 400 views, flat for 72h
    const last = samples[samples.length - 1]!;
    samples.push({ atMs: last.atMs + 6 * H, views: 400 + 300 });
    const v = detectSpike(samples);
    expect(v.status).toBe("spike");
    if (v.status !== "spike") return;
    expect(v.basis).toBe("baseline_silent");
    expect(v.numbers.baselineVelocityPerHour).toBe(0);
    expect(v.numbers.multiplier).toBeNull();
  });

  it("counter reset: pre-reset totals are dropped instead of producing a negative/fake velocity", () => {
    const samples: ViewSample[] = [
      { atMs: T0, views: 50_000 },
      { atMs: T0 + 24 * H, views: 51_000 },
      { atMs: T0 + 48 * H, views: 100 }, // counter reset (recount/re-upload)
      { atMs: T0 + 54 * H, views: 130 },
    ];
    const cleaned = cleanSamples(samples);
    expect(cleaned.counterResetSeen).toBe(true);
    expect(cleaned.samples).toHaveLength(2);
    const v = detectSpike(samples);
    // Post-reset gain is only 30 → below the minimum, honestly no spike.
    expect(v.status).toBe("no_spike");
    if (v.status === "insufficient_data") return;
    expect(v.numbers.counterResetSeen).toBe(true);
    expect(v.numbers.recentGain).toBe(30);
  });

  it("junk samples (NaN, negative) are ignored, not averaged in", () => {
    const samples = steady(10, 72);
    const last = samples[samples.length - 1]!;
    samples.push({ atMs: last.atMs + H, views: Number.NaN });
    samples.push({ atMs: last.atMs + 2 * H, views: -5 });
    samples.push({ atMs: last.atMs + 6 * H, views: last.views + 900 });
    const v = detectSpike(samples);
    expect(v.status).toBe("spike");
  });

  it("unsorted and duplicate-timestamp samples are handled", () => {
    const samples = steady(10, 72);
    const last = samples[samples.length - 1]!;
    const shuffled = [...samples].reverse();
    shuffled.push({ atMs: last.atMs + 6 * H, views: last.views + 900 });
    shuffled.push({ atMs: last.atMs, views: last.views }); // duplicate ts
    const v = detectSpike(shuffled);
    expect(v.status).toBe("spike");
  });
});

describe("isInCooldown", () => {
  it("blocks re-firing inside the cooldown window and frees after it", () => {
    const fired = T0;
    expect(isInCooldown(fired, fired + 1 * H)).toBe(true);
    expect(isInCooldown(fired, fired + (DEFAULT_SPIKE_CONFIG.cooldownHours - 1) * H)).toBe(true);
    expect(isInCooldown(fired, fired + (DEFAULT_SPIKE_CONFIG.cooldownHours + 1) * H)).toBe(false);
  });

  it("no prior firing (null/undefined/NaN) is never in cooldown", () => {
    expect(isInCooldown(null, T0)).toBe(false);
    expect(isInCooldown(undefined, T0)).toBe(false);
    expect(isInCooldown(Number.NaN, T0)).toBe(false);
  });
});
