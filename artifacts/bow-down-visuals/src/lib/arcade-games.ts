/* ─── Arcade v1 — game construction constants + scoring (pure) ───────────
   These constants DEFINE what a real run can score. The server mirrors
   them in artifacts/api-server/src/lib/arcade-rules.ts to reject
   impossible submissions — keep the two files in sync. If you make a
   game faster or more generous here, raise the server caps there too,
   or legitimate runs will start failing validation. */

export type ArcadeGameId = "runner" | "skeet" | "crownfall";

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

/* ── Royal Skeet ─────────────────────────────────────────────────────────
   (Replaced the Shooter Gallery in the games upgrade — same scoring
   contract, ported whole.) Fixed 45-second rounds. Gold plates launch
   every 900ms at the start, ramping down to 550ms by the end (server
   cap assumes a 500ms floor), and arc across the courtyard on real
   trajectories. A hit scores 100 + 5 per streak step (streak bonus
   caps at +50); a shot that hits nothing costs 25 and resets the
   streak. Plates that fly past unbroken cost nothing. */
export const SKEET = {
  width: 960,
  height: 540,
  roundMs: 45_000,
  spawnStartMs: 900,
  spawnEndMs: 550,
  plateRadius: 46,
  baseHitPoints: 100,
  streakStepPoints: 5,
  streakBonusCapSteps: 10,
  missPenalty: 25,
} as const;

export function skeetSpawnIntervalMs(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / SKEET.roundMs));
  return SKEET.spawnStartMs + (SKEET.spawnEndMs - SKEET.spawnStartMs) * t;
}

export function skeetHitPoints(streak: number): number {
  const steps = Math.min(Math.max(streak, 0), SKEET.streakBonusCapSteps);
  return SKEET.baseHitPoints + steps * SKEET.streakStepPoints;
}

export function skeetAccuracy(hits: number, shots: number): number {
  if (shots <= 0) return 0;
  return Math.round((hits / shots) * 100);
}

/* ── Crownfall Run ───────────────────────────────────────────────────────
   Top-down arena roguelike (the third house game). v2 (owner, Nov 10,
   2026): BIGGER ROOMS with a following camera, a COIN PURSE + SHOP
   economy, SIX GUNS, an explicit difficulty ramp, event rooms,
   prestige — and fullscreen. The King holds a 1080×1080 studio room
   (the canvas shows a 720×720 view of it) against waves of Glitches,
   Spam Bots and Trolls; THE USURPER waits every 5th floor, harder
   each cycle. Clear the room and the golden door opens to the next
   floor down.

   SCORE (unchanged shape, new coin meaning): score = depth × 100 +
   coins × 25 + foes felled × 10 + combo bonus, where "coins" is now
   the LEFTOVER PURSE at run end — coins picked up go into the purse
   (HUD), the between-floor shop spends from it, and only what is
   left converts at +25 per coin when the run ends. The combo is a
   MULTIPLIER: kills chained within 3s of the previous one raise the
   multiplier ×1→×5 (crownfallComboMult); each kill scores
   10 × multiplier, the excess over 10 accruing as combo bonus — so
   one kill can add at most 40 bonus points. Purse coins are
   RUN-LOCAL: no charge, no wager, they never touch Visual Bucs.
   Prestige scrip and the daily Royal Bounty live in a separate purse
   bucket that is spendable in the shop but NEVER converts to score,
   so prestige cannot inflate a submitted score.

   The server mirrors the pacing bounds in arcade-rules.ts: a floor
   cannot be cleared in under 4s of play (the bigger room only makes
   that bound more conservative), a floor holds at most 24 foes
   (AMBUSH rooms included), and a floor yields at most 14 placed
   coins (JACKPOT VAULT) + doubled elite drops of 2 per foe. Online
   co-op (rooms of up to 4) shares one floor roster, so the foe/coin
   bounds are the same there — only the 4s pacing bound divides its
   ~1.7s killing portion across the party (2,300ms of walking never
   shrinks), and only for runs the server's own receipt vouches
   for. */
export const CROWNFALL = {
  /* the canvas VIEW (logical px); the world is bigger — see below */
  width: 720,
  height: 720,
  /* the room itself: 1080×1080 ≈ 2.25× the old room's area */
  worldWidth: 1080,
  worldHeight: 1080,
  wall: 30,
  depthPoints: 100,
  coinPoints: 25,
  killPoints: 10,
  comboWindowSec: 3,
  comboMaxMult: 5,
  baseHp: 100,
  baseSpeed: 238,
  baseDamage: 10,
  baseFireRate: 3.1,
  baseMagnet: 74,
  dashCooldownSec: 2.2,
  /* hard spawn ceiling for ANY floor (ambush-inflated), boss summons
     included — the number the server caps are derived from */
  maxFoesPerFloor: 24,
  /* placed coin pickups: normal floors 4–7, JACKPOT VAULT 8–14 */
  placedCoinsMax: 7,
  jackpotPlacedCoinsMax: 14,
} as const;

