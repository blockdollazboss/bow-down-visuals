import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { nfcCardStyleByKey } from "@workspace/db";
import { generateNfcQrSvg, nfcProfileUrl } from "../lib/nfc-qr";

const router = Router();

/** Express 5 types params as string | string[] — we only use single values. */
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

/* ─── NFC business-card line ────────────────────────────────────────────
   Dropship model. Order statuses stay honest: "received" /
   "pending_fulfillment" until a real fulfillment integration reports
   otherwise. Payment wiring comes after supplier selection — v1 captures
   the order + builds the buyer's digital profile (the tap destination). */

const linkSchema = z.object({
  label: z.string().min(1).max(60),
  url: z.string().url().max(500),
});

const orderSchema = z.object({
  cardStyle: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(100),
  displayName: z.string().min(1).max(80),
  title: z.string().max(80).optional().default(""),
  bio: z.string().max(500).optional().default(""),
  links: z.array(linkSchema).max(12).default([]),
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

const profileUpdateSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  title: z.string().max(80).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  links: z.array(linkSchema).max(12).optional(),
  isActive: z.boolean().optional(),
});

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "card";
}

async function uniqueSlug(supabase: ReturnType<typeof getSupabaseAdmin>, base: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = `${base}-${randomBytes(3).toString("hex")}`;
    const { data } = await supabase.from("nfc_profiles").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/* POST /api/nfc-cards/order — create the digital profile + physical order. */
router.post("/nfc-cards/order", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid order", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const style = nfcCardStyleByKey(body.cardStyle);
  if (!style) {
    res.status(400).json({ ok: false, error: "Unknown card style" });
    return;
  }

  const supabase = getSupabaseAdmin();
  try {
    // Idempotency: a retried submit returns the original order.
    const { data: existing } = await supabase
      .from("nfc_card_orders")
      .select("id, status, total_cents")
      .eq("idempotency_key", body.idempotencyKey)
      .maybeSingle();
    if (existing) {
      res.json({ ok: true, order: existing, deduped: true });
      return;
    }

    const baseSlug = slugify(body.displayName);
    const createdProfiles: Array<{ id: string; slug: string }> = [];
    try {
      // One profile per physical card — every card gets a unique NFC URL + QR.
      for (let i = 0; i < body.quantity; i++) {
        const slug = await uniqueSlug(supabase, baseSlug);
        const { data: profile, error: profileErr } = await supabase
          .from("nfc_profiles")
          .insert({
            slug,
            user_id: userId,
            display_name: body.displayName,
            title: body.title || null,
            bio: body.bio || null,
            links: body.links,
          })
          .select("id, slug")
          .single();
        if (profileErr) throw profileErr;
        createdProfiles.push(profile);
      }

      const totalCents = style.priceCents * body.quantity;
      const { data: order, error: orderErr } = await supabase
        .from("nfc_card_orders")
        .insert({
          user_id: userId,
          profile_id: createdProfiles[0].id,
          card_style: style.key,
          quantity: body.quantity,
          full_name: body.fullName,
          email: body.email,
          phone: body.phone || null,
          shipping_address: body.shippingAddress,
          status: "received",
          unit_price_cents: style.priceCents,
          total_cents: totalCents,
          idempotency_key: body.idempotencyKey,
        })
        .select("id, status, total_cents, card_style, quantity, created_at")
        .single();
      if (orderErr) throw orderErr;

      const { error: cardsErr } = await supabase.from("nfc_order_cards").insert(
        createdProfiles.map((p, i) => ({
          order_id: order.id,
          profile_id: p.id,
          card_index: i,
        })),
      );
      if (cardsErr) throw cardsErr;

      res.json({
        ok: true,
        order,
        profiles: createdProfiles.map((p) => ({ slug: p.slug, url: nfcProfileUrl(p.slug) })),
        profile: { slug: createdProfiles[0].slug, url: nfcProfileUrl(createdProfiles[0].slug) },
      });
    } catch (err) {
      // Best-effort rollback of profiles created before the failure.
      if (createdProfiles.length > 0) {
        await supabase.from("nfc_profiles").delete().in(
          "id",
          createdProfiles.map((p) => p.id),
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("[nfc-cards] order failed", err);
    res.status(500).json({ ok: false, error: "Order failed" });
  }
});

/* GET /api/nfc-cards/profile/:slug — public digital card (tap destination). */
router.get("/nfc-cards/profile/:slug", async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .from("nfc_profiles")
    .select("slug, display_name, title, bio, avatar_url, links, theme, tap_count, is_active")
    .eq("slug", param(req, "slug"))
    .maybeSingle();
  if (error || !profile || !profile.is_active) {
    res.status(404).json({ ok: false, error: "Card not found" });
    return;
  }
  // Best-effort tap count (analytics only — not money).
  supabase
    .from("nfc_profiles")
    .update({ tap_count: (profile.tap_count ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("slug", param(req, "slug"))
    .then(() => undefined, () => undefined);
  res.json({ ok: true, profile });
});

/* PUT /api/nfc-cards/profile/:slug — owner edits their digital card. */
router.put("/nfc-cards/profile/:slug", requireAuth, async (req: Request, res: Response) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid profile update" });
    return;
  }
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("nfc_profiles")
    .select("id, user_id")
    .eq("slug", param(req, "slug"))
    .maybeSingle();
  if (!existing || existing.user_id !== req.userId) {
    res.status(404).json({ ok: false, error: "Card not found" });
    return;
  }
  const { data, error } = await supabase
    .from("nfc_profiles")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .select("slug, display_name, title, bio, avatar_url, links, theme, tap_count")
    .single();
  if (error) {
    res.status(500).json({ ok: false, error: "Update failed" });
    return;
  }
  res.json({ ok: true, profile: data });
});

/* GET /api/nfc-cards/my-profiles — buyer's cards. */
router.get("/nfc-cards/my-profiles", requireAuth, async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("nfc_profiles")
    .select("slug, display_name, title, tap_count, is_active, created_at")
    .eq("user_id", req.userId!)
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ ok: false, error: "Failed to load cards" });
    return;
  }
  res.json({
    ok: true,
    profiles: (data ?? []).map((p) => ({ ...p, url: nfcProfileUrl(p.slug) })),
  });
});

