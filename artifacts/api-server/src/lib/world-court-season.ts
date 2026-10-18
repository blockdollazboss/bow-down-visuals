/**
 * world-court-season.ts — Court seasons (World / THE-GAME Ring 4
 * "Later": "Court seasons: named seasons with a settling ceremony
 * and a season marks wall (collectibles display)"). Migration
 * 0153, table court_season_settlements.
 *
 * THE SEASON (deterministic, no admin panel): a court season is
 * one UTC calendar month on the palace calendar. Season I is
 * October 2026 — the month the palace game layer (Rings 2/3)
 * opened — and seasons run in sequence from there: Season II is
 * November 2026, and so on. Every season carries a courtly
 * subtitle from a fixed cycle, so a season's full name ("Season
 * IV, of the Winter Hearth") is a pure function of its ordinal —
 * the same on every boot, in every test, forever.
 *
 * STANDING — THE LADDER, WINDOWED, NEVER FORKED: during a season,
 * court standing accumulates from the earned-rank ladder's own
 * business sources — the exact counts lib/creator-rank's
 * countRankSources reads (published tracks/videos, completed
 * exports, followers, streams hosted, tips received, store/shop
 * sales, memberships sold) — with one change: each source's event
 * timestamp must fall inside the season's span [startsAt, endsAt).
 * The counts feed the ladder's own rankFromCounts, so weights,
 * caps, thresholds and gates are the ladder's, untouched. Every
 * source table carries the event time the ladder's conditions key
 * on (created_at; paid_at for jar tips; creator_credited_at for
 * stream tips; joined_at for memberships), so windowing needs no
 * snapshot job and no new write path: the season's standings are
 * a read over the same truth, and a past season can be re-derived
 * right up to the moment it is frozen. For the state-flag sources
 * (is_published, export state, order status) the honest read is
 * "created in the window AND qualifying" — qualifying is judged
 * when the count is taken, which is exact at the settling, the
 * moment the record freezes.
 *
 * THE SETTLING: at the season's turn, the scheduler (30 s tick,
 * the KingMomentScheduler's shape) freezes the final standings —
 * the top of the court, season points > 0, named non-official
 * profiles — into court_season_settlements and heralds the court
 * through the palace announce channel, aimed at the Royal Court
 * Chamber. IDEMPOTENCY IS STRUCTURAL: season_key is the table's
 * primary key (the king_moments pattern) — the insert is
 * on-conflict-do-nothing, a re-run settling changes nothing, and
 * the herald fires only for the tick that actually inserted the
 * row, so it fires exactly once. A season nobody scored in still
 * records its (empty) settlement — the wall stays honest — but
 * no herald sounds for an empty court. Marks are honor, not
 * money: no VB moves anywhere in this module.
 *
 * THE WALL: GET /api/world/court-season (routes/
 * world-court-season) serves the frozen seasons plus the current
 * season's live standings to the Season Marks Wall station in the
 * Royal Court Chamber — public, guests included (standings are
 * public spectacle per THE-GAME defaults: wins public, balances
 * private; nothing on the wall is a balance).
 *
 * Everything DB-shaped sits behind CourtSeasonStore so the
 * settling and the scheduler are unit-tested against fakes; the
 * route layer wires the db store.
 */
import { sql } from "drizzle-orm";
import {
  db,
  type CourtSeasonSettlement as CourtSeasonSettlementRow,
  type CourtSeasonStanding,
} from "@workspace/db";
import {
  countRankSources,
  rankFromCounts,
  starTitle,
  type RankCounts,
} from "./creator-rank";
import type { PalaceAnnouncement } from "./world-room";
import { logger } from "./logger";

export type { CourtSeasonStanding };

/** The Royal Court Chamber — the settling's room and the wall's. */
export const COURT_CHAMBER_ROOM_ID = "world:royal-court";
export const COURT_CHAMBER_ROOM_NAME = "Royal Court Chamber";

/** The scheduler's tick (the king-moment cadence). */
export const COURT_SEASON_TICK_MS = 30_000;

/** Placements frozen onto a season's marks — the top of the court. */
export const COURT_SEASON_MARKS_NAMED = 10;

