import { Router, type Request, type Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import { db, wave8SponsorDealsTable, moneyEntriesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

/* ─── Sponsor Deal Pipeline (Wave 8) ──────────────────────────────────────
   Deal CRUD is free (pure DB). The AI follow-up draft costs 50 Visual
   Bucs: getOpenAI() pre-check (503 ai_unavailable) BEFORE charging, charge
   upfront, refund on any failure — the creator never pays for a failed
   draft. last_followup_at is updated only after the draft succeeds.

   GET    /api/wave8/sponsors/deals       — list this user's deals
   POST   /api/wave8/sponsors/deals       — create a deal (stage: "pitched")
   PATCH  /api/wave8/sponsors/deals/:id  — update fields / move stage
   POST   /api/wave8/sponsors/followup   — 50 VB: AI follow-up email draft */

const FOLLOWUP_CREDITS = 50;
const STAGES = ["pitched", "negotiating", "closed", "paid"] as const;

const dealSchema = z.object({
  sponsorName: z.string().trim().min(1, "Give the sponsor a name.").max(120),
  dealValueCents: z.number().int().min(0).max(100_000_000_00).optional().default(0),
  contact: z.string().trim().max(160).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

const dealPatchSchema = z
  .object({
    sponsorName: z.string().trim().min(1).max(120).optional(),
    stage: z.enum(STAGES).optional(),
    dealValueCents: z.number().int().min(0).max(100_000_000_00).optional(),
    contact: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: "Nothing to update." });

const followupSchema = z.object({
  dealId: z.string().trim().min(1, "dealId is required."),
});

type DealRow = typeof wave8SponsorDealsTable.$inferSelect;

function toPublic(row: DealRow) {
  return {
    id: row.id,
    sponsorName: row.sponsor_name,
    stage: row.stage,
    dealValueCents: row.deal_value_cents,
    contact: row.contact,
    notes: row.notes,
    lastFollowupAt: row.last_followup_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function openAiUnavailable(res: Response): boolean {
  /* getOpenAI() throws naming OPENAI_API_KEY when the key is missing. */
  try {
    getOpenAI();
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is not configured — the follow-up drafter is unavailable."
        : "The follow-up drafter is unavailable right now.",
    });
    return true;
  }
}

function daysSince(iso: string | Date | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* GET /api/wave8/sponsors/deals — list deals, newest first */
router.get("/wave8/sponsors/deals", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(wave8SponsorDealsTable)
      .where(eq(wave8SponsorDealsTable.user_id, req.userId!))
      .orderBy(desc(wave8SponsorDealsTable.created_at));
    res.json({ deals: rows.map(toPublic) });
  } catch (err) {
    logger.error({ err }, "[wave8-sponsors] list failed");
    res.status(500).json({ error: "Could not load your sponsor deals." });
  }
});

/* POST /api/wave8/sponsors/deals — create a deal (free, starts pitched) */
router.post("/wave8/sponsors/deals", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = dealSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid sponsor deal.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const [row] = await db
      .insert(wave8SponsorDealsTable)
      .values({
        user_id: req.userId!,
        sponsor_name: parsed.data.sponsorName,
        stage: "pitched",
        deal_value_cents: parsed.data.dealValueCents ?? 0,
        contact: parsed.data.contact ?? "",
        notes: parsed.data.notes ?? "",
      })
      .returning();
    res.status(201).json({ deal: toPublic(row) });
  } catch (err) {
    logger.error({ err }, "[wave8-sponsors] create failed");
    res.status(500).json({ error: "Could not save the sponsor deal." });
  }
});

/* PATCH /api/wave8/sponsors/deals/:id — update fields or move stage (free) */
router.patch("/wave8/sponsors/deals/:id", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json({ error: "Deal id is required." });
    return;
  }
  const parsed = dealPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid sponsor deal update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const [row] = await db
      .update(wave8SponsorDealsTable)
      .set({
        ...(parsed.data.sponsorName !== undefined ? { sponsor_name: parsed.data.sponsorName } : {}),
        ...(parsed.data.stage !== undefined ? { stage: parsed.data.stage } : {}),
        ...(parsed.data.dealValueCents !== undefined ? { deal_value_cents: parsed.data.dealValueCents } : {}),
        ...(parsed.data.contact !== undefined ? { contact: parsed.data.contact } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        updated_at: new Date(),
      })
      .where(and(eq(wave8SponsorDealsTable.id, id), eq(wave8SponsorDealsTable.user_id, req.userId!)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Sponsor deal not found." });
      return;
    }
    res.json({ deal: toPublic(row) });
  } catch (err) {
    logger.error({ err }, "[wave8-sponsors] update failed");
    res.status(500).json({ error: "Could not update the sponsor deal." });
  }
});

/* POST /api/wave8/sponsors/deals/:id/mark-paid — TRANSACTIONAL.
   Marks the deal paid AND posts the deal value to the income ledger in a
   single DB transaction. If the ledger insert fails, the deal keeps its
   prior stage — the client can retry safely. Free (pure DB). */
