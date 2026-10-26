/* ─── Your Month, Wrapped (Stack-200, idea #170 — TRULY NEW) ──────────
   A MONTHLY auto-made recap per creator: plays, sales, new fans, and
   the month's best moment — computed on read from REAL platform tables
   only (play_events, follows, digital_sales, store_orders,
   profile_tracks, profile_videos). A metric the site cannot support
   stays ABSENT (null in the raw input → omitted from the recap),
   never estimated, never invented.

   Smart law: exactly one recap per creator per month (the month is
   the key — the same month always recomputes to the same recap from
   the same source rows), and sharing happens only on the creator's
   own action (the share text is built here; nothing posts it).

   Opt-out: month_wrapped_prefs (provisional migration 9999) — no row
   = enabled; a creator who opts out gets no recap at all.

   This is NOT the morning brief, NOT the Analytics Hub aggregates and
   NOT "While You Were Away": it is a single finished month, packaged
   as one shareable card. */

import { db, monthWrappedPrefsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

/* ── Opt-out prefs (sound-prefs house pattern) ─────────────────────── */

export interface MonthWrappedPrefsWire {
  enabled: boolean;
}

export const DEFAULT_MONTH_WRAPPED_PREFS: MonthWrappedPrefsWire = { enabled: true };

export interface MonthWrappedPrefsStore {
  getRow(userId: string): Promise<MonthWrappedPrefsWire | null>;
  upsertRow(userId: string, prefs: MonthWrappedPrefsWire): Promise<void>;
}

export const drizzleMonthWrappedPrefsStore: MonthWrappedPrefsStore = {
  async getRow(userId) {
    const rows = await db
      .select()
      .from(monthWrappedPrefsTable)
      .where(eq(monthWrappedPrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? { enabled: row.enabled } : null;
  },
  async upsertRow(userId, prefs) {
    await db
      .insert(monthWrappedPrefsTable)
      .values({ userId, enabled: prefs.enabled })
      .onConflictDoUpdate({
        target: monthWrappedPrefsTable.userId,
        set: { enabled: prefs.enabled, updatedAt: new Date() },
      });
  },
};

export async function getMonthWrappedPrefs(
  store: MonthWrappedPrefsStore,
  userId: string,
): Promise<MonthWrappedPrefsWire> {
  const row = await store.getRow(userId);
  return row ?? { ...DEFAULT_MONTH_WRAPPED_PREFS };
}

export async function setMonthWrappedPrefs(
  store: MonthWrappedPrefsStore,
  userId: string,
  patch: Partial<MonthWrappedPrefsWire>,
): Promise<MonthWrappedPrefsWire> {
  const current = await getMonthWrappedPrefs(store, userId);
  const next: MonthWrappedPrefsWire = { enabled: patch.enabled ?? current.enabled };
  await store.upsertRow(userId, next);
  return next;
}

/* ── Month keys ──────────────────────────────────────────────────────
   A month key is "YYYY-MM" in UTC. The default recap is the PREVIOUS
   (last complete) month; the current month may be requested and is
   honestly flagged period_complete: false. Future months are invalid. */

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(key: string): boolean {
  return MONTH_KEY_RE.test(key);
}

export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last complete month relative to `now`. */
export function previousMonthKey(now: Date): string {
  return monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/** [start, end) UTC instants for a valid month key. */
export function monthRangeUtc(key: string): { start: Date; end: Date } {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** A month is complete once `now` is past its end. */
export function isMonthComplete(key: string, now: Date): boolean {
  return monthRangeUtc(key).end.getTime() <= now.getTime();
}

/** A month is in the future if it starts after the current month. */
export function isFutureMonth(key: string, now: Date): boolean {
  return monthRangeUtc(key).start.getTime() > monthRangeUtc(monthKeyOf(now)).start.getTime();
}

/* ── Recap shape ─────────────────────────────────────────────────────
   Every metric is nullable in the RAW input: null means "the site has
   no source for this" and the metric is OMITTED from the recap (the
   key is absent, not zero). Zero is a real measured value and shows. */

export interface MonthWrappedMediaPlay {
  kind: "track" | "video";
  mediaId: string;
  title: string;
  plays: number;
}

export interface MonthWrappedRaw {
  month: string;
  displayName: string;
  slug: string;
  /** Total play_events on the creator's own tracks/videos. */
  plays: number | null;
  /** follows.created_at in the month, on the creator's profile. */
  newFans: number | null;
  /** Completed digital_sales + store_orders for the profile. */
  salesCount: number | null;
  /** Sum of creator_amount_cents across those completed sales. */
  salesCreatorCents: number | null;
  /** Tracks + videos first published/created in the month. */
  newReleases: number | null;
  /** Per-media play counts in the month (for the best moment). */
  mediaPlays: MonthWrappedMediaPlay[];
}

export interface MonthWrappedBestMoment {
  kind: "track" | "video";
  mediaId: string;
  title: string;
  plays: number;
}

export interface MonthWrappedRecap {
  month: string;
  monthLabel: string;
  periodComplete: boolean;
  displayName: string;
  slug: string;
  /* Only metrics the site could actually measure are present. */
  plays?: number;
  newFans?: number;
  salesCount?: number;
  salesCreatorCents?: number;
  newReleases?: number;
  bestMoment: MonthWrappedBestMoment | null;
  /** True when the recap carries at least one measured metric. */
  hasActivity: boolean;
}

/** Best moment = the creator's most-played single track/video in the
 *  month. Deterministic tie-break: more plays, then title A→Z, then
 *  media id. No plays anywhere → no best moment (never invented). */
export function pickBestMoment(mediaPlays: MonthWrappedMediaPlay[]): MonthWrappedBestMoment | null {
  let best: MonthWrappedMediaPlay | null = null;
  for (const m of mediaPlays) {
    if (!Number.isFinite(m.plays) || m.plays <= 0) continue;
    if (
      best === null ||
      m.plays > best.plays ||
      (m.plays === best.plays &&
        (m.title < best.title || (m.title === best.title && m.mediaId < best.mediaId)))
    ) {
      best = m;
    }
  }
  return best ? { kind: best.kind, mediaId: best.mediaId, title: best.title, plays: best.plays } : null;
}

export function buildMonthWrapped(raw: MonthWrappedRaw, now: Date): MonthWrappedRecap {
  const recap: MonthWrappedRecap = {
    month: raw.month,
    monthLabel: monthLabel(raw.month),
    periodComplete: isMonthComplete(raw.month, now),
    displayName: raw.displayName,
    slug: raw.slug,
    bestMoment: pickBestMoment(raw.mediaPlays),
    hasActivity: false,
  };
  if (raw.plays !== null) recap.plays = raw.plays;
  if (raw.newFans !== null) recap.newFans = raw.newFans;
  if (raw.salesCount !== null) recap.salesCount = raw.salesCount;
  if (raw.salesCreatorCents !== null) recap.salesCreatorCents = raw.salesCreatorCents;
  if (raw.newReleases !== null) recap.newReleases = raw.newReleases;
  recap.hasActivity =
    (recap.plays ?? 0) > 0 ||
    (recap.newFans ?? 0) > 0 ||
    (recap.salesCount ?? 0) > 0 ||
    (recap.newReleases ?? 0) > 0;
  return recap;
}

/** Plain-text share copy, built ONLY from metrics present in the
 *  recap. The creator shares it by their own action — nothing here
 *  posts, sends, or schedules anything. */
export function buildMonthWrappedShareText(recap: MonthWrappedRecap): string {
  const lines: string[] = [`My ${recap.monthLabel} on Bow Down Visuals, wrapped:`];
  if (recap.plays !== undefined) lines.push(`▶ ${recap.plays.toLocaleString("en-US")} plays`);
  if (recap.newFans !== undefined) lines.push(`✦ ${recap.newFans.toLocaleString("en-US")} new fans`);
  if (recap.salesCount !== undefined) {
    const cents = recap.salesCreatorCents;
    const money =
      cents !== undefined ? ` ($${(cents / 100).toFixed(2)} earned)` : "";
    lines.push(`◆ ${recap.salesCount.toLocaleString("en-US")} sales${money}`);
  }
  if (recap.newReleases !== undefined && recap.newReleases > 0) {
    lines.push(`● ${recap.newReleases.toLocaleString("en-US")} new release${recap.newReleases === 1 ? "" : "s"}`);
  }
  if (recap.bestMoment) {
    lines.push(
      `★ Best moment: "${recap.bestMoment.title}" — ${recap.bestMoment.plays.toLocaleString("en-US")} plays`,
    );
  }
  return lines.join("\n");
}

/* ── Real-data source (drizzle) ──────────────────────────────────────
   Each query reads the source table directly. A query that fails
   degrades its metric to null (absent from the recap) rather than
   failing the whole recap — except the profile lookup itself: no
   creator profile = no recap. */

export interface MonthWrappedDataSource {
  loadRaw(userId: string, month: string): Promise<MonthWrappedRaw | null>;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export const drizzleMonthWrappedSource: MonthWrappedDataSource = {
  async loadRaw(userId, month) {
    const { start, end } = monthRangeUtc(month);
    const profileRows = (await safe(() =>
      db.execute(sql`
        SELECT id, display_name, slug FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
      `),
    )) as { rows?: Array<{ id: string; display_name: string; slug: string }> } | null;
    const profile = profileRows?.rows?.[0];
    if (!profile) return null;
    const profileId = profile.id;

    const mediaRows = await safe(() =>
      db.execute(sql`
        SELECT 'track' AS kind, id, title, created_at FROM profile_tracks WHERE profile_id = ${profileId}
        UNION ALL
        SELECT 'video' AS kind, id, title, created_at FROM profile_videos WHERE profile_id = ${profileId}
      `),
    ) as { rows?: Array<{ kind: "track" | "video"; id: string; title: string; created_at: string }> } | null;
    const media = mediaRows?.rows ?? [];
    const mediaIds = media.map((m) => m.id);
    const newReleases =
      mediaRows === null
        ? null
        : media.filter((m) => {
            const created = new Date(m.created_at).getTime();
            return created >= start.getTime() && created < end.getTime();
          }).length;

    let plays: number | null = null;
    let mediaPlays: MonthWrappedMediaPlay[] = [];
    if (mediaIds.length === 0) {
      plays = 0;
    } else {
      const playRows = await safe(() =>
        db.execute(sql`
          SELECT kind, media_id, COUNT(*)::int AS plays FROM play_events
          WHERE media_id IN (${sql.join(mediaIds.map((id) => sql`${id}`), sql`, `)})
            AND played_at >= ${start.toISOString()} AND played_at < ${end.toISOString()}
          GROUP BY kind, media_id
        `),
      ) as { rows?: Array<{ kind: "track" | "video"; media_id: string; plays: number }> } | null;
      if (playRows?.rows) {
        const titleById = new Map(media.map((m) => [m.id, m]));
        plays = 0;
        mediaPlays = playRows.rows.map((r) => {
          plays = (plays ?? 0) + Number(r.plays);
          const m = titleById.get(r.media_id);
          return {
            kind: r.kind,
            mediaId: r.media_id,
            title: m?.title ?? "",
            plays: Number(r.plays),
          };
        }).filter((m) => m.title !== "");
        /* A play row whose media was deleted has no real title to
           show — its plays still count toward the total above, but it
           can never be the "best moment" (never invent a title). */
      }
    }

    const fanRows = await safe(() =>
      db.execute(sql`
        SELECT COUNT(*)::int AS n FROM follows
        WHERE profile_id = ${profileId}
          AND created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
      `),
    ) as { rows?: Array<{ n: number }> } | null;
    const newFans = fanRows?.rows ? Number(fanRows.rows[0]?.n ?? 0) : null;

    const salesRows = await safe(() =>
      db.execute(sql`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(creator_amount_cents), 0)::int AS cents FROM (
          SELECT creator_amount_cents FROM digital_sales
            WHERE profile_id = ${profileId} AND status = 'completed'
              AND created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
          UNION ALL
          SELECT creator_amount_cents FROM store_orders
            WHERE profile_id = ${profileId} AND status = 'completed'
              AND created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
        ) s
      `),
    ) as { rows?: Array<{ n: number; cents: number }> } | null;
    const salesCount = salesRows?.rows ? Number(salesRows.rows[0]?.n ?? 0) : null;
    const salesCreatorCents = salesRows?.rows ? Number(salesRows.rows[0]?.cents ?? 0) : null;

    return {
      month,
      displayName: profile.display_name,
      slug: profile.slug,
      plays,
      newFans,
      salesCount,
      salesCreatorCents,
      newReleases,
      mediaPlays,
    };
  },
};
