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
  CROWNFALL_GUNS,
  ARCADE_GAME_META,
  DROP_QUALIFYING_SCORE,
  runnerSpeedAt,
  runnerScore,
  skeetSpawnIntervalMs,
  skeetHitPoints,
  skeetAccuracy,
  crownfallScore,
  crownfallFloorName,
  crownfallFoesForFloor,
  crownfallHpScale,
  crownfallSpeedScale,
  crownfallContactBonus,
  crownfallEliteChance,
  crownfallBossCycle,
  crownfallBossHp,
  crownfallComboMult,
  crownfallGun,
  crownfallUpgradePrice,
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
  /* v2 derivation (arcade-rules.ts): ≤24 foes/floor (ambush ceiling,
     boss summons included), ≤110 coins/floor (14 placed in a JACKPOT
     VAULT + doubled elite drops), combo bonus ≤ 40/kill (×5 cap). */
  const maxDepth = Math.floor(durationMs / 4_000) + 1;
  const maxKills = maxDepth * 24;
  const maxCoins = maxDepth * 110;
  const maxComboBonus = maxKills * 40;
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
    /* the hard per-floor foe ceiling (ambush-inflated) the caps use */
    expect(CROWNFALL.maxFoesPerFloor).toBe(24);
    /* the world is bigger than the view now */
    expect(CROWNFALL.worldWidth).toBe(1080);
    expect(CROWNFALL.worldHeight).toBe(1080);
    expect(CROWNFALL.width).toBe(720);
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
    // Simulate an extremely strong v2 run at the client's own pacing:
    // floors cleared every 6 seconds (the server bound assumes 4s is
    // impossible), every foe felled (table counts + boss adds +
    // cycle summons), every coin at the physical max (7 placed +
    // 2 dropped per foe, JACKPOT doubling on two floors), the purse
    // NEVER spent (the whole haul converts), and every kill chained
    // into one unbroken combo at the multiplier the chain length
    // earns — the most the v2 combo rule can ever pay.
    const durationMs = 120_000;
    const floorMs = 6_000;
    const floors = Math.floor(durationMs / floorMs);
    let kills = 0;
    let coins = 0;
    let comboBonus = 0;
    let chain = 0;
    for (let d = 1; d <= floors; d++) {
      let foes: number;
      if (d % 5 === 0) {
        const cycle = crownfallBossCycle(d);
        const summons = cycle >= 2 ? (cycle >= 4 ? 6 : 4) : 0;
        foes = 1 + (d >= 10 ? 2 : 0) + summons;
      } else {
        foes = crownfallFoesForFloor(d);
      }
      kills += foes;
      const jackpot = d === 3 || d === 7;
      coins += (jackpot ? 14 : 7) + 2 * foes * (jackpot ? 2 : 1);
      for (let k = 0; k < foes; k++) {
        chain++;
        comboBonus += (crownfallComboMult(chain) - 1) * 10;
      }
    }
    const depth = floors + 1; // died on the next floor down
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

describe("crownfall v2: the difficulty ramp table", () => {
  it("foe counts grow with depth and cap at 16 regular spawns", () => {
    expect(crownfallFoesForFloor(1)).toBe(4);
    expect(crownfallFoesForFloor(2)).toBe(6);
    expect(crownfallFoesForFloor(4)).toBe(9);
    expect(crownfallFoesForFloor(9)).toBe(16);
    expect(crownfallFoesForFloor(40)).toBe(16);
    /* even an AMBUSH room (×1.5) can never pass the hard ceiling */
    expect(Math.ceil(crownfallFoesForFloor(40) * 1.5)).toBeLessThanOrEqual(CROWNFALL.maxFoesPerFloor);
  });

  it("HP scales +22% per floor; speed creeps but stays escapable", () => {
    expect(crownfallHpScale(1)).toBe(1);
    expect(crownfallHpScale(6)).toBeCloseTo(2.1);
    expect(crownfallSpeedScale(1)).toBe(1);
    expect(crownfallSpeedScale(50)).toBeCloseTo(1.35);
    /* the fastest sustained foe (chaser 106) stays far under the
       King's dash burst (238 × 3.1) at every depth */
    for (let d = 1; d <= 60; d++) {
      expect(106 * crownfallSpeedScale(d)).toBeLessThan(238 * 3.1);
    }
  });

  it("contact damage steps up every 3 floors", () => {
    expect(crownfallContactBonus(1)).toBe(0);
    expect(crownfallContactBonus(3)).toBe(0);
    expect(crownfallContactBonus(4)).toBe(2);
    expect(crownfallContactBonus(10)).toBe(6);
  });

  it("elites: none before floor 3, rising share, capped at 50%", () => {
    expect(crownfallEliteChance(1)).toBe(0);
    expect(crownfallEliteChance(2)).toBe(0);
    expect(crownfallEliteChance(3)).toBeCloseTo(0.22);
    expect(crownfallEliteChance(10)).toBeCloseTo(0.5);
    expect(crownfallEliteChance(30)).toBe(0.5);
  });

  it("boss HP grows 60% per cycle", () => {
    expect(crownfallBossCycle(5)).toBe(1);
    expect(crownfallBossCycle(10)).toBe(2);
    expect(crownfallBossHp(5)).toBe(330);
    expect(crownfallBossHp(10)).toBeCloseTo(330 * 1.6);
    expect(crownfallBossHp(15)).toBeCloseTo(330 * 2.2);
  });
});

