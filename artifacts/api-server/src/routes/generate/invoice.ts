import { Router } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";
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

export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

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

/* POST /api/generate-invoice { brandName, creatorName, lineItems[], dueDate, … }
   → 200 { invoice, pdfBase64, pdfFilename, creditsUsed, creditsRemaining }
   Paid: 50 Visual Bucs. Auth required; charge first, refund on failure. */
router.post("/generate-invoice", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = invoiceRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid invoice request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < INVOICE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to generate your invoice.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, INVOICE_CREDIT_COST, {
      action: "Generate Invoice",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to generate your invoice.",
      });
      return;
    }
    throw err;
  }

  async function refund() {
    try {
      await refundCredits(req.userId!, INVOICE_CREDIT_COST, {
        action: "Generate Invoice — Refund (generation failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
  }

  try {
    const d = parsed.data;
    const totalCents = d.lineItems.reduce(
      (sum, item) => sum + Math.round(item.quantity * item.rateCents),
      0
    );
    const due = new Date(d.dueDate);

    let invoiceNumber = await nextInvoiceNumber(req.userId!);
    let inserted: Invoice | null = null;
    // Retry on invoice-number collision (per-user sequence race).
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        const rows = await db
          .insert(invoicesTable)
          .values({
            userId: req.userId!,
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
        const code = (dbErr as { code?: string } | null)?.code;
        if (code === "23505") {
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

    const pdf = renderInvoicePdf(inserted);

    await recordCreditUsage({
      userId: req.userId!,
      action: "Generate Invoice",
      creditsUsed: INVOICE_CREDIT_COST,
    });

    res.json({
      invoice: sanitizeRow(inserted),
      pdfBase64: pdfBufferToBase64(pdf),
      pdfFilename: `${inserted.invoiceNumber}.pdf`,
      creditsUsed: INVOICE_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    await refund();
    logger.error({ err }, "generate-invoice: failed, Visual Bucs refunded");
    res.status(502).json({
      error: "generation_failed",
      message: "Something went wrong generating your invoice — your Visual Bucs were refunded.",
    });
  }
});

/* GET /api/invoices — the creator's invoice list (free, no credits). */
router.get("/invoices", publicApiLimiter, requireAuth, async (req, res) => {
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
router.get("/invoices/:id/pdf", publicApiLimiter, requireAuth, async (req, res) => {
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
router.patch("/invoices/:id", publicApiLimiter, requireAuth, async (req, res) => {
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
