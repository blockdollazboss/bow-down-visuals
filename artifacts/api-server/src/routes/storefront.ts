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
 *   GET    /storefront/product/:id/slots          public: open booking slots (bookable services)
 *   GET    /storefront/bookings                   auth: my bookings as buyer + as seller
 *   POST   /storefront/orders/:id/booking-cancel  auth: cancel a calendar booking (+ Stripe refund)
 *   GET    /storefront/deliver/:token             public: token-gated instant delivery (digital)
 *   PUT    /storefront/products/:id/drop          auth: schedule/reschedule a timed drop (#25)
 *   DELETE /storefront/products/:id/drop          auth: cancel a scheduled drop
 *   GET    /storefront/products/:id/drop          auth: drop + capture list (owner)
 *   POST   /storefront/products/:id/drop/capture  public: join the drop list (email capture)
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
import { createHmac, randomBytes, randomUUID } from "crypto";
import { db, EMAIL_FREE_SUBSCRIBER_LIMIT } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
/* Worker 12 (PLATFORM TIERS + FEE ECONOMICS) owns the money math — this is
   the ONE shared fee location. The base fee is a flat 5% (env
   PLATFORM_FEE_BPS; owner ruling 2026-10-23) — the same rate the
   shops/store rails charge, on every tier. */
import { PLATFORM_FEE_BPS, feeSplit, formatUsd, bpsToPct } from "../lib/platform-fees";
import {
  generateOpenSlots,
  isGridSlot,
  isValidAvailability,
  isValidTimeZone,
  ymdInTimeZone,
  type BookingAvailability,
  type TakenRange,
} from "../lib/booking-slots";
import {
  bookingBlocksSlot,
  bookingHumanLine,
  decodeBookingNote,
  deriveBookingStatus,
  encodeBookingNote,
  withBookingState,
  type BookingRecord,
} from "../lib/booking-note";
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
import { validateAffiliateCodeForProduct, recordAffiliateSaleSafely } from "../lib/affiliates";
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
import {
  BookingSlotConflictError,
  cancelServiceBooking,
  confirmServiceBooking,
  fetchServiceBookingOrderIds,
  fetchServiceBookingRanges,
  placeServiceBooking,
} from "../lib/service-bookings";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../lib/stripe-client";
import {
  GiftCardsUnavailable,
  findCardByCode,
  isGiftCardCodeShape,
  releaseExpiredReservations,
  reserveGiftCard,
  redeemReservation,
  releaseReservation,
  tenderFor,
  validateDenominations,
} from "../lib/gift-cards";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import { isUndefinedTable, pgErrorText } from "../lib/pg-errors";
import { ALT_TEXT_MAX_CHARS, sanitizeAltTextList } from "../lib/alt-text";

/* #29: store_products.media_alt_texts lands via a held migration
   (numbering assigned at join). Probe once and cache (publish.ts season
   precedent): product writes include the column only when it exists, so
   the storefront door works exactly as before until the column lands.
   Reads use SELECT sp.* — the field simply appears when present. */
let storeAltColKnown: boolean | null = null;
async function storeProductsHasMediaAlt(): Promise<boolean> {
  if (storeAltColKnown !== null) return storeAltColKnown;
  try {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'store_products' AND column_name = 'media_alt_texts'
    `);
    storeAltColKnown = ((r.rows[0] as { n?: number } | undefined)?.n ?? 0) === 1;
  } catch {
    storeAltColKnown = false;
  }
  return storeAltColKnown;
}

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
    /* Timed drop (#25): the product's drop state rides every payload,
       or null when the product has no drop (or drops aren't deployed
       yet — the read degrades, never errors). */
    drop: dropDto(await loadDropForProduct(p.id)),
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
/* 'course' (0214) and 'gift_card' (0215) widened the DB kind CHECK in
   this stack; both kinds are live once those migrations land. */
const STORE_PRODUCT_KINDS = ["download", "merch", "digital", "service", "ticket", "course", "gift_card"] as const;

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

/* ═══════════════ PAID BOOKINGS (real calendar) ═══════════════════════
   A bookable service product carries availability in service_details
   (lib/booking-slots.ts owns the slot math). A booking is a store_orders
   row: inserted as a HOLD (status 'booking_held', 30-minute TTL) when the
   checkout session is created, flipped to 'completed' by verify, and
   cancelled/refunded through POST /orders/:id/booking-cancel. The slot
   payload rides in the order's fulfillment_note behind the codec in
   lib/booking-note.ts — that module is the format's only owner. */

export const BOOKING_HOLD_TTL_MIN = 30;

type SqlRunner = Pick<typeof db, "execute">;

interface BookableInfo {
  bookable: boolean;
  durationMin: number;
  availability: BookingAvailability | null;
}

function bookableInfo(serviceDetails: Record<string, unknown> | null | undefined): BookableInfo {
  const sd = (serviceDetails ?? {}) as Record<string, unknown>;
  const durationMin = typeof sd["duration_min"] === "number" ? (sd["duration_min"] as number) : 0;
  const av = (sd["availability"] ?? null) as BookingAvailability | null;
  const bookable =
    sd["booking_enabled"] === true && !!av && isValidAvailability(av) && durationMin > 0;
  return { bookable, durationMin, availability: bookable ? av : null };
}

/** Orders that currently block slots for a product: fresh holds + paid
 *  bookings whose trailer is live (not cancelled).
 *
 *  HARDENED UNION (Stack-100 #3): when the service_bookings table exists
 *  (lib/service-bookings.ts), an order WITH a hardened row is represented
 *  by that row — its status/hold-expiry is the slot truth — and orders
 *  WITHOUT one (every v1 trailer-only booking) keep counting from their
 *  trailer, so legacy and hardened bookings block side by side and none
 *  is ever double-counted. A trailer that says CANCELLED vetoes its
 *  hardened row too: if a cancel ever landed on the order but missed the
 *  table, the slot still frees. Pre-migration the hardened side is
 *  empty and this is exactly the v1 behavior. */
async function fetchTakenRanges(run: SqlRunner, productId: string, now: Date): Promise<TakenRange[]> {
  const r = await run.execute(sql`
    SELECT id, fulfillment_note, status, created_at
    FROM store_orders
    WHERE product_id = ${productId} AND product_kind = 'service'
      AND fulfillment_note LIKE '%⟦bk1:%'
  `);
  const trailerCandidates: Array<{ orderId: string; startUtc: string; endUtc: string }> = [];
  const trailerCancelled = new Set<string>();
  for (const row of r.rows as Array<Record<string, unknown>>) {
    const rec = decodeBookingNote(row["fulfillment_note"] as string | null);
    if (!rec) continue;
    const orderId = String(row["id"]);
    const status = String(row["status"]);
    if (rec.st === "cancelled" || status === "cancelled" || status === "refunded") {
      trailerCancelled.add(orderId);
      continue;
    }
    if (!bookingBlocksSlot(rec)) continue;
    if (status !== "booking_held" && status !== "completed") continue;
    if (status === "booking_held") {
      const created = new Date(String(row["created_at"])).getTime();
      if (Number.isNaN(created) || created + BOOKING_HOLD_TTL_MIN * 60_000 <= now.getTime()) continue;
    }
    trailerCandidates.push({ orderId, startUtc: rec.s, endUtc: rec.e });
  }
  const covered = await fetchServiceBookingOrderIds(run, productId);
  if (covered.size === 0) {
    return trailerCandidates.map(({ startUtc, endUtc }) => ({ startUtc, endUtc }));
  }
  const hardened = await fetchServiceBookingRanges(run, productId, now);
  const taken: TakenRange[] = hardened
    .filter((h) => !trailerCancelled.has(h.orderId))
    .map(({ startUtc, endUtc }) => ({ startUtc, endUtc }));
  for (const t of trailerCandidates) {
    if (!covered.has(t.orderId)) taken.push({ startUtc: t.startUtc, endUtc: t.endUtc });
  }
  return taken;
}

type SlotCheck =
  | { ok: true; record: BookingRecord }
  | { ok: false; code: string; message: string };

/** Validate a buyer-picked slot against the live grid + taken set. The
 *  caller MUST run this under the product lock (see lockProductRow) so the
 *  check and the hold insert are one atomic step. */
async function checkSlot(
  run: SqlRunner,
  args: {
    productId: string;
    availability: BookingAvailability;
    durationMin: number;
    startUtc: Date;
    buyerUserId: string;
    buyerTz: string;
    now: Date;
  },
): Promise<SlotCheck> {
  const { availability, durationMin, startUtc, now } = args;
  if (!isGridSlot({ availability, durationMin, startUtc, now })) {
    return {
      ok: false, code: "SLOT_NOT_OFFERED",
      message: "That time isn't on this creator's calendar — pick one of the open slots.",
    };
  }
  const taken = await fetchTakenRanges(run, args.productId, now);
  const open = generateOpenSlots({
    availability, durationMin, taken,
    fromUtc: startUtc, toUtc: new Date(startUtc.getTime() + 1), now,
  });
  if (open.length === 0) {
    /* Was it this same buyer's own live hold? Give them the way back in
       instead of a bare "taken". */
    const mine = await run.execute(sql`
      SELECT fulfillment_note FROM store_orders
      WHERE product_id = ${args.productId} AND buyer_user_id = ${args.buyerUserId}
        AND status = 'booking_held'
        AND created_at > ${new Date(now.getTime() - BOOKING_HOLD_TTL_MIN * 60_000).toISOString()}
    `);
    for (const row of mine.rows as Array<Record<string, unknown>>) {
      const rec = decodeBookingNote(row["fulfillment_note"] as string | null);
      if (rec && rec.s === startUtc.toISOString()) {
        return {
          ok: false, code: "SLOT_HELD_BY_YOU",
          message: "You already have this slot held — finish that checkout (the hold expires after 30 minutes).",
        };
      }
    }
    return {
      ok: false, code: "SLOT_TAKEN",
      message: "That slot was just taken — pick another open time.",
    };
  }
  return {
    ok: true,
    record: {
      v: 1,
      s: startUtc.toISOString(),
      e: new Date(startUtc.getTime() + durationMin * 60_000).toISOString(),
      ctz: availability.timezone,
      btz: args.buyerTz,
      st: "held",
    },
  };
}

/** The buyer's own confirmed CLAIM booking (free rail: no Stripe session)
 *  at exactly `startUtc`, if one exists. A re-claim of that slot is a
 *  duplicate of this booking — never a SLOT_TAKEN. */
async function findOwnClaimAtSlot(
  run: SqlRunner,
  args: { buyerUserId: string; productId: string; startUtc: Date },
): Promise<{ orderId: string; record: BookingRecord } | null> {
  const r = await run.execute(sql`
    SELECT id, fulfillment_note FROM store_orders
    WHERE buyer_user_id = ${args.buyerUserId} AND product_id = ${args.productId}
      AND stripe_session_id IS NULL AND status = 'completed'
      AND fulfillment_note LIKE '%⟦bk1:%'
    ORDER BY created_at ASC
  `);
  for (const row of r.rows as Array<Record<string, unknown>>) {
    const rec = decodeBookingNote(row["fulfillment_note"] as string | null);
    if (rec && rec.s === args.startUtc.toISOString() && bookingBlocksSlot(rec)) {
      return { orderId: String(row["id"]), record: rec };
    }
  }
  return null;
}

/** Serialize booking writes per product: an UPDATE that changes nothing
 *  still takes the row lock in Postgres, held until the transaction ends. */
async function lockProductRow(run: SqlRunner, productId: string): Promise<void> {
  await run.execute(sql`
    UPDATE store_products SET updated_at = updated_at WHERE id = ${productId}
  `);
}

async function creatorUserId(run: SqlRunner, profileId: string): Promise<string | null> {
  const r = await run.execute(sql`
    SELECT user_id FROM creator_profiles WHERE id = ${profileId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row?.["user_id"] ? String(row["user_id"]) : null;
}

/** Exactly-once user ping through the job-notifications relay (same rail
 *  the legacy service flow uses). */
async function notifyBookingParty(
  run: SqlRunner,
  args: { userId: string; jobType: string; jobId: string; title: string; message: string },
): Promise<void> {
  await run.execute(sql`
    INSERT INTO job_notifications (job_type, job_id, user_id, status, title, message)
    VALUES (${args.jobType}, ${args.jobId}, ${args.userId}, 'completed', ${args.title}, ${args.message})
    ON CONFLICT DO NOTHING
  `);
}

/* ── Link graph: every product response carries its web of links ─────── */
interface ProductRow extends Record<string, unknown> {
  id: string; profile_id: string; kind: string; title: string;
  description: string; price_cents: number; compare_at_cents: number | null;
  inventory: number; media_urls: string[]; service_details: Record<string, unknown> | null;
  /** #29: index-aligned accessibility descriptions for media_urls;
      absent on pre-migration rows (the column is held for join). */
  media_alt_texts?: string[] | null;
  gift_card_denominations_cents: number[] | null;
  event_id: string | null; related_links: Array<{ label: string; url: string }>;
  is_active: boolean; created_at: string;
  affiliate_enabled?: boolean; affiliate_commission_bps?: number | null;
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
    /* #29: index-aligned with mediaUrls; [] when none was provided. */
    mediaAltTexts: sanitizeAltTextList(p.media_alt_texts ?? [], 20),
    serviceDetails: p.service_details,
    /* Order-bump setting (feature #13): the raw attachment, so the
       seller's dashboard can show and edit it even while the add-on
       is inactive or restocking. The buyer-facing resolved offer
       rides as `bump` (added by presentProduct). */
    bumpConfig: readBumpConfig(p),
    /* kind='gift_card': the seller-set amounts the buyer picks from.
       priceCents carries the smallest one (the listing's "from" price). */
    giftCardDenominationsCents: Array.isArray(p.gift_card_denominations_cents)
      ? p.gift_card_denominations_cents.map(Number)
      : null,
    eventId: p.event_id,
    relatedLinks: p.related_links ?? [],
    isActive: p.is_active,
    createdAt: p.created_at,
    /* Creator Product Affiliates (#16): the creator's own per-product
       setting, presented so seller + buyer surfaces render the same
       truth. Commission is a % of the CREATOR's cut — buyers never pay
       it and it never changes the listed price. */
    affiliatesEnabled: p.affiliate_enabled === true,
    affiliateCommissionBps: p.affiliate_commission_bps == null ? null : Number(p.affiliate_commission_bps),
    affiliateCommissionPct: p.affiliate_commission_bps == null ? null : bpsToPct(Number(p.affiliate_commission_bps)),
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

/* ── Timed product drops (#25) ─────────────────────────────────────────
   A drop is a row in product_drops (held migration — see the schema in
   lib/db/src/schema/product-drops.ts). drop_at is a timestamptz: ONE
   UTC instant; clients render the countdown in the viewer's local
   time from the ISO string. State is COMPUTED at read time from
   (status, drop_at, now): 'scheduled' + future = upcoming (the product
   page IS the drop page; checkout/claim refuse), 'scheduled' + past =
   due — the product reads as live immediately, even before the
   sweeper flips the status and fans out the one drop-day email
   (lib/product-drop-notify.ts). Nothing can publish early: every
   buy path gates on this same computation.
   Until the migration lands, reads degrade to "no drop" (42P01) and
   writes answer 503 drop_unavailable — products behave as before. */
interface DropRow extends Record<string, unknown> {
  id: string; product_id: string; profile_id: string; user_id: string;
  drop_at: string | Date; status: string; notified_at: string | Date | null;
}

function isMissingDropTables(err: unknown): boolean {
  return isUndefinedTable(err) || /relation .* does not exist|undefined_table/i.test(pgErrorText(err));
}

async function loadDropForProduct(productId: string): Promise<DropRow | null> {
  try {
    const r = await db.execute(sql`
      SELECT id, product_id, profile_id, user_id, drop_at, status, notified_at
      FROM product_drops WHERE product_id = ${productId} LIMIT 1
    `);
    return (r.rows[0] as unknown as DropRow | undefined) ?? null;
  } catch (err) {
    if (isMissingDropTables(err)) return null;
    throw err;
  }
}

async function loadDropCaptureCount(dropId: string): Promise<number> {
  try {
    const r = await db.execute(sql`SELECT COUNT(*) AS c FROM product_drop_captures WHERE drop_id = ${dropId}`);
    return Number((r.rows[0] as { c: string | number } | undefined)?.c ?? 0);
  } catch (err) {
    if (isMissingDropTables(err)) return 0;
    throw err;
  }
}

/** The computed drop state for a product payload / a buy gate. */
function dropState(drop: DropRow | null, now: Date = new Date()): {
  state: "none" | "upcoming" | "live" | "cancelled";
  isUpcoming: boolean;
  dropAt: string | null;
} {
  if (!drop) return { state: "none", isUpcoming: false, dropAt: null };
  const dropAtMs = new Date(drop.drop_at as string).getTime();
  const iso = Number.isFinite(dropAtMs) ? new Date(dropAtMs).toISOString() : null;
  if (drop.status === "cancelled") return { state: "cancelled", isUpcoming: false, dropAt: iso };
  if (drop.status === "live" || dropAtMs <= now.getTime()) {
    return { state: "live", isUpcoming: false, dropAt: iso };
  }
  return { state: "upcoming", isUpcoming: true, dropAt: iso };
}

function dropDto(drop: DropRow | null) {
  if (!drop) return null;
  const s = dropState(drop);
  if (s.state === "cancelled") return null;
  return {
    id: String(drop.id),
    state: s.state,
    isUpcoming: s.isUpcoming,
    /* UTC instant (ISO 8601) — the client renders local time. */
    dropAt: s.dropAt,
    notifiedAt: drop.notified_at ? new Date(drop.notified_at as string).toISOString() : null,
  };
}

/* The presave fan-list handoff, mirrored for drops (distribution.ts):
   reuse the creator's oldest email list, or create one named after
   them on first capture. Captures subscribe with source 'drop'. */
function slugifyDropHandle(base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34);
  return clean || "fans";
}

async function ensureDropCreatorList(userId: string, creatorName: string): Promise<{ id: string; handle: string }> {
  const existing = await db.execute(sql`
    SELECT id, handle FROM email_lists WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1
  `);
  const row = existing.rows[0] as { id: string; handle: string } | undefined;
  if (row) return { id: row.id, handle: row.handle };
  const base = `${slugifyDropHandle(creatorName)}-fans`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const handle = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await db.execute(sql`SELECT id FROM email_lists WHERE handle = ${handle} LIMIT 1`);
    if (taken.rows.length > 0) continue;
    const created = await db.execute(sql`
      INSERT INTO email_lists (user_id, name, handle, description)
      VALUES (${userId}, ${`${creatorName} fans`}, ${handle}, ${"Fans from product drop pages."})
      RETURNING id, handle
    `);
    const createdRow = created.rows[0] as { id: string; handle: string };
    return { id: createdRow.id, handle: createdRow.handle };
  }
  throw new Error("handle_unavailable");
}

async function subscribeDropFan(listId: string, email: string, name: string): Promise<void> {
  const existing = await db.execute(sql`
    SELECT id, unsubscribed_at FROM email_subscribers WHERE list_id = ${listId} AND email = ${email} LIMIT 1
  `);
  const row = existing.rows[0] as { id: string; unsubscribed_at: string | null } | undefined;
  if (!row) {
    await db.execute(sql`
      INSERT INTO email_subscribers (list_id, email, name, source, confirmed)
      VALUES (${listId}, ${email}, ${name || null}, ${"drop"}, ${true})
    `);
    return;
  }
  await db.execute(sql`
    UPDATE email_subscribers
    SET unsubscribed_at = NULL, name = CASE WHEN ${name} <> '' THEN ${name} ELSE name END, source = ${"drop"}
    WHERE id = ${row.id}
  `);
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
    const presented = await presentProduct(p);
    /* Drop page payload (#25): while the drop is upcoming this same
       page renders the countdown + capture instead of the buy box. */
    const drop = presented.drop
      ? {
          ...presented.drop,
          captureCount: presented.drop.isUpcoming
            ? await loadDropCaptureCount(presented.drop.id)
            : 0,
          productUrl: `/storefront/product/${p.id}`,
        }
      : null;
    const isGiftCard = p.kind === "gift_card";
    res.json({
      product: presented,
      drop,
      free: isFree,
      /* Gift cards carry NO fee split at purchase: the full amount is
         the recipient's stored value (a liability, not a sale). The
         standard fee applies later, to whatever sale the card pays
         for. Showing a fee here would tell a lie twice over. */
      feeSplit: isGiftCard
        ? {
            priceCents: Number(p.price_cents), price: money(Number(p.price_cents)),
            platformFeeCents: 0, platformFee: money(0),
            platformFeePct: 0,
            creatorCents: 0, creatorAmount: money(0),
          }
        : {
            priceCents: Number(p.price_cents), price: money(Number(p.price_cents)),
            platformFeeCents: feeCents, platformFee: money(feeCents),
            platformFeePct: PLATFORM_FEE_PCT,
            creatorCents, creatorAmount: money(creatorCents),
          },
      note: isGiftCard
        ? "A gift card for this creator's store — pick an amount, and it goes straight to your recipient's email. No platform fee is taken from a gift card: every cent you buy is a cent they can spend. This is not Visual Bucs (AI credits)."
        : isFree
        ? "Free product — claim it with your email, no card and no charge. Claiming adds your email to this creator's list; unsubscribe anytime."
        : "Real-money purchase via Stripe. This is not Visual Bucs (AI credits).",
    });
  } catch (err) {
    logger.error({ err, id }, "[storefront] product detail failed");
    res.status(500).json({ error: "Could not load this product." });
  }
});

