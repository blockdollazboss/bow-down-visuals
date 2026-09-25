import { Router, type Request, type Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, desc } from "drizzle-orm";
import { db, scheduledPostsTable, type ScheduledPost } from "@workspace/db";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../lib/credits";
import { requestPollerTick } from "../lib/job-poller";

/* ─── Content Scheduler ──────────────────────────────────────────────────
   Schedule posts across Instagram, TikTok, and Facebook from one calendar.
   Server-owned and restart-safe: posts live in the `scheduled_posts` table
   and the job-poller tick fires them — no tab, console script, or
   in-memory state required.

   Money model (honest, no surprises):
   - Drafts: free.
   - Scheduling: 1 credit per scheduled post, charged UP FRONT when the
     post is scheduled — no matter how many platforms it targets. The
     worker publishes through the existing provider helpers without
     charging again — attempts are marked credits-deducted.
   - Cancel a scheduled post: automatic refund of the 1 credit.
   - Total provider failure at fire time: automatic refund of the 1 credit.
     Partial success (posted to at least one platform): no refund — the
     scheduled post delivered.
   - AI best-time suggestion: 1 credit, charged before the model call,
     automatically refunded on provider failure.
   - Browsing the calendar: free.

   NOTE: uses max_completion_tokens (NOT max_tokens) — GPT-6 rejects
   max_tokens. */

export const SCHEDULER_POST_CREDITS = Number(process.env["SCHEDULER_POST_CREDITS"]) || 1;
export const SCHEDULER_BEST_TIME_CREDITS = Number(process.env["SCHEDULER_BEST_TIME_CREDITS"]) || 1;

const PLATFORMS = ["instagram", "tiktok", "facebook"] as const;
export type SchedulerPlatformKey = (typeof PLATFORMS)[number];

const MEDIA_TYPES = ["video", "image"] as const;

export const scheduledPostSchema = z.object({
  mediaUrl: z.string().min(1, "Add a video or image to post.").max(2000),
  mediaType: z.enum(MEDIA_TYPES).default("video"),
  caption: z.string().max(5000).default(""),
  hashtags: z.string().max(500).default(""),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(3),
  /* platform → social_accounts.id (which connected account posts it) */
  accountIds: z.partialRecord(z.enum(PLATFORMS), z.string().uuid()).default({}),
  /* ISO datetime. Omitted (or in the past) → saved as a free draft. */
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});

export const updateScheduledPostSchema = z.object({
  caption: z.string().max(5000).optional(),
  hashtags: z.string().max(500).optional(),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(3).optional(),
  accountIds: z.partialRecord(z.enum(PLATFORMS), z.string().uuid()).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  mediaUrl: z.string().min(1).max(2000).optional(),
  mediaType: z.enum(MEDIA_TYPES).optional(),
});

const bestTimeSchema = z.object({
  niche: z.string().min(1, "Tell us your niche.").max(120),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(3),
  postsPerWeek: z.number().int().min(1).max(14).default(3),
  timezone: z.string().max(60).default("America/New_York"),
});

const router = Router();

