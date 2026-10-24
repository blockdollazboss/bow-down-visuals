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
 *   PUT    /storefront/products/:id/bump          auth: set/clear the product's order-bump add-on (own profile)
 *   POST   /storefront/checkout                   auth: Stripe session (discount + optional bump validated server-side)
 *   POST   /storefront/verify                     auth: confirm payment, record order idempotently (+ post-purchase upsell offer)
 *   GET    /storefront/orders/:id/upsell           auth: the order's pending post-purchase upsell offer (buyer)
 *   POST   /storefront/orders/:id/upsell/accept    auth: one-click accept — off-session PaymentIntent on the saved card
 *   POST   /storefront/orders/:id/upsell/decline   auth: decline/close the offer — never shown again for that order
 *   POST   /storefront/claim                      auth: claim a $0 lead-magnet product by email (no Stripe)
 *   GET    /storefront/discounts                   auth: seller's codes
 *   POST   /storefront/discounts                  auth: create code
 *   PATCH  /storefront/discounts/:id              auth: toggle/expire
 *   DELETE /storefront/discounts/:id              auth: delete
 *   GET    /storefront/discounts/validate          public: code → percent_off (no increment)
 *   GET    /storefront/orders/sales               auth: seller orders + honest money math
 *   GET    /storefront/orders/purchases            auth: buyer order history
 *   POST   /storefront/orders/:id/delivery-token  auth: buyer re-mints a digital delivery link
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
import { db, EMAIL_FREE_SUBSCRIBER_LIMIT } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
/* Worker 12 (PLATFORM TIERS + FEE ECONOMICS) owns the money math — this is
   the ONE shared fee location. The base fee is a flat 5% (env
   PLATFORM_FEE_BPS; owner ruling 2026-10-23) — the same rate the
   shops/store rails charge, on every tier. */
import { PLATFORM_FEE_BPS, feeSplit, formatUsd } from "../lib/platform-fees";
/* Order bumps (Stack-100 #3, feature #13): one add-on offer per
   product, ticked at checkout, charged in the same Stripe session.
   All bump money math lives in lib/order-bumps.ts. */
import {
  readBumpConfig,
  validateBumpTarget,
  bumpUnitCents,
  splitOrderAmounts,
  MAX_BUMP_PERCENT_OFF,
} from "../lib/order-bumps";
/* Post-purchase upsell (Stack-100 #3, Wave 3): the SAME seller
   attachment as the bump, offered once after the purchase completes
   and charged in one click off the saved payment method through its
   own PaymentIntent. All money/state logic lives in
   lib/post-purchase-upsell.ts. */
import {
  upsellIdempotencyKey,
  buildUpsellSnapshot,
  upsellEligibility,
  upsellAcceptBlocker,
} from "../lib/post-purchase-upsell";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../lib/stripe-client";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";

/* Mirror-on-save (2026-10-13 law): product media is re-hosted into
   permanent storage at save time (kind inferred from the URL extension —
   the helper honors the real content-type); presenters re-sign per read. */
function mediaKindForStoreUrl(url: string): "image" | "video" | "audio" {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch { /* keep raw */ }
  if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return "video";
  if (/\.(mp3|wav|m4a|ogg)$/i.test(path)) return "audio";
  return "image";
}

async function mirrorStoreMediaUrls(urls: string[], ownerKey: string): Promise<string[]> {
  return Promise.all(
    urls.map(async (u) => (await mirrorExternalMediaUrl(u, { kind: mediaKindForStoreUrl(u), ownerKey })) ?? u),
  );
}

async function presentProduct(p: ProductRow, bumpOffer?: BumpOfferPayload | null) {
  const pub = withLinks(p);
  return {
    ...pub,
    /* The live add-on offer (feature #13): resolved, or null when the
       product has no bump a buyer could actually take right now. */
    bump: bumpOffer !== undefined ? bumpOffer : await resolveBumpOffer(p),
    mediaUrls: await Promise.all(pub.mediaUrls.map((u) => refreshSupabaseStorageUrl(u))),
  };
}

/* ── Order bumps (feature #13): offer resolution ──────────────────────
   The buyer-facing offer exists only while EVERY part of it is true:
   an attachment is set, the target is the same seller's product, it is
   active, priced (never a $0 lead magnet) and in stock. Anything less
   and the product simply shows no add-on — a seller's stale setting
   must never break or block the main sale. */
export interface BumpOfferPayload {
  productId: string;
  title: string;
  kind: string;
  listPriceCents: number;
  listPrice: string;
  percentOff: number;
  priceCents: number;
  price: string;
  productUrl: string;
}

function bumpOfferFromRows(p: ProductRow, target: ProductRow | null): BumpOfferPayload | null {
  const cfg = readBumpConfig(p);
  if (!cfg || !target) return null;
  const verdict = validateBumpTarget(
    { id: p.id, profileId: p.profile_id },
    {
      id: target.id,
      profileId: target.profile_id,
      priceCents: Number(target.price_cents),
      isActive: Boolean(target.is_active),
      inventory: Number(target.inventory),
    },
  );
  if (!verdict.ok) return null;
  const unit = bumpUnitCents(Number(target.price_cents), cfg.percentOff);
  return {
    productId: target.id,
    title: target.title,
    kind: target.kind,
    listPriceCents: Number(target.price_cents),
    listPrice: money(Number(target.price_cents)),
    percentOff: cfg.percentOff,
    priceCents: unit,
    price: money(unit),
    productUrl: `/storefront/product/${target.id}`,
  };
}

async function resolveBumpOffer(p: ProductRow): Promise<BumpOfferPayload | null> {
  const cfg = readBumpConfig(p);
  if (!cfg) return null;
  const target = await fetchProduct(cfg.bumpProductId, false);
  return bumpOfferFromRows(p, target);
}

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
  return createGuardedStripeClient();
}

/**
 * Deterministic Stripe idempotency key for a storefront checkout.
 * The intent carries the buyer's completed-order count for this exact
 * purchase (from store_orders, the rail's completion record): a
 * double-submit before the order is recorded still sees the same
 * count, so Stripe reuses the original session; after the order
 * lands, the count advances and a repeat purchase gets a fresh key.
 */
export function buildStorefrontCheckoutKey(args: {
  userId: string;
  productId: string;
  quantity: number;
  unitCents: number;
  lineTotalCents: number;
  discountCode: string | null;
  completedOrderCount: number;
  /** Order bump (feature #13): present only when the buyer ticked the
   *  add-on, so bump-free purchase intents keep their historic keys. */
  bumpProductId?: string | null;
  bumpLineCents?: number;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.userId,
    rail: "storefront",
    purchaseIntent: {
      productId: args.productId,
      quantity: args.quantity,
      unitCents: args.unitCents,
      lineTotalCents: args.lineTotalCents,
      discountCode: args.discountCode,
      completedOrderCount: args.completedOrderCount,
      ...(args.bumpProductId
        ? { bumpProductId: args.bumpProductId, bumpLineCents: args.bumpLineCents ?? 0 }
        : {}),
    },
  });
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
  /* Order-bump attachment (feature #13). Optional: the columns arrive
     with the lane's reported migration; rows without them simply have
     no bump (readBumpConfig treats absent keys as "no offer"). */
  bump_product_id?: string | null;
  bump_percent_off?: number | null;
}