/* ═══════════════════ PUBLIC: open booking slots ══════════════════════
   For a bookable service product: the real open slots for the next N days,
   generated from the creator's availability minus everything already
   booked or held. Times are UTC instants; each client renders them in the
   viewer's own timezone (that conversion is display-only — the booking
   itself is stored in UTC). Days are the creator's local calendar dates. */
router.get("/storefront/product/:id/slots", publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid product id." });
    return;
  }
  const daysRaw = Number(req.query.days ?? 14);
  const days = Number.isFinite(daysRaw) ? Math.min(31, Math.max(1, Math.floor(daysRaw))) : 14;
  try {
    const p = await fetchProduct(id, true);
    if (!p) {
      res.status(404).json({ error: "Product not found or no longer for sale." });
      return;
    }
    const info = bookableInfo(p.service_details);
    if (p.kind !== "service" || !info.bookable || !info.availability) {
      res.json({
        bookable: false,
        reason: "This service doesn't take calendar bookings — buying it sends the creator a booking request instead.",
      });
      return;
    }
    const now = new Date();
    const taken = await fetchTakenRanges(db, id, now);
    const slots = generateOpenSlots({
      availability: info.availability,
      durationMin: info.durationMin,
      taken,
      fromUtc: now,
      toUtc: new Date(now.getTime() + days * 86_400_000),
      now,
    });
    const byDate = new Map<string, Array<{ startUtc: string; endUtc: string }>>();
    for (const s of slots) {
      const date = ymdInTimeZone(new Date(s.startUtc), info.availability.timezone);
      const list = byDate.get(date) ?? [];
      list.push(s);
      byDate.set(date, list);
    }
    res.json({
      bookable: true,
      timezone: info.availability.timezone,
      durationMin: info.durationMin,
      days: [...byDate.entries()].map(([date, daySlots]) => ({ date, slots: daySlots })),
      note: "Times are shown in your own timezone. The booking is confirmed the moment payment completes.",
    });
  } catch (err) {
    logger.error({ err, id }, "[storefront] slots failed");
    res.status(500).json({ error: "Could not load open times." });
  }
});

