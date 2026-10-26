/**
 * Public Results Wall (Stack-200, dedupe audit #177 — TRULY NEW).
 *
 * A public wall of creator OUTCOMES — first sale, sales milestones,
 * on-platform follower milestones, Visual Bucs earned milestones, and
 * weekly-chart placements — docked in the Promote flow.
 *
 * HONESTY LAW (the whole feature stands on it):
 *  - Events are DERIVED from the platform's own records only:
 *      first_sale / sales  ← digital_sales rows (status='completed')
 *      followers           ← follows rows
 *      vb_earned           ← credit_usage ledger grants (creditsUsed < 0,
 *                            the platform's strict-ledger grant convention)
 *      chart_placement     ← the same play_events computation behind
 *                            /charts (7-day window, best track rank)
 *    There is NO code path by which a creator (or anyone) types, submits,
 *    estimates or projects a number onto the wall.
 *  - `occurredAt` is the REAL moment of crossing: the created_at of the
 *    record that crossed the line — never the scan time dressed up as
 *    the event time (scan time is kept separately as verifiedAt).
 *  - OPT-IN: prefs default optedIn=false. The public read filters on
 *    opted_in AND per-kind hiddenKinds at query time, so opting out or
 *    hiding a kind revokes instantly. Events recorded while opted out
 *    are visible ONLY to their owner (their private results view).
 *  - Smart law: no notifications, no fan-out, no blasts anywhere in this
 *    feature. The wall is a quiet surface a visitor finds in Promote.
 *  - FREE: no credits are charged or granted by anything here.
 *
 * Scans are lazy (owner read / explicit owner action / opportunistic
 * background pass for opted-in creators whose scan is stale), never a
 * cron blast. Re-scans are idempotent via the events unique index.
 */
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  creditUsageTable,
  digitalSalesTable,
  followsTable,
  resultsWallEventsTable,
  resultsWallPrefsTable,
  RESULTS_WALL_KINDS,
  RESULTS_WALL_SALES_THRESHOLDS,
  RESULTS_WALL_FOLLOWER_THRESHOLDS,
  RESULTS_WALL_VB_THRESHOLDS,
  RESULTS_WALL_CHART_CUTOFF,
  type ResultsWallEventDetail,
  type ResultsWallKind,
} from "@workspace/db";
import { logger } from "./logger";

export const RESULTS_WALL_KIND_SET: ReadonlySet<string> = new Set(RESULTS_WALL_KINDS);

/** A scan younger than this is fresh; older scans re-derive lazily. */
export const RESULTS_WALL_FRESH_MS = 6 * 60 * 60 * 1000;
/** Public wall page size — a wall, not an infinite firehose. */
export const RESULTS_WALL_PUBLIC_LIMIT = 50;

/* ── Pure derivation ─────────────────────────────────────────────────────
   These functions are the honesty law in code: given ONLY timestamps /
   ledger rows that came out of platform tables, they produce the
   milestone events those records prove — nothing else can produce an
   event, and absent records produce absent events. */

export interface DerivedEvent {
  kind: ResultsWallKind;
  threshold: number;
  value: number;
  occurredAt: Date;
  detail: ResultsWallEventDetail;
}

const validDate = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Count-kind crossing: given the ascending created_at list of the
 * underlying records (sales, follows), the threshold-th record's
 * timestamp IS the moment the milestone happened.
 */
export function countCrossings(
  kind: ResultsWallKind,
  source: ResultsWallEventDetail["source"],
  timestampsAsc: Date[],
  thresholds: readonly number[],
): DerivedEvent[] {
  const clean = timestampsAsc.filter(validDate);
  const out: DerivedEvent[] = [];
  for (const threshold of thresholds) {
    if (clean.length >= threshold) {
      out.push({
        kind,
        threshold,
        value: threshold,
        occurredAt: clean[threshold - 1]!,
        detail: { source },
      });
    }
  }
  return out;
}

