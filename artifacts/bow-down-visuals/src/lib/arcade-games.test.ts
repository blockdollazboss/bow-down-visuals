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
  CROWNFALL,
  ARCADE_GAME_META,
  DROP_QUALIFYING_SCORE,
  runnerSpeedAt,
  runnerScore,
  skeetSpawnIntervalMs,
  skeetHitPoints,
  skeetAccuracy,
  crownfallScore,
  crownfallFloorName,
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
function serverCrownfallCap(durationMs: number): number {
  const maxDepth = Math.floor(durationMs / 4_000) + 1;
  const maxKills = maxDepth * 11;
  const maxCoins = maxDepth * 27;
  const maxComboBonus = (maxKills * (maxKills - 1)) / 2;
  return maxDepth * 100 + maxCoins * 25 + maxKills * 10 + maxComboBonus;
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

  it("crownfall qualifies at 500 — two rooms cleared with a real haul", () => {
    // Reaching floor 3 is 300 depth points before coins and kills.
    expect(DROP_QUALIFYING_SCORE.crownfall).toBe(500);
    expect(DROP_QUALIFYING_SCORE.crownfall).toBeLessThan(serverCrownfallCap(120_000) / 10);
    // Every registered game carries a threshold and a meta entry.
    expect(Object.keys(DROP_QUALIFYING_SCORE).sort()).toEqual(["crownfall", "runner", "skeet"]);
    expect(ARCADE_GAME_META.crownfall.title).toBe("Crownfall Run");
  });
});

describe("crownfall scoring", () => {
  it("score = depth × 100 + coins × 25 + kills × 10 + combo bonus", () => {
    expect(crownfallScore(1, 0, 0, 0)).toBe(100);
    expect(crownfallScore(3, 4, 12, 0)).toBe(300 + 100 + 120);
    expect(crownfallScore(5, 10, 30, 145)).toBe(500 + 250 + 300 + 145);
    expect(CROWNFALL.coinPoints).toBe(25);
    expect(CROWNFALL.maxFoesPerFloor).toBe(11);
  });

  it("floors are the studio's rooms in order, cycling deeper", () => {
    expect(crownfallFloorName(1)).toBe("The Lobby");
    expect(crownfallFloorName(2)).toBe("The Beat Lab");
    expect(crownfallFloorName(5)).toBe("The Mixing Room");
    expect(crownfallFloorName(7)).toBe("The Throne Room");
    expect(crownfallFloorName(11)).toBe("The Lobby");
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

  it("a fast, rich, fully-chained 2-minute crownfall run stays under the cap", () => {
    // Simulate an extremely strong run at the client's own pacing:
    // floors cleared every 6 seconds (the server bound assumes 4s is
    // impossible), every foe felled, every coin at the physical max
    // (5 placed + 2 dropped per foe), and every kill chained into one
    // unbroken combo — the most the combo rule can ever pay.
    const durationMs = 120_000;
    const floorMs = 6_000;
    const floors = Math.floor(durationMs / floorMs);
    let kills = 0;
    let coins = 0;
    for (let d = 1; d <= floors; d++) {
      const foes = d % 5 === 0 ? (d >= 10 ? 3 : 1) : Math.min(11, 3 + d + Math.floor(d / 3));
      kills += foes;
      coins += 5 + 2 * foes;
    }
    const depth = floors + 1; // died on the next floor down
    const comboBonus = (kills * (kills - 1)) / 2;
    const perfect = crownfallScore(depth, coins, kills, comboBonus);
    expect(perfect).toBeLessThanOrEqual(serverCrownfallCap(durationMs));
  });

  it("an ordinary crownfall run sits far below the cap", () => {
    // Floor 6 in 90 seconds: a handful of coins and kills, small combo.
    const ordinary = crownfallScore(6, 18, 34, 96);
    expect(ordinary).toBe(600 + 450 + 340 + 96);
    expect(ordinary).toBeLessThan(serverCrownfallCap(90_000) / 10);
  });
});
