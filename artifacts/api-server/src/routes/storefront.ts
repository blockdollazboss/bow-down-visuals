/**
 * storefront.ts — Sell Everything storefront API (migration 0099).
 *
 * One unified store per creator profile: downloads, merch, digital goods,
 * services/bookings, and event tickets — sold from the public /artist/:slug
 * page via <StorefrontSection />. Worker 5 owns digital_sales (music
 * downloads); this is the SEPARATE "sell everything" catalog. Worker 9 owns
 * events — ticket purchases create event_rsvps. Worker 12 owns final fee
 * economics — the fee constant lives in ONE shared place (see below).
 *
 * Money rules (standing):
 *  - SALES = real money via Stripe. Visual Bucs = AI credits. Never mixed.
 *  - Platform fee comes out of the SELLER's cut — the buyer pays the listed
 *    price, nothing extra. Fee math is shown honestly on every order.
 *  - Creator payouts need Stripe Connect — NOT built here. creator_amount_cents
 *    is tracked as a pending-payout balance, labeled honestly in the UI.
 *  - Merch boundary: physical fulfillment lives in the existing merch system
 *    (merch_designs + print/dropship). A kind='merch' order is HANDED OFF —
 *    this module never rebuilds fulfillment.
 *
 * Endpoints:
 *   GET    /storefront/products?slug=|profileId=   public: active products + link graph
 *   GET    /storefront/product/:id                 public: detail + link graph
 *   POST   /storefront/products                    auth: create (own profile)
 *   PATCH  /storefront/products/:id               auth: update incl. inventory (own profile)
 *   DELETE /storefront/products/:id               auth: soft-deactivate (own profile)
 *   POST   /storefront/checkout                   auth: Stripe session (discount validated server-side)
 *   POST   /storefront/verify                     auth: confirm payment, record order idempotently
 *   GET    /storefront/discounts                   auth: seller's codes
 *   POST   /storefront/discounts                  auth: create code
 *   PATCH  /storefront/discounts/:id              auth: toggle/expire
 *   DELETE /storefront/discounts/:id              auth: delete
 *   GET    /storefront/discounts/validate          public: code → percent_off (no increment)
 *   GET    /storefront/orders/sales               auth: seller orders + honest money math
 *   GET    /storefront/orders/purchases            auth: buyer order history
 *   POST   /storefront/orders/:id/log-to-tracker  auth: push a sale into the Money Tracker (idempotent)
 *   POST   /storefront/orders/:id/service-confirm auth: confirm/decline a service booking
 *   GET    /storefront/deliver/:token             public: token-gated instant delivery (digital)
 *   GET    /storefront/promote/email              auth: email-list broadcast hook (links, not rebuilds)
 *   GET    /storefront/money-checklist            auth: earnings + money checklist + next-move nudge
 *
 * MOUNT (coordinator): this file exports a Router. Add to routes/index.ts:
 *   import storefrontRouter from "./storefront";
 *   router.use(storefrontRouter);
 * (Worker 11 was told not to touch routes/index.ts — 9 workers share it.)
 *
 * Queries use raw SQL via db.execute(sql``) — pg-mem (vitest) cannot handle
 * the drizzle query builder's rowMode:'array'. (Same convention as
 * store.ts and generate/storefronts.ts.)
 */
import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { createHmac, randomBytes } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
/* Worker 12 (PLATFORM TIERS + FEE ECONOMICS) owns the money math — this is
   the ONE shared fee location. Base fee 10% (env PLATFORM_FEE_BPS); the
   per-tier rates in that module are PROPOSED and pending user approval, so
   the storefront uses the canonical base rate only. */
import { PLATFORM_FEE_BPS, feeSplit, formatUsd } from "../lib/platform-fees";

/* Product kinds — canonical list also lives in lib/db/src/schema/storefront.ts
   (STORE_PRODUCT_KINDS). Defined locally here because lib/db's built dist is
   currently stale (other workers' uncommitted TS errors block `tsc --build`);
   restore the @workspace/db import once the dist rebuilds. */
const STORE_PRODUCT_KINDS = ["download", "merch", "digital", "service", "ticket"] as const;

/* ── Platform economics ────────────────────────────────────────────────
   Worker 12's platform-fees.ts is the single source of truth (imported
   above). Worker 12 owns the final economics. */
export { PLATFORM_FEE_BPS };
export const PLATFORM_FEE_PCT = PLATFORM_FEE_BPS / 100;

/* ── Token rules (digital instant delivery — same concept as store.ts) ── */
const DELIVERY_TTL_HOURS = 48;
const DELIVERY_MAX_USES = 5;

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ProductKindSchema = z.enum(STORE_PRODUCT_KINDS);

function getStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

function getTokenSecret(): string {
  const s =
    process.env["STORE_DOWNLOAD_SECRET"] ||
    process.env["STRIPE_WEBHOOK_SECRET"] ||
    process.env["STRIPE_SECRET_KEY"];
  if (!s) throw new Error("No download-token secret configured");
  return s;
}

function getBaseUrl(req?: import("express").Request): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["host"];
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost";
}

function money(cents: number): string {
  return formatUsd(cents);
}

/** Honest money math: discount first, then fee out of the SELLER's cut.
 *  Delegates to Worker 12's canonical feeSplit (gross − fee = net). */
function splitTotals(amountCents: number): { feeCents: number; creatorCents: number } {
  const s = feeSplit(amountCents, PLATFORM_FEE_BPS);
  return { feeCents: s.fee, creatorCents: s.net };
}

function mintToken(): string {
  const raw = randomBytes(32).toString("hex");
  const sig = createHmac("sha256", getTokenSecret()).update(raw).digest("hex");
  return `${raw}.${sig}`;
}

