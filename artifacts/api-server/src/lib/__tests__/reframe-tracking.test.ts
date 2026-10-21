/**
 * Subject-tracking crop planning (auto-reframe v2) — pure-function pins:
 *  - the centre fallback is byte-identical to the v1 route formula;
 *  - a planned path FOLLOWS a moving synthetic subject;
 *  - the smoothing bound holds: no path segment ever pans faster than
 *    MAX_TRACK_SPEED_RATIO_PER_SEC × frame width, even across a
 *    teleport jump or adversarial jitter;
 *  - untrustworthy samples are rejected with honest reasons;
 *  - a one-frame matte glitch is cleaned, not followed.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_TRACK_SPEED_RATIO_PER_SEC,
  assessSamples,
  buildTrackedCropFilter,
  centreCropFilter,
  cropWindowFor,
  followSubjectPath,
  planTrackedCrop,
  sampleCropPath,
  type CropKeyframe,
  type DetectionSample,
} from "../reframe-tracking";

const SRC_W = 1280;
const SRC_H = 720;
const RATIO_916 = 9 / 16;

function sample(t: number, cx: number | null, cy = 0.5): DetectionSample {
  if (cx === null) return { t, box: null, coverage: 0 };
  return {
    t,
    box: { x: cx - 0.07, y: cy - 0.25, w: 0.14, h: 0.5 },
    coverage: 0.05,
  };
}

/** Subject walks left → right across the frame over 8 s. */
function walkingSamples(): DetectionSample[] {
  const out: DetectionSample[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i * 0.5;
    out.push(sample(t, 0.22 + (0.78 - 0.22) * (t / 8)));
  }
  return out;
}

function plan(samples: DetectionSample[], durationSec = 8) {
  return planTrackedCrop({
    samples,
    srcW: SRC_W,
    srcH: SRC_H,
    targetRatio: RATIO_916,
    outW: 1080,
    outH: 1920,
    durationSec,
  });
}

function maxSegmentSpeed(keys: CropKeyframe[]): number {
  let max = 0;
  for (let i = 1; i < keys.length; i++) {
    const dt = keys[i]!.t - keys[i - 1]!.t;
    if (dt <= 0) continue;
    const d = Math.hypot(keys[i]!.cx - keys[i - 1]!.cx, keys[i]!.cy - keys[i - 1]!.cy);
    max = Math.max(max, d / dt);
  }
  return max;
}

const SPEED_BOUND = MAX_TRACK_SPEED_RATIO_PER_SEC * SRC_W;

describe("centreCropFilter — v1 byte identity", () => {
  it("matches the pre-v2 route formula exactly for 9:16", () => {
    expect(centreCropFilter(RATIO_916, 1080, 1920)).toBe(
      "crop='if(gt(iw/ih,0.562500),ih*0.562500,iw)':'if(gt(iw/ih,0.562500),ih,iw/0.562500)'," +
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    );
  });
  it("matches for 16:9", () => {
    expect(centreCropFilter(16 / 9, 1920, 1080)).toBe(
      "crop='if(gt(iw/ih,1.777778),ih*1.777778,iw)':'if(gt(iw/ih,1.777778),ih,iw/1.777778)'," +
        "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
    );
  });
});

describe("cropWindowFor", () => {
  it("crops width for landscape → vertical", () => {
    expect(cropWindowFor(SRC_W, SRC_H, RATIO_916)).toEqual({ w: 404, h: 720 });
  });
  it("crops height for portrait → landscape", () => {
    expect(cropWindowFor(720, 1280, 16 / 9)).toEqual({ w: 720, h: 404 });
  });
  it("square → square keeps the full frame", () => {
    expect(cropWindowFor(1000, 1000, 1)).toEqual({ w: 1000, h: 1000 });
  });
});