function withLinks(p: ProductRow) {
  const artistUrl = `/artist/${p.artist_slug}`;
  const productUrl = `/storefront/product/${p.id}`;
  return {
    id: p.id,
    profileId: p.profile_id,
    kind: p.kind,
    title: p.title,
    description: p.description,
    priceCents: Number(p.price_cents),
    price: money(Number(p.price_cents)),
    /* $0 = lead magnet (migration 0190): claimed by email, never
       checked out. Every product payload carries the flag so every
       surface renders it FREE instead of $0.00. */
    free: Number(p.price_cents) === 0,
    compareAtCents: p.compare_at_cents == null ? null : Number(p.compare_at_cents),
    inventory: Number(p.inventory),
    soldOut: Number(p.inventory) === 0,
    unlimited: Number(p.inventory) === -1,
    mediaUrls: p.media_urls ?? [],
    serviceDetails: p.service_details,
    /* Order-bump setting (feature #13): the raw attachment, so the
       seller's dashboard can show and edit it even while the add-on
       is inactive or restocking. The buyer-facing resolved offer
       rides as `bump` (added by presentProduct). */
    bumpConfig: readBumpConfig(p),
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
    const rows = r.rows as unknown as ProductRow[];
    /* Bump offers resolve from this same result set (a bump target is
       always the same seller's product); a target outside the window
       just shows no offer here — the product page resolves it fully. */
    const byId = new Map(rows.map((row) => [row.id, row]));
    res.json({
      profile: { id: profile.id, slug: profile.slug, displayName: profile.displayName },
      products: await Promise.all(
        rows.map((row) => {
          const cfg = readBumpConfig(row);
          return presentProduct(row, cfg ? bumpOfferFromRows(row, byId.get(cfg.bumpProductId) ?? null) : null);
        }),
      ),
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
    const isFree = Number(p.price_cents) === 0;
    res.json({
      product: await presentProduct(p),
      free: isFree,
      feeSplit: {
        priceCents: Number(p.price_cents), price: money(Number(p.price_cents)),
        platformFeeCents: feeCents, platformFee: money(feeCents),
        platformFeePct: PLATFORM_FEE_PCT,
        creatorCents, creatorAmount: money(creatorCents),
      },
      note: isFree
        ? "Free product — claim it with your email, no card and no charge. Claiming adds your email to this creator's list; unsubscribe anytime."
        : "Real-money purchase via Stripe. This is not Visual Bucs (AI credits).",
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

const BaseProductSchema = z.object({
  kind: ProductKindSchema,
  title: z.string().trim().min(1, "A title is required.").max(160),
  description: z.string().max(5000).default(""),
  /* 0 is allowed (migration 0190): a $0 product is a lead magnet —
     claimed by email via /storefront/claim, never checked out. */
  priceCents: z.number().int().nonnegative().max(10_000_00 * 100),
  compareAtCents: z.number().int().positive().nullable().optional(),
  /* -1 = unlimited/digital, 0 = sold out. */
  inventory: z.number().int().min(-1).default(-1),
  mediaUrls: z.array(z.string().url().max(2048)).max(20).default([]),
  serviceDetails: ServiceDetailsSchema,
  eventId: z.string().regex(UUID_RE).nullable().optional(),
  relatedLinks: z.array(RelatedLinkSchema).max(10).default([]),
  isActive: z.boolean().default(true),
});

/* Create-time cross-field rules live on the refined schema. The base stays
   refinement-free so .partial() (zod v4 forbids .partial() on refined schemas)
   can derive the PATCH schema — partial updates must not re-require eventId. */
const CreateProductSchema = BaseProductSchema.refine((d) => d.kind !== "ticket" || !!d.eventId, {
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
              ${d.compareAtCents ?? null}, ${d.inventory}, ${JSON.stringify(await mirrorStoreMediaUrls(d.mediaUrls, req.userId!))}::jsonb,
              ${d.serviceDetails ? JSON.stringify(d.serviceDetails) : null}::jsonb,
              ${d.eventId ?? null}, ${JSON.stringify(d.relatedLinks)}::jsonb, ${d.isActive})
      RETURNING id
    `);
    const id = String((r.rows[0] as Record<string, unknown>)["id"]);
    const p = await fetchProduct(id, false);
    logger.info({ userId: req.userId, productId: id, kind: d.kind }, "[storefront] product created");
    res.status(201).json({ product: p ? await presentProduct(p) : { id } });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[storefront] product create failed");
    res.status(500).json({ error: "Could not create this product." });
  }
});

const UpdateProductSchema = BaseProductSchema.partial();

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
    if (d.mediaUrls !== undefined) sets.push(sql`media_urls = ${JSON.stringify(await mirrorStoreMediaUrls(d.mediaUrls, req.userId!))}::jsonb`);
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
    res.json({ product: p ? await presentProduct(p) : { id } });
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

/* ═══════════════ SELLER: order-bump attachment (feature #13) ═════════
   One add-on per product. Attach-time hard rules: the add-on must be
   the seller's OWN product, never the product itself, and never a $0
   lead magnet (free products ride the claim rail, not a paid line).
   Inactive / sold-out add-ons may be attached — the buyer-facing offer
   simply stays hidden until the add-on is live and in stock, and the
   response says whether the offer is live right now. */
const SetBumpSchema = z.object({
  bumpProductId: z.string().regex(UUID_RE, "bumpProductId must be a UUID").nullable(),
  percentOff: z.number().int().min(0).max(MAX_BUMP_PERCENT_OFF).default(0),
});

router.put("/storefront/products/:id/bump", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  const parsed = SetBumpSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bump setting.", details: parsed.error.issues });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const main = await fetchProduct(id, false);
    if (!main || main.profile_id !== profile.id) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const { bumpProductId, percentOff } = parsed.data;
    if (bumpProductId) {
      const target = await fetchProduct(bumpProductId, false);
      if (!target || target.profile_id !== profile.id) {
        res.status(400).json({
          error: "BUMP_NOT_YOURS",
          message: "The add-on has to be one of your own products.",
        });
        return;
      }
      const verdict = validateBumpTarget(
        { id: main.id, profileId: main.profile_id },
        {
          id: target.id,
          profileId: target.profile_id,
          priceCents: Number(target.price_cents),
          isActive: Boolean(target.is_active),
          inventory: Number(target.inventory),
        },
      );
      if (!verdict.ok && verdict.code !== "BUMP_INACTIVE" && verdict.code !== "BUMP_SOLD_OUT") {
        res.status(400).json({ error: verdict.code, message: verdict.reason });
        return;
      }
    }
    const r = await db.execute(sql`
      UPDATE store_products
      SET bump_product_id = ${bumpProductId}, bump_percent_off = ${bumpProductId ? percentOff : 0},
          updated_at = now()
      WHERE id = ${id} AND profile_id = ${profile.id}
      RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const p = await fetchProduct(id, false);
    const offer = p ? await resolveBumpOffer(p) : null;
    logger.info(
      { userId: req.userId, productId: id, bumpProductId, percentOff },
      "[storefront] product bump updated"
    );
    res.json({ product: p ? await presentProduct(p, offer) : { id }, offerLive: offer !== null });
  } catch (err) {
    logger.error({ err, id }, "[storefront] product bump update failed");
    res.status(500).json({ error: "Could not update the add-on offer." });
  }
});

/* ═════════════════════════ CHECKOUT (Stripe) ═════════════════════════
   Discount codes are validated SERVER-SIDE here — the client can suggest a
   code, but the price the buyer pays is computed on this box. */
const CheckoutSchema = z.object({
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  quantity: z.number().int().min(1).max(99).default(1),
  discountCode: z.string().trim().min(1).max(40).optional(),
  /* Order bump (feature #13): the buyer ticked the add-on. The server
     re-resolves the offer and its price — the tick alone buys nothing. */
  includeBump: z.boolean().default(false),
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
    /* A $0 lead magnet never reaches Stripe (migration 0190): there is
       no card to charge. It is claimed by email on the house rail. */
    if (Number(p.price_cents) === 0) {
      res.status(400).json({
        error: "FREE_PRODUCT",
        message: "This product is free — claim it with your email instead of checking out. No card, no charge.",
      });
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

    /* Order bump (feature #13): the buyer ticked the add-on. The offer
       and its price are re-resolved HERE from the seller's setting —
       a ticked box with no live offer (or a sold-out add-on) refuses
       the whole checkout rather than quietly charging for the main
       product alone or inventing a price. */
    let bump: { target: ProductRow; unitCents: number; grossCents: number; percentOff: number } | null = null;
    if (parsed.data.includeBump) {
      const cfg = readBumpConfig(p);
      if (!cfg) {
        res.status(400).json({
          error: "BUMP_NOT_OFFERED",
          message: "This product doesn't have an add-on offer.",
        });
        return;
      }
      const target = await fetchProduct(cfg.bumpProductId, true);
      if (!target) {
        res.status(400).json({
          error: "BUMP_NOT_OFFERED",
          message: "That add-on isn't for sale right now.",
        });
        return;
      }
      const verdict = validateBumpTarget(
        { id: p.id, profileId: p.profile_id },
        {
          id: target.id,
          profileId: target.profile_id,
          priceCents: Number(target.price_cents),
          isActive: Boolean(target.is_active),
          inventory: Number(target.inventory),
        },
      );
      if (!verdict.ok) {
        res.status(400).json({ error: verdict.code, message: verdict.reason });
        return;
      }
      const unit = bumpUnitCents(Number(target.price_cents), cfg.percentOff);
      bump = { target, unitCents: unit, grossCents: unit, percentOff: cfg.percentOff };
    }

    const lineTotal = unitCents * quantity;
    const grandTotal = lineTotal + (bump?.grossCents ?? 0);
    /* One fee split for the session (flat 5%), attributed across the
       lines by lib/order-bumps — with no bump these are exactly the
       numbers splitTotals(lineTotal) produced before the feature. */
    const totals = splitOrderAmounts(grandTotal, bump?.grossCents ?? 0);
    const feeCents = totals.totalFeeCents;
    const creatorCents = totals.totalCreatorCents;
    /* Purchase sequence for the session idempotency key (see
       buildStorefrontCheckoutKey). A read failure throws into the
       catch below — no session is minted, so the failure is closed. */
    /* `discount_code = x OR (both NULL)` is `IS NOT DISTINCT FROM`
       spelled portably — identical semantics on Postgres for a
       nullable text column, and parseable by the pg-mem test harness
       (which rejects IS NOT DISTINCT FROM outright). */
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM store_orders
      WHERE buyer_user_id = ${req.userId!} AND product_id = ${productId}
        AND quantity = ${quantity} AND amount_cents = ${grandTotal}
        AND (discount_code = ${discountCode}
             OR (discount_code IS NULL AND ${discountCode} IS NULL))
    `);
    const completedOrderCount = Number(
      (countResult.rows[0] as { c?: number } | undefined)?.c ?? 0,
    );
    const idempotencyKey = buildStorefrontCheckoutKey({
      userId: req.userId!,
      productId,
      quantity,
      unitCents,
      lineTotalCents: lineTotal,
      discountCode,
      completedOrderCount,
      bumpProductId: bump?.target.id ?? null,
      bumpLineCents: bump?.grossCents ?? 0,
    });
    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      /* Post-purchase upsell (Wave 3): ask Stripe to save the buyer's
         payment method to a customer so the one-click post-purchase
         offer can charge it off-session through its own
         PaymentIntent. Amounts, lines, metadata and the idempotency
         key are unchanged — a buyer who never gets or never accepts
         an offer is charged exactly what they were charged before. */
      customer_creation: "always",
      payment_intent_data: { setup_future_usage: "off_session" },
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
        ...(bump
          ? [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: bump.unitCents,
                  product_data: {
                    name: `${bump.target.title} — ${bump.target.artist_name} (add-on)`,
                    description:
                      bump.percentOff > 0
                        ? `${bump.target.kind} · add-on · ${bump.percentOff}% off`
                        : `${bump.target.kind} · add-on · Bow Down Visuals`,
                    images: (bump.target.media_urls ?? []).slice(0, 1),
                  },
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      /* Same success page as the digital store; it falls back to
         /api/storefront/verify for storefront sessions (see MOUNT.md). */
      success_url: `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/storefront/product/${p.id}`,
      metadata: {
        type: "storefront_purchase",
        buyer_user_id: req.userId!,
        profile_id: p.profile_id,
        product_id: p.id,
        product_kind: p.kind,
        quantity: String(quantity),
        discount_code: discountCode ?? "",
        amount_cents: String(grandTotal),
        platform_fee_cents: String(feeCents),
        creator_amount_cents: String(creatorCents),
        event_id: p.event_id ?? "",
        /* Bump line (feature #13): verify re-derives every split from
           the session total + this amount — these are the only two
           bump facts it trusts, and both were written by this box. */
        bump_product_id: bump?.target.id ?? "",
        bump_amount_cents: String(bump?.grossCents ?? 0),
      },
    }, { idempotencyKey });

    logger.info(
      { userId: req.userId, productId, quantity, lineTotal, grandTotal, bumpProductId: bump?.target.id ?? null, sessionId: session.id, discountCode },
      "[storefront] checkout session created"
    );
    res.json({
      url: session.url,
      sessionId: session.id,
      totals: {
        unitCents, quantity, lineTotal, lineTotalDisplay: money(lineTotal),
        percentOff, discountCode,
        bump: bump
          ? {
              productId: bump.target.id,
              title: bump.target.title,
              unitCents: bump.unitCents,
              grossCents: bump.grossCents,
              gross: money(bump.grossCents),
              percentOff: bump.percentOff,
              feeCents: totals.bump?.feeCents ?? 0,
              creatorCents: totals.bump?.creatorCents ?? 0,
            }
          : null,
        grandTotalCents: grandTotal,
        grandTotal: money(grandTotal),
        platformFeeCents: feeCents, creatorCents,
      },
    });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, productId }, "[storefront] checkout failed");
    res.status(500).json({ error: `Could not start checkout: ${msg}` });
  }
});

/* ═══════════════ POST-PURCHASE UPSELL (Wave 3) ═════════════════════
   One-click add-on offer AFTER a purchase completes. Designation is
   the seller's bump attachment (feature #13) — the same add-on the
   buyer could have ticked at checkout. The offer, its price/fee
   snapshot and the saved payment method live on ONE row per order in
   store_upsell_offers (migration 0206, reported by the lane). Every
   read here is defensive: on a database without the table the whole
   feature is simply absent (verify records orders exactly as before,
   the endpoints answer an honest UPSELL_UNAVAILABLE).

   Exactly-once, in layers: UNIQUE parent_order_id + ON CONFLICT DO
   NOTHING mints at most one offer; the PaymentIntent idempotency key
   is a pure function of the order id (lib/post-purchase-upsell), so
   double-clicks / duplicate accepts / retries all derive the same
   key; store_orders.stripe_payment_intent_id is UNIQUE with the same
   conflict discipline; and an accepted/failed offer short-circuits
   before Stripe is ever called again. */

interface UpsellOfferRow extends Record<string, unknown> {
  id: string;
  parent_order_id: string;
  buyer_user_id: string;
  profile_id: string;
  product_id: string;
  upsell_product_id: string;
  upsell_title: string;
  upsell_kind: string;
  list_price_cents: number;
  percent_off: number;
  amount_cents: number;
  platform_fee_cents: number;
  creator_amount_cents: number;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  status: string;
  stripe_payment_intent_id: string | null;
  upsell_order_id: string | null;
  shown_at: string | null;
}

/** Throws on a pre-migration database — callers decide what that
    means for their surface (verify: no offer; endpoints: honest 500). */
async function loadUpsellOffer(parentOrderId: string): Promise<UpsellOfferRow | null> {
  const r = await db.execute(sql`
    SELECT * FROM store_upsell_offers WHERE parent_order_id = ${parentOrderId} LIMIT 1
  `);
  return (r.rows[0] as unknown as UpsellOfferRow | undefined) ?? null;
}

function upsellHasReusablePaymentMethod(offer: UpsellOfferRow): boolean {
  return Boolean(offer.stripe_customer_id && offer.stripe_payment_method_id);
}

/** The buyer-facing offer payload — non-null ONLY for a pending offer
    with a reusable payment method. A decided offer, or one that could
    not be one-clicked, is never dangled in front of the buyer. Every
    figure is the snapshot the accept will charge, to the cent. */
function upsellPayload(offer: UpsellOfferRow) {
  if (offer.status !== "pending" || !upsellHasReusablePaymentMethod(offer)) return null;
  const gross = Number(offer.amount_cents);
  const fee = Number(offer.platform_fee_cents);
  const creator = Number(offer.creator_amount_cents);
  return {
    orderId: String(offer.parent_order_id),
    productId: String(offer.upsell_product_id),
    title: String(offer.upsell_title),
    kind: String(offer.upsell_kind),
    listPriceCents: Number(offer.list_price_cents),
    listPrice: money(Number(offer.list_price_cents)),
    percentOff: Number(offer.percent_off),
    priceCents: gross,
    price: money(gross),
    platformFeeCents: fee,
    platformFee: money(fee),
    platformFeePct: PLATFORM_FEE_PCT,
    creatorCents: creator,
    creatorAmount: money(creator),
    paymentMethod:
      offer.payment_method_brand || offer.payment_method_last4
        ? { brand: offer.payment_method_brand, last4: offer.payment_method_last4 }
        : null,
    note: "One click adds this to your order — charged to the payment method you just paid with. The price is the seller's listed price; the platform's flat 5% fee comes out of the creator's cut, never on top of what you pay.",
  };
}

/**
 * Mint (or fetch) the order's upsell offer. Returns null when the
 * purchase carries no offer: no designation, the buyer already bought
 * the add-on in this order, or the add-on isn't a live offer now.
 * The saved payment method is read off the completed session's
 * PaymentIntent — the checkout asked Stripe to save it
 * (setup_future_usage: off_session); when Stripe didn't (e.g. a
 * wallet that can't be reused), the row records that honestly with
 * NULL payment fields and the offer is simply never presented.
 */
async function ensureUpsellOffer(args: {
  orderId: string;
  buyerUserId: string;
  profileId: string;
  productId: string;
  boughtBumpProductId: string | null;
  session: Stripe.Checkout.Session;
  stripe: Stripe;
}): Promise<UpsellOfferRow | null> {
  const existing = await loadUpsellOffer(args.orderId);
  if (existing) return existing;

  const main = await fetchProduct(args.productId, false);
  if (!main) return null;
  const cfg = readBumpConfig(main);
  const target = cfg ? await fetchProduct(cfg.bumpProductId, false) : null;
  const eligibility = upsellEligibility({
    cfg,
    main: { id: main.id, profileId: main.profile_id },
    boughtBumpProductId: args.boughtBumpProductId,
    target: target
      ? {
          id: target.id,
          profileId: target.profile_id,
          priceCents: Number(target.price_cents),
          isActive: Boolean(target.is_active),
          inventory: Number(target.inventory),
        }
      : null,
  });
  if (!eligibility.ok || !cfg || !target) return null;

  const snapshot = buildUpsellSnapshot(cfg, {
    id: target.id,
    title: target.title,
    kind: target.kind,
    priceCents: Number(target.price_cents),
  });

  let customerId: string | null = null;
  let paymentMethodId: string | null = null;
  let brand: string | null = null;
  let last4: string | null = null;
  const piId =
    typeof args.session.payment_intent === "string"
      ? args.session.payment_intent
      : (args.session.payment_intent?.id ?? null);
  if (piId) {
    try {
      const pi = await args.stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
      customerId = typeof pi.customer === "string" ? pi.customer : (pi.customer?.id ?? null);
      const pm = pi.payment_method;
      if (typeof pm === "string") {
        paymentMethodId = pm;
      } else if (pm) {
        paymentMethodId = pm.id;
        brand = pm.card?.brand ?? null;
        last4 = pm.card?.last4 ?? null;
      }
    } catch (err) {
      /* A PI read failure must never fail the recorded purchase — the
         offer just carries no reusable method and stays unpresented. */
      logger.warn({ err, orderId: args.orderId }, "[storefront] upsell: payment-intent read failed; offer unpresented");
    }
  }

  await db.execute(sql`
    INSERT INTO store_upsell_offers
      (parent_order_id, buyer_user_id, profile_id, product_id,
       upsell_product_id, upsell_title, upsell_kind,
       list_price_cents, percent_off, amount_cents,
       platform_fee_cents, creator_amount_cents,
       stripe_customer_id, stripe_payment_method_id,
       payment_method_brand, payment_method_last4, status)
    VALUES (${args.orderId}, ${args.buyerUserId}, ${args.profileId}, ${args.productId},
            ${snapshot.upsellProductId}, ${snapshot.title}, ${snapshot.kind},
            ${snapshot.listPriceCents}, ${snapshot.percentOff}, ${snapshot.grossCents},
            ${snapshot.feeCents}, ${snapshot.creatorCents},
            ${customerId}, ${paymentMethodId}, ${brand}, ${last4}, 'pending')
    ON CONFLICT (parent_order_id) DO NOTHING
  `);
  return loadUpsellOffer(args.orderId);
}

async function markUpsellShown(offer: UpsellOfferRow): Promise<void> {
  if (offer.shown_at) return;
  await db.execute(sql`
    UPDATE store_upsell_offers SET shown_at = now(), updated_at = now()
    WHERE id = ${offer.id} AND shown_at IS NULL
  `);
}

/** Bump-style receipt for a recorded upsell order row. */
function upsellOrderReceipt(r: Record<string, unknown>) {
  const gross = Number(r["amount_cents"]);
  const fee = Number(r["platform_fee_cents"]);
  const creator = Number(r["creator_amount_cents"]);
  return {
    id: String(r["id"]),
    parentOrderId: r["parent_order_id"] ? String(r["parent_order_id"]) : null,
    isUpsell: true,
    productId: r["product_id"] ? String(r["product_id"]) : null,
    productTitle: String(r["product_title"] ?? "Add-on"),
    productKind: String(r["product_kind"] ?? "digital"),
    quantity: 1,
    amountCents: gross, amount: money(gross),
    platformFeeCents: fee, platformFee: money(fee),
    platformFeePct: PLATFORM_FEE_PCT,
    creatorAmountCents: creator, creatorAmount: money(creator),
    fulfillmentNote: (r["fulfillment_note"] as string | null) ?? null,
    lines: [
      {
        role: "upsell" as const,
        productId: r["product_id"] ? String(r["product_id"]) : null,
        title: String(r["product_title"] ?? "Add-on"),
        kind: String(r["product_kind"] ?? "digital"),
        quantity: 1,
        grossCents: gross, gross: money(gross),
        platformFeeCents: fee, platformFee: money(fee),
        creatorCents: creator, creatorAmount: money(creator),
      },
    ],
  };
}

async function fetchOrderRow(orderId: string): Promise<Record<string, unknown> | null> {
  const r = await db.execute(sql`
    SELECT * FROM store_orders WHERE id = ${orderId} LIMIT 1
  `);
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

/** The buyer's own order, or null (a non-owner reads as not-found —
    order existence is never leaked across accounts). */
async function fetchOwnOrder(orderId: string, userId: string): Promise<Record<string, unknown> | null> {
  const row = await fetchOrderRow(orderId);
  if (!row || String(row["buyer_user_id"]) !== userId) return null;
  return row;
}

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
  /* Bump facts (feature #13): only what checkout wrote into metadata.
     Every split below is re-derived from the session total + this
     amount — never trusted from the client or the metadata fees. */
  const bumpProductId = meta["bump_product_id"] || null;
  const bumpAmountCents = bumpProductId ? Number(meta["bump_amount_cents"] ?? 0) : 0;
  if (
    bumpProductId &&
    (!Number.isInteger(bumpAmountCents) || bumpAmountCents <= 0 || bumpAmountCents >= amountCents)
  ) {
    res.status(400).json({ error: "This session's add-on details don't add up." });
    return;
  }
  const splits = splitOrderAmounts(amountCents, bumpAmountCents);
  const feeCents = splits.totalFeeCents;
  const creatorCents = splits.totalCreatorCents;

  try {
    /* Duplicate verify: return the existing order, no new side effects.
       The bump columns ride a best-effort select: on a database where
       the feature's migration hasn't landed yet the plain select keeps
       verify working exactly as before (a bump session can only exist
       once the columns do, so nothing is lost by the fallback). */
    let existing: Awaited<ReturnType<typeof db.execute>>;
    try {
      existing = await db.execute(sql`
        SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
               platform_fee_cents, creator_amount_cents, fulfillment_note, created_at,
               bump_product_id, bump_title, bump_amount_cents,
               bump_platform_fee_cents, bump_creator_amount_cents
        FROM store_orders WHERE stripe_session_id = ${sessionId} LIMIT 1
      `);
    } catch {
      existing = await db.execute(sql`
        SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
               platform_fee_cents, creator_amount_cents, fulfillment_note, created_at
        FROM store_orders WHERE stripe_session_id = ${sessionId} LIMIT 1
      `);
    }
    let orderId: string;
    let duplicate = false;
    let fulfillmentNote: string | null = null;
    let mainTitle = "Store product";
    let recordedBump: { productId: string; title: string; grossCents: number } | null = null;
    let bumpDeliverable = false;
    if (existing.rows.length > 0) {
      const er = existing.rows[0] as Record<string, unknown>;
      orderId = String(er["id"]);
      fulfillmentNote = (er["fulfillment_note"] as string | null) ?? null;
      mainTitle = String(er["product_title"] ?? "Store product");
      if (er["bump_product_id"] && Number(er["bump_amount_cents"] ?? 0) > 0) {
        recordedBump = {
          productId: String(er["bump_product_id"]),
          title: String(er["bump_title"] ?? "Add-on"),
          grossCents: Number(er["bump_amount_cents"]),
        };
        /* The sold-out-after-payment sentence is written by this same
           module at record time — its absence means the add-on was
           fulfilled and may be re-delivered on a duplicate verify. */
        bumpDeliverable = !(fulfillmentNote ?? "").includes("sold out after payment");
      }
      duplicate = true;
      logger.info({ sessionId, orderId }, "[storefront] verify: duplicate ignored");
    } else {
      const p = await fetchProduct(productId, false);
      const productTitle = p?.title ?? "Store product";
      mainTitle = productTitle;

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

      /* Bump line (feature #13): fetch the add-on and claim its single
         unit the same way. Unlike the main line, a lost race here does
         NOT fail the paid order — the buyer paid for both, so the
         order records the line and the fulfillment note states the
         exact add-on refund the creator owes (see fulfillment below). */
      const bumpRow = bumpProductId ? await fetchProduct(bumpProductId, false) : null;
      const bumpTitle = bumpRow?.title ?? "Add-on";
      let bumpClaimFailed = false;
      if (bumpRow && Number(bumpRow.inventory) >= 0) {
        const claimedBump = await db.execute(sql`
          UPDATE store_products
          SET inventory = inventory - 1, updated_at = now()
          WHERE id = ${bumpProductId} AND inventory >= 1
          RETURNING id
        `);
        if (claimedBump.rows.length === 0) bumpClaimFailed = true;
      }
      bumpDeliverable = !!bumpRow && !bumpClaimFailed;

      const inserted = splits.bump
        ? await db.execute(sql`
            INSERT INTO store_orders
              (buyer_user_id, profile_id, product_id, product_title, product_kind,
               quantity, amount_cents, discount_code, platform_fee_cents,
               creator_amount_cents, stripe_session_id, status, fulfillment_note,
               bump_product_id, bump_title, bump_amount_cents,
               bump_platform_fee_cents, bump_creator_amount_cents)
            VALUES (${req.userId!}, ${profileId}, ${productId}, ${productTitle}, ${kind},
                    ${quantity}, ${amountCents}, ${discountCode}, ${feeCents},
                    ${creatorCents}, ${sessionId}, 'completed', NULL,
                    ${bumpProductId}, ${bumpTitle}, ${splits.bump.grossCents},
                    ${splits.bump.feeCents}, ${splits.bump.creatorCents})
            ON CONFLICT (stripe_session_id) DO NOTHING
            RETURNING id
          `)
        : await db.execute(sql`
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
      if (splits.bump) {
        recordedBump = { productId: bumpProductId!, title: bumpTitle, grossCents: splits.bump.grossCents };
      }
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

        /* Bump line fulfillment (feature #13): the add-on earns the
           same per-kind treatment as the main line, appended to the
           same note so the buyer's receipt tells the whole story. */
        if (splits.bump && bumpRow) {
          const bumpKind = bumpRow.kind;
          if (bumpClaimFailed) {
            fulfillmentNote += ` Add-on "${bumpTitle}" sold out after payment — the creator owes you a ${money(splits.bump.grossCents)} refund for the add-on.`;
          } else if (bumpKind === "ticket" && bumpRow.event_id) {
            const rsvp = await db.execute(sql`
              INSERT INTO event_rsvps (event_id, user_id)
              VALUES (${bumpRow.event_id}, ${req.userId!})
              ON CONFLICT DO NOTHING
              RETURNING event_id
            `);
            if (rsvp.rows.length > 0) {
              await db.execute(sql`UPDATE events SET rsvp_count = rsvp_count + 1 WHERE id = ${bumpRow.event_id}`);
            }
            fulfillmentNote += ` Add-on ticket "${bumpTitle}" secured — you're on the list.`;
          } else if (bumpKind === "service") {
            fulfillmentNote += ` Add-on booking "${bumpTitle}" received — the creator confirms your slot.`;
            const creatorUser = await db.execute(sql`
              SELECT user_id FROM creator_profiles WHERE id = ${profileId} LIMIT 1
            `);
            const crow = creatorUser.rows[0] as Record<string, unknown> | undefined;
            if (crow?.["user_id"]) {
              await db.execute(sql`
                INSERT INTO job_notifications (job_type, job_id, user_id, status, title, message)
                VALUES ('storefront_service_booking', ${`${orderId}:bump`}, ${String(crow["user_id"])},
                        'completed', ${`New booking (add-on): ${bumpTitle}`},
                        ${`Someone just booked your add-on "${bumpTitle}" (${money(splits.bump.grossCents)}) alongside "${productTitle}". Confirm their slot from your store dashboard.`})
                ON CONFLICT DO NOTHING
              `);
            }
          } else if (bumpKind === "merch") {
            fulfillmentNote += ` Add-on "${bumpTitle}" received — fulfilled through the creator's merch/print pipeline.`;
          } else {
            fulfillmentNote += ` Add-on "${bumpTitle}" delivery ready.`;
          }
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
    /* The bump line delivers on the same rail when it's a digital good
       and its unit was actually claimed (feature #13). */
    let bumpDelivery: { url: string; expiresAt: string; maxUses: number } | null = null;
    if (recordedBump && bumpDeliverable) {
      const bp = await fetchProduct(recordedBump.productId, false);
      if (bp && (bp.kind === "digital" || bp.kind === "download")) {
        const fileUrl = (bp.media_urls ?? [])[0];
        if (fileUrl) {
          const link = await mintDeliveryToken(orderId, fileUrl);
          bumpDelivery = {
            url: `/api/storefront/deliver/${link.token}`,
            expiresAt: link.expiresAt.toISOString(),
            maxUses: DELIVERY_MAX_USES,
          };
        }
      }
    }

    /* Receipt lines: the main purchase and the add-on as separate
       lines, each with its own fee attribution (lib/order-bumps). On a
       duplicate verify the lines are re-derived from the RECORDED
       amounts, so the receipt can never drift from the order row. */
    const receiptSplits = duplicate && recordedBump
      ? splitOrderAmounts(amountCents, recordedBump.grossCents)
      : splits;
    const lines = [
      {
        role: "main" as const,
        productId,
        title: mainTitle,
        kind,
        quantity,
        grossCents: receiptSplits.main.grossCents, gross: money(receiptSplits.main.grossCents),
        platformFeeCents: receiptSplits.main.feeCents, platformFee: money(receiptSplits.main.feeCents),
        creatorCents: receiptSplits.main.creatorCents, creatorAmount: money(receiptSplits.main.creatorCents),
      },
      ...(receiptSplits.bump && recordedBump
        ? [{
            role: "bump" as const,
            productId: recordedBump.productId,
            title: recordedBump.title,
            kind: null,
            quantity: 1,
            grossCents: receiptSplits.bump.grossCents, gross: money(receiptSplits.bump.grossCents),
            platformFeeCents: receiptSplits.bump.feeCents, platformFee: money(receiptSplits.bump.feeCents),
            creatorCents: receiptSplits.bump.creatorCents, creatorAmount: money(receiptSplits.bump.creatorCents),
          }]
        : []),
    ];

    /* Post-purchase upsell (Wave 3): mint/fetch this order's ONE
       offer and present it while it's pending with a reusable saved
       card. Fail-soft by design — an upsell hiccup (including a
       pre-migration database) must never fail a recorded purchase. */
    let upsell: ReturnType<typeof upsellPayload> = null;
    try {
      const offer = await ensureUpsellOffer({
        orderId,
        buyerUserId: req.userId!,
        profileId,
        productId,
        boughtBumpProductId: recordedBump?.productId ?? null,
        session,
        stripe,
      });
      if (offer) {
        await markUpsellShown(offer);
        upsell = upsellPayload(offer);
      }
    } catch (err) {
      logger.warn({ err, orderId }, "[storefront] upsell offer unavailable for this order");
      upsell = null;
    }

    const p = await fetchProduct(productId, false);
    res.json({
      success: true,
      duplicate,
      upsell,
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
        lines,
      },
      delivery,
      bumpDelivery,
      /* Link graph: no dead ends after payment — the highest-trust moment. */
      links: {
        productUrl: p ? `/storefront/product/${p.id}` : null,
        creatorUrl: p ? `/artist/${p.artist_slug}` : null,
        eventUrl: eventId ? `/shows#event-${eventId}` : null,
        /* Buyer order history is API-only for now:
           GET /api/storefront/orders/purchases (a "My purchases" page can mount it later). */
        purchasesEndpoint: "/api/storefront/orders/purchases",
      },
      note: "Real-money purchase via Stripe. This is not Visual Bucs (AI credits).",
    });
  } catch (err) {
    logger.error({ err, sessionId }, "[storefront] verify failed");
    res.status(500).json({ error: "Payment confirmed but the order couldn't be recorded. Contact support." });
  }
});

/* ═══════════ POST-PURCHASE UPSELL: offer / accept / decline ═════════
   The buyer acts on the offer verify minted. Accept is ONE click:
   no new card entry, no redirect — an off-session PaymentIntent on
   the payment method the just-completed checkout saved, charged at
   the snapshot the buyer was shown. */

router.get("/storefront/orders/:id/upsell", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid order id." });
    return;
  }
  try {
    const order = await fetchOwnOrder(id, req.userId!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    let offer: UpsellOfferRow | null;
    try {
      offer = await loadUpsellOffer(id);
    } catch {
      res.status(500).json({
        error: "UPSELL_UNAVAILABLE",
        message: "Post-purchase offers aren't switched on yet.",
      });
      return;
    }
    if (!offer) {
      res.json({ upsell: null });
      return;
    }
    if (offer.status === "pending") await markUpsellShown(offer);
    /* Decided offers (accepted/declined/failed) present as null —
       the offer never nags again for this order. */
    res.json({ upsell: upsellPayload(offer) });
  } catch (err) {
    logger.error({ err, id }, "[storefront] upsell offer fetch failed");
    res.status(500).json({ error: "Could not load the offer." });
  }
});

router.post("/storefront/orders/:id/upsell/accept", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid order id." });
    return;
  }
  try {
    const order = await fetchOwnOrder(id, req.userId!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    let offer: UpsellOfferRow | null;
    try {
      offer = await loadUpsellOffer(id);
    } catch {
      res.status(500).json({
        error: "UPSELL_UNAVAILABLE",
        message: "Post-purchase offers aren't switched on yet — no charge was made.",
      });
      return;
    }
    if (!offer) {
      res.status(404).json({
        error: "UPSELL_NOT_OFFERED",
        message: "This order doesn't have a post-purchase add-on offer.",
      });
      return;
    }

    /* Terminal replays — honest, and never a second charge. */
    if (offer.status === "accepted") {
      const recorded = offer.upsell_order_id
        ? await fetchOrderRow(String(offer.upsell_order_id))
        : null;
      if (recorded) {
        res.json({
          success: true,
          duplicate: true,
          order: upsellOrderReceipt(recorded),
          delivery: null,
          note: "This add-on was already added to your order — you were charged once, for the price shown.",
        });
        return;
      }
      res.status(409).json({
        error: "UPSELL_STATE_CONFLICT",
        message: "This offer was accepted but its order couldn't be found — contact support; do not re-pay.",
      });
      return;
    }
    if (offer.status === "declined") {
      res.status(409).json({
        error: "UPSELL_DECLINED",
        message: "You passed on this add-on — it isn't charged. You can still buy it from its product page.",
      });
      return;
    }
    if (offer.status === "failed") {
      res.status(409).json({
        error: "UPSELL_FAILED",
        message: "The one-click charge for this add-on already failed once — it won't be retried automatically. You can still buy it from its product page.",
      });
      return;
    }

    /* THE refusal: without a reusable payment method there is no
       one-click charge to make — refuse BEFORE Stripe is touched. */
    if (!upsellHasReusablePaymentMethod(offer)) {
      res.status(409).json({
        error: "UPSELL_NO_PAYMENT_METHOD",
        message: "There's no saved payment method from your purchase to charge in one click — no charge was made. You can still buy the add-on from its product page.",
      });
      return;
    }

    /* Live revalidation: the add-on must still be sellable. The
       MONEY is not re-derived — the buyer is charged the snapshot
       they were shown, to the cent. */
    const target = await fetchProduct(String(offer.upsell_product_id), false);
    const blocker = upsellAcceptBlocker(
      target ? { isActive: Boolean(target.is_active), inventory: Number(target.inventory) } : null,
    );
    if (blocker) {
      res.status(409).json({ error: blocker.code, message: blocker.reason });
      return;
    }

    /* Claim the single unit BEFORE charging (a failed charge
       releases it below), mirroring the rail's inventory discipline. */
    let claimed = false;
    if (target && Number(target.inventory) >= 0) {
      const claim = await db.execute(sql`
        UPDATE store_products
        SET inventory = inventory - 1, updated_at = now()
        WHERE id = ${target.id} AND inventory >= 1
        RETURNING id
      `);
      if (claim.rows.length === 0) {
        res.status(409).json({
          error: "UPSELL_SOLD_OUT",
          message: "That add-on just sold out — no charge was made.",
        });
        return;
      }
      claimed = true;
    }
    const releaseClaim = async () => {
      if (!claimed || !target) return;
      claimed = false;
      await db.execute(sql`
        UPDATE store_products SET inventory = inventory + 1, updated_at = now() WHERE id = ${target.id}
      `);
    };
    const failOffer = async (failureReason: string) => {
      await db.execute(sql`
        UPDATE store_upsell_offers
        SET status = 'failed', failure_reason = ${failureReason},
            decided_at = now(), updated_at = now()
        WHERE id = ${offer!.id} AND status = 'pending'
      `);
    };

    let stripe: Stripe;
    try {
      stripe = getStripe();
    } catch {
      await releaseClaim();
      res.status(500).json({ error: "Payments are not configured yet — no charge was made." });
      return;
    }

    /* THE charge: its own PaymentIntent, off-session on the saved
       method, keyed deterministically by the parent order id — a
       double-click, a duplicate accept or a retry after a timeout
       all derive the SAME key, so Stripe can only create one. */
    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: Number(offer.amount_cents),
          currency: "usd",
          customer: String(offer.stripe_customer_id),
          payment_method: String(offer.stripe_payment_method_id),
          off_session: true,
          confirm: true,
          description: `${String(offer.upsell_title)} — post-purchase add-on`,
          metadata: {
            type: "storefront_upsell",
            parent_order_id: id,
            upsell_offer_id: String(offer.id),
            buyer_user_id: req.userId!,
            profile_id: String(offer.profile_id),
            product_id: String(offer.product_id),
            upsell_product_id: String(offer.upsell_product_id),
            amount_cents: String(offer.amount_cents),
            platform_fee_cents: String(offer.platform_fee_cents),
            creator_amount_cents: String(offer.creator_amount_cents),
          },
        },
        { idempotencyKey: upsellIdempotencyKey(id) },
      );
    } catch (err) {
      /* Card declined / invalid method: Stripe made NO charge.
         Terminal for this offer — exactly-once means no silent
         second attempt with a fresh key. */
      await releaseClaim();
      await failOffer("card_declined");
      logger.warn({ err, orderId: id }, "[storefront] upsell charge declined");
      res.status(402).json({
        error: "UPSELL_CARD_DECLINED",
        message: "Your saved card declined the add-on charge — no charge was made. You can still buy the add-on from its product page.",
      });
      return;
    }
    if (pi.status !== "succeeded") {
      /* requires_action (the bank wants the buyer present) or any
         other non-final state: NOT a completed charge, and a
         one-click flow must never record it as one. */
      await releaseClaim();
      await failOffer(`pi_${pi.status}`);
      logger.warn({ orderId: id, piStatus: pi.status }, "[storefront] upsell payment intent did not complete");
      res.status(402).json({
        error: pi.status === "requires_action" ? "UPSELL_REQUIRES_ACTION" : "UPSELL_NOT_COMPLETED",
        message:
          pi.status === "requires_action"
            ? "Your bank needs you present to approve this charge, so the one-click add-on couldn't complete — no charge was made. You can still buy the add-on from its product page."
            : "The add-on charge didn't complete — no charge was made. You can still buy the add-on from its product page.",
      });
      return;
    }

    /* Record the upsell as its OWN order, pinned to the
       PaymentIntent (UNIQUE + ON CONFLICT DO NOTHING): if a racing
       accept already recorded it, this insert is a no-op and the
       recorded row is returned as the duplicate. */
    const inserted = await db.execute(sql`
      INSERT INTO store_orders
        (buyer_user_id, profile_id, product_id, product_title, product_kind,
         quantity, amount_cents, discount_code, platform_fee_cents,
         creator_amount_cents, stripe_session_id, status, fulfillment_note,
         parent_order_id, stripe_payment_intent_id)
      VALUES (${req.userId!}, ${String(offer.profile_id)}, ${String(offer.upsell_product_id)},
              ${String(offer.upsell_title)}, ${String(offer.upsell_kind)},
              1, ${Number(offer.amount_cents)}, NULL, ${Number(offer.platform_fee_cents)},
              ${Number(offer.creator_amount_cents)}, NULL, 'completed', NULL,
              ${id}, ${pi.id})
      ON CONFLICT (stripe_payment_intent_id) DO NOTHING
      RETURNING id
    `);
    let upsellOrderId: string;
    let duplicate = false;
    if (inserted.rows.length > 0) {
      upsellOrderId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
    } else {
      const byPi = await db.execute(sql`
        SELECT id FROM store_orders WHERE stripe_payment_intent_id = ${pi.id} LIMIT 1
      `);
      if (byPi.rows.length === 0) {
        logger.error({ orderId: id, piId: pi.id }, "[storefront] upsell charged but order record missing");
        res.status(500).json({
          error: "The add-on charge went through but its order couldn't be recorded. Contact support — do not re-pay.",
        });
        return;
      }
      upsellOrderId = String((byPi.rows[0] as Record<string, unknown>)["id"]);
      duplicate = true;
    }

    let delivery: { url: string; expiresAt: string; maxUses: number } | null = null;
    if (!duplicate && target) {
      /* Per-kind fulfillment, the bump line's treatment (feature #13). */
      const kind = target.kind;
      let note: string;
      if (kind === "ticket" && target.event_id) {
        const rsvp = await db.execute(sql`
          INSERT INTO event_rsvps (event_id, user_id)
          VALUES (${target.event_id}, ${req.userId!})
          ON CONFLICT DO NOTHING
          RETURNING event_id
        `);
        if (rsvp.rows.length > 0) {
          await db.execute(sql`UPDATE events SET rsvp_count = rsvp_count + 1 WHERE id = ${target.event_id}`);
        }
        note = "Add-on ticket secured — you're on the list. Show this order at the door (or follow the event link).";
      } else if (kind === "service") {
        note = "Add-on booking received — the creator confirms your slot from their dashboard.";
        const creatorUser = await db.execute(sql`
          SELECT user_id FROM creator_profiles WHERE id = ${String(offer.profile_id)} LIMIT 1
        `);
        const crow = creatorUser.rows[0] as Record<string, unknown> | undefined;
        if (crow?.["user_id"]) {
          await db.execute(sql`
            INSERT INTO job_notifications (job_type, job_id, user_id, status, title, message)
            VALUES ('storefront_service_booking', ${upsellOrderId}, ${String(crow["user_id"])},
                    'completed', ${`New booking (post-purchase add-on): ${String(offer.upsell_title)}`},
                    ${`Someone just added your "${String(offer.upsell_title)}" (${money(Number(offer.amount_cents))}) right after their purchase. Confirm their slot from your store dashboard.`})
            ON CONFLICT DO NOTHING
          `);
        }
      } else if (kind === "merch") {
        note = "Add-on order received — the creator fulfills it through their merch/print pipeline.";
      } else {
        note = "Add-on delivery ready.";
      }
      await db.execute(sql`
        UPDATE store_orders SET fulfillment_note = ${note} WHERE id = ${upsellOrderId}
      `);
      if (kind === "digital" || kind === "download") {
        const fileUrl = (target.media_urls ?? [])[0];
        if (fileUrl) {
          const link = await mintDeliveryToken(upsellOrderId, fileUrl);
          delivery = {
            url: `/api/storefront/deliver/${link.token}`,
            expiresAt: link.expiresAt.toISOString(),
            maxUses: DELIVERY_MAX_USES,
          };
        }
      }
    }

    await db.execute(sql`
      UPDATE store_upsell_offers
      SET status = 'accepted', stripe_payment_intent_id = ${pi.id},
          upsell_order_id = ${upsellOrderId}, decided_at = now(), updated_at = now()
      WHERE id = ${offer.id}
    `);

    const recorded = await fetchOrderRow(upsellOrderId);
    logger.info(
      { orderId: id, upsellOrderId, piId: pi.id, amountCents: Number(offer.amount_cents), duplicate },
      "[storefront] post-purchase upsell accepted"
    );
    res.json({
      success: true,
      duplicate,
      order: recorded ? upsellOrderReceipt(recorded) : null,
      delivery,
      note: "Real-money purchase via Stripe. This is not Visual Bucs (AI credits).",
    });
  } catch (err) {
    logger.error({ err, id }, "[storefront] upsell accept failed");
    res.status(500).json({ error: "The add-on couldn't be completed. If a charge appears, contact support — do not re-pay." });
  }
});