/* GET /api/nfc-cards/qr/:slug.svg — print-ready vector QR of the tap URL. */
router.get("/nfc-cards/qr/:slug.svg", async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("nfc_profiles")
    .select("id")
    .eq("slug", param(req, "slug"))
    .eq("is_active", true)
    .maybeSingle();
  if (!data) {
    res.status(404).json({ ok: false, error: "Card not found" });
    return;
  }
  try {
    const svg = generateNfcQrSvg(param(req, "slug"));
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(svg);
  } catch (err) {
    console.error("[nfc-cards] QR failed", err);
    res.status(500).json({ ok: false, error: "QR generation failed" });
  }
});

/* GET /api/nfc-cards/orders — buyer's own orders. */
router.get("/nfc-cards/orders", requireAuth, async (req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("nfc_card_orders")
    .select("id, card_style, quantity, status, total_cents, created_at, nfc_profiles(slug)")
    .eq("user_id", req.userId!)
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ ok: false, error: "Failed to load orders" });
    return;
  }
  res.json({ ok: true, orders: data ?? [] });
});

/* ── Admin ── */

/* GET /api/nfc-cards/admin/orders — all orders + profile slugs. */
router.get("/nfc-cards/admin/orders", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("nfc_card_orders")
    .select("id, user_id, card_style, quantity, full_name, email, phone, shipping_address, status, unit_price_cents, total_cents, created_at, nfc_profiles(slug)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    res.status(500).json({ ok: false, error: "Failed to load orders" });
    return;
  }
  res.json({ ok: true, orders: data ?? [] });
});

/* GET /api/nfc-cards/admin/orders.csv — supplier data file (one row per card). */
router.get("/nfc-cards/admin/orders.csv", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("nfc_order_cards")
    .select("card_index, nfc_card_orders!inner(id, card_style, full_name, email, phone, shipping_address, status, created_at), nfc_profiles!inner(slug)")
    .eq("nfc_card_orders.status", "received")
    .order("created_at", { ascending: true, referencedTable: "nfc_card_orders" })
    .limit(5000);
  if (error) {
    res.status(500).json({ ok: false, error: "Failed to export orders" });
    return;
  }
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = (data ?? []).map((c: Record<string, unknown>) => {
    const o = (c.nfc_card_orders ?? {}) as Record<string, unknown>;
    const addr = (o.shipping_address ?? {}) as Record<string, string>;
    const slug = ((c.nfc_profiles ?? {}) as { slug?: string }).slug ?? "";
    return [
      o.id, `${o.id}-card-${(c.card_index as number) + 1}`,
      o.card_style, o.full_name, o.email, o.phone,
      addr.street, addr.city, addr.state, addr.zip, addr.country,
      slug ? nfcProfileUrl(slug) : "",
      slug ? `${nfcProfileUrl(slug).replace(/\/c\//, "/api/nfc-cards/qr/")}.svg` : "",
      o.status, o.created_at,
    ].map(esc).join(",");
  });
  const header = "order_id,card_id,card_style,full_name,email,phone,street,city,state,zip,country,nfc_url,qr_svg_url,status,created_at";
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=nfc-card-orders.csv");
  res.send([header, ...rows].join("\n"));
});

export default router;