describe("assessSamples — honest rejections", () => {
  it("no samples at all", () => {
    expect(assessSamples([])).toEqual({ ok: false, reason: "no-samples" });
  });
  it("frames sampled but no person anywhere", () => {
    const s = [sample(0.25, null), sample(0.75, null), sample(1.25, null)];
    expect(assessSamples(s)).toEqual({ ok: false, reason: "no-subject" });
  });
  it("person in too few frames", () => {
    const s = [
      sample(0.25, 0.5),
      sample(0.75, 0.5),
      ...Array.from({ length: 8 }, (_, i) => sample(1.25 + i * 0.5, null)),
    ];
    expect(assessSamples(s)).toEqual({ ok: false, reason: "low-coverage" });
  });
  it("matte specks are not a subject", () => {
    const s = Array.from({ length: 6 }, (_, i) => ({
      ...sample(i * 0.5, 0.5),
      coverage: 0.001,
    }));
    expect(assessSamples(s)).toEqual({ ok: false, reason: "low-confidence" });
  });
  it("a blown full-frame matte is not a subject", () => {
    const s = Array.from({ length: 6 }, (_, i) => ({
      ...sample(i * 0.5, 0.5),
      coverage: 0.97,
    }));
    expect(assessSamples(s)).toEqual({ ok: false, reason: "low-confidence" });
  });
  it("a steady person passes", () => {
    expect(assessSamples(walkingSamples()).ok).toBe(true);
  });
});

describe("planTrackedCrop — follows a moving subject", () => {
  it("keeps the walking subject inside the crop window start to finish", () => {
    const p = plan(walkingSamples());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const half = p.window.w / 2;
    for (const t of [0, 2, 4, 6, 8]) {
      const { cx } = sampleCropPath(p.keyframes, t);
      const subjectCx = (0.22 + (0.78 - 0.22) * (t / 8)) * SRC_W;
      expect(cx - half).toBeLessThanOrEqual(subjectCx + 1);
      expect(cx + half).toBeGreaterThanOrEqual(subjectCx - 1);
    }
    // Start framed on the left-side subject, end on the right-side one.
    expect(sampleCropPath(p.keyframes, 0).cx).toBeLessThan(SRC_W * 0.35);
    expect(sampleCropPath(p.keyframes, 8).cx).toBeGreaterThan(SRC_W * 0.65);
  });

  it("never exceeds the pan speed bound while following", () => {
    const p = plan(walkingSamples());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(maxSegmentSpeed(p.keyframes)).toBeLessThanOrEqual(SPEED_BOUND + 1e-6);
  });

  it("a teleport jump becomes a bounded pan, never a jump cut", () => {
    const samples: DetectionSample[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i * 0.5;
      samples.push(sample(t, t < 4 ? 0.15 : 0.85));
    }
    const p = plan(samples);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(maxSegmentSpeed(p.keyframes)).toBeLessThanOrEqual(SPEED_BOUND + 1e-6);
    // Just after the jump the window is still near the old position…
    expect(sampleCropPath(p.keyframes, 4.1).cx).toBeLessThan(SRC_W * 0.4);
    // …and it does arrive at the new position by the end.
    expect(sampleCropPath(p.keyframes, 8).cx).toBeGreaterThan(SRC_W * 0.75);
  });

  it("a one-frame matte glitch is cleaned, not followed", () => {
    const samples: DetectionSample[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i * 0.5;
      samples.push(sample(t, i === 8 ? 0.95 : 0.3));
    }
    const p = plan(samples);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const k of p.keyframes) {
      expect(k.cx).toBeGreaterThan(SRC_W * 0.18);
      expect(k.cx).toBeLessThan(SRC_W * 0.45);
    }
  });

  it("emits an ffmpeg filter that follows the path and keeps the scale tail", () => {
    const p = plan(walkingSamples());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.filter.startsWith("crop=404:720:'clip(if(lt(t,")).toBe(true);
    expect(
      p.filter.endsWith(
        ",scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      ),
    ).toBe(true);
  });
});

