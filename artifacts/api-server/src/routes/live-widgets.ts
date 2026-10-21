import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveStreamTipsTable,
  followsTable,
  creatorProfilesTable,
  type LiveStream,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

/* ── Overlay widget data ─────────────────────────────────────────────────
   GET  /live/:id/widgets     (public) the real data the three overlay
                              widgets render from: latest follower,
                              recent tips, and the tip goal's progress.
                              Nothing is estimated — a stream with no
                              followers/tips/goal gets honest nulls and
                              empty lists, and the widgets stay
                              invisible on the program output.
   POST /live/:id/tip-goal    (auth, owner) set (or clear, with null)
                              the stream's Visual Bucs tip goal. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getStreamRow(id: string): Promise<LiveStream | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface LiveWidgetsDto {
  streamId: string;
  latestFollower: { displayName: string; slug: string | null; followedAt: string } | null;
  recentTips: Array<{ tipperName: string; amountVb: number; createdAt: string }>;
  goal: { goalVb: number | null; totalVb: number; tipCount: number };
}

router.get("/live/:id/widgets", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }

    // Latest follower of the channel (real follows rows, newest first).
    let latestFollower: LiveWidgetsDto["latestFollower"] = null;
    const followRows = await db
      .select()
      .from(followsTable)
      .where(eq(followsTable.profileId, stream.profile_id))
      .orderBy(desc(followsTable.createdAt))
      .limit(1);
    const follow = followRows[0];
    if (follow) {
      const profiles = await db
        .select({ displayName: creatorProfilesTable.displayName, slug: creatorProfilesTable.slug })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.userId, follow.followerUserId))
        .limit(1);
      latestFollower = {
        displayName: profiles[0]?.displayName ?? "Someone",
        slug: profiles[0]?.slug ?? null,
        followedAt: new Date(follow.createdAt).toISOString(),
      };
    }

    const tipRows = await db
      .select()
      .from(liveStreamTipsTable)
      .where(eq(liveStreamTipsTable.stream_id, stream.id))
      .orderBy(desc(liveStreamTipsTable.created_at))
      .limit(10);
    const tipperIds = [...new Set(tipRows.map((t) => t.tipper_user_id))];
    const nameByUser = new Map<string, string>();
    if (tipperIds.length) {
      const profiles = await db
        .select({ userId: creatorProfilesTable.userId, displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(inArray(creatorProfilesTable.userId, tipperIds));
      for (const p of profiles) nameByUser.set(p.userId, p.displayName);
    }
    const recentTips = tipRows.map((t) => ({
      tipperName: nameByUser.get(t.tipper_user_id) ?? "Someone",
      amountVb: t.amount_vb,
      createdAt: new Date(t.created_at).toISOString(),
    }));
    const totalVb = tipRows.reduce((sum, t) => sum + (t.amount_vb ?? 0), 0);

    // The goal total counts ALL tips on the stream, not just the
    // recent window — recount from the full set when the recent
    // window came back full.
    let goalTotalVb = totalVb;
    let tipCount = tipRows.length;
    if (tipRows.length === 10) {
      const all = await db
        .select({ amount_vb: liveStreamTipsTable.amount_vb })
        .from(liveStreamTipsTable)
        .where(eq(liveStreamTipsTable.stream_id, stream.id));
      goalTotalVb = all.reduce((sum, t) => sum + (t.amount_vb ?? 0), 0);
      tipCount = all.length;
    }

    const dto: LiveWidgetsDto = {
      streamId: stream.id,
      latestFollower,
      recentTips,
      goal: { goalVb: stream.tip_goal_vb ?? null, totalVb: goalTotalVb, tipCount },
    };
    res.json(dto);
  } catch (err) {
    logger.error({ err }, "live widgets failed");
    res.status(500).json({ error: "Widgets couldn't load. Try again in a moment." });
  }
});

const goalSchema = z.object({ goalVb: z.number().int().min(0).max(100_000_000).nullable() });

router.post("/live/:id/tip-goal", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.user_id !== userId) {
      res.status(403).json({ error: "Only the streamer sets the tip goal." });
      return;
    }
    const parsed = goalSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A goal is a whole number of Visual Bucs, or clear it with null." });
      return;
    }
    const goalVb = parsed.data.goalVb === 0 ? null : parsed.data.goalVb;
    await db
      .update(liveStreamsTable)
      .set({ tip_goal_vb: goalVb, updated_at: new Date() })
      .where(and(eq(liveStreamsTable.id, stream.id), eq(liveStreamsTable.user_id, userId)));
    res.json({ streamId: stream.id, goalVb });
  } catch (err) {
    logger.error({ err }, "live tip-goal set failed");
    res.status(500).json({ error: "That goal couldn't be saved. Try again." });
  }
});

export default router;
