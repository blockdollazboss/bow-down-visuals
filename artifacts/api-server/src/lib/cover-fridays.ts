/**
 * cover-fridays.ts — Cover Fridays (N19): the weekly HOUSE COVER
 * ritual, a cover-specific layer over the challenge engine's
 * weekly ritual (routes/challenge-engine — the general creator
 * contest). Delta ONLY: the cover form of that ritual —
 *
 *   - a HOUSE-NAMED WEEKLY COVER THEME. The rotation is published
 *     and deterministic by ISO week, resolved from the calendar
 *     alone — no database row, no admin launch — so a Friday
 *     with no theme is impossible: the theme ALWAYS resolves.
 *   - THE KING CROWNS THE BEST COVER BY MONDAY. Not the
 *     community vote (the general contest's way): the King's
 *     pick, by a published house rule over real platform
 *     records — the most-played cover takes the crown (plays,
 *     then likes, then the community's votes, then the earliest
 *     entry, then video id — total and deterministic, so a
 *     crowning replays the same way every time). The votes are
 *     heard; they do not crown.
 *   - THE WINNER'S COVER IS FEATURED AS THE CROWN — the crowned
 *     cover is the featured cover, credited to its creator,
 *     until the next crowning takes the spot.
 *
 * NO NEW CONTEST ENGINE: a Cover Fridays week is a challenges
 * row (slug cover-fridays-<weekKey>) on the engine's own tables;
 * entries ride POST /api/challenges/:slug/enter and votes ride
 * the engine's vote rail, untouched. THE CROWN IS THE PRIZE: the
 * featured placement is the award — no VB moves anywhere in
 * this feature, so the weekly prize budget law is untouched.
 *
 * THE CADENCE (scheduler, 30 s tick, the crowns shape): each
 * tick (1) ensures the CURRENT week's cover challenge exists —
 * the ritual never waits on an admin — and (2) crowns the
 * OLDEST past week still uncrowned whose Monday has arrived:
 * the pick is claimed by flipping the challenge to 'winners'
 * (only the claiming tick writes the winner row or sounds the
 * herald, so the crowning fires exactly once), and the court
 * hears it through the palace announce channel, aimed at the
 * Royal Court Chamber. A week nobody entered crowns nobody —
 * the row still flips, the record stays honest, no herald.
 *
 * Everything DB-shaped sits behind CoverFridaysStore so the
 * cadence and the scheduler are unit-tested against fakes; the
 * route layer wires the db store.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  COURT_CHAMBER_ROOM_ID,
  COURT_CHAMBER_ROOM_NAME,
} from "./world-court-season";
import type { PalaceAnnouncement } from "./world-room";
import { logger } from "./logger";

/** The cover-fridays tick — the court-season cadence. */
export const COVER_FRIDAYS_TICK_MS = 30_000;

/** How many past crowns the read keeps in view. */
export const COVER_FRIDAYS_PAST_CROWNS = 8;

/* ── The week (pure — the ritual's ISO math, covered here so the
 *    layer never reaches into the route file) ──────────────────── */

export interface CoverWeekInfo {
  isoYear: number;
  isoWeek: number;
  /** "2026-W41". */
  weekKey: string;
  /** "cover-fridays-2026-w41" — the week's challenge slug. */
  slug: string;
  /** Monday 00:00 UTC — the week opens. */
  startsAt: Date;
  /** Friday of the week — the theme's day. */
  fridayAt: Date;
  /** Sunday 23:59:59 UTC — covers close. */
  endsAt: Date;
  /** Next Monday 00:00 UTC — the King crowns BY Monday: the
   *  first instant the week's crowning may land. */
  crownByAt: Date;
}

/** ISO week parts (UTC) — the rotation's source of truth. */
export function coverIsoWeekParts(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - day + 3); // Thursday of this ISO week
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  return { year: t.getUTCFullYear(), week: 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86_400_000)) };
}

