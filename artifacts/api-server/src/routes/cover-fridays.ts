import { Router, type Request, type Response } from "express";
import { and, eq, gt, lte, inArray } from "drizzle-orm";
import { db, profileVideosTable, playEventsTable, creatorProfilesTable } from "@workspace/db";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { coverFridayCycle, rankCoverEntries, coverFridayWinner, COVER_FRIDAY_TAG } from "../lib/cover-fridays";

/* ─── Cover Fridays (N19) ────────────────────────────────────────────────
   GET /api/cover-fridays/current — this week's cycle (theme + window from
   lib/cover-fridays) and the REAL leaderboard: profile videos tagged
   #CoverFriday inside the window, ranked by counted play_events. Plays
   are measured, never estimated; with no entries the board is honestly
   empty and the panel invites the first cover. */

const router = Router();

router.get("/cover-fridays/current", publicApiLimiter, async (_req: Request, res: Response) => {
  const cycle = coverFridayCycle(Date.now());
  try {
    const videos = await db
      .select({
        id: profileVideosTable.id,
        title: profileVideosTable.title,
        profileId: profileVideosTable.profileId,
        createdAt: profileVideosTable.createdAt,
        tags: profileVideosTable.tags,
      })
      .from(profileVideosTable)
      .where(and(gt(profileVideosTable.createdAt, new Date(cycle.opensAt - 7 * 24 * 3600_000)), lte(profileVideosTable.createdAt, new Date(cycle.closesAt))))
      .limit(500);
    const entries = videos.filter((v) =>
      (v.tags ?? []).some((t) => t.replace(/^#/, "").toLowerCase() === COVER_FRIDAY_TAG.toLowerCase()),
    );
    let playsById = new Map<string, number>();
    if (entries.length > 0) {
      const plays = await db
        .select({ mediaId: playEventsTable.mediaId })
        .from(playEventsTable)
        .where(and(eq(playEventsTable.kind, "video"), inArray(playEventsTable.mediaId, entries.map((e) => e.id))))
        .limit(100000);
      playsById = plays.reduce((m, p) => m.set(p.mediaId, (m.get(p.mediaId) ?? 0) + 1), new Map<string, number>());
    }
    const profileIds = [...new Set(entries.map((e) => e.profileId))];
    const profiles = profileIds.length
      ? await db
          .select({ id: creatorProfilesTable.id, displayName: creatorProfilesTable.displayName, slug: creatorProfilesTable.slug })
          .from(creatorProfilesTable)
          .where(inArray(creatorProfilesTable.id, profileIds))
      : [];
    const byProfile = new Map(profiles.map((p) => [p.id, p]));
    const board = rankCoverEntries(
      entries.map((e) => ({
        id: e.id,
        title: e.title,
        plays: playsById.get(e.id) ?? 0,
        createdAt: e.createdAt.getTime(),
        creator: byProfile.get(e.profileId)
          ? { name: byProfile.get(e.profileId)!.displayName, slug: byProfile.get(e.profileId)!.slug }
          : null,
      })),
    ).slice(0, 20);
    const winner = cycle.phase === "closed" ? coverFridayWinner(board) : null;
    return res.json({ cycle, entries: board, winner, tag: `#${COVER_FRIDAY_TAG}` });
  } catch (err) {
    logger.warn({ err }, "cover-fridays: leaderboard read failed; cycle still served");
    return res.json({ cycle, entries: [], winner: null, tag: `#${COVER_FRIDAY_TAG}` });
  }
});

export default router;
