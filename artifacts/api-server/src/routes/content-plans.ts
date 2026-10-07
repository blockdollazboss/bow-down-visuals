import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { db, contentPlansTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

/* ─── Public content-plan shares ──────────────────────────────────────────
   The Content Intelligence chain ends in a reviewable plan (validated idea,
   winning hook, niche verdict, competitor gaps, 7-day calendar). Creators
   can publish it to a public, indexable /plan/:slug page — opt-in and free
   (the plan's AI work was already paid for step by step). The creator copies
   the link with their ?ref=CODE attached, so shares earn referral credit. */

const PlanDaySchema = z.object({
  date: z.string().max(20),
  dayLabel: z.string().max(40),
  post: z.boolean(),
  title: z.string().max(160),
  format: z.string().max(30),
  platform: z.string().max(30),
  hook: z.string().max(300),
  bestTime: z.string().max(30),
});

const PublishSchema = z.object({
  title: z.string().trim().min(1).max(120),
  creatorName: z.string().trim().max(60).optional().default(""),
  includeCredit: z.boolean().optional().default(true),
  plan: z
    .object({
      idea: z.string().max(500).optional().default(""),
      niche: z.string().max(120).optional().default(""),
      platform: z.string().max(30).optional().default(""),
      audience: z.string().max(200).optional().default(""),
      verdict: z.string().max(20).optional().default(""),
      overallScore: z.number().optional(),
      hook: z.string().max(600).optional().default(""),
      hookScore: z.number().optional(),
      nicheVerdict: z.string().max(200).optional().default(""),
      competitionLabel: z.string().max(40).optional().default(""),
      gaps: z.array(z.object({ gap: z.string().max(220), howToExploit: z.string().max(320) })).max(5).optional().default([]),
      days: z.array(PlanDaySchema).max(30).optional().default([]),
      summary: z.string().max(600).optional().default(""),
    })
    .strict(),
});

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "content-plan";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

/* POST /api/content-plans/publish — opt-in publish (auth required, free) */
router.post("/content-plans/publish", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = PublishSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid content plan.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  try {
    const [item] = await db
      .insert(contentPlansTable)
      .values({
        user_id: req.userId!,
        slug: makeSlug(d.title),
        title: d.title,
        plan: d.plan,
        creator_name: d.creatorName.trim() || "Anonymous Creator",
        include_credit: d.includeCredit,
      })
      .returning();
    res.json({ slug: item.slug });
  } catch (err) {
    req.log.error({ err }, "[content-plans] publish failed");
    res.status(500).json({ error: "Could not publish your plan." });
  }
});

/* GET /api/content-plans/p/:slug — public plan detail; increments views */
router.get("/content-plans/p/:slug", publicApiLimiter, async (req, res) => {
  const { slug } = req.params as { slug: string };
  try {
    const [item] = await db
      .select()
      .from(contentPlansTable)
      .where(eq(contentPlansTable.slug, slug))
      .limit(1);
    if (!item) {
      res.status(404).json({ error: "Content plan not found." });
      return;
    }
    // Fire-and-forget view count — never block the read.
    db.update(contentPlansTable)
      .set({ views: sql`${contentPlansTable.views} + 1` })
      .where(eq(contentPlansTable.id, item.id))
      .catch(() => {});
    res.json({
      slug: item.slug,
      title: item.title,
      plan: item.plan,
      creatorName: item.creator_name,
      includeCredit: item.include_credit,
      views: item.views + 1,
      createdAt: item.created_at,
    });
  } catch (err) {
    req.log.error({ err }, "[content-plans] detail failed");
    res.status(500).json({ error: "Could not load content plan." });
  }
});

export default router;