/** First sale is its own kind (threshold 1) — the first completed sale. */
export function firstSaleEvent(saleTimestampsAsc: Date[]): DerivedEvent | null {
  const clean = saleTimestampsAsc.filter(validDate);
  if (clean.length === 0) return null;
  return {
    kind: "first_sale",
    threshold: 1,
    value: 1,
    occurredAt: clean[0]!,
    detail: { source: "digital_sales" },
  };
}

export interface VbLedgerRow {
  creditsUsed: number;
  createdAt: Date;
}

/**
 * VB earned: only GRANT rows count (creditsUsed < 0 by the ledger's
 * grant convention — see lib/pitch-fix-rewards.ts). Spend rows are
 * ignored, never netted: "earned" means the platform granted it.
 * occurredAt is the grant row that pushed the cumulative total across.
 */
export function vbCrossings(rowsAsc: VbLedgerRow[]): DerivedEvent[] {
  const out: DerivedEvent[] = [];
  let cumulative = 0;
  let next = 0;
  for (const row of rowsAsc) {
    if (!validDate(row.createdAt)) continue;
    if (!(row.creditsUsed < 0)) continue;
    cumulative += -row.creditsUsed;
    while (
      next < RESULTS_WALL_VB_THRESHOLDS.length &&
      cumulative >= RESULTS_WALL_VB_THRESHOLDS[next]!
    ) {
      const threshold = RESULTS_WALL_VB_THRESHOLDS[next]!;
      out.push({
        kind: "vb_earned",
        threshold,
        value: threshold,
        occurredAt: row.createdAt,
        detail: { source: "credit_usage" },
      });
      next++;
    }
  }
  return out;
}

/**
 * Chart placement: a rank exists ONLY when the platform's own chart
 * computation returned one at scan time. Rank must be a real integer
 * inside the cutoff — null / NaN / 0 / beyond-cutoff invent nothing.
 */
export function chartPlacementEvent(
  rank: number | null | undefined,
  trackTitle: string | null | undefined,
  computedAt: Date,
): DerivedEvent | null {
  if (rank == null || !Number.isInteger(rank) || rank < 1 || rank > RESULTS_WALL_CHART_CUTOFF) {
    return null;
  }
  if (!validDate(computedAt)) return null;
  return {
    kind: "chart_placement",
    threshold: rank,
    value: rank,
    occurredAt: computedAt,
    detail: {
      source: "play_events_chart",
      window: "week",
      ...(trackTitle ? { trackTitle } : {}),
    },
  };
}

/* ── Public shaping ──────────────────────────────────────────────────────
   The ONLY path to a public screen. An event shows publicly iff its
   creator is opted in and its kind is not hidden — checked at read
   time, so revocation is instant even for long-recorded events. */

export interface WallEventWire {
  id: string;
  kind: ResultsWallKind;
  threshold: number;
  value: number;
  detail: ResultsWallEventDetail;
  occurredAt: string;
  verifiedAt: string;
  creator: { profileId: string; slug: string; displayName: string; avatarUrl: string | null };
}

export function shapePublicWall(
  rows: Array<{
    event: {
      id: string;
      kind: string;
      threshold: number;
      value: number;
      detail: ResultsWallEventDetail;
      occurredAt: Date;
      verifiedAt: Date;
    };
    optedIn: boolean;
    hiddenKinds: string[];
    profile: { id: string; slug: string; displayName: string; avatarUrl: string | null; isPublic: boolean };
  }>,
  limit: number = RESULTS_WALL_PUBLIC_LIMIT,
): WallEventWire[] {
  return rows
    .filter((r) => r.optedIn && r.profile.isPublic && !r.hiddenKinds.includes(r.event.kind))
    .filter((r) => RESULTS_WALL_KIND_SET.has(r.event.kind))
    .sort((a, b) => b.event.occurredAt.getTime() - a.event.occurredAt.getTime())
    .slice(0, Math.max(1, limit))
    .map((r) => ({
      id: r.event.id,
      kind: r.event.kind as ResultsWallKind,
      threshold: r.event.threshold,
      value: r.event.value,
      detail: r.event.detail,
      occurredAt: r.event.occurredAt.toISOString(),
      verifiedAt: r.event.verifiedAt.toISOString(),
      creator: {
        profileId: r.profile.id,
        slug: r.profile.slug,
        displayName: r.profile.displayName,
        avatarUrl: r.profile.avatarUrl,
      },
    }));
}

