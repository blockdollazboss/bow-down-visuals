/* ─── Arcade v1 — game construction constants + scoring (pure) ───────────
   These constants DEFINE what a real run can score. The server mirrors
   them in artifacts/api-server/src/lib/arcade-rules.ts to reject
   impossible submissions — keep the two files in sync. If you make a
   game faster or more generous here, raise the server caps there too,
   or legitimate runs will start failing validation. */

export type ArcadeGameId = "runner" | "gallery";

export interface ArcadeRunResult {
  game: ArcadeGameId;
  score: number;
  durationMs: number;
}

/* ── Shark King Endless Runner ───────────────────────────────────────────
   Speed starts at 420 px/s, ramps +6 px/s each second, hard cap 900.
   Score = floor(distancePx / 40) + 25 per Visual Bucs coin. Coins spawn
   at most once per 1.25s (server cap assumes 1.1s — headroom is
   deliberate so a perfect legit run never trips validation). */
export const RUNNER = {
  width: 960,
  height: 360,
  groundY: 300,
  startSpeed: 420,
  speedRampPerSec: 6,
  maxSpeed: 900,
  pxPerPoint: 40,
  coinPoints: 25,
  coinSpawnIntervalMs: 1_250,
  gravity: 2_600,
  jumpVelocity: 980,
} as const;

export function runnerSpeedAt(elapsedMs: number): number {
  return Math.min(
    RUNNER.maxSpeed,
    RUNNER.startSpeed + RUNNER.speedRampPerSec * (elapsedMs / 1000),
  );
}

export function runnerScore(distancePx: number, coins: number): number {
  return Math.floor(distancePx / RUNNER.pxPerPoint) + coins * RUNNER.coinPoints;
}

/* ── Shooter Gallery ─────────────────────────────────────────────────────
   Fixed 45-second rounds. Targets spawn every 900ms at the start,
   ramping down to 550ms by the end (server cap assumes a 500ms floor).
   A hit scores 100 + 5 per streak step (streak bonus caps at +50);
   a miss costs 25 and resets the streak. */
export const GALLERY = {
  width: 960,
  height: 540,
  roundMs: 45_000,
  spawnStartMs: 900,
  spawnEndMs: 550,
  targetLifetimeMs: 1_300,
  targetRadius: 46,
  baseHitPoints: 100,
  streakStepPoints: 5,
  streakBonusCapSteps: 10,
  missPenalty: 25,
} as const;

export function gallerySpawnIntervalMs(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / GALLERY.roundMs));
  return GALLERY.spawnStartMs + (GALLERY.spawnEndMs - GALLERY.spawnStartMs) * t;
}

export function galleryHitPoints(streak: number): number {
  const steps = Math.min(Math.max(streak, 0), GALLERY.streakBonusCapSteps);
  return GALLERY.baseHitPoints + steps * GALLERY.streakStepPoints;
}

export function galleryAccuracy(hits: number, shots: number): number {
  if (shots <= 0) return 0;
  return Math.round((hits / shots) * 100);
}

/* ── Drop-rail qualification ─────────────────────────────────────────────
   After a qualifying run the arcade checks the EXISTING Shark Drop rail
   (GET /api/retention/shark-drop). The rail itself decides — dice roll,
   ≤2 drops per rolling 7 days, retention prefs — the arcade never
   promises or mints Visual Bucs. Thresholds are purely a UX gate so
   throwaway runs don't burn the dice roll. */
export const DROP_QUALIFYING_SCORE: Record<ArcadeGameId, number> = {
  runner: 250,
  gallery: 1_500,
};

export const ARCADE_GAME_META: Record<
  ArcadeGameId,
  { title: string; tagline: string }
> = {
  runner: {
    title: "Shark King Endless Runner",
    tagline: "Ride the gold wave. Jump the crates, duck the banners, grab the Bucs.",
  },
  gallery: {
    title: "Shooter Gallery",
    tagline: "45 seconds. Pop the gold fins, build your streak, don't spray.",
  },
};
