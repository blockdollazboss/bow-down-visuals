import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, asc } from "drizzle-orm";
import { db, tourDatesTable, TOUR_STATUSES } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";

/* ─── Tour Planner ────────────────────────────────────────────────────────
   Plan tours and live shows:
   - Tour date management (CRUD) is FREE — pure data display/entry under the
     pricing rule.
   - POST /api/tour/optimize runs GPT-6 over the user's dates to produce an
     optimal routing order (minimize travel) plus a budget estimate (travel,
     venue, crew). 3 credits per plan (env-overridable). Credits are charged
     BEFORE the model call and refunded if the provider call fails.
   - Honest framing: routing and budget are AI estimates, not guarantees —
     the frontend carries the disclaimer.
   NOTE: uses max_completion_tokens (NOT max_tokens) — GPT-6 rejects
   max_tokens. */

export const TOUR_PLANNER_CREDIT_COST =
  Number(process.env["TOUR_PLANNER_CREDIT_COST"]) || 3;

export const MAX_TOUR_DATES = 30;

export const createTourDateSchema = z.object({
  city: z.string().min(1, "City is required.").max(120),
  venue: z.string().min(1, "Venue is required.").max(200),
  show_date: z
    .string()
    .datetime({ offset: true })
    .refine((d) => !Number.isNaN(Date.parse(d)), "Invalid show date."),
  notes: z.string().max(1000).optional().default(""),
  status: z.enum(TOUR_STATUSES).optional().default("upcoming"),
});

export const updateTourDateSchema = z.object({
  city: z.string().min(1).max(120).optional(),
  venue: z.string().min(1).max(200).optional(),
  show_date: z
    .string()
    .datetime({ offset: true })
    .refine((d) => !Number.isNaN(Date.parse(d)), "Invalid show date.")
    .optional(),
  notes: z.string().max(1000).optional(),
  status: z.enum(TOUR_STATUSES).optional(),
});

export const optimizeSchema = z.object({
  home_base: z.string().min(1, "Home base city is required.").max(120),
  transport: z.enum(["van", "bus", "flights", "mixed"]).optional().default("van"),
  crew_size: z.number().int().min(1).max(50).optional().default(4),
  date_ids: z
    .array(z.string().uuid())
    .min(2, "Add at least 2 tour dates to optimize routing.")
    .max(MAX_TOUR_DATES),
});

export interface OptimizedStop {
  date_id: string;
  city: string;
  venue: string;
  show_date: string;
  order: number;
  travel_from_previous: string;
  estimated_travel_miles: number | null;
}

export interface BudgetBreakdown {
  travel: number;
  lodging: number;
  venues: number;
  crew: number;
  food_per_diem: number;
  contingency: number;
  total: number;
  currency: string;
  notes: string[];
}

/* Parse + sanitize the model's routing JSON. Stops are re-keyed by date_id
   against the user's real dates — the model never invents shows. */
export function parseOptimizationJson(
  raw: string,
  dateIds: string[],
): { stops: Array<{ date_id: string; travel_from_previous: string; estimated_travel_miles: number | null }>; budget: BudgetBreakdown; routing_notes: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const obj = parsed as Record<string, unknown>;
  const rawStops = Array.isArray(obj.stops) ? obj.stops : [];
  const idSet = new Set(dateIds);
  const seen = new Set<string>();
  const stops: Array<{ date_id: string; travel_from_previous: string; estimated_travel_miles: number | null }> = [];
  for (const s of rawStops) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    const date_id = typeof rec.date_id === "string" ? rec.date_id : "";
    if (!idSet.has(date_id) || seen.has(date_id)) continue;
    seen.add(date_id);
    const miles =
      typeof rec.estimated_travel_miles === "number" && Number.isFinite(rec.estimated_travel_miles)
        ? Math.max(0, Math.round(rec.estimated_travel_miles))
        : null;
    stops.push({
      date_id,
      travel_from_previous:
        typeof rec.travel_from_previous === "string"
          ? rec.travel_from_previous.slice(0, 200)
          : "",
      estimated_travel_miles: miles,
    });
  }
  if (stops.length === 0) {
    throw new Error("Model returned no valid stops");
  }
  const b = (obj.budget ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    return Math.max(0, Math.round(n * 100) / 100);
  };
  const budget: BudgetBreakdown = {
    travel: num(b.travel),
    lodging: num(b.lodging),
    venues: num(b.venues),
    crew: num(b.crew),
    food_per_diem: num(b.food_per_diem),
    contingency: num(b.contingency),
    total: num(b.total),
    currency: typeof b.currency === "string" && b.currency.trim() ? b.currency.trim().slice(0, 10).toUpperCase() : "USD",
    notes: Array.isArray(b.notes)
      ? (b.notes as unknown[]).filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 300)).slice(0, 10)
      : [],
  };
  return {
    stops,
    budget,
    routing_notes: typeof obj.routing_notes === "string" ? obj.routing_notes.slice(0, 2000) : "",
  };
}

