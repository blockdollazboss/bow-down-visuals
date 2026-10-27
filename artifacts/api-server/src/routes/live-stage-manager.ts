/**
 * live-stage-manager.ts — Stage Manager (#166) control surface.
 *
 *   GET  /live-streams/:id/stage-manager        (owner)
 *        → the co-host's persisted state for this stream (muted,
 *          current pin) + the recent trouble flags it raised.
 *   POST /live-streams/:id/stage-manager/mute   (owner) { muted }
 *        → the creator mutes/unmutes the co-host mid-stream; every
 *          co-host action checks this first.
 *   POST /live-streams/:id/stage-manager/unpin  (owner)
 *        → the creator clears the co-host's pin (a paid pin is a
 *          different record and is never touched here).
 *
 * The per-action switches + link rules live on /api/live-prefs
 * (creator_live_prefs). Peace law: nothing here can act on a person —
 * mute is the creator muting the CO-HOST, unpin clears the co-host's
 * own pin.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, liveStreamsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import {
  drizzleStageManagerStore,
  recentStageFlags,
} from "../lib/stage-manager";
import { getActiveStagePin, liveChatHub } from "./live-chat";

const router = Router();

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function ownedStream(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in first." });
    return null;
  }
  const rows = await db
    .select()
    .from(liveStreamsTable)
    .where(eq(liveStreamsTable.id, param(req, "id")))
    .limit(1);
  const stream = rows[0];
  if (!stream) {
    res.status(404).json({ error: "That stream doesn't exist." });
    return null;
  }
  if (stream.user_id !== userId) {
    res.status(403).json({ error: "The Stage Manager answers to the stream's creator." });
    return null;
  }
  return stream;
}

router.get("/live-streams/:id/stage-manager", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const state = await drizzleStageManagerStore.getState(stream.id);
    res.json({
      streamId: stream.id,
      muted: state.muted,
      pinnedMessageId: state.pinnedMessageId,
      pinnedUntil: state.pinnedUntil ? state.pinnedUntil.toISOString() : null,
      stagePinned: await getActiveStagePin(stream.id).catch(() => null),
      flags: recentStageFlags(stream.id).map((f) => ({
        at: new Date(f.at).toISOString(),
        reason: f.reason,
        messageId: f.messageId,
      })),
    });
  } catch (err) {
    logger.error({ err }, "stage-manager state read failed");
    res.status(500).json({ error: "Stage Manager state couldn't load." });
  }
});

const muteSchema = z.object({ muted: z.boolean() });

router.post("/live-streams/:id/stage-manager/mute", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const parsed = muteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Say whether the co-host is muted (true) or live (false)." });
      return;
    }
    await drizzleStageManagerStore.setMuted(stream.id, parsed.data.muted);
    res.json({ streamId: stream.id, muted: parsed.data.muted });
  } catch (err) {
    logger.error({ err }, "stage-manager mute failed");
    res.status(500).json({ error: "The co-host's mute didn't save." });
  }
});

router.post("/live-streams/:id/stage-manager/unpin", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    await drizzleStageManagerStore.setPin(stream.id, null, null);
    liveChatHub.broadcast(stream.id, { type: "stage_pin_updated", stagePinned: null });
    res.json({ streamId: stream.id, stagePinned: null });
  } catch (err) {
    logger.error({ err }, "stage-manager unpin failed");
    res.status(500).json({ error: "The co-host's pin didn't clear." });
  }
});

export default router;