export function crownfallScore(
  depth: number,
  crowns: number,
  kills: number,
  comboBonus: number,
): number {
  return (
    depth * CROWNFALL.depthPoints +
    crowns * CROWNFALL.coinPoints +
    kills * CROWNFALL.killPoints +
    comboBonus
  );
}

/* ── Crownfall difficulty ramp (owner: "each level should get harder
   and harder") — the per-floor scaling table, shared by the game and
   its tests so the curve can never drift between them:
   - FOES: min(16, 3 + depth + ⌊depth/2⌋) regular spawns per floor
     (AMBUSH event rooms multiply by 1.5, rounded up — hence the hard
     ceiling of 24 in CROWNFALL.maxFoesPerFloor). Boss floors spawn
     THE USURPER + 2 adds from floor 10, plus boss summons below.
   - HP: ×(1 + 0.22 per floor past the first), as in v1.
   - SPEED: ×(1 + 0.03 per floor), capped at ×1.35 — sustained foe
     speed tops out at ~143 px/s, and even the Glitch Charger's
     470 px/s charge stays far under the King's dash burst
     (238 × 3.1 ≈ 738 px/s): the dash escape always works.
   - CONTACT DAMAGE: base by foe + 2 per full 3 floors descended.
   - ELITES: none before floor 3, then 22% + 4 points per floor,
     capped at 50% (JACKPOT VAULT adds +15 points on top).
   - UNLOCKS: Glitch Chargers join from floor 3, Spam Slingers
     (ranged) from floor 4 — never earlier.
   - BOSS CYCLES (cycle = ⌊depth/5⌋): HP 330 × (1 + 0.6 per cycle
     past the first); cycle 2+ summons minion waves at ⅔ and ⅓ HP
     (2 per wave, 3 per wave from cycle 4 — at most 6 extra foes);
     cycle 3+ fires a 3-bolt spread instead of a single bolt;
     cycle 4+ also moves 20% faster. The ramp assumes shop spending:
     an unupgraded starter-gun run realistically ends around floors
     4–6, while a well-shopped run pushes deep. The descent is
     endless — the curve keeps rising until the run does. */
export function crownfallFoesForFloor(depth: number): number {
  return Math.min(16, 3 + depth + Math.floor(depth / 2));
}
export function crownfallHpScale(depth: number): number {
  return 1 + (depth - 1) * 0.22;
}
export function crownfallSpeedScale(depth: number): number {
  return 1 + Math.min(0.35, (depth - 1) * 0.03);
}
export function crownfallContactBonus(depth: number): number {
  return 2 * Math.floor((depth - 1) / 3);
}
export function crownfallEliteChance(depth: number): number {
  if (depth < 3) return 0;
  return Math.min(0.5, 0.22 + 0.04 * (depth - 3));
}
export function crownfallBossCycle(depth: number): number {
  return Math.floor(depth / 5);
}
export function crownfallBossHp(depth: number): number {
  return 330 * (1 + (crownfallBossCycle(depth) - 1) * 0.6);
}
/* The combo multiplier for a chain of `combo` chained kills:
   ×1 for chains 1–3, then +1 per 4 chain, capped at ×5 (chain 16+). */
export function crownfallComboMult(combo: number): number {
  if (combo <= 0) return 1;
  return Math.min(CROWNFALL.comboMaxMult, 1 + Math.floor(combo / 4));
}

/* ── Crownfall guns (owner: "a bunch of guns") ─────────────────────────
   Six guns, bought with purse coins in the between-floor shop (the
   Royal Bolt Blaster is owned from floor 1, free). Prices scale with
   power. Every gun keeps MANUAL AIM + held-input firing — switching
   guns never adds auto-fire. How the stats compose (documented so
   the shop copy can say it plainly): bolt damage = the King's damage
   stat × dmgMul (damage upgrades and prestige multiply the stat);
   fire interval = 1 / (fire-rate stat × rateMul); the Twin Bolts /
   Triple Upload / Royal Pierce upgrades stack ON TOP of any gun's
   own pattern (extra streams, a wider fan, +2 pierce). `range` is
   how far a bolt flies before it dies (0 = until it hits a wall);
   `splash` is the mortar shell's blast radius (full damage inside).
   Elites have a 25% chance to drop a random unowned gun instead of
   nothing extra; THE USURPER always drops one (while any remain
   unowned). A dropped gun is claimed by walking over it, and equips
   on claim. */
