import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { db } from "@workspace/db";
import { scheduledPostsTable } from "../../../../../lib/db/src/schema/scheduled-posts";
import { eq, and, asc } from "drizzle-orm";

const router = Router();

/* ─── Social media scheduler ───
   Schedule posts for later publishing. Scheduling itself is free;
   the actual post at fire time uses the existing social-post credits. */

const PLATFORMS = ["instagram", "tiktok", "facebook"] as const;

const schedulePostSchema = z.object({
  content: z.string().trim().min(1, "Content is required.").max(5000),
  mediaUrl: z.string().trim().min(1, "A media URL is required.").max(2048),
  platform: z.enum(PLATFORMS),
  scheduledAt: z
    .string()
    .datetime({ message: "scheduledAt must be an ISO datetime string." })
    .refine((v) => new Date(v).getTime() > Date.now(), {
      message: "scheduledAt must be in the future.",
    }),
  hashtags: z.string().trim().max(500).optional().default(""),
});

// POST /schedule-post — save a post for later publishing (free)
router.post("/schedule-post", requireAuth, async (req, res) => {
  const parsed = schedulePostSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  try {
    const [post] = await db
      .insert(scheduledPostsTable)
      .values({
        user_id: req.userId!,
        status: "scheduled",
        media_url: parsed.data.mediaUrl,
        caption: parsed.data.content,
        hashtags: parsed.data.hashtags,
        platforms: [parsed.data.platform],
        scheduled_at: new Date(parsed.data.scheduledAt),
      })
      .returning();

    res.status(201).json({ post });
  } catch (err) {
    req.log.error({ err }, "[scheduler] schedule-post failed");
    res.status(500).json({ error: "Could not schedule the post." });
  }
});

// GET /scheduled-posts — list the user's scheduled posts, upcoming first
router.get("/scheduled-posts", requireAuth, async (req, res) => {
  try {
    const posts = await db
      .select()
      .from(scheduledPostsTable)
      .where(eq(scheduledPostsTable.user_id, req.userId!))
      .orderBy(asc(scheduledPostsTable.scheduled_at));
    res.json({ posts });
  } catch (err) {
    req.log.error({ err }, "[scheduler] scheduled-posts list failed");
    res.status(500).json({ error: "Could not load scheduled posts." });
  }
});

// DELETE /scheduled-posts/:id — cancel a scheduled post (owner only)
router.delete("/scheduled-posts/:id", requireAuth, async (req, res) => {
  try {
    const existing = await db
      .select({ id: scheduledPostsTable.id, status: scheduledPostsTable.status })
      .from(scheduledPostsTable)
      .where(
        and(
          eq(scheduledPostsTable.id, req.params.id as string),
          eq(scheduledPostsTable.user_id, req.userId!),
        ),
      )
      .limit(1);

    const row = existing[0];
    if (!row) {
      res.status(404).json({ error: "Scheduled post not found." });
      return;
    }
    if (row.status === "posted" || row.status === "publishing") {
      res.status(409).json({ error: "This post is already being published and cannot be cancelled." });
      return;
    }

    const [cancelled] = await db
      .update(scheduledPostsTable)
      .set({ status: "canceled", updated_at: new Date() })
      .where(eq(scheduledPostsTable.id, row.id))
      .returning();

    res.json({ post: cancelled });
  } catch (err) {
    req.log.error({ err }, "[scheduler] cancel failed");
    res.status(500).json({ error: "Could not cancel the scheduled post." });
  }
});

export default router;