function verifyTokenSignature(token: string): boolean {
  const [raw, sig] = token.split(".");
  if (!raw || !sig || raw.length !== 64 || sig.length !== 64) return false;
  const expected = createHmac("sha256", getTokenSecret()).update(raw).digest("hex");
  return sig.length === expected.length && sig === expected;
}

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ── Ownership helper: caller's creator profile ─────────────────────── */
async function callerProfile(userId: string): Promise<{ id: string; slug: string } | null> {
  const r = await db.execute(sql`
    SELECT id, slug FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? { id: String(row["id"]), slug: String(row["slug"]) } : null;
}

/* ── Link graph: every product response carries its web of links ─────── */
interface ProductRow extends Record<string, unknown> {
  id: string; profile_id: string; kind: string; title: string;
  description: string; price_cents: number; compare_at_cents: number | null;
  inventory: number; media_urls: string[]; service_details: Record<string, unknown> | null;
  event_id: string | null; related_links: Array<{ label: string; url: string }>;
  is_active: boolean; created_at: string;
  artist_name: string; artist_slug: string;
  event_title: string | null;
}

function withLinks(p: ProductRow) {
  const artistUrl = `/artist/${p.artist_slug}`;
  const productUrl = `/artist/${p.artist_slug}#product-${p.id}`;
  return {
    id: p.id,
    profileId: p.profile_id,
    kind: p.kind,
    title: p.title,
    description: p.description,
    priceCents: Number(p.price_cents),
    price: money(Number(p.price_cents)),
    compareAtCents: p.compare_at_cents == null ? null : Number(p.compare_at_cents),
    inventory: Number(p.inventory),
    soldOut: Number(p.inventory) === 0,
    unlimited: Number(p.inventory) === -1,
    mediaUrls: p.media_urls ?? [],
    serviceDetails: p.service_details,
    eventId: p.event_id,
    relatedLinks: p.related_links ?? [],
    isActive: p.is_active,
    createdAt: p.created_at,
    /* Link graph — the store is woven into the profile, not bolted on. */
    links: {
      creatorUrl: artistUrl,
      creatorName: p.artist_name,
      productUrl,
      eventUrl: p.event_id ? `/shows#event-${p.event_id}` : null,
      eventTitle: p.event_title,
    },
  };
}

async function fetchProduct(id: string, onlyActive: boolean): Promise<ProductRow | null> {
  const r = await db.execute(sql`
    SELECT sp.*, cp.display_name AS artist_name, cp.slug AS artist_slug,
           e.title AS event_title
    FROM store_products sp
    JOIN creator_profiles cp ON cp.id = sp.profile_id
    LEFT JOIN events e ON e.id = sp.event_id
    WHERE sp.id = ${id} ${onlyActive ? sql`AND sp.is_active = true` : sql``}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as ProductRow | undefined) ?? null;
}

async function resolveProfile(slug?: string, profileId?: string): Promise<{ id: string; slug: string; displayName: string } | null> {
  let r;
  if (profileId && UUID_RE.test(profileId)) {
    r = await db.execute(sql`SELECT id, slug, display_name FROM creator_profiles WHERE id = ${profileId} LIMIT 1`);
  } else if (slug) {
    r = await db.execute(sql`SELECT id, slug, display_name FROM creator_profiles WHERE slug = ${slug} LIMIT 1`);
  } else {
    return null;
  }
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? { id: String(row["id"]), slug: String(row["slug"]), displayName: String(row["display_name"]) } : null;
}

/* ── Discount validation (server-side, at session creation AND verify) ─ */
interface DiscountRow { id: string; code: string; percent_off: number; max_uses: number; used_count: number; expires_at: string | null; is_active: boolean; }

async function findDiscount(profileId: string, code: string): Promise<DiscountRow | null> {
  const r = await db.execute(sql`
    SELECT id, code, percent_off, max_uses, used_count, expires_at, is_active
    FROM discount_codes
    WHERE profile_id = ${profileId} AND UPPER(code) = ${code.trim().toUpperCase()}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as DiscountRow | undefined) ?? null;
}

function discountUsable(d: DiscountRow): { ok: boolean; reason?: string } {
  if (!d.is_active) return { ok: false, reason: "This code is no longer active." };
  if (d.expires_at && new Date(d.expires_at).getTime() < Date.now()) return { ok: false, reason: "This code has expired." };
  if (d.max_uses !== -1 && d.used_count >= d.max_uses) return { ok: false, reason: "This code has hit its usage limit." };
  return { ok: true };
}

/* ═════════════════════════ PUBLIC: product listing ═══════════════════ */
router.get("/storefront/products", publicApiLimiter, async (req, res) => {
  try {
    const profile = await resolveProfile(
      req.query.slug ? String(req.query.slug) : undefined,
      req.query.profileId ? String(req.query.profileId) : undefined,
    );
    if (!profile) {
      res.status(404).json({ error: "Creator not found." });
      return;
    }
    const r = await db.execute(sql`
      SELECT sp.*, cp.display_name AS artist_name, cp.slug AS artist_slug,
             e.title AS event_title
      FROM store_products sp
      JOIN creator_profiles cp ON cp.id = sp.profile_id
      LEFT JOIN events e ON e.id = sp.event_id
      WHERE sp.profile_id = ${profile.id} AND sp.is_active = true
      ORDER BY sp.created_at DESC
      LIMIT 200
    `);
    res.json({
      profile: { id: profile.id, slug: profile.slug, displayName: profile.displayName },
      products: (r.rows as unknown as ProductRow[]).map(withLinks),
      feeNote: `Real-money purchases via Stripe. Bow Down Visuals takes ${PLATFORM_FEE_PCT}% from the creator's cut — you pay the listed price, nothing extra. This is not Visual Bucs (AI credits).`,
    });
  } catch (err) {
    logger.error({ err }, "[storefront] product listing failed");
    res.status(500).json({ error: "Could not load the store." });
  }
});

/* ═════════════════════════ PUBLIC: product detail ════════════════════ */
router.get("/storefront/product/:id", publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  try {
    const p = await fetchProduct(id, true);
    if (!p) {
      res.status(404).json({ error: "Product not found or no longer for sale." });
      return;
    }
    const { feeCents, creatorCents } = splitTotals(Number(p.price_cents));
    res.json({
      product: withLinks(p),
      feeSplit: {
        priceCents: Number(p.price_cents), price: money(Number(p.price_cents)),
        platformFeeCents: feeCents, platformFee: money(feeCents),
        platformFeePct: PLATFORM_FEE_PCT,
        creatorCents, creatorAmount: money(creatorCents),
      },
      note: "Real-money purchase via Stripe. This is not Visual Bucs (AI credits).",
    });
  } catch (err) {
    logger.error({ err, id }, "[storefront] product detail failed");
    res.status(500).json({ error: "Could not load this product." });
  }
});

/* ═════════════════════════ SELLER: product CRUD ═══════════════════════ */
const RelatedLinkSchema = z.object({
  label: z.string().min(1).max(80),
  url: z.string().min(1).max(2048),
});
const ServiceDetailsSchema = z.object({
  duration_min: z.number().int().positive().max(1440).optional(),
  location: z.string().max(300).optional(),
  /* STUB: external booking-calendar link. Real two-way calendar sync is a later build. */
  booking_calendar_link: z.string().url().max(2048).optional(),
  notes: z.string().max(2000).optional(),
}).optional().nullable();

