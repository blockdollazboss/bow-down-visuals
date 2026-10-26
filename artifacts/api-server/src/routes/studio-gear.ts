import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  STUDIO_GEAR_PRODUCTS,
  STUDIO_GEAR_FULFILLMENT,
  STUDIO_GEAR_TEST_MODE,
  gearPriceCents,
  gearProductById,
  validateGearSelection,
  initialGearOrderState,
  canTransitionProof,
  gearOrderStatusFor,
  productionAllowed,
  type GearProductId,
  type GearVariant,
  type StudioGearProofStatus,
} from "../lib/studio-gear";

/* ─── Studio Gear rail — Branding Shop studio-gear line ──────────────────
   Owner ruling, Oct 25 2026 (prices in lib/studio-gear.ts — ruled, never
   invented). Made-to-order partners only, NO inventory, partner ships
   direct. Every creator-custom piece is proof-gated: production starts
   only after the buyer approves the design proof AND the order is paid.

   TEST MODE (standing): this rail NEVER takes a real charge. There is
   deliberately no Stripe import in this file — checkout is a labeled
   test completion that stamps a `test_…` session id. Do not wire a live
   charge here without a fresh owner ruling.

   Order flow:
     POST /studio-gear/orders            place order (FREE intake)
     POST /studio-gear/checkout          test-mode completion (paid=true)
     POST /admin/studio-gear/orders/:id/proof/send    team relays the
                                         partner's proof → proof_sent
     POST /studio-gear/orders/:id/proof/approve       buyer approves →
                                         in_production once paid
     POST /studio-gear/orders/:id/proof/request-revision  buyer sends it
                                         back with a note → proof_pending
     GET  /studio-gear/orders            my orders
     GET  /studio-gear/catalog           the ruled catalog (public) */

const router = Router();

const PRODUCT_IDS = STUDIO_GEAR_PRODUCTS.map((p) => p.id) as [
  GearProductId,
  ...GearProductId[],
];

const orderItemSchema = z.object({
  product: z.enum(PRODUCT_IDS),
  variant: z.enum(["house", "custom"]),
  option: z.string().min(1).max(20),
  qty: z.number().int().min(1).max(99),
  /* Creator-custom spec fields — the artwork / words the proof is built
     from. Required (at least one) for custom items; ignored for house. */
  customText: z.string().max(200).optional(),
  specNotes: z.string().max(1000).optional(),
  artworkUrl: z.string().url().max(2000).optional(),
});

const orderSchema = z.object({
  items: orderItemSchema.array().min(1, "Your cart is empty.").max(20),
  name: z.string().min(1, "Name is required.").max(120),
  email: z.string().email("Enter a valid email.").max(200),
  address: z.string().min(1, "Address is required.").max(300),
  city: z.string().min(1, "City is required.").max(120),
  state: z.string().min(1, "State is required.").max(120),
  zip: z.string().min(1, "ZIP is required.").max(30),
});

interface GearOrderRow {
  id: string;
  items: Array<{
    product: GearProductId;
    variant: GearVariant;
    option: string;
    qty: number;
    unitPriceCents: number;
    customText?: string;
    specNotes?: string;
    artworkUrl?: string;
  }>;
  total_cents: number;
  status: string;
  proof_status: StudioGearProofStatus;
  proof_url: string | null;
  proof_note: string | null;
  paid: boolean;
  test_mode: boolean;
  created_at: string;
}

function presentOrder(r: GearOrderRow) {
  return {
    id: r.id,
    items: r.items,
    totalCents: r.total_cents,
    status: r.status,
    proofStatus: r.proof_status,
    proofUrl: r.proof_url,
    proofNote: r.proof_note,
    paid: r.paid,
    testMode: r.test_mode,
    createdAt: r.created_at,
  };
}

async function selectOrder(
  orderId: string,
  userId?: string,
): Promise<GearOrderRow | undefined> {
  const result = userId
    ? await db.execute(sql`
        SELECT id, items, total_cents, status, proof_status, proof_url,
               proof_note, paid, test_mode, created_at
        FROM studio_gear_orders
        WHERE id = ${orderId} AND user_id = ${userId}
        LIMIT 1
      `)
    : await db.execute(sql`
        SELECT id, items, total_cents, status, proof_status, proof_url,
               proof_note, paid, test_mode, created_at
        FROM studio_gear_orders
        WHERE id = ${orderId}
        LIMIT 1
      `);
  return result.rows[0] as unknown as GearOrderRow | undefined;
}