export function buildOptimizeSystemPrompt(): string {
  return (
    `You are a tour routing and budgeting expert for independent music artists. ` +
    `Given a list of confirmed tour dates (city, venue, date), a home base, transport mode, and crew size, ` +
    `you produce: (1) an optimal stop order that minimizes total travel distance while respecting ` +
    `the fixed show dates (never move a show date — only reorder travel between them when dates allow; ` +
    `if dates are fixed and force backtracking, say so honestly), and (2) a realistic budget breakdown ` +
    `in USD covering travel, lodging, venue costs/fees, crew pay, food per-diem, and a 10-15% contingency. ` +
    `Be practical and indie-budget minded. These are ESTIMATES — real quotes will vary. ` +
    `Return ONLY JSON: {"stops": [{"date_id": "...", "travel_from_previous": "e.g. Drive Atlanta -> Nashville", ` +
    `"estimated_travel_miles": 250}], "budget": {"travel": 0, "lodging": 0, "venues": 0, "crew": 0, ` +
    `"food_per_diem": 0, "contingency": 0, "total": 0, "currency": "USD", "notes": ["..."]}, ` +
    `"routing_notes": "..."}. Include every date_id exactly once.`
  );
}

const router = Router();

/* GET /api/tour/dates — list the user's tour dates (free). */
router.get("/tour/dates", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(tourDatesTable)
      .where(eq(tourDatesTable.user_id, req.userId!))
      .orderBy(asc(tourDatesTable.show_date));
    res.json({ dates: rows });
  } catch (err) {
    logger.error({ err }, "[tour-planner] list dates failed");
    res.status(502).json({ error: "Couldn't load your tour dates — try again." });
  }
});

/* POST /api/tour/dates — add a tour date (free). */
router.post("/tour/dates", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = createTourDateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid tour date.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  try {
    const [row] = await db
      .insert(tourDatesTable)
      .values({
        user_id: req.userId!,
        city: parsed.data.city.trim(),
        venue: parsed.data.venue.trim(),
        show_date: new Date(parsed.data.show_date),
        notes: parsed.data.notes?.trim() || null,
        status: parsed.data.status ?? "upcoming",
      })
      .returning();
    res.status(201).json({ date: row });
  } catch (err) {
    logger.error({ err }, "[tour-planner] create date failed");
    res.status(502).json({ error: "Couldn't save the tour date — try again." });
  }
});

/* PUT /api/tour/dates/:id — update a tour date (free). */
router.put("/tour/dates/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = updateTourDateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid tour date update.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  const { id: rawId } = req.params;
  const id = String(rawId);
  const setValues: {
    city?: string;
    venue?: string;
    show_date?: Date;
    notes?: string | null;
    status?: (typeof TOUR_STATUSES)[number];
    updated_at: Date;
  } = { updated_at: new Date() };
  if (parsed.data.city !== undefined) setValues.city = parsed.data.city.trim();
  if (parsed.data.venue !== undefined) setValues.venue = parsed.data.venue.trim();
  if (parsed.data.show_date !== undefined) setValues.show_date = new Date(parsed.data.show_date);
  if (parsed.data.notes !== undefined) setValues.notes = parsed.data.notes.trim() || null;
  if (parsed.data.status !== undefined) setValues.status = parsed.data.status;
  if (Object.keys(setValues).length === 1) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  try {
    const [row] = await db
      .update(tourDatesTable)
      .set(setValues)
      .where(and(eq(tourDatesTable.id, id), eq(tourDatesTable.user_id, req.userId!)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Tour date not found." });
      return;
    }
    res.json({ date: row });
  } catch (err) {
    logger.error({ err }, "[tour-planner] update date failed");
    res.status(502).json({ error: "Couldn't update the tour date — try again." });
  }
});