/** Public shape for the frontend — never leaks internal fields. */
function toPublicPost(p: ScheduledPost) {
  return {
    id: p.id,
    status: p.status,
    mediaUrl: p.media_url,
    mediaType: p.media_type,
    caption: p.caption,
    hashtags: p.hashtags,
    platforms: p.platforms,
    accountIds: p.account_ids,
    scheduledAt: p.scheduled_at ? p.scheduled_at.toISOString() : null,
    postedAt: p.posted_at ? p.posted_at.toISOString() : null,
    attempts: p.attempts,
    lastError: p.last_error,
    creditsCharged: p.credits_charged,
    aiBestTime: p.ai_best_time,
    results: p.results,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}

async function getOwnedPost(userId: string, id: string): Promise<ScheduledPost | null> {
  const rows = await db
    .select()
    .from(scheduledPostsTable)
    .where(and(eq(scheduledPostsTable.id, id), eq(scheduledPostsTable.user_id, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/* ── List posts (free) ───────────────────────────────────────────────────
   GET /api/scheduler/posts?status=scheduled|draft|posted|failed|canceled */

router.get("/scheduler/posts", requireAuth, async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const allowed = ["draft", "scheduled", "publishing", "posted", "failed", "canceled"];
  try {
    let rows: ScheduledPost[];
    if (status && allowed.includes(status)) {
      rows = await db
        .select()
        .from(scheduledPostsTable)
        .where(
          and(
            eq(scheduledPostsTable.user_id, req.userId!),
            eq(scheduledPostsTable.status, status as ScheduledPost["status"]),
          ),
        )
        .orderBy(desc(scheduledPostsTable.created_at))
        .limit(200);
    } else {
      rows = await db
        .select()
        .from(scheduledPostsTable)
        .where(eq(scheduledPostsTable.user_id, req.userId!))
        .orderBy(desc(scheduledPostsTable.created_at))
        .limit(200);
    }
    res.json({ posts: rows.map(toPublicPost) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[scheduler] list failed");
    res.status(500).json({ error: "list_failed", message: "Couldn't load your scheduled posts." });
  }
});

/* ── Create a draft or scheduled post ────────────────────────────────────
   POST /api/scheduler/posts
   - scheduledAt in the future → status `scheduled`, charges 1 credit ×
     platforms up front (the social pipeline's normal fee).
   - otherwise → free `draft`. */

router.post("/scheduler/posts", requireAuth, async (req: Request, res: Response) => {
  const parsed = scheduledPostSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid scheduled post.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { mediaUrl, mediaType, caption, hashtags, platforms, accountIds, scheduledAt } = parsed.data;

  const missingAccounts = platforms.filter((p) => !accountIds[p]);
  if (missingAccounts.length > 0) {
    res.status(400).json({
      error: "account_required",
      message: `Pick a connected account for: ${missingAccounts.join(", ")}.`,
    });
    return;
  }

  const fireAt = scheduledAt ? new Date(scheduledAt) : null;
  const wantsSchedule = !!fireAt && fireAt.getTime() > Date.now() + 60_000;
  /* 1 credit per scheduled post — regardless of platform count. */
  const cost = wantsSchedule ? SCHEDULER_POST_CREDITS : 0;

  if (cost > 0) {
    const balance = req.userCredits ?? 0;
    if (balance < cost) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Scheduling a post costs 1 credit — top up to schedule.",
      });
      return;
    }
    try {
      await chargeCredits(req.userId!, cost, { action: "Content Scheduler — Post reservation" });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough credits to schedule this post." });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no credits were charged. Please try again." });
        return;
      }
      throw err;
    }
  }

  try {
    const [row] = await db
      .insert(scheduledPostsTable)
      .values({
        user_id: req.userId!,
        status: wantsSchedule ? "scheduled" : "draft",
        media_url: mediaUrl,
        media_type: mediaType,
        caption,
        hashtags,
        platforms: [...platforms],
        account_ids: { ...accountIds },
        scheduled_at: wantsSchedule ? fireAt : null,
        credits_charged: cost,
      })
      .returning();
    if (wantsSchedule) requestPollerTick(); // wake the worker for near-term posts
    res.status(201).json({ post: toPublicPost(row) });
  } catch (err) {
    /* The post wasn't created but the charge landed — refund immediately. */
    if (cost > 0) {
      try {
        await refundCredits(req.userId!, cost, { action: "Content Scheduler — Refund (create failed)" });
      } catch (refundErr) {
        logger.error({ err: refundErr, userId: req.userId }, "[scheduler] FAILED to refund after create failure");
      }
    }
    logger.error({ err, userId: req.userId }, "[scheduler] create failed");
    res.status(500).json({ error: "create_failed", message: "Couldn't save the post. Your credits were refunded." });
  }
});

/* ── Update a draft / reschedule ─────────────────────────────────────────
   PATCH /api/scheduler/posts/:id
   Drafts are freely editable. A scheduled post can be rescheduled or have
   its platforms/accounts changed — the 1-credit reservation already paid
   covers any platform set, so platform changes never charge or refund. */

