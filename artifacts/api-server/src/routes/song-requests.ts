import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, liveChatMessagesTable, liveStreamsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { isUndefinedTable } from "../lib/pg-errors";
import { LIVE_TIP_MINIMUM_VB, LIVE_TIP_MAXIMUM_VB } from "../lib/live-config";
import { liveChatHub, chatMessageDtos } from "./live-chat";
import {
  SONG_REQUEST_REFUND_COPY,
  DEFAULT_REQUEST_RULES,
  getCreatorRequestRules,
  upsertCreatorRequestRules,
  getCreatorCatalog,
  getStreamRow,
  listQueue,
  submitSongRequest,
  playNextRequest,
  skipSongRequest,
  expireQueuedRequests,
  type CreatorRequestRules,
} from "../lib/song-requests";

/* ── Song Requests, Live (Stack-200 N18) ─────────────────────────────────
   Thin HTTP shell over lib/song-requests.ts (the queue service the
   Stage Manager #166 will run later). Docked surfaces only:
     GET  /live/:id/song-requests          (public) rules + catalog + queue
     POST /live/:id/song-requests          (auth)   fan submits a tipped request
     POST /live/:id/song-requests/play-next (auth, creator) advance the queue
     POST /live/:id/song-requests/:requestId/skip (auth, creator) decline + refund
     POST /live/:id/song-requests/close     (auth, creator) expire + refund all queued
     GET  /song-request-rules               (auth)   my rules + my catalog
     PUT  /song-request-rules               (auth)   set my rules (before/between streams)

   Pre-migration (9999 not yet applied): writes answer an honest 503,
   reads degrade to the honest empty state. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function notMigrated(res: Response) {
  res.status(503).json({
    error: "Song requests aren't switched on yet — the queue table is still on its way.",
    code: "NOT_MIGRATED",
  });
}

async function broadcastAnnouncement(streamId: string, messageId: string | null) {
  if (!messageId) return;
  try {
    const rows = await db
      .select()
      .from(liveChatMessagesTable)
      .where(eq(liveChatMessagesTable.id, messageId))
      .limit(1);
    if (rows[0]) {
      const dto = (await chatMessageDtos([rows[0]]))[0];
      if (dto) liveChatHub.broadcast(streamId, { type: "message", message: dto });
    }
  } catch {
    /* announcement delivery is best-effort; the queue read is the truth */
  }
  liveChatHub.broadcast(streamId, { type: "song_requests_updated" });
}

function catalogDto(rules: CreatorRequestRules, songs: Array<{ id: string; title: string; duration_sec: string | null }>) {
  return songs.map((s) => ({
    id: s.id,
    title: s.title,
    durationSec: s.duration_sec ?? null,
    excluded: rules.excludedSongIds.includes(s.id),
  }));
}

router.get("/live/:id/song-requests", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const streamId = param(req, "id");
    if (!UUID_RE.test(streamId)) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const stream = await getStreamRow(streamId);
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    let rules: CreatorRequestRules = { ...DEFAULT_REQUEST_RULES };
    let queue: Awaited<ReturnType<typeof listQueue>> = [];
    let available = true;
    try {
      rules = await getCreatorRequestRules(stream.user_id);
      queue = await listQueue(stream.id);
    } catch (err) {
      if (!isUndefinedTable(err)) throw err;
      available = false; // pre-migration: honest empty state, page still renders
    }
    const catalog = await getCreatorCatalog(stream.user_id).catch(() => []);
    res.json({
      streamId: stream.id,
      available,
      rules: {
        requestsOpen: rules.requestsOpen,
        catalogOnly: rules.catalogOnly,
        excludedSongIds: rules.excludedSongIds,
        minTipVb: rules.minTipVb,
      },
      refundCopy: SONG_REQUEST_REFUND_COPY,
      tipBounds: { minVb: LIVE_TIP_MINIMUM_VB, maxVb: LIVE_TIP_MAXIMUM_VB },
      catalog: catalogDto(rules, catalog),
      queue,
    });
  } catch (err) {
    logger.error({ err }, "song requests read failed");
    res.status(500).json({ error: "Song requests couldn't load. Try again in a moment." });
  }
});

