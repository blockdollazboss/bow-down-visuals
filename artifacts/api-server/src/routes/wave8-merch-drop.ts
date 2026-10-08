import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import { db, wave8MerchDropsTable, wave8CalendarSlotsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

/* ─── Wave 8: Merch Drop Planner ──────────────────────────────────────────
   AI plans a merch drop for a creator: 3 product concepts + a 5-post
   launch sequence. Accepting a plan saves it AND queues the 5 launch
   posts into the content calendar (wave8_calendar_slots) as promo slots.

   Pricing: 100 Visual Bucs for the AI plan. Saving + listing are free. */

export const MERCH_DROP_PLAN_CREDIT_COST = Number(process.env["MERCH_DROP_PLAN_CREDIT_COST"]) || 100;

const planSchema = z.object({
  niche: z.string().min(1, "Niche is required.").max(100),
  audience: z.string().max(300).optional().default(""),
  priceBand: z.enum(["budget", "mid", "premium"]),
});

export type MerchDropPlanRequest = z.infer<typeof planSchema>;

export interface MerchConcept {
  name: string;
  product: string;
  description: string;
  pricePoint: string;
  why: string;
}

export interface LaunchPost {
  dayOffset: number;
  title: string;
  caption: string;
  cta: string;
}

export interface MerchDropPlan {
  concepts: MerchConcept[];
  launchPosts: LaunchPost[];
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

function clampConcept(value: unknown): MerchConcept | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = clampText(v.name, 120);
  const product = clampText(v.product, 120);
  const description = clampText(v.description, 600);
  const pricePoint = clampText(v.pricePoint, 80);
  const why = clampText(v.why, 400);
  if (!name || !product || !description || !pricePoint || !why) return null;
  return { name, product, description, pricePoint, why };
}

function clampLaunchPost(value: unknown): LaunchPost | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const day = typeof v.dayOffset === "number" && Number.isFinite(v.dayOffset)
    ? Math.max(0, Math.min(6, Math.round(v.dayOffset)))
    : null;
  if (day === null) return null;
  const title = clampText(v.title, 160);
  const caption = clampText(v.caption, 800);
  const cta = clampText(v.cta, 200);
  if (!title || !caption || !cta) return null;
  return { dayOffset: day, title, caption, cta };
}

/** Parse + sanitize the model's JSON output. Returns null when unusable (triggers refund). */
export function parseMerchDropPlan(raw: string): MerchDropPlan | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;

  const concepts = (Array.isArray(o.concepts) ? o.concepts : [])
    .map(clampConcept)
    .filter((c): c is MerchConcept => c !== null)
    .slice(0, 3);
  const launchPosts = (Array.isArray(o.launchPosts) ? o.launchPosts : [])
    .map(clampLaunchPost)
    .filter((p): p is LaunchPost => p !== null)
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .slice(0, 5);

  if (concepts.length !== 3 || launchPosts.length !== 5) return null;
  return { concepts, launchPosts };
}

function aiUnavailable(res: { status: (c: number) => { json: (b: unknown) => void } }): boolean {
  /* getOpenAI() throws naming OPENAI_API_KEY when the key is missing. */
  try {
    getOpenAI();
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is not configured — the Merch Drop Planner is unavailable."
        : "The Merch Drop Planner is unavailable right now.",
    });
    return true;
  }
}

const PRICE_BAND_GUIDANCE: Record<string, string> = {
  budget: "affordable, impulse-buy pricing — everyday fans buy without thinking twice",
  mid: "mid-range pricing — premium feel without luxury prices",
  premium: "premium pricing — statement pieces, quality-first buyers",
};

