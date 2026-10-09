import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { getRetentionPrefs, getStreakStatus } from "../lib/retention";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  db,
  exportJobsTable,
  bowRaceMonthsTable,
  cheatCodeEventsTable,
  userActivityTable,
} from "@workspace/db";
import { eq, gt, and, inArray, lte, desc } from "drizzle-orm";

const router = Router();

/* ─── Thy Daily Drop + While You Were Away ────────────────────────────────
   GET /api/retention/daily-drop  — today's drop (date-seeded rotation)
   GET /api/retention/away-digest — "while you were away" digest (24h+ away)
   Content/status only — NO Visual Bucs payouts anywhere here. Both honor
   their retention_prefs toggles; the digest modal is dismissible on the
   client and fires at most once per return. */

/* ── Daily Drop catalogue ───────────────────────────────────────────────
   30 curated drops, deterministic by UTC date (same drop for everyone).
   Every href is a verified deep-link into a real tool:
     thumbnail → /thumbnail-studio?template=<slug>   (verified receiver)
     hook      → /hooks?template=<slug>              (verified receiver)
     caption   → /hooks?tab=captions&template=<slug> (verified receiver)
     video     → /templates/videos?tab=templates&template=<key> (verified)
   Titles/descriptions live in the frontend locales (retention.drops.<key>). */

export type DailyDropKind = "thumbnail" | "caption" | "video" | "hook";

export interface DailyDropDef {
  key: string;
  kind: DailyDropKind;
  href: string;
}

export const DAILY_DROPS: DailyDropDef[] = [
  { key: "fitness-transformation-youtube-thumbnail", kind: "thumbnail", href: "/thumbnail-studio?template=fitness-transformation-youtube-thumbnail" },
  { key: "new-single-release-hook",                  kind: "hook",      href: "/hooks?template=new-single-release-hook" },
  { key: "single-release-captions",                  kind: "caption",   href: "/hooks?tab=captions&template=single-release-captions" },
  { key: "photo-dump-montage",                       kind: "video",     href: "/templates/videos?tab=templates&template=photo-dump-montage" },
  { key: "podcast-episode-thumbnail",                kind: "thumbnail", href: "/thumbnail-studio?template=podcast-episode-thumbnail" },
  { key: "music-video-premiere-hook",                kind: "hook",      href: "/hooks?template=music-video-premiere-hook" },
  { key: "music-video-launch-captions",              kind: "caption",   href: "/hooks?tab=captions&template=music-video-launch-captions" },
  { key: "lyric-sync-cut",                           kind: "video",     href: "/templates/videos?tab=templates&template=lyric-sync-cut" },
  { key: "gaming-video-thumbnail",                   kind: "thumbnail", href: "/thumbnail-studio?template=gaming-video-thumbnail" },
  { key: "tour-announcement-hook",                   kind: "hook",      href: "/hooks?template=tour-announcement-hook" },
  { key: "album-announcement-captions",              kind: "caption",   href: "/hooks?tab=captions&template=album-announcement-captions" },
  { key: "product-promo-punch",                      kind: "video",     href: "/templates/videos?tab=templates&template=product-promo-punch" },
  { key: "money-finance-youtube-thumbnail",          kind: "thumbnail", href: "/thumbnail-studio?template=money-finance-youtube-thumbnail" },
  { key: "studio-session-hook",                      kind: "hook",      href: "/hooks?template=studio-session-hook" },
  { key: "tour-promo-captions",                      kind: "caption",   href: "/hooks?tab=captions&template=tour-promo-captions" },
  { key: "before-after-reveal",                      kind: "video",     href: "/templates/videos?tab=templates&template=before-after-reveal" },
  { key: "vlog-travel-thumbnail",                    kind: "thumbnail", href: "/thumbnail-studio?template=vlog-travel-thumbnail" },
  { key: "day-in-the-life-hook",                     kind: "hook",      href: "/hooks?template=day-in-the-life-hook" },
  { key: "merch-drop-captions",                      kind: "caption",   href: "/hooks?tab=captions&template=merch-drop-captions" },
  { key: "travel-recap",                             kind: "video",     href: "/templates/videos?tab=templates&template=travel-recap" },
  { key: "youtube-shorts-thumbnail",                 kind: "thumbnail", href: "/thumbnail-studio?template=youtube-shorts-thumbnail" },
  { key: "songwriting-process-hook",                 kind: "hook",      href: "/hooks?template=songwriting-process-hook" },
  { key: "stream-milestone-captions",                kind: "caption",   href: "/hooks?tab=captions&template=stream-milestone-captions" },
  { key: "talking-head-polish",                      kind: "video",     href: "/templates/videos?tab=templates&template=talking-head-polish" },
  { key: "tech-review-thumbnail",                    kind: "thumbnail", href: "/thumbnail-studio?template=tech-review-thumbnail" },
  { key: "mixing-tips-hook",                        kind: "hook",      href: "/hooks?template=mixing-tips-hook" },
  { key: "question-engagement-captions",             kind: "caption",   href: "/hooks?tab=captions&template=question-engagement-captions" },
  { key: "hype-trailer",                             kind: "video",     href: "/templates/videos?tab=templates&template=hype-trailer" },
  { key: "music-video-thumbnail",                    kind: "thumbnail", href: "/thumbnail-studio?template=music-video-thumbnail" },
  { key: "grow-on-tiktok-hook",                      kind: "hook",      href: "/hooks?template=grow-on-tiktok-hook" },
];

