import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, liveStreamsTable, type LiveStream } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { isUndefinedTable } from "../lib/pg-errors";
import {
  reportNowPlaying,
  clearNowPlaying,
  readNowPlayingForCreator,
  toNowPlayingDto,
  type NowPlayingDto,
} from "../lib/now-playing";
import { resolveOverlayToken } from "../lib/overlay-events";

/* ── Live Now Playing (stack900 lane D3) ───────────────────────────────
   The feed lane C2's stream overlays were missing: a server-side
   "now playing" for a live stream, so the /overlay/now-playing
   browser source can show the track on the creator's program.

     POST   /live/:id/now-playing    (auth, owner, live only) the
                                     studio reports the track that
                                     just started on its program —
                                     and re-reports it as a heartbeat
                                     while it keeps playing.
     DELETE /live/:id/now-playing    (auth, owner) the track stopped.
     GET    /overlay/now-playing     (overlay token) the public read
                                     the overlay page renders: title
                                     + artist + duration + timing, or
                                     an honest null. No user ids, no
                                     stream ids — nothing the stream
                                     itself doesn't already show.

   The only writer is the stream's owner, and only while the stream
   is live — a report against an ended stream or someone else's
   stream is refused, never stored. The TTL rules that keep a dead
   tab from leaving a song "playing" forever live in
   lib/now-playing.ts (computeNowPlayingExpiry).

   Pre-migration (0302 not yet applied): writes answer an honest
   503, the read degrades to the honest empty state. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function notMigrated(res: Response) {
  res.status(503).json({
    error: "Now playing isn't switched on yet — its table is still on its way.",
    code: "NOT_MIGRATED",
  });
}

async function getStreamRow(streamId: string): Promise<LiveStream | null> {
  const rows = await db
    .select()
    .from(liveStreamsTable)
    .where(eq(liveStreamsTable.id, streamId))
    .limit(1);
  return rows[0] ?? null;
}

/** The gates every write passes: the stream exists, it is the
 *  caller's, and it is live. Answers the response and returns null
 *  when a gate refuses. */
async function gateWrite(
  req: Request,
  res: Response,
): Promise<{ stream: LiveStream; userId: string } | null> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to report what's playing." });
    return null;
  }
  const streamId = param(req, "id");
  if (!UUID_RE.test(streamId)) {
    res.status(404).json({ error: "That stream doesn't exist." });
    return null;
  }
  const stream = await getStreamRow(streamId);
  if (!stream) {
    res.status(404).json({ error: "That stream doesn't exist." });
    return null;
  }
  if (stream.user_id !== userId) {
    res.status(403).json({ error: "That's not your stream.", code: "NOT_YOUR_STREAM" });
    return null;
  }
  if (stream.status !== "live") {
    res.status(409).json({ error: "That stream isn't live.", code: "NOT_LIVE" });
    return null;
  }
  return { stream, userId };
}

const reportSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
  /* The track's length in seconds when the studio knows it. Bounded
     to a day so a junk duration can never mint a junk expiry (the
     TTL horizon caps it again server-side regardless). */
  durationSec: z.number().int().min(1).max(86_400).nullable().optional(),
});

router.post("/live/:id/now-playing", requireAuth, async (req: Request, res: Response) => {
  try {
    const gated = await gateWrite(req, res);
    if (!gated) return;
    const parsed = reportSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "A now-playing report needs the track's title and artist, and its length in seconds when you know it.",
        code: "BAD_REPORT",
      });
      return;
    }
    const row = await reportNowPlaying({
      streamId: gated.stream.id,
      creatorUserId: gated.userId,
      title: parsed.data.title,
      artist: parsed.data.artist,
      durationSec: parsed.data.durationSec ?? null,
    });
    res.json({ nowPlaying: toNowPlayingDto(row) } satisfies OverlayNowPlayingDto);
  } catch (err) {
    if (isUndefinedTable(err)) return notMigrated(res);
    logger.error({ err }, "now-playing report failed");
    res.status(500).json({ error: "That report didn't land. Try again." });
  }
});

router.delete("/live/:id/now-playing", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to clear what's playing." });
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
    if (stream.user_id !== userId) {
      res.status(403).json({ error: "That's not your stream.", code: "NOT_YOUR_STREAM" });
      return;
    }
    /* No live gate on the clear: stopping is always safe to say,
       including as the stream itself is ending. */
    await clearNowPlaying(stream.id);
    res.json({ ok: true });
  } catch (err) {
    if (isUndefinedTable(err)) return notMigrated(res);
    logger.error({ err }, "now-playing clear failed");
    res.status(500).json({ error: "That clear didn't land. Try again." });
  }
});

export interface OverlayNowPlayingDto {
  nowPlaying: NowPlayingDto | null;
}

router.get("/overlay/now-playing", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const raw = req.query["token"];
    const token = typeof raw === "string" ? raw : "";
    /* Resolved through lane C2's canonical resolver
       (lib/overlay-events) — one token, one rule set for every
       overlay surface. */
    const userId = await resolveOverlayToken(token);
    if (!userId) {
      res.status(401).json({ error: "That overlay link is no longer valid. Get a fresh one from your Stream Widgets desk." });
      return;
    }
    let nowPlaying: NowPlayingDto | null = null;
    try {
      nowPlaying = await readNowPlayingForCreator(userId);
    } catch (err) {
      if (!isUndefinedTable(err)) throw err;
      nowPlaying = null; // pre-migration: the honest empty state
    }
    const dto: OverlayNowPlayingDto = { nowPlaying };
    res.json(dto);
  } catch (err) {
    logger.error({ err }, "overlay now-playing read failed");
    res.status(500).json({ error: "The overlay couldn't load. Try again in a moment." });
  }
});

export default router;