const CreateProductSchema = z.object({
  kind: ProductKindSchema,
  title: z.string().trim().min(1, "A title is required.").max(160),
  description: z.string().max(5000).default(""),
  priceCents: z.number().int().positive().max(10_000_00 * 100),
  compareAtCents: z.number().int().positive().nullable().optional(),
  /* -1 = unlimited/digital, 0 = sold out. */
  inventory: z.number().int().min(-1).default(-1),
  mediaUrls: z.array(z.string().url().max(2048)).max(20).default([]),
  serviceDetails: ServiceDetailsSchema,
  eventId: z.string().regex(UUID_RE).nullable().optional(),
  relatedLinks: z.array(RelatedLinkSchema).max(10).default([]),
  isActive: z.boolean().default(true),
}).refine((d) => d.kind !== "ticket" || !!d.eventId, {
  message: "Ticket products need an event (eventId).",
  path: ["eventId"],
}).refine((d) => d.kind !== "service" || !!d.serviceDetails, {
  message: "Service products need service details (duration, location, booking link).",
  path: ["serviceDetails"],
});

router.post("/storefront/products", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CreateProductSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid product.", details: parsed.error.issues });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You need a creator profile before you can sell." });
      return;
    }
    const d = parsed.data;
    const r = await db.execute(sql`
      INSERT INTO store_products
        (profile_id, kind, title, description, price_cents, compare_at_cents,
         inventory, media_urls, service_details, event_id, related_links, is_active)
      VALUES (${profile.id}, ${d.kind}, ${d.title}, ${d.description}, ${d.priceCents},
              ${d.compareAtCents ?? null}, ${d.inventory}, ${JSON.stringify(d.mediaUrls)}::jsonb,
              ${d.serviceDetails ? JSON.stringify(d.serviceDetails) : null}::jsonb,
              ${d.eventId ?? null}, ${JSON.stringify(d.relatedLinks)}::jsonb, ${d.isActive})
      RETURNING id
    `);
    const id = String((r.rows[0] as Record<string, unknown>)["id"]);
    const p = await fetchProduct(id, false);
    logger.info({ userId: req.userId, productId: id, kind: d.kind }, "[storefront] product created");
    res.status(201).json({ product: p ? withLinks(p) : { id } });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[storefront] product create failed");
    res.status(500).json({ error: "Could not create this product." });
  }
});

const UpdateProductSchema = CreateProductSchema.partial();

router.patch("/storefront/products/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  const parsed = UpdateProductSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update.", details: parsed.error.issues });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const d = parsed.data;
    const sets: ReturnType<typeof sql>[] = [];
    if (d.title !== undefined) sets.push(sql`title = ${d.title}`);
    if (d.description !== undefined) sets.push(sql`description = ${d.description}`);
    if (d.priceCents !== undefined) sets.push(sql`price_cents = ${d.priceCents}`);
    if (d.compareAtCents !== undefined) sets.push(sql`compare_at_cents = ${d.compareAtCents}`);
    if (d.inventory !== undefined) sets.push(sql`inventory = ${d.inventory}`);
    if (d.mediaUrls !== undefined) sets.push(sql`media_urls = ${JSON.stringify(d.mediaUrls)}::jsonb`);
    if (d.serviceDetails !== undefined)
      sets.push(sql`service_details = ${d.serviceDetails ? JSON.stringify(d.serviceDetails) : null}::jsonb`);
    if (d.eventId !== undefined) sets.push(sql`event_id = ${d.eventId}`);
    if (d.relatedLinks !== undefined) sets.push(sql`related_links = ${JSON.stringify(d.relatedLinks)}::jsonb`);
    if (d.isActive !== undefined) sets.push(sql`is_active = ${d.isActive}`);
    if (sets.length === 0) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    const r = await db.execute(sql`
      UPDATE store_products
      SET ${sql.join(sets, sql`, `)}, updated_at = now()
      WHERE id = ${id} AND profile_id = ${profile.id}
      RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const p = await fetchProduct(id, false);
    res.json({ product: p ? withLinks(p) : { id } });
  } catch (err) {
    logger.error({ err, id }, "[storefront] product update failed");
    res.status(500).json({ error: "Could not update this product." });
  }
});
/* ═══════════════════ SELLER: soft-deactivate product ═════════════════ */
router.delete("/storefront/products/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    /* Soft delete — order history keeps pointing at the product row. */
    const r = await db.execute(sql`
      UPDATE store_products
      SET is_active = false, updated_at = now()
      WHERE id = ${id} AND profile_id = ${profile.id}
      RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    logger.info({ userId: req.userId, productId: id }, "[storefront] product deactivated");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "[storefront] product delete failed");
    res.status(500).json({ error: "Could not remove this product." });
  }
});

/* ═════════════════════════ CHECKOUT (Stripe) ═════════════════════════
   Discount codes are validated SERVER-SIDE here — the client can suggest a
   code, but the price the buyer pays is computed on this box. */
const CheckoutSchema = z.object({
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  quantity: z.number().int().min(1).max(99).default(1),
  discountCode: z.string().trim().min(1).max(40).optional(),
});

router.post("/storefront/checkout", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CheckoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.issues });
    return;
  }
  const { productId, quantity } = parsed.data;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(500).json({ error: "Payments are not configured yet." });
    return;
  }

  try {
    const p = await fetchProduct(productId, true);
    if (!p) {
      res.status(404).json({ error: "NOT_FOR_SALE", message: "This product isn't for sale right now." });
      return;
    }
    const inventory = Number(p.inventory);
    if (inventory === 0) {
      res.status(400).json({ error: "SOLD_OUT", message: "This one just sold out — the creator's restocking." });
      return;
    }
    if (inventory > 0 && quantity > inventory) {
      res.status(400).json({ error: "INSUFFICIENT_INVENTORY", message: `Only ${inventory} left.` });
      return;
    }

    /* Server-side discount validation. */
    let unitCents = Number(p.price_cents);
    let discountCode: string | null = null;
    let percentOff = 0;
    if (parsed.data.discountCode) {
      const d = await findDiscount(p.profile_id, parsed.data.discountCode);
      if (!d) {
        res.status(400).json({ error: "BAD_CODE", message: "That discount code doesn't exist for this creator." });
        return;
      }
      const usable = discountUsable(d);
      if (!usable.ok) {
        res.status(400).json({ error: "BAD_CODE", message: usable.reason });
        return;
      }
      discountCode = d.code;
      percentOff = Number(d.percent_off);
      unitCents = Math.round((unitCents * (100 - percentOff)) / 100);
    }

    const lineTotal = unitCents * quantity;
    const { feeCents, creatorCents } = splitTotals(lineTotal);
    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitCents,
            product_data: {
              name: `${p.title} — ${p.artist_name}`,
              description:
                percentOff > 0
                  ? `${p.kind} · ${percentOff}% off with code ${discountCode}`
                  : `${p.kind} · Bow Down Visuals`,
              images: (p.media_urls ?? []).slice(0, 1),
            },
          },
          quantity,
        },
      ],
      /* Same success page as the digital store; it falls back to
         /api/storefront/verify for storefront sessions (see MOUNT.md). */
      success_url: `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/artist/${p.artist_slug}#product-${p.id}`,
      metadata: {
        type: "storefront_purchase",
        buyer_user_id: req.userId!,
        profile_id: p.profile_id,
        product_id: p.id,
        product_kind: p.kind,
        quantity: String(quantity),
        discount_code: discountCode ?? "",
        amount_cents: String(lineTotal),
        platform_fee_cents: String(feeCents),
        creator_amount_cents: String(creatorCents),
        event_id: p.event_id ?? "",
      },
    });

    logger.info(
      { userId: req.userId, productId, quantity, lineTotal, sessionId: session.id, discountCode },
      "[storefront] checkout session created"
    );
    res.json({
      url: session.url,
      sessionId: session.id,
      totals: {
        unitCents, quantity, lineTotal, lineTotalDisplay: money(lineTotal),
        percentOff, discountCode,
        platformFeeCents: feeCents, creatorCents,
      },
    });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, productId }, "[storefront] checkout failed");
    res.status(500).json({ error: `Could not start checkout: ${msg}` });
  }
});

