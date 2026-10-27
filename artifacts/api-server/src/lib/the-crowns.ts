/**
 * the-crowns.ts — The Crowns (N8): the YEARLY house awards, held
 * in the World and on the site. An UPGRADE of the court seasons
 * (lib/world-court-season — monthly, World-scoped, season marks),
 * the Winners' Circle (lib/world-contests) and the Challenges
 * Hall of Fame. Delta ONLY: the yearly roll-up — published award
 * categories, the year decided by platform records across the
 * site + the World, and winners wearing a crown on their profiles
 * for a year. No new season engine, no new contest engine, no new
 * rank ladder is built here — everything stands on the existing
 * ones.
 *
 * THE YEAR (deterministic, no admin panel): an awards year is one
 * UTC calendar year. The first decidable year is 2026 — the year
 * the palace game layer opened. The Crowns of year Y are decided
 * at the year's turn (the first tick on/after Jan 1 of Y+1) and
 * the winners wear their crowns through year Y+1.
 *
 * REAL NUMBERS DECIDE (anti-fake, absolute): every category is a
 * published, fixed metric over lib/creator-rank's own sources —
 * the exact counts countRankSources reads (published tracks and
 * videos, completed exports, followers, streams hosted, tips
 * received, store/shop sales, memberships sold) — windowed to the
 * year through the court-season store's windowed read, the same
 * sources and conditions with the year's span on each event
 * timestamp. The site's records and the World's records are the
 * same tables (World stage tips are one of the tip sources), so
 * the roll-up covers both by construction. There are no votes to
 * stuff and no estimates to argue with: a category's winner is
 * the top of a total, deterministic ranking (metric, then ladder
 * points, then business results, then published works, then user
 * id), and a category nobody scored in all year crowns nobody —
 * an honest absence, never an invented winner.
 *
 * THE DECIDING: the scheduler (30 s tick, the court-season
 * shape) freezes the year's awards into house_crown_years
 * (provisional migration 0283_the_crowns) and heralds the court
 * through the palace announce channel, aimed at the Royal Court
 * Chamber — where the Crowns are held in the World; the same
 * frozen record serves the site read (routes/the-crowns).
 * IDEMPOTENCY IS STRUCTURAL: year is the table's primary key —
 * the insert is on-conflict-do-nothing, a re-run deciding changes
 * nothing, and the herald fires only for the tick that actually
 * inserted the row, so it fires exactly once. A year nobody
 * scored in still records its (winner-less) row — the record
 * stays honest — but no herald sounds for an empty court.
 *
 * THE CROWN: wearing is a read over the frozen rows — a creator
 * wears the crowns whose expiresAt is still ahead (Jan 1 of
 * year+2). No profile column, no cache to drift: the award IS
 * the crown, and it comes off by itself when the year turns.
 * Crowns are honor, not money: no VB moves anywhere in this
 * module.
 *
 * Everything DB-shaped sits behind CrownsStore so the deciding
 * and the scheduler are unit-tested against fakes; the route
 * layer wires the db store.
 */
import { sql } from "drizzle-orm";
import {
  db,
  type CrownAward,
  type HouseCrownYear as CrownYearRow,
} from "@workspace/db";
import {
  rankFromCounts,
  starTitle,
  type RankCounts,
} from "./creator-rank";
import {
  COURT_CHAMBER_ROOM_ID,
  COURT_CHAMBER_ROOM_NAME,
  dbCourtSeasonStore,
  type SeasonStandingInput,
} from "./world-court-season";
import type { PalaceAnnouncement } from "./world-room";
import { logger } from "./logger";

export type { CrownAward, CrownCategoryStanding } from "@workspace/db";

/** The crowns' tick — the court-season cadence. */
export const CROWNS_TICK_MS = 30_000;

/** The first year The Crowns can decide: the year the palace
 *  game layer opened (the court-season epoch year). */
export const CROWNS_EPOCH_YEAR = 2026;

/** How deep each category's frozen record keeps its court. */
export const CROWN_CATEGORY_STANDINGS_NAMED = 5;

/** How many winners the deciding herald names at most. */
export const CROWN_HERALD_NAMED = 7;

/* ── The year (pure) ────────────────────────────────────────────── */

