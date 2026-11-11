/* ─── Crownfall Run — prestige + lifetime meta (storage adapter) ──────
   Prestige is a meta-progression that persists between runs on the
   member's account: after any run in which a boss fell, the run-end
   screen offers PRESTIGE — bank the run, claim a tier. Each tier
   grants permanent stacking run bonuses: +5% bolt damage and +10%
   coins dropped per tier, capped at tier 10, plus a crown-pip mark
   in the HUD/summary and a gold trail that deepens with tier.

   PERSISTENCE (gap closed by join19, migration 0336): the meta's
   home is the member's ACCOUNT — table crownfall_meta, routes
   GET/PUT /api/arcade/crownfall/meta. This adapter stays the single
   seam the game reads/writes through: the device copy (guarded
   localStorage, in-memory fallback) is the cache and the offline
   fallback, and every save also flushes to the account; on mount
   the game syncs — the account's stored meta and the device's are
   folded MONOTONICALLY (progress only ever rises, on both sides),
   so two devices converge and a stale one can never roll a tier
   back. The sync state is observable (getCrownfallMetaSyncState /
   subscribeCrownfallMetaSync): when a save cannot reach the account
   the state says "error" and the UI tells the member their prestige
   lives on this device only — a failed save is NEVER dressed up as
   persisted. Signed-out play stays device-only by design: there is
   no account to save to, and the state stays "idle".

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

const ACHIEVEMENT_IDS: ReadonlySet<string> = new Set(CROWNFALL_ACHIEVEMENTS.map((a) => a.id));

/** Any untrusted shape (a stored blob, a server response) becomes a
 *  valid meta — the same rules the server applies: tier clamped to
 *  the cap, counters floored at 0, achievements filtered to the
 *  known ids. A hand-edited or stale blob can never crash the game
 *  or inflate a tier. */
export function sanitizeCrownfallMeta(parsed: unknown): CrownfallMeta {
  if (!parsed || typeof parsed !== "object") return { ...CROWNFALL_META_DEFAULTS };
  const p = parsed as Record<string, unknown>;
  return {
    tier: Math.min(PRESTIGE_TIER_CAP, Math.max(0, Math.floor(Number(p["tier"]) || 0))),
    lifetimeKills: Math.max(0, Math.floor(Number(p["lifetimeKills"]) || 0)),
    lifetimeBossKills: Math.max(0, Math.floor(Number(p["lifetimeBossKills"]) || 0)),
    bestDepth: Math.max(0, Math.floor(Number(p["bestDepth"]) || 0)),
    achievements: Array.isArray(p["achievements"])
      ? [...new Set((p["achievements"] as unknown[]).filter(
          (a): a is string => typeof a === "string" && ACHIEVEMENT_IDS.has(a),
        ))]
      : [],
    lastBountyDay: typeof p["lastBountyDay"] === "string" ? (p["lastBountyDay"] as string) : "",
  };
}

/** The monotonic fold — progress only ever rises: tier and lifetime
 *  counters take the max, achievements union, the bounty day takes
 *  the later date. Mirrors the server's merge exactly. Pure. */
export function mergeCrownfallMeta(a: CrownfallMeta, b: CrownfallMeta): CrownfallMeta {
  return {
    tier: Math.max(a.tier, b.tier),
    lifetimeKills: Math.max(a.lifetimeKills, b.lifetimeKills),
    lifetimeBossKills: Math.max(a.lifetimeBossKills, b.lifetimeBossKills),
    bestDepth: Math.max(a.bestDepth, b.bestDepth),
    achievements: [...new Set([...a.achievements, ...b.achievements])],
    lastBountyDay: a.lastBountyDay > b.lastBountyDay ? a.lastBountyDay : b.lastBountyDay,
  };
}

export function loadCrownfallMeta(): CrownfallMeta {
  if (memoryMeta) return memoryMeta;
  let meta: CrownfallMeta = { ...CROWNFALL_META_DEFAULTS };
  const raw = storageGet(META_KEY);
  if (raw) {
    try {
      meta = sanitizeCrownfallMeta(JSON.parse(raw));
    } catch {
      meta = { ...CROWNFALL_META_DEFAULTS };
    }
  }
  memoryMeta = meta;
  return meta;
}

/** Persist the meta — memory + device storage immediately, plus a
 *  flush to the account when the auth seam is configured (the
 *  flush's outcome lands in the sync state; see the header). */
