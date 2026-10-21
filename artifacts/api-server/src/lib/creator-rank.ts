/* ─── Creator Rank — stars as EARNED rank (owner ruling, 2026-10-17) ──────
   "Make stars earned rank."

   Creator Level stars used to be a self-picked difficulty dial persisted
   in the browser (localStorage) and merely capped by plan tier — anyone
   could call themselves 6 stars, and the level-celebration rails recorded
   whatever the client claimed. This module replaces that with truth: the
   ONLY source of a creator's stars is this server computation over work
   that is actually recorded in the database.

   THE LADDER (single source of truth — thresholds and weights live here
   and nowhere else):

     source                table truth                                   pts/unit  cap
     ────────────────────  ────────────────────────────────────────────  ────────  ───
     published tracks      profile_tracks.is_published (via profiles)       10     300
     published videos      profile_videos.is_published (via profiles)       15     300
     completed exports     export_jobs.state = 'done'                        5     150
     followers             follows (rows on the creator's profiles)          1     200
     streams hosted        live_streams rows for the user                   10     100
     tips received         tip_jar_tips paid + live_stream_tips credited
                           + world_stage_tips credited                       5     100
     store/shop sales      store_orders completed + shop_events 'sale'      20     400
     memberships sold      fan_members paid joins (stripe session set)      25     500
     ────────────────────  max attainable points: 2,050

     ★1 Street Punk    0 pts — every signed-up creator starts here
     ★2 Hustler       25 pts — first real outputs (e.g. first track + first video)
     ★3 Gangster     100 pts — a small body of published work
     ★4 Shot Caller  300 pts — a real catalog + audience forming
     ★5 Crime Boss   700 pts AND ≥ 3 business results (sales + paid members)
     ★6 Kingpin    1,400 pts AND ≥ 10 business results AND ≥ 20 published works

   HARD RULES
   - Rank is NEVER purchasable. No source counts spending, credit packs,
     plan tier, or balances. Money only enters as *results other people
     paid for* (a sale, a paid membership, a paid tip) — outcomes of work,
     not purchases by the creator.
   - Only recorded work counts. A generated-but-unpublished song earns
     nothing: publishing is the bar. Unpublished generations have no
     durable per-user ledger (creation streaks store days, not counts),
     so they are deliberately not a source.
   - Stars are sequential: a level is held only when its points threshold
     AND its gate are met; gates at ★5/★6 keep business results mandatory
     no matter how large the catalog grows.
*/

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/* ── The ladder ─────────────────────────────────────────────────────────── */

export type RankSourceKey =
  | "publishedTracks"
  | "publishedVideos"
  | "exports"
  | "followers"
  | "streamsHosted"
  | "tipsReceived"
  | "sales"
  | "membershipsSold";

export interface RankSourceDef {
  key: RankSourceKey;
  label: string;
  pointsPerUnit: number;
  pointsCap: number;
}

export const RANK_SOURCES: readonly RankSourceDef[] = [
  { key: "publishedTracks", label: "Published tracks", pointsPerUnit: 10, pointsCap: 300 },
  { key: "publishedVideos", label: "Published videos", pointsPerUnit: 15, pointsCap: 300 },
  { key: "exports", label: "Completed exports", pointsPerUnit: 5, pointsCap: 150 },
  { key: "followers", label: "Followers", pointsPerUnit: 1, pointsCap: 200 },
  { key: "streamsHosted", label: "Streams hosted", pointsPerUnit: 10, pointsCap: 100 },
  { key: "tipsReceived", label: "Tips received", pointsPerUnit: 5, pointsCap: 100 },
  { key: "sales", label: "Store & shop sales", pointsPerUnit: 20, pointsCap: 400 },
  { key: "membershipsSold", label: "Memberships sold", pointsPerUnit: 25, pointsCap: 500 },
] as const;

/** Points required to HOLD each star level (index 0 = ★1). */
export const STAR_POINT_THRESHOLDS: readonly number[] = [0, 25, 100, 300, 700, 1400] as const;

/** The ladder's names (index 0 = ★1) — the one place they are
 *  written. Every surface that names a rank (nameplates, the
 *  Creator Room evolution read, the teams gate) reads them from
 *  here; a second copy anywhere is a bug. */
export const STAR_TITLES: readonly string[] = [
  "Street Punk",
  "Hustler",
  "Gangster",
  "Shot Caller",
  "Crime Boss",
  "Kingpin",
] as const;

/** The title for a star count, clamped to the ladder — an
 *  out-of-range count reads as the nearest real rung, never a
 *  blank. */
