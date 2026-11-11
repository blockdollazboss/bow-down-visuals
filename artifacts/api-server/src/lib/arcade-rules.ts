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

export const ARCADE_GAMES = ["runner", "skeet", "crownfall"] as const;
export type ArcadeGame = (typeof ARCADE_GAMES)[number];

export function isArcadeGame(v: unknown): v is ArcadeGame {
  return v === "runner" || v === "skeet" || v === "crownfall";
}

/* Runner construction (client): speed starts 420 px/s, ramps +6 px/s per
   second, hard cap 900 px/s. Score = floor(distancePx / 40) + 25/coin.
   Coins spawn at most once per 1.1s. */
const RUNNER_MAX_SPEED_PX_S = 900;
const RUNNER_PX_PER_POINT = 40;
const RUNNER_COIN_POINTS = 25;
const RUNNER_MIN_COIN_INTERVAL_S = 1.1;

/* Royal Skeet construction (client): fixed 45s round — it replaced
   the Shooter Gallery in the games upgrade with the same scoring
   contract. Plates spawn no faster than every 500ms. A hit scores
   100 + min(streak, 10) * 5, so one hit is worth at most 150. */
const SKEET_ROUND_MS = 45_000;
const SKEET_MIN_SPAWN_INTERVAL_MS = 500;
const SKEET_MAX_HIT_POINTS = 150;

/* Crownfall Run construction (client, v2): a roguelike descent —
   each floor is one 1080×1080 room (720×720 camera view) the King
   must clear before the golden door opens. Score = depth × 100 +
   coins × 25 + kills × 10 + combo bonus, where "coins" is the
   LEFTOVER PURSE at run end: coins picked up feed a run-local purse,
   the between-floor shop spends from it, and only the unspent
   remainder converts at +25. Spending can only shrink the coin
   term, so the v1 ceiling argument survives intact — the maximum
   convertible coins is still bounded by the total coin supply.
   The reported durationMs is PLAY time only (pause and the shop
   are not counted by the client), which makes every bound below
   tighter, never looser.
   - A floor cannot end in under 4 seconds of play: the weakest foe
     has 20 HP and the King's base weapon fires 3.1 bolts/s at 10
     damage (≥2 bolts per foe, foes spawn ≥215px away, bolts fly
     545 px/s), and after the last kill the King must still cross
     the room from the entrance to the door at 238 px/s. The v2 room
     is BIGGER (1080×1080, camera-followed), so this bound is more
     conservative than in v1, not less. Shop purchases only arrive
     AFTER a floor, so floor 1 is always fought at base stats.
   - Foes per floor: regular floors spawn min(16, 3 + d + ⌊d/2⌋)
     ≤ 16; an AMBUSH event room multiplies that by 1.5 rounded up
     (≤ 24); boss floors spawn 1 boss + 2 adds (floor 10+) + at
     most 6 summoned minions across the whole fight (boss cycles)
     = 9. The hard ceiling for any floor is therefore 24.
   - Coins per floor: at most 14 are placed (JACKPOT VAULT rooms;
     normal floors place ≤ 7), and a kill drops at most 2 (elites
     and the boss drop exactly 2; regular foes at most 1) with
     JACKPOT doubling drop counts — so ≤ 14 + 2 × 2 × 24 = 110.
   - Combo bonus: kills chained within 3s raise a multiplier
     ×1–×5 that multiplies the 10-point kill score, so one kill
     adds at most (5 − 1) × 10 = 40 bonus points; over K kills the
     bonus is at most 40K. (The v2 multiplier REPLACES the v1
     n − 1 chain rule — the old quadratic bound no longer applies
     because the multiplier is capped at ×5 by construction.)
   - Guns change kill RATES, not scoring inputs: the strongest gun
     (Crown Mortar, splash damage) can fell several foes with one
     shell, but kills are bounded by the foe supply above and
     floors by the 4-second bound, so no gun raises this ceiling.
     Gun drops and shop purchases move no score at all.
   - Prestige (+5% bolt damage, +10% coin drops per tier, ≤ tier
     10) and the daily Royal Bounty (+50) feed a separate SCRIP
     bucket that is spendable in the shop but NEVER converts to
     score — the client's run-end conversion counts the regular
     purse only. These caps therefore ignore prestige entirely,
     and a max-prestige run's score stays under this same ceiling.
   A real Crownfall run can also legitimately outlast the shared
   20-minute ceiling (a deep descent is the whole point), so this
   game carries its own 60-minute duration cap. */
const CROWNFALL_MIN_FLOOR_MS = 4_000;
/* Multiplayer (online co-op rooms, lib/crownfall-rooms.ts): the party
   SHARES one floor roster, so the per-floor foe and coin bounds below
   do NOT scale with player count — a player can still earn at most
   24 kills and 110 coins from a floor, whoever they play with. Only
   the clear SPEED scales: the 4,000 ms solo bound decomposes into
   ≈2,300 ms of pure entrance→door crossing (every King physically
   walks it; it never shrinks) plus ≈1,700 ms of killing, which P
   Kings do in parallel. So minFloorMs(P) = 2300 + ⌈1700 / P⌉, and
   P = 1 reproduces the solo bound exactly. (The v2 roster is larger
   than v1's, which only makes real clears slower — the decomposition
   stays a valid lower bound.) The party size is never taken from the
   client: the score route reads it from the room manager's run
   receipt (routes/arcade.ts) and validates at P = 1 when no receipt
   vouches for the run. */