/** Names spoken aloud in the settling herald (the wall keeps all). */
export const COURT_SEASON_HERALD_NAMED = 3;

/* ── The season calendar (pure) ─────────────────────────────────── */

/** Season I's month: October 2026 (UTC), the month the palace
 *  game layer opened. The epoch is a constant, so the calendar is
 *  derivable on any clock, in any test, forever. */
export const COURT_SEASON_EPOCH_YEAR = 2026;
export const COURT_SEASON_EPOCH_MONTH = 10; // October, 1-based

/** The courtly subtitles, in cycle order — season N wears
 *  SUBTITLES[(N − 1) mod 12], deterministically. */
export const COURT_SEASON_SUBTITLES: readonly string[] = [
  "of the First Bells",
  "of the Gilded Ledger",
  "of the Long Table",
  "of the Winter Hearth",
  "of the Open Gate",
  "of the Silver Reel",
  "of the High Seats",
  "of the Lantern Court",
  "of the Golden Harvest",
  "of the Marble Stair",
  "of the Night Market",
  "of the Crown's Return",
] as const;

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** Roman numerals for a season ordinal (1 → "I", 4 → "IV", …). */
export function toRoman(n: number): string {
  let v = Math.floor(Math.abs(n));
  if (!Number.isFinite(v) || v === 0) return "I";
  let out = "";
  for (const [value, glyph] of ROMAN_TABLE) {
    while (v >= value) {
      out += glyph;
      v -= value;
    }
  }
  return out;
}

export interface CourtSeasonInfo {
  /** "2026-10" — the settlement table's primary key. */
  seasonKey: string;
  /** 1-based sequence number (Season I = 1). */
  ordinal: number;
  /** "Season IV". */
  name: string;
  /** "of the Winter Hearth". */
  subtitle: string;
  /** First instant of the season (UTC month start, inclusive). */
  startsAt: Date;
  /** First instant of the NEXT season (exclusive bound). */
  endsAt: Date;
}

