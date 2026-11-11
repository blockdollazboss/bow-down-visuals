/* ─── Crownfall Run — prestige + lifetime meta (storage adapter) ──────
   Prestige is a meta-progression that persists between runs on the
   member's account: after any run in which a boss fell, the run-end
   screen offers PRESTIGE — bank the run, claim a tier. Each tier
   grants permanent stacking run bonuses: +5% bolt damage and +10%
   coins dropped per tier, capped at tier 10, plus a crown-pip mark
   in the HUD/summary and a gold trail that deepens with tier.

   PERSISTENCE GAP (flagged for the join, Nov 10, 2026): the arcade
   backend stores score ROWS only (arcadeScoresTable); GET
   /api/arcade/me derives per-game bests from those rows. There is NO
   persisted profile field to hang prestige, lifetime kills or
   achievements on, and this lane takes no migration number. So this
   adapter is the single seam: today it persists to the member's
   device (guarded localStorage, in-memory fallback when storage is
   unavailable or throws); when the join adds a server home, only
   this file changes — the game reads/writes meta exclusively
   through loadCrownfallMeta / saveCrownfallMeta.

   Score purity: prestige NEVER inflates submitted scores. The damage
   bonus only kills foes faster (kills are bounded by the foe supply)
   and the coin bonus drops SCRIP coins — a separate purse bucket
   that is spendable in the shop but never converts to score at run
   end. The daily Royal Bounty (+50 scrip on the first run of the
   day) rides the same scrip bucket for the same reason. The server
   caps in arcade-rules.ts therefore ignore prestige entirely, by
   design. Prestige never costs or pays Visual Bucs. */

export const PRESTIGE_TIER_CAP = 10;
export const PRESTIGE_DMG_PER_TIER = 0.05;
export const PRESTIGE_COIN_CHANCE_PER_TIER = 0.1;
export const ROYAL_BOUNTY_SCRIP = 50;

export interface CrownfallMeta {
  tier: number;
  lifetimeKills: number;
  lifetimeBossKills: number;
  bestDepth: number;
  achievements: string[];
  lastBountyDay: string; /* local date "YYYY-MM-DD" the bounty was claimed */
}

export const CROWNFALL_META_DEFAULTS: CrownfallMeta = {
  tier: 0,
  lifetimeKills: 0,
  lifetimeBossKills: 0,
  bestDepth: 0,
  achievements: [],
  lastBountyDay: "",
};

/* Bolt-damage multiplier for a prestige tier (tier 10 → ×1.5). */
export function prestigeDamageMult(tier: number): number {
  return 1 + PRESTIGE_DMG_PER_TIER * Math.min(Math.max(tier, 0), PRESTIGE_TIER_CAP);
}
/* Chance that any coin drop spawns an extra scrip coin alongside it
   (tier 10 → every drop is doubled, in scrip). */
export function prestigeCoinChance(tier: number): number {
  return PRESTIGE_COIN_CHANCE_PER_TIER * Math.min(Math.max(tier, 0), PRESTIGE_TIER_CAP);
}

/* ─── achievements: in-run + lifetime milestones ─────────────────────── */
export interface CrownfallAchievement {
  id: string;
  name: string;
  desc: string;
}
export const CROWNFALL_ACHIEVEMENTS: CrownfallAchievement[] = [
  { id: "first-crown", name: "First Crown", desc: "Defeat THE USURPER — any boss floor." },
  { id: "centurion", name: "Centurion", desc: "100 lifetime foes felled." },
  { id: "deep-diver", name: "Deep Diver", desc: "Reach floor 10 in a single run." },
  { id: "prestigious", name: "Prestigious", desc: "Earn a prestige tier." },
];

/* Which achievements a finished run earns, given the meta BEFORE the
   run is recorded. Pure — the caller records the run, then saves. */