const CROWNFALL_CROSSING_MS = 2_300;
const CROWNFALL_KILL_MS = CROWNFALL_MIN_FLOOR_MS - CROWNFALL_CROSSING_MS;

/** Fastest one floor can honestly end for a party of `players`
 *  (1–4). Solo (players = 1) is exactly the single-player bound. */
export function crownfallMinFloorMs(players: number): number {
  const p = Math.min(4, Math.max(1, Math.floor(players) || 1));
  return CROWNFALL_CROSSING_MS + Math.ceil(CROWNFALL_KILL_MS / p);
}

const CROWNFALL_MAX_FOES_PER_FLOOR = 24;
const CROWNFALL_MAX_COINS_PER_FLOOR = 14 + 2 * 2 * CROWNFALL_MAX_FOES_PER_FLOOR;
const CROWNFALL_DEPTH_POINTS = 100;
const CROWNFALL_COIN_POINTS = 25;
const CROWNFALL_KILL_POINTS = 10;
const CROWNFALL_MAX_COMBO_BONUS_PER_KILL = 40;
const CROWNFALL_MAX_DURATION_MS = 60 * 60_000;

/* A scored run must last at least this long, and no submission may
   claim more than 20 minutes of play (runner runs end on collision,
   skeet rounds are 45s; Crownfall's deeper cap is above). */
const ARCADE_MIN_DURATION_MS = 2_000;
const ARCADE_MAX_DURATION_MS = 20 * 60_000;

/** Highest score a real run of `durationMs` could possibly reach.
 *  `players` (Crownfall only) is the receipt-verified party size for
 *  an online co-op run; it defaults to 1 = the solo bounds. */
export function maxPlausibleScore(game: ArcadeGame, durationMs: number, players = 1): number {
  const seconds = durationMs / 1000;
  if (game === "runner") {
    const distancePoints = Math.ceil((seconds * RUNNER_MAX_SPEED_PX_S) / RUNNER_PX_PER_POINT);
    const maxCoins = Math.floor(seconds / RUNNER_MIN_COIN_INTERVAL_S) + 1;
    return distancePoints + maxCoins * RUNNER_COIN_POINTS;
  }
  if (game === "crownfall") {
    const maxDepth = Math.floor(durationMs / crownfallMinFloorMs(players)) + 1;
    const maxKills = maxDepth * CROWNFALL_MAX_FOES_PER_FLOOR;
    const maxCoins = maxDepth * CROWNFALL_MAX_COINS_PER_FLOOR;
    const maxComboBonus = maxKills * CROWNFALL_MAX_COMBO_BONUS_PER_KILL;
    return (
      maxDepth * CROWNFALL_DEPTH_POINTS +
      maxCoins * CROWNFALL_COIN_POINTS +
      maxKills * CROWNFALL_KILL_POINTS +
      maxComboBonus
    );
  }
  const maxTargets = Math.floor(durationMs / SKEET_MIN_SPAWN_INTERVAL_MS) + 1;
  return maxTargets * SKEET_MAX_HIT_POINTS;
}

type ScoreVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/** Validate one score submission. Pure — no I/O. `players`, when
 *  present, must be a whole party size (1–4); it only widens the
 *  Crownfall pacing bound, and the caller is responsible for sourcing
 *  it from server-side truth (the Crownfall run receipt), never from
 *  an unverified client claim. */
export function validateArcadeScore(input: {
  game: unknown;
  score: unknown;
  durationMs: unknown;
  players?: unknown;
}): ScoreVerdict {
  if (!isArcadeGame(input.game)) {
    return { ok: false, reason: "Unknown game" };
  }
  if (
    input.players !== undefined &&
    (typeof input.players !== "number" || !Number.isInteger(input.players) || input.players < 1 || input.players > 4)
  ) {
    return { ok: false, reason: "Party size out of range" };
  }
  const players = typeof input.players === "number" ? input.players : 1;
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
  const maxDurationMs =
    input.game === "crownfall" ? CROWNFALL_MAX_DURATION_MS : ARCADE_MAX_DURATION_MS;
  if (durationMs > maxDurationMs) {
    return { ok: false, reason: "Run duration out of range" };
  }
  if (input.game === "skeet" && durationMs > SKEET_ROUND_MS + 5_000) {
    return { ok: false, reason: "Skeet rounds last 45 seconds" };
  }
  if (score > maxPlausibleScore(input.game, durationMs, players)) {
    return { ok: false, reason: "Score is not possible for a run of that length" };
  }
  return { ok: true };
}
