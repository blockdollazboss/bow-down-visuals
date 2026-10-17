/**
 * Arcade v1 game-logic tests (lib/arcade-games.ts).
 *
 * The critical suite is the last one: it re-derives the SERVER's
 * plausibility caps (artifacts/api-server/src/lib/arcade-rules.ts) and
 * proves a PERFECT run of each client game can never exceed them — if a
 * future tuning change breaks that invariant, legitimate runs would be
 * rejected by the server, and this test fails first.
 */
import { describe, it, expect } from "vitest";
import {
  RUNNER,
  SKEET,
  DROP_QUALIFYING_SCORE,
  runnerSpeedAt,
  runnerScore,
  skeetSpawnIntervalMs,
  skeetHitPoints,
  skeetAccuracy,
} from "./arcade-games";

/* Server caps, re-declared from lib/arcade-rules.ts (the spec twin). */
function serverRunnerCap(durationMs: number): number {
  const seconds = durationMs / 1000;
  return (
    Math.ceil((seconds * 900) / 40) +
    (Math.floor(seconds / 1.1) + 1) * 25
  );
}
function serverSkeetCap(durationMs: number): number {
  return (Math.floor(durationMs / 500) + 1) * 150;
}

describe("runner scoring + speed", () => {
  it("speed starts at 420, ramps, and caps at 900", () => {
    expect(runnerSpeedAt(0)).toBe(420);
    expect(runnerSpeedAt(10_000)).toBe(480);
    expect(runnerSpeedAt(10 * 60_000)).toBe(900);
  });

  it("score = distance points + 25 per coin", () => {
    expect(runnerScore(0, 0)).toBe(0);
    expect(runnerScore(4_000, 0)).toBe(100);
    expect(runnerScore(3_999, 2)).toBe(99 + 50);
  });
});

describe("skeet scoring", () => {
  it("hit points: 100 base, +5 per streak step, bonus capped at +50", () => {
    expect(skeetHitPoints(0)).toBe(100);
    expect(skeetHitPoints(1)).toBe(105);
    expect(skeetHitPoints(10)).toBe(150);
    expect(skeetHitPoints(99)).toBe(150);
  });

  it("spawn interval ramps 900 → 550 and never below the server's 500 floor", () => {
    expect(skeetSpawnIntervalMs(0)).toBe(900);
    expect(skeetSpawnIntervalMs(SKEET.roundMs)).toBe(550);
    for (let t = 0; t <= SKEET.roundMs; t += 500) {
      expect(skeetSpawnIntervalMs(t)).toBeGreaterThanOrEqual(550);
    }
  });

  it("accuracy is a rounded percentage and safe at zero shots", () => {
    expect(skeetAccuracy(0, 0)).toBe(0);
    expect(skeetAccuracy(3, 4)).toBe(75);
    expect(skeetAccuracy(1, 3)).toBe(33);
  });
});

describe("drop qualification thresholds", () => {
  it("are reachable but not trivial in both games", () => {
    // Runner: 250 needs ~a minute of clean play, far below the 60s cap.
    expect(DROP_QUALIFYING_SCORE.runner).toBeLessThan(serverRunnerCap(60_000) / 2);
    // Skeet: 1500 = ~13 good hits in a 45s round.
    expect(DROP_QUALIFYING_SCORE.skeet).toBeLessThan(serverSkeetCap(45_000) / 5);
  });
});

describe("client-vs-server cap invariant (perfect runs must validate)", () => {
  it("a perfect 3-minute runner run stays under the server cap", () => {
    const durationMs = 180_000;
    // Integrate the real speed curve; collect every coin the moment the
    // client's own 1.25s spawn cadence allows.
    let distance = 0;
    const stepMs = 50;
    for (let t = 0; t < durationMs; t += stepMs) {
      distance += runnerSpeedAt(t) * (stepMs / 1000);
    }
    const coins = Math.floor(durationMs / RUNNER.coinSpawnIntervalMs) + 1;
    const perfect = runnerScore(distance, coins);
    expect(perfect).toBeLessThanOrEqual(serverRunnerCap(durationMs));
  });

  it("a perfect skeet round (every plate hit at max streak) stays under the cap", () => {
    let spawns = 0;
    for (let t = 0; t < SKEET.roundMs; t += skeetSpawnIntervalMs(t)) {
      spawns += 1;
    }
    const perfect = spawns * skeetHitPoints(999);
    expect(perfect).toBeLessThanOrEqual(serverSkeetCap(SKEET.roundMs));
  });
});