/* ═════════════════════════ VERIFY (record order) ═════════════════════
   Idempotent: stripe_session_id is UNIQUE — Stripe may redirect/verify
   twice and the second attempt is a harmless no-op. */
const VerifySchema = z.object({ sessionId: z.string().min(1).max(200) });

async function mintDeliveryToken(orderId: string, fileUrl: string) {
  const token = mintToken();
  const expiresAt = new Date(Date.now() + DELIVERY_TTL_HOURS * 3600 * 1000);
  await db.execute(sql`
    INSERT INTO store_delivery_tokens (token, order_id, file_url, expires_at, used_count)
    VALUES (${token}, ${orderId}, ${fileUrl}, ${expiresAt.toISOString()}, 0)
  `);
  return { token, expiresAt };
}

router.post("/storefront/verify", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const { sessionId } = parsed.data;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(500).json({ error: "Payments are not configured yet." });
    return;
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    res.status(400).json({ error: "Could not retrieve this checkout session." });
    return;
  }
  if (session.payment_status !== "paid") {
    res.status(400).json({ error: "Payment has not been completed." });
    return;
  }
  const meta = session.metadata ?? {};
  if (meta["type"] !== "storefront_purchase") {
    res.status(400).json({ error: "This session isn't a storefront purchase." });
    return;
  }
  if (meta["buyer_user_id"] !== req.userId) {
    logger.error({ sessionId, reqUserId: req.userId }, "[storefront] verify: buyer mismatch");
    res.status(403).json({ error: "This purchase doesn't belong to you." });
    return;
  }

  const productId = meta["product_id"] ?? "";
  const profileId = meta["profile_id"] ?? "";
  const kind = meta["product_kind"] ?? "digital";
  const quantity = Math.max(1, parseInt(meta["quantity"] ?? "1", 10) || 1);
  const discountCode = meta["discount_code"] || null;
  const eventId = meta["event_id"] || null;
  if (!productId || !profileId) {
    res.status(400).json({ error: "This session is missing its purchase details." });
    return;
  }
  const amountCents = session.amount_total ?? Number(meta["amount_cents"] ?? 0);
  const { feeCents, creatorCents } = splitTotals(amountCents);

  try {
    /* Duplicate verify: return the existing order, no new side effects. */
    const existing = await db.execute(sql`
      SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
             platform_fee_cents, creator_amount_cents, fulfillment_note, created_at
      FROM store_orders WHERE stripe_session_id = ${sessionId} LIMIT 1
    `);
    let orderId: string;
    let duplicate = false;
    let fulfillmentNote: string | null = null;
    if (existing.rows.length > 0) {
      const er = existing.rows[0] as Record<string, unknown>;
      orderId = String(er["id"]);
      fulfillmentNote = (er["fulfillment_note"] as string | null) ?? null;
      duplicate = true;
      logger.info({ sessionId, orderId }, "[storefront] verify: duplicate ignored");
    } else {
      const p = await fetchProduct(productId, false);
      const productTitle = p?.title ?? "Store product";

      /* Claim inventory atomically (unlimited = -1 skips the claim). */
      if (p && Number(p.inventory) >= 0) {
        const claimed = await db.execute(sql`
          UPDATE store_products
          SET inventory = inventory - ${quantity}, updated_at = now()
          WHERE id = ${productId} AND inventory >= ${quantity}
          RETURNING id
        `);
        if (claimed.rows.length === 0) {
          logger.error({ sessionId, productId }, "[storefront] verify: inventory claim failed after payment");
          res.status(409).json({
            error: "SOLD_OUT_AFTER_PAYMENT",
            message: "Payment went through but the item just sold out — contact the creator for a refund or restock.",
          });
          return;
        }
      }

      const inserted = await db.execute(sql`
        INSERT INTO store_orders
          (buyer_user_id, profile_id, product_id, product_title, product_kind,
           quantity, amount_cents, discount_code, platform_fee_cents,
           creator_amount_cents, stripe_session_id, status, fulfillment_note)
        VALUES (${req.userId!}, ${profileId}, ${productId}, ${productTitle}, ${kind},
                ${quantity}, ${amountCents}, ${discountCode}, ${feeCents},
                ${creatorCents}, ${sessionId}, 'completed', NULL)
        ON CONFLICT (stripe_session_id) DO NOTHING
        RETURNING id
      `);
      if (inserted.rows.length > 0) {
        orderId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
      } else {
        const retry = await db.execute(sql`
          SELECT id FROM store_orders WHERE stripe_session_id = ${sessionId} LIMIT 1
        `);
        if (retry.rows.length === 0) {
          res.status(500).json({ error: "Payment confirmed but the order couldn't be recorded. Contact support." });
          return;
        }
        orderId = String((retry.rows[0] as Record<string, unknown>)["id"]);
        duplicate = true;
      }

      if (!duplicate) {
        /* Discount usage accounting — exactly-once with the order insert. */
        if (discountCode) {
          await db.execute(sql`
            UPDATE discount_codes
            SET used_count = used_count + 1
            WHERE profile_id = ${profileId}
              AND UPPER(code) = ${discountCode.toUpperCase()}
              AND (max_uses = -1 OR used_count < max_uses)
          `);
        }

        /* Kind-specific fulfillment. */
        if (kind === "ticket" && eventId) {
          /* Worker 9 owns events — buying a ticket = an RSVP. */
          const rsvp = await db.execute(sql`
            INSERT INTO event_rsvps (event_id, user_id)
            VALUES (${eventId}, ${req.userId!})
            ON CONFLICT DO NOTHING
            RETURNING event_id
          `);
          if (rsvp.rows.length > 0) {
            await db.execute(sql`UPDATE events SET rsvp_count = rsvp_count + 1 WHERE id = ${eventId}`);
          }
          fulfillmentNote = "Ticket secured — you're on the list. Show this order at the door (or follow the event link).";
        } else if (kind === "service") {
          fulfillmentNote = "Booking request received — the creator confirms your slot from their dashboard.";
          /* Notify the creator through the exactly-once job-notifications
             relay (UNIQUE(job_type, job_id) = order id → never double-pings). */
          const creatorUser = await db.execute(sql`
            SELECT user_id FROM creator_profiles WHERE id = ${profileId} LIMIT 1
          `);
          const crow = creatorUser.rows[0] as Record<string, unknown> | undefined;
          if (crow?.["user_id"]) {
            await db.execute(sql`
              INSERT INTO job_notifications (job_type, job_id, user_id, status, title, message)
              VALUES ('storefront_service_booking', ${orderId}, ${String(crow["user_id"])},
                      'completed', ${`New booking: ${productTitle}`},
                      ${`Someone just booked "${productTitle}" (${money(amountCents)}). Confirm their slot from your store dashboard.`})
              ON CONFLICT DO NOTHING
            `);
          }
        } else if (kind === "merch") {
          /* MERCH BOUNDARY: physical fulfillment lives in the existing merch
             system (merch_designs + print/dropship pipeline). We hand off —
             never rebuild fulfillment here. */
          fulfillmentNote = "Order received — the creator fulfills it through their merch/print pipeline.";
        } else {
          fulfillmentNote = "Digital delivery ready.";
        }

        await db.execute(sql`
          UPDATE store_orders SET fulfillment_note = ${fulfillmentNote} WHERE id = ${orderId}
        `);
        logger.info({ sessionId, orderId, kind, amountCents }, "[storefront] order recorded");
      }
    }

    /* Instant delivery for digital/download kinds — signed-link concept
       (Worker 5's pattern), 48h expiry, 5 uses. */
    let delivery: { url: string; expiresAt: string; maxUses: number } | null = null;
    if (kind === "digital" || kind === "download") {
      const p = await fetchProduct(productId, false);
      const fileUrl = (p?.media_urls ?? [])[0];
      if (fileUrl) {
        const link = await mintDeliveryToken(orderId, fileUrl);
        delivery = {
          url: `/api/storefront/deliver/${link.token}`,
          expiresAt: link.expiresAt.toISOString(),
          maxUses: DELIVERY_MAX_USES,
        };
      }
    }

    const p = await fetchProduct(productId, false);
    res.json({
      success: true,
      duplicate,
      order: {
        id: orderId,
        productKind: kind,
        quantity,
        amountCents, amount: money(amountCents),
        platformFeeCents: feeCents, platformFee: money(feeCents),
        platformFeePct: PLATFORM_FEE_PCT,
        creatorAmountCents: creatorCents, creatorAmount: money(creatorCents),
        discountCode,
        fulfillmentNote,
      },
      delivery,
      /* Link graph: no dead ends after payment — the highest-trust moment. */
      links: {
        productUrl: p ? `/artist/${p.artist_slug}#product-${p.id}` : null,
        creatorUrl: p ? `/artist/${p.artist_slug}` : null,
        eventUrl: eventId ? `/shows#event-${eventId}` : null,
        orderHistoryUrl: "/storefront/purchases",
      },
      note: "Real-money purchase via Stripe. This is not Visual Bucs (AI credits).",
    });
  } catch (err) {
    logger.error({ err, sessionId }, "[storefront] verify failed");
    res.status(500).json({ error: "Payment confirmed but the order couldn't be recorded. Contact support." });
  }
});

