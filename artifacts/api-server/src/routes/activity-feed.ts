import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  db,
  exportJobsTable,
  generationsTable,
  hourlyCrateClaimsTable,
  sharkDropsTable,
  contestEntriesTable,
  levelCelebrationsTable,
  socialPublishAttemptsTable,
  lipSyncJobsTable,
  userActivityTable,
} from "@workspace/db";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";

const router = Router();

/* ─── Live FOMO feed — real activity only, zero fakery ──────────────────────
   GET /api/activity/feed
   Aggregates REAL, anonymized events from production tables:
     export_jobs          (state = done)            → "A creator just exported a video"
     generations          (created_at)              → "Someone just generated a song"
     hourly_crate_claims  (claimed_at)              → "Someone just claimed the hourly crate"
     shark_drops          (claimed_at not null)     → "Someone claimed a shark drop"
     contest_entries      (created_at)              → "A new entry just joined a contest"
     level_celebrations   (celebrated_at)           → "A creator just leveled up"
     social_publish_attempts (status = succeeded)  → "Someone just published a post"
     lip_sync_jobs        (created_at)              → "Someone started a lip-sync"
   Privacy: the response carries NO user ids, names, handles, or any PII —
   only a `kind`, an optional non-identifying `detail` (e.g. generation type),
   and a timestamp. VB math: 0 — this endpoint never pays out or charges.
   It also throttles-touch user_activity.last_seen_at (≤1 write / 5 min /
   user) so `onlineCount` below is REAL presence: users whose last_seen_at is
   within the last 10 minutes. */

interface FeedItem {
  kind: string;
  detail: string | null;
  ts: string;
}

const WINDOW_HOURS = 24;
const FEED_LIMIT = 15;
const ONLINE_WINDOW_MINUTES = 10;
const PRESENCE_TOUCH_MINUTES = 5;

async function touchPresence(userId: string): Promise<void> {
  try {
    // Single statement: upsert, but only rewrite last_seen_at when the stored
    // value is older than PRESENCE_TOUCH_MINUTES — at most one write per user
    // per 5 minutes no matter how often the feed is polled.
    await db.execute(sql`
      INSERT INTO user_activity (user_id, last_seen_at, updated_at)
      VALUES (${userId}, now(), now())
      ON CONFLICT (user_id) DO UPDATE
      SET last_seen_at = now(), updated_at = now()
      WHERE user_activity.last_seen_at < now() - make_interval(mins => ${PRESENCE_TOUCH_MINUTES})
    `);
  } catch (err) {
    // Presence must never break the feed.
    logger.warn({ err, userId }, "[activity-feed] presence touch failed");
  }
}

router.get("/activity/feed", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    await touchPresence(userId);

    const cutoff = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
    const items: FeedItem[] = [];
    const push = (kind: string, ts: Date | null, detail: string | null = null) => {
      if (!ts) return;
      items.push({ kind, detail, ts: ts.toISOString() });
    };

    // 1. Finished video exports
    const exports = await db
      .select({ updated_at: exportJobsTable.updated_at })
      .from(exportJobsTable)
      .where(and(eq(exportJobsTable.state, "done"), gt(exportJobsTable.updated_at, cutoff)))
      .orderBy(desc(exportJobsTable.updated_at))
      .limit(6);
    exports.forEach((r) => push("export", r.updated_at));

    // 2. Generations (detail = generation type: image | video | song | voice)
    const gens = await db
      .select({ created_at: generationsTable.created_at, type: generationsTable.type })
      .from(generationsTable)
      .where(gt(generationsTable.created_at, cutoff))
      .orderBy(desc(generationsTable.created_at))
      .limit(6);
    gens.forEach((r) => push("generation", r.created_at, r.type));

    // 3. Hourly crate claims (global — at most one per hour)
    const crates = await db
      .select({ claimed_at: hourlyCrateClaimsTable.claimed_at })
      .from(hourlyCrateClaimsTable)
      .where(gt(hourlyCrateClaimsTable.claimed_at, cutoff))
      .orderBy(desc(hourlyCrateClaimsTable.claimed_at))
      .limit(3);
    crates.forEach((r) => push("crate", r.claimed_at));

    // 4. Shark drop claims (claimed_at set = a real user claimed)
    const drops = await db
      .select({ claimed_at: sharkDropsTable.claimedAt })
      .from(sharkDropsTable)
      .where(and(isNotNull(sharkDropsTable.claimedAt), gt(sharkDropsTable.claimedAt, cutoff)))
      .orderBy(desc(sharkDropsTable.claimedAt))
      .limit(4);
    drops.forEach((r) => push("shark_drop", r.claimed_at));

    // 5. Contest entries (never expose handles — fully anonymized)
    const entries = await db
      .select({ created_at: contestEntriesTable.created_at })
      .from(contestEntriesTable)
      .where(gt(contestEntriesTable.created_at, cutoff))
      .orderBy(desc(contestEntriesTable.created_at))
      .limit(4);
    entries.forEach((r) => push("contest_entry", r.created_at));

    // 6. Creator level-ups
    const levelups = await db
      .select({ celebrated_at: levelCelebrationsTable.celebratedAt })
      .from(levelCelebrationsTable)
      .where(gt(levelCelebrationsTable.celebratedAt, cutoff))
      .orderBy(desc(levelCelebrationsTable.celebratedAt))
      .limit(4);
    levelups.forEach((r) => push("level_up", r.celebrated_at));

    // 7. Successful social publishes
    const publishes = await db
      .select({ created_at: socialPublishAttemptsTable.created_at })
      .from(socialPublishAttemptsTable)
      .where(and(eq(socialPublishAttemptsTable.status, "succeeded"), gt(socialPublishAttemptsTable.created_at, cutoff)))
      .orderBy(desc(socialPublishAttemptsTable.created_at))
      .limit(3);
    publishes.forEach((r) => push("publish", r.created_at));

    // 8. Lip-sync jobs started
    const lipsyncs = await db
      .select({ created_at: lipSyncJobsTable.created_at })
      .from(lipSyncJobsTable)
      .where(gt(lipSyncJobsTable.created_at, cutoff))
      .orderBy(desc(lipSyncJobsTable.created_at))
      .limit(3);
    lipsyncs.forEach((r) => push("lip_sync", r.created_at));

    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

    // Real presence: users seen within the last ONLINE_WINDOW_MINUTES.
    const onlineRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userActivityTable)
      .where(gt(userActivityTable.lastSeenAt, sql`now() - make_interval(mins => ${ONLINE_WINDOW_MINUTES})`));
    const onlineCount = onlineRows[0]?.n ?? 0;

    res.json({
      items: items.slice(0, FEED_LIMIT),
      onlineCount,
      onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[activity-feed] feed failed");
    res.status(500).json({ error: "Could not load activity feed" });
  }
});

export default router;
