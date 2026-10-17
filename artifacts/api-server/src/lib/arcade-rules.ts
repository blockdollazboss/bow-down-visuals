/* ─── Arcade v1 — score plausibility rules (pure, unit-tested) ────────────
   The arcade clients report (score, durationMs) when a run ends. These
   caps are DERIVED from the games' own construction constants (mirrored
   in artifacts/bow-down-visuals/src/lib/arcade-games.ts — keep the two
   in sync): a score above the cap is physically impossible in a real
   run of that length, so it is rejected, never stored. This stops the
   naive "POST a billion points" printer. It is a plausibility gate,
   not DRM: a determined cheater can still claim a cap-max score, the
   same trust level as every client-reported stat on the site — and
   arcade scores carry NO Visual Bucs (rewards ride the Shark Drop
   rail), so the blast radius of a faked score is a leaderboard lie,
   not money. */

export const ARCADE_GAMES = ["runner", "skeet"] as const;
export type ArcadeGame = (typeof ARCADE_GAMES)[number];

export function isArcadeGame(v: unknown): v is ArcadeGame {
  return v === "runner" || v === "skeet";
}

/* Runner construction (client): speed starts 420 px/s, ramps +6 px/s per
   second, hard cap 900 px/s. Score = floor(distancePx / 40) + 25/coin.
   Coins spawn at most once per 1.1s. */
export const RUNNER_MAX_SPEED_PX_S = 900;
export const RUNNER_PX_PER_POINT = 40;
export const RUNNER_COIN_POINTS = 25;
export const RUNNER_MIN_COIN_INTERVAL_S = 1.1;

/* Royal Skeet construction (client): fixed 45s round — it replaced
   the Shooter Gallery in the games upgrade with the same scoring
   contract. Plates spawn no faster than every 500ms. A hit scores
   100 + min(streak, 10) * 5, so one hit is worth at most 150. */
export const SKEET_ROUND_MS = 45_000;
export const SKEET_MIN_SPAWN_INTERVAL_MS = 500;
export const SKEET_MAX_HIT_POINTS = 150;

/* A scored run must last at least this long, and no submission may
   claim more than 20 minutes of play (both games end far sooner:
   runner runs end on collision, skeet rounds are 45s). */
export const ARCADE_MIN_DURATION_MS = 2_000;
export const ARCADE_MAX_DURATION_MS = 20 * 60_000;

/** Highest score a real run of `durationMs` could possibly reach. */
export function maxPlausibleScore(game: ArcadeGame, durationMs: number): number {
  const seconds = durationMs / 1000;
  if (game === "runner") {
    const distancePoints = Math.ceil((seconds * RUNNER_MAX_SPEED_PX_S) / RUNNER_PX_PER_POINT);
    const maxCoins = Math.floor(seconds / RUNNER_MIN_COIN_INTERVAL_S) + 1;
    return distancePoints + maxCoins * RUNNER_COIN_POINTS;
  }
  const maxTargets = Math.floor(durationMs / SKEET_MIN_SPAWN_INTERVAL_MS) + 1;
  return maxTargets * SKEET_MAX_HIT_POINTS;
}

export type ScoreVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/** Validate one score submission. Pure — no I/O. */
export function validateArcadeScore(input: {
  game: unknown;
  score: unknown;
  durationMs: unknown;
}): ScoreVerdict {
  if (!isArcadeGame(input.game)) {
    return { ok: false, reason: "Unknown game" };
  }
  const { score, durationMs } = input;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0) {
    return { ok: false, reason: "Score must be a non-negative integer" };
  }
  if (typeof durationMs !== "number" || !Number.isInteger(durationMs)) {
    return { ok: false, reason: "Duration must be an integer number of milliseconds" };
  }
  if (durationMs < ARCADE_MIN_DURATION_MS) {
    return { ok: false, reason: "Run too short to score" };
  }
  if (durationMs > ARCADE_MAX_DURATION_MS) {
    return { ok: false, reason: "Run duration out of range" };
  }
  if (input.game === "skeet" && durationMs > SKEET_ROUND_MS + 5_000) {
    return { ok: false, reason: "Skeet rounds last 45 seconds" };
  }
  if (score > maxPlausibleScore(input.game, durationMs)) {
    return { ok: false, reason: "Score is not possible for a run of that length" };
  }
  return { ok: true };
}