/* ═══════════════════ PUBLIC: token-gated delivery ════════════════════ */
function deliveryPageHtml(opts: { ok: boolean; fileUrl?: string; title?: string; usesLeft?: number; expiresAt?: string; message?: string }): string {
  const { ok, fileUrl, title, usesLeft, expiresAt, message } = opts;
  const safe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${ok ? "Your download is ready" : "Link unavailable"} · Bow Down Visuals</title>
${ok && fileUrl ? `<meta http-equiv="refresh" content="1;url=${safe(fileUrl)}"/>` : ""}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #f5ead1; font-family: Georgia, 'Times New Roman', serif;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 520px; width: 100%; text-align: center; border: 1px solid #c9a227; border-radius: 16px;
          padding: 48px 36px; background: linear-gradient(160deg, #111 0%, #1a1408 60%, #0a0a0a 100%);
          box-shadow: 0 0 60px rgba(201,162,39,.18); }
  .crown { font-size: 44px; }
  h1 { color: #e8c547; font-size: 28px; margin: 16px 0 8px; }
  .sub { color: #b9a86a; font-size: 15px; line-height: 1.6; }
  .btn { display: inline-block; margin-top: 28px; padding: 14px 40px; border-radius: 999px;
         background: linear-gradient(180deg, #e8c547, #b8860b); color: #0a0a0a;
         font-weight: bold; font-size: 16px; text-decoration: none; font-family: inherit; }
  .meta { margin-top: 24px; font-size: 13px; color: #8a7a4d; line-height: 1.8; }
  .brand { margin-top: 32px; font-size: 12px; letter-spacing: 3px; color: #6b5c33; text-transform: uppercase; }
</style></head><body><div class="card">
  <div class="crown">${ok ? "👑" : "🔒"}</div>
  <h1>${ok ? "Your download is ready" : "This link can't be used"}</h1>
  <p class="sub">${ok
    ? `“${safe(title ?? "Your content")}” — your download starts automatically. That's the cheat code.`
    : safe(message ?? "This link expired or hit its download limit.")}</p>
  ${ok && fileUrl ? `<a class="btn" href="${safe(fileUrl)}" download>Download now</a>` : ""}
  ${ok ? `<div class="meta">${usesLeft ?? 0} downloads left · link expires ${safe(expiresAt ?? "")}<br/>Lost this file? Re-download anytime from your <b>order history</b> on Bow Down Visuals.</div>` : ""}
  <div class="brand">Bow Down Visuals</div>
</div></body></html>`;
}

router.get("/storefront/deliver/:token", publicApiLimiter, async (req, res) => {
  const token = String(req.params.token ?? "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!verifyTokenSignature(token)) {
    res.status(404).send(deliveryPageHtml({ ok: false, message: "That link doesn't look right. Grab a fresh one from your order history." }));
    return;
  }
  try {
    const updated = await db.execute(sql`
      UPDATE store_delivery_tokens
      SET used_count = used_count + 1
      WHERE token = ${token}
        AND expires_at > now()
        AND used_count < ${DELIVERY_MAX_USES}
      RETURNING file_url, expires_at, used_count, order_id
    `);
    const row = updated.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      res.status(410).send(deliveryPageHtml({
        ok: false,
        message: "This link expired (48 hours) or hit its 5-download limit. Your purchase is safe — mint a fresh link from your order history.",
      }));
      return;
    }
    const sale = await db.execute(sql`
      SELECT product_title FROM store_orders WHERE id = ${String(row["order_id"])} LIMIT 1
    `);
    const srow = sale.rows[0] as Record<string, unknown> | undefined;
    res.status(200).send(deliveryPageHtml({
      ok: true,
      fileUrl: String(row["file_url"]),
      title: srow ? String(srow["product_title"]) : undefined,
      usesLeft: DELIVERY_MAX_USES - Number(row["used_count"]),
      expiresAt: new Date(String(row["expires_at"])).toLocaleString(),
    }));
  } catch (err) {
    logger.error({ err }, "[storefront] delivery failed");
    res.status(500).send(deliveryPageHtml({ ok: false, message: "Something went wrong serving your file. Try again in a moment." }));
  }
});

/* ═══════════════════════ DISCOUNT CODES ══════════════════════════════ */
const CreateDiscountSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only."),
  percentOff: z.number().int().min(1).max(90),
  maxUses: z.number().int().min(-1).default(-1),
  expiresAt: z.string().datetime().nullable().optional(),
});

router.get("/storefront/discounts", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const r = await db.execute(sql`
      SELECT id, code, percent_off, max_uses, used_count, expires_at, is_active, created_at
      FROM discount_codes
      WHERE profile_id = ${profile.id}
      ORDER BY created_at DESC
      LIMIT 200
    `);
    const activeProducts = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM store_products
      WHERE profile_id = ${profile.id} AND is_active = true
    `);
    const codes = r.rows.map((row) => {
      const c = row as Record<string, unknown>;
      return {
        id: String(c["id"]),
        code: String(c["code"]),
        percentOff: Number(c["percent_off"]),
        maxUses: Number(c["max_uses"]),
        usedCount: Number(c["used_count"]),
        expiresAt: c["expires_at"] ? String(c["expires_at"]) : null,
        isActive: Boolean(c["is_active"]),
        createdAt: String(c["created_at"]),
        /* Codes are profile-wide: they apply to every active product. */
        appliesTo: `${Number((activeProducts.rows[0] as Record<string, unknown>)["n"])} active product(s)`,
      };
    });
    res.json({ codes });
  } catch (err) {
    logger.error({ err }, "[storefront] discount list failed");
    res.status(500).json({ error: "Could not load discount codes." });
  }
});

router.post("/storefront/discounts", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CreateDiscountSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid discount code.", details: parsed.error.issues });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const d = parsed.data;
    const r = await db.execute(sql`
      INSERT INTO discount_codes (profile_id, code, percent_off, max_uses, expires_at)
      VALUES (${profile.id}, ${d.code.trim().toUpperCase()}, ${d.percentOff}, ${d.maxUses}, ${d.expiresAt ?? null})
      ON CONFLICT (profile_id, code) DO NOTHING
      RETURNING id, code, percent_off, max_uses, used_count, expires_at, is_active
    `);
    if (r.rows.length === 0) {
      res.status(409).json({ error: "CODE_TAKEN", message: "You already have a code with that name." });
      return;
    }
    const c = r.rows[0] as Record<string, unknown>;
    logger.info({ userId: req.userId, code: c["code"] }, "[storefront] discount code created");
    res.status(201).json({
      code: {
        id: String(c["id"]),
        code: String(c["code"]),
        percentOff: Number(c["percent_off"]),
        maxUses: Number(c["max_uses"]),
        usedCount: Number(c["used_count"]),
        expiresAt: c["expires_at"] ? String(c["expires_at"]) : null,
        isActive: Boolean(c["is_active"]),
      },
    });
  } catch (err) {
    logger.error({ err }, "[storefront] discount create failed");
    res.status(500).json({ error: "Could not create this discount code." });
  }
});

