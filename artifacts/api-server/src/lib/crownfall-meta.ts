/**
 * crownfall-meta.ts — Crownfall Run prestige meta: the server half.
 *
 * The client's storage adapter (FE lib/crownfall-meta.ts) keeps the
 * member's prestige meta — tier, lifetime kills / boss kills, best
 * depth, earned achievements, last Royal Bounty day. This module is
 * the pure core of its server home (table: crownfall_meta, migration
 * 0336; routes: GET/PUT /api/arcade/crownfall/meta in
 * routes/crownfall.ts):
 *
 *  - sanitizeCrownfallMeta: any untrusted shape (a request body, a
 *    stored row) becomes a valid meta — tier clamped to [0, 10],
 *    counters floored at 0, achievements filtered to the known ids,
 *    the bounty day kept only when it is a YYYY-MM-DD string.
 *  - mergeCrownfallMeta: the MONOTONIC fold the PUT route applies —
 *    tier and lifetime counters take the max of stored and incoming,
 *    achievements union, the bounty day takes the later date. A
 *    stale device syncing late can therefore never roll a member's
 *    progress back, and two devices converge on the union of their
 *    play.
 *
 * Prestige is power + status only: nothing here touches a score or
 * a credit. The caps in lib/arcade-rules.ts ignore prestige by
 * design, and no Visual Bucs exist anywhere in this stack.
 */

export const CROWNFALL_TIER_CAP = 10;

export const CROWNFALL_ACHIEVEMENT_IDS = [
  "first-crown",
  "centurion",
  "deep-diver",
  "prestigious",
] as const;

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

const BOUNTY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function nonNegativeInt(v: unknown): number {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? n : 0;
}

export function sanitizeCrownfallMeta(raw: unknown): CrownfallMeta {
  if (!raw || typeof raw !== "object") return { ...CROWNFALL_META_DEFAULTS };
  const p = raw as Record<string, unknown>;
  const achievements = Array.isArray(p["achievements"])
    ? (p["achievements"] as unknown[]).filter(
        (a): a is string =>
          typeof a === "string" && (CROWNFALL_ACHIEVEMENT_IDS as readonly string[]).includes(a),
      )
    : [];
  return {
    tier: Math.min(CROWNFALL_TIER_CAP, nonNegativeInt(p["tier"])),
    lifetimeKills: nonNegativeInt(p["lifetimeKills"]),
    lifetimeBossKills: nonNegativeInt(p["lifetimeBossKills"]),
    bestDepth: nonNegativeInt(p["bestDepth"]),
    achievements: [...new Set(achievements)],
    lastBountyDay:
      typeof p["lastBountyDay"] === "string" && BOUNTY_DAY_RE.test(p["lastBountyDay"])
        ? p["lastBountyDay"]
        : "",
  };
}

/** The monotonic fold: progress only ever rises. Pure. */
export function mergeCrownfallMeta(stored: CrownfallMeta, incoming: CrownfallMeta): CrownfallMeta {
  return {
    tier: Math.max(stored.tier, incoming.tier),
    lifetimeKills: Math.max(stored.lifetimeKills, incoming.lifetimeKills),
    lifetimeBossKills: Math.max(stored.lifetimeBossKills, incoming.lifetimeBossKills),
    bestDepth: Math.max(stored.bestDepth, incoming.bestDepth),
    achievements: [...new Set([...stored.achievements, ...incoming.achievements])],
    /* "YYYY-MM-DD" strings order chronologically as plain text */
    lastBountyDay:
      stored.lastBountyDay > incoming.lastBountyDay ? stored.lastBountyDay : incoming.lastBountyDay,
  };
}