export interface CrownYearInfo {
  /** 2026 — the record's primary key. */
  year: number;
  /** "crowns-2026". */
  crownKey: string;
  /** "The Crowns of 2026". */
  name: string;
  /** First instant of the year (UTC Jan 1, inclusive). */
  startsAt: Date;
  /** First instant of the NEXT year (exclusive bound) — also the
   *  earliest instant the year's crowns can be decided. */
  endsAt: Date;
  /** When the winners' profile crowns come off: Jan 1 of year+2.
   *  A crown is worn for the year after the win. */
  crownsExpireAt: Date;
}

export function crownYearSpan(year: number): CrownYearInfo {
  const y = Math.floor(year) || CROWNS_EPOCH_YEAR;
  return {
    year: y,
    crownKey: `crowns-${y}`,
    name: `The Crowns of ${y}`,
    startsAt: new Date(Date.UTC(y, 0, 1)),
    endsAt: new Date(Date.UTC(y + 1, 0, 1)),
    crownsExpireAt: new Date(Date.UTC(y + 2, 0, 1)),
  };
}

/** The awards year a moment belongs to (its UTC calendar year). */
export function crownYearForDate(now: Date): CrownYearInfo {
  return crownYearSpan(now.getUTCFullYear());
}

/* ── The published categories (pure, fixed) ─────────────────────── */

export interface CrownCategory {
  key: string;
  title: string;
  /** What the number counts, in plain words — published with the
   *  category so creators know what they're chasing. */
  blurb: string;
  /** The unit the deciding number counts. */
  metricLabel: string;
  /** The deciding number, from the ladder's own counts. */
  metric: (counts: RankCounts) => number;
}

/**
 * THE PUBLISHED CATEGORIES — fixed in code and served verbatim by
 * GET /api/crowns, so the list creators chase is the list the
 * deciding runs. Order is the herald's order: the headline crown
 * first. Every metric is one of the ladder's real sources (or the
 * ladder's own points) — a metric the platform can't support
 * doesn't appear, rather than appearing estimated.
 */
export const CROWN_CATEGORIES: readonly CrownCategory[] = [
  {
    key: "creator-of-the-year",
    title: "Creator of the Year",
    blurb: "The highest earned-rank score of the year, across every record the house keeps.",
    metricLabel: "rank points",
    metric: (c) => rankFromCounts(c).points,
  },
  {
    key: "top-seller",
    title: "Top Seller",
    blurb: "The most store and shop sales of the year.",
    metricLabel: "sales",
    metric: (c) => c.sales,
  },
  {
    key: "membership-magnet",
    title: "Membership Magnet",
    blurb: "The most memberships sold of the year.",
    metricLabel: "memberships sold",
    metric: (c) => c.membershipsSold,
  },
  {
    key: "most-prolific",
    title: "Most Prolific",
    blurb: "The most works published of the year — tracks and videos together.",
    metricLabel: "works published",
    metric: (c) => c.publishedTracks + c.publishedVideos,
  },
  {
    key: "top-streamer",
    title: "Top Streamer",
    blurb: "The most streams hosted of the year.",
    metricLabel: "streams hosted",
    metric: (c) => c.streamsHosted,
  },
  {
    key: "most-tipped",
    title: "Most Tipped",
    blurb: "The most tips received of the year — tip jar, streams and the World stage together.",
    metricLabel: "tips received",
    metric: (c) => c.tipsReceived,
  },
  {
    key: "audience-magnet",
    title: "Audience Magnet",
    blurb: "The most new followers of the year.",
    metricLabel: "new followers",
    metric: (c) => c.followers,
  },
] as const;

export function crownCategory(key: string): CrownCategory | null {
  return CROWN_CATEGORIES.find((c) => c.key === key) ?? null;
}

/* ── Category standings (pure ranking over windowed counts) ─────── */

export interface RankedCrownEntry {
  userId: string;
  displayName: string;
  slug: string;
  metric: number;
  points: number;
  businessResults: number;
  publishedWorks: number;
}

/**
 * Rank one category over the year's windowed counts: the
 * category's metric decides, and the order is total and
 * deterministic — metric, then the ladder's points, then
 * business results, then published works, then user id — so a
 * tie at the deciding freezes the same way every time it is
 * computed. Only creators who scored in the category stand.
 */