router.post("/storefront/orders/:id/upsell/decline", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid order id." });
    return;
  }
  try {
    const order = await fetchOwnOrder(id, req.userId!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    let offer: UpsellOfferRow | null;
    try {
      offer = await loadUpsellOffer(id);
    } catch {
      res.status(500).json({
        error: "UPSELL_UNAVAILABLE",
        message: "Post-purchase offers aren't switched on yet.",
      });
      return;
    }
    if (!offer) {
      res.status(404).json({
        error: "UPSELL_NOT_OFFERED",
        message: "This order doesn't have a post-purchase add-on offer.",
      });
      return;
    }
    if (offer.status === "declined") {
      res.json({ ok: true, status: "declined", duplicate: true });
      return;
    }
    if (offer.status !== "pending") {
      res.status(409).json({
        error: "UPSELL_ALREADY_DECIDED",
        message: "This offer was already decided — nothing changed.",
      });
      return;
    }
    await db.execute(sql`
      UPDATE store_upsell_offers
      SET status = 'declined', decided_at = now(), updated_at = now()
      WHERE id = ${offer.id} AND status = 'pending'
    `);
    res.json({ ok: true, status: "declined" });
  } catch (err) {
    logger.error({ err, id }, "[storefront] upsell decline failed");
    res.status(500).json({ error: "Could not record your answer." });
  }
});