/** UTC calendar day → rotation index. Deterministic, same for everyone. */
export function dropIndexForDate(dateStr: string): number {
  const DAY_MS = 86_400_000;
  const parsed = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(parsed)) return 0;
  const day = Math.floor(parsed / DAY_MS);
  return ((day % DAILY_DROPS.length) + DAILY_DROPS.length) % DAILY_DROPS.length;
}

/** UTC date string, optionally offset by whole days. */
export function utcDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/* ── Activity touch ─────────────────────────────────────────────────────
   Scoped to the retention routes: last_seen_at updates (upsert) whenever
   the user hits these endpoints. Fire-and-forget — never blocks the reply. */

async function touchUserActivity(userId: string): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(userActivityTable)
      .values({ userId, lastSeenAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userActivityTable.userId,
        set: { lastSeenAt: now, updatedAt: now },
      });
  } catch (err) {
    logger.warn({ err, userId }, "[retention-drops] touchUserActivity failed");
  }
}

/* ── GET /api/retention/daily-drop ──────────────────────────────────────
   Today's drop (date-seeded rotation). Respects daily_drop_enabled. */

router.get("/retention/daily-drop", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const prefs = await getRetentionPrefs(userId);
    void touchUserActivity(userId);
    if (!prefs.daily_drop_enabled) {
      res.json({ enabled: false });
      return;
    }
    const date = utcDate();
    const index = dropIndexForDate(date);
    const drop = DAILY_DROPS[index]!;
    res.json({
      enabled: true,
      date,
      index,
      total: DAILY_DROPS.length,
      drop,
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-drops] daily-drop failed");
    res.status(500).json({ error: "Could not load today's drop" });
  }
});

/* ── GET /api/retention/away-digest ─────────────────────────────────────
   "While You Were Away": fires when last_seen_at is 24h+ ago.
   Renders/jobs completed while away, new projects, Bow Race + jackpot
   status, the last 3 daily drops missed, and creation streak status.
   Respects away_digest_enabled. Marks the user seen (upsert) so the digest
   fires at most once per return. */

interface DigestJob {
  id: string;
  projectId: string | null;
  state: string;
  stage: string | null;
  completedAt: string | null;
}

interface DigestProject {
  id: string;
  title: string | null;
  projectType: string;
}