describe("crownfall v2: combo multiplier", () => {
  it("×1 for short chains, +1 per 4 chain, capped at ×5", () => {
    expect(crownfallComboMult(0)).toBe(1);
    expect(crownfallComboMult(1)).toBe(1);
    expect(crownfallComboMult(3)).toBe(1);
    expect(crownfallComboMult(4)).toBe(2);
    expect(crownfallComboMult(8)).toBe(3);
    expect(crownfallComboMult(12)).toBe(4);
    expect(crownfallComboMult(16)).toBe(5);
    expect(crownfallComboMult(500)).toBe(5);
  });

  it("one kill can never add more than 40 combo bonus (the cap's term)", () => {
    for (let c = 0; c <= 200; c++) {
      expect((crownfallComboMult(c) - 1) * CROWNFALL.killPoints).toBeLessThanOrEqual(40);
    }
  });
});

describe("crownfall v2: guns + shop prices", () => {
  it("six guns; the starter is free and owned by price 0", () => {
    expect(CROWNFALL_GUNS).toHaveLength(6);
    expect(CROWNFALL_GUNS.map((g) => g.id)).toEqual(["blaster", "twinfang", "scatter", "rapid", "rail", "mortar"]);
    expect(crownfallGun("blaster").price).toBe(0);
  });

  it("prices rise with power; the Crown Mortar is the priciest", () => {
    expect(crownfallGun("twinfang").price).toBe(30);
    expect(crownfallGun("scatter").price).toBe(45);
    expect(crownfallGun("rapid").price).toBe(55);
    expect(crownfallGun("rail").price).toBe(60);
    expect(crownfallGun("mortar").price).toBe(90);
    /* the stats match the sales pitch */
    expect(crownfallGun("scatter").pattern).toBe("scatter");
    expect(crownfallGun("scatter").range).toBeGreaterThan(0); /* shorter range */
    expect(crownfallGun("rail").pierce).toBeGreaterThan(100); /* passes through */
    expect(crownfallGun("rail").dmgMul).toBeGreaterThan(2);
    expect(crownfallGun("rapid").rateMul).toBeGreaterThan(1.5);
    expect(crownfallGun("mortar").splash).toBeGreaterThan(0);
    expect(crownfallGun("mortar").dmgMul).toBeGreaterThan(crownfallGun("rail").dmgMul);
    expect(crownfallGun("nope").id).toBe("blaster"); /* unknown ids fall back safely */
  });

  it("upgrade prices scale modestly with depth (+5% per floor)", () => {
    expect(crownfallUpgradePrice("dash", 1)).toBe(6);
    expect(crownfallUpgradePrice("secondwind", 1)).toBe(30); /* the expensive one */
    expect(crownfallUpgradePrice("dmg", 11)).toBe(12); /* 8 × 1.5 */
    expect(crownfallUpgradePrice("thorn", 6)).toBe(19); /* 15 × 1.25 → 19 */
    for (let d = 1; d < 30; d++) {
      expect(crownfallUpgradePrice("vit", d + 1)).toBeGreaterThanOrEqual(crownfallUpgradePrice("vit", d));
    }
  });
});
