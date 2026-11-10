import { Router, type Response } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { isUniqueViolation } from "../../lib/pg-errors";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import { db, invoicesTable, INVOICE_STATUSES, type Invoice } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { renderInvoicePdf } from "../../lib/invoice-render";

const router = Router();

/* ─── Sponsor Invoice Generator ───────────────────────────────────────────
   Creators who land brand deals bill the sponsor with a gold/black luxury
   branded invoice PDF. Lives inside the Sponsorship Outreach workflow, right
   next to the sponsor-read generator ("Deal landed?" panel): the read
   fulfills the deal creatively, the invoice fulfills it financially.

   Pricing: 50 Visual Bucs per generated PDF (env-overridable). PDF is
   rendered server-side from a zero-dependency writer (lib/pdf.ts) — no
   provider fees, so the margin is full. Credits are deducted BEFORE the
   PDF is generated, with automatic refund on failure.

   Handoff chain: invoice marked paid → "Log to Money Tracker" deep link
   (?income=) hands the amount to the income tracker. */

export const INVOICE_CREDIT_COST = Number(process.env["INVOICE_CREDITS"]) || 50;

const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Line item description is required.").max(200),
  quantity: z.number().min(0.01, "Quantity must be positive.").max(1_000_000),
  rateCents: z.number().int().min(0, "Rate can't be negative.").max(1_000_000_000),
});

export const invoiceRequestSchema = z.object({
  brandName: z.string().trim().min(1, "Brand name is required.").max(100),
  brandEmail: z.string().trim().email("Brand email must be valid.").max(200).optional().or(z.literal("")),
  creatorName: z.string().trim().min(1, "Creator name is required.").max(100),
  creatorEmail: z.string().trim().email("Creator email must be valid.").max(200).optional().or(z.literal("")),
  paymentDetails: z.string().trim().max(500).optional().default(""),
  lineItems: lineItemSchema.array().min(1, "Add at least one line item.").max(25, "Keep it to 25 line items or fewer."),
  currency: z.string().trim().length(3, "Currency must be a 3-letter code.").default("USD").transform((c) => c.toUpperCase()),
  dueDate: z.string().trim().refine((s) => !Number.isNaN(Date.parse(s)), "Due date must be a valid date."),
  notes: z.string().trim().max(1000).optional().default(""),
});


function sanitizeRow(inv: Invoice) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    brandName: inv.brandName,
    brandEmail: inv.brandEmail,
    creatorName: inv.creatorName,
    creatorEmail: inv.creatorEmail,
    paymentDetails: inv.paymentDetails,
    lineItems: inv.lineItems,
    totalCents: inv.totalCents,
    currency: inv.currency,
    dueDate: inv.dueDate,
    notes: inv.notes,
    status: inv.status,
    paidAt: inv.paidAt,
    createdAt: inv.createdAt,
  };
}

function buildInvoiceNumber(year: number, seq: number): string {
  return `BDV-${year}-${String(seq).padStart(4, "0")}`;
}