const submitSchema = z.object({
  songId: z.string().uuid(),
  amountVb: z.number(),
  idempotencyKey: z.string().min(8).max(200),
});

router.post("/live/:id/song-requests", requireAuth, async (req: Request, res: Response) => {
  try {
    const fanUserId = req.userId;
    if (!fanUserId) {
      res.status(401).json({ error: "Sign in to request a song." });
      return;
    }
    const streamId = param(req, "id");
    if (!UUID_RE.test(streamId)) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const stream = await getStreamRow(streamId);
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const parsed = submitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A request needs a song, a tip amount, and a retry key.", code: "BAD_REQUEST" });
      return;
    }
    const result = await submitSongRequest({
      stream,
      fanUserId,
      songId: parsed.data.songId,
      amountVb: parsed.data.amountVb,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, code: result.code });
      return;
    }
    if (!result.duplicate) {
      await broadcastAnnouncement(stream.id, result.announcementMessageId);
    } else {
      liveChatHub.broadcast(stream.id, { type: "song_requests_updated" });
    }
    res.status(result.duplicate ? 200 : 201).json({ request: result.request, duplicate: result.duplicate });
  } catch (err) {
    if (isUndefinedTable(err)) return notMigrated(res);
    logger.error({ err }, "song request submit failed");
    res.status(500).json({ error: "That request didn't go through. Try again." });
  }
});

router.post("/live/:id/song-requests/play-next", requireAuth, async (req: Request, res: Response) => {
  try {
    const actorUserId = req.userId;
    if (!actorUserId) {
      res.status(401).json({ error: "Sign in to run your queue." });
      return;
    }
    const streamId = param(req, "id");
    if (!UUID_RE.test(streamId)) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const stream = await getStreamRow(streamId);
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const result = await playNextRequest(stream, actorUserId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, code: result.code });
      return;
    }
    await broadcastAnnouncement(stream.id, result.announcementMessageId);
    res.json({ finished: result.finished, nowPlaying: result.nowPlaying, queue: await listQueue(stream.id) });
  } catch (err) {
    if (isUndefinedTable(err)) return notMigrated(res);
    logger.error({ err }, "song request play-next failed");
    res.status(500).json({ error: "The queue couldn't advance. Try again." });
  }
});

router.post("/live/:id/song-requests/close", requireAuth, async (req: Request, res: Response) => {
  try {
    const actorUserId = req.userId;
    if (!actorUserId) {
      res.status(401).json({ error: "Sign in to close your queue." });
      return;
    }
    const streamId = param(req, "id");
    if (!UUID_RE.test(streamId)) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const stream = await getStreamRow(streamId);
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.user_id !== actorUserId) {
      res.status(403).json({ error: "That's not your stream.", code: "NOT_YOUR_STREAM" });
      return;
    }
    const summary = await expireQueuedRequests(stream.id);
    liveChatHub.broadcast(stream.id, { type: "song_requests_updated" });
    res.json({ ...summary, queue: await listQueue(stream.id) });
  } catch (err) {
    if (isUndefinedTable(err)) return notMigrated(res);
    logger.error({ err }, "song request queue close failed");
    res.status(500).json({ error: "The queue couldn't close. Try again." });
  }
});