/* DELETE /api/tour/dates/:id — delete a tour date (free). */
router.delete("/tour/dates/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const { id: rawId } = req.params;
  const id = String(rawId);
  try {
    const [row] = await db
      .delete(tourDatesTable)
      .where(and(eq(tourDatesTable.id, id), eq(tourDatesTable.user_id, req.userId!)))
      .returning({ id: tourDatesTable.id });
    if (!row) {
      res.status(404).json({ error: "Tour date not found." });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err }, "[tour-planner] delete date failed");
    res.status(502).json({ error: "Couldn't delete the tour date — try again." });
  }
});

/* POST /api/tour/optimize — AI routing + budget (3 credits).
   Body: { home_base, transport?, crew_size?, date_ids[] }
   Returns: { stops: OptimizedStop[], budget: BudgetBreakdown, routing_notes,
              creditsUsed, creditsRemaining } */
router.post("/tour/optimize", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = optimizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid optimize request.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  /* Load the user's dates and make sure every requested id is theirs. */
  let dates: Array<{ id: string; city: string; venue: string; show_date: Date }>;
  try {
    const rows: Array<{ id: string; city: string; venue: string; show_date: Date }> = await db
      .select({
        id: tourDatesTable.id,
        city: tourDatesTable.city,
        venue: tourDatesTable.venue,
        show_date: tourDatesTable.show_date,
      })
      .from(tourDatesTable)
      .where(eq(tourDatesTable.user_id, req.userId!));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = parsed.data.date_ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      res.status(404).json({ error: "One or more tour dates weren't found." });
      return;
    }
    dates = parsed.data.date_ids.map((id) => byId.get(id)!);
  } catch (err) {
    logger.error({ err }, "[tour-planner] load dates for optimize failed");
    res.status(502).json({ error: "Couldn't load your tour dates — try again." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < TOUR_PLANNER_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to run the AI tour optimizer.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, TOUR_PLANNER_CREDIT_COST, {
      action: "Tour Planner — AI routing + budget",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to run the AI tour optimizer.",
      });
      return;
    }
    throw err;
  }

  const refundOnFailure = async () => {
    try {
      await refundCredits(req.userId!, TOUR_PLANNER_CREDIT_COST, {
        action: "Tour Planner — Refund (optimization failed)",
      });
    } catch (refundErr) {
      logger.error(
        { err: refundErr, userId: req.userId },
        "[tour-planner] refund failed after optimization error",
      );
    }
  };

  try {
    const { home_base, transport, crew_size } = parsed.data;
    const dateList = dates
      .map(
        (d) =>
          `- id ${d.id}: ${d.city} — ${d.venue} on ${d.show_date.toISOString().slice(0, 10)}`,
      )
      .join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: buildOptimizeSystemPrompt() },
        {
          role: "user",
          content:
            `Home base: ${home_base}\nTransport mode: ${transport}\nCrew size: ${crew_size}\n\n` +
            `Tour dates:\n${dateList}\n\nOptimize the routing and estimate the budget.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.6,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let optimized: ReturnType<typeof parseOptimizationJson>;
    try {
      optimized = parseOptimizationJson(raw, parsed.data.date_ids);
    } catch (parseErr) {
      logger.warn({ err: parseErr }, "[tour-planner] model returned bad JSON");
      throw new Error("Model returned an unusable plan");
    }

    /* Re-key stops with the real date records (dates the model can't move). */
    const byId = new Map(dates.map((d) => [d.id, d]));
    const stops: OptimizedStop[] = optimized.stops.map((s, i) => {
      const d = byId.get(s.date_id)!;
      return {
        date_id: s.date_id,
        city: d.city,
        venue: d.venue,
        show_date: d.show_date.toISOString(),
        order: i + 1,
        travel_from_previous: s.travel_from_previous,
        estimated_travel_miles: s.estimated_travel_miles,
      };
    });

    res.json({
      stops,
      budget: optimized.budget,
      routing_notes: optimized.routing_notes,
      creditsUsed: TOUR_PLANNER_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure();
    if (
      err instanceof OpenAI.APIError &&
      (err.status === 429 || err.code === "insufficient_quota")
    ) {
      logger.warn({ err }, "[tour-planner] OpenAI rate limit / quota");
      res.status(503).json({
        error: "The studio is catching its breath — try again in a moment.",
      });
      return;
    }
    logger.error({ err }, "[tour-planner] optimization failed");
    res.status(502).json({ error: "The tour optimizer hiccupped — try again." });
  }
});

export default router;