async function nextInvoiceNumber(userId: string): Promise<string> {
  const year = new Date().getFullYear();
  // Derive the next sequence number from this user's existing invoice count.
  const countRows = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM invoices WHERE user_id = ${userId}`
  );
  const base = Number(countRows.rows[0]?.c ?? 0);
  return buildInvoiceNumber(year, base + 1);
}

function pdfBufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}


/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request re-charged and re-ran the work. Now the server
   derives the key from the request intent on EVERY call, a
   stored-result pre-check (durable table, migration 0333, then the
   in-process cache) answers a replay with no charge and no provider
   call, and a failed attempt refunds AND voids its key so a genuine
   retry charges fresh. An identical ask serves the stored result
   with replayed: true instead of charging again (C-36 ruling). */
const INVOICE_SCOPE = "generate-invoice";
const INVOICE_REPLAY_NOTE =
  "This is the invoice you already generated for this request — it is saved in your invoice list; change the details for a new one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetInvoiceReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

/**
 * Serve one replayable run: durable + in-process stored-result
 * pre-checks before any funding, the in-flight twin wait for a
 * concurrent duplicate, then the run itself. A success is stored
 * BEFORE answering (contracts / post-assist pattern); an error body
 * (carrying __status) is answered bare and never stored.
 */
async function serveReplayableRun(args: {
  res: Response;
  userId: string;
  idempotencyKey: string;
  run: () => Promise<Record<string, unknown>>;
}): Promise<void> {
  const { res, userId, idempotencyKey } = args;
  const replayOf = (body: Record<string, unknown>) => ({
    ...body, replayed: true, replayNote: INVOICE_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(INVOICE_SCOPE, idempotencyKey, userId);
  if (durable) {
    res.json(replayOf(durable));
    return;
  }
  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json(replayOf(stored.body));
    return;
  }
  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json(replayOf(twinBody));
      return;
    }
    /* The twin failed (refunded + key voided) — fall through fresh. */
  }

  const runPromise = args.run();
  inFlight.set(idempotencyKey, runPromise);
  let body: Record<string, unknown>;
  try {
    body = await runPromise;
  } finally {
    if (inFlight.get(idempotencyKey) === runPromise) inFlight.delete(idempotencyKey);
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
    await storeGenerationResult(INVOICE_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

/* Pattern C (CA-3): the charge guards a SIDE EFFECT — a persisted
   invoice row. The stored result carries the created row (id +
   number) inside the saved success body, so a replay returns that
   same invoice WITHOUT inserting a second row or charging again.
   Failure side: if the run fails AFTER the insert (the PDF render
   is the step that can), the catch rolls the row back — a refunded
   attempt leaves no invoice in the customer's list, and a retry
   mints exactly one. */
async function runGenerateInvoice(
  userId: string,
  userCredits: number,
  data: z.infer<typeof invoiceRequestSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const balance = userCredits;
  if (balance < INVOICE_CREDIT_COST) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to generate your invoice.",
    };
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(userId, INVOICE_CREDIT_COST, {
      action: "Generate Invoice",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to generate your invoice.",
      };
    }
    throw err;
  }

  async function refund() {
    let refunded = true;
    try {
      await refundCredits(userId, INVOICE_CREDIT_COST, {
        action: "Generate Invoice — Refund (generation failed)",
      });
    } catch (refundErr) {
      refunded = false;
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
  }

  /* The row this run inserted, if it got that far. Hoisted so the
     failure path can roll it back (see the catch below). */
  let insertedRow: Invoice | null = null;

  try {
    const d = data;
    const totalCents = d.lineItems.reduce(
      (sum, item) => sum + Math.round(item.quantity * item.rateCents),
      0
    );
    const due = new Date(d.dueDate);

    let invoiceNumber = await nextInvoiceNumber(userId);
    let inserted: Invoice | null = null;
    // Retry on invoice-number collision (per-user sequence race).
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        const rows = await db
          .insert(invoicesTable)
          .values({
            userId,
            invoiceNumber,
            brandName: d.brandName,
            brandEmail: d.brandEmail || null,
            creatorName: d.creatorName,
            creatorEmail: d.creatorEmail || null,
            paymentDetails: d.paymentDetails || null,
            lineItems: d.lineItems.map((i) => ({
              description: i.description,
              quantity: i.quantity,
              rateCents: i.rateCents,
            })),
            totalCents,
            currency: d.currency,
            dueDate: due,
            notes: d.notes || null,
            status: "unpaid",
          })
          .returning();
        inserted = rows[0] ?? null;
      } catch (dbErr) {
        if (isUniqueViolation(dbErr)) {
          // invoice_number collision — bump and retry
          invoiceNumber = buildInvoiceNumber(
            new Date().getFullYear(),
            Math.floor(Math.random() * 900000) + 100000
          );
          continue;
        }
        throw dbErr;
      }
    }
    if (!inserted) {
      throw new Error("Could not save the invoice — please try again.");
    }
    insertedRow = inserted;

    const pdf = renderInvoicePdf(inserted);

    /* Ledger row already written by chargeCredits above (Stack400 Lane 4 duplicate removed). */

    return {
      invoice: sanitizeRow(inserted),
      pdfBase64: pdfBufferToBase64(pdf),
      pdfFilename: `${inserted.invoiceNumber}.pdf`,
      creditsUsed: INVOICE_CREDIT_COST,
      creditsRemaining,
    };
  } catch (err) {
    /* Roll back the invoice row if this run inserted one before the
       failure (e.g. the PDF render threw after the insert): the
       charge is refunded below, so the attempt must leave NO invoice
       behind. A leftover row would sit in the customer's invoice
       list as a real invoice they were just told failed — and the
       retry would mint a second one next to it (the CA-3 flagged
       duplicate-row edge). Best-effort: a failed rollback is logged
       loudly, never masking the refund or the failure response. */
    if (insertedRow) {
      try {
        await db
          .delete(invoicesTable)
          .where(and(eq(invoicesTable.id, insertedRow.id), eq(invoicesTable.userId, userId)));
      } catch (rollbackErr) {
        logger.error(
          { err: rollbackErr, invoiceId: insertedRow.id },
          "generate-invoice: invoice-row rollback failed — orphan row remains",
        );
      }
    }
    await refund();
    logger.error({ err }, "generate-invoice: failed, Visual Bucs refunded");
    return {
      __status: 502,
      error: "generation_failed",
      message: "Something went wrong generating your invoice — your Visual Bucs were refunded.",
    };
  }
}

/* POST /api/generate-invoice { brandName, creatorName, lineItems[], dueDate, … }
   → 200 { invoice, pdfBase64, pdfFilename, creditsUsed, creditsRemaining }
   Paid: 50 Visual Bucs. Auth required; charge first, refund on failure. */
router.post("/generate-invoice", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = invoiceRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid invoice request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const idempotencyKey = buildChargeIdempotencyKey(
    INVOICE_SCOPE, req.userId!, undefined, parsed.data,
  );
  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runGenerateInvoice(req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey),
  });
});

/* GET /api/invoices — the creator's invoice list (free, no credits). */
router.get("/invoices", requireAuth, publicApiLimiter, async (req, res) => {
  const rows = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.userId, req.userId!))
    .orderBy(desc(invoicesTable.createdAt))
    .limit(100);
  res.json({ invoices: rows.map(sanitizeRow) });
});

/* GET /api/invoices/:id/pdf — download the branded PDF (free, regenerated
   from the stored row). */
router.get("/invoices/:id/pdf", requireAuth, publicApiLimiter, async (req, res) => {
  const invoiceId = req.params["id"] as string;
  const rows = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.userId, req.userId!)))
    .limit(1);
  const inv = rows[0];
  if (!inv) {
    res.status(404).json({ error: "Invoice not found." });
    return;
  }
  const pdf = renderInvoicePdf(inv);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNumber}.pdf"`);
  res.send(pdf);
});

/* PATCH /api/invoices/:id { status: "paid" | "unpaid" } — mark an invoice
   paid or unpaid (free; the creator's bookkeeping, no AI cost). */
router.patch("/invoices/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const schema = z.object({ status: z.enum(INVOICE_STATUSES) });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Status must be one of: unpaid, paid." });
    return;
  }
  const status = parsed.data.status;
  const invoiceId = req.params["id"] as string;
  const rows = await db
    .update(invoicesTable)
    .set({ status, paidAt: status === "paid" ? new Date() : null })
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.userId, req.userId!)))
    .returning();
  const inv = rows[0];
  if (!inv) {
    res.status(404).json({ error: "Invoice not found." });
    return;
  }
  res.json({ invoice: sanitizeRow(inv) });
});

export default router;