describe("followSubjectPath — the bound is absolute", () => {
  it("adversarial jitter cannot exceed the bound on any segment or fine sample", () => {
    const desired: CropKeyframe[] = [];
    for (let i = 0; i <= 8; i++) {
      desired.push({ t: i * 0.5, cx: i % 2 === 0 ? 100 : 1180, cy: 360 });
    }
    const path = followSubjectPath(desired, {
      startT: 0,
      endT: 4,
      stepSec: 0.25,
      maxSpeedPxPerSec: SPEED_BOUND,
    });
    expect(maxSegmentSpeed(path)).toBeLessThanOrEqual(SPEED_BOUND + 1e-6);
    let prev = sampleCropPath(path, 0);
    for (let t = 0.05; t <= 4.0001; t += 0.05) {
      const cur = sampleCropPath(path, t);
      const speed = Math.hypot(cur.cx - prev.cx, cur.cy - prev.cy) / 0.05;
      expect(speed).toBeLessThanOrEqual(SPEED_BOUND + 1e-3);
      prev = cur;
    }
    // The follower never reaches either wild extreme.
    for (const k of path) {
      expect(k.cx).toBeGreaterThan(50);
      expect(k.cx).toBeLessThan(1230);
    }
  });

  it("a steadily moving subject is tracked to its destination", () => {
    // Subject drifts at 100 px/s; samples land every 1 s. The
    // follower sits on each sampled position at its sample time and
    // reaches the final position exactly.
    const desired: CropKeyframe[] = [
      { t: 0, cx: 300, cy: 360 },
      { t: 1, cx: 400, cy: 360 },
      { t: 2, cx: 500, cy: 360 },
      { t: 3, cx: 600, cy: 360 },
      { t: 4, cx: 700, cy: 360 },
    ];
    const path = followSubjectPath(desired, {
      startT: 0,
      endT: 4,
      stepSec: 0.25,
      maxSpeedPxPerSec: SPEED_BOUND,
    });
    expect(sampleCropPath(path, 2).cx).toBeCloseTo(500, 0);
    expect(sampleCropPath(path, 4).cx).toBeCloseTo(700, 0);
    expect(maxSegmentSpeed(path)).toBeLessThanOrEqual(SPEED_BOUND + 1e-6);
  });

  it("holds position until the subject actually moves (no anticipation)", () => {
    const desired: CropKeyframe[] = [
      { t: 0, cx: 200, cy: 360 },
      { t: 1, cx: 200, cy: 360 },
      { t: 2, cx: 200, cy: 360 },
      { t: 3, cx: 1000, cy: 360 },
      { t: 4, cx: 1000, cy: 360 },
      { t: 5, cx: 1000, cy: 360 },
    ];
    const path = followSubjectPath(desired, {
      startT: 0,
      endT: 5,
      stepSec: 0.25,
      maxSpeedPxPerSec: SPEED_BOUND,
    });
    // Well before the jump: dead still. By the end: arrived.
    expect(sampleCropPath(path, 2.5).cx).toBeCloseTo(200, 0);
    expect(sampleCropPath(path, 5).cx).toBeCloseTo(1000, 0);
    expect(maxSegmentSpeed(path)).toBeLessThanOrEqual(SPEED_BOUND + 1e-6);
  });
});

describe("cropWindowFor — 4:5 and degenerate sizes", () => {
  it("crops width for landscape → 4:5", () => {
    expect(cropWindowFor(SRC_W, SRC_H, 4 / 5)).toEqual({ w: 576, h: 720 });
  });
  it("crops height for portrait → 4:5", () => {
    expect(cropWindowFor(720, 1280, 4 / 5)).toEqual({ w: 720, h: 900 });
  });
  it("window is always even and at least 2px, even for odd/tiny sources", () => {
    expect(cropWindowFor(719, 1279, RATIO_916)).toEqual({ w: 718, h: 1278 });
    expect(cropWindowFor(3, 3, 16 / 9)).toEqual({ w: 2, h: 2 });
  });
});