/* ── GET /studio-gear/catalog — the ruled catalog (public, FREE) ─────── */
router.get("/studio-gear/catalog", (_req, res) => {
  res.json({
    testMode: STUDIO_GEAR_TEST_MODE,
    fulfillment: STUDIO_GEAR_FULFILLMENT,
    products: STUDIO_GEAR_PRODUCTS,
  });
});

/* ── POST /studio-gear/orders — place an order (FREE intake) ───────────
   Totals are recomputed server-side from the ruled catalog — the client
   total is never trusted. Custom items must carry a spec (text, notes,
   or artwork) or there is nothing to build a proof from. */
router.post("/studio-gear/orders", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = orderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid order.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { items, name, email, address, city, state, zip } = parsed.data;

  let totalCents = 0;
  for (const item of items) {
    const err = validateGearSelection(item);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    if (
      item.variant === "custom" &&
      !item.customText?.trim() &&
      !item.specNotes?.trim() &&
      !item.artworkUrl
    ) {
      res.status(400).json({
        error: `Creator-custom ${gearProductById(item.product).label} needs your text, notes, or artwork upload — the design proof is built from it.`,
      });
      return;
    }
    totalCents += gearPriceCents(item.product, item.variant, item.option) * item.qty;
  }

  const { status, proofStatus } = initialGearOrderState(items);
  const id = randomUUID();
  const itemsJson = JSON.stringify(
    items.map((i) => ({
      ...i,
      unitPriceCents: gearPriceCents(i.product, i.variant, i.option),
    })),
  );
  const result = await db.execute(sql`
    INSERT INTO studio_gear_orders
      (id, user_id, items, total_cents, name, email, address, city, state, zip,
       status, proof_status, test_mode)
    VALUES
      (${id}, ${req.userId!}, ${itemsJson}::jsonb, ${totalCents}, ${name.trim()},
       ${email.trim()}, ${address.trim()}, ${city.trim()}, ${state.trim()},
       ${zip.trim()}, ${status}, ${proofStatus}, ${STUDIO_GEAR_TEST_MODE})
    RETURNING id, status, proof_status, total_cents, created_at
  `);
  const row = result.rows[0] as unknown as {
    id: string;
    status: string;
    proof_status: string;
    total_cents: number;
    created_at: string;
  };
  res.status(201).json({
    order: {
      id: row.id,
      status: row.status,
      proofStatus: row.proof_status,
      totalCents: row.total_cents,
      createdAt: row.created_at,
      testMode: STUDIO_GEAR_TEST_MODE,
    },
    message:
      proofStatus === "pending"
        ? "Order received! Your design proof comes first — production starts only after you approve it. Test mode: no real charge is taken at checkout."
        : "Order received! Test mode: no real charge is taken at checkout.",
  });
});

/* ── POST /studio-gear/checkout — TEST-MODE completion (no real charge) ─
   Marks the order paid with a test session id. Production still waits on
   the proof gate for custom orders — paying never skips a proof. */
router.post("/studio-gear/checkout", publicApiLimiter, requireAuth, async (req, res) => {
  const { orderId } = (req.body ?? {}) as { orderId?: string };
  if (!orderId || typeof orderId !== "string") {
    res.status(400).json({ error: "orderId is required." });
    return;
  }
  const order = await selectOrder(orderId, req.userId!);
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (order.paid) {
    res.status(400).json({ error: "This order is already paid." });
    return;
  }
  /* Recompute + verify the stored total against the ruled catalog. */
  let totalCents = 0;
  for (const item of order.items) {
    const err = validateGearSelection(item);
    if (err) {
      res.status(400).json({ error: `Order contains an invalid item: ${err}` });
      return;
    }
    totalCents += gearPriceCents(item.product, item.variant, item.option) * item.qty;
  }
  if (totalCents !== order.total_cents || totalCents <= 0) {
    res.status(400).json({ error: "Order total mismatch — please place the order again." });
    return;
  }

  const nextStatus = gearOrderStatusFor(true, order.proof_status);
  await db.execute(sql`
    UPDATE studio_gear_orders
    SET paid = TRUE,
        stripe_session_id = ${`test_${randomUUID()}`},
        status = ${nextStatus},
        updated_at = now()
    WHERE id = ${order.id}
  `);
  logger.info({ orderId: order.id }, "[studio-gear] test-mode checkout completed — no real charge");
  res.json({
    testMode: true,
    mock: true,
    orderId: order.id,
    status: nextStatus,
    productionStarted: productionAllowed(order.proof_status),
    message: productionAllowed(order.proof_status)
      ? "Test checkout complete — no real payment was taken. Your piece is made to order and ships direct from the partner."
      : "Test checkout complete — no real payment was taken. Production starts after you approve the design proof.",
  });
});