export function starTitle(stars: number): string {
  const idx = Math.min(STAR_TITLES.length, Math.max(1, Math.floor(stars) || 1)) - 1;
  return STAR_TITLES[idx]!;
}

/** Non-points gates per star level (index 0 = ★1). Business results =
 *  sales + memberships sold; published works = tracks + videos. */
export const STAR_GATES: ReadonlyArray<{
  businessResults?: number;
  publishedWorks?: number;
}> = [
  {},
  {},
  {},
  {},
  { businessResults: 3 },
  { businessResults: 10, publishedWorks: 20 },
] as const;

export type RankCounts = Record<RankSourceKey, number>;

export const EMPTY_RANK_COUNTS: RankCounts = {
  publishedTracks: 0,
  publishedVideos: 0,
  exports: 0,
  followers: 0,
  streamsHosted: 0,
  tipsReceived: 0,
  sales: 0,
  membershipsSold: 0,
};

export interface RankGateStatus {
  key: "businessResults" | "publishedWorks";
  label: string;
  have: number;
  need: number;
  met: boolean;
}

export interface RankResult {
  stars: number;
  points: number;
  counts: RankCounts;
  /** Points contributed per source (after caps). */
  breakdown: Record<RankSourceKey, number>;
  businessResults: number;
  publishedWorks: number;
  /** What stands between the creator and the next star; null at ★6. */
  next: {
    stars: number;
    pointsAt: number;
    pointsNeeded: number;
    gates: RankGateStatus[];
  } | null;
  /** Plain-language next steps, most valuable first. */
  hints: string[];
}

/* ── Pure computation ───────────────────────────────────────────────────── */

export function pointsForSource(key: RankSourceKey, units: number): number {
  const def = RANK_SOURCES.find((s) => s.key === key)!;
  const n = Number.isFinite(units) && units > 0 ? Math.floor(units) : 0;
  return Math.min(def.pointsCap, n * def.pointsPerUnit);
}