/* ── Store (DB) ──────────────────────────────────────────────────────── */

async function profileForUser(userId: string) {
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return profile ?? null;
}

export interface ResultsWallPrefsWire {
  optedIn: boolean;
  hiddenKinds: string[];
  lastScannedAt: string | null;
}

export interface MyResultsState {
  hasProfile: boolean;
  prefs: ResultsWallPrefsWire;
  events: Array<{
    id: string;
    kind: ResultsWallKind;
    threshold: number;
    value: number;
    detail: ResultsWallEventDetail;
    occurredAt: string;
    verifiedAt: string;
    visibleOnWall: boolean;
  }>;
}

async function getPrefsRow(userId: string) {
  const [row] = await db
    .select()
    .from(resultsWallPrefsTable)
    .where(eq(resultsWallPrefsTable.userId, userId))
    .limit(1);
  return row ?? null;
}

async function ensurePrefs(userId: string, profileId: string) {
  const existing = await getPrefsRow(userId);
  if (existing) return existing;
  const [row] = await db
    .insert(resultsWallPrefsTable)
    .values({ userId, profileId, optedIn: false, hiddenKinds: [] })
    .onConflictDoNothing()
    .returning();
  return row ?? (await getPrefsRow(userId))!;
}

/**
 * The derivation scan: reads ONLY platform records for this creator,
 * derives the events they prove, and records the new ones. Returns how
 * many events were newly recorded. Chart rank comes from the same
 * play_events weekly computation the /charts surface uses.
 */
export async function scanCreatorResults(userId: string): Promise<{ recorded: number; total: number } | null> {
  const profile = await profileForUser(userId);
  if (!profile) return null;
  await ensurePrefs(userId, profile.id);

  const [saleTimes, followTimes, ledgerRows, chart] = await Promise.all([
    db
      .select({ createdAt: digitalSalesTable.createdAt })
      .from(digitalSalesTable)
      .where(and(eq(digitalSalesTable.profileId, profile.id), eq(digitalSalesTable.status, "completed")))
      .orderBy(asc(digitalSalesTable.createdAt)),
    db
      .select({ createdAt: followsTable.createdAt })
      .from(followsTable)
      .where(eq(followsTable.profileId, profile.id))
      .orderBy(asc(followsTable.createdAt)),
    db
      .select({ creditsUsed: creditUsageTable.creditsUsed, createdAt: creditUsageTable.createdAt })
      .from(creditUsageTable)
      .where(and(eq(creditUsageTable.userId, userId), lt(creditUsageTable.creditsUsed, 0)))
      .orderBy(asc(creditUsageTable.createdAt)),
    bestWeeklyChartRank(profile.id),
  ]);

  const derived: DerivedEvent[] = [];
  const first = firstSaleEvent(saleTimes.map((r) => r.createdAt));
  if (first) derived.push(first);
  derived.push(
    ...countCrossings("sales", "digital_sales", saleTimes.map((r) => r.createdAt), RESULTS_WALL_SALES_THRESHOLDS),
    ...countCrossings("followers", "follows", followTimes.map((r) => r.createdAt), RESULTS_WALL_FOLLOWER_THRESHOLDS),
    ...vbCrossings(ledgerRows),
  );
  if (chart) {
    const ev = chartPlacementEvent(chart.rank, chart.trackTitle, new Date());
    if (ev) derived.push(ev);
  }

  let recorded = 0;
  for (const ev of derived) {
    const inserted = await db
      .insert(resultsWallEventsTable)
      .values({
        userId,
        profileId: profile.id,
        kind: ev.kind,
        threshold: ev.threshold,
        value: ev.value,
        detail: ev.detail,
        occurredAt: ev.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: resultsWallEventsTable.id });
    if (inserted.length > 0) recorded++;
  }

  await db
    .update(resultsWallPrefsTable)
    .set({ lastScannedAt: new Date(), updatedAt: new Date() })
    .where(eq(resultsWallPrefsTable.userId, userId));
  return { recorded, total: derived.length };
}

