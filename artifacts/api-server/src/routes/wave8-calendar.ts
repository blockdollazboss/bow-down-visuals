import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, asc } from "drizzle-orm";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import { db, wave8CalendarSlotsTable } from "@workspace/db";

const router = Router();

/* ─── Wave 8 · Content Calendar Auto-Fill ────────────────────────────────
   Creators pick a week + up to 6 content pillars, and the AI drafts one
   post per day (Mon–Sun) into the `wave8_calendar_slots` table.
   Paid: 150 Visual Bucs per auto-fill. Auth required; credits are deducted
   BEFORE the model call and REFUNDED on model failure, using the same
   pre-check + chargeCredits + refundCredits pattern as the paid routes. */

export const WAVE8_CALENDAR_AUTOFILL_CREDITS =
  Number(process.env["WAVE8_CALENDAR_AUTOFILL_CREDITS"]) || 150;

const WEEK_START_RE = /^\d{4}-\d{2}-\d{2}$/;
const BEST_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const autofillSchema = z.object({
  weekStart: z
    .string()
    .regex(WEEK_START_RE, "weekStart must be YYYY-MM-DD (a Monday)."),
  pillars: z
    .array(z.string().trim().min(1).max(60))
    .min(1, "Add at least one content pillar.")
    .max(6, "Keep it to 6 pillars."),
  vaultVoice: z.string().trim().max(500).optional().default(""),
});

const slotSchema = z.object({
  dayIndex: z.number().int().min(0).max(6),
  title: z.string().trim().min(1).max(120),
  postType: z.string().trim().min(1).max(60),
  notes: z.string().trim().max(600).default(""),
  bestTime: z.string().regex(BEST_TIME_RE).default("18:00"),
});

const aiResponseSchema = z.object({
  slots: z.array(slotSchema).length(7, "AI must return exactly 7 slots."),
});

const uuidParam = z.string().uuid("Invalid slot id.");