router.post("/wave8/sponsors/deals/:id/mark-paid", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json({ error: "Deal id is required." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [deal] = await tx
        .select()
        .from(wave8SponsorDealsTable)
        .where(and(eq(wave8SponsorDealsTable.id, id), eq(wave8SponsorDealsTable.user_id, req.userId!)))
        .limit(1);
      if (!deal) return null;
      const [updated] = await tx
        .update(wave8SponsorDealsTable)
        .set({ stage: "paid", updated_at: new Date() })
        .where(and(eq(wave8SponsorDealsTable.id, id), eq(wave8SponsorDealsTable.user_id, req.userId!)))
        .returning();
      let entry: unknown = null;
      if (updated.deal_value_cents > 0) {
        const [row] = await tx
          .insert(moneyEntriesTable)
          .values({
            user_id: req.userId!,
            entry_type: "income",
            category: "Sponsorship",
            amount_cents: updated.deal_value_cents,
            note: updated.sponsor_name.slice(0, 280),
            entry_date: new Date().toISOString().slice(0, 10),
          })
          .returning();
        entry = row;
      }
      return { deal: toPublic(updated), entry, posted: !!entry };
    });
    if (!result) {
      res.status(404).json({ error: "Sponsor deal not found." });
      return;
    }
    res.json(result);
  } catch (err) {
    /* Transaction rolled back: the deal keeps its prior stage. Retryable. */
    logger.error({ err }, "[wave8-sponsors] mark-paid failed, rolled back");
    res.status(500).json({ error: "Could not mark the deal paid — nothing was changed. Please try again." });
  }
});

/* POST /api/wave8/sponsors/followup — 50 Visual Bucs: AI drafts a follow-up
   email grounded in the deal's real state (stage, value, notes, days since
   the last follow-up). last_followup_at is stamped only on success. */
router.post("/wave8/sponsors/followup", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = followupSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid follow-up request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (openAiUnavailable(res)) return;

  const balance = req.userCredits ?? 0;
  if (balance < FOLLOWUP_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to draft a sponsor follow-up.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, FOLLOWUP_CREDITS, {
      action: "Sponsor Follow-up Draft",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to draft a sponsor follow-up.",
      });
      return;
    }
    throw err;
  }

  try {
    const rows = await db
      .select()
      .from(wave8SponsorDealsTable)
      .where(and(eq(wave8SponsorDealsTable.id, parsed.data.dealId), eq(wave8SponsorDealsTable.user_id, req.userId!)))
      .limit(1);
    const deal = rows[0];
    if (!deal) {
      throw Object.assign(new Error("Sponsor deal not found."), { status: 404 });
    }

    const since = daysSince(deal.last_followup_at);
    const recencyLine =
      since === null
        ? "No follow-up has been sent for this deal yet."
        : since === 0
          ? "A follow-up was already sent today."
          : `The last follow-up was ${since} day${since === 1 ? "" : "s"} ago.`;

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a sponsorship deal closer for content creators. Draft ONE follow-up email " +
            "for a sponsor deal. Ground everything in the real deal details — never invent " +
            "numbers, deliverables, or past conversations. Keep it short, warm, and professional: " +
            "one clear nudge tied to the deal's current stage, no pressure, no fake urgency, no " +
            "made-up deadlines. Match the tone to the stage: pitched = re-open the conversation, " +
            "negotiating = move the terms forward, closed = lock in next steps, paid = thank " +
            "them and tee up the next campaign. Respond ONLY with JSON: " +
            '{ "subject": "<email subject line>", "body": "<the email body, plain text>" }.',
        },
        {
          role: "user",
          content: JSON.stringify({
            sponsorName: deal.sponsor_name,
            stage: deal.stage,
            dealValue: deal.deal_value_cents > 0 ? fmtMoney(deal.deal_value_cents) : "not set",
            contact: deal.contact || "not set",
            notes: deal.notes || "none",
            recency: recencyLine,
          }),
        },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    let draft: { subject?: unknown; body?: unknown } = {};
    try {
      draft = JSON.parse(text);
    } catch {
      const stripped = text.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
      try {
        draft = JSON.parse(stripped);
      } catch {
        draft = {};
      }
    }
    const subject = typeof draft.subject === "string" && draft.subject.trim()
      ? draft.subject.trim().slice(0, 160)
      : `Following up with ${deal.sponsor_name}`;
    const body = typeof draft.body === "string" && draft.body.trim()
      ? draft.body.trim()
      : text.trim() || "Couldn't draft a follow-up — try again.";

    const [updated] = await db
      .update(wave8SponsorDealsTable)
      .set({ last_followup_at: new Date(), updated_at: new Date() })
      .where(and(eq(wave8SponsorDealsTable.id, deal.id), eq(wave8SponsorDealsTable.user_id, req.userId!)))
      .returning();

    res.json({
      subject,
      body,
      lastFollowupAt: updated?.last_followup_at ?? new Date().toISOString(),
      creditsUsed: FOLLOWUP_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    /* The charge was taken before the model call — give it back so a
       provider failure never costs the creator. */
    try {
      await refundCredits(req.userId!, FOLLOWUP_CREDITS, {
        action: "Sponsor Follow-up Draft — Refund (draft failed)",
      });
    } catch (refundErr) {
      logger.error(
        { err: refundErr, userId: req.userId },
        "[wave8-sponsors] refund failed after follow-up draft failure",
      );
    }
    const status = (err as { status?: number }).status;
    if (status === 404) {
      res.status(404).json({ error: "Sponsor deal not found." });
      return;
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[wave8-sponsors] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[wave8-sponsors] follow-up draft failed");
    res.status(502).json({ error: "Could not draft the follow-up — try again." });
  }
});

export default router;