describe("planTrackedCrop — the window clamps at the frame edges", () => {
  const still = (cx: number, cy = 0.5): DetectionSample[] =>
    Array.from({ length: 6 }, (_, i) => sample(i * 0.5, cx, cy));

  it("subject hugging the left edge pins the window to the left edge", () => {
    const p = plan(still(0.04));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const k of p.keyframes) expect(k.cx).toBe(p.window.w / 2);
    expect(p.filter).toContain(",0,876)"); // clip(x, 0, srcW - w)
  });

  it("subject hugging the right edge pins the window to the right edge", () => {
    const p = plan(still(0.97));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const k of p.keyframes) expect(k.cx).toBe(SRC_W - p.window.w / 2);
  });

  it("subject at the top/bottom pins the window vertically (portrait → 16:9)", () => {
    const top = planTrackedCrop({
      samples: Array.from({ length: 6 }, (_, i) => ({
        t: i * 0.5,
        box: { x: 0.43, y: 0.0, w: 0.14, h: 0.06 },
        coverage: 0.05,
      })),
      srcW: 720, srcH: 1280, targetRatio: 16 / 9, outW: 1920, outH: 1080, durationSec: 3,
    });
    expect(top.ok).toBe(true);
    if (top.ok) for (const k of top.keyframes) expect(k.cy).toBe(top.window.h / 2);

    const bottom = planTrackedCrop({
      samples: Array.from({ length: 6 }, (_, i) => ({
        t: i * 0.5,
        box: { x: 0.43, y: 0.94, w: 0.14, h: 0.06 },
        coverage: 0.05,
      })),
      srcW: 720, srcH: 1280, targetRatio: 16 / 9, outW: 1920, outH: 1080, durationSec: 3,
    });
    expect(bottom.ok).toBe(true);
    if (bottom.ok) for (const k of bottom.keyframes) expect(k.cy).toBe(1280 - bottom.window.h / 2);
  });
});

describe("planTrackedCrop — cleaning can still reject the track", () => {
  it("a glitch among exactly-enough samples drops the track to low-coverage", () => {
    // 3 of 6 tracked (passes the first assessment), but the middle
    // detection is a wild glitch: cleaning removes it, 2 remain,
    // and the second assessment must reject — not track on 2 points.
    const samples: DetectionSample[] = [
      sample(0, 0.3),
      sample(0.5, null),
      sample(1, 0.95),
      sample(1.5, null),
      sample(2, 0.32),
      sample(2.5, null),
    ];
    expect(assessSamples(samples).ok).toBe(true);
    const p = plan(samples, 3);
    expect(p).toEqual({ ok: false, reason: "low-coverage" });
  });
});

describe("assessSamples — trust boundaries are inclusive", () => {
  const withCoverage = (coverage: number, n = 6): DetectionSample[] =>
    Array.from({ length: n }, (_, i) => ({ ...sample(i * 0.5, 0.5), coverage }));

  it("exactly half the frames tracked, exactly 3 samples: passes", () => {
    const s = [
      sample(0, 0.5), sample(0.5, null),
      sample(1, 0.5), sample(1.5, null),
      sample(2, 0.5), sample(2.5, null),
    ];
    expect(assessSamples(s)).toEqual({ ok: true });
  });
  it("mean coverage exactly at the floor passes; a hair below rejects", () => {
    expect(assessSamples(withCoverage(0.004))).toEqual({ ok: true });
    expect(assessSamples(withCoverage(0.0039))).toEqual({ ok: false, reason: "low-confidence" });
  });
  it("mean coverage exactly at the blowout ceiling passes; a hair above rejects", () => {
    expect(assessSamples(withCoverage(0.92))).toEqual({ ok: true });
    expect(assessSamples(withCoverage(0.9201))).toEqual({ ok: false, reason: "low-confidence" });
  });
});

describe("buildTrackedCropFilter", () => {
  it("holds the final position after the last keyframe", () => {
    const filter = buildTrackedCropFilter(
      { w: 404, h: 720 },
      [
        { t: 0, cx: 300, cy: 360 },
        { t: 4, cx: 900, cy: 360 },
      ],
      SRC_W,
      SRC_H,
      1080,
      1920,
    );
    // Final x constant = last cx - w/2 = 900 - 202 = 698, clipped to [0, 876].
    expect(filter).toContain(",698)");
    expect(filter.startsWith("crop=404:720:'clip(if(lt(t,4),")).toBe(true);
  });
});
