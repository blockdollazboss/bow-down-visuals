import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { jewelryProductByKey, jewelryFinishByKey } from "@workspace/db";

const router = Router();

/* ─── Custom jewelry line ───────────────────────────────────────────────
   Dropship, made-to-order. Reservation-only v1: no charge at reservation
   time; payment is collected when production is confirmed with the
   manufacturer. Statuses stay honest. */

const orderSchema = z.object({
  productKey: z.string().min(1).max(40),
  finish: z.string().min(1).max(20),
  sizeOption: z.string().min(1).max(40),
  engraving: z.string().max(60).optional().default(""),
  designNotes: z.string().max(500).optional().default(""),
  quantity: z.number().int().min(1).max(20),
  fullName: z.string().min(1).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(30).optional().default(""),
  shippingAddress: z.object({
    street: z.string().min(1).max(200),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(100),
    zip: z.string().min(1).max(20),
    country: z.string().min(1).max(100).default("USA"),
  }),
  idempotencyKey: z.string().min(8).max(100),
});

/* POST /api/jewelry/order — reserve a custom piece. */
router.post("/jewelry/order", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid order", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const product = jewelryProductByKey(body.productKey);
  const finish = jewelryFinishByKey(body.finish);
  if (!product) {
    res.status(400).json({ ok: false, error: "Unknown jewelry product" });
    return;
  }
  if (!finish) {
    res.status(400).json({ ok: false, error: "Unknown finish" });
    return;
  }
  if (!(product.sizes as readonly string[]).includes(body.sizeOption)) {
    res.status(400).json({ ok: false, error: "Invalid size for this piece" });
    return;
  }

  const supabase = getSupabaseAdmin();
  try {
    const { data: existing } = await supabase
      .from("jewelry_orders")
      .select("id, status, total_cents")
      .eq("idempotency_key", body.idempotencyKey)
      .maybeSingle();
    if (existing) {
      res.json({ ok: true, order: existing, deduped: true });
      return;
    }

    const totalCents = product.priceCents * body.quantity;
    const { data: order, error } = await supabase
      .from("jewelry_orders")
      .insert({
        user_id: userId,
        product_key: product.key,
        finish: finish.key,
        size_option: body.sizeOption,
        engraving: body.engraving || null,
        design_notes: body.designNotes || null,
        quantity: body.quantity,
        full_name: body.fullName,
        email: body.email,
        phone: body.phone || null,
        shipping_address: body.shippingAddress,
        status: "received",
        unit_price_cents: product.priceCents,
        total_cents: totalCents,
        idempotency_key: body.idempotencyKey,
      })
      .select("id, status, total_cents, product_key, finish, size_option, quantity, created_at")
      .single();
    if (error) throw error;
    res.json({ ok: true, order });
  } catch (err) {
    console.error("[jewelry] order failed", err);
    res.status(500).json({ ok: false, error: "Order failed" });
  }
});

/* GET /api/jewelry/orders — buyer's reservations. */
router.get("/jewelry/orders", requireAuth, async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jewelry_orders")
    .select("id, product_key, finish, size_option, engraving, quantity, status, total_cents, created_at")
    .eq("user_id", req.userId!)
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ ok: false, error: "Failed to load orders" });
    return;
  }
  res.json({ ok: true, orders: data ?? [] });
});

/* ── Admin ── */

router.get("/jewelry/admin/orders", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jewelry_orders")
    .select("id, user_id, product_key, finish, size_option, engraving, design_notes, quantity, full_name, email, phone, shipping_address, status, unit_price_cents, total_cents, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    res.status(500).json({ ok: false, error: "Failed to load orders" });
    return;
  }
  res.json({ ok: true, orders: data ?? [] });
});

/* GET /api/jewelry/admin/orders.csv — supplier data file. */
router.get("/jewelry/admin/orders.csv", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jewelry_orders")
    .select("id, product_key, finish, size_option, engraving, design_notes, quantity, full_name, email, phone, shipping_address, status, created_at")
    .eq("status", "received")
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    res.status(500).json({ ok: false, error: "Failed to export orders" });
    return;
  }
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = (data ?? []).map((o: Record<string, unknown>) => {
    const addr = (o.shipping_address ?? {}) as Record<string, string>;
    return [
      o.id, o.product_key, o.finish, o.size_option, o.engraving, o.design_notes,
      o.quantity, o.full_name, o.email, o.phone,
      addr.street, addr.city, addr.state, addr.zip, addr.country,
      o.status, o.created_at,
    ].map(esc).join(",");
  });
  const header = "order_id,product,finish,size,engraving,design_notes,quantity,full_name,email,phone,street,city,state,zip,country,status,created_at";
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=jewelry-orders.csv");
  res.send([header, ...rows].join("\n"));
});

export default router;