function seasonKeyFor(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

/** The season with the given ordinal (≥ 1): its full identity and
 *  span, derived from the epoch alone. */
export function seasonSpan(ordinal: number): CourtSeasonInfo {
  const ord = Math.max(1, Math.floor(ordinal) || 1);
  const monthIndex = COURT_SEASON_EPOCH_YEAR * 12 + (COURT_SEASON_EPOCH_MONTH - 1) + (ord - 1);
  const year = Math.floor(monthIndex / 12);
  const month1 = (monthIndex % 12) + 1;
  const startsAt = new Date(Date.UTC(year, month1 - 1, 1));
  const endsAt = new Date(Date.UTC(year, month1, 1));
  return {
    seasonKey: seasonKeyFor(year, month1),
    ordinal: ord,
    name: `Season ${toRoman(ord)}`,
    subtitle: COURT_SEASON_SUBTITLES[(ord - 1) % COURT_SEASON_SUBTITLES.length]!,
    startsAt,
    endsAt,
  };
}

/** The season a moment belongs to: the UTC calendar month,
 *  counted from the epoch. Anything before the epoch reads as
 *  Season I (its span still starts at the epoch — the palace had
 *  no court before it opened). */
export function seasonForDate(now: Date): CourtSeasonInfo {
  const months =
    (now.getUTCFullYear() - COURT_SEASON_EPOCH_YEAR) * 12 +
    (now.getUTCMonth() + 1 - COURT_SEASON_EPOCH_MONTH);
  return seasonSpan(months + 1);
}

/* ── Season standings (pure ranking over windowed counts) ───────── */

export interface SeasonStandingInput {
  userId: string;
  displayName: string;
  slug: string;
  counts: RankCounts;
}

export interface RankedSeasonEntry {
  userId: string;
  displayName: string;
  slug: string;
  /** Season points — the ladder's points over the windowed counts. */
  points: number;
  businessResults: number;
  publishedWorks: number;
}

/**
 * Rank one season's windowed counts into placements: the ladder's
 * own rankFromCounts turns counts into points (weights/caps are
 * the ladder's), only creators who scored stand, and the order is
 * total and deterministic — points, then business results, then
 * published works, then user id — so a tie at the settling freezes
 * the same way every time it is computed.
 */
export function rankSeasonStandings(inputs: SeasonStandingInput[]): RankedSeasonEntry[] {
  const ranked = inputs
    .map((i) => {
      const rank = rankFromCounts(i.counts);
      return {
        userId: i.userId,
        displayName: i.displayName,
        slug: i.slug,
        points: rank.points,
        businessResults: rank.businessResults,
        publishedWorks: rank.publishedWorks,
      };
    })
    .filter((e) => e.points > 0);
  ranked.sort(
    (a, b) =>
      b.points - a.points ||
      b.businessResults - a.businessResults ||
      b.publishedWorks - a.publishedWorks ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return ranked.slice(0, COURT_SEASON_MARKS_NAMED);
}

/* ── The herald (pure) ──────────────────────────────────────────── */

/**
 * The settling ceremony's announcement — built only from the
 * frozen standings. The top of the court is named (up to
 * COURT_SEASON_HERALD_NAMED); the wall carries every placement.
 */
export function seasonHeraldText(
  season: CourtSeasonInfo,
  standings: CourtSeasonStanding[],
): string {
  const parts: string[] = [
    `The season has turned — ${season.name}, ${season.subtitle}, is settled and its marks are carved.`,
  ];
  const top = standings.slice(0, COURT_SEASON_HERALD_NAMED);
  if (top.length > 0) {
    parts.push(`First of the court: ${top.map((s) => s.displayName).join(", ")}.`);
  }
  parts.push(
    `See every placement on the Season Marks Wall in the ${COURT_CHAMBER_ROOM_NAME}.`,
  );
  return parts.join(" ");
}

/* ── The store ──────────────────────────────────────────────────── */

export interface CourtSeasonStore {
  /** The frozen settlement for a season, if it has settled. */
  getSettlement(seasonKey: string): Promise<CourtSeasonSettlementRow | null>;
  /** Every settlement, newest season first — the wall's record. */
  listSettlements(): Promise<CourtSeasonSettlementRow[]>;
  /** Record a settling. Returns false when the season already has
   *  its row (a twin tick settled first) — the caller then stays
   *  silent: one season, one settling, one herald. */
  markSettled(row: {
    seasonKey: string;
    ordinal: number;
    name: string;
    subtitle: string;
    startsAt: Date;
    endsAt: Date;
    settledAt: Date;
    standings: CourtSeasonStanding[];
    heraldText: string;
  }): Promise<boolean>;
  /** Every named, non-official creator's ladder counts WINDOWED
   *  to [start, end) — the same sources countRankSources reads,
   *  the same conditions, plus the season's span on each source's
   *  event timestamp. */
  seasonStandings(start: Date, end: Date): Promise<SeasonStandingInput[]>;
  /** The creator's lifetime earned rank (the ladder, unwindowed)
   *  — the stars/title frozen onto their mark at the turn. */
  lifetimeRank(userId: string): Promise<{ stars: number; title: string }>;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A raw settlement row (snake_case, as db.execute returns it)
 *  in the store's camelCase shape. The settlement reads/writes
 *  speak raw SQL through db.execute — the house pattern for
 *  aggregate/ledger stores (and the only shape the pg-mem suite
 *  can drive; the drizzle builder's rowMode is rejected there). */
function settlementFromRaw(row: any): CourtSeasonSettlementRow {
  return {
    seasonKey: String(row.season_key),
    ordinal: n(row.ordinal),
    name: String(row.name),
    subtitle: String(row.subtitle),
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    settledAt: new Date(row.settled_at),
    standings: Array.isArray(row.standings) ? row.standings : [],
    heraldText: typeof row.herald_text === "string" ? row.herald_text : "",
  } as CourtSeasonSettlementRow;
}

export const dbCourtSeasonStore: CourtSeasonStore = {
  async getSettlement(seasonKey) {
    const res = await db.execute(sql`
      SELECT season_key, ordinal, name, subtitle, starts_at, ends_at, settled_at, standings, herald_text
      FROM court_season_settlements
      WHERE season_key = ${seasonKey}
      LIMIT 1
    `);
    const row = (res.rows as any[])[0];
    return row ? settlementFromRaw(row) : null;
  },

  async listSettlements() {
    const res = await db.execute(sql`
      SELECT season_key, ordinal, name, subtitle, starts_at, ends_at, settled_at, standings, herald_text
      FROM court_season_settlements
      ORDER BY ordinal DESC
    `);
    return (res.rows as any[]).map(settlementFromRaw);
  },

  async markSettled(row) {
    const inserted = await db.execute(sql`
      INSERT INTO court_season_settlements
        (season_key, ordinal, name, subtitle, starts_at, ends_at, settled_at, standings, herald_text)
      VALUES (
        ${row.seasonKey}, ${row.ordinal}, ${row.name}, ${row.subtitle},
        ${row.startsAt.toISOString()}::timestamptz, ${row.endsAt.toISOString()}::timestamptz,
        ${row.settledAt.toISOString()}::timestamptz, ${JSON.stringify(row.standings)}::jsonb,
        ${row.heraldText}
      )
      ON CONFLICT DO NOTHING
      RETURNING season_key
    `);
    return (inserted.rows as any[]).length > 0;
  },

  async seasonStandings(start, end) {
    /* The ladder's own sources (countRankSources in
     * lib/creator-rank), windowed: identical conditions, with the
     * season's span on each source's event timestamp. One profile
     * per user (creator_profiles.user_id is unique), so the
     * per-profile rows ARE the per-user counts. The King's own
     * official account hosts the court and never stands in it. */
    const s = start.toISOString();
    const e = end.toISOString();
    const res = await db.execute(sql`
      SELECT
        cp.user_id AS user_id,
        cp.display_name AS display_name,
        cp.slug AS slug,
        COALESCE(pt.c, 0) AS published_tracks,
        COALESCE(pv.c, 0) AS published_videos,
        COALESCE(ej.c, 0) AS exports_done,
        COALESCE(f.c, 0) AS followers,
        COALESCE(ls.c, 0) AS streams_hosted,
        COALESCE(jt.c, 0) AS jar_tips,
        COALESCE(lst.c, 0) AS stream_tips,
        COALESCE(so.c, 0) AS store_sales,
        COALESCE(se.c, 0) AS shop_sales,
        COALESCE(fm.c, 0) AS memberships_sold
      FROM creator_profiles cp
      LEFT JOIN (
        SELECT profile_id, COUNT(*)::int AS c FROM profile_tracks
        WHERE is_published AND created_at >= ${s}::timestamptz AND created_at < ${e}::timestamptz
        GROUP BY profile_id
      ) pt ON pt.profile_id = cp.id
      LEFT JOIN (
        SELECT profile_id, COUNT(*)::int AS c FROM profile_videos
        WHERE is_published AND created_at >= ${s}::timestamptz AND created_at < ${e}::timestamptz
        GROUP BY profile_id
      ) pv ON pv.profile_id = cp.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS c FROM export_jobs
        WHERE state = 'done' AND created_at >= ${s}::timestamptz AND created_at < ${e}::timestamptz
        GROUP BY user_id
      ) ej ON ej.user_id = cp.user_id
      LEFT JOIN (
        SELECT profile_id, COUNT(*)::int AS c FROM follows
        WHERE created_at >= ${s}::timestamptz AND created_at < ${e}::timestamptz
        GROUP BY profile_id
      ) f ON f.profile_id = cp.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS c FROM live_streams
        WHERE created_at >= ${s}::timestamptz AND created_at < ${e}::timestamptz
        GROUP BY user_id
      ) ls ON ls.user_id = cp.user_id
      LEFT JOIN (
        SELECT page_user_id AS user_id, COUNT(*)::int AS c FROM tip_jar_tips
        WHERE status = 'paid'
          AND COALESCE(paid_at, created_at) >= ${s}::timestamptz
          AND COALESCE(paid_at, created_at) < ${e}::timestamptz
        GROUP BY page_user_id
      ) jt ON jt.user_id = cp.user_id
      LEFT JOIN (
        SELECT creator_user_id AS user_id, COUNT(*)::int AS c FROM live_stream_tips
        WHERE creator_credited_at IS NOT NULL
          AND creator_credited_at >= ${s}::timestamptz
          AND creator_credited_at < ${e}::timestamptz
        GROUP BY creator_user_id
      ) lst ON lst.user_id = cp.user_id
      LEFT JOIN (
        SELECT profile_id, COUNT(*)::int AS c FROM store_orders
        WHERE status = 'completed' AND created_at >= ${s}::timestamptz AND created_at < ${e}::timestamptz
        GROUP BY profile_id
      ) so ON so.profile_id = cp.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS c FROM shop_events
        WHERE event_type = 'sale' AND created_at >= ${s}::timestamptz AND created_at < ${e}::timestamptz
        GROUP BY user_id
      ) se ON se.user_id = cp.user_id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS c FROM fan_members
        WHERE stripe_session_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due')
          AND joined_at >= ${s}::timestamptz AND joined_at < ${e}::timestamptz
        GROUP BY user_id
      ) fm ON fm.user_id = cp.user_id
      WHERE cp.is_official IS NOT TRUE
    `);
    return (res.rows as any[]).map((row) => ({
      userId: String(row.user_id),
      displayName: typeof row.display_name === "string" ? row.display_name : "",
      slug: typeof row.slug === "string" ? row.slug : "",
      counts: {
        publishedTracks: n(row.published_tracks),
        publishedVideos: n(row.published_videos),
        exports: n(row.exports_done),
        followers: n(row.followers),
        streamsHosted: n(row.streams_hosted),
        tipsReceived: n(row.jar_tips) + n(row.stream_tips),
        sales: n(row.store_sales) + n(row.shop_sales),
        membershipsSold: n(row.memberships_sold),
      },
    }));
  },

  async lifetimeRank(userId) {
    const rank = rankFromCounts(await countRankSources(userId));
    return { stars: rank.stars, title: starTitle(rank.stars) };
  },
};

/* ── The settling ───────────────────────────────────────────────── */

export interface SettleOutcome {
  /** True only for the settling that inserted the row — the one
   *  that may herald. False = the season was already settled (or a
   *  twin settled it first); the record stands untouched. */
  inserted: boolean;
  standings: CourtSeasonStanding[];
  heraldText: string;
}

/**
 * Settle one season against a store: read the windowed standings,
 * rank them with the ladder, freeze the placements (each carrying
 * the creator's lifetime earned rank at the turn), and record the
 * row. The row's primary key is the idempotency: a second settle
 * of the same season inserts nothing and reports inserted=false.
 */
/** Attach places + each creator's lifetime earned rank (stars and
 *  title at this moment) to ranked season entries — the mark
 *  itself. A failed rank read degrades that one mark to ★1 rather
 *  than failing the whole board. */
async function enrichStandings(
  store: CourtSeasonStore,
  ranked: RankedSeasonEntry[],
): Promise<CourtSeasonStanding[]> {
  const standings: CourtSeasonStanding[] = [];
  for (const [i, entry] of ranked.entries()) {
    let stars = 1;
    let title = starTitle(1);
    try {
      const lifetime = await store.lifetimeRank(entry.userId);
      stars = lifetime.stars;
      title = lifetime.title;
    } catch (err) {
      logger.warn(
        { err, userId: entry.userId },
        "[court-season] lifetime rank read failed — the mark reads ★1",
      );
    }
    standings.push({
      place: i + 1,
      userId: entry.userId,
      displayName: entry.displayName,
      slug: entry.slug,
      points: entry.points,
      stars,
      title,
    });
  }
  return standings;
}

export async function settleCourtSeason(
  store: CourtSeasonStore,
  season: CourtSeasonInfo,
  now: Date = new Date(),
): Promise<SettleOutcome> {
  const inputs = await store.seasonStandings(season.startsAt, season.endsAt);
  const standings = await enrichStandings(store, rankSeasonStandings(inputs));
  const heraldText = seasonHeraldText(season, standings);
  const inserted = await store.markSettled({
    seasonKey: season.seasonKey,
    ordinal: season.ordinal,
    name: season.name,
    subtitle: season.subtitle,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    settledAt: now,
    standings,
    heraldText,
  });
  return { inserted, standings, heraldText };
}

/* ── The scheduler ──────────────────────────────────────────────── */

export interface CourtSeasonSchedulerDeps {
  palace: { announce: (announcement: PalaceAnnouncement) => void };
  store?: CourtSeasonStore;
}

/**
 * The season's turn, kept by a 30 s tick (the king-moment shape).
 * Each tick settles at most one season — the OLDEST ended season
 * with no settlement row — so a server that slept through a turn
 * (or through two) catches up one ceremony per tick, in order,
 * and a live server settles the season within a tick of its turn.
 * The herald sounds only for the tick that inserted the row and
 * only when the court scored: a re-run, a restart, or a twin tick
 * changes nothing and says nothing.
 */
export class CourtSeasonScheduler {
  private store: CourtSeasonStore;
  private ticking = false;

  constructor(private deps: CourtSeasonSchedulerDeps) {
    this.store = deps.store ?? dbCourtSeasonStore;
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const current = seasonForDate(new Date(nowMs));
      if (current.ordinal <= 1) return; // no season has ended yet
      const settled = new Set(
        (await this.store.listSettlements()).map((r) => r.seasonKey),
      );
      for (let ord = 1; ord < current.ordinal; ord++) {
        const season = seasonSpan(ord);
        if (settled.has(season.seasonKey)) continue;
        const outcome = await settleCourtSeason(this.store, season, new Date(nowMs));
        if (outcome.inserted && outcome.standings.length > 0) {
          this.deps.palace.announce({
            kind: "king",
            text: outcome.heraldText,
            name: outcome.standings[0]!.displayName,
            roomId: COURT_CHAMBER_ROOM_ID,
            roomName: COURT_CHAMBER_ROOM_NAME,
          });
        }
        return; // one ceremony per tick
      }
    } catch (err) {
      logger.warn({ err }, "[court-season] tick failed");
    } finally {
      this.ticking = false;
    }
  }
}

/* ── DTOs (the wall's read — mirrored by the world client) ──────── */

export interface CourtSeasonDto {
  seasonKey: string;
  ordinal: number;
  name: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
}

export interface CourtSeasonCurrentDto extends CourtSeasonDto {
  /** The live top of the court for the running season. */
  standings: CourtSeasonStanding[];
}

export interface CourtSeasonSettlementDto extends CourtSeasonDto {
  settledAt: string;
  standings: CourtSeasonStanding[];
  heraldText: string;
}

export function toCourtSeasonDto(season: CourtSeasonInfo): CourtSeasonDto {
  return {
    seasonKey: season.seasonKey,
    ordinal: season.ordinal,
    name: season.name,
    subtitle: season.subtitle,
    startsAt: season.startsAt.toISOString(),
    endsAt: season.endsAt.toISOString(),
  };
}

export function toSettlementDto(row: CourtSeasonSettlementRow): CourtSeasonSettlementDto {
  const standings = Array.isArray(row.standings)
    ? (row.standings as CourtSeasonStanding[])
    : [];
  return {
    seasonKey: row.seasonKey,
    ordinal: row.ordinal,
    name: row.name,
    subtitle: row.subtitle,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    settledAt: new Date(row.settledAt).toISOString(),
    standings,
    heraldText: row.heraldText,
  };
}

/**
 * The current season's LIVE standings for the wall: the same
 * windowed read + ladder ranking the settling freezes, enriched
 * with each placed creator's lifetime rank. Read through the
 * store so the route stays a thin shell over tested code.
 */
export async function currentSeasonStandings(
  store: CourtSeasonStore,
  season: CourtSeasonInfo,
): Promise<CourtSeasonStanding[]> {
  const ranked = rankSeasonStandings(
    await store.seasonStandings(season.startsAt, season.endsAt),
  );
  return enrichStandings(store, ranked);
}
