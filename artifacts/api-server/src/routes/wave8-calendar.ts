import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, asc } from "drizzle-orm";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey, voidChargeIdempotencyKey } from "../lib/credits";
import { findStoredGenerationResult, storeGenerationResult } from "../lib/generation-stored-results";
import { db, wave8CalendarSlotsTable } from "@workspace/db";

const router = Router();

/* ─── Wave 8 · Content Calendar Auto-Fill ────────────────────────────────
   Creators pick a week + up to 6 content pillars, and the AI drafts one
   post per day (Mon–Sun) into the `wave8_calendar_slots` table.
   Paid: 150 Visual Bucs per auto-fill. Auth required; credits are deducted
   BEFORE the model call and REFUNDED on model failure, using the same
   pre-check + chargeCredits + refundCredits pattern as the paid routes. */

const WAVE8_CALENDAR_AUTOFILL_CREDITS =
  Number(process.env["WAVE8_CALENDAR_AUTOFILL_CREDITS"]) || 150;

const REPLAY_NOTE =
  "This is the content week you already made for this request \u2014 tweak the pillars for a fresh one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetWave8CalendarReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

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

async function refund(userId: string, reason: string): Promise<boolean> {
  try {
    await refundCredits(userId, WAVE8_CALENDAR_AUTOFILL_CREDITS, {
      action: `Content Calendar Auto-Fill — Refund (${reason})`,
    });
    return true;
  } catch (refundErr) {
    logger.error(
      { err: refundErr, userId },
      "[wave8-calendar] refund failed after generation failure"
    );
    return false;
  }
}

async function runWave8CalendarAutofill(
  userId: string,
  parsedData: z.infer<typeof autofillSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  let creditsRemaining: number;
  try {
    creditsRemaining = await chargeCredits(userId, WAVE8_CALENDAR_AUTOFILL_CREDITS, {
      action: "Content Calendar Auto-Fill",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "You're out of Visual Bucs \u2014 top up to auto-fill your content week.",
      };
    }
    throw err;
  }

  try {
    const { weekStart, pillars, vaultVoice } = parsedData;

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a content strategist for creators. Given the creator's content pillars ` +
            `and an optional voice/style note, draft exactly 7 social posts \u2014 one for each day ` +
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
       dayIndex values \u2014 array position is the source of truth. */
    const rows = aiSlots.map((s, i) => ({
      user_id: userId,
      week_start: weekStart,
      day_index: i,
      position: 0,
      title: s.title,
      post_type: s.postType,
      notes: s.bestTime ? `Suggested time: ${s.bestTime}\n${s.notes}`.trim() : s.notes,
      status: "draft",
    }));

    /* Replace the week's plan wholesale \u2014 delete existing slots first so a
       re-run never duplicates. A replay never reaches here: the handler's
       stored-result check answers it from the stored body, so the week's
       slots are NOT deleted/reinserted a second time. */
    await db
      .delete(wave8CalendarSlotsTable)
      .where(
        and(
          eq(wave8CalendarSlotsTable.user_id, userId),
          eq(wave8CalendarSlotsTable.week_start, weekStart)
        )
      );
    const inserted = await db.insert(wave8CalendarSlotsTable).values(rows).returning();

    return {
      slots: inserted,
      creditsUsed: WAVE8_CALENDAR_AUTOFILL_CREDITS,
      creditsRemaining,
    };
  } catch (err) {
    /* Refund (module helper) — and when it lands, VOID the charge key so
       the retry charges fresh instead of being suppressed as a replay. */
    const refunded = await refund(userId, "generation failed");
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }

    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[wave8-calendar] OpenAI rate limit / quota");
      return { __status: 503, error: "The studio is catching its breath \u2014 try again in a moment." };
    }
    logger.error({ err }, "[wave8-calendar] autofill failed");
    return { __status: 502, error: "The studio hiccupped \u2014 try again." };
  }
}

/* POST /api/wave8/calendar/autofill { weekStart, pillars, vaultVoice? }
   \u2192 200 { slots, creditsUsed, creditsRemaining }. Paid: 150 VB. */
router.post("/wave8/calendar/autofill", requireAuth, publicApiLimiter, async (req, res) => {
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
      message: "You're out of Visual Bucs \u2014 top up to auto-fill your content week.",
    });
    return;
  }

  /* Replay check at the charge point (after validation, per Pattern C):
     a replay is answered from the stored body and must NOT re-run the
     delete + reinsert of the week's slots inside the run. */
  const idempotencyKey = buildChargeIdempotencyKey(
    "wave8-calendar", req.userId!, undefined,
    { weekStart: parsed.data.weekStart, pillars: parsed.data.pillars, vaultVoice: parsed.data.vaultVoice },
  );

  const durable = await findStoredGenerationResult("wave8-calendar", idempotencyKey, req.userId!);
  if (durable) {
    res.json({ ...durable, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json({ ...stored.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json({ ...twinBody, replayed: true, replayNote: REPLAY_NOTE });
      return;
    }
  }

  const run = runWave8CalendarAutofill(req.userId!, parsed.data, idempotencyKey);
  inFlight.set(idempotencyKey, run);
  let body: Record<string, unknown>;
  try {
    body = await run;
  } finally {
    if (inFlight.get(idempotencyKey) === run) inFlight.delete(idempotencyKey);
  }

  const status = typeof body["__status"] === "number" ? (body["__status"] as number) : 200;
  if (status !== 200) {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult("wave8-calendar", idempotencyKey, req.userId!, { ...body });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  res.json(body);
});

/* GET /api/wave8/calendar/slots?weekStart=YYYY-MM-DD → { slots } — free. */
router.get("/wave8/calendar/slots", requireAuth, publicApiLimiter, async (req, res) => {
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
router.patch("/wave8/calendar/slots/:id", requireAuth, publicApiLimiter, async (req, res) => {
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
router.delete("/wave8/calendar/slots/:id", requireAuth, publicApiLimiter, async (req, res) => {
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