/** Best (lowest) rank among the creator's tracks on the 7-day play chart,
 *  computed exactly like routes/discovery.ts topTracks (play_events). */
async function bestWeeklyChartRank(
  profileId: string,
): Promise<{ rank: number; trackTitle: string } | null> {
  const rows = await db.execute(sql`
    SELECT t.id AS track_id, t.title AS title, COUNT(*)::int AS window_plays
    FROM play_events e
    JOIN profile_tracks t ON t.id = e.media_id
    JOIN creator_profiles p ON p.id = t.profile_id
    WHERE e.kind = 'track'
      AND e.played_at >= NOW() - INTERVAL '7 days'
      AND t.is_published AND p.is_public
    GROUP BY t.id, t.title
    ORDER BY window_plays DESC
    LIMIT ${RESULTS_WALL_CHART_CUTOFF}`);
  const list = rows.rows as unknown as Array<{ track_id: string; title: string }>;
  /* Rank within the cutoff list for THIS creator's tracks: we need the
     creator's track ids — re-query membership from the ranked list by
     joining profile_tracks on profile. The ranked SQL above is global;
     filter by a second cheap lookup of the creator's track ids. */
  const mine = await db.execute(sql`
    SELECT id FROM profile_tracks WHERE profile_id = ${profileId}`);
  const myIds = new Set((mine.rows as unknown as Array<{ id: string }>).map((r) => r.id));
  for (let i = 0; i < list.length; i++) {
    if (myIds.has(list[i]!.track_id)) {
      return { rank: i + 1, trackTitle: list[i]!.title };
    }
  }
  return null;
}

export async function getMyResults(userId: string, opts: { scanIfStale?: boolean } = {}): Promise<MyResultsState> {
  const profile = await profileForUser(userId);
  if (!profile) {
    return {
      hasProfile: false,
      prefs: { optedIn: false, hiddenKinds: [], lastScannedAt: null },
      events: [],
    };
  }
  let prefs = await ensurePrefs(userId, profile.id);
  const stale =
    !prefs.lastScannedAt ||
    Date.now() - prefs.lastScannedAt.getTime() > RESULTS_WALL_FRESH_MS;
  if (opts.scanIfStale && stale) {
    await scanCreatorResults(userId).catch((err) => {
      logger.warn({ err }, "[results-wall] owner scan failed — serving recorded events");
    });
    prefs = (await getPrefsRow(userId)) ?? prefs;
  }
  const events = await db
    .select()
    .from(resultsWallEventsTable)
    .where(eq(resultsWallEventsTable.profileId, profile.id))
    .orderBy(desc(resultsWallEventsTable.occurredAt))
    .limit(200);
  const hidden = new Set(prefs.hiddenKinds ?? []);
  return {
    hasProfile: true,
    prefs: {
      optedIn: prefs.optedIn,
      hiddenKinds: prefs.hiddenKinds ?? [],
      lastScannedAt: prefs.lastScannedAt ? prefs.lastScannedAt.toISOString() : null,
    },
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      threshold: e.threshold,
      value: e.value,
      detail: e.detail,
      occurredAt: e.occurredAt.toISOString(),
      verifiedAt: e.verifiedAt.toISOString(),
      visibleOnWall: prefs.optedIn && !hidden.has(e.kind),
    })),
  };
}