router.patch("/storefront/discounts/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  const parsed = z.object({
    isActive: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    maxUses: z.number().int().min(-1).optional(),
  }).safeParse(req.body ?? {});
  if (!UUID_RE.test(id) || !parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const d = parsed.data;
    const sets: ReturnType<typeof sql>[] = [];
    if (d.isActive !== undefined) sets.push(sql`is_active = ${d.isActive}`);
    if (d.expiresAt !== undefined) sets.push(sql`expires_at = ${d.expiresAt}`);
    if (d.maxUses !== undefined) sets.push(sql`max_uses = ${d.maxUses}`);
    if (sets.length === 0) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    const r = await db.execute(sql`
      UPDATE discount_codes SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND profile_id = ${profile.id}
      RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Discount code not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "[storefront] discount update failed");
    res.status(500).json({ error: "Could not update this discount code." });
  }
});

router.delete("/storefront/discounts/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const r = await db.execute(sql`
      DELETE FROM discount_codes WHERE id = ${id} AND profile_id = ${profile.id} RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Discount code not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "[storefront] discount delete failed");
    res.status(500).json({ error: "Could not delete this discount code." });
  }
});

/* Public validate — answers "is this code good?" without spending a use.
   Uses are only incremented at verify, after real payment. */
router.get("/storefront/discounts/validate", publicApiLimiter, async (req, res) => {
  const code = String(req.query.code ?? "").trim();
  const profileId = String(req.query.profileId ?? "");
  if (!code || !UUID_RE.test(profileId)) {
    res.status(400).json({ error: "code and profileId are required." });
    return;
  }
  try {
    const d = await findDiscount(profileId, code);
    if (!d) {
      res.json({ valid: false, reason: "That code doesn't exist for this creator." });
      return;
    }
    const usable = discountUsable(d);
    if (!usable.ok) {
      res.json({ valid: false, reason: usable.reason });
      return;
    }
    res.json({ valid: true, code: d.code, percentOff: Number(d.percent_off) });
  } catch (err) {
    logger.error({ err }, "[storefront] discount validate failed");
    res.status(500).json({ error: "Could not validate this code." });
  }
});

/* ═══════════════════════ ORDERS (seller + buyer) ═════════════════════ */
function orderShape(r: Record<string, unknown>, artistSlug: string | null) {
  const gross = Number(r["amount_cents"]);
  return {
    id: String(r["id"]),
    productId: r["product_id"] ? String(r["product_id"]) : null,
    productTitle: String(r["product_title"] ?? "Product"),
    productKind: String(r["product_kind"] ?? "digital"),
    quantity: Number(r["quantity"]),
    /* Honest money math on every order: gross − fee = net. */
    grossCents: gross,
    gross: money(gross),
    platformFeeCents: Number(r["platform_fee_cents"]),
    platformFee: money(Number(r["platform_fee_cents"])),
    platformFeePct: PLATFORM_FEE_PCT,
    netCents: Number(r["creator_amount_cents"]),
    net: money(Number(r["creator_amount_cents"])),
    discountCode: (r["discount_code"] as string | null) ?? null,
    status: String(r["status"]),
    fulfillmentNote: (r["fulfillment_note"] as string | null) ?? null,
    createdAt: String(r["created_at"]),
    links: {
      productUrl: r["product_id"] && artistSlug ? `/artist/${artistSlug}#product-${r["product_id"]}` : null,
      creatorUrl: artistSlug ? `/artist/${artistSlug}` : null,
    },
  };
}