/* ═════════════════════════ SELLER: product CRUD ═══════════════════════ */
const RelatedLinkSchema = z.object({
  label: z.string().min(1).max(80),
  url: z.string().min(1).max(2048),
});
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const BookingWindowSchema = z.object({
  start: z.string().regex(HHMM, "Use HH:MM (24h)."),
  end: z.string().regex(HHMM, "Use HH:MM (24h)."),
}).refine((w) => w.end > w.start, { message: "A window must end after it starts." });
const BookingAvailabilitySchema = z.object({
  timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Must be an IANA timezone, e.g. America/New_York."),
  weekly: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    start: z.string().regex(HHMM, "Use HH:MM (24h)."),
    end: z.string().regex(HHMM, "Use HH:MM (24h)."),
  }).refine((w) => w.end > w.start, { message: "A window must end after it starts." })).max(21),
  overrides: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
    windows: z.array(BookingWindowSchema).max(4).nullable(),
  })).max(366).optional(),
  slot_step_min: z.number().int().min(5).max(1440).optional(),
  buffer_min: z.number().int().min(0).max(720).optional(),
  min_notice_min: z.number().int().min(0).max(43_200).optional(),
  max_advance_days: z.number().int().min(1).max(365).optional(),
});
const ServiceDetailsSchema = z.object({
  duration_min: z.number().int().positive().max(1440).optional(),
  location: z.string().max(300).optional(),
  /* Optional external calendar link (e.g. a public Cal.com page). Native
     booking below is the real calendar; this link is just an extra door. */
  booking_calendar_link: z.string().url().max(2048).optional(),
  notes: z.string().max(2000).optional(),
  /* Native paid bookings (lane F5): when booking_enabled is true and
     availability is set, buyers pick a real open slot at checkout. */
  booking_enabled: z.boolean().optional(),
  availability: BookingAvailabilitySchema.optional(),
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
  /* #29: accessibility descriptions for mediaUrls, index-aligned —
     creator-written or AI-suggested, editable before it ships. */
  mediaAltTexts: z.array(z.string().max(ALT_TEXT_MAX_CHARS)).max(20).default([]),
  serviceDetails: ServiceDetailsSchema,
  /* kind='gift_card' only: the denominations the SELLER offers
     (integer cents, $5–$500, up to 8). Required for gift cards. */
  giftCardDenominationsCents: z.array(z.number().int()).max(8).nullable().optional(),
  eventId: z.string().regex(UUID_RE).nullable().optional(),
  relatedLinks: z.array(RelatedLinkSchema).max(10).default([]),
  isActive: z.boolean().default(true),
  /* Creator Product Affiliates (#16): creator-set, never defaulted to a
     rate by the platform. Enabling REQUIRES the rate (refine below on
     create; the PATCH handler checks the stored rate the same way). */
  affiliateEnabled: z.boolean().default(false),
  affiliateCommissionBps: z.number().int().min(1).max(10_000).nullable().optional(),
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
}).refine((d) => !d.affiliateEnabled || (d.affiliateCommissionBps != null && d.affiliateCommissionBps >= 1), {
  message: "Turning affiliates on needs the commission you'll pay them (affiliateCommissionBps, 1–10000 = 0.01%–100% of your cut).",
  path: ["affiliateCommissionBps"],
}).refine((d) => d.kind !== "gift_card" || validateDenominations(d.giftCardDenominationsCents).ok, {
  message: "Gift cards need seller-set amounts: 1–8 whole amounts between $5 and $500.",
  path: ["giftCardDenominationsCents"],
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
    const hasMediaAlt = await storeProductsHasMediaAlt();
    /* Gift cards: the listing price is the smallest denomination (the
       "from" price); buyers pick the real amount at gift-card checkout
       from the seller's denominations. Other kinds price as given. */
    const giftDenominations = d.kind === "gift_card"
      ? validateDenominations(d.giftCardDenominationsCents).ok
        ? [...new Set((d.giftCardDenominationsCents ?? []).map(Number))].sort((a, b) => a - b)
        : []
      : null;
    const effectivePriceCents = giftDenominations && giftDenominations.length > 0
      ? giftDenominations[0]!
      : d.priceCents;
    const r = await db.execute(sql`
      INSERT INTO store_products
        (profile_id, kind, title, description, price_cents, compare_at_cents,
         inventory, media_urls, service_details, event_id, related_links, is_active,
         affiliate_enabled, affiliate_commission_bps${hasMediaAlt ? sql`, media_alt_texts` : sql``}${giftDenominations ? sql`, gift_card_denominations_cents` : sql``})
      VALUES (${profile.id}, ${d.kind}, ${d.title}, ${d.description}, ${effectivePriceCents},
              ${d.compareAtCents ?? null}, ${d.inventory}, ${JSON.stringify(await mirrorStoreMediaUrls(d.mediaUrls, req.userId!))}::jsonb,
              ${d.serviceDetails ? JSON.stringify(d.serviceDetails) : null}::jsonb,
              ${d.eventId ?? null}, ${JSON.stringify(d.relatedLinks)}::jsonb, ${d.isActive},
              ${d.affiliateEnabled}, ${d.affiliateCommissionBps ?? null}${hasMediaAlt ? sql`, ${JSON.stringify(sanitizeAltTextList(d.mediaAltTexts, 20))}::jsonb` : sql``}${giftDenominations ? sql`, ${JSON.stringify(giftDenominations)}::jsonb` : sql``})
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
    if (d.mediaAltTexts !== undefined && (await storeProductsHasMediaAlt()))
      sets.push(sql`media_alt_texts = ${JSON.stringify(sanitizeAltTextList(d.mediaAltTexts, 20))}::jsonb`);
    if (d.serviceDetails !== undefined)
      sets.push(sql`service_details = ${d.serviceDetails ? JSON.stringify(d.serviceDetails) : null}::jsonb`);
    if (d.giftCardDenominationsCents !== undefined) {
      const v = validateDenominations(d.giftCardDenominationsCents);
      if (!v.ok) {
        res.status(400).json({ error: "Invalid gift-card amounts.", message: v.error });
        return;
      }
      sets.push(sql`gift_card_denominations_cents = ${JSON.stringify(v.denominations)}::jsonb`);
      /* Keep the listing's "from" price honest: smallest denomination. */
      sets.push(sql`price_cents = ${v.denominations[0]!}`);
    }
    if (d.eventId !== undefined) sets.push(sql`event_id = ${d.eventId}`);
    if (d.relatedLinks !== undefined) sets.push(sql`related_links = ${JSON.stringify(d.relatedLinks)}::jsonb`);
    if (d.isActive !== undefined) sets.push(sql`is_active = ${d.isActive}`);
    if (d.affiliateCommissionBps !== undefined) sets.push(sql`affiliate_commission_bps = ${d.affiliateCommissionBps ?? null}`);
    if (d.affiliateEnabled !== undefined) {
      /* Enabling without a rate in the same patch is only honest when a
         rate is already stored — otherwise the seller would flip a
         switch that promises affiliates a % nobody set. */
      if (d.affiliateEnabled && d.affiliateCommissionBps === undefined) {
        const cur = await db.execute(sql`
          SELECT affiliate_commission_bps FROM store_products
          WHERE id = ${id} AND profile_id = ${profile.id} LIMIT 1
        `);
        const curBps = (cur.rows[0] as Record<string, unknown> | undefined)?.["affiliate_commission_bps"];
        if (curBps == null) {
          res.status(400).json({
            error: "COMMISSION_REQUIRED",
            message: "Set the commission you'll pay affiliates (affiliateCommissionBps) when you turn affiliates on.",
          });
          return;
        }
      }
      sets.push(sql`affiliate_enabled = ${d.affiliateEnabled}`);
    }
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
  /* Paid bookings: the exact open slot the buyer picked (UTC ISO) plus
     the buyer's IANA timezone for their copy of the booking record. */
  bookingStartUtc: z.string().datetime().optional(),
  buyerTimezone: z.string().trim().min(1).max(64).optional(),
  /* Order bump (feature #13): the buyer ticked the add-on. The server
     re-resolves the offer and its price — the tick alone buys nothing. */
  includeBump: z.boolean().default(false),
  /* Creator Product Affiliates (#16): the fan share code from the
     ?ref= link, validated server-side below exactly like a discount
     code — the client can present it, only the server believes it. */
  affiliateCode: z.string().trim().min(1).max(64).optional(),
  /* Gift-card tender (Stack-100 #3 #26): sits BESIDE the discount code,
     but is money, not a markdown — the discount reduces the gross
     first, then the card tenders against what's due. The platform fee
     is still charged on the full (discounted) gross: tender never
     reduces the fee base (lib/gift-cards.ts fee law). */
  giftCardCode: z.string().trim().min(1).max(40).optional(),
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
    /* Timed drop gate (#25): an upcoming drop is never buyable early —
       the drop moment is computed from drop_at (UTC), not the sweeper. */
    const checkoutDrop = dropState(await loadDropForProduct(productId));
    if (checkoutDrop.isUpcoming) {
      res.status(400).json({
        error: "DROP_NOT_LIVE",
        message: "This product drops soon — join the drop list on its page and you'll get one email the moment it's live.",
        dropAt: checkoutDrop.dropAt,
      });
      return;
    }
    /* Gift cards are bought on their own checkout (POST
       /api/gift-cards/checkout) because delivery goes to a recipient
       email the buyer supplies — never through this product checkout. */
    if (p.kind === "gift_card") {
      res.status(400).json({
        error: "GIFT_CARD_CHECKOUT",
        message: "Gift cards are bought for someone else — choose an amount and the recipient's email on the gift-card checkout.",
      });
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
    /* Creator Courses: access is binary — you own the course or you
       don't (the Paid Series rule on this rail). One copy per buyer,
       and a completed order refuses a second checkout outright; a
       refunded order does NOT block buying back in. */
    if (p.kind === "course") {
      if (quantity !== 1) {
        res.status(400).json({ error: "COURSE_SINGLE", message: "A course is one unlock per buyer — quantity is 1." });
        return;
      }
      const ownedResult = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM store_orders
        WHERE buyer_user_id = ${req.userId!} AND product_id = ${productId}
          AND status = 'completed'
      `);
      const ownedCount = Number(
        (ownedResult.rows[0] as { c?: number } | undefined)?.c ?? 0,
      );
      if (ownedCount > 0) {
        res.status(409).json({
          error: "ALREADY_OWNED",
          message: "You already own this course — it's in My Courses in the Academy.",
          learnUrl: "/academy?tab=courses",
        });
        return;
      }
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

    /* Join composition (Stack-100 #3): a calendar booking and an add-on
       tick are never combined. The booking HOLD row carries the main
       line's amounts only, and neither lane's tested scope covers the
       hybrid — so a tick on a bookable service refuses the checkout,
       like any other tick that cannot be honoured, rather than silently
       dropping or double-counting the add-on. */
    if (bump && p.kind === "service" && bookableInfo(p.service_details).bookable) {
      res.status(400).json({
        error: "BUMP_NOT_OFFERED",
        message: "Add-ons can't be added to a calendar booking.",
      });
      return;
    }

    const lineTotal = unitCents * quantity;
    const grandTotal = lineTotal + (bump?.grossCents ?? 0);

    /* Affiliate attribution (#16): a presented code must be an active
       code FOR THIS product on a product the creator opened to
       affiliates. It rides the Stripe metadata to verify, where the
       commission is recorded exactly once with the order. It never
       changes the price, the fee, or the buyer's total. */
    let affiliateCode: string | null = null;
    if (parsed.data.affiliateCode) {
      const v = await validateAffiliateCodeForProduct({
        code: parsed.data.affiliateCode, surface: "store_product", productId,
      });
      if (!v.ok) {
        res.status(400).json({ error: "BAD_AFFILIATE_CODE", message: v.reason });
        return;
      }
      affiliateCode = v.code.code;
    }

    /* Join composition (Stack-100 #3): affiliate attribution records
       with the fresh order insert at verify; a calendar booking's order
       row already exists as the checkout HOLD and flips in place, so a
       referred booking could never record its commission. Refuse the
       code here rather than letting it ride silently unrecorded. */
    if (affiliateCode && p.kind === "service" && bookableInfo(p.service_details).bookable) {
      res.status(400).json({
        error: "AFFILIATE_NOT_APPLICABLE",
        message: "Affiliate codes can't be used with a calendar booking.",
      });
      return;
    }

    /* One fee split for the session (flat 5%), attributed across the
       lines by lib/order-bumps — with no bump these are exactly the
       numbers splitTotals(lineTotal) produced before the feature. */
    const totals = splitOrderAmounts(grandTotal, bump?.grossCents ?? 0);
    const feeCents = totals.totalFeeCents;
    const creatorCents = totals.totalCreatorCents;


    /* ── Gift-card tender: reserve the card's spendable balance
       against this checkout. The hold settles at verify; if this
       checkout dies, the hold expires (30 min) and the cents return. */
    let giftCardAppliedCents = 0;
    let giftReservationId: string | null = null;
    let giftReservationRef: string | null = null;
    let giftCardLast4: string | null = null;
    if (parsed.data.giftCardCode) {
      if (!isGiftCardCodeShape(parsed.data.giftCardCode)) {
        res.status(400).json({ error: "BAD_GIFT_CARD", message: "That doesn't look like a gift-card code (BDV-XXXX-XXXX-XXXX-XXXX)." });
        return;
      }
      try {
        await releaseExpiredReservations();
        const card = await findCardByCode(parsed.data.giftCardCode);
        if (!card || card.status !== "active") {
          res.status(400).json({ error: "BAD_GIFT_CARD", message: "That gift card isn't active." });
          return;
        }
        if (String(card.profile_id) !== p.profile_id) {
          res.status(400).json({ error: "WRONG_STORE", message: "That gift card is for a different creator's store." });
          return;
        }
        const tender = tenderFor(Number(card.balance_cents) - Number(card.reserved_cents), lineTotal);
        if (tender <= 0) {
          res.status(400).json({ error: "NO_BALANCE", message: "That gift card has no balance left to spend." });
          return;
        }
        giftReservationRef = `sf-${randomBytes(16).toString("hex")}`;
        const reservation = await reserveGiftCard({
          cardId: String(card.id), rail: "storefront", ref: giftReservationRef, amountCents: tender,
        });
        if (!reservation) {
          res.status(409).json({ error: "GIFT_CARD_BUSY", message: "That gift card's balance is held by another checkout right now — try again in a moment." });
          return;
        }
        giftCardAppliedCents = tender;
        giftReservationId = String(reservation.id);
        giftCardLast4 = String(card.code_last4);

        /* Join composition (Stack-100 #3): a calendar booking confirms
           through the hold-flip at verify — a FULL tender would bypass
           the Stripe session that drives the flip and strand the slot.
           A partial tender composes (session for the rest, flip
           redeems the hold); a full one refuses honestly here. */
        if (giftCardAppliedCents >= lineTotal && p.kind === "service" && bookableInfo(p.service_details).bookable) {
          await releaseReservation(giftReservationId).catch(() => undefined);
          res.status(400).json({
            error: "GIFT_CARD_NOT_APPLICABLE",
            message: "A gift card can't fully pay for a calendar booking — pay by card, or spend the card on a regular product.",
          });
          return;
        }
      } catch (err) {
        if (err instanceof GiftCardsUnavailable) {
          res.status(503).json({ error: "GIFT_CARDS_UNAVAILABLE", message: "Gift cards aren't live yet — check out without the code for now. Nothing was charged." });
          return;
        }
        throw err;
      }
    }
    const cardDueCents = lineTotal - giftCardAppliedCents;
    /* Gift card covers the whole bill: no card payment exists to
       take, so the order records right here — paid in full by tender,
       fee still on the full gross — and the hold redeems against it.
       The session-shaped record key keeps verify idempotency honest:
       stripe_session_id carries `giftcard:{ref}`, unique per hold. */
    if (giftReservationId && cardDueCents === 0 && !bump) {
      if (Number(p.inventory) >= 0) {
        const claimed = await db.execute(sql`
          UPDATE store_products
          SET inventory = inventory - ${quantity}, updated_at = now()
          WHERE id = ${productId} AND inventory >= ${quantity}
          RETURNING id
        `);
        if (claimed.rows.length === 0) {
          await releaseReservation(giftReservationId).catch(() => undefined);
          res.status(400).json({ error: "SOLD_OUT", message: "This one just sold out — your gift card was not charged." });
          return;
        }
      }
      const recordKey = `giftcard:${giftReservationRef}`;
      const inserted = await db.execute(sql`
        INSERT INTO store_orders
          (buyer_user_id, profile_id, product_id, product_title, product_kind,
           quantity, amount_cents, discount_code, platform_fee_cents,
           creator_amount_cents, stripe_session_id, status, fulfillment_note)
        VALUES (${req.userId!}, ${p.profile_id}, ${productId}, ${p.title}, ${p.kind},
                ${quantity}, ${lineTotal}, ${discountCode}, ${feeCents},
                ${creatorCents}, ${recordKey}, 'completed', NULL)
        ON CONFLICT (stripe_session_id) DO NOTHING
        RETURNING id
      `);
      let orderId: string;
      if (inserted.rows.length > 0) {
        orderId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
        if (discountCode) {
          await db.execute(sql`
            UPDATE discount_codes
            SET used_count = used_count + 1
            WHERE profile_id = ${p.profile_id}
              AND UPPER(code) = ${discountCode.toUpperCase()}
              AND (max_uses = -1 OR used_count < max_uses)
          `);
        }
        const note = p.kind === "ticket"
          ? "Ticket secured — you're on the list. Show this order at the door (or follow the event link)."
          : p.kind === "service"
            ? "Booking request received — the creator confirms your slot from their dashboard."
            : p.kind === "merch"
              ? "Order received — the creator fulfills it through their merch/print pipeline."
              : "Digital delivery ready.";
        await db.execute(sql`UPDATE store_orders SET fulfillment_note = ${note} WHERE id = ${orderId}`);
      } else {
        const retry = await db.execute(sql`
          SELECT id FROM store_orders WHERE stripe_session_id = ${recordKey} LIMIT 1
        `);
        orderId = String((retry.rows[0] as Record<string, unknown>)["id"]);
      }
      const redeemed = await redeemReservation({ reservationId: giftReservationId, ref: orderId });
      if (!redeemed) {
        logger.error({ orderId, giftReservationId }, "[storefront] gift-card redeem failed after order record — needs reconciliation");
      }
      logger.info({ userId: req.userId, productId, orderId, giftCardAppliedCents }, "[storefront] order paid in full by gift card");
      res.json({
        paid: true,
        paidWithGiftCard: true,
        url: null,
        sessionId: null,
        orderId,
        totals: {
          unitCents, quantity, lineTotal, lineTotalDisplay: money(lineTotal),
          percentOff, discountCode,
          giftCardAppliedCents, giftCardLast4, amountDueCents: 0,
          platformFeeCents: feeCents, creatorCents,
        },
        note: "Paid in full with your gift card — no card payment was taken. The balance left on the card stays on the card.",
      });
      return;
    }

    /* ── Paid bookings: validate the picked slot and place the HOLD ──
       The hold is a store_orders row (status 'booking_held') written
       under the product lock, BEFORE the Stripe session exists — so a
       slot can never be sold twice: any racer sees the hold as taken.
       The session's expiry matches the hold TTL; verify flips the hold
       to a confirmed booking. */
    let bookingHold: { id: string; record: BookingRecord } | null = null;
    const bookInfo = bookableInfo(p.service_details);
    if (parsed.data.bookingStartUtc && (!bookInfo.bookable || p.kind !== "service")) {
      res.status(400).json({
        error: "SLOT_NOT_BOOKABLE",
        message: "This product doesn't take calendar bookings.",
      });
      return;
    }
    if (bookInfo.bookable && p.kind === "service") {
      if (!parsed.data.bookingStartUtc) {
        res.status(400).json({
          error: "BOOKING_REQUIRED",
          message: "Pick a time first — this service is booked on the creator's calendar.",
          slotsEndpoint: `/api/storefront/product/${p.id}/slots`,
        });
        return;
      }
      if (quantity !== 1) {
        res.status(400).json({
          error: "BOOKING_QUANTITY",
          message: "A booking is one session — quantity is always 1.",
        });
        return;
      }
      const startUtc = new Date(parsed.data.bookingStartUtc);
      if (Number.isNaN(startUtc.getTime())) {
        res.status(400).json({ error: "Invalid booking time." });
        return;
      }
      const buyerTz =
        parsed.data.buyerTimezone && isValidTimeZone(parsed.data.buyerTimezone)
          ? parsed.data.buyerTimezone
          : bookInfo.availability!.timezone;
      const now = new Date();
      let holdResult: Awaited<ReturnType<typeof placeCheckoutHold>>;
      try {
        holdResult = await placeCheckoutHold();
      } catch (err) {
        /* The hardened table's exclusion constraint is the final guard:
           it fired inside the transaction, which rolled the hold back.
           Translate to the existing SLOT_TAKEN honesty. */
        if (err instanceof BookingSlotConflictError) {
          res.status(409).json({ error: "SLOT_TAKEN", message: err.message });
          return;
        }
        throw err;
      }
      async function placeCheckoutHold() { return db.transaction(async (tx) => {
        const run = tx as unknown as SqlRunner;
        /* p was null-checked above; the closure boundary drops the
           narrowing, so re-assert it once here. */
        const prod = p!;
        await lockProductRow(run, productId);
        const cur = await run.execute(sql`
          SELECT service_details, is_active FROM store_products WHERE id = ${productId} LIMIT 1
        `);
        const crow = cur.rows[0] as Record<string, unknown> | undefined;
        if (!crow || !crow["is_active"]) return { ok: false, status: 404, code: "NOT_FOR_SALE", message: "This product isn't for sale right now." } as const;
        const curInfo = bookableInfo(crow["service_details"] as Record<string, unknown> | null);
        if (!curInfo.bookable || !curInfo.availability) {
          return { ok: false, status: 400, code: "SLOT_NOT_BOOKABLE", message: "This product doesn't take calendar bookings." } as const;
        }
        const check = await checkSlot(run, {
          productId,
          availability: curInfo.availability,
          durationMin: curInfo.durationMin,
          startUtc,
          buyerUserId: req.userId!,
          buyerTz,
          now,
        });
        if (!check.ok) {
          return {
            ok: false,
            status: check.code === "SLOT_NOT_OFFERED" ? 400 : 409,
            code: check.code, message: check.message,
          } as const;
        }
        const inserted = await run.execute(sql`
          INSERT INTO store_orders
            (buyer_user_id, profile_id, product_id, product_title, product_kind,
             quantity, amount_cents, discount_code, platform_fee_cents,
             creator_amount_cents, stripe_session_id, status, fulfillment_note)
          VALUES (${req.userId!}, ${prod.profile_id}, ${prod.id}, ${prod.title}, 'service',
                  1, ${lineTotal}, ${discountCode}, ${feeCents},
                  ${creatorCents}, NULL, 'booking_held', ${encodeBookingNote(check.record)})
          RETURNING id
        `);
        const hid = String((inserted.rows[0] as Record<string, unknown>)["id"]);
        /* Hardened dual-write (no-op pre-migration): the service_bookings
           row is the DB-level slot claim. If the DB guard refuses it
           (BookingSlotConflictError), the hold is voided EXPLICITLY —
           deleted in this same transaction — rather than by relying on
           rollback: the loser walks away with SLOT_TAKEN and no order,
           on every engine. */
        try {
          await placeServiceBooking(run, {
            orderId: hid,
            productId,
            profileId: prod.profile_id,
            buyerUserId: req.userId!,
            record: check.record,
            holdExpiresAt: new Date(now.getTime() + BOOKING_HOLD_TTL_MIN * 60_000),
            now,
          });
        } catch (err) {
          if (err instanceof BookingSlotConflictError) {
            await run.execute(sql`
              DELETE FROM store_orders WHERE id = ${hid} AND status = 'booking_held'
            `);
            return { ok: false, status: 409, code: "SLOT_TAKEN", message: err.message } as const;
          }
          throw err;
        }
        return { ok: true, holdId: hid, record: check.record } as const;
      }); }
      if (!holdResult.ok) {
        res.status(holdResult.status).json({ error: holdResult.code, message: holdResult.message });
        return;
      }
      bookingHold = { id: holdResult.holdId, record: holdResult.record };
    }

    /* Purchase sequence for the session idempotency key (see
       buildStorefrontCheckoutKey). A read failure throws into the
       catch below — no session is minted, so the failure is closed.
       The discount predicate is spelled out instead of IS NOT DISTINCT
       FROM — identical semantics, but the pg-mem test engine can parse
       it, which is what lets the checkout suites run at all. */
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
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(bookingHold
        ? { expires_at: Math.floor(Date.now() / 1000) + (BOOKING_HOLD_TTL_MIN + 5) * 60 }
        : {}),
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
            /* With a gift card in play the session charges only the
               amount still due, as one line — the order record (at
               verify) still carries the full gross and full fee. */
            unit_amount: giftCardAppliedCents > 0 ? cardDueCents : unitCents,
            product_data: {
              name: `${p.title} — ${p.artist_name}`,
              description:
                percentOff > 0
                  ? `${p.kind} · ${percentOff}% off with code ${discountCode}`
                  : `${p.kind} · Bow Down Visuals`,
              images: (p.media_urls ?? []).slice(0, 1),
            },
          },
          quantity: giftCardAppliedCents > 0 ? 1 : quantity,
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
        affiliate_code: affiliateCode ?? "",
        amount_cents: String(grandTotal),
        platform_fee_cents: String(feeCents),
        creator_amount_cents: String(creatorCents),
        event_id: p.event_id ?? "",
        ...(bookingHold
          ? {
              booking_start_utc: bookingHold.record.s,
              booking_end_utc: bookingHold.record.e,
              buyer_timezone: bookingHold.record.btz,
            }
          : {}),
        /* Bump line (feature #13): verify re-derives every split from
           the session total + this amount — these are the only two
           bump facts it trusts, and both were written by this box. */
        bump_product_id: bump?.target.id ?? "",
        bump_amount_cents: String(bump?.grossCents ?? 0),
        gift_card_reservation_id: giftReservationId ?? "",
        gift_card_applied_cents: String(giftCardAppliedCents),
      },
      }, { idempotencyKey });
    } catch (err) {
      /* No session, no sale: release the hold immediately so the slot
         goes back on the calendar instead of waiting out the TTL. */
      if (bookingHold) {
        const cancelled: BookingRecord = {
          ...bookingHold.record, st: "cancelled",
          cx: new Date().toISOString(), rf: "not_required",
        };
        await db.execute(sql`
          UPDATE store_orders
          SET status = 'cancelled', fulfillment_note = ${encodeBookingNote(cancelled)}
          WHERE id = ${bookingHold.id} AND status = 'booking_held'
        `).catch(() => undefined);
        /* Free the hardened slot claim too (no-op pre-migration). */
        await cancelServiceBooking(db, bookingHold.id).catch(() => undefined);
      }
      /* Same no-session cleanup for the gift-card hold (feature #26):
         release it at once instead of waiting out its expiry. */
      if (giftReservationId) await releaseReservation(giftReservationId).catch(() => undefined);
      throw err;
    }


    if (bookingHold) {
      await db.execute(sql`
        UPDATE store_orders SET stripe_session_id = ${session.id}
        WHERE id = ${bookingHold.id} AND status = 'booking_held'
      `);
    }

    logger.info(
      { userId: req.userId, productId, quantity, lineTotal, grandTotal, bumpProductId: bump?.target.id ?? null, sessionId: session.id, discountCode, giftCardAppliedCents },
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
        giftCardAppliedCents, giftCardLast4,
        amountDueCents: grandTotal - giftCardAppliedCents, amountDue: money(grandTotal - giftCardAppliedCents),
        platformFeeCents: feeCents, creatorCents,
      },
      ...(bookingHold
        ? {
            booking: {
              startUtc: bookingHold.record.s,
              endUtc: bookingHold.record.e,
              timezone: bookingHold.record.ctz,
              holdExpiresAt: new Date(Date.now() + BOOKING_HOLD_TTL_MIN * 60_000).toISOString(),
            },
          }
        : {}),
      affiliate: affiliateCode ? { code: affiliateCode } : null,
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
  const affiliateCode = meta["affiliate_code"] || null;
  const eventId = meta["event_id"] || null;
  if (!productId || !profileId) {
    res.status(400).json({ error: "This session is missing its purchase details." });
    return;
  }
  /* Gift-card tender (feature #26): the session charged only the
     amount still due; the sale's gross is due + tender, and the fee
     splits the GROSS — tender is payment, never a fee discount
     (lib/gift-cards.ts). The reservation settles further down. */
  const giftCardAppliedCents = Math.max(0, parseInt(meta["gift_card_applied_cents"] ?? "0", 10) || 0);
  const giftReservationId = meta["gift_card_reservation_id"] || null;
  const amountCents = (session.amount_total ?? Number(meta["amount_cents"] ?? 0)) + giftCardAppliedCents;
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
               platform_fee_cents, creator_amount_cents, fulfillment_note, status, created_at,
               bump_product_id, bump_title, bump_amount_cents,
               bump_platform_fee_cents, bump_creator_amount_cents
        FROM store_orders WHERE stripe_session_id = ${sessionId} LIMIT 1
      `);
    } catch {
      existing = await db.execute(sql`
        SELECT id, product_id, product_title, product_kind, quantity, amount_cents,
               platform_fee_cents, creator_amount_cents, fulfillment_note, status, created_at
        FROM store_orders WHERE stripe_session_id = ${sessionId} LIMIT 1
      `);
    }
    let orderId: string;
    let duplicate = false;
    let fulfillmentNote: string | null = null;
    let confirmedBooking: BookingRecord | null = null;
    let mainTitle = "Store product";
    let recordedBump: { productId: string; title: string; grossCents: number } | null = null;
    let bumpDeliverable = false;
    /* Affiliate commission recorded with THIS order (#16) — stays null
       on duplicates: a replayed verify never records a second one. */
    let affiliateCommission: { recorded: boolean; commissionCents: number } | null = null;
    if (existing.rows.length > 0) {
      const er = existing.rows[0] as Record<string, unknown>;
      orderId = String(er["id"]);
      fulfillmentNote = (er["fulfillment_note"] as string | null) ?? null;
      const heldRec = decodeBookingNote(fulfillmentNote);
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
      if (String(er["status"]) === "booking_held" && heldRec) {
        /* ── Booking confirmation: the row already exists as the checkout
           HOLD. Flip it to a confirmed booking in place — never a second
           order row for one payment. ── */
        const bp = await fetchProduct(productId, false);
        if (bp && Number(bp.inventory) >= 0) {
          const claimed = await db.execute(sql`
            UPDATE store_products
            SET inventory = inventory - ${quantity}, updated_at = now()
            WHERE id = ${productId} AND inventory >= ${quantity}
            RETURNING id
          `);
          if (claimed.rows.length === 0) {
            logger.error({ sessionId, productId }, "[storefront] verify: booking inventory claim failed after payment");
            res.status(409).json({
              error: "SOLD_OUT_AFTER_PAYMENT",
              message: "Payment went through but the item just sold out — contact the creator for a refund or restock.",
            });
            return;
          }
        }
        const confirmed: BookingRecord = { ...heldRec, st: "confirmed" };
        fulfillmentNote = withBookingState(fulfillmentNote, confirmed);
        await db.execute(sql`
          UPDATE store_orders
          SET status = 'completed', fulfillment_note = ${fulfillmentNote},
              amount_cents = ${amountCents}, platform_fee_cents = ${feeCents},
              creator_amount_cents = ${creatorCents}
          WHERE id = ${orderId}
        `);
        /* Hardened dual-write: flip the slot claim held → confirmed. A
           "conflict" outcome means the hold lapsed and the slot was
           re-sold — the paid booking is still honored (existing rule);
           the clash check below surfaces it to the creator. A failure
           here must never fail a completed payment, so it is logged,
           not thrown. */
        const sbConfirm = await confirmServiceBooking(db, orderId).catch((e) => {
          logger.error({ err: e, orderId }, "[storefront] verify: service_bookings confirm failed");
          return "missing" as const;
        });
        if (sbConfirm === "conflict") {
          logger.warn({ orderId, sessionId }, "[storefront] verify: hardened slot already re-sold after hold lapse — honoring paid booking, clash notice follows");
        }
        confirmedBooking = confirmed;
        if (discountCode) {
          await db.execute(sql`
            UPDATE discount_codes
            SET used_count = used_count + 1
            WHERE profile_id = ${profileId}
              AND UPPER(code) = ${discountCode.toUpperCase()}
              AND (max_uses = -1 OR used_count < max_uses)
          `);
        }
        const creatorId = await creatorUserId(db, profileId);
        if (creatorId) {
          await notifyBookingParty(db, {
            userId: creatorId,
            jobType: "storefront_service_booking",
            jobId: orderId,
            title: `New booking: ${bp?.title ?? "Service"}`,
            message: `Someone just booked "${bp?.title ?? "your service"}" (${money(amountCents)}) — ${bookingHumanLine(confirmed)}.`,
          });
          /* Hold-expiry edge: the payment completed after the hold lapsed
             and another confirmed booking now overlaps. The paid booking
             is honored (money was taken) — the creator hears about the
             clash from us, never discovers it silently. */
          const ranges = await fetchTakenRanges(db, productId, new Date());
          const others = ranges.filter((r) => !(r.startUtc === confirmed.s && r.endUtc === confirmed.e));
          const clash = others.some(
            (r) => Date.parse(r.startUtc) < Date.parse(confirmed.e) && Date.parse(confirmed.s) < Date.parse(r.endUtc),
          );
          if (clash) {
            await notifyBookingParty(db, {
              userId: creatorId,
              jobType: "storefront_booking_conflict",
              jobId: `${orderId}:conflict`,
              title: `Booking clash: ${bp?.title ?? "Service"}`,
              message: `Two paid bookings overlap at ${bookingHumanLine(confirmed)} — one paid after its hold expired. Reach out to one buyer to move their slot.`,
            });
          }
        }
        logger.info({ sessionId, orderId, kind }, "[storefront] booking confirmed from hold");
      } else {
        duplicate = true;
        confirmedBooking = heldRec;
        logger.info({ sessionId, orderId }, "[storefront] verify: duplicate ignored");
      }
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

        /* Affiliate commission (#16) — recorded exactly-once with the
           order insert, out of the creator's cut (creatorCents above is
           gross − the flat 5% fee; the commission is a % of THAT). The
           buyer's total and the platform fee are untouched. Safely =
           a ledger failure never fails a paid order. Self-referral
           (buyer == affiliate) records nothing — lib/affiliates owns
           the discipline. */
        if (affiliateCode) {
          const aff = await recordAffiliateSaleSafely({
            code: affiliateCode,
            surface: "store_product",
            productId,
            productTitle,
            orderRef: sessionId,
            buyerUserId: req.userId!,
            grossCents: amountCents,
            platformFeeCents: feeCents,
          });
          affiliateCommission = {
            recorded: aff.recorded,
            commissionCents: aff.recorded ? aff.commissionCents : 0,
          };
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
          /* A booking session normally leaves a HOLD row that verify
             confirms in place (above). If the hold is somehow missing,
             the session metadata still carries the slot — stamp the
             booking onto this fresh order instead of losing it. */
          const metaBookingStart = meta["booking_start_utc"];
          let notifyMessage = `Someone just booked "${productTitle}" (${money(amountCents)}). Confirm their slot from your store dashboard.`;
          if (metaBookingStart) {
            const bp = await fetchProduct(productId, false);
            const bInfo = bookableInfo(bp?.service_details ?? null);
            const rec: BookingRecord = {
              v: 1,
              s: metaBookingStart,
              e: meta["booking_end_utc"] || metaBookingStart,
              ctz: bInfo.availability?.timezone ?? meta["buyer_timezone"] ?? "UTC",
              btz: meta["buyer_timezone"] ?? bInfo.availability?.timezone ?? "UTC",
              st: "confirmed",
            };
            fulfillmentNote = encodeBookingNote(rec);
            confirmedBooking = rec;
            notifyMessage = `Someone just booked "${productTitle}" (${money(amountCents)}) — ${bookingHumanLine(rec)}.`;
          } else {
            fulfillmentNote = "Booking request received — the creator confirms your slot from their dashboard.";
          }
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
                      ${notifyMessage})
              ON CONFLICT DO NOTHING
            `);
          }
        } else if (kind === "merch") {
          /* MERCH BOUNDARY: physical fulfillment lives in the existing merch
             system (merch_designs + print/dropship pipeline). We hand off —
             never rebuild fulfillment here. */
          fulfillmentNote = "Order received — the creator fulfills it through their merch/print pipeline.";
        } else if (kind === "course") {
          /* Creator Courses: the completed order IS the unlock (the
             Paid Series pattern on this rail) — no file, no token.
             Lessons wait in My Courses in the Academy. */
          fulfillmentNote = "Course unlocked — find it under My Courses in the Academy. Your progress is saved as you go.";
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
        /* Hardened dual-write for the hold-missing path (no-op
           pre-migration): record the confirmed slot claim. Best-effort
           — the payment completed; a conflict is logged loudly, never
           silently dropped and never a failed verify. */
        if (confirmedBooking && kind === "service") {
          await placeServiceBooking(db, {
            orderId,
            productId,
            profileId,
            buyerUserId: req.userId!,
            record: confirmedBooking,
          }).catch((e) => {
            logger.error({ err: e, orderId, sessionId }, "[storefront] verify: service_bookings place failed for metadata booking");
          });
        }
        logger.info({ sessionId, orderId, kind, amountCents }, "[storefront] order recorded");
      }
    }

    /* Settle the gift-card hold against this order. Idempotent by
       design (redeem:{reservationId}): a duplicate verify replays it
       harmlessly, and a first verify that died between the order
       insert and here is healed by the second. A failure logs LOUD —
       the order stands (the buyer paid), and the ledger key tells
       support exactly what to reconcile. */
    if (giftReservationId) {
      const redeemed = await redeemReservation({ reservationId: giftReservationId, ref: orderId }).catch((e) => {
        logger.error({ err: e, orderId, giftReservationId }, "[storefront] gift-card redeem threw");
        return null;
      });
      if (!redeemed) {
        logger.error({ orderId, giftReservationId }, "[storefront] gift-card redeem failed after order record — needs reconciliation");
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
        giftCardAppliedCents,
        giftCardApplied: money(giftCardAppliedCents),
        fulfillmentNote,
        booking: confirmedBooking,
        lines,
        /* #16: present only when this order carried an affiliate code;
           recorded=false with 0 = the code earned nothing (e.g. the
           buyer was the affiliate themselves). */
        affiliate: affiliateCode
          ? { code: affiliateCode, commissionRecorded: affiliateCommission?.recorded ?? false, commissionCents: affiliateCommission?.commissionCents ?? 0 }
          : null,
      },
      delivery,
      bumpDelivery,
      /* Link graph: no dead ends after payment — the highest-trust moment. */
      links: {
        productUrl: p ? `/storefront/product/${p.id}` : null,
        creatorUrl: p ? `/artist/${p.artist_slug}` : null,
        learnUrl: kind === "course" ? "/academy?tab=courses" : null,
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
  /* Bookable $0 services: the picked open slot (UTC ISO) + buyer tz. */
  bookingStartUtc: z.string().datetime().optional(),
  buyerTimezone: z.string().trim().min(1).max(64).optional(),
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
    /* Timed drop gate (#25): a free product on an upcoming drop is
       claimed at the drop moment, not before. */
    const claimDrop = dropState(await loadDropForProduct(productId));
    if (claimDrop.isUpcoming) {
      res.status(400).json({
        error: "DROP_NOT_LIVE",
        message: "This product drops soon — join the drop list on its page and you'll get one email the moment it's live.",
        dropAt: claimDrop.dropAt,
      });
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

    /* Bookable $0 service: the claim IS the booking — validate the picked
       slot now (grid + taken, unlocked read), and again under the product
       lock at insert time. A failed slot check happens BEFORE the email
       exchange, so a fan never subscribes for a booking they didn't get. */
    const claimBookInfo = bookableInfo(p.service_details);
    let claimBookingStart: Date | null = null;
    let claimBuyerTz = "";
    if (parsed.data.bookingStartUtc && (!claimBookInfo.bookable || kind !== "service")) {
      res.status(400).json({ error: "SLOT_NOT_BOOKABLE", message: "This product doesn't take calendar bookings." });
      return;
    }
    if (claimBookInfo.bookable && kind === "service") {
      if (!parsed.data.bookingStartUtc) {
        res.status(400).json({
          error: "BOOKING_REQUIRED",
          message: "Pick a time first — this service is booked on the creator's calendar.",
          slotsEndpoint: `/api/storefront/product/${p.id}/slots`,
        });
        return;
      }
      claimBookingStart = new Date(parsed.data.bookingStartUtc);
      if (Number.isNaN(claimBookingStart.getTime())) {
        res.status(400).json({ error: "Invalid booking time." });
        return;
      }
      claimBuyerTz =
        parsed.data.buyerTimezone && isValidTimeZone(parsed.data.buyerTimezone)
          ? parsed.data.buyerTimezone
          : claimBookInfo.availability!.timezone;
      const preCheck = await checkSlot(db, {
        productId,
        availability: claimBookInfo.availability!,
        durationMin: claimBookInfo.durationMin,
        startUtc: claimBookingStart,
        buyerUserId: req.userId!,
        buyerTz: claimBuyerTz,
        now: new Date(),
      });
      if (!preCheck.ok && preCheck.code !== "SLOT_HELD_BY_YOU") {
        /* SLOT_HELD_BY_YOU can't occur on the claim rail (no holds are
           placed here). One SLOT_TAKEN is not a refusal either: the slot
           may be blocked by the claimer's OWN confirmed claim — a
           re-claim of it is a duplicate, and the duplicate return below
           hands back the same order. Everything else is a real refusal. */
        const ownClaim = preCheck.code === "SLOT_TAKEN"
          ? await findOwnClaimAtSlot(db, {
              buyerUserId: req.userId!, productId, startUtc: claimBookingStart,
            })
          : null;
        if (!ownClaim) {
          res.status(preCheck.code === "SLOT_NOT_OFFERED" ? 400 : 409).json({
            error: preCheck.code, message: preCheck.message,
          });
          return;
        }
      }
    }

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
      learnUrl: kind === "course" ? "/academy?tab=courses" : null,
      eventUrl: eventId ? `/shows#event-${eventId}` : null,
      purchasesEndpoint: "/api/storefront/orders/purchases",
    };
    const claimNote = `Free product — no payment was taken and no checkout was opened. Your email joined ${p.artist_name}'s list (“${listName}”) — that's the exchange for the freebie, and every email from it carries an unsubscribe link.`;

    /* Already claimed: the same order comes back with a fresh
       delivery link — delivered once, never twice. For a bookable claim,
       "already claimed" means the SAME slot — a different open slot is a
       second, legitimate booking. */
    const existingOrder = await db.execute(
      claimBookingStart
        ? sql`
            SELECT id, fulfillment_note FROM store_orders
            WHERE buyer_user_id = ${req.userId!} AND product_id = ${productId}
              AND stripe_session_id IS NULL AND status = 'completed'
              AND fulfillment_note LIKE '%⟦bk1:%'
            ORDER BY created_at ASC`
        : sql`
            SELECT id, fulfillment_note FROM store_orders
            WHERE buyer_user_id = ${req.userId!} AND product_id = ${productId}
              AND stripe_session_id IS NULL AND status = 'completed'
            ORDER BY created_at ASC LIMIT 1`,
    );
    let dupRow: Record<string, unknown> | null = null;
    let duplicateBooking: BookingRecord | null = null;
    for (const row of existingOrder.rows as Array<Record<string, unknown>>) {
      if (!claimBookingStart) {
        dupRow = row;
        break;
      }
      const rec = decodeBookingNote(row["fulfillment_note"] as string | null);
      if (rec && rec.s === claimBookingStart.toISOString() && rec.st !== "cancelled") {
        dupRow = row;
        duplicateBooking = rec;
        break;
      }
    }
    if (dupRow) {
      const er = dupRow;
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
          booking: duplicateBooking,
        },
        delivery: await buildDelivery(orderId),
        subscribed: { email, listName, alreadySubscribed },
        links: claimLinks,
        note: claimNote,
      });
      return;
    }

    let orderId: string;
    let claimedBooking: BookingRecord | null = null;
    if (claimBookingStart) {
      /* Bookable claim: re-validate the slot + insert atomically under
         the product lock (the earlier check was an unlocked read; this
         one is binding). A free booking confirms immediately — there is
         no payment step to wait for. */
      const txResult = await db.transaction(async (tx) => {
        const run = tx as unknown as SqlRunner;
        await lockProductRow(run, productId);
        if (inventory > 0) {
          const claimed = await run.execute(sql`
            UPDATE store_products
            SET inventory = inventory - 1, updated_at = now()
            WHERE id = ${productId} AND inventory >= 1
            RETURNING id
          `);
          if (claimed.rows.length === 0) {
            return { error: "SOLD_OUT", message: "This one just sold out — the creator's restocking." } as const;
          }
        }
        const cur = await run.execute(sql`
          SELECT service_details FROM store_products WHERE id = ${productId} LIMIT 1
        `);
        const curInfo = bookableInfo(
          (cur.rows[0] as Record<string, unknown> | undefined)?.["service_details"] as Record<string, unknown> | null,
        );
        if (!curInfo.bookable || !curInfo.availability) {
          return { error: "SLOT_NOT_BOOKABLE", message: "This product doesn't take calendar bookings." } as const;
        }
        const check = await checkSlot(run, {
          productId,
          availability: curInfo.availability,
          durationMin: curInfo.durationMin,
          startUtc: claimBookingStart,
          buyerUserId: req.userId!,
          buyerTz: claimBuyerTz,
          now: new Date(),
        });
        if (!check.ok) return { error: check.code, message: check.message } as const;
        const rec: BookingRecord = { ...check.record, st: "confirmed" };
        const inserted = await run.execute(sql`
          INSERT INTO store_orders
            (buyer_user_id, profile_id, product_id, product_title, product_kind,
             quantity, amount_cents, discount_code, platform_fee_cents,
             creator_amount_cents, stripe_session_id, status, fulfillment_note)
          VALUES (${req.userId!}, ${p.profile_id}, ${productId}, ${p.title}, 'service',
                  1, 0, NULL, 0, 0, NULL, 'completed', ${encodeBookingNote(rec)})
          RETURNING id
        `);
        const newOrderId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
        /* Hardened dual-write (no-op pre-migration): the confirmed slot
           claim. If the DB guard refuses it, the claim is unwound
           EXPLICITLY in this transaction (order deleted, the in-tx
           inventory claim restored) instead of relying on rollback,
           and the buyer gets the same SLOT_TAKEN as any lost race. */
        try {
          await placeServiceBooking(run, {
            orderId: newOrderId,
            productId,
            profileId: p.profile_id,
            buyerUserId: req.userId!,
            record: rec,
          });
        } catch (err) {
          if (err instanceof BookingSlotConflictError) {
            await run.execute(sql`DELETE FROM store_orders WHERE id = ${newOrderId}`);
            if (inventory > 0) {
              await run.execute(sql`
                UPDATE store_products SET inventory = inventory + 1, updated_at = now()
                WHERE id = ${productId}
              `);
            }
            return { error: "SLOT_TAKEN", message: err.message } as const;
          }
          throw err;
        }
        return { orderId: newOrderId, record: rec } as const;
      });
      if ("error" in txResult) {
        const status =
          txResult.error === "SLOT_NOT_OFFERED" || txResult.error === "SLOT_NOT_BOOKABLE" || txResult.error === "SOLD_OUT"
            ? 400
            : 409;
        res.status(status).json({ error: txResult.error, message: txResult.message });
        return;
      }
      orderId = txResult.orderId;
      claimedBooking = txResult.record;
    } else {
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
      orderId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
    }

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
      fulfillmentNote = claimedBooking
        ? encodeBookingNote(claimedBooking)
        : "Booking request received — the creator confirms your slot from their dashboard.";
      if (creatorUserId) {
        await db.execute(sql`
          INSERT INTO job_notifications (job_type, job_id, user_id, status, title, message)
          VALUES ('storefront_service_booking', ${orderId}, ${creatorUserId},
                  'completed', ${`New booking: ${p.title}`},
                  ${claimedBooking
                    ? `Someone just booked "${p.title}" (free) — ${bookingHumanLine(claimedBooking)}.`
                    : `Someone just claimed "${p.title}" (free). Confirm their slot from your store dashboard.`})
          ON CONFLICT DO NOTHING
        `);
      }
    } else if (kind === "merch") {
      /* MERCH BOUNDARY: physical fulfillment lives in the merch system. */
      fulfillmentNote = "Order received — the creator fulfills it through their merch/print pipeline.";
    } else if (kind === "course") {
      /* Free course: the completed $0 claim order is the unlock. */
      fulfillmentNote = "Course unlocked — find it under My Courses in the Academy. Your progress is saved as you go.";
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
        booking: claimedBooking,
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
  const booking = decodeBookingNote((r["fulfillment_note"] as string | null) ?? null);
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
    /* Calendar bookings: the slot record + its derived lifecycle status
       (upcoming / done / cancelled / held). Null for non-booking orders. */
    booking,
    bookingStatus: booking ? deriveBookingStatus(booking, String(r["status"])) : null,
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

/* ═══════════════════ BOOKINGS (buyer + seller list) ══════════════════
   Every calendar booking where the caller is the buyer OR the seller:
   upcoming first, then done, then cancelled. Slot instants are UTC; the
   record carries both timezones so each side renders in their own. */
router.get("/storefront/bookings", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    const r = await db.execute(sql`
      SELECT o.id, o.product_id, o.product_title, o.product_kind, o.quantity,
             o.amount_cents, o.discount_code, o.platform_fee_cents,
             o.creator_amount_cents, o.status, o.fulfillment_note, o.created_at,
             o.profile_id, o.buyer_user_id,
             cp.display_name AS seller_name, cp.slug AS seller_slug
      FROM store_orders o
      LEFT JOIN creator_profiles cp ON cp.id = o.profile_id
      WHERE o.product_kind = 'service'
        AND o.fulfillment_note LIKE '%⟦bk1:%'
        AND (o.buyer_user_id = ${req.userId!} ${profile ? sql`OR o.profile_id = ${profile.id}` : sql``})
      ORDER BY o.created_at DESC
      LIMIT 500
    `);
    const now = new Date();
    const bookings = (r.rows as Array<Record<string, unknown>>)
      .map((row) => {
        const rec = decodeBookingNote(row["fulfillment_note"] as string | null);
        if (!rec) return null;
        const role = String(row["buyer_user_id"]) === req.userId ? "buyer" : "seller";
        const status = deriveBookingStatus(rec, String(row["status"]), now);
        return {
          orderId: String(row["id"]),
          role,
          productId: row["product_id"] ? String(row["product_id"]) : null,
          productTitle: String(row["product_title"] ?? "Service"),
          sellerName: (row["seller_name"] as string | null) ?? null,
          sellerSlug: (row["seller_slug"] as string | null) ?? null,
          amountCents: Number(row["amount_cents"]),
          amount: money(Number(row["amount_cents"])),
          startUtc: rec.s,
          endUtc: rec.e,
          creatorTimezone: rec.ctz,
          buyerTimezone: rec.btz,
          status,
          cancelledBy: rec.ca ?? null,
          refundState: rec.rf ?? null,
          bookedAt: String(row["created_at"]),
          links: {
            productUrl: row["product_id"] ? `/storefront/product/${row["product_id"]}` : null,
            creatorUrl: row["seller_slug"] ? `/artist/${row["seller_slug"]}` : null,
          },
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    const rank = { upcoming: 0, held: 0, done: 1, cancelled: 2 } as const;
    bookings.sort((a, b) => {
      const d = rank[a.status] - rank[b.status];
      if (d !== 0) return d;
      return a.status === "upcoming" || a.status === "held"
        ? a.startUtc.localeCompare(b.startUtc)
        : b.startUtc.localeCompare(a.startUtc);
    });
    res.json({
      bookings,
      counts: {
        upcoming: bookings.filter((b) => b.status === "upcoming" || b.status === "held").length,
        done: bookings.filter((b) => b.status === "done").length,
        cancelled: bookings.filter((b) => b.status === "cancelled").length,
      },
      note: "Times are shown in your own timezone. Cancelling a paid booking refunds the buyer in full through Stripe.",
    });
  } catch (err) {
    logger.error({ err }, "[storefront] bookings list failed");
    res.status(500).json({ error: "Could not load your bookings." });
  }
});

/* ═══════════════════ BOOKING CANCEL (either side) ════════════════════
   Buyer or seller cancels a calendar booking. Paid bookings refund IN
   FULL through Stripe (the same rail + idempotency shape as routes/
   store.ts), following the storefront's existing full-refund posture.
   Money states stay honest: the order only reads 'refunded' when Stripe
   confirmed the refund; a failed refund still cancels the slot and the
   record says refund_failed — it never claims money moved when it
   didn't. The freed slot returns to the calendar immediately. */
router.post("/storefront/orders/:id/booking-cancel", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid order id." });
    return;
  }
  try {
    const o = await db.execute(sql`
      SELECT o.id, o.buyer_user_id, o.profile_id, o.product_id, o.product_title,
             o.amount_cents, o.status, o.fulfillment_note, o.stripe_session_id,
             cp.user_id AS seller_user_id, cp.display_name AS seller_name
      FROM store_orders o
      LEFT JOIN creator_profiles cp ON cp.id = o.profile_id
      WHERE o.id = ${id} LIMIT 1
    `);
    const row = o.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const rec = decodeBookingNote(row["fulfillment_note"] as string | null);
    if (!rec) {
      res.status(400).json({
        error: "NOT_A_BOOKING",
        message: "This order isn't a calendar booking — service requests are handled with confirm/decline instead.",
      });
      return;
    }
    const isBuyer = String(row["buyer_user_id"]) === req.userId;
    const isSeller = row["seller_user_id"] ? String(row["seller_user_id"]) === req.userId : false;
    if (!isBuyer && !isSeller) {
      res.status(403).json({ error: "Not your booking." });
      return;
    }
    const status = deriveBookingStatus(rec, String(row["status"]));
    if (status === "cancelled") {
      res.json({ ok: true, alreadyCancelled: true, bookingStatus: "cancelled", refundState: rec.rf ?? null });
      return;
    }
    if (status === "done") {
      res.status(400).json({ error: "BOOKING_DONE", message: "This session already happened — it can't be cancelled." });
      return;
    }

    /* Money first for paid bookings: refund through Stripe before the
       state flips, so a Stripe outage never strands a "cancelled" paid
       booking with the money still held. A HELD booking was never paid —
       cancelling it just releases the hold. */
    const amountCents = Number(row["amount_cents"]);
    const sessionId = (row["stripe_session_id"] as string | null) ?? null;
    let refundState: BookingRecord["rf"] = "not_required";
    if (status === "held") {
      refundState = "not_required";
    } else if (amountCents > 0 && sessionId) {
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({ error: "Payments are not configured — the booking was not cancelled." });
        return;
      }
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const pi = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
        if (!pi) throw new Error("no payment_intent on session");
        await stripe.refunds.create(
          { payment_intent: pi },
          { idempotencyKey: `refund:${sessionId}` },
        );
        refundState = "refunded";
      } catch (err) {
        logger.error({ err, orderId: id, sessionId }, "[storefront] booking refund failed — cancelling with refund_failed marker");
        refundState = "refund_failed";
      }
    }

    const cancelled: BookingRecord = {
      ...rec,
      st: "cancelled",
      ca: isBuyer ? "buyer" : "creator",
      cx: new Date().toISOString(),
      rf: refundState,
    };
    const newStatus = refundState === "refunded" ? "refunded" : "cancelled";
    const upd = await db.execute(sql`
      UPDATE store_orders
      SET status = ${newStatus}, fulfillment_note = ${encodeBookingNote(cancelled)}
      WHERE id = ${id} AND status IN ('completed', 'booking_held')
      RETURNING id
    `);
    if (upd.rows.length === 0) {
      /* Lost a race with the other side's cancel — report the truth. */
      res.json({ ok: true, alreadyCancelled: true, bookingStatus: "cancelled", refundState });
      return;
    }
    /* Free the hardened slot claim too (no-op pre-migration; best-effort
       — the trailer-cancel veto in fetchTakenRanges frees the slot in
       reads even if this write ever missed). */
    await cancelServiceBooking(db, id).catch((e) =>
      logger.error({ err: e, orderId: id }, "[storefront] booking-cancel: service_bookings cancel failed"),
    );

    /* Tell the other side. */
    const otherUserId = isBuyer
      ? (row["seller_user_id"] ? String(row["seller_user_id"]) : null)
      : String(row["buyer_user_id"]);
    if (otherUserId) {
      await notifyBookingParty(db, {
        userId: otherUserId,
        jobType: "storefront_booking_cancelled",
        jobId: id,
        title: `Booking cancelled: ${String(row["product_title"] ?? "Service")}`,
        message: isBuyer
          ? `Your buyer cancelled "${String(row["product_title"] ?? "the session")}" — ${bookingHumanLine(rec)}.${refundState === "refunded" ? " They were refunded in full." : ""}`
          : `The creator cancelled "${String(row["product_title"] ?? "the session")}" — ${bookingHumanLine(rec)}.${refundState === "refunded" ? " You were refunded in full." : refundState === "refund_failed" ? " The refund could not be processed automatically — contact support." : ""}`,
      });
    }
    logger.info({ orderId: id, by: isBuyer ? "buyer" : "creator", refundState }, "[storefront] booking cancelled");
    res.json({
      ok: true,
      bookingStatus: "cancelled",
      refundState,
      refunded: refundState === "refunded",
      message:
        refundState === "refunded"
          ? "Booking cancelled — the buyer was refunded in full."
          : refundState === "refund_failed"
            ? "Booking cancelled, but the automatic refund failed — support has the record and will make it right."
            : "Booking cancelled.",
    });
  } catch (err) {
    logger.error({ err, id }, "[storefront] booking cancel failed");
    res.status(500).json({ error: "Could not cancel this booking." });
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
    /* Calendar bookings never pass through here: this UPDATE would wipe
       the booking trailer (slot times live in the note). A booked order
       is confirmed by payment itself and cancelled via booking-cancel. */
    const existingOrder = await db.execute(sql`
      SELECT fulfillment_note FROM store_orders
      WHERE id = ${id} AND profile_id = ${profile.id} AND product_kind = 'service'
      LIMIT 1
    `);
    const erow = existingOrder.rows[0] as Record<string, unknown> | undefined;
    if (erow && decodeBookingNote(erow["fulfillment_note"] as string | null)) {
      res.status(400).json({
        error: "USE_BOOKING_CANCEL",
        message: "This is a calendar booking — it's confirmed by payment. To change it, cancel the booking (the buyer is refunded in full).",
      });
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

/* ═══════════════════ TIMED DROPS (#25) ═══════════════════════════════
   Dock: PROMOTE — a drop hangs off the storefront product itself. The
   creator schedules/cancels it from the product's row in the store
   dashboard (PUT/DELETE …/drop); fans meet it on the product's own
   public page, which renders the countdown + capture while the drop is
   upcoming. No standalone drop page, no parallel email list: captures
   subscribe the fan to the creator's existing email list (source
   'drop') and the drop-day email rides the house sender exactly once
   (lib/product-drop-notify.ts). Times are UTC instants end to end —
   dropAt is an ISO string the client renders in local time. */

const DropScheduleSchema = z.object({
  /* ISO 8601 instant (with offset, normally Z). Stored as timestamptz. */
  dropAt: z.string().trim().min(1).max(64),
});

const DROP_UNAVAILABLE = {
  error: "drop_unavailable",
  message: "Drops aren't switched on yet — try again in a bit.",
} as const;

router.put("/storefront/products/:id/drop", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid product id." }); return; }
  const parsed = DropScheduleSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid drop.", details: parsed.error.issues }); return; }
  const dropAt = new Date(parsed.data.dropAt);
  if (!Number.isFinite(dropAt.getTime())) {
    res.status(400).json({ error: "DROP_DATE_INVALID", message: "Pick a real date and time for the drop." });
    return;
  }
  if (dropAt.getTime() <= Date.now()) {
    res.status(400).json({ error: "DROP_DATE_PAST", message: "A drop has to be in the future — pick a later moment." });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) { res.status(404).json({ error: "NO_PROFILE" }); return; }
    const p = await fetchProduct(id, false);
    if (!p || p.profile_id !== profile.id) { res.status(404).json({ error: "Product not found." }); return; }
    const existing = await loadDropForProduct(id);
    if (existing && dropState(existing).state === "live") {
      res.status(409).json({
        error: "DROP_ALREADY_LIVE",
        message: "This drop already went live. Cancel it first if you want to run a fresh drop for this product.",
      });
      return;
    }
    if (existing && existing.status === "cancelled") {
      /* A fresh cycle on the cancelled row: the old cycle's captures
         and delivery ledger belong to that drop, not this one. */
      await db.execute(sql`DELETE FROM product_drop_captures WHERE drop_id = ${existing.id}`);
      await db.execute(sql`DELETE FROM product_drop_deliveries WHERE drop_id = ${existing.id}`);
    }
    const dropId = existing ? String(existing.id) : randomUUID();
    if (existing) {
      await db.execute(sql`
        UPDATE product_drops
        SET drop_at = ${dropAt}, status = 'scheduled', notified_at = NULL, updated_at = now()
        WHERE id = ${existing.id}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO product_drops (id, product_id, profile_id, user_id, drop_at, status)
        VALUES (${dropId}, ${id}, ${profile.id}, ${req.userId!}, ${dropAt}, 'scheduled')
      `);
    }
    /* Scheduling a drop puts the product on its drop page: active, but
       gated by the drop computation on every public read until the
       moment arrives. */
    if (!p.is_active) {
      await db.execute(sql`UPDATE store_products SET is_active = true, updated_at = now() WHERE id = ${id}`);
    }
    const drop = await loadDropForProduct(id);
    logger.info({ userId: req.userId, productId: id, dropAt: dropAt.toISOString() }, "[storefront] product drop scheduled");
    res.json({ drop: drop ? { ...dropDto(drop), captureCount: await loadDropCaptureCount(String(drop.id)) } : null });
  } catch (err) {
    if (isMissingDropTables(err)) { res.status(503).json(DROP_UNAVAILABLE); return; }
    logger.error({ err, id }, "[storefront] drop schedule failed");
    res.status(500).json({ error: "Could not schedule this drop." });
  }
});