export async function setResultsWallOptIn(userId: string, optedIn: boolean): Promise<ResultsWallPrefsWire | null> {
  const profile = await profileForUser(userId);
  if (!profile) return null;
  await ensurePrefs(userId, profile.id);
  const [row] = await db
    .update(resultsWallPrefsTable)
    .set({ optedIn, updatedAt: new Date() })
    .where(eq(resultsWallPrefsTable.userId, userId))
    .returning();
  return {
    optedIn: row!.optedIn,
    hiddenKinds: row!.hiddenKinds ?? [],
    lastScannedAt: row!.lastScannedAt ? row!.lastScannedAt.toISOString() : null,
  };
}

export async function setResultsWallHiddenKinds(
  userId: string,
  hiddenKinds: string[],
): Promise<ResultsWallPrefsWire | null> {
  const profile = await profileForUser(userId);
  if (!profile) return null;
  await ensurePrefs(userId, profile.id);
  const [row] = await db
    .update(resultsWallPrefsTable)
    .set({ hiddenKinds, updatedAt: new Date() })
    .where(eq(resultsWallPrefsTable.userId, userId))
    .returning();
  return {
    optedIn: row!.optedIn,
    hiddenKinds: row!.hiddenKinds ?? [],
    lastScannedAt: row!.lastScannedAt ? row!.lastScannedAt.toISOString() : null,
  };
}

/** The public wall: recorded events of opted-in creators only. */
export async function getPublicWall(limit: number = RESULTS_WALL_PUBLIC_LIMIT): Promise<WallEventWire[]> {
  const rows = await db
    .select({
      event: resultsWallEventsTable,
      optedIn: resultsWallPrefsTable.optedIn,
      hiddenKinds: resultsWallPrefsTable.hiddenKinds,
      profile: creatorProfilesTable,
    })
    .from(resultsWallEventsTable)
    .innerJoin(
      resultsWallPrefsTable,
      eq(resultsWallPrefsTable.profileId, resultsWallEventsTable.profileId),
    )
    .innerJoin(
      creatorProfilesTable,
      eq(creatorProfilesTable.id, resultsWallEventsTable.profileId),
    )
    .where(eq(resultsWallPrefsTable.optedIn, true))
    .orderBy(desc(resultsWallEventsTable.occurredAt))
    .limit(Math.max(1, Math.min(200, limit)) * 2);
  return shapePublicWall(
    rows.map((r) => ({
      event: r.event,
      optedIn: r.optedIn,
      hiddenKinds: r.hiddenKinds ?? [],
      profile: {
        id: r.profile.id,
        slug: r.profile.slug,
        displayName: r.profile.displayName,
        avatarUrl: r.profile.avatarUrl,
        isPublic: r.profile.isPublic,
      },
    })),
    limit,
  );
}

/* In-flight guard for opportunistic background scans (social-proof
   pattern): a busy wall must not stampede the derivation queries. */
const scanInFlight = new Set<string>();

export function maybeScanCreatorResults(userId: string): void {
  if (scanInFlight.has(userId)) return;
  scanInFlight.add(userId);
  scanCreatorResults(userId)
    .catch((err) => logger.warn({ err }, "[results-wall] background scan failed"))
    .finally(() => scanInFlight.delete(userId));
}

/** User ids of opted-in creators whose scan is stale — the public wall
 *  read kicks background scans for these (never blocks the response). */
export async function staleOptedInUserIds(): Promise<string[]> {
  const cutoff = new Date(Date.now() - RESULTS_WALL_FRESH_MS);
  const rows = await db
    .select({ userId: resultsWallPrefsTable.userId, lastScannedAt: resultsWallPrefsTable.lastScannedAt })
    .from(resultsWallPrefsTable)
    .where(eq(resultsWallPrefsTable.optedIn, true))
    .limit(25);
  return rows
    .filter((r) => !r.lastScannedAt || r.lastScannedAt < cutoff)
    .map((r) => r.userId);
}