export function rankCrownCategory(
  inputs: SeasonStandingInput[],
  category: CrownCategory,
): RankedCrownEntry[] {
  const ranked = inputs
    .map((i) => {
      const rank = rankFromCounts(i.counts);
      return {
        userId: i.userId,
        displayName: i.displayName,
        slug: i.slug,
        metric: category.metric(i.counts),
        points: rank.points,
        businessResults: rank.businessResults,
        publishedWorks: rank.publishedWorks,
      };
    })
    .filter((e) => e.metric > 0);
  ranked.sort(
    (a, b) =>
      b.metric - a.metric ||
      b.points - a.points ||
      b.businessResults - a.businessResults ||
      b.publishedWorks - a.publishedWorks ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return ranked;
}

/* ── The herald (pure) ──────────────────────────────────────────── */

/**
 * The deciding ceremony's announcement — built only from the
 * frozen awards. Every crowned winner is named with their
 * category (up to CROWN_HERALD_NAMED); a winner-less year is
 * never heralded (the scheduler stays silent), so this text is
 * only built when at least one crown landed.
 */
export function crownsHeraldText(info: CrownYearInfo, awards: CrownAward[]): string {
  const crowned = awards.filter((a) => a.winnerUserId !== null);
  const parts: string[] = [
    `${info.name} are decided — the year's records have spoken, and the crowns are placed.`,
  ];
  for (const award of crowned.slice(0, CROWN_HERALD_NAMED)) {
    parts.push(`${award.categoryTitle}: ${award.displayName}.`);
  }
  parts.push(
    `The crowned wear their crowns on their profiles for the year. See every placement in the ${COURT_CHAMBER_ROOM_NAME}.`,
  );
  return parts.join(" ");
}

/* ── The store ──────────────────────────────────────────────────── */

export interface CrownsStore {
  /** The frozen deciding for a year, if it has been decided. */
  getYear(year: number): Promise<CrownYearRow | null>;
  /** Every decided year, newest first — the record. */
  listYears(): Promise<CrownYearRow[]>;
  /** Record a deciding. Returns false when the year already has
   *  its row (a twin tick decided first) — the caller then stays
   *  silent: one year, one deciding, one herald. */
  markDecided(row: {
    year: number;
    crownKey: string;
    name: string;
    startsAt: Date;
    endsAt: Date;
    decidedAt: Date;
    awards: CrownAward[];
    heraldText: string;
  }): Promise<boolean>;
  /** Every named, non-official creator's ladder counts WINDOWED
   *  to [start, end) — the court-season store's windowed read,
   *  reused untouched: the same sources, the same conditions,
   *  the year's span on each source's event timestamp. */
  yearStandings(start: Date, end: Date): Promise<SeasonStandingInput[]>;
  /** The creator's lifetime earned rank (the ladder, unwindowed)
   *  — the stars/title frozen onto their award at the deciding. */
  lifetimeRank(userId: string): Promise<{ stars: number; title: string }>;
}

function yearFromRaw(row: any): CrownYearRow {
  return {
    year: Number(row.year),
    crownKey: String(row.crown_key),
    name: String(row.name),
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    decidedAt: new Date(row.decided_at),
    awards: Array.isArray(row.awards) ? row.awards : [],
    heraldText: typeof row.herald_text === "string" ? row.herald_text : "",
  } as CrownYearRow;
}

export const dbCrownsStore: CrownsStore = {
  async getYear(year) {
    const res = await db.execute(sql`
      SELECT year, crown_key, name, starts_at, ends_at, decided_at, awards, herald_text
      FROM house_crown_years
      WHERE year = ${year}
      LIMIT 1
    `);
    const row = (res.rows as any[])[0];
    return row ? yearFromRaw(row) : null;
  },

  async listYears() {
    const res = await db.execute(sql`
      SELECT year, crown_key, name, starts_at, ends_at, decided_at, awards, herald_text
      FROM house_crown_years
      ORDER BY year DESC
    `);
    return (res.rows as any[]).map(yearFromRaw);
  },

  async markDecided(row) {
    const inserted = await db.execute(sql`
      INSERT INTO house_crown_years
        (year, crown_key, name, starts_at, ends_at, decided_at, awards, herald_text)
      VALUES (
        ${row.year}, ${row.crownKey}, ${row.name},
        ${row.startsAt.toISOString()}::timestamptz, ${row.endsAt.toISOString()}::timestamptz,
        ${row.decidedAt.toISOString()}::timestamptz, ${JSON.stringify(row.awards)}::jsonb,
        ${row.heraldText}
      )
      ON CONFLICT DO NOTHING
      RETURNING year
    `);
    return (inserted.rows as any[]).length > 0;
  },

  /* The windowed counts and the lifetime rank are the court
   * season store's own reads, reused verbatim — one windowing of
   * the ladder's sources exists in the codebase, and this is it. */
  yearStandings: (start, end) => dbCourtSeasonStore.seasonStandings(start, end),
  lifetimeRank: (userId) => dbCourtSeasonStore.lifetimeRank(userId),
};

/* ── The deciding ───────────────────────────────────────────────── */

export interface CrownDecideOutcome {
  /** True only for the deciding that inserted the row — the one
   *  that may herald. False = the year was already decided (or a
   *  twin decided it first); the record stands untouched. */
  inserted: boolean;
  awards: CrownAward[];
  heraldText: string;
}

/** Freeze one category: rank the year's counts, take the winner
 *  (nobody, when the category scored zero all year), and attach
 *  the winner's lifetime earned rank at the deciding. A failed
 *  rank read degrades the winner's mark to ★1 rather than failing
 *  the whole deciding. */
async function decideCategory(
  store: CrownsStore,
  info: CrownYearInfo,
  inputs: SeasonStandingInput[],
  category: CrownCategory,
): Promise<CrownAward> {
  const ranked = rankCrownCategory(inputs, category);
  const top = ranked.slice(0, CROWN_CATEGORY_STANDINGS_NAMED);
  const standings = top.map((e, i) => ({
    place: i + 1,
    userId: e.userId,
    displayName: e.displayName,
    slug: e.slug,
    metric: e.metric,
    points: e.points,
  }));
  const winner = top[0];
  if (!winner) {
    return {
      category: category.key,
      categoryTitle: category.title,
      metricLabel: category.metricLabel,
      metricValue: 0,
      winnerUserId: null,
      displayName: "",
      slug: "",
      stars: 0,
      title: "",
      expiresAt: info.crownsExpireAt.toISOString(),
      standings: [],
    };
  }
  let stars = 1;
  let title = starTitle(1);
  try {
    const lifetime = await store.lifetimeRank(winner.userId);
    stars = lifetime.stars;
    title = lifetime.title;
  } catch (err) {
    logger.warn(
      { err, userId: winner.userId },
      "[crowns] lifetime rank read failed — the crown reads ★1",
    );
  }
  return {
    category: category.key,
    categoryTitle: category.title,
    metricLabel: category.metricLabel,
    metricValue: winner.metric,
    winnerUserId: winner.userId,
    displayName: winner.displayName,
    slug: winner.slug,
    stars,
    title,
    expiresAt: info.crownsExpireAt.toISOString(),
    standings,
  };
}

/**
 * Decide one year against a store: read the year's windowed
 * counts once, decide every published category over them, and
 * record the row. The row's primary key is the idempotency: a
 * second deciding of the same year inserts nothing and reports
 * inserted=false.
 */
export async function decideCrownYear(
  store: CrownsStore,
  info: CrownYearInfo,
  now: Date = new Date(),
): Promise<CrownDecideOutcome> {
  const inputs = await store.yearStandings(info.startsAt, info.endsAt);
  const awards: CrownAward[] = [];
  for (const category of CROWN_CATEGORIES) {
    awards.push(await decideCategory(store, info, inputs, category));
  }
  const heraldText = crownsHeraldText(info, awards);
  const inserted = await store.markDecided({
    year: info.year,
    crownKey: info.crownKey,
    name: info.name,
    startsAt: info.startsAt,
    endsAt: info.endsAt,
    decidedAt: now,
    awards,
    heraldText,
  });
  return { inserted, awards, heraldText };
}

/* ── Wearing (a pure read over the frozen record) ───────────────── */

/**
 * The crowns a creator wears at a moment: every decided award
 * they won whose crown hasn't come off yet. Pure over the frozen
 * rows — the profile crown is a read, never a stored flag.
 */
export function activeCrowns(
  years: CrownYearRow[],
  userId: string,
  now: Date = new Date(),
): CrownAward[] {
  const out: CrownAward[] = [];
  for (const row of years) {
    const awards = Array.isArray(row.awards) ? (row.awards as CrownAward[]) : [];
    for (const award of awards) {
      if (award.winnerUserId !== userId) continue;
      if (new Date(award.expiresAt).getTime() <= now.getTime()) continue;
      out.push(award);
    }
  }
  return out;
}

/* ── The scheduler ──────────────────────────────────────────────── */

export interface CrownsSchedulerDeps {
  palace: { announce: (announcement: PalaceAnnouncement) => void };
  store?: CrownsStore;
}

/**
 * The year's turn, kept by a 30 s tick (the court-season shape).
 * Each tick decides at most one year — the OLDEST ended year with
 * no decided row — so a server that slept through a turn catches
 * up one ceremony per tick, in order, and a live server decides
 * the year within a tick of its turn. The herald sounds only for
 * the tick that inserted the row and only when at least one
 * crown landed: a re-run, a restart, or a twin tick changes
 * nothing and says nothing.
 */
export class CrownsScheduler {
  private store: CrownsStore;
  private ticking = false;

  constructor(private deps: CrownsSchedulerDeps) {
    this.store = deps.store ?? dbCrownsStore;
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date(nowMs);
      const current = crownYearForDate(now);
      if (current.year <= CROWNS_EPOCH_YEAR) return; // no year has ended yet
      const decided = new Set((await this.store.listYears()).map((r) => r.year));
      for (let y = CROWNS_EPOCH_YEAR; y < current.year; y++) {
        if (decided.has(y)) continue;
        const outcome = await decideCrownYear(this.store, crownYearSpan(y), now);
        if (outcome.inserted && outcome.awards.some((a) => a.winnerUserId !== null)) {
          this.deps.palace.announce({
            kind: "king",
            text: outcome.heraldText,
            name: outcome.awards.find((a) => a.winnerUserId !== null)?.displayName,
            roomId: COURT_CHAMBER_ROOM_ID,
            roomName: COURT_CHAMBER_ROOM_NAME,
          });
        }
        return; // one ceremony per tick
      }
    } catch (err) {
      logger.warn({ err }, "[crowns] tick failed");
    } finally {
      this.ticking = false;
    }
  }
}