router.post("/live/:id/song-requests/:requestId/skip", requireAuth, async (req: Request, res: Response) => {
  try {
    const actorUserId = req.userId;
    if (!actorUserId) {
      res.status(401).json({ error: "Sign in to run your queue." });
      return;
    }
    const requestId = param(req, "requestId");
    if (!UUID_RE.test(requestId)) {
      res.status(404).json({ error: "That request doesn't exist." });
      return;
    }
    const result = await skipSongRequest(requestId, actorUserId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, code: result.code });
      return;
    }
    liveChatHub.broadcast(param(req, "id"), { type: "song_requests_updated" });
    res.json({ request: result.request });
  } catch (err) {
    if (isUndefinedTable(err)) return notMigrated(res);
    logger.error({ err }, "song request skip failed");
    res.status(500).json({ error: "That skip didn't go through. Try again." });
  }
});

router.get("/song-request-rules", requireAuth, async (req: Request, res: Response) => {
  try {
    const creatorUserId = req.userId;
    if (!creatorUserId) {
      res.status(401).json({ error: "Sign in to set your request rules." });
      return;
    }
    let rules: CreatorRequestRules = { ...DEFAULT_REQUEST_RULES };
    let available = true;
    try {
      rules = await getCreatorRequestRules(creatorUserId);
    } catch (err) {
      if (!isUndefinedTable(err)) throw err;
      available = false;
    }
    const catalog = await getCreatorCatalog(creatorUserId).catch(() => []);
    // The creator's own current live stream, if any — the desk docks
    // its queue controls to it.
    const liveRows = await db
      .select({ id: liveStreamsTable.id })
      .from(liveStreamsTable)
      .where(and(eq(liveStreamsTable.user_id, creatorUserId), eq(liveStreamsTable.status, "live")))
      .limit(1)
      .catch(() => [] as Array<{ id: string }>);
    res.json({
      available,
      rules,
      refundCopy: SONG_REQUEST_REFUND_COPY,
      tipBounds: { minVb: LIVE_TIP_MINIMUM_VB, maxVb: LIVE_TIP_MAXIMUM_VB },
      catalog: catalogDto(rules, catalog),
      liveStreamId: liveRows[0]?.id ?? null,
    });
  } catch (err) {
    logger.error({ err }, "song request rules read failed");
    res.status(500).json({ error: "Your request rules couldn't load. Try again in a moment." });
  }
});

const rulesSchema = z.object({
  requestsOpen: z.boolean(),
  catalogOnly: z.boolean(),
  excludedSongIds: z.array(z.string().uuid()).max(500),
  minTipVb: z.number().int().min(LIVE_TIP_MINIMUM_VB).max(LIVE_TIP_MAXIMUM_VB).nullable(),
});

router.put("/song-request-rules", requireAuth, async (req: Request, res: Response) => {
  try {
    const creatorUserId = req.userId;
    if (!creatorUserId) {
      res.status(401).json({ error: "Sign in to set your request rules." });
      return;
    }
    const parsed = rulesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Rules need open/closed, catalog-only, the excluded songs, and a minimum tip (or none).",
        code: "BAD_RULES",
      });
      return;
    }
    // Excluded songs must be the creator's own catalog songs — a rule
    // can only take out songs that could be requested in the first place.
    const catalog = await getCreatorCatalog(creatorUserId);
    const catalogIds = new Set(catalog.map((s) => s.id));
    const bad = parsed.data.excludedSongIds.filter((id) => !catalogIds.has(id));
    if (bad.length > 0) {
      res.status(400).json({ error: "Excluded songs must come from your own catalog.", code: "BAD_EXCLUDED" });
      return;
    }
    const rules = await upsertCreatorRequestRules(creatorUserId, {
      requestsOpen: parsed.data.requestsOpen,
      catalogOnly: parsed.data.catalogOnly,
      excludedSongIds: parsed.data.excludedSongIds,
      minTipVb: parsed.data.minTipVb,
    });
    res.json({ rules, refundCopy: SONG_REQUEST_REFUND_COPY });
  } catch (err) {
    if (isUndefinedTable(err)) return notMigrated(res);
    logger.error({ err }, "song request rules write failed");
    res.status(500).json({ error: "Your rules couldn't be saved. Try again." });
  }
});

export default router;