router.get("/storefront/orders/sales", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const r = await db.execute(sql`
      SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
             discount_code, platform_fee_cents, creator_amount_cents, status,
             fulfillment_note, created_at
      FROM store_orders
      WHERE profile_id = ${profile.id}
      ORDER BY created_at DESC
      LIMIT 500
    `);
    const orders = r.rows.map((row) => orderShape(row as Record<string, unknown>, profile.slug));
    const totals = orders.reduce(
      (acc, o) => ({
        grossCents: acc.grossCents + o.grossCents,
        feeCents: acc.feeCents + o.platformFeeCents,
        netCents: acc.netCents + o.netCents,
      }),
      { grossCents: 0, feeCents: 0, netCents: 0 }
    );
    res.json({
      orders,
      totals: {
        ...totals,
        gross: money(totals.grossCents),
        fee: money(totals.feeCents),
        net: money(totals.netCents),
        platformFeePct: PLATFORM_FEE_PCT,
      },
      note: "Real-money sales via Stripe. This is not Visual Bucs (AI credits). Payouts need Stripe Connect — your net sits as a pending balance until then.",
    });
  } catch (err) {
    logger.error({ err }, "[storefront] sales list failed");
    res.status(500).json({ error: "Could not load your sales." });
  }
});

router.get("/storefront/orders/purchases", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`
      SELECT so.id, so.product_id, so.product_title, so.product_kind, so.quantity,
             so.amount_cents, so.discount_code, so.platform_fee_cents,
             so.creator_amount_cents, so.status, so.fulfillment_note, so.created_at,
             cp.slug AS artist_slug, cp.display_name AS artist_name
      FROM store_orders so
      JOIN creator_profiles cp ON cp.id = so.profile_id
      WHERE so.buyer_user_id = ${req.userId!}
      ORDER BY so.created_at DESC
      LIMIT 200
    `);
    res.json({
      purchases: r.rows.map((row) => {
        const rr = row as Record<string, unknown>;
        const slug = String(rr["artist_slug"] ?? "");
        return {
          ...orderShape(rr, slug),
          artistName: String(rr["artist_name"] ?? "Creator"),
          artistSlug: slug,
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "[storefront] purchases failed");
    res.status(500).json({ error: "Could not load your purchases." });
  }
});

/* ═══════════ SELLER: log a sale into the Money Tracker ═══════════════ */
router.post("/storefront/orders/:id/log-to-tracker", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid order id." });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const sale = await db.execute(sql`
      SELECT id, product_title, creator_amount_cents
      FROM store_orders
      WHERE id = ${id} AND profile_id = ${profile.id}
      LIMIT 1
    `);
    const srow = sale.rows[0] as Record<string, unknown> | undefined;
    if (!srow) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const marker = `Storefront sale ${id}`;
    const dup = await db.execute(sql`
      SELECT id FROM money_entries
      WHERE user_id = ${req.userId!} AND entry_type = 'income' AND note = ${marker}
      LIMIT 1
    `);
    if (dup.rows.length > 0) {
      res.status(409).json({ error: "ALREADY_LOGGED", message: "This sale is already in your Money Tracker." });
      return;
    }
    const cents = Number(srow["creator_amount_cents"]);
    const title = String(srow["product_title"] ?? "Store product");
    const inserted = await db.execute(sql`
      INSERT INTO money_entries
        (user_id, entry_type, category, amount_cents, note, source, entry_date)
      VALUES (${req.userId!}, 'income', 'store_sales', ${cents},
              ${marker}, ${"Storefront — " + title}, ${todayYmd()})
      RETURNING id, amount_cents, entry_date
    `);
    const erow = inserted.rows[0] as Record<string, unknown>;
    logger.info({ userId: req.userId, orderId: id, cents }, "[storefront] sale logged to money tracker");
    res.status(201).json({
      entry: {
        id: String(erow["id"]),
        amountCents: Number(erow["amount_cents"]),
        amount: money(Number(erow["amount_cents"])),
        date: String(erow["entry_date"]),
      },
      /* Link graph: the dashboard links straight to the tracker entry. */
      moneyTrackerUrl: "/analytics",
    });
  } catch (err) {
    logger.error({ err, id }, "[storefront] log-to-tracker failed");
    res.status(500).json({ error: "Could not log this sale." });
  }
});

/* ═══════════ SELLER: confirm / decline a service booking ═════════════ */
router.post("/storefront/orders/:id/service-confirm", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  const parsed = z.object({
    confirmed: z.boolean(),
    note: z.string().max(500).optional(),
  }).safeParse(req.body ?? {});
  if (!UUID_RE.test(id) || !parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const note = parsed.data.confirmed
      ? `Booking confirmed${parsed.data.note ? ` — ${parsed.data.note}` : "."}`
      : `Booking declined${parsed.data.note ? ` — ${parsed.data.note}` : ". Refund the buyer via Stripe."}`;
    const r = await db.execute(sql`
      UPDATE store_orders
      SET fulfillment_note = ${note},
          status = ${parsed.data.confirmed ? "completed" : "refunded"}
      WHERE id = ${id} AND profile_id = ${profile.id} AND product_kind = 'service'
      RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Service order not found." });
      return;
    }
    res.json({ ok: true, note });
  } catch (err) {
    logger.error({ err, id }, "[storefront] service confirm failed");
    res.status(500).json({ error: "Could not update this booking." });
  }
});

/* ═══════════ SELLER: email-list broadcast hook ═══════════════════════
   LINKS the existing email-list system — doesn't rebuild it. Returns the
   seller's lists plus a ready-to-send campaign draft; the dashboard POSTs
   the draft to the existing /api/email-list/lists/:id/campaigns endpoint. */
