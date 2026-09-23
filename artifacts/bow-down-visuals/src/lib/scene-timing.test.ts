import { describe, it, expect } from "vitest";
import {
  parseRawSceneDuration,
  formatClock,
  formatTimestampRange,
  computeSceneTimings,
  withSceneDurationSet,
} from "./scene-timing";
import type { SceneData } from "./scene-parser";

function mkScene(id: string, timestamp: string): SceneData {
  return {
    id,
    sceneNumber: 1,
    timestamp,
    section: "",
    lyricLine: "",
    location: "",
    action: "",
    cameraMovement: "",
    lighting: "",
    mood: "",
    aiVideoPrompt: "",
    negativePrompt: "",
    approved: false,
    demoClipUrl: null,
    thumbnailUrl: null,
    clipId: null,
    runwayJobId: null,
    provider: null,
    generationStatus: null,
    promptUsed: null,
    generatedAt: null,
  };
}

describe("parseRawSceneDuration", () => {
  it("parses whole-second ranges", () => {
    expect(parseRawSceneDuration("0:05 - 0:10")).toEqual({ durationSec: 5, hasExplicitEnd: true });
    expect(parseRawSceneDuration("1:28-1:54")).toEqual({ durationSec: 26, hasExplicitEnd: true });
  });

  it("parses decimal-second ranges", () => {
    const r = parseRawSceneDuration("2:57-3:16.8");
    expect(r.hasExplicitEnd).toBe(true);
    expect(r.durationSec).toBeCloseTo(19.8, 5);
  });

  it("falls back to 5s for missing/unparseable/single timestamps", () => {
    expect(parseRawSceneDuration("")).toEqual({ durationSec: 5, hasExplicitEnd: false });
    expect(parseRawSceneDuration(null)).toEqual({ durationSec: 5, hasExplicitEnd: false });
    expect(parseRawSceneDuration("3:15")).toEqual({ durationSec: 5, hasExplicitEnd: false });
    expect(parseRawSceneDuration("not a timestamp")).toEqual({ durationSec: 5, hasExplicitEnd: false });
  });

  it("falls back to 5s when end <= start", () => {
    expect(parseRawSceneDuration("0:10-0:05").hasExplicitEnd).toBe(false);
  });
});

describe("formatClock", () => {
  it("formats whole seconds as M:SS", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(45)).toBe("0:45");
    expect(formatClock(88)).toBe("1:28");
    expect(formatClock(177)).toBe("2:57");
  });

  it("formats tenths as M:SS.s without trailing .0", () => {
    expect(formatClock(196.8)).toBe("3:16.8");
    expect(formatClock(45.0)).toBe("0:45");
  });

  it("carries 59.96 up to the next minute", () => {
    expect(formatClock(59.96)).toBe("1:00");
  });

  it("clamps invalid input", () => {
    expect(formatClock(NaN)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("formatTimestampRange", () => {
  it("emits a re-parseable range", () => {
    const ts = formatTimestampRange(177, 196.8);
    expect(ts).toBe("2:57-3:16.8");
    const back = parseRawSceneDuration(ts);
    expect(back.hasExplicitEnd).toBe(true);
    expect(back.durationSec).toBeCloseTo(19.8, 5);
  });

  it("keeps whole-second ranges clean", () => {
    expect(formatTimestampRange(0, 17)).toBe("0:00-0:17");
  });
});

describe("computeSceneTimings", () => {
  it("places scenes back-to-back from explicit ranges", () => {
    const scenes = [mkScene("a", "0:00-0:17"), mkScene("b", "0:17-0:45"), mkScene("c", "0:45-1:28")];
    const t = computeSceneTimings(scenes, 196.8);
    expect(t[0]).toMatchObject({ startSec: 0, endSec: 17, durationSec: 17 });
    expect(t[1]).toMatchObject({ startSec: 17, endSec: 45, durationSec: 28 });
    expect(t[2]).toMatchObject({ startSec: 45, endSec: 88, durationSec: 43 });
  });

  it("evenly distributes when no scene has an explicit range", () => {
    const scenes = [mkScene("a", ""), mkScene("b", "")];
    const t = computeSceneTimings(scenes, 100);
    expect(t[0]!.durationSec).toBe(50);
    expect(t[1]!.startSec).toBe(50);
  });
});

describe("withSceneDurationSet", () => {
  it("sets one scene's duration and shifts later scenes, keeping earlier ones", () => {
    // Mixed: two explicit ranges + one 5s-default scene.
    const scenes = [mkScene("a", "0:00-0:04"), mkScene("b", "0:04-0:07"), mkScene("c", "")];
    const next = withSceneDurationSet(scenes, 196.8, "b", 28);
    const t = computeSceneTimings(next, 196.8);
    // Scene a untouched (was 4s, stays 4s — materialized, not defaulted)
    expect(t[0]).toMatchObject({ startSec: 0, durationSec: 4 });
    // Scene b now 28s
    expect(t[1]).toMatchObject({ startSec: 4, durationSec: 28 });
    // Scene c kept its visible 5s and shifted
    expect(t[2]).toMatchObject({ startSec: 32, durationSec: 5 });
  });

  it("materializes even-distribution timings when no scene had a range", () => {
    const scenes = [mkScene("a", ""), mkScene("b", ""), mkScene("c", "")];
    const next = withSceneDurationSet(scenes, 90, "a", 10);
    const t = computeSceneTimings(next, 90);
    // b and c keep the 30s they visibly had (not the 5s default)
    expect(t[0]!.durationSec).toBe(10);
    expect(t[1]).toMatchObject({ startSec: 10, durationSec: 30 });
    expect(t[2]).toMatchObject({ startSec: 40, durationSec: 30 });
  });

  it("rounds to 0.1s and clamps tiny durations", () => {
    const scenes = [mkScene("a", "0:00-0:10")];
    const next = withSceneDurationSet(scenes, null, "a", 0.05);
    expect(computeSceneTimings(next, null)[0]!.durationSec).toBe(0.1);
  });

  it("handles decimal targets end-to-end", () => {
    const scenes = [mkScene("a", "0:00-2:57")];
    const next = withSceneDurationSet(scenes, 196.8, "a", 19.8);
    expect(next[0]!.timestamp).toBe("0:00-0:19.8");
    expect(computeSceneTimings(next, 196.8)[0]!.durationSec).toBeCloseTo(19.8, 5);
  });
});
