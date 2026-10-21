import { Router, type Request, type Response } from "express";
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveChatMessagesTable,
  liveStreamTipsTable,
  liveViewerSamplesTable,
  followsTable,
  type LiveStream,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";

/* ── Post-stream summary ─────────────────────────────────────────────────
   GET /live/:id/summary (auth, stream owner only)
   Every number is computed from real rows written during the
   stream: peak viewers persisted by the heartbeat route, average
   from the throttled viewer samples, chat count from the chat
   table (soft-deleted rows excluded), tips from the tips table,
   and new followers from follows rows inside the stream window.
   A metric with no data reads honestly: averageViewers is null
   (rendered "unavailable") when no samples were ever recorded —
   it is never back-filled from the peak. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export interface LiveStreamSummaryDto {
  streamId: string;
  title: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  peakViewers: number;
  /** Mean of the heartbeat samples; null when no samples exist. */
  averageViewers: number | null;
  viewerSampleCount: number;
  chatMessageCount: number;
  tipsTotalVb: number;
  tipCount: number;
  newFollowers: number;
}

router.get("/live/:id/summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to see your stream summary." });
      return;
    }
    const id = param(req, "id");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
    const stream: LiveStream | undefined = rows[0];
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.user_id !== userId) {
      res.status(403).json({ error: "Stream summaries belong to the streamer." });
      return;
    }

    const startedAt = stream.started_at ? new Date(stream.started_at) : null;
    const endedAt = stream.ended_at ? new Date(stream.ended_at) : null;
    const durationSec =
      startedAt != null
        ? Math.max(0, Math.round(((endedAt ?? new Date()).getTime() - startedAt.getTime()) / 1000))
        : 0;

    const samples = await db
      .select({ viewer_count: liveViewerSamplesTable.viewer_count })
      .from(liveViewerSamplesTable)
      .where(eq(liveViewerSamplesTable.stream_id, stream.id));
    const averageViewers = samples.length
      ? Math.round((samples.reduce((s, r) => s + (r.viewer_count ?? 0), 0) / samples.length) * 10) / 10
      : null;

    const chatRows = await db
      .select({ id: liveChatMessagesTable.id })
      .from(liveChatMessagesTable)
      .where(and(eq(liveChatMessagesTable.stream_id, stream.id), isNull(liveChatMessagesTable.deleted_at)));

    const tipRows = await db
      .select({ amount_vb: liveStreamTipsTable.amount_vb })
      .from(liveStreamTipsTable)
      .where(eq(liveStreamTipsTable.stream_id, stream.id));

    const followRows = await db
      .select({ createdAt: followsTable.createdAt })
      .from(followsTable)
      .where(eq(followsTable.profileId, stream.profile_id));
    const newFollowers = followRows.filter((f) => {
      const at = new Date(f.createdAt).getTime();
      if (startedAt && at < startedAt.getTime()) return false;
      if (endedAt && at > endedAt.getTime()) return false;
      return true;
    }).length;

    const dto: LiveStreamSummaryDto = {
      streamId: stream.id,
      title: stream.title,
      status: stream.status,
      startedAt: startedAt ? startedAt.toISOString() : null,
      endedAt: endedAt ? endedAt.toISOString() : null,
      durationSec,
      peakViewers: stream.peak_viewers ?? 0,
      averageViewers,
      viewerSampleCount: samples.length,
      chatMessageCount: chatRows.length,
      tipsTotalVb: tipRows.reduce((s, r) => s + (r.amount_vb ?? 0), 0),
      tipCount: tipRows.length,
      newFollowers,
    };
    res.json({ summary: dto });
  } catch (err) {
    logger.error({ err }, "live summary failed");
    res.status(500).json({ error: "Your stream summary couldn't load. Try again." });
  }
});

export default router;