router.get("/storefront/promote/email", requireAuth, async (req, res) => {
  const productId = String(req.query.productId ?? "");
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    let product: ProductRow | null = null;
    if (productId && UUID_RE.test(productId)) {
      const p = await fetchProduct(productId, false);
      if (p && p.profile_id === profile.id) product = p;
    }
    const lists = await db.execute(sql`
      SELECT el.id, el.name,
             (SELECT COUNT(*)::int FROM email_subscribers es WHERE es.list_id = el.id) AS subscribers
      FROM email_lists el
      WHERE el.user_id = ${req.userId!}
      ORDER BY el.created_at DESC
      LIMIT 50
    `);
    const productUrl = product
      ? `${getBaseUrl(req)}/artist/${profile.slug}#product-${product.id}`
      : `${getBaseUrl(req)}/artist/${profile.slug}`;
    const prefill = product
      ? {
          subject: `New drop: ${product.title} 👑`,
          body: [
            `Your boy just dropped something new.`,
            ``,
            `${product.title} — ${money(Number(product.price_cents))}`,
            product.description ? product.description.slice(0, 300) : "",
            ``,
            `Cop it here: ${productUrl}`,
            ``,
            `— ${profile.slug}`,
          ].join("\n"),
          draftEndpoint: "/api/email-list/lists/:listId/campaigns",
          method: "POST",
          payloadShape: { subject: "string", body: "string", status: "'draft' | 'queued'" },
        }
      : null;
    res.json({
      lists: lists.rows.map((row) => {
        const l = row as Record<string, unknown>;
        return { id: String(l["id"]), name: String(l["name"]), subscribers: Number(l["subscribers"] ?? 0) };
      }),
      prefill,
    });
  } catch (err) {
    logger.error({ err }, "[storefront] email promote hook failed");
    res.status(500).json({ error: "Could not prepare the email broadcast." });
  }
});

/* ═══════════ SELLER: money checklist (Get Paid finale) ═══════════════
   The seller dashboard IS the Get Paid finale: earnings first, then a money
   checklist, then the single sharpest next-money-move nudge. Viewing
   earnings is NEVER gated — the difficulty ladder only changes how much
   control the commerce UI exposes. */
router.get("/storefront/money-checklist", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const [ordersR, productsR, codesR, unpricedR, unloggedR] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*)::int AS n,
               COALESCE(SUM(amount_cents),0)::int AS gross,
               COALESCE(SUM(platform_fee_cents),0)::int AS fee,
               COALESCE(SUM(creator_amount_cents),0)::int AS net
        FROM store_orders WHERE profile_id = ${profile.id}
      `),
      db.execute(sql`
        SELECT id, title, kind, inventory, is_active
        FROM store_products WHERE profile_id = ${profile.id}
        ORDER BY created_at DESC LIMIT 200
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS n FROM discount_codes
        WHERE profile_id = ${profile.id} AND is_active = true
      `),
      /* Tracks/videos with plays but no price — the classic money leak. */
      db.execute(sql`
        SELECT (SELECT COUNT(*)::int FROM profile_tracks
                 WHERE profile_id = ${profile.id} AND is_published = true
                   AND COALESCE(download_price_cents,0) = 0)
             + (SELECT COUNT(*)::int FROM profile_videos
                 WHERE profile_id = ${profile.id} AND is_published = true
                   AND COALESCE(download_price_cents,0) = 0) AS n
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS n FROM store_orders so
        WHERE so.profile_id = ${profile.id}
          AND NOT EXISTS (
            SELECT 1 FROM money_entries me
            WHERE me.user_id = ${req.userId!}
              AND me.entry_type = 'income'
              AND me.note = ('Storefront sale ' || so.id::text)
          )
      `),
    ]);

    const orow = ordersR.rows[0] as Record<string, unknown>;
    const earnings = {
      orderCount: Number(orow["n"]),
      grossCents: Number(orow["gross"]),
      feeCents: Number(orow["fee"]),
      netCents: Number(orow["net"]),
      gross: money(Number(orow["gross"])),
      fee: money(Number(orow["fee"])),
      net: money(Number(orow["net"])),
      platformFeePct: PLATFORM_FEE_PCT,
      pendingPayoutNote: "Payouts need Stripe Connect (not built yet) — your net sits here as a pending balance. Real dollars, not Visual Bucs.",
    };

    const products = productsR.rows as unknown as Array<{
      id: string; title: string; kind: string; inventory: number; is_active: boolean;
    }>;
    const activeProducts = products.filter((p) => p.is_active);
    const soldOut = products.filter((p) => p.is_active && Number(p.inventory) === 0);
    const codeCount = Number((codesR.rows[0] as Record<string, unknown>)["n"]);
    const unpricedCount = Number((unpricedR.rows[0] as Record<string, unknown>)["n"]);
    const unloggedCount = Number((unloggedR.rows[0] as Record<string, unknown>)["n"]);

    interface ChecklistItem {
      id: string; title: string; detail: string; cta: string; href: string;
      priority: number; done: boolean;
    }
    const checklist: ChecklistItem[] = [
      {
        id: "first-product",
        title: "List your first product",
        detail: "A store with nothing in it can't make you money. One product, one price, one tap.",
        cta: "Add a product", href: "/store/dashboard?tab=products",
        priority: 100, done: products.length > 0,
      },
      {
        id: "activate",
        title: "Activate a product",
        detail: `${products.length - activeProducts.length} product(s) sitting in draft. Flip one live.`,
        cta: "Review products", href: "/store/dashboard?tab=products",
        priority: 90, done: products.length === 0 || activeProducts.length > 0,
      },
      {
        id: "price-content",
        title: "Price your content",
        detail: `${unpricedCount} published track(s)/video(s) with plays and no price — that's money on the floor.`,
        cta: "Price them in one tap", href: "/store/dashboard?tab=products",
        priority: 85, done: unpricedCount === 0,
      },
      {
        id: "restock",
        title: "Restock sold-out items",
        detail: `${soldOut.length} product(s) sold out: ${soldOut.slice(0, 3).map((p) => p.title).join(", ")}. Demand is proven — feed it.`,
        cta: "Restock", href: "/store/dashboard?tab=products",
        priority: 80, done: soldOut.length === 0,
      },
      {
        id: "discount",
        title: "Run a launch discount",
        detail: "A code turns browsers into buyers. 15% off for 72 hours moves units.",
        cta: "Create a code", href: "/store/dashboard?tab=discounts",
        priority: 70, done: codeCount > 0,
      },
      {
        id: "log-tracker",
        title: "Log sales to Money Tracker",
        detail: `${unloggedCount} sale(s) not in your Money Tracker yet. Your books should know what your store knows.`,
        cta: "Log them", href: "/store/dashboard?tab=orders",
        priority: 60, done: unloggedCount === 0,
      },
      {
        id: "promote",
        title: "Promote your best seller",
        detail: "Every product has a Promote button: share link with your referral code, scheduler, social kit, email blast.",
        cta: "Open your store", href: `/artist/${profile.slug}`,
        priority: 50, done: false,
      },
    ];
    const open = checklist.filter((c) => !c.done).sort((a, b) => b.priority - a.priority);
    const nextMove = open[0] ?? null;

    res.json({
      earnings,
      checklist,
      nextMove,
      links: {
        storeUrl: `/artist/${profile.slug}`,
        dashboardUrl: "/store/dashboard",
        ordersUrl: "/store/dashboard?tab=orders",
        trackerNote: "Log sales into the Money Tracker from the Orders tab.",
      },
    });
  } catch (err) {
    logger.error({ err }, "[storefront] money checklist failed");
    res.status(500).json({ error: "Could not load your money checklist." });
  }
});

export default router;