export interface CrownfallGun {
  id: string;
  name: string;
  desc: string;
  price: number;
  dmgMul: number;
  rateMul: number;
  boltSpeed: number;
  boltR: number;
  pierce: number; /* extra foes a bolt passes through; 999 = always */
  splash: number;
  range: number;
  pattern: "single" | "twin" | "scatter";
  tint: string; /* shop swatch + bolt tint */
}
export const CROWNFALL_GUNS: CrownfallGun[] = [
  { id: "blaster", name: "Royal Bolt Blaster", desc: "The King's own sidearm. Honest golden bolts, no nonsense.", price: 0, dmgMul: 1, rateMul: 1, boltSpeed: 545, boltR: 5, pierce: 0, splash: 0, range: 0, pattern: "single", tint: "#f0c94f" },
  { id: "twinfang", name: "Twin Fang", desc: "Two parallel bolts with every pull. Double the bite.", price: 30, dmgMul: 0.8, rateMul: 0.95, boltSpeed: 545, boltR: 5, pierce: 0, splash: 0, range: 0, pattern: "twin", tint: "#ffd97a" },
  { id: "scatter", name: "Scatter Cannon", desc: "A five-bolt fan that owns close range — and only close range.", price: 45, dmgMul: 0.55, rateMul: 0.7, boltSpeed: 520, boltR: 5, pierce: 0, splash: 0, range: 300, pattern: "scatter", tint: "#ff9a3c" },
  { id: "rapid", name: "Rapid Royal", desc: "A golden hose. Very fast fire, lighter bolts.", price: 55, dmgMul: 0.55, rateMul: 1.9, boltSpeed: 545, boltR: 4, pierce: 0, splash: 0, range: 0, pattern: "single", tint: "#fff3c4" },
  { id: "rail", name: "Rail Lance", desc: "One piercing lance of light. Slow, huge, passes through everything.", price: 60, dmgMul: 2.6, rateMul: 0.45, boltSpeed: 900, boltR: 4, pierce: 999, splash: 0, range: 0, pattern: "single", tint: "#8ae2ff" },
  { id: "mortar", name: "Crown Mortar", desc: "Slow heavy shells that burst over a whole pack. The room notices.", price: 90, dmgMul: 3.2, rateMul: 0.5, boltSpeed: 380, boltR: 9, pierce: 0, splash: 66, range: 0, pattern: "single", tint: "#ff6b5e" },
];
export function crownfallGun(id: string): CrownfallGun {
  return CROWNFALL_GUNS.find((x) => x.id === id) ?? CROWNFALL_GUNS[0]!;
}

/* ── Crownfall shop prices (purse coins) ───────────────────────────────
   Upgrades carry a base price that scales modestly with depth:
   price = round(base × (1 + 0.05 × (depth − 1))) — +5% per floor
   descended, so floor-10 prices are ~1.45× base. Guns are one-time
   purchases at flat prices (the table above). A floor yields roughly
   8–12 purse coins to a thorough clear (4–7 placed + drops), so a
   cheap upgrade is in reach after floor 1 and a gun after 3–5 floors
   of saving — or sooner with the daily Royal Bounty (+50 scrip).
   Descending is ALWAYS free: the shop can never trap a broke King. */
export const CROWNFALL_UPGRADE_PRICES: Record<string, number> = {
  dash: 6,
  speed: 7,
  magnet: 7,
  dmg: 8,
  rapid: 8,
  vit: 9,
  dash2: 10,
  magnet2: 11,
  spread: 12,
  pierce: 12,
  twin: 14,
  thorn: 15,
  secondwind: 30,
};
export function crownfallUpgradePrice(id: string, depth: number): number {
  const base = CROWNFALL_UPGRADE_PRICES[id] ?? 10;
  return Math.round(base * (1 + 0.05 * Math.max(0, depth - 1)));
}

/* The studio's rooms, in descent order; deeper floors cycle the list
   with the depth counter carrying the difficulty. */
export const CROWNFALL_FLOOR_NAMES = [
  "The Lobby",
  "The Beat Lab",
  "The Video Studio",
  "The Green Screen Stage",
  "The Mixing Room",
  "The Bucs Vault",
  "The Throne Room",
  "The Deep Vaults",
  "The Server Deep",
  "The Throne Steps",
] as const;

export function crownfallFloorName(depth: number): string {
  return CROWNFALL_FLOOR_NAMES[(depth - 1) % CROWNFALL_FLOOR_NAMES.length]!;
}

/* ── Drop-rail qualification ─────────────────────────────────────────────
   After a qualifying run the arcade checks the EXISTING Shark Drop rail
   (GET /api/retention/shark-drop). The rail itself decides — dice roll,
   ≤2 drops per rolling 7 days, retention prefs — the arcade never
   promises or mints Visual Bucs. Thresholds are purely a UX gate so
   throwaway runs don't burn the dice roll. */
export const DROP_QUALIFYING_SCORE: Record<ArcadeGameId, number> = {
  runner: 250,
  skeet: 1_500,
  /* Two rooms cleared with a real haul: reaching floor 3 is 300 depth
     points before a single coin or kill is counted. */
  crownfall: 500,
};

export const ARCADE_GAME_META: Record<
  ArcadeGameId,
  { title: string; tagline: string }
> = {
  runner: {
    title: "Shark King Endless Runner",
    tagline: "Ride the gold wave. Jump the crates, duck the banners, grab the Bucs.",
  },
  skeet: {
    title: "Royal Skeet",
    tagline: "Break the Plates — 45 seconds. Gold plates arc over the courtyard; shatter them mid-flight, build your streak, don't spray.",
  },
  crownfall: {
    title: "Crownfall Run",
    tagline: "Defend the studio. Bots and glitches are invading — clear each room, grab the gold Bucs coins, and take the golden door down. The Usurper waits every 5th floor.",
  },
};