router.patch("/scheduler/posts/:id", requireAuth, async (req: Request, res: Response) => {
  const parsed = updateScheduledPostSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const post = await getOwnedPost(req.userId!, String(req.params["id"]));
  if (!post) {
    res.status(404).json({ error: "not_found", message: "Post not found." });
    return;
  }
  if (post.status !== "draft" && post.status !== "scheduled") {
    res.status(409).json({
      error: "not_editable",
      message: `This post is already ${post.status} and can't be edited.`,
    });
    return;
  }

  const data = parsed.data;
  const nextPlatforms = (data.platforms ?? post.platforms) as SchedulerPlatformKey[];
  const nextAccountIds = { ...post.account_ids, ...(data.accountIds ?? {}) };
  const missingAccounts = nextPlatforms.filter((p) => !nextAccountIds[p]);
  if (missingAccounts.length > 0) {
    res.status(400).json({
      error: "account_required",
      message: `Pick a connected account for: ${missingAccounts.join(", ")}.`,
    });
    return;
  }

  /* The 1-credit reservation covers any platform set — adding or removing
     platforms on a scheduled post never changes the charge. */
  const patch: Partial<ScheduledPost> = {};
  if (data.caption !== undefined) patch.caption = data.caption;
  if (data.hashtags !== undefined) patch.hashtags = data.hashtags;
  if (data.platforms !== undefined) patch.platforms = [...data.platforms];
  if (data.accountIds !== undefined || data.platforms !== undefined) patch.account_ids = nextAccountIds;
  if (data.mediaUrl !== undefined) patch.media_url = data.mediaUrl;
  if (data.mediaType !== undefined) patch.media_type = data.mediaType;

  if (data.scheduledAt !== undefined) {
    if (data.scheduledAt === null) {
      /* Unscheduling a scheduled post refunds the whole reservation. */
      if (post.status === "scheduled" && post.credits_charged > 0 && !post.credits_refunded) {
        try {
          await refundCredits(req.userId!, post.credits_charged, { action: "Content Scheduler — Refund (unscheduled)" });
          patch.credits_refunded = true;
        } catch (refundErr) {
          logger.error({ err: refundErr, userId: req.userId }, "[scheduler] FAILED to refund on unschedule");
          res.status(500).json({ error: "refund_failed", message: "Couldn't process the refund — try again." });
          return;
        }
      }
      patch.status = "draft";
      patch.scheduled_at = null;
      patch.credits_charged = 0;
    } else {
      const fireAt = new Date(data.scheduledAt);
      if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() < Date.now() + 60_000) {
        res.status(400).json({ error: "bad_time", message: "Pick a time at least a minute in the future." });
        return;
      }
      patch.scheduled_at = fireAt;
      if (post.status === "draft") {
        /* Draft → scheduled: charge the 1-credit reservation now. */
        const cost = SCHEDULER_POST_CREDITS;
        const balance = req.userCredits ?? 0;
        if (balance < cost) {
          res.status(402).json({ error: "out_of_credits", message: "Scheduling a post costs 1 credit." });
          return;
        }
        try {
          await chargeCredits(req.userId!, cost, { action: "Content Scheduler — Post reservation" });
        } catch (err) {
          if (err instanceof OutOfCreditsError) {
            res.status(402).json({ error: "out_of_credits", message: "Not enough credits to schedule this post." });
            return;
          }
          throw err;
        }
        patch.status = "scheduled";
        patch.credits_charged = cost;
        patch.credits_refunded = false;
      }
    }
  }

  try {
    const [updated] = await db
      .update(scheduledPostsTable)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(scheduledPostsTable.id, post.id))
      .returning();
    if (updated.status === "scheduled") requestPollerTick();
    res.json({ post: toPublicPost(updated) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[scheduler] update failed");
    res.status(500).json({ error: "update_failed", message: "Couldn't update the post." });
  }
});

/* ── Cancel / delete ─────────────────────────────────────────────────────
   DELETE /api/scheduler/posts/:id
   Scheduled → canceled + automatic refund of the reservation.
   Draft/failed → deleted. Posted → kept as history (can't delete). */

router.delete("/scheduler/posts/:id", requireAuth, async (req: Request, res: Response) => {
  const post = await getOwnedPost(req.userId!, String(req.params["id"]));
  if (!post) {
    res.status(404).json({ error: "not_found", message: "Post not found." });
    return;
  }
  if (post.status === "posted" || post.status === "publishing") {
    res.status(409).json({
      error: "not_deletable",
      message: `This post is ${post.status} — it stays in your history.`,
    });
    return;
  }
  try {
    if (post.status === "scheduled" && post.credits_charged > 0 && !post.credits_refunded) {
      await refundCredits(req.userId!, post.credits_charged, { action: "Content Scheduler — Refund (canceled)" });
      await db
        .update(scheduledPostsTable)
        .set({ status: "canceled", credits_refunded: true, scheduled_at: null, updated_at: new Date() })
        .where(eq(scheduledPostsTable.id, post.id));
      res.json({ canceled: true, refunded: post.credits_charged });
      return;
    }
    await db.delete(scheduledPostsTable).where(eq(scheduledPostsTable.id, post.id));
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[scheduler] delete failed");
    res.status(500).json({ error: "delete_failed", message: "Couldn't remove the post." });
  }
});