const patchSchema = z
  .object({
    dayIndex: z.number().int().min(0).max(6).optional(),
    position: z.number().int().min(0).max(999).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    status: z.string().trim().min(1).max(20).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "Nothing to update.");

async function refund(userId: string, reason: string) {
  try {
    await refundCredits(userId, WAVE8_CALENDAR_AUTOFILL_CREDITS, {
      action: `Content Calendar Auto-Fill — Refund (${reason})`,
    });
  } catch (refundErr) {
    logger.error(
      { err: refundErr, userId },
      "[wave8-calendar] refund failed after generation failure"
    );
  }
}

/* POST /api/wave8/calendar/autofill { weekStart, pillars, vaultVoice? }
   → 200 { slots, creditsUsed, creditsRemaining }. Paid: 150 VB. */
router.post("/wave8/calendar/autofill", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = autofillSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid auto-fill request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  try {
    getOpenAI();
  } catch {
    res.status(503).json({ error: "ai_unavailable" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < WAVE8_CALENDAR_AUTOFILL_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to auto-fill your content week.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, WAVE8_CALENDAR_AUTOFILL_CREDITS, {
      action: "Content Calendar Auto-Fill",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to auto-fill your content week.",
      });
      return;
    }
    throw err;
  }

  try {
    const { weekStart, pillars, vaultVoice } = parsed.data;

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a content strategist for creators. Given the creator's content pillars ` +
            `and an optional voice/style note, draft exactly 7 social posts — one for each day ` +
            `of the week, Monday (dayIndex 0) through Sunday (dayIndex 6). Vary formats across ` +
            `the week: mix short-form video ideas, carousels, stories, lives, and promos so the ` +
            `week feels balanced, never repetitive. Keep every title punchy (max 80 characters). ` +
            `Each notes brief is 2-3 sentences: the hook idea, the call to action, and why the ` +
            `format fits that day. No made-up stats, no virality guarantees. ` +
            `Return ONLY JSON: { "slots": [ { "dayIndex": <0-6>, "title": "<working title>", ` +
            `"postType": "<short format label, e.g. Short video, Carousel, Story, Live, Promo>", ` +
            `"notes": "<posting brief>", "bestTime": "<HH:MM 24h suggested posting time>" }, ` +
            `... exactly 7 items, one per dayIndex 0 through 6 in order ] }.`,
        },
        {
          role: "user",
          content:
            `Content pillars: ${pillars.join(", ")}\n` +
            (vaultVoice ? `Voice/style note: ${vaultVoice}\n` : "") +
            `Draft my week.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1600,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let aiSlots: z.infer<typeof slotSchema>[];
    try {
      const parsedJson = JSON.parse(raw);
      const checked = aiResponseSchema.safeParse(parsedJson);
      if (!checked.success) throw new Error("AI returned wrong shape");
      aiSlots = checked.data.slots;
    } catch {
      throw new Error("Model returned no usable week plan");
    }

    /* Guarantee one slot per day in order, regardless of the model's
       dayIndex values — array position is the source of truth. */
    const rows = aiSlots.map((s, i) => ({
      user_id: req.userId!,
      week_start: weekStart,
      day_index: i,
      position: 0,
      title: s.title,
      post_type: s.postType,
      notes: s.bestTime ? `Suggested time: ${s.bestTime}\n${s.notes}`.trim() : s.notes,
      status: "draft",
    }));

    /* Replace the week's plan wholesale — delete existing slots first so a
       re-run never duplicates. */
    await db
      .delete(wave8CalendarSlotsTable)
      .where(
        and(
          eq(wave8CalendarSlotsTable.user_id, req.userId!),
          eq(wave8CalendarSlotsTable.week_start, weekStart)
        )
      );
    const inserted = await db.insert(wave8CalendarSlotsTable).values(rows).returning();

    res.json({
      slots: inserted,
      creditsUsed: WAVE8_CALENDAR_AUTOFILL_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refund(req.userId!, "generation failed");

    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[wave8-calendar] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[wave8-calendar] autofill failed");
    res.status(502).json({ error: "The studio hiccupped — try again." });
  }
});

/* GET /api/wave8/calendar/slots?weekStart=YYYY-MM-DD → { slots } — free. */
router.get("/wave8/calendar/slots", publicApiLimiter, requireAuth, async (req, res) => {
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : "";
  if (!WEEK_START_RE.test(weekStart)) {
    res.status(400).json({ error: "weekStart must be YYYY-MM-DD." });
    return;
  }
  const slots = await db
    .select()
    .from(wave8CalendarSlotsTable)
    .where(
      and(
        eq(wave8CalendarSlotsTable.user_id, req.userId!),
        eq(wave8CalendarSlotsTable.week_start, weekStart)
      )
    )
    .orderBy(asc(wave8CalendarSlotsTable.day_index), asc(wave8CalendarSlotsTable.position));
  res.json({ slots });
});

/* PATCH /api/wave8/calendar/slots/:id { dayIndex?, position?, title?, notes?, status? }
   → { slot }. Free — drag-to-rearrange persistence. */
router.patch("/wave8/calendar/slots/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  const bodyParsed = patchSchema.safeParse(req.body ?? {});
  if (!idParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid slot update." });
    return;
  }
  const updated = await db
    .update(wave8CalendarSlotsTable)
    .set({ ...bodyParsed.data, updated_at: new Date() })
    .where(
      and(
        eq(wave8CalendarSlotsTable.id, idParsed.data),
        eq(wave8CalendarSlotsTable.user_id, req.userId!)
      )
    )
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Slot not found." });
    return;
  }
  res.json({ slot: updated[0] });
});

/* DELETE /api/wave8/calendar/slots/:id → { deleted: true }. Free. */
router.delete("/wave8/calendar/slots/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid slot id." });
    return;
  }
  const deleted = await db
    .delete(wave8CalendarSlotsTable)
    .where(
      and(
        eq(wave8CalendarSlotsTable.id, idParsed.data),
        eq(wave8CalendarSlotsTable.user_id, req.userId!)
      )
    )
    .returning({ id: wave8CalendarSlotsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Slot not found." });
    return;
  }
  res.json({ deleted: true });
});

export default router;
