import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { db, shareEventsTable } from "@workspace/db";
import { recordShareEvent } from "../lib/retention";

const router = Router();

/* ─── Share-to-earn viral loop: share tracking ────────────────────────────
   POST /api/shares — record one share action from a ShareMenu
     (native share / X / WhatsApp / copy link / …).
   Body: { content_type, content_id?, channel }
   - One row per event in share_events (powers future virality analytics).
   - Fire-and-forget quest hook: recordShareEvent() advances the weekly
     "Viral Sharer" quest (3 shares/week) without touching creation
     streaks, and honors quests_enabled + share_to_earn_enabled.
   Free: a DB row, zero provider spend — a growth loop, not a cost center. */

const CONTENT_TYPES = [
  "video",
  "song",
  "thumbnail",
  "showcase",
  "review_link",
  "winner_card",
  "other",
] as const;

const CHANNELS = [
  "native",
  "x",
  "whatsapp",
  "copy",
  "facebook",
  "threads",
  "telegram",
  "other",
] as const;

const ShareSchema = z.object({
  content_type: z.enum(CONTENT_TYPES),
  content_id: z.string().trim().max(120).optional().nullable(),
  channel: z.enum(CHANNELS),
});

router.post("/shares", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = ShareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid share event" });
    return;
  }
  try {
    await db.insert(shareEventsTable).values({
      userId: req.userId!,
      contentType: parsed.data.content_type,
      contentId: parsed.data.content_id ?? null,
      channel: parsed.data.channel,
    });
    /* Quest progress: fire-and-forget, never blocks the response. */
    recordShareEvent(req.userId!).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[shares] record failed");
    res.status(500).json({ error: "Could not record share" });
  }
});

export default router;