function gateStatus(level: number, counts: RankCounts): RankGateStatus[] {
  const gate = STAR_GATES[level - 1] ?? {};
  const business = counts.sales + counts.membershipsSold;
  const works = counts.publishedTracks + counts.publishedVideos;
  const out: RankGateStatus[] = [];
  if (gate.businessResults != null) {
    out.push({
      key: "businessResults",
      label: "sales or paid memberships",
      have: business,
      need: gate.businessResults,
      met: business >= gate.businessResults,
    });
  }
  if (gate.publishedWorks != null) {
    out.push({
      key: "publishedWorks",
      label: "published tracks or videos",
      have: works,
      need: gate.publishedWorks,
      met: works >= gate.publishedWorks,
    });
  }
  return out;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function hintsFor(counts: RankCounts, next: RankResult["next"]): string[] {
  if (!next) return ["Top rank — every star is earned."];
  const hints: string[] = [];
  /* Unmet gates first: they are hard blocks, points alone won't open them. */
  for (const g of next.gates) {
    if (g.met) continue;
    const missing = g.need - g.have;
    if (g.key === "businessResults") {
      hints.push(
        `Make ${missing} more ${plural(missing, "sale or paid membership", "sales or paid memberships")} — ★${next.stars} requires ${g.need} business results`,
      );
    } else {
      hints.push(
        `Publish ${missing} more ${plural(missing, "track or video", "tracks or videos")} — ★${next.stars} requires ${g.need} published works`,
      );
    }
  }
  if (next.pointsNeeded > 0) {
    hints.push(
      `Earn ${next.pointsNeeded} more rank points — points come from publishing, exporting, sales, memberships, followers, streams and tips`,
    );
    /* Point at the cheapest unfinished wins by name. */
    if (counts.publishedTracks === 0) hints.push("Publish your first track (+10 points)");
    if (counts.publishedVideos === 0) hints.push("Publish your first video (+15 points)");
    if (counts.exports === 0) hints.push("Complete your first export (+5 points)");
    if (counts.streamsHosted === 0) hints.push("Host your first live stream (+10 points)");
  }
  return hints;
}

/** The whole ladder, pure: counts in, rank out. */
export function rankFromCounts(counts: RankCounts): RankResult {
  const breakdown = {} as Record<RankSourceKey, number>;
  let points = 0;
  for (const def of RANK_SOURCES) {
    const pts = pointsForSource(def.key, counts[def.key] ?? 0);
    breakdown[def.key] = pts;
    points += pts;
  }

  let stars = 1;
  for (let lvl = 2; lvl <= 6; lvl++) {
    if (points < STAR_POINT_THRESHOLDS[lvl - 1]!) break;
    if (gateStatus(lvl, counts).some((g) => !g.met)) break;
    stars = lvl;
  }

  const businessResults = counts.sales + counts.membershipsSold;
  const publishedWorks = counts.publishedTracks + counts.publishedVideos;

  let next: RankResult["next"] = null;
  if (stars < 6) {
    const target = stars + 1;
    next = {
      stars: target,
      pointsAt: STAR_POINT_THRESHOLDS[target - 1]!,
      pointsNeeded: Math.max(0, STAR_POINT_THRESHOLDS[target - 1]! - points),
      gates: gateStatus(target, counts),
    };
  }

  return {
    stars,
    points,
    counts: { ...counts },
    breakdown,
    businessResults,
    publishedWorks,
    next,
    hints: hintsFor(counts, next),
  };
}

/* ── Server computation over recorded work ──────────────────────────────── */

/**
 * One round trip: every source counted in a single statement over the
 * caller's own rows (profile-scoped sources join through
 * creator_profiles, exactly like the earnings board reads them).
 * Raw SQL through db.execute, the house pattern for aggregate reads.
 */
export async function countRankSources(userId: string): Promise<RankCounts> {
  const res = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM profile_tracks pt
         JOIN creator_profiles cp ON cp.id = pt.profile_id
         WHERE cp.user_id = ${userId} AND pt.is_published) AS published_tracks,
      (SELECT COUNT(*)::int FROM profile_videos pv
         JOIN creator_profiles cp ON cp.id = pv.profile_id
         WHERE cp.user_id = ${userId} AND pv.is_published) AS published_videos,
      (SELECT COUNT(*)::int FROM export_jobs
         WHERE user_id = ${userId} AND state = 'done') AS exports_done,
      (SELECT COUNT(*)::int FROM follows f
         JOIN creator_profiles cp ON cp.id = f.profile_id
         WHERE cp.user_id = ${userId}) AS followers,
      (SELECT COUNT(*)::int FROM live_streams
         WHERE user_id = ${userId}) AS streams_hosted,
      (SELECT COUNT(*)::int FROM tip_jar_tips
         WHERE page_user_id = ${userId} AND status = 'paid') AS jar_tips,
      (SELECT COUNT(*)::int FROM live_stream_tips
         WHERE creator_user_id = ${userId} AND creator_credited_at IS NOT NULL) AS stream_tips,
      (SELECT COUNT(*)::int FROM world_stage_tips
         WHERE to_user_id = ${userId} AND creator_credited_at IS NOT NULL) AS stage_tips,
      (SELECT COUNT(*)::int FROM store_orders o
         JOIN creator_profiles cp ON cp.id = o.profile_id
         WHERE cp.user_id = ${userId} AND o.status = 'completed') AS store_sales,
      (SELECT COUNT(*)::int FROM shop_events
         WHERE user_id = ${userId} AND event_type = 'sale') AS shop_sales,
      (SELECT COUNT(*)::int FROM fan_members
         WHERE user_id = ${userId} AND stripe_session_id IS NOT NULL
           AND status IN ('active', 'trialing', 'past_due')) AS memberships_sold
  `);
  const row = (res.rows as any[])[0] ?? {};
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    publishedTracks: n(row.published_tracks),
    publishedVideos: n(row.published_videos),
    exports: n(row.exports_done),
    followers: n(row.followers),
    streamsHosted: n(row.streams_hosted),
    tipsReceived: n(row.jar_tips) + n(row.stream_tips) + n(row.stage_tips),
    sales: n(row.store_sales) + n(row.shop_sales),
    membershipsSold: n(row.memberships_sold),
  };
}

/* Short in-process memo: rank is read at the World door, on dashboard
 * loads, and by the nameplate rails — the underlying counts change only
 * when the creator works, so a 60 s window keeps reads cheap without
 * ever showing a stale rank for long. */
const RANK_CACHE_TTL_MS = 60_000;
const rankCache = new Map<string, { at: number; rank: RankResult }>();

export function clearCreatorRankCache(userId?: string): void {
  if (userId) rankCache.delete(userId);
  else rankCache.clear();
}

export async function getCreatorRank(userId: string): Promise<RankResult> {
  const hit = rankCache.get(userId);
  if (hit && Date.now() - hit.at < RANK_CACHE_TTL_MS) return hit.rank;
  const counts = await countRankSources(userId);
  const rank = rankFromCounts(counts);
  rankCache.set(userId, { at: Date.now(), rank });
  return rank;
}

/** Earned stars only — the drop-in truth behind every stars read. */
export async function getCreatorStars(userId: string): Promise<number> {
  try {
    return (await getCreatorRank(userId)).stars;
  } catch (err) {
    logger.warn({ err, userId }, "[creator-rank] stars computation failed — reading as ★1");
    return 1;
  }
}