/* ── GET /studio-gear/orders — my orders (FREE) ──────────────────────── */
router.get("/studio-gear/orders", requireAuth, async (req, res) => {
  const result = await db.execute(sql`
    SELECT id, items, total_cents, status, proof_status, proof_url,
           proof_note, paid, test_mode, created_at
    FROM studio_gear_orders
    WHERE user_id = ${req.userId!}
    ORDER BY created_at DESC
    LIMIT 100
  `);
  res.json({
    testMode: STUDIO_GEAR_TEST_MODE,
    orders: (result.rows as unknown as GearOrderRow[]).map(presentOrder),
  });
});

/* ── POST /admin/studio-gear/orders/:id/proof/send — team relays proof ──
   The partner's design proof, relayed by the team. Only from a pending /
   revision-requested proof state; the buyer then approves or sends it
   back. Admin-gated (fail-closed ADMIN_EMAILS, the routes/admin rule). */
router.post(
  "/admin/studio-gear/orders/:id/proof/send",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { proofUrl, proofNote } = (req.body ?? {}) as {
      proofUrl?: string;
      proofNote?: string;
    };
    if (!proofUrl || typeof proofUrl !== "string" || proofUrl.length > 2000) {
      res.status(400).json({ error: "proofUrl is required." });
      return;
    }
    const order = await selectOrder(req.params.id as string);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (!canTransitionProof(order.proof_status, "sent")) {
      res.status(400).json({
        error: `A proof cannot be sent while this order's proof is "${order.proof_status}".`,
      });
      return;
    }
    const nextStatus = gearOrderStatusFor(order.paid, "sent");
    await db.execute(sql`
      UPDATE studio_gear_orders
      SET proof_status = 'sent', proof_url = ${proofUrl},
          proof_note = ${proofNote?.slice(0, 1000) ?? null},
          status = ${nextStatus}, updated_at = now()
      WHERE id = ${order.id}
    `);
    res.json({ orderId: order.id, proofStatus: "sent", status: nextStatus });
  },
);

/* ── POST /studio-gear/orders/:id/proof/approve — buyer approves ───────
   The proof gate itself: only a SENT proof can be approved, and approval
   is what unlocks production (once paid). */
router.post("/studio-gear/orders/:id/proof/approve", requireAuth, async (req, res) => {
  const order = await selectOrder(req.params.id as string, req.userId!);
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (!canTransitionProof(order.proof_status, "approved")) {
    res.status(400).json({
      error:
        order.proof_status === "not_required"
          ? "This order uses the house design — no proof to approve."
          : `There is no sent proof to approve (proof is "${order.proof_status}").`,
    });
    return;
  }
  const nextStatus = gearOrderStatusFor(order.paid, "approved");
  await db.execute(sql`
    UPDATE studio_gear_orders
    SET proof_status = 'approved', status = ${nextStatus}, updated_at = now()
    WHERE id = ${order.id}
  `);
  res.json({
    orderId: order.id,
    proofStatus: "approved",
    status: nextStatus,
    message: order.paid
      ? "Proof approved — production is starting. Your piece is made to order and ships direct from the partner."
      : "Proof approved! Complete the test checkout and production starts.",
  });
});

/* ── POST /studio-gear/orders/:id/proof/request-revision — send it back ─ */
router.post(
  "/studio-gear/orders/:id/proof/request-revision",
  requireAuth,
  async (req, res) => {
    const { note } = (req.body ?? {}) as { note?: string };
    if (!note || typeof note !== "string" || !note.trim()) {
      res.status(400).json({ error: "Tell us what to change — a revision note is required." });
      return;
    }
    const order = await selectOrder(req.params.id as string, req.userId!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (!canTransitionProof(order.proof_status, "revision_requested")) {
      res.status(400).json({
        error: `There is no sent proof to revise (proof is "${order.proof_status}").`,
      });
      return;
    }
    const nextStatus = gearOrderStatusFor(order.paid, "revision_requested");
    await db.execute(sql`
      UPDATE studio_gear_orders
      SET proof_status = 'revision_requested', proof_note = ${note.trim().slice(0, 1000)},
          status = ${nextStatus}, updated_at = now()
      WHERE id = ${order.id}
    `);
    res.json({
      orderId: order.id,
      proofStatus: "revision_requested",
      status: nextStatus,
      message: "Sent back — a revised proof will follow. Production has not started.",
    });
  },
);

export default router;

/* Re-exported for tests: schemas + catalog seam. */
export { orderSchema, orderItemSchema };