/* ── DTOs (the site read — mirrored by the client) ──────────────── */

export interface CrownCategoryDto {
  key: string;
  title: string;
  blurb: string;
  metricLabel: string;
}

export interface CrownYearDto {
  year: number;
  crownKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  decidedAt: string;
  awards: CrownAward[];
  heraldText: string;
}

export interface CrownLeaderDto {
  userId: string;
  displayName: string;
  slug: string;
  metric: number;
  points: number;
}

export interface CrownCategoryLeadersDto extends CrownCategoryDto {
  /** The live leader board for the year in progress — the year's
   *  records so far, never an estimate. */
  leaders: CrownLeaderDto[];
}

export function toCrownCategoryDto(category: CrownCategory): CrownCategoryDto {
  return {
    key: category.key,
    title: category.title,
    blurb: category.blurb,
    metricLabel: category.metricLabel,
  };
}

export function toCrownYearDto(row: CrownYearRow): CrownYearDto {
  return {
    year: row.year,
    crownKey: row.crownKey,
    name: row.name,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    decidedAt: new Date(row.decidedAt).toISOString(),
    awards: Array.isArray(row.awards) ? (row.awards as CrownAward[]) : [],
    heraldText: row.heraldText,
  };
}

/**
 * The year-in-progress leader boards: every published category's
 * live leaders over the year's windowed counts — the same read
 * the deciding freezes, so what creators chase all year is what
 * decides it. Read through the store so the route stays a thin
 * shell over tested code.
 */
export async function currentCrownLeaders(
  store: CrownsStore,
  info: CrownYearInfo,
): Promise<CrownCategoryLeadersDto[]> {
  const inputs = await store.yearStandings(info.startsAt, info.endsAt);
  return CROWN_CATEGORIES.map((category) => ({
    ...toCrownCategoryDto(category),
    leaders: rankCrownCategory(inputs, category)
      .slice(0, CROWN_CATEGORY_STANDINGS_NAMED)
      .map((e) => ({
        userId: e.userId,
        displayName: e.displayName,
        slug: e.slug,
        metric: e.metric,
        points: e.points,
      })),
  }));
}