/* ── AI best-time suggestion ─────────────────────────────────────────────
   POST /api/scheduler/best-time — 1 credit, charged before the model call,
   automatically refunded on provider failure. The suggestion is guidance,
   not a guarantee. */

export interface BestTimeSlot {
  date: string;
  time: string;
  platform: SchedulerPlatformKey;
  reason: string;
}

export function sanitizeBestTime(raw: unknown, platforms: SchedulerPlatformKey[]): BestTimeSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: BestTimeSlot[] = [];
  for (const item of raw.slice(0, 12)) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    const platform = typeof s.platform === "string" && (platforms as string[]).includes(s.platform)
      ? (s.platform as SchedulerPlatformKey)
      : platforms[0];
    const date = typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : null;
    const time = typeof s.time === "string" && /^\d{2}:\d{2}$/.test(s.time) ? s.time : null;
    if (!date || !time) continue;
    out.push({
      date,
      time,
      platform,
      reason: typeof s.reason === "string" ? s.reason.slice(0, 160) : "",
    });
  }
  return out;
}

router.post("/scheduler/best-time", requireAuth, async (req: Request, res: Response) => {
  const parsed = bestTimeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { niche, platforms, postsPerWeek, timezone } = parsed.data;

  const balance = req.userCredits ?? 0;
  if (balance < SCHEDULER_BEST_TIME_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "AI best-time suggestions cost 1 credit — top up to continue.",
    });
    return;
  }
  try {
    await chargeCredits(req.userId!, SCHEDULER_BEST_TIME_CREDITS, { action: "Content Scheduler — AI best-time" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough credits for a best-time suggestion." });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no credits were charged." });
      return;
    }
    throw err;
  }

  const refund = async () => {
    try {
      await refundCredits(req.userId!, SCHEDULER_BEST_TIME_CREDITS, { action: "Content Scheduler — AI best-time Refund" });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[scheduler] FAILED to refund best-time credits");
    }
  };

  try {
    const openai: OpenAI = getOpenAI();
    const today = new Date().toISOString().slice(0, 10);
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a social media posting-time strategist. Suggest the best upcoming posting slots for a creator. " +
            "Base times on widely-known platform engagement patterns (weekday lunch hours and evenings, weekend late mornings) " +
            "adjusted for the creator's timezone and niche. Be honest: these are pattern-based suggestions, not guarantees. " +
            "Respond ONLY with JSON: { \"slots\": [ { \"date\": \"YYYY-MM-DD\", \"time\": \"HH:MM\" (24h), \"platform\": \"instagram|tiktok|facebook\", \"reason\": \"short why\" } ], \"note\": \"one-line guidance\" }. " +
            "Dates must be within the next 14 days. Suggest exactly the number of posts requested, spread across days.",
        },
        {
          role: "user",
          content: JSON.stringify({
            niche,
            platforms,
            postsPerWeek,
            timezone,
            today,
            postsRequested: Math.min(12, postsPerWeek * 2),
          }),
        },
      ],
    });
    const text = completion.choices[0]?.message?.content ?? "";
    let parsedJson: { slots?: unknown; note?: unknown };
    try {
      parsedJson = JSON.parse(text);
    } catch {
      await refund();
      res.status(502).json({ error: "ai_failed", message: "The AI returned an unusable suggestion — your credit was refunded." });
      return;
    }
    const slots = sanitizeBestTime(parsedJson.slots, platforms);
    if (slots.length === 0) {
      await refund();
      res.status(502).json({ error: "ai_failed", message: "The AI couldn't build useful slots — your credit was refunded." });
      return;
    }
    res.json({
      slots,
      note:
        typeof parsedJson.note === "string"
          ? parsedJson.note.slice(0, 300)
          : "Pattern-based suggestions — post when your own audience is most active for the best results.",
      creditsUsed: SCHEDULER_BEST_TIME_CREDITS,
    });
  } catch (err) {
    await refund();
    logger.error({ err, userId: req.userId }, "[scheduler] best-time failed");
    res.status(502).json({ error: "ai_failed", message: "Couldn't get a best-time suggestion — your credit was refunded." });
  }
});

export default router;