/* ═══════════════════ CLAIM (free lead magnets, 0190) ═══════════════
   A $0 product is a lead magnet, not a sale: no Stripe session exists
   for it and none is ever created here. The buyer claims it — the
   claim subscribes their email to the creator's email list (the
   exchange, stated in the UI and consented to in this request),
   records a completed $0 order on the same store_orders rail verify
   writes, and fulfils on the same delivery rail (signed token for
   digital/download, RSVP for tickets, booking note + creator ping for
   services, merch handoff note). Idempotent: one completed claim
   order per buyer per product — a repeat claim returns the same
   order with a fresh delivery link and never double-subscribes. */
const ClaimSchema = z.object({
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  email: z.string().trim().email().max(254).optional(),
  name: z.string().trim().max(120).optional(),
  emailConsent: z.boolean().optional(),
});

router.post("/storefront/claim", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = ClaimSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.issues });
    return;
  }
  const { productId } = parsed.data;
  if (parsed.data.emailConsent !== true) {
    res.status(400).json({
      error: "CONSENT_REQUIRED",
      message: "Claiming this free product adds your email to the creator's list — that's the exchange. Tick the box to claim it.",
    });
    return;
  }
  const email = (parsed.data.email ?? req.userEmail ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({
      error: "EMAIL_REQUIRED",
      message: "We need the email this free product goes to — it's also how you join the creator's list.",
    });
    return;
  }
  const claimerName = (parsed.data.name ?? "").trim();

  try {
    const p = await fetchProduct(productId, true);
    if (!p) {
      res.status(404).json({ error: "NOT_FOR_SALE", message: "This product isn't available right now." });
      return;
    }
    if (Number(p.price_cents) !== 0) {
      res.status(400).json({
        error: "NOT_FREE",
        message: "This product isn't free — it goes through regular checkout.",
      });
      return;
    }
    const inventory = Number(p.inventory);
    if (inventory === 0) {
      res.status(400).json({ error: "SOLD_OUT", message: "This one just sold out — the creator's restocking." });
      return;
    }
    const kind = p.kind;
    const eventId = p.event_id ?? null;

    /* The creator side of the exchange: their email list (the oldest
       list is the default, same as their /join landing). */
    const creatorRes = await db.execute(sql`
      SELECT user_id FROM creator_profiles WHERE id = ${p.profile_id} LIMIT 1
    `);
    const creatorRow = creatorRes.rows[0] as Record<string, unknown> | undefined;
    const creatorUserId = creatorRow?.["user_id"] ? String(creatorRow["user_id"]) : null;
    const listRes = creatorUserId
      ? await db.execute(sql`
          SELECT id, name FROM email_lists WHERE user_id = ${creatorUserId}
          ORDER BY created_at ASC LIMIT 1
        `)
      : { rows: [] as Record<string, unknown>[] };
    const list = listRes.rows[0] as Record<string, unknown> | undefined;
    if (!list) {
      res.status(409).json({
        error: "CREATOR_LIST_MISSING",
        message: `${p.artist_name} hasn't set up their email list yet, so this free product can't be claimed yet.`,
      });
      return;
    }
    const listId = String(list["id"]);
    const listName = String(list["name"]);

    /* Subscribe with the subscribe rail's exact discipline
       (POST /email-list/subscribe): the free-tier cap counts active
       subscribers and is checked first; an existing live subscription
       stands; an unsubscribed address reactivates. */
    const subCountRes = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM email_subscribers
      WHERE list_id = ${listId} AND unsubscribed_at IS NULL
    `);
    const subCount = Number((subCountRes.rows[0] as Record<string, unknown>)?.["c"] ?? 0);
    if (subCount >= EMAIL_FREE_SUBSCRIBER_LIMIT) {
      res.status(403).json({
        error: "LIST_FULL",
        message: `This creator's list has reached the ${EMAIL_FREE_SUBSCRIBER_LIMIT}-subscriber free tier, so the claim can't go through right now.`,
      });
      return;
    }
    const existingSubRes = await db.execute(sql`
      SELECT id, unsubscribed_at FROM email_subscribers
      WHERE list_id = ${listId} AND email = ${email} LIMIT 1
    `);
    const existingSub = existingSubRes.rows[0] as Record<string, unknown> | undefined;
    let alreadySubscribed = false;
    if (existingSub) {
      alreadySubscribed = !existingSub["unsubscribed_at"];
      if (existingSub["unsubscribed_at"]) {
        await db.execute(sql`
          UPDATE email_subscribers
          SET unsubscribed_at = NULL, source = 'storefront'
          WHERE id = ${String(existingSub["id"])}
        `);
      }
    } else {
      await db.execute(sql`
        INSERT INTO email_subscribers (list_id, email, name, source, confirmed)
        VALUES (${listId}, ${email}, ${claimerName || null}, 'storefront', true)
      `);
    }

    /* Delivery is minted the same way verify mints it. */
    const buildDelivery = async (orderId: string) => {
      if (kind !== "digital" && kind !== "download") return null;
      const fileUrl = (p.media_urls ?? [])[0];
      if (!fileUrl) return null;
      const link = await mintDeliveryToken(orderId, fileUrl);
      return {
        url: `/api/storefront/deliver/${link.token}`,
        expiresAt: link.expiresAt.toISOString(),
        maxUses: DELIVERY_MAX_USES,
      };
    };
    const claimLinks = {
      productUrl: `/storefront/product/${p.id}`,
      creatorUrl: `/artist/${p.artist_slug}`,
      eventUrl: eventId ? `/shows#event-${eventId}` : null,
      purchasesEndpoint: "/api/storefront/orders/purchases",
    };
    const claimNote = `Free product — no payment was taken and no checkout was opened. Your email joined ${p.artist_name}'s list (“${listName}”) — that's the exchange for the freebie, and every email from it carries an unsubscribe link.`;

    /* Already claimed: the same order comes back with a fresh
       delivery link — delivered once, never twice. */
    const existingOrder = await db.execute(sql`
      SELECT id, fulfillment_note FROM store_orders
      WHERE buyer_user_id = ${req.userId!} AND product_id = ${productId}
        AND stripe_session_id IS NULL AND status = 'completed'
      ORDER BY created_at ASC LIMIT 1
    `);
    if (existingOrder.rows.length > 0) {
      const er = existingOrder.rows[0] as Record<string, unknown>;
      const orderId = String(er["id"]);
      logger.info({ userId: req.userId, productId, orderId }, "[storefront] claim: duplicate returned");
      res.json({
        success: true,
        duplicate: true,
        free: true,
        order: {
          id: orderId,
          productKind: kind,
          quantity: 1,
          amountCents: 0, amount: money(0),
          platformFeeCents: 0, platformFee: money(0),
          platformFeePct: PLATFORM_FEE_PCT,
          creatorAmountCents: 0, creatorAmount: money(0),
          discountCode: null,
          fulfillmentNote: (er["fulfillment_note"] as string | null) ?? null,
        },
        delivery: await buildDelivery(orderId),
        subscribed: { email, listName, alreadySubscribed },
        links: claimLinks,
        note: claimNote,
      });
      return;
    }

    /* Claim finite inventory atomically (unlimited = -1 skips). */
    if (inventory > 0) {
      const claimed = await db.execute(sql`
        UPDATE store_products
        SET inventory = inventory - 1, updated_at = now()
        WHERE id = ${productId} AND inventory >= 1
        RETURNING id
      `);
      if (claimed.rows.length === 0) {
        res.status(400).json({ error: "SOLD_OUT", message: "This one just sold out — the creator's restocking." });
        return;
      }
    }

    const inserted = await db.execute(sql`
      INSERT INTO store_orders
        (buyer_user_id, profile_id, product_id, product_title, product_kind,
         quantity, amount_cents, discount_code, platform_fee_cents,
         creator_amount_cents, stripe_session_id, status, fulfillment_note)
      VALUES (${req.userId!}, ${p.profile_id}, ${productId}, ${p.title}, ${kind},
              1, 0, NULL, 0, 0, NULL, 'completed', NULL)
      RETURNING id
    `);
    const orderId = String((inserted.rows[0] as Record<string, unknown>)["id"]);

    /* Kind-specific fulfillment — the same notes verify records. */
    let fulfillmentNote: string;
    if (kind === "ticket" && eventId) {
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
      if (creatorUserId) {
        await db.execute(sql`
          INSERT INTO job_notifications (job_type, job_id, user_id, status, title, message)
          VALUES ('storefront_service_booking', ${orderId}, ${creatorUserId},
                  'completed', ${`New booking: ${p.title}`},
                  ${`Someone just claimed "${p.title}" (free). Confirm their slot from your store dashboard.`})
          ON CONFLICT DO NOTHING
        `);
      }
    } else if (kind === "merch") {
      /* MERCH BOUNDARY: physical fulfillment lives in the merch system. */
      fulfillmentNote = "Order received — the creator fulfills it through their merch/print pipeline.";
    } else {
      fulfillmentNote = "Digital delivery ready.";
    }
    await db.execute(sql`
      UPDATE store_orders SET fulfillment_note = ${fulfillmentNote} WHERE id = ${orderId}
    `);
    logger.info({ userId: req.userId, productId, orderId, kind }, "[storefront] free product claimed");

    res.status(201).json({
      success: true,
      duplicate: false,
      free: true,
      order: {
        id: orderId,
        productKind: kind,
        quantity: 1,
        amountCents: 0, amount: money(0),
        platformFeeCents: 0, platformFee: money(0),
        platformFeePct: PLATFORM_FEE_PCT,
        creatorAmountCents: 0, creatorAmount: money(0),
        discountCode: null,
        fulfillmentNote,
      },
      delivery: await buildDelivery(orderId),
      subscribed: { email, listName, alreadySubscribed },
      links: claimLinks,
      note: claimNote,
    });
  } catch (err) {
    logger.error({ err, productId }, "[storefront] claim failed");
    res.status(500).json({ error: "Could not claim this product. Nothing was charged — a free product never charges." });
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
  ${ok ? `<div class="meta">${usesLeft ?? 0} downloads left · link expires ${safe(expiresAt ?? "")}<br/>Lost this file? A fresh link can be minted for your order.</div>` : ""}
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
        message: "This link expired (48 hours) or hit its 5-download limit. Your purchase is safe — the buyer can mint a fresh link for their order (POST /api/storefront/orders/:id/delivery-token).",
      }));
      return;
    }
    const sale = await db.execute(sql`
      SELECT product_title FROM store_orders WHERE id = ${String(row["order_id"])} LIMIT 1
    `);
    const srow = sale.rows[0] as Record<string, unknown> | undefined;
    res.status(200).send(deliveryPageHtml({
      ok: true,
      /* The stored file value may be a storage ref (mirrored at save) —
         mint a fresh download URL for the delivery page. */
      fileUrl: await refreshSupabaseStorageUrl(String(row["file_url"])),
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
/** Receipt lines for an order row (feature #13): the main purchase
    plus the bump add-on as its own line when the order carries one.
    Amounts are read from the recorded bump columns — the receipt is
    the order row, re-derived splits only attribute the fee. Rows from
    a pre-migration database have no bump keys and yield the main line
    alone, exactly as before the feature. */
function orderLines(r: Record<string, unknown>) {
  const gross = Number(r["amount_cents"]);
  const fee = Number(r["platform_fee_cents"]);
  const net = Number(r["creator_amount_cents"]);
  const bumpGross = Number(r["bump_amount_cents"] ?? 0);
  const main = {
    role: "main" as const,
    productId: r["product_id"] ? String(r["product_id"]) : null,
    title: String(r["product_title"] ?? "Product"),
    kind: String(r["product_kind"] ?? "digital"),
    quantity: Number(r["quantity"]),
    grossCents: gross - (bumpGross > 0 ? bumpGross : 0),
    platformFeeCents: fee - (bumpGross > 0 ? Number(r["bump_platform_fee_cents"] ?? 0) : 0),
    netCents: net - (bumpGross > 0 ? Number(r["bump_creator_amount_cents"] ?? 0) : 0),
  };
  const lines: Array<Record<string, unknown>> = [
    {
      ...main,
      gross: money(main.grossCents),
      platformFee: money(main.platformFeeCents),
      net: money(main.netCents),
    },
  ];
  if (bumpGross > 0 && r["bump_product_id"]) {
    const bFee = Number(r["bump_platform_fee_cents"] ?? 0);
    const bNet = Number(r["bump_creator_amount_cents"] ?? 0);
    lines.push({
      role: "bump",
      productId: String(r["bump_product_id"]),
      title: String(r["bump_title"] ?? "Add-on"),
      kind: null,
      quantity: 1,
      grossCents: bumpGross,
      gross: money(bumpGross),
      platformFeeCents: bFee,
      platformFee: money(bFee),
      netCents: bNet,
      net: money(bNet),
    });
  }
  return lines;
}

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
    /* The bump as its own receipt line (feature #13) — [main] alone
       for every order recorded before/without an add-on. */
    lines: orderLines(r),
    /* Post-purchase upsell orders (Wave 3) link back to the order
       that prompted them; absent keys (pre-0206 rows) read as a
       regular order. */
    parentOrderId: r["parent_order_id"] ? String(r["parent_order_id"]) : null,
    isUpsell: Boolean(r["parent_order_id"]),
    discountCode: (r["discount_code"] as string | null) ?? null,
    status: String(r["status"]),
    fulfillmentNote: (r["fulfillment_note"] as string | null) ?? null,
    createdAt: String(r["created_at"]),
    links: {
      productUrl: r["product_id"] ? `/storefront/product/${r["product_id"]}` : null,
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
    /* Bump columns (feature #13) ride a best-effort select — a
       database without the migration yet lists orders exactly as
       before, with the main receipt line alone. */
    let r: Awaited<ReturnType<typeof db.execute>>;
    try {
      r = await db.execute(sql`
        SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
               discount_code, platform_fee_cents, creator_amount_cents, status,
               fulfillment_note, created_at,
               bump_product_id, bump_title, bump_amount_cents,
               bump_platform_fee_cents, bump_creator_amount_cents,
               parent_order_id
        FROM store_orders
        WHERE profile_id = ${profile.id}
        ORDER BY created_at DESC
        LIMIT 500
      `);
    } catch {
      try {
        r = await db.execute(sql`
          SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
                 discount_code, platform_fee_cents, creator_amount_cents, status,
                 fulfillment_note, created_at,
                 bump_product_id, bump_title, bump_amount_cents,
                 bump_platform_fee_cents, bump_creator_amount_cents
          FROM store_orders
          WHERE profile_id = ${profile.id}
          ORDER BY created_at DESC
          LIMIT 500
        `);
      } catch {
        r = await db.execute(sql`
          SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
                 discount_code, platform_fee_cents, creator_amount_cents, status,
                 fulfillment_note, created_at
          FROM store_orders
          WHERE profile_id = ${profile.id}
          ORDER BY created_at DESC
          LIMIT 500
        `);
      }
    }
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
    let r: Awaited<ReturnType<typeof db.execute>>;
    try {
      r = await db.execute(sql`
        SELECT so.id, so.product_id, so.product_title, so.product_kind, so.quantity,
               so.amount_cents, so.discount_code, so.platform_fee_cents,
               so.creator_amount_cents, so.status, so.fulfillment_note, so.created_at,
               so.bump_product_id, so.bump_title, so.bump_amount_cents,
               so.bump_platform_fee_cents, so.bump_creator_amount_cents,
               so.parent_order_id,
               cp.slug AS artist_slug, cp.display_name AS artist_name
        FROM store_orders so
        JOIN creator_profiles cp ON cp.id = so.profile_id
        WHERE so.buyer_user_id = ${req.userId!}
        ORDER BY so.created_at DESC
        LIMIT 200
      `);
    } catch {
      try {
        r = await db.execute(sql`
          SELECT so.id, so.product_id, so.product_title, so.product_kind, so.quantity,
                 so.amount_cents, so.discount_code, so.platform_fee_cents,
                 so.creator_amount_cents, so.status, so.fulfillment_note, so.created_at,
                 so.bump_product_id, so.bump_title, so.bump_amount_cents,
                 so.bump_platform_fee_cents, so.bump_creator_amount_cents,
                 cp.slug AS artist_slug, cp.display_name AS artist_name
          FROM store_orders so
          JOIN creator_profiles cp ON cp.id = so.profile_id
          WHERE so.buyer_user_id = ${req.userId!}
          ORDER BY so.created_at DESC
          LIMIT 200
        `);
      } catch {
        r = await db.execute(sql`
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
      }
    }
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

/* ═══════════ BUYER: mint a fresh delivery token for an order ═════════ */
router.post("/storefront/orders/:id/delivery-token", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid order id." });
    return;
  }
  try {
    const r = await db.execute(sql`
      SELECT so.id, so.product_id, so.product_kind
      FROM store_orders so
      WHERE so.id = ${id} AND so.buyer_user_id = ${req.userId!}
      LIMIT 1
    `);
    const orow = r.rows[0] as Record<string, unknown> | undefined;
    if (!orow) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const kind = String(orow["product_kind"]);
    if (kind !== "digital" && kind !== "download") {
      res.status(400).json({ error: "Only digital products have download links." });
      return;
    }
    const p = await fetchProduct(String(orow["product_id"]), false);
    const fileUrl = (p?.media_urls ?? [])[0];
    if (!fileUrl) {
      res.status(400).json({ error: "This file is no longer available." });
      return;
    }
    const link = await mintDeliveryToken(id, fileUrl);
    res.json({
      url: `/api/storefront/deliver/${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
      maxUses: DELIVERY_MAX_USES,
    });
  } catch (err) {
    logger.error({ err, id }, "[storefront] delivery token mint failed");
    res.status(500).json({ error: "Could not create a download link." });
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
      ? `${getBaseUrl(req)}/storefront/product/${product.id}`
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