export function saveCrownfallMeta(meta: CrownfallMeta): void {
  memoryMeta = meta;
  storageSet(META_KEY, JSON.stringify(meta));
  if (tokenGetter) void flushCrownfallMeta();
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

/* ─── account sync (join19): the server home behind the adapter ─────── */
export type CrownfallMetaSyncState = "idle" | "syncing" | "synced" | "error";

const META_API_PATH = "/api/arcade/crownfall/meta";
let tokenGetter: (() => Promise<string | null>) | null = null;
let syncState: CrownfallMetaSyncState = "idle";
const syncListeners = new Set<(s: CrownfallMetaSyncState) => void>();
const metaListeners = new Set<(m: CrownfallMeta) => void>();

/** The game hands the adapter its session token getter once (the
 *  AuthContext's getAccessToken). Null detaches the seam — device
 *  storage only, state stays "idle". */
export function configureCrownfallMetaAuth(getter: (() => Promise<string | null>) | null): void {
  tokenGetter = getter;
}

export function getCrownfallMetaSyncState(): CrownfallMetaSyncState {
  return syncState;
}
export function subscribeCrownfallMetaSync(fn: (s: CrownfallMetaSyncState) => void): () => void {
  syncListeners.add(fn);
  return () => { syncListeners.delete(fn); };
}
/** Fires when a sync adopts a meta that is ahead of the device copy
 *  (e.g. progress made on another device) so the game can refresh. */
export function subscribeCrownfallMeta(fn: (m: CrownfallMeta) => void): () => void {
  metaListeners.add(fn);
  return () => { metaListeners.delete(fn); };
}

function setSyncState(next: CrownfallMetaSyncState): void {
  if (syncState === next) return;
  syncState = next;
  for (const fn of [...syncListeners]) {
    try { fn(next); } catch { /* a listener must never break sync */ }
  }
}

function adoptMeta(meta: CrownfallMeta): void {
  memoryMeta = meta;
  storageSet(META_KEY, JSON.stringify(meta));
  for (const fn of [...metaListeners]) {
    try { fn(meta); } catch { /* a listener must never break sync */ }
  }
}

/** One meta request. Resolves null when signed out (no account to
 *  sync with — device-only is the honest state, NOT an error);
 *  rejects on any transport/HTTP failure so callers can mark the
 *  sync "error" instead of pretending the save landed. */
async function requestMeta(method: "GET" | "PUT", body?: CrownfallMeta): Promise<CrownfallMeta | null> {
  if (!tokenGetter) return null;
  const token = await tokenGetter().catch(() => null);
  if (!token) return null;
  const res = await fetch(META_API_PATH, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`crownfall meta ${method} → ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { meta?: unknown };
  return sanitizeCrownfallMeta(data.meta ?? {});
}

/** Pull the account's meta in and fold it with the device copy.
 *  When the device holds progress the account lacks, the fold is
 *  uploaded so the account becomes the union. Resolves with the
 *  merged truth either way; on failure the device copy stands and
 *  the sync state says "error" — nothing is faked. */
export async function syncCrownfallMetaFromServer(): Promise<CrownfallMeta> {
  const local = loadCrownfallMeta();
  if (!tokenGetter) return local;
  setSyncState("syncing");
  try {
    const server = await requestMeta("GET");
    if (server === null) {
      setSyncState("idle"); /* signed out — device-only */
      return local;
    }
    let merged = mergeCrownfallMeta(server, local);
    if (JSON.stringify(merged) !== JSON.stringify(server)) {
      const after = await requestMeta("PUT", merged);
      if (after) merged = mergeCrownfallMeta(merged, after);
    }
    adoptMeta(merged);
    setSyncState("synced");
    return merged;
  } catch {
    setSyncState("error");
    return local;
  }
}

let flushInFlight: Promise<void> | null = null;
let flushDirty = false;

/** Push the device copy to the account (the route folds it
 *  monotonically and returns the merged truth, which is adopted
 *  locally when it is ahead). Coalesced: saves during a flush mark
 *  it dirty and re-flush once. */
async function flushCrownfallMeta(): Promise<void> {
  if (flushInFlight) {
    flushDirty = true;
    return flushInFlight;
  }
  const run = (async () => {
    setSyncState("syncing");
    try {
      const after = await requestMeta("PUT", loadCrownfallMeta());
      if (after === null) {
        setSyncState("idle"); /* signed out — device-only */
        return;
      }
      const local = loadCrownfallMeta();
      const merged = mergeCrownfallMeta(local, after);
      if (JSON.stringify(merged) !== JSON.stringify(local)) adoptMeta(merged);
      setSyncState("synced");
    } catch {
      /* the device copy stands, LABELED unsynced — never fake-persisted */
      setSyncState("error");
    }
  })();
  flushInFlight = run;
  try {
    await run;
  } finally {
    flushInFlight = null;
    if (flushDirty) {
      flushDirty = false;
      void flushCrownfallMeta();
    }
  }
}