router.get("/retention/away-digest", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const prefs = await getRetentionPrefs(userId);
    if (!prefs.away_digest_enabled) {
      res.json({ show: false, reason: "disabled" });
      return;
    }

    const now = new Date();
    const activityRows = await db
      .select({ lastSeenAt: userActivityTable.lastSeenAt })
      .from(userActivityTable)
      .where(eq(userActivityTable.userId, userId))
      .limit(1);
    const activity = activityRows[0];

    if (!activity) {
      // First tracked visit — seed the row; nothing to digest yet.
      await db
        .insert(userActivityTable)
        .values({ userId, lastSeenAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: userActivityTable.userId,
          set: { lastSeenAt: now, updatedAt: now },
        });
      res.json({ show: false, reason: "first-visit" });
      return;
    }

    const lastSeen = activity.lastSeenAt;
    const hoursAway = (now.getTime() - lastSeen.getTime()) / 3_600_000;

    if (hoursAway < 24) {
      void touchUserActivity(userId);
      res.json({
        show: false,
        reason: "recent",
        hoursAway: Math.round(hoursAway * 10) / 10,
      });
      return;
    }

    const currentPeriod = now.toISOString().slice(0, 7); // YYYY-MM

    // The projects table has no drizzle model — use the admin client like
    // routes/projects.ts does.
    const admin = getSupabaseAdmin();

    const [jobsRows, raceRows, jackpotRows, projectsRes, streak] = await Promise.all([
      // Export renders that finished (or failed) while the user was away.
      db
        .select({
          id: exportJobsTable.id,
          projectRef: exportJobsTable.project_id,
          state: exportJobsTable.state,
          stage: exportJobsTable.stage,
          updatedAt: exportJobsTable.updated_at,
        })
        .from(exportJobsTable)
        .where(
          and(
            eq(exportJobsTable.user_id, userId),
            gt(exportJobsTable.updated_at, lastSeen),
            inArray(exportJobsTable.state, ["done", "failed"])
          )
        )
        .orderBy(desc(exportJobsTable.updated_at))
        .limit(5)
        .catch((err) => {
          logger.warn({ err, userId }, "[retention-drops] export jobs read failed");
          return [];
        }),
      db
        .select({
          period: bowRaceMonthsTable.period,
          target: bowRaceMonthsTable.target,
          totalBows: bowRaceMonthsTable.totalBows,
          winnerUserId: bowRaceMonthsTable.winnerUserId,
        })
        .from(bowRaceMonthsTable)
        .where(eq(bowRaceMonthsTable.period, currentPeriod))
        .limit(1)
        .catch((err) => {
          logger.warn({ err, userId }, "[retention-drops] bow race read failed");
          return [];
        }),
      db
        .select({
          name: cheatCodeEventsTable.name,
          prizeCredits: cheatCodeEventsTable.prizeCredits,
          codeLength: cheatCodeEventsTable.codeLength,
          endsAt: cheatCodeEventsTable.endsAt,
        })
        .from(cheatCodeEventsTable)
        .where(
          and(
            eq(cheatCodeEventsTable.isActive, true),
            lte(cheatCodeEventsTable.startsAt, now),
            gt(cheatCodeEventsTable.endsAt, now)
          )
        )
        .orderBy(cheatCodeEventsTable.endsAt)
        .limit(1)
        .catch((err) => {
          logger.warn({ err, userId }, "[retention-drops] jackpot read failed");
          return [];
        }),
      admin
        .from("projects")
        .select("id,title,project_type")
        .eq("user_id", userId)
        .gt("created_at", lastSeen.toISOString())
        .order("created_at", { ascending: false })
        .limit(5)
        .then(
          (r) => r,
          (err: unknown) => {
            logger.warn({ err, userId }, "[retention-drops] projects read failed");
            return { data: null as null, error: err as Error };
          }
        ),
      getStreakStatus(userId).catch((err) => {
        logger.warn({ err, userId }, "[retention-drops] streak read failed");
        return null;
      }),
    ]);

    const completedJobs: DigestJob[] = [];
    let failedJobs = 0;
    for (const j of jobsRows) {
      if (j.state === "done") {
        completedJobs.push({
          id: j.id,
          projectId: j.projectRef,
          state: "done",
          stage: j.stage,
          completedAt: j.updatedAt.toISOString(),
        });
      } else {
        failedJobs += 1;
      }
    }

    const newProjects: DigestProject[] = [];
    if (!projectsRes.error && Array.isArray(projectsRes.data)) {
      for (const p of projectsRes.data) {
        const row = p as Record<string, unknown>;
        newProjects.push({
          id: String(row["id"]),
          title: row["title"] ? String(row["title"]) : null,
          projectType: String(row["project_type"] ?? "project"),
        });
      }
    }

    const race = raceRows[0];
    const bowRace = race
      ? {
          period: race.period,
          target: race.target,
          totalBows: race.totalBows,
          won: race.winnerUserId != null,
          youWon: race.winnerUserId === userId,
        }
      : null;

    const jp = jackpotRows[0];
    const jackpot = jp
      ? {
          name: jp.name,
          prizeCredits: jp.prizeCredits,
          codeLength: jp.codeLength,
          endsAt: jp.endsAt.toISOString(),
        }
      : null;

    // Daily drops missed while away — last 3 calendar days (pure function,
    // same rotation the Daily Drop card uses).
    const missedDrops = [1, 2, 3].map((back) => {
      const date = utcDate(-back);
      const drop = DAILY_DROPS[dropIndexForDate(date)]!;
      return { date, key: drop.key, kind: drop.kind, href: drop.href };
    });

    // Mark seen — the digest fires at most once per return.
    await db
      .insert(userActivityTable)
      .values({ userId, lastSeenAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userActivityTable.userId,
        set: { lastSeenAt: now, updatedAt: now },
      });

    res.json({
      show: true,
      lastSeenAt: lastSeen.toISOString(),
      hoursAway: Math.round(hoursAway * 10) / 10,
      completedJobs,
      failedJobs,
      newProjects,
      bowRace,
      jackpot,
      missedDrops,
      streak: streak
        ? {
            currentStreak: streak.currentStreak,
            longestStreak: streak.longestStreak,
            lastCreationDate: streak.lastCreationDate,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention-drops] away-digest failed");
    res.status(500).json({ error: "Could not load your away digest" });
  }
});

export default router;