/* POST /api/wave8/merch-drop/plan — 100 VB. AI writes 3 merch concepts + 5 launch posts. */
router.post("/wave8/merch-drop/plan", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = planSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid merch drop request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  if (aiUnavailable(res)) return;

  const balance = req.userCredits ?? 0;
  if (balance < MERCH_DROP_PLAN_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to plan your merch drop.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, MERCH_DROP_PLAN_CREDIT_COST, {
      action: "Merch Drop Planner",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to plan your merch drop.",
      });
      return;
    }
    throw err;
  }

  async function refund() {
    try {
      await refundCredits(req.userId!, MERCH_DROP_PLAN_CREDIT_COST, {
        action: "Merch Drop Planner — Refund (generation failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
  }

  try {
    const d = parsed.data;
    const audienceLine = d.audience.trim() ? ` Audience: ${d.audience.trim()}.` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a merch strategist for independent creators. Plan drops that fans actually buy: wearable designs with a story, prices matched to the band, and a launch week that builds momentum day by day. Every concept must be producible via print-on-demand (tees, hoodies, hats, mugs, posters, phone cases, totes). No emojis. Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Creator niche: ${d.niche.trim()}.${audienceLine} Price band: ${d.priceBand} (${PRICE_BAND_GUIDANCE[d.priceBand]}).\n\n` +
            `Plan a merch drop as JSON with exactly these keys:\n` +
            `- "concepts": array of EXACTLY 3 objects, each { "name": string (drop-worthy product name), "product": string (one of: tee, hoodie, snapback, mug, poster, phone case, tote), "description": string (under 60 words: the design + what makes it theirs), "pricePoint": string (e.g. "$29" or "$29–$39"), "why": string (under 40 words: why their audience buys it) }\n` +
            `- "launchPosts": array of EXACTLY 5 objects covering day offsets 0 through 4, each { "dayOffset": number (0, 1, 2, 3, or 4), "title": string (post title), "caption": string (under 60 words, written in the creator's voice, no hashtags overload), "cta": string (one clear call to action) }\n` +
            `The launch posts must tell a 5-day story: tease → reveal → social proof → urgency → last call.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const plan = parseMerchDropPlan(raw);
    if (!plan) {
      await refund();
      res.status(502).json({
        error: "generation_failed",
        message: "The merch plan came back unusable — your Visual Bucs were refunded. Try again.",
      });
      return;
    }

    res.json({ plan, creditsUsed: MERCH_DROP_PLAN_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refund();
    logger.error({ err }, "wave8-merch-drop: plan generation failed, Visual Bucs refunded");
    res.status(502).json({
      error: "generation_failed",
      message: "Something went wrong planning your merch drop — your Visual Bucs were refunded.",
    });
  }
});

const saveSchema = z.object({
  planName: z.string().min(1, "A plan name is required.").max(120),
  concepts: z.array(z.object({
    name: z.string().max(120),
    product: z.string().max(120),
    description: z.string().max(600),
    pricePoint: z.string().max(80),
    why: z.string().max(400),
  })).min(1).max(10),
  launchPosts: z.array(z.object({
    dayOffset: z.number().int().min(0).max(6),
    title: z.string().max(160),
    caption: z.string().max(800),
    cta: z.string().max(200),
  })).min(1).max(10),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart must be YYYY-MM-DD"),
});

/* POST /api/wave8/merch-drop/save — free. Saves the plan + queues launch
   posts into the content calendar as promo slots. */
router.post("/wave8/merch-drop/save", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = saveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid merch drop save request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const d = parsed.data;
  try {
    const [plan] = await db
      .insert(wave8MerchDropsTable)
      .values({
        user_id: req.userId!,
        plan_name: d.planName.trim(),
        concepts: d.concepts,
        launch_posts: d.launchPosts,
        status: "accepted",
      })
      .returning({ id: wave8MerchDropsTable.id });

    if (!plan) {
      res.status(500).json({ error: "Could not save the merch plan. Please try again." });
      return;
    }

    /* Queue the launch posts into the content calendar: one promo slot per
       post, pinned to the day offset the AI assigned. */
    for (let i = 0; i < d.launchPosts.length; i++) {
      const p = d.launchPosts[i]!;
      await db.insert(wave8CalendarSlotsTable).values({
        user_id: req.userId!,
        week_start: d.weekStart,
        day_index: p.dayOffset,
        position: i,
        title: p.title,
        post_type: "promo",
        notes: p.caption,
        status: "draft",
      });
    }

    res.json({ planId: plan.id, queuedPosts: d.launchPosts.length });
  } catch (err) {
    logger.error({ err }, "wave8-merch-drop: save failed");
    res.status(500).json({ error: "Could not save the merch plan. Please try again." });
  }
});

/* GET /api/wave8/merch-drop/plans — free. The user's saved plans, newest first. */
router.get("/wave8/merch-drop/plans", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(wave8MerchDropsTable)
      .where(eq(wave8MerchDropsTable.user_id, req.userId!))
      .orderBy(desc(wave8MerchDropsTable.created_at));
    res.json({ plans: rows });
  } catch (err) {
    logger.error({ err }, "wave8-merch-drop: list plans failed");
    res.status(500).json({ error: "Could not load your merch plans." });
  }
});

export default router;