router.delete("/storefront/products/:id/drop", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid product id." }); return; }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) { res.status(404).json({ error: "NO_PROFILE" }); return; }
    const drop = await loadDropForProduct(id);
    if (!drop || String(drop.profile_id) !== profile.id) {
      res.status(404).json({ error: "No drop scheduled for this product." });
      return;
    }
    if (dropState(drop).state === "live") {
      res.status(409).json({ error: "DROP_ALREADY_LIVE", message: "This drop already went live — it's just a normal product now." });
      return;
    }
    await db.execute(sql`UPDATE product_drops SET status = 'cancelled', updated_at = now() WHERE id = ${drop.id}`);
    logger.info({ userId: req.userId, productId: id }, "[storefront] product drop cancelled");
    res.json({ ok: true, drop: null });
  } catch (err) {
    if (isMissingDropTables(err)) { res.status(503).json(DROP_UNAVAILABLE); return; }
    logger.error({ err, id }, "[storefront] drop cancel failed");
    res.status(500).json({ error: "Could not cancel this drop." });
  }
});

router.get("/storefront/products/:id/drop", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid product id." }); return; }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) { res.status(404).json({ error: "NO_PROFILE" }); return; }
    const p = await fetchProduct(id, false);
    if (!p || p.profile_id !== profile.id) { res.status(404).json({ error: "Product not found." }); return; }
    const drop = await loadDropForProduct(id);
    if (!drop || drop.status === "cancelled") { res.json({ drop: null, captures: [], captureCount: 0 }); return; }
    const capRes = await db.execute(sql`
      SELECT email, name, created_at FROM product_drop_captures
      WHERE drop_id = ${drop.id} ORDER BY created_at DESC LIMIT 50
    `);
    const captures = (capRes.rows as Array<Record<string, unknown>>).map((r) => ({
      email: String(r["email"]),
      name: r["name"] ? String(r["name"]) : null,
      capturedAt: new Date(r["created_at"] as string).toISOString(),
    }));
    res.json({
      drop: { ...dropDto(drop), captureCount: await loadDropCaptureCount(String(drop.id)) },
      captures,
      captureCount: await loadDropCaptureCount(String(drop.id)),
    });
  } catch (err) {
    if (isMissingDropTables(err)) { res.status(503).json(DROP_UNAVAILABLE); return; }
    logger.error({ err, id }, "[storefront] drop load failed");
    res.status(500).json({ error: "Could not load this drop." });
  }
});

const DropCaptureSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254),
  name: z.string().trim().max(120).optional().default(""),
});

router.post("/storefront/products/:id/drop/capture", publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid product id." }); return; }
  const parsed = DropCaptureSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address.", code: "invalid_email" });
    return;
  }
  try {
    const p = await fetchProduct(id, true);
    if (!p) { res.status(404).json({ error: "Product not found or no longer for sale." }); return; }
    const drop = await loadDropForProduct(id);
    const state = dropState(drop);
    if (!drop || state.state === "cancelled") {
      res.status(404).json({ error: "NO_DROP", message: "This product doesn't have a drop coming up." });
      return;
    }
    if (!state.isUpcoming) {
      res.status(409).json({
        error: "DROP_LIVE",
        message: "This one already dropped — it's live now, grab it while it's here.",
        dropAt: state.dropAt,
      });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    const name = parsed.data.name.trim();
    /* Idempotent capture: re-joining updates the name, never duplicates.
       (Existence is read first rather than the presave follow's xmax
       trick — same semantics, and the verification harness's engine
       has no xmax.) */
    const prior = await db.execute(sql`
      SELECT id FROM product_drop_captures WHERE drop_id = ${drop.id} AND email = ${email} LIMIT 1
    `);
    const inserted = prior.rows.length === 0;
    await db.execute(sql`
      INSERT INTO product_drop_captures (drop_id, product_id, email, name, source)
      VALUES (${drop.id}, ${id}, ${email}, ${name || null}, ${"drop"})
      ON CONFLICT (drop_id, email) DO UPDATE SET
        name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE product_drop_captures.name END
    `);
    /* Also join the creator's email list — the fan-list handoff, same
       as a presave follow. Non-fatal: the capture row is the drop's
       record; list trouble never loses a fan. */
    try {
      const list = await ensureDropCreatorList(String(drop.user_id), p.artist_name);
      await subscribeDropFan(list.id, email, name);
    } catch (err) {
      logger.warn({ err }, "[storefront] drop email-list subscribe failed (non-fatal)");
    }
    res.json({
      ok: true,
      alreadyCaptured: !inserted,
      captureCount: await loadDropCaptureCount(String(drop.id)),
      dropAt: state.dropAt,
    });
  } catch (err) {
    if (isMissingDropTables(err)) { res.status(503).json(DROP_UNAVAILABLE); return; }
    logger.error({ err, id }, "[storefront] drop capture failed");
    res.status(500).json({ error: "Couldn't join the drop list — try again." });
  }
});

export default router;