export function achievementsEarnedBy(
  meta: CrownfallMeta,
  run: { kills: number; depth: number; bossKills: number },
): string[] {
  const earned: string[] = [];
  const has = (id: string) => meta.achievements.includes(id);
  if (!has("first-crown") && (run.bossKills > 0 || meta.lifetimeBossKills > 0)) earned.push("first-crown");
  if (!has("centurion") && meta.lifetimeKills + run.kills >= 100) earned.push("centurion");
  if (!has("deep-diver") && run.depth >= 10) earned.push("deep-diver");
  if (!has("prestigious") && meta.tier > 0) earned.push("prestigious");
  return earned;
}

/* Fold a finished run into the lifetime meta (does not save). */
export function recordRunInMeta(
  meta: CrownfallMeta,
  run: { kills: number; depth: number; bossKills: number },
): CrownfallMeta {
  const newly = achievementsEarnedBy(meta, run);
  return {
    ...meta,
    lifetimeKills: meta.lifetimeKills + run.kills,
    lifetimeBossKills: meta.lifetimeBossKills + run.bossKills,
    bestDepth: Math.max(meta.bestDepth, run.depth),
    achievements: [...meta.achievements, ...newly],
  };
}

/* ─── the adapter: guarded device storage + in-memory fallback ──────── */
const META_KEY = "bdv-crownfall-meta-v1";
const MUTE_KEY = "bdv-crownfall-muted-v1";
let memoryMeta: CrownfallMeta | null = null;
let memoryMuted: boolean | null = null;

function storageGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null; /* a hostile host must never break the game */
  }
}
function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    /* storage refused — the in-memory copy still carries the session */
  }
}

export function loadCrownfallMeta(): CrownfallMeta {
  if (memoryMeta) return memoryMeta;
  let meta: CrownfallMeta = { ...CROWNFALL_META_DEFAULTS };
  const raw = storageGet(META_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<CrownfallMeta>;
      meta = {
        tier: Math.min(PRESTIGE_TIER_CAP, Math.max(0, Math.floor(Number(parsed.tier) || 0))),
        lifetimeKills: Math.max(0, Math.floor(Number(parsed.lifetimeKills) || 0)),
        lifetimeBossKills: Math.max(0, Math.floor(Number(parsed.lifetimeBossKills) || 0)),
        bestDepth: Math.max(0, Math.floor(Number(parsed.bestDepth) || 0)),
        achievements: Array.isArray(parsed.achievements)
          ? parsed.achievements.filter((a): a is string => typeof a === "string")
          : [],
        lastBountyDay: typeof parsed.lastBountyDay === "string" ? parsed.lastBountyDay : "",
      };
    } catch {
      meta = { ...CROWNFALL_META_DEFAULTS };
    }
  }
  memoryMeta = meta;
  return meta;
}

export function saveCrownfallMeta(meta: CrownfallMeta): void {
  memoryMeta = meta;
  storageSet(META_KEY, JSON.stringify(meta));
}

/* Claim a prestige tier after a boss-beating run. Returns the new
   meta (tier +1, capped) — claiming at the cap is a no-op. */
export function claimPrestigeTier(meta: CrownfallMeta): CrownfallMeta {
  if (meta.tier >= PRESTIGE_TIER_CAP) return meta;
  const next: CrownfallMeta = { ...meta, tier: meta.tier + 1 };
  if (!next.achievements.includes("prestigious")) {
    next.achievements = [...next.achievements, "prestigious"];
  }
  return next;
}

/* The Royal Bounty: the first run each day starts with +50 scrip.
   Returns the scrip granted (0 when already claimed today) and the
   meta to save. `today` is a local "YYYY-MM-DD" string. */
export function claimRoyalBounty(meta: CrownfallMeta, today: string): { granted: number; meta: CrownfallMeta } {
  if (meta.lastBountyDay === today) return { granted: 0, meta };
  return { granted: ROYAL_BOUNTY_SCRIP, meta: { ...meta, lastBountyDay: today } };
}

/* ─── mute preference (persists with the meta seam) ─────────────────── */
export function loadCrownfallMuted(): boolean {
  if (memoryMuted !== null) return memoryMuted;
  memoryMuted = storageGet(MUTE_KEY) === "1";
  return memoryMuted;
}
export function saveCrownfallMuted(muted: boolean): void {
  memoryMuted = muted;
  storageSet(MUTE_KEY, muted ? "1" : "0");
}