export function coverWeekKey(isoYear: number, isoWeek: number): string {
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

export function coverChallengeSlug(weekKey: string): string {
  return `cover-fridays-${weekKey.toLowerCase()}`;
}

/** The cover week a moment belongs to, with its full span. */
export function coverWeekForDate(d: Date): CoverWeekInfo {
  const { year, week } = coverIsoWeekParts(d);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const friday = new Date(monday);
  friday.setUTCDate(friday.getUTCDate() + 4);
  const ends = new Date(monday);
  ends.setUTCDate(ends.getUTCDate() + 6);
  ends.setUTCHours(23, 59, 59, 0);
  const crownBy = new Date(monday);
  crownBy.setUTCDate(crownBy.getUTCDate() + 7);
  const weekKey = coverWeekKey(year, week);
  return {
    isoYear: year,
    isoWeek: week,
    weekKey,
    slug: coverChallengeSlug(weekKey),
    startsAt: monday,
    fridayAt: friday,
    endsAt: ends,
    crownByAt: crownBy,
  };
}

/* ── The published cover themes (pure, fixed) ───────────────────── */

export interface CoverFridayTheme {
  title: string;
  hashtag: string;
  /** The assignment, in plain words — what "cover" means this week. */
  description: string;
}

/**
 * THE HOUSE COVER THEMES — a fixed published rotation, one per
 * ISO week, served verbatim by GET /api/challenges/cover-fridays
 * so the theme creators sing to is the theme the King crowns by.
 * Every theme is a cover assignment: take the songbook named
 * here and make it yours.
 */
export const COVER_FRIDAY_THEMES: readonly CoverFridayTheme[] = [
  { title: "Soul Classics", hashtag: "coverfridaysoul", description: "Cover a soul standard — the Stax and Motown songbook. Horns optional, heart required." },
  { title: "90s R&B Slow Jams", hashtag: "coverfriday90srnb", description: "Cover a 90s slow jam and slow it down further. Silk robe energy, bedroom-keyboard runs welcome." },
  { title: "Golden Era Bars", hashtag: "coverfridaygoldenera", description: "Cover a golden-era hip-hop verse — your flow over a classic break. Respect the architects." },
  { title: "Gospel Roots", hashtag: "coverfridaygospel", description: "Take it to church: cover a gospel standard or give a secular song the full choir treatment." },
  { title: "Motown Nights", hashtag: "coverfridaymotown", description: "Cover the Motown songbook, your voice. Matching suits not required — the harmonies are." },
  { title: "Acoustic Confessions", hashtag: "coverfridayacoustic", description: "Cover any hit stripped down to one instrument and one voice. Nowhere to hide — that's the point." },
  { title: "Rock Royalty", hashtag: "coverfridayrock", description: "Cover a rock anthem and make the stadium sing it back from your bedroom." },
  { title: "Jazz After Dark", hashtag: "coverfridayjazz", description: "Cover a jazz standard, after midnight. Brushes, blue notes, and space between the phrases." },
  { title: "Country Roads", hashtag: "coverfridaycountry", description: "Cover a country classic — front-porch honest, three chords and the truth." },
  { title: "Pop Royalty", hashtag: "coverfridaypop", description: "Cover a chart-topper and out-sing the original. Hooks up, gloves off." },
  { title: "Love Ballads", hashtag: "coverfridayballads", description: "Cover a love ballad like you mean every word of it. One take, full feeling." },
  { title: "Legends of the Mic", hashtag: "coverfridaylegends", description: "Cover a legend's signature record — the one everybody knows — and earn the comparison." },
] as const;

/** The theme for an ISO week — ALWAYS resolvable, from the
 *  calendar alone. A Friday with no theme fails the ritual;
 *  this function is why that can't happen. */
export function coverThemeForWeek(isoWeek: number): { theme: CoverFridayTheme; index: number } {
  const idx = ((Math.floor(isoWeek) % COVER_FRIDAY_THEMES.length) + COVER_FRIDAY_THEMES.length) % COVER_FRIDAY_THEMES.length;
  return { theme: COVER_FRIDAY_THEMES[idx]!, index: idx };
}

/* ── The King's pick (pure) ─────────────────────────────────────── */

export interface CoverEntryInput {
  videoId: string;
  profileId: string;
  /** The creator's account id (for the winner row's record). */
  userId: string | null;
  displayName: string;
  slug: string;
  title: string;
  thumbnailUrl: string | null;
  /** Real plays on the video — the King's deciding record. */
  viewCount: number;
  likeCount: number;
  /** The community's voice — heard (third tiebreak), never crowning. */
  voteCount: number;
  enteredAt: Date;
}

/**
 * THE KING'S PICK — a published house rule over real platform
 * records, total and deterministic: most plays decides; ties
 * fall to likes, then the community's votes, then the earliest
 * entry, then video id — so a crowning replays identically every
 * time it is computed. An empty court crowns nobody (null).
 */
export function kingPickCover(entries: CoverEntryInput[]): CoverEntryInput | null {
  if (entries.length === 0) return null;
  const ranked = [...entries].sort(
    (a, b) =>
      b.viewCount - a.viewCount ||
      b.likeCount - a.likeCount ||
      b.voteCount - a.voteCount ||
      a.enteredAt.getTime() - b.enteredAt.getTime() ||
      (a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0),
  );
  return ranked[0]!;
}

/* ── The herald (pure) ──────────────────────────────────────────── */

/** The crowning's announcement — built only from the crowned
 *  cover's own record. Only built when a crown landed. */
export function coverFridaysCrownText(
  info: { weekKey: string; themeTitle: string },
  winner: CoverEntryInput,
): string {
  return (
    `Cover Fridays ${info.weekKey} — “${info.themeTitle}” — has its crown. ` +
    `The King crowns ${winner.displayName}'s cover “${winner.title}”, ` +
    `the most-played cover of the week at ${winner.viewCount.toLocaleString("en-US")} plays. ` +
    `It wears the feature until the next crowning. Hear it in the ${COURT_CHAMBER_ROOM_NAME} and on the contests page.`
  );
}

/* ── The store ──────────────────────────────────────────────────── */

export interface CoverChallengeRow {
  id: string;
  slug: string;
  weekKey: string;
  status: string;
  entryCount: number;
  startsAt: Date;
  endsAt: Date;
}

export interface CrownedCover {
  weekKey: string;
  themeTitle: string;
  hashtag: string;
  crownedAt: string;
  creator: { slug: string; displayName: string; avatarUrl: string | null };
  video: { id: string; title: string; thumbnailUrl: string | null };
  viewCount: number;
}

export interface CoverFridaysStore {
  /** The week's cover challenge row, if it exists yet. */
  getChallenge(slug: string): Promise<CoverChallengeRow | null>;
  /** Create the week's challenge from its theme (on-conflict
   *  do nothing — the slug is the idempotency). */
  ensureChallenge(row: {
    slug: string;
    title: string;
    description: string;
    hashtag: string;
    weekKey: string;
    startsAt: Date;
    endsAt: Date;
    judgingEndsAt: Date;
  }): Promise<boolean>;
  /** Past cover challenges still uncrowned (status not
   *  'winners') whose week has ended, oldest week first. */
  uncrownedPast(now: Date): Promise<CoverChallengeRow[]>;
  /** The week's entries with their real records. */
  entriesOf(challengeId: string): Promise<CoverEntryInput[]>;
  /** Claim the crowning: flip the challenge to 'winners'. Only
   *  the tick whose UPDATE lands may write the winner row and
   *  herald — returns false when a twin tick crowned first. */
  claimCrowning(challengeId: string): Promise<boolean>;
  /** Record the crowned cover (challenge_winners, place 1, no
   *  prize — the feature IS the prize). */
  recordWinner(challengeId: string, winner: CoverEntryInput): Promise<void>;
  /** Crowned covers, newest week first — the featured read. */
  crownedCovers(limit: number): Promise<CrownedCover[]>;
}

function challengeFromRaw(row: any): CoverChallengeRow {
  return {
    id: String(row.id),
    slug: String(row.slug),
    weekKey: String(row.week_key),
    status: String(row.status),
    entryCount: Number(row.entry_count ?? 0),
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
  };
}

export const dbCoverFridaysStore: CoverFridaysStore = {
  async getChallenge(slug) {
    const res = await db.execute(sql`
      SELECT id, slug, week_key, status, entry_count, starts_at, ends_at
      FROM challenges WHERE slug = ${slug} LIMIT 1
    `);
    const row = (res.rows as any[])[0];
    return row ? challengeFromRaw(row) : null;
  },

  async ensureChallenge(row) {
    const inserted = await db.execute(sql`
      INSERT INTO challenges
        (slug, title, description, hashtag, status, starts_at, ends_at, judging_ends_at,
         prize_pool_credits, is_weekly, week_key)
      VALUES (
        ${row.slug}, ${row.title}, ${row.description}, ${row.hashtag}, 'live',
        ${row.startsAt.toISOString()}::timestamptz, ${row.endsAt.toISOString()}::timestamptz,
        ${row.judgingEndsAt.toISOString()}::timestamptz, 0, false, ${row.weekKey}
      )
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `);
    return (inserted.rows as any[]).length > 0;
  },

  async uncrownedPast(now) {
    const res = await db.execute(sql`
      SELECT id, slug, week_key, status, entry_count, starts_at, ends_at
      FROM challenges
      WHERE slug LIKE 'cover-fridays-%' AND status <> 'winners' AND ends_at < ${now.toISOString()}::timestamptz
      ORDER BY week_key ASC
    `);
    return (res.rows as any[]).map(challengeFromRaw);
  },

  async entriesOf(challengeId) {
    const res = await db.execute(sql`
      SELECT ce.video_id, ce.vote_count, ce.created_at AS entered_at,
             pv.profile_id, pv.title, pv.thumbnail_url, pv.view_count, pv.like_count,
             cp.user_id, cp.slug AS creator_slug, cp.display_name, cp.avatar_url
      FROM challenge_entries ce
      JOIN profile_videos pv ON pv.id = ce.video_id
      LEFT JOIN creator_profiles cp ON cp.id = pv.profile_id
      WHERE ce.challenge_id = ${challengeId}
    `);
    return (res.rows as any[]).map((r) => ({
      videoId: String(r.video_id),
      profileId: String(r.profile_id),
      userId: r.user_id ? String(r.user_id) : null,
      displayName: typeof r.display_name === "string" ? r.display_name : "",
      slug: typeof r.creator_slug === "string" ? r.creator_slug : "",
      title: String(r.title ?? ""),
      thumbnailUrl: typeof r.thumbnail_url === "string" ? r.thumbnail_url : null,
      viewCount: Number(r.view_count ?? 0),
      likeCount: Number(r.like_count ?? 0),
      voteCount: Number(r.vote_count ?? 0),
      enteredAt: new Date(r.entered_at),
    }));
  },

  async claimCrowning(challengeId) {
    const claimed = await db.execute(sql`
      UPDATE challenges SET status = 'winners'
      WHERE id = ${challengeId} AND status <> 'winners'
      RETURNING id
    `);
    return (claimed.rows as any[]).length > 0;
  },

  async recordWinner(challengeId, winner) {
    await db.execute(sql`
      INSERT INTO challenge_winners (challenge_id, place, video_id, profile_id, user_id, prize_credits)
      VALUES (${challengeId}, 1, ${winner.videoId}, ${winner.profileId}, ${winner.userId}, 0)
    `);
  },

  async crownedCovers(limit) {
    const res = await db.execute(sql`
      SELECT c.week_key, c.title AS challenge_title, c.hashtag, w.announced_at,
             pv.id AS video_id, pv.title AS video_title, pv.thumbnail_url, pv.view_count,
             cp.slug AS creator_slug, cp.display_name, cp.avatar_url
      FROM challenge_winners w
      JOIN challenges c ON c.id = w.challenge_id
      JOIN profile_videos pv ON pv.id = w.video_id
      LEFT JOIN creator_profiles cp ON cp.id = w.profile_id
      WHERE c.slug LIKE 'cover-fridays-%' AND w.place = 1
      ORDER BY c.week_key DESC
      LIMIT ${limit}
    `);
    return (res.rows as any[]).map((r) => {
      const challengeTitle = String(r.challenge_title ?? "");
      return {
        weekKey: String(r.week_key),
        themeTitle: challengeTitle.replace(/^Cover Fridays — /, ""),
        hashtag: String(r.hashtag ?? ""),
        crownedAt: new Date(r.announced_at).toISOString(),
        creator: {
          slug: typeof r.creator_slug === "string" ? r.creator_slug : "",
          displayName: typeof r.display_name === "string" ? r.display_name : "",
          avatarUrl: typeof r.avatar_url === "string" ? r.avatar_url : null,
        },
        video: {
          id: String(r.video_id),
          title: String(r.video_title ?? ""),
          thumbnailUrl: typeof r.thumbnail_url === "string" ? r.thumbnail_url : null,
        },
        viewCount: Number(r.view_count ?? 0),
      };
    });
  },
};

/* ── The cadence ────────────────────────────────────────────────── */

export interface CoverFridaysDeps {
  palace?: { announce: (announcement: PalaceAnnouncement) => void };
  store?: CoverFridaysStore;
}

/** The challenge row a week gets: title carries the theme so the
 *  crowned record can speak the theme's name back. */
export function coverChallengeInsert(info: CoverWeekInfo): {
  slug: string;
  title: string;
  description: string;
  hashtag: string;
  weekKey: string;
  startsAt: Date;
  endsAt: Date;
  judgingEndsAt: Date;
} {
  const { theme } = coverThemeForWeek(info.isoWeek);
  return {
    slug: info.slug,
    title: `Cover Fridays — ${theme.title}`,
    description: theme.description,
    hashtag: theme.hashtag,
    weekKey: info.weekKey,
    startsAt: info.startsAt,
    endsAt: info.endsAt,
    judgingEndsAt: info.crownByAt,
  };
}

/**
 * The Cover Fridays cadence, kept by a 30 s tick (the crowns
 * shape). Each tick: (1) the current week's cover challenge is
 * ensured — the theme's contest exists from the week's first
 * tick, never waiting on an admin; (2) the OLDEST past week
 * still uncrowned whose Monday has arrived is crowned — one
 * crowning per tick, in order. The crowning's claim is the
 * status flip: only the claiming tick records the winner and
 * sounds the herald, exactly once. A week nobody entered still
 * flips — crowned nobody, heralded never.
 */
export class CoverFridaysScheduler {
  private store: CoverFridaysStore;
  private ticking = false;

  constructor(private deps: CoverFridaysDeps = {}) {
    this.store = deps.store ?? dbCoverFridaysStore;
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date(nowMs);
      const current = coverWeekForDate(now);
      await this.store.ensureChallenge(coverChallengeInsert(current));

      const past = await this.store.uncrownedPast(now);
      for (const row of past) {
        const info = coverWeekSpanOf(row.weekKey, row.startsAt);
        if (info.crownByAt.getTime() > now.getTime()) continue;
        const entries = await this.store.entriesOf(row.id);
        const winner = kingPickCover(entries);
        const claimed = await this.store.claimCrowning(row.id);
        if (!claimed) return;
        if (winner) {
          await this.store.recordWinner(row.id, winner);
          const { theme } = coverThemeForWeek(info.isoWeek);
          this.deps.palace?.announce({
            kind: "king",
            text: coverFridaysCrownText({ weekKey: row.weekKey, themeTitle: theme.title }, winner),
            name: winner.displayName,
            roomId: COURT_CHAMBER_ROOM_ID,
            roomName: COURT_CHAMBER_ROOM_NAME,
          });
        }
        return; // one crowning per tick
      }
    } catch (err) {
      logger.warn({ err }, "[cover-fridays] tick failed");
    } finally {
      this.ticking = false;
    }
  }
}

/** Rebuild a week's span from its key + stored start (the row is
 *  the record; the span is only needed for its crown-by instant
 *  and ISO week). */
export function coverWeekSpanOf(weekKey: string, startsAt: Date): CoverWeekInfo {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  const monday = new Date(startsAt);
  const friday = new Date(monday);
  friday.setUTCDate(friday.getUTCDate() + 4);
  const ends = new Date(monday);
  ends.setUTCDate(ends.getUTCDate() + 6);
  ends.setUTCHours(23, 59, 59, 0);
  const crownBy = new Date(monday);
  crownBy.setUTCDate(crownBy.getUTCDate() + 7);
  return {
    isoYear: m ? Number(m[1]) : monday.getUTCFullYear(),
    isoWeek: m ? Number(m[2]) : coverIsoWeekParts(monday).week,
    weekKey,
    slug: coverChallengeSlug(weekKey),
    startsAt: monday,
    fridayAt: friday,
    endsAt: ends,
    crownByAt: crownBy,
  };
}
