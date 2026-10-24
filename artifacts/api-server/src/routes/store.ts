/**
 * store.ts — Creator Digital Store (sell your content).
 *
 * Creators sell ALL kinds of digital content, not just music: tracks, videos
 * (courses, exclusives), albums, sample packs, presets, templates, ebooks.
 * item_kind is an OPEN set ('track'|'video'|'album'|'pack'|'digital'); the
 * checkout, fee-split, delivery, and dashboard pipelines are kind-agnostic —
 * each catalog entity opts in by exposing download_price_cents + a file URL.
 *
 * Money rules (standing):
 *  - Platform fee: 5% of every sale, taken from the SELLER's cut — the buyer
 *    never pays extra. Reuses STOREFRONT_PLATFORM_FEE_BPS (same knob as
 *    customer storefronts) so the fee is identical site-wide; env-overridable.
 *  - Music/content SALES = real money via Stripe. Visual Bucs = AI credits.
 *    The two economies are NEVER mixed in UI copy or accounting.
 *  - Creator payouts need Stripe Connect — NOT built here. creator_amount_cents
 *    is tracked as a "pending payout" balance. Real-world follow-up: build
 *    Connect onboarding + payout ledger before paying anyone out.
 *
 * Endpoints:
 *   GET    /api/store/item/:kind/:id   public: item + fee split for the buy page
 *   POST   /api/store/checkout         auth: create a Stripe Checkout Session
 *   POST   /api/store/verify           auth: verify a paid session, record the
 *                                         sale idempotently, mint a download token
 *   GET    /api/store/download/:token  public: token-gated delivery page
 *                                         (48h expiry, max 5 downloads)
 *   GET    /api/store/purchases        auth: buyer's purchase history
 *   POST   /api/store/token            auth: mint a fresh download token for a
 *                                         sale the caller bought
 *   GET    /api/store/sales            auth: creator sales dashboard data
 *   POST   /api/store/log-to-tracker   auth: push a sale into the creator's
 *                                         Money Tracker as income (idempotent)
 *   POST   /api/store/bundles          auth: create a bundle (a playlists row
 *                                         with kind='bundle'; components are
 *                                         the seller's own sellable items)
 *   GET    /api/store/bundles          auth: seller's bundles + the sellable
 *                                         component catalog to build from
 *   PATCH  /api/store/bundles/:id      auth: edit a bundle (future sales only)
 *
 * Queries use raw SQL via db.execute(sql``) — pg-mem (vitest) cannot handle
 * the drizzle query builder's rowMode:'array'. (Same convention as
 * generate/storefronts.ts.)
 */
import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { createHmac, randomBytes } from "crypto";
import { db, DIGITAL_ITEM_KINDS } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { STOREFRONT_PLATFORM_FEE_BPS } from "./generate/storefronts";
import { createJobNotification } from "../lib/job-notifications";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../lib/stripe-client";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import { sendEmail, emailShell, money as emailMoney, escapeHtml, baseUrlForEmail } from "../lib/email";
import {
  GiftCardsUnavailable,
  findCardByCode,
  isGiftCardCodeShape,
  releaseExpiredReservations,
  reserveGiftCard,
  redeemReservation,
  releaseReservation,
  tenderFor,
} from "../lib/gift-cards";

const router = Router();

/* ── Platform economics ──────────────────────────────────────────────────
   5% platform fee (same knob as storefronts — one fee site-wide). Fee comes
   out of the seller's cut; the buyer pays the listed price, nothing extra. */
const PLATFORM_FEE_BPS = STOREFRONT_PLATFORM_FEE_BPS;
export const PLATFORM_FEE_PCT = PLATFORM_FEE_BPS / 100;

/* ── Download token rules ──────────────────────────────────────────────── */
const DOWNLOAD_TTL_HOURS = 48;
const DOWNLOAD_MAX_USES = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── Bundles (Stack-100 #3, feature #15) ─────────────────────────────────
   A bundle is a playlists row with kind='bundle': price_cents is the
   seller-set bundle price, items[] holds the components
   ({kind:'track'|'video'|'series', id} — the series item-ref shape,
   widened to series refs). The sale rides this rail as ONE digital_sales
   row so the flat 5% fee splits once, on the bundle total; component
   grants are recorded at verify (download links for tracks/videos, a
   completed $0 'series' sale row for a series — the row IS the unlock).

   'bundle' is carried in this LOCAL kind list because the prod
   digital_sales item_kind CHECK doesn't include it yet — the one
   migration this feature needs is written up in
   .lane/f15/migration-needed.md (0205). When it lands, this list
   collapses back to DIGITAL_ITEM_KINDS. */
export const BUNDLE_KIND = "bundle";
const STORE_ITEM_KINDS = [...DIGITAL_ITEM_KINDS, BUNDLE_KIND] as const;
const ItemKindSchema = z.enum(STORE_ITEM_KINDS);
export const BUNDLE_PRICE_MIN_CENTS = 50; /* the series card floor */
export const BUNDLE_PRICE_MAX_CENTS = 100_000_00;
export const BUNDLE_MIN_COMPONENTS = 2;
export const BUNDLE_MAX_COMPONENTS = 50;
/** Session-id infix marking a digital_sales row as a bundle component
    grant (see verify). The reversal engine flips these with the sale. */
export const BUNDLE_GRANT_INFIX = "#grant:";

function getStripe(): Stripe {
  /* Fail closed on live keys (Lane V3 F7) via the shared guard. */
  return createGuardedStripeClient();
}

/**
 * Deterministic Stripe idempotency key for a digital-store checkout.
 * The intent carries the buyer's completed-sale count for this exact
 * purchase (from digital_sales, the rail's completion record): a
 * double-submit before the sale is recorded still sees the same
 * count, so Stripe reuses the original session; after the sale lands,
 * the count advances and a repeat purchase gets a fresh key.
 */
export function buildStoreCheckoutKey(args: {
  userId: string;
  kind: string;
  itemId: string;
  amountCents: number;
  completedSaleCount: number;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.userId,
    rail: "digital-store",
    purchaseIntent: {
      kind: args.kind,
      itemId: args.itemId,
      amountCents: args.amountCents,
      completedSaleCount: args.completedSaleCount,
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
  return `$${(cents / 100).toFixed(2)}`;
}

function splitFee(amountCents: number): { feeCents: number; creatorCents: number } {
  const feeCents = Math.round((amountCents * PLATFORM_FEE_BPS) / 10_000);
  return { feeCents, creatorCents: amountCents - feeCents };
}

/* ── Token scheme ────────────────────────────────────────────────────────
   token = "<64 hex random>.<64 hex HMAC-SHA256(secret, random)>".
   Verified before the DB is even touched; the random part is looked up. */
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

/* ── Sellable catalog ────────────────────────────────────────────────────
   Which entities can be sold today. track → profile_tracks, video →
   profile_videos, series → playlists (kind='series', migration 0192 —
   the sale unlocks streaming access instead of delivering a file).
   album/pack/digital are valid store kinds (migration 0090) but their
   catalog entities haven't shipped yet — they 400 with a clear message
   instead of silently failing. */
/** One resolved bundle component: a sellable item of the bundle owner's,
    with the list price it would sell for on its own (the honest
    "bought separately" figure the savings math is shown against). */
export interface BundleComponent {
  kind: string;
  id: string;
  title: string;
  listPriceCents: number;
  fileUrl: string;
}

interface SellableItem {
  profileId: string;
  itemKind: string;
  title: string;
  priceCents: number;
  /* Name-your-price (0132): creator opt-in per item + their minimum. */
  pwywEnabled: boolean;
  pwywMinCents: number;
  fileUrl: string;
  artworkUrl: string | null;
  artistName: string;
  artistSlug: string;
  /* Bundles only: the resolved components + their combined list price. */
  bundle?: { components: BundleComponent[]; sumCents: number };
}

/** A component's standalone list price: fixed items list download_price;
    PWYW items value at the amount a checkout would charge by default
    (max of listed price and the creator's minimum). */
export function bundleComponentListPriceCents(item: {
  priceCents: number;
  pwywEnabled: boolean;
  pwywMinCents: number;
}): number {
  return item.pwywEnabled
    ? Math.max(item.priceCents, item.pwywMinCents)
    : item.priceCents;
}

/** The amount a checkout may charge for an item. Fixed-price items charge
    exactly the listed price — a client-supplied amount is refused so the
    displayed price can never differ from the charged price. PWYW items
    accept any amount at or above the creator's minimum. */
export function resolveCheckoutAmountCents(
  item: { priceCents: number; pwywEnabled: boolean; pwywMinCents: number },
  requestedCents?: number
): { ok: true; amountCents: number } | { ok: false; error: string } {
  if (!item.pwywEnabled) {
    if (requestedCents !== undefined && requestedCents !== item.priceCents) {
      return { ok: false, error: "This item has a fixed price — the amount can't be changed." };
    }
    return { ok: true, amountCents: item.priceCents };
  }
  const amount = requestedCents ?? Math.max(item.priceCents, item.pwywMinCents);
  if (!Number.isInteger(amount) || amount < item.pwywMinCents || amount <= 0) {
    return {
      ok: false,
      error: `Name your price — it must be at least ${money(item.pwywMinCents)}.`,
    };
  }
  return { ok: true, amountCents: amount };
}

async function resolveSellableItem(
  kind: string,
  id: string
): Promise<SellableItem | { notForSale: true } | { notWired: true }> {
  if (!UUID_RE.test(id)) return { notForSale: true };
  if (kind === "series") {
    /* Paid Series (0192): the catalog entity is a kind='series' playlist
       with the creator's own price_cents. There is NO file to deliver —
       the completed sale row is the unlock — so fileUrl stays empty and
       verify/token branch on the kind instead of minting download links. */
    const result = await db.execute(sql`
      SELECT pl.id, pl.owner_profile_id AS profile_id, pl.title, pl.price_cents,
             pl.is_public, pl.kind AS playlist_kind, pl.cover_url AS artwork_url,
             p.display_name AS artist_name, p.slug AS artist_slug
      FROM playlists pl
      JOIN creator_profiles p ON p.id = pl.owner_profile_id
      WHERE pl.id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || row["playlist_kind"] !== "series" || !row["is_public"]) {
      return { notForSale: true };
    }
    const priceCents = Number(row["price_cents"] ?? 0) || 0;
    if (priceCents <= 0) return { notForSale: true };
    return {
      profileId: String(row["profile_id"]),
      itemKind: "series",
      title: String(row["title"]),
      priceCents,
      pwywEnabled: false,
      pwywMinCents: 0,
      fileUrl: "",
      artworkUrl: (row["artwork_url"] as string | null) ?? null,
      artistName: String(row["artist_name"]),
      artistSlug: String(row["artist_slug"]),
    };
  }
  if (kind === "track" || kind === "video") {
    const table = kind === "track" ? "profile_tracks" : "profile_videos";
    const fileCol = kind === "track" ? "audio_url" : "video_url";
    const artCol = kind === "track" ? "artwork_url" : "thumbnail_url";
    const result = await db.execute(sql`
      SELECT m.id, m.profile_id, m.title, m.download_price_cents, m.is_published,
             m.pwyw_enabled, m.pwyw_min_cents,
             m.${sql.raw(fileCol)} AS file_url, m.${sql.raw(artCol)} AS artwork_url,
             p.display_name AS artist_name, p.slug AS artist_slug
      FROM ${sql.raw(table)} m
      JOIN creator_profiles p ON p.id = m.profile_id
      WHERE m.id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || !row["is_published"] || !row["file_url"]) {
      return { notForSale: true };
    }
    const pwywEnabled = row["pwyw_enabled"] === true;
    const pwywMinCents = Number(row["pwyw_min_cents"] ?? 0) || 0;
    /* Fixed-price items need a listed price; PWYW items need a minimum
       (a fan can't name a price against nothing). */
    if (!pwywEnabled && !Number(row["download_price_cents"])) {
      return { notForSale: true };
    }
    if (pwywEnabled && pwywMinCents <= 0) {
      return { notForSale: true };
    }
    return {
      profileId: String(row["profile_id"]),
      itemKind: kind,
      title: String(row["title"]),
      priceCents: Number(row["download_price_cents"]),
      pwywEnabled,
      pwywMinCents,
      fileUrl: String(row["file_url"]),
      artworkUrl: (row["artwork_url"] as string | null) ?? null,
      artistName: String(row["artist_name"]),
      artistSlug: String(row["artist_slug"]),
    };
  }
  if (kind === BUNDLE_KIND) {
    /* A bundle resolves only as a whole: the playlist must be a public,
       priced bundle, carry at least BUNDLE_MIN_COMPONENTS distinct
       components, and EVERY component must resolve sellable today and
       belong to the bundle's owner. One broken component takes the
       bundle off sale — a fan can never pay for a partial package. */
    const result = await db.execute(sql`
      SELECT pl.id, pl.owner_profile_id AS profile_id, pl.title, pl.price_cents,
             pl.is_public, pl.kind AS playlist_kind, pl.cover_url AS artwork_url,
             pl.items,
             p.display_name AS artist_name, p.slug AS artist_slug
      FROM playlists pl
      JOIN creator_profiles p ON p.id = pl.owner_profile_id
      WHERE pl.id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || row["playlist_kind"] !== BUNDLE_KIND || !row["is_public"]) {
      return { notForSale: true };
    }
    const priceCents = Number(row["price_cents"] ?? 0) || 0;
    if (priceCents <= 0) return { notForSale: true };
    let rawItems: unknown = row["items"];
    if (typeof rawItems === "string") {
      try { rawItems = JSON.parse(rawItems); } catch { rawItems = null; }
    }
    if (!Array.isArray(rawItems)) return { notForSale: true };
    const seen = new Set<string>();
    const refs: { kind: string; id: string }[] = [];
    for (const entry of rawItems as Array<Record<string, unknown>>) {
      const cKind = String(entry?.["kind"] ?? "");
      const cId = String(entry?.["id"] ?? "");
      if (!["track", "video", "series"].includes(cKind) || !UUID_RE.test(cId)) {
        return { notForSale: true };
      }
      const key = `${cKind}:${cId}`;
      if (seen.has(key)) return { notForSale: true };
      seen.add(key);
      refs.push({ kind: cKind, id: cId });
    }
    if (refs.length < BUNDLE_MIN_COMPONENTS || refs.length > BUNDLE_MAX_COMPONENTS) {
      return { notForSale: true };
    }
    const ownerProfileId = String(row["profile_id"]);
    const components: BundleComponent[] = [];
    let sumCents = 0;
    for (const ref of refs) {
      const comp = await resolveSellableItem(ref.kind, ref.id);
      if ("notForSale" in comp || "notWired" in comp) return { notForSale: true };
      if (comp.profileId !== ownerProfileId) return { notForSale: true };
      const listPriceCents = bundleComponentListPriceCents(comp);
      sumCents += listPriceCents;
      components.push({
        kind: ref.kind,
        id: ref.id,
        title: comp.title,
        listPriceCents,
        fileUrl: comp.fileUrl,
      });
    }
    return {
      profileId: ownerProfileId,
      itemKind: BUNDLE_KIND,
      title: String(row["title"]),
      priceCents,
      pwywEnabled: false,
      pwywMinCents: 0,
      fileUrl: "",
      artworkUrl: (row["artwork_url"] as string | null) ?? null,
      artistName: String(row["artist_name"]),
      artistSlug: String(row["artist_slug"]),
      bundle: { components, sumCents },
    };
  }
  return { notWired: true };
}

async function mintDownloadLink(saleId: string, fileUrl: string) {
  const token = mintToken();
  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_HOURS * 3600 * 1000);
  await db.execute(sql`
    INSERT INTO download_links (token, sale_id, file_url, expires_at, used_count)
    VALUES (${token}, ${saleId}, ${fileUrl}, ${expiresAt.toISOString()}, 0)
  `);
  return { token, expiresAt };
}

/* Lane V3 F9: a duplicate verify used to mint a FRESH token every
   time (the old one stayed valid too — links multiplied silently).
   Reuse the sale's still-valid link for the same file instead; only
   mint when none is live. */
async function findReusableDownloadLink(saleId: string, fileUrl: string) {
  const rows = await db.execute(sql`
    SELECT token, expires_at FROM download_links
    WHERE sale_id = ${saleId} AND file_url = ${fileUrl}
      AND expires_at > now() AND used_count < ${DOWNLOAD_MAX_USES}
    ORDER BY expires_at DESC LIMIT 1
  `);
  const row = rows.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return { token: String(row["token"]), expiresAt: new Date(String(row["expires_at"])) };
}

/* ── GET /api/store/item/:kind/:id — public buy-page data ─────────────── */
router.get("/store/item/:kind/:id", publicApiLimiter, async (req, res) => {
  const kind = String(req.params.kind ?? "");
  const id = String(req.params.id ?? "");
  if (!STORE_ITEM_KINDS.includes(kind as (typeof STORE_ITEM_KINDS)[number])) {
    res.status(400).json({ error: "Unknown content kind." });
    return;
  }
  try {
    const item = await resolveSellableItem(kind, id);
    if ("notForSale" in item) {
      res.status(404).json({ error: "NOT_FOR_SALE", message: "This content isn't for sale." });
      return;
    }
    if ("notWired" in item) {
      res.status(400).json({
        error: "SELLING_NOT_AVAILABLE",
        message: `Selling ${kind} isn't wired up yet — tracks, videos, series and bundles are live today.`,
      });
      return;
    }
    const { feeCents, creatorCents } = splitFee(item.priceCents);
    /* Refresh at the response boundary: artwork_url is stored as a
       storage ref (r2:// / supabase://), which clients cannot render —
       mint a fresh signed URL like sibling read endpoints. */
    const artworkUrl = item.artworkUrl
      ? await refreshSupabaseStorageUrl(item.artworkUrl)
      : null;
    res.json({
      item: {
        kind: item.itemKind,
        id,
        title: item.title,
        artworkUrl,
        artistName: item.artistName,
        artistSlug: item.artistSlug,
        priceCents: item.priceCents,
        price: money(item.priceCents),
        /* Name-your-price: when enabled the buy page asks the fan for an
           amount and checkout enforces amount >= minCents. */
        pwyw: {
          enabled: item.pwywEnabled,
          minCents: item.pwywMinCents,
          minPrice: money(item.pwywMinCents),
        },
      },
      feeSplit: {
        priceCents: item.priceCents,
        price: money(item.priceCents),
        platformFeeCents: feeCents,
        platformFee: money(feeCents),
        platformFeePct: PLATFORM_FEE_PCT,
        creatorCents,
        creatorAmount: money(creatorCents),
      },
      /* Bundles itemize up front: every component with its standalone
         price, the bought-separately total, and the honest saving when
         the bundle price beats it. */
      bundle: item.bundle
        ? {
            contents: item.bundle.components.map((c) => ({
              kind: c.kind,
              id: c.id,
              title: c.title,
              listPriceCents: c.listPriceCents,
              listPrice: money(c.listPriceCents),
            })),
            sumCents: item.bundle.sumCents,
            sum: money(item.bundle.sumCents),
            savingsCents: Math.max(0, item.bundle.sumCents - item.priceCents),
            savings: money(Math.max(0, item.bundle.sumCents - item.priceCents)),
          }
        : null,
      note: "Real-money purchase via Stripe. This is not Visual Bucs (AI credits).",
    });
  } catch (err) {
    logger.error({ err, kind, id }, "[store] item lookup failed");
    res.status(500).json({ error: "Could not load this item." });
  }
});

/* ── POST /api/store/checkout — create a Stripe Checkout Session ──────── */
const CheckoutSchema = z.object({
  kind: ItemKindSchema,
  id: z.string().regex(UUID_RE, "id must be a UUID"),
  /* Name-your-price amount (PWYW items only; enforced server-side). */
  amountCents: z.number().int().positive().max(100_000_00).optional(),
  /* Gift-card tender (Stack-100 #3 #26): stored value issued by THIS
     item's creator — payment, not a markdown: the fee still splits
     the full gross (lib/gift-cards.ts fee law). */
  giftCardCode: z.string().trim().min(1).max(40).optional(),
});

router.post("/store/checkout", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CheckoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { kind, id, amountCents: requestedCents } = parsed.data;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(500).json({ error: "Payments are not configured yet." });
    return;
  }

  try {
    const item = await resolveSellableItem(kind, id);
    if ("notForSale" in item) {
      res.status(404).json({ error: "NOT_FOR_SALE", message: "This content isn't for sale." });
      return;
    }
    if ("notWired" in item) {
      res.status(400).json({
        error: "SELLING_NOT_AVAILABLE",
        message: `Selling ${kind} isn't wired up yet — tracks, videos, series and bundles are live today.`,
      });
      return;
    }
    /* Displayed = charged: fixed items charge the listed price; PWYW
       items charge the fan's amount (>= the creator's minimum). */
    const resolved = resolveCheckoutAmountCents(item, requestedCents);
    if (!resolved.ok) {
      res.status(400).json({ error: "INVALID_AMOUNT", message: resolved.error });
      return;
    }
    const chargeCents = resolved.amountCents;
    /* A series unlock is binary — you own it or you don't. A completed
       purchase already on the rail refuses a second checkout outright
       (downloads may legitimately re-sell; access can't be bought twice).
       A refunded sale does NOT block: the fan can buy their way back in. */
    if (kind === "series") {
      const ownedResult = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM digital_sales
        WHERE buyer_user_id = ${req.userId!} AND item_kind = 'series'
          AND item_id = ${id} AND status = 'completed'
      `);
      const ownedCount = Number(
        (ownedResult.rows[0] as { c?: number } | undefined)?.c ?? 0,
      );
      if (ownedCount > 0) {
        res.status(409).json({
          error: "ALREADY_OWNED",
          message: "You already own this series — it's unlocked on the series page.",
          watchUrl: `/playlist/${id}`,
        });
        return;
      }
    }
    /* Bundles follow the same per-kind discipline as standalone sales:
       track/video components may be re-bought (downloads re-sell), but
       a bundle carrying a series the buyer already owns — standalone or
       via an earlier bundle's grant row, both are completed 'series'
       sales — would charge them again for an unlock they hold. Refuse
       it the way the series rail refuses a second unlock. */
    if (kind === BUNDLE_KIND && item.bundle) {
      for (const comp of item.bundle.components) {
        if (comp.kind !== "series") continue;
        const ownedResult = await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM digital_sales
          WHERE buyer_user_id = ${req.userId!} AND item_kind = 'series'
            AND item_id = ${comp.id} AND status = 'completed'
        `);
        const ownedCount = Number(
          (ownedResult.rows[0] as { c?: number } | undefined)?.c ?? 0,
        );
        if (ownedCount > 0) {
          res.status(409).json({
            error: "ALREADY_OWNED",
            message: `This bundle includes “${comp.title}” — you already own that series, so the bundle can't sell it to you twice. The rest of the bundle is on the artist's page individually.`,
            watchUrl: `/playlist/${comp.id}`,
          });
          return;
        }
      }
    }
    const { feeCents, creatorCents } = splitFee(chargeCents);
    /* ── Gift-card tender: reserve against this checkout. The hold
       settles at verify; a failed/abandoned checkout releases it at
       expiry (30 min). Fee stays on chargeCents — the full gross. */
    let giftCardAppliedCents = 0;
    let giftReservationId: string | null = null;
    let giftReservationRef: string | null = null;
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
        if (String(card.profile_id) !== item.profileId) {
          res.status(400).json({ error: "WRONG_STORE", message: "That gift card is for a different creator's store." });
          return;
        }
        const tender = tenderFor(Number(card.balance_cents) - Number(card.reserved_cents), chargeCents);
        if (tender <= 0) {
          res.status(400).json({ error: "NO_BALANCE", message: "That gift card has no balance left to spend." });
          return;
        }
        giftReservationRef = `ds-${randomBytes(16).toString("hex")}`;
        const reservation = await reserveGiftCard({
          cardId: String(card.id), rail: "digital-store", ref: giftReservationRef, amountCents: tender,
        });
        if (!reservation) {
          res.status(409).json({ error: "GIFT_CARD_BUSY", message: "That gift card's balance is held by another checkout right now — try again in a moment." });
          return;
        }
        giftCardAppliedCents = tender;
        giftReservationId = String(reservation.id);
      } catch (err) {
        if (err instanceof GiftCardsUnavailable) {
          res.status(503).json({ error: "GIFT_CARDS_UNAVAILABLE", message: "Gift cards aren't live yet — check out without the code for now. Nothing was charged." });
          return;
        }
        throw err;
      }
    }
    const cardDueCents = chargeCents - giftCardAppliedCents;

    /* Gift card covers it all: record the sale directly (the verify
       rail's exact discipline — UNIQUE session key, fee on gross),
       settle the hold, and deliver. No Stripe session exists. */
    if (giftReservationId && cardDueCents === 0) {
      const recordKey = `giftcard:${giftReservationRef}`;
      const inserted = await db.execute(sql`
        INSERT INTO digital_sales
          (buyer_user_id, profile_id, item_kind, item_id, stripe_session_id,
           amount_cents, platform_fee_cents, creator_amount_cents)
        VALUES (${req.userId!}, ${item.profileId}, ${kind}, ${id}, ${recordKey},
                ${chargeCents}, ${feeCents}, ${creatorCents})
        ON CONFLICT (stripe_session_id) DO NOTHING
        RETURNING id
      `);
      let saleId: string;
      let duplicate = false;
      if (inserted.rows.length > 0) {
        saleId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
      } else {
        const existing = await db.execute(sql`
          SELECT id FROM digital_sales WHERE stripe_session_id = ${recordKey} LIMIT 1
        `);
        if (existing.rows.length === 0) {
          await releaseReservation(giftReservationId).catch(() => undefined);
          res.status(500).json({ error: "Sale could not be recorded — your gift card was not charged." });
          return;
        }
        saleId = String((existing.rows[0] as Record<string, unknown>)["id"]);
        duplicate = true;
      }
      const redeemed = await redeemReservation({ reservationId: giftReservationId, ref: saleId });
      if (!redeemed) {
        logger.error({ saleId, giftReservationId }, "[store] gift-card redeem failed after sale record — needs reconciliation");
      }
      const link = kind === "series"
        ? null
        : (await findReusableDownloadLink(saleId, item.fileUrl)) ?? (await mintDownloadLink(saleId, item.fileUrl));
      logger.info({ userId: req.userId, kind, id, saleId, giftCardAppliedCents }, "[store] sale paid in full by gift card");
      res.json({
        paid: true,
        paidWithGiftCard: true,
        duplicate,
        url: null,
        sessionId: null,
        sale: {
          id: saleId,
          itemKind: kind,
          amountCents: chargeCents,
          amount: money(chargeCents),
          giftCardAppliedCents,
          platformFeeCents: feeCents,
          creatorAmountCents: creatorCents,
        },
        download: link
          ? { token: link.token, url: `/api/store/download/${link.token}`, expiresAt: link.expiresAt.toISOString(), maxUses: DOWNLOAD_MAX_USES }
          : null,
        access: kind === "series" ? { unlocked: true, watchUrl: `/playlist/${id}` } : null,
        note: "Paid in full with your gift card — no card payment was taken.",
      });
      return;
    }
    /* Purchase sequence for the session idempotency key (see
       buildStoreCheckoutKey). A read failure throws into the catch
       below — no session is minted, so the failure is closed. */
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM digital_sales
      WHERE buyer_user_id = ${req.userId!} AND item_kind = ${kind}
        AND item_id = ${id} AND amount_cents = ${chargeCents}
    `);
    const completedSaleCount = Number(
      (countResult.rows[0] as { c?: number } | undefined)?.c ?? 0,
    );
    const idempotencyKey = buildStoreCheckoutKey({
      userId: req.userId!,
      kind,
      itemId: id,
      amountCents: chargeCents,
      completedSaleCount,
    });
    const baseUrl = getBaseUrl(req);
    /* Same stored artwork value flows to Stripe as the checkout image:
       an r2:// / supabase:// ref is unfetchable by Stripe, so refresh
       it to a signed URL here too. */
    const artworkUrl = item.artworkUrl
      ? await refreshSupabaseStorageUrl(item.artworkUrl)
      : null;
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            /* Gift-card tender: Stripe charges only the amount still
               due; the sale record at verify carries the full gross. */
            unit_amount: giftCardAppliedCents > 0 ? cardDueCents : chargeCents,
            product_data: {
              name: `${item.title} — ${item.artistName}`,
              description: kind === "series"
                ? "Series unlock · yours to watch anytime"
                : kind === BUNDLE_KIND
                  ? `Bundle · ${item.bundle?.components.length ?? 0} items, delivered together`
                  : `Digital download · ${kind}`,
              images: artworkUrl ? [artworkUrl] : undefined,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/store/buy/${kind}/${id}`,
      metadata: {
        buyer_user_id: req.userId!,
        profile_id: item.profileId,
        item_kind: kind,
        item_id: id,
        platform_fee_cents: String(feeCents),
        creator_amount_cents: String(creatorCents),
        gift_card_reservation_id: giftReservationId ?? "",
        gift_card_applied_cents: String(giftCardAppliedCents),
      },
      }, { idempotencyKey });
    } catch (sessionErr) {
      if (giftReservationId) await releaseReservation(giftReservationId).catch(() => undefined);
      throw sessionErr;
    }

    logger.info(
      { userId: req.userId, kind, id, priceCents: chargeCents, pwyw: item.pwywEnabled, sessionId: session.id, giftCardAppliedCents },
      "[store] checkout session created"
    );
    res.json({
      url: session.url, sessionId: session.id,
      amountCents: chargeCents, amount: money(chargeCents),
      giftCardAppliedCents, amountDueCents: cardDueCents, amountDue: money(cardDueCents),
    });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, kind, id }, "[store] checkout failed");
    res.status(500).json({ error: `Could not start checkout: ${msg}` });
  }
});

/* ── POST /api/store/verify — confirm payment, record sale idempotently ─ */
const VerifySchema = z.object({
  sessionId: z.string().min(1).max(200),
});

router.post("/store/verify", requireAuth, publicApiLimiter, async (req, res) => {
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
  if (meta["buyer_user_id"] !== req.userId) {
    logger.error({ sessionId, reqUserId: req.userId }, "[store] verify: buyer mismatch");
    res.status(403).json({ error: "This purchase doesn't belong to you." });
    return;
  }
  const kind = meta["item_kind"] ?? "";
  const itemId = meta["item_id"] ?? "";
  const profileId = meta["profile_id"] ?? "";
  if (!kind || !itemId || !profileId) {
    res.status(400).json({ error: "This session isn't a digital-store purchase." });
    return;
  }

  let fileUrl: string;
  let itemTitle = "Your content";
  let artistName = "";
  let artistSlug = "";
  let bundleDef: { components: BundleComponent[]; sumCents: number } | undefined;
  try {
    const item = await resolveSellableItem(kind, itemId);
    if ("notForSale" in item || "notWired" in item) {
      /* Paid, but the content can no longer be delivered (Lane V3
         F3). Refund automatically against the session's payment
         intent (idempotent per session); claim it only if it landed. */
      let refunded = false;
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
      if (pi) {
        try {
          await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: `refund:${sessionId}` });
          refunded = true;
        } catch {
          refunded = false;
        }
      }
      logger.error({ sessionId, refunded }, "[store] verify: item no longer deliverable after payment");
      res.status(400).json({
        error: refunded
          ? "This content is no longer for sale — your payment has been refunded in full."
          : "This content is no longer for sale. Your payment couldn't be refunded automatically — contact support and we'll make it right.",
        refunded,
      });
      return;
    }
    fileUrl = item.fileUrl;
    itemTitle = item.title;
    artistName = item.artistName;
    artistSlug = item.artistSlug;
    bundleDef = item.bundle;
  } catch (err) {
    logger.error({ err, sessionId }, "[store] verify: item re-resolve failed");
    res.status(500).json({ error: "Could not locate the purchased file." });
    return;
  }

  /* Gift-card tender: the session charged only the amount still due;
     the sale's gross is due + tender and the fee splits the GROSS. */
  const giftCardAppliedCents = Math.max(0, parseInt(meta["gift_card_applied_cents"] ?? "0", 10) || 0);
  const giftReservationId = meta["gift_card_reservation_id"] || null;
  const amountCents = (session.amount_total ?? 0) + giftCardAppliedCents;
  const { feeCents, creatorCents } = splitFee(amountCents);

  try {
    /* ── IDEMPOTENCY: Stripe may redirect/verify twice; stripe_session_id is
       UNIQUE, so the second attempt is a harmless no-op. ─────────────── */
    const inserted = await db.execute(sql`
      INSERT INTO digital_sales
        (buyer_user_id, profile_id, item_kind, item_id, stripe_session_id,
         amount_cents, platform_fee_cents, creator_amount_cents)
      VALUES (${req.userId!}, ${profileId}, ${kind}, ${itemId}, ${sessionId},
              ${amountCents}, ${feeCents}, ${creatorCents})
      ON CONFLICT (stripe_session_id) DO NOTHING
      RETURNING id
    `);
    let saleId: string;
    let duplicate = false;
    if (inserted.rows.length > 0) {
      saleId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
      logger.info({ sessionId, saleId, amountCents }, "[store] digital sale recorded");
    } else {
      const existing = await db.execute(sql`
        SELECT id FROM digital_sales WHERE stripe_session_id = ${sessionId} LIMIT 1
      `);
      if (existing.rows.length === 0) {
        res.status(500).json({ error: "Sale could not be recorded." });
        return;
      }
      saleId = String((existing.rows[0] as Record<string, unknown>)["id"]);
      duplicate = true;
      logger.info({ sessionId, saleId }, "[store] verify: duplicate ignored, sale already recorded");
    }

    /* Settle the gift-card hold against this sale (idempotent —
       redeem:{reservationId}; a duplicate verify replays harmlessly). */
    if (giftReservationId) {
      const redeemed = await redeemReservation({ reservationId: giftReservationId, ref: saleId }).catch((e) => {
        logger.error({ err: e, saleId, giftReservationId }, "[store] gift-card redeem threw");
        return null;
      });
      if (!redeemed) {
        logger.error({ saleId, giftReservationId }, "[store] gift-card redeem failed after sale record — needs reconciliation");
      }
    }

    /* Series sales deliver ACCESS, not a file: the sale row above is the
       unlock, so no download link exists to mint or reuse. */
    const link = kind === "series" || kind === BUNDLE_KIND
      ? null
      : (await findReusableDownloadLink(saleId, fileUrl)) ?? (await mintDownloadLink(saleId, fileUrl));

    /* ── Bundle grants: every component, exactly once per purchase ──────
       Tracks/videos get a download link against the BUNDLE sale (the
       find-or-mint discipline makes a double verify reuse, never
       duplicate). A series component gets a completed $0 sale row of
       its own — the row IS the unlock — keyed by a suffixed session id
       (`<session>#grant:series:<id>`) so the insert is idempotent and
       the reversal engine flips it together with the bundle sale.
       Grants run on EVERY verify (including duplicates) so a verify
       that died mid-grant heals on the buyer's next confirmation —
       but never for a sale the clawback already refunded. */
    const bundleDownloads: {
      itemKind: string; itemId: string; title: string;
      token: string; url: string; expiresAt: string; maxUses: number;
    }[] = [];
    const bundleUnlockedSeries: { id: string; title: string; watchUrl: string }[] = [];
    if (kind === BUNDLE_KIND && bundleDef) {
      const statusRows = await db.execute(sql`
        SELECT status FROM digital_sales WHERE id = ${saleId} LIMIT 1
      `);
      const saleStatus = String(
        (statusRows.rows[0] as Record<string, unknown> | undefined)?.["status"] ?? "completed",
      );
      if (saleStatus !== "refunded") {
        for (const comp of bundleDef.components) {
          if (comp.kind === "series") {
            await db.execute(sql`
              INSERT INTO digital_sales
                (buyer_user_id, profile_id, item_kind, item_id, stripe_session_id,
                 amount_cents, platform_fee_cents, creator_amount_cents)
              VALUES (${req.userId!}, ${profileId}, 'series', ${comp.id},
                      ${`${sessionId}${BUNDLE_GRANT_INFIX}series:${comp.id}`}, 0, 0, 0)
              ON CONFLICT (stripe_session_id) DO NOTHING
            `);
            bundleUnlockedSeries.push({
              id: comp.id,
              title: comp.title,
              watchUrl: `/playlist/${comp.id}`,
            });
          } else {
            const compLink =
              (await findReusableDownloadLink(saleId, comp.fileUrl)) ??
              (await mintDownloadLink(saleId, comp.fileUrl));
            bundleDownloads.push({
              itemKind: comp.kind,
              itemId: comp.id,
              title: comp.title,
              token: compLink.token,
              url: `/api/store/download/${compLink.token}`,
              expiresAt: compLink.expiresAt.toISOString(),
              maxUses: DOWNLOAD_MAX_USES,
            });
          }
        }
      }
    }

    /* ── "YOU JUST GOT PAID" — the money finale. Best-effort: the sale is
       already recorded; a notification failure must never fail the purchase.
       The relay pings the creator in chat (exactly-once via the
       UNIQUE(job_type, job_id) gate). ─────────────────────────────── */
    try {
      const creator = await db.execute(sql`
        SELECT user_id, display_name FROM creator_profiles WHERE id = ${profileId} LIMIT 1
      `);
      const crow = creator.rows[0] as Record<string, unknown> | undefined;
      if (crow && String(crow["user_id"]) !== req.userId) {
        await createJobNotification({
          jobType: "sale",
          jobId: saleId,
          userId: String(crow["user_id"]),
          status: "completed",
          title: "You just got paid 👑",
          message: `“${itemTitle}” just sold for ${money(amountCents)} — ${money(creatorCents)} is now in your pending payout. The cheat code works.`,
        });
      }
    } catch (notifyErr) {
      logger.error({ notifyErr, saleId }, "[store] sale notification failed (non-fatal)");
    }

    /* ── Purchase receipt email — best-effort, fail-open. Only on the first
       (non-duplicate) verify so a double-verify never double-sends. ───── */
    if (!duplicate) {
      const buyerEmail =
        req.userEmail ?? session.customer_details?.email ?? undefined;
      if (buyerEmail) {
        /* Bundles itemize the receipt: every component with its own
           list price, the bought-separately total, and the saving. */
        const bundleReceiptHtml = bundleDef
          ? `<div style="margin:0 0 12px;">
${bundleDef.components.map((c) => `<div style="display:flex;justify-content:space-between;color:#ccc;font-size:13px;padding:3px 0;"><span>${escapeHtml(c.title)}</span><span>${emailMoney(c.listPriceCents)}</span></div>`).join("")}
<div style="display:flex;justify-content:space-between;color:#888;font-size:12px;border-top:1px solid #333;margin-top:6px;padding-top:6px;"><span>Bought separately</span><span>${emailMoney(bundleDef.sumCents)}</span></div>
${bundleDef.sumCents > amountCents ? `<div style="display:flex;justify-content:space-between;color:#d4af37;font-size:13px;font-weight:700;"><span>You saved</span><span>${emailMoney(bundleDef.sumCents - amountCents)}</span></div>` : ""}
</div>`
          : "";
        const receiptHtml = emailShell(
          "Purchase confirmed 👑",
          `<p style="margin:0 0 12px;">You're in. Your purchase is ready:</p>
<div style="background:#0a0a0a;border:1px solid #d4af37;border-radius:8px;padding:16px;margin:0 0 16px;">
<div style="color:#d4af37;font-weight:700;font-size:16px;">${escapeHtml(itemTitle)}</div>
${artistName ? `<div style="color:#aaa;font-size:13px;">by ${escapeHtml(artistName)}</div>` : ""}
<div style="color:#eee;font-size:14px;margin-top:8px;">Paid: <strong>${emailMoney(amountCents)}</strong></div>
<div style="color:#888;font-size:12px;">Receipt ID: ${escapeHtml(saleId)}</div>
</div>
${bundleReceiptHtml}
<p style="margin:0 0 16px;color:#ccc;font-size:14px;">${kind === "series"
  ? "The full series is unlocked on your account — watch it anytime, right from the series page."
  : kind === BUNDLE_KIND
    ? "Everything in the bundle is on the confirmation page and in your purchases — downloads are good for 48 hours at a time, and any series in the bundle stays unlocked on your account."
    : "Your download link is on the confirmation page (48h, 5 downloads max)."}</p>
<a href="${baseUrlForEmail()}${kind === "series" ? `/playlist/${itemId}` : "/store/purchases"}" style="display:inline-block;background:#d4af37;color:#0a0a0a;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px;">${kind === "series" ? "Watch the series" : "View my purchases"}</a>`
        );
        // Fire-and-forget: never block the purchase response on email.
        void sendEmail({
          to: buyerEmail,
          subject: `Your receipt — ${itemTitle}`,
          html: receiptHtml,
        });
      }
    }

    res.json({
      success: true,
      duplicate,
      sale: {
        id: saleId,
        itemKind: kind,
        amountCents,
        amount: money(amountCents),
        giftCardAppliedCents,
        platformFeeCents: feeCents,
        creatorAmountCents: creatorCents,
      },
      /* Link graph: no dead ends after payment — the highest-trust moment. */
      item: {
        kind,
        id: itemId,
        title: itemTitle,
        artistName,
        artistSlug,
        buyUrl: `/store/buy/${kind}/${itemId}`,
        artistUrl: artistSlug ? `/artist/${artistSlug}` : null,
      },
      download: link
        ? {
            token: link.token,
            url: `/api/store/download/${link.token}`,
            expiresAt: link.expiresAt.toISOString(),
            maxUses: DOWNLOAD_MAX_USES,
          }
        : null,
      /* Series purchases carry an unlock instead of a download. */
      access: kind === "series"
        ? { unlocked: true, watchUrl: `/playlist/${itemId}` }
        : null,
      /* Bundles deliver per component: a download link per file item,
         an unlock entry per series item. */
      bundle: kind === BUNDLE_KIND
        ? { downloads: bundleDownloads, unlockedSeries: bundleUnlockedSeries }
        : null,
    });
  } catch (err) {
    logger.error({ err, sessionId }, "[store] verify: sale recording failed");
    res.status(500).json({ error: "Payment confirmed but the sale couldn't be recorded. Contact support." });
  }
});

/* ── Branded download page (gold/black luxury) ─────────────────────────── */
function downloadPageHtml(opts: {
  ok: boolean;
  fileUrl?: string;
  title?: string;
  artist?: string;
  usesLeft?: number;
  expiresAt?: string;
  message?: string;
}): string {
  const { ok, fileUrl, title, artist, usesLeft, expiresAt, message } = opts;
  const safe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${ok ? "Your download is ready" : "Link unavailable"} · Bow Down Visuals</title>
${ok && fileUrl ? `<meta http-equiv="refresh" content="1;url=${safe(fileUrl)}"/>` : ""}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #f5ead1; font-family: Georgia, 'Times New Roman', serif;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 520px; width: 100%; text-align: center; border: 1px solid #c9a227;
          border-radius: 16px; padding: 48px 36px;
          background: linear-gradient(160deg, #111 0%, #1a1408 60%, #0a0a0a 100%);
          box-shadow: 0 0 60px rgba(201,162,39,.18); }
  .crown { font-size: 44px; }
  h1 { color: #e8c547; font-size: 28px; margin: 16px 0 8px; letter-spacing: .5px; }
  .sub { color: #b9a86a; font-size: 15px; line-height: 1.6; }
  .btn { display: inline-block; margin-top: 28px; padding: 14px 40px; border-radius: 999px;
         background: linear-gradient(180deg, #e8c547, #b8860b); color: #0a0a0a;
         font-weight: bold; font-size: 16px; text-decoration: none; font-family: inherit; }
  .btn:hover { filter: brightness(1.1); }
  .meta { margin-top: 24px; font-size: 13px; color: #8a7a4d; line-height: 1.8; }
  .brand { margin-top: 32px; font-size: 12px; letter-spacing: 3px; color: #6b5c33; text-transform: uppercase; }
</style>
</head>
<body>
  <div class="card">
    <div class="crown">${ok ? "👑" : "🔒"}</div>
    <h1>${ok ? "Your download is ready" : "This link can't be used"}</h1>
    <p class="sub">${ok
      ? `“${safe(title ?? "Your content")}”${artist ? ` by ${safe(artist)}` : ""} — your download starts automatically. No waiting rooms, no hoops. That's the cheat code.`
      : safe(message ?? "This link expired or hit its download limit.")}</p>
    ${ok && fileUrl ? `<a class="btn" href="${safe(fileUrl)}" download>Download now</a>` : ""}
    ${ok ? `<div class="meta">${usesLeft ?? 0} download${(usesLeft ?? 0) === 1 ? "" : "s"} left · link expires ${safe(expiresAt ?? "")}<br/>Lost this file? Re-download anytime from <a href="/my-music" style="color:#e8c547;">My Music</a> on Bow Down Visuals.</div>` : ""}
    <div class="brand">Bow Down Visuals</div>
  </div>
</body>
</html>`;
}

/* ── GET /api/store/download/:token — token-gated delivery ────────────── */
router.get("/store/download/:token", publicApiLimiter, async (req, res) => {
  const token = String(req.params.token ?? "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!verifyTokenSignature(token)) {
    res.status(404).send(downloadPageHtml({ ok: false, message: "That link doesn't look right. Grab a fresh one from My Music." }));
    return;
  }
  try {
    /* Atomic: increment only if still valid and under the cap. */
    const updated = await db.execute(sql`
      UPDATE download_links
      SET used_count = used_count + 1
      WHERE token = ${token}
        AND expires_at > now()
        AND used_count < ${DOWNLOAD_MAX_USES}
      RETURNING file_url, expires_at, used_count, sale_id
    `);
    const row = updated.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      res.status(410).send(
        downloadPageHtml({
          ok: false,
          message: "This link expired (48 hours) or hit its 5-download limit. Your purchase is safe — mint a fresh link from My Music.",
        })
      );
      return;
    }
    /* Item title/artist for the branded page. */
    const sale = await db.execute(sql`
      SELECT ds.item_kind, ds.item_id, cp.display_name AS artist_name
      FROM digital_sales ds
      LEFT JOIN creator_profiles cp ON cp.id = ds.profile_id
      WHERE ds.id = ${String(row["sale_id"])}
      LIMIT 1
    `);
    const srow = sale.rows[0] as Record<string, unknown> | undefined;
    let title = "Your content";
    if (srow) {
      const kind = String(srow["item_kind"]);
      const itemId = String(srow["item_id"]);
      const table = kind === "video" ? "profile_videos" : "profile_tracks";
      const t = await db.execute(sql`SELECT title FROM ${sql.raw(table)} WHERE id = ${itemId} LIMIT 1`);
      const trow = t.rows[0] as Record<string, unknown> | undefined;
      if (trow) title = String(trow["title"]);
    }
    const usesLeft = DOWNLOAD_MAX_USES - Number(row["used_count"]);
    const expiresAt = new Date(String(row["expires_at"])).toLocaleString();
    logger.info({ saleId: String(row["sale_id"]), usesLeft }, "[store] download served");
    res.status(200).send(
      downloadPageHtml({
        ok: true,
        /* download_links.file_url is copied verbatim from the item's
           stored media value, which is a permanent storage ref since
           mirror-on-save — mint a fresh playable URL at serve time.
           Non-ref legacy values pass through unchanged. */
        fileUrl: await refreshSupabaseStorageUrl(String(row["file_url"])),
        title,
        artist: srow ? String(srow["artist_name"] ?? "") : undefined,
        usesLeft,
        expiresAt,
      })
    );
  } catch (err) {
    logger.error({ err }, "[store] download failed");
    res.status(500).send(downloadPageHtml({ ok: false, message: "Something went wrong serving your file. Try again in a moment." }));
  }
});

/* ── GET /api/store/purchases — buyer's library ────────────────────────── */
router.get("/store/purchases", requireAuth, async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT ds.id, ds.item_kind, ds.item_id, ds.amount_cents, ds.created_at,
             ds.stripe_session_id,
             cp.display_name AS artist_name, cp.slug AS artist_slug,
             COALESCE(t.title, v.title, pl.title) AS item_title,
             COALESCE(t.artwork_url, v.thumbnail_url, pl.cover_url) AS artwork_url,
             CASE WHEN ds.item_kind = 'bundle'
                  THEN jsonb_array_length(COALESCE(pl.items, '[]'::jsonb)) END AS bundle_count
      FROM digital_sales ds
      LEFT JOIN creator_profiles cp ON cp.id = ds.profile_id
      LEFT JOIN profile_tracks t ON ds.item_kind = 'track' AND t.id = ds.item_id
      LEFT JOIN profile_videos v ON ds.item_kind = 'video' AND v.id = ds.item_id
      LEFT JOIN playlists pl ON ds.item_kind IN ('series', 'bundle') AND pl.id = ds.item_id
      WHERE ds.buyer_user_id = ${req.userId!}
      ORDER BY ds.created_at DESC
      LIMIT 200
    `);
    /* Refresh at the response boundary: the joined artwork_url /
       thumbnail_url is stored as a storage ref (r2:// / supabase://),
       which clients cannot render — mint a fresh signed URL per row. */
    res.json({
      purchases: await Promise.all(result.rows.map(async (r) => {
        const row = r as Record<string, unknown>;
        const cents = Number(row["amount_cents"]);
        const kind = String(row["item_kind"]);
        const itemId = String(row["item_id"]);
        const slug = String(row["artist_slug"] ?? "");
        const rawArtwork = (row["artwork_url"] as string | null) ?? null;
        return {
          id: String(row["id"]),
          itemKind: kind,
          itemId,
          title: String(row["item_title"] ?? "Content"),
          artistName: String(row["artist_name"] ?? "Creator"),
          artistSlug: slug,
          artworkUrl: rawArtwork ? await refreshSupabaseStorageUrl(rawArtwork) : null,
          amountCents: cents,
          amount: money(cents),
          purchasedAt: String(row["created_at"]),
          receiptId: String(row["stripe_session_id"] ?? row["id"]),
          /* Link graph: library → drop page, creator profile. A series
             purchase also points straight at the unlocked series page. */
          buyUrl: `/store/buy/${kind}/${itemId}`,
          watchUrl: kind === "series" ? `/playlist/${itemId}` : null,
          artistUrl: slug ? `/artist/${slug}` : null,
          /* Bundle purchases say how many items they hold. */
          bundleItemCount:
            kind === BUNDLE_KIND ? Number(row["bundle_count"] ?? 0) || null : null,
        };
      })),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] purchases failed");
    res.status(500).json({ error: "Could not load your purchases." });
  }
});

/* ── POST /api/store/token — mint a fresh download token for a purchase ─ */
const TokenSchema = z.object({
  saleId: z.string().regex(UUID_RE, "saleId must be a UUID"),
});

router.post("/store/token", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = TokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "saleId is required" });
    return;
  }
  try {
    const sale = await db.execute(sql`
      SELECT ds.id, ds.item_kind, ds.item_id
      FROM digital_sales ds
      WHERE ds.id = ${parsed.data.saleId} AND ds.buyer_user_id = ${req.userId!}
        AND ds.status <> 'refunded'
      LIMIT 1
    `);
    const srow = sale.rows[0] as Record<string, unknown> | undefined;
    if (!srow) {
      res.status(404).json({ error: "Purchase not found." });
      return;
    }
    const kind = String(srow["item_kind"]);
    const itemId = String(srow["item_id"]);
    if (kind === "series") {
      /* A series isn't a download — the purchase unlocks streaming on the
         series page, and a refunded sale already failed the status filter
         above, so a live sale here means the unlock is live too. */
      res.status(400).json({
        error: "SERIES_UNLOCK",
        message: "This purchase unlocks the series — there's no download link. Watch it on the series page.",
        watchUrl: `/playlist/${itemId}`,
      });
      return;
    }
    if (kind === BUNDLE_KIND) {
      /* A bundle re-mints from the RECORDED grants, never the live
         bundle: the files this purchase delivered (its download_links,
         distinct file_urls) and its series grant rows. Bundle price or
         contents edited after the sale cannot add or remove what the
         buyer paid for. Refunded sales never reach here (the status
         filter above), so a listed grant is a live unlock. */
      const saleId = String(srow["id"]);
      /* The grant rows hang off the sale's Stripe session id — fetched
         separately so the shared sale lookup above stays untouched. */
      const sessionRows = await db.execute(sql`
        SELECT stripe_session_id FROM digital_sales WHERE id = ${saleId} LIMIT 1
      `);
      const sessionId = String(
        (sessionRows.rows[0] as Record<string, unknown> | undefined)?.["stripe_session_id"] ?? "",
      );
      const grantFiles = await db.execute(sql`
        SELECT DISTINCT file_url FROM download_links WHERE sale_id = ${saleId}
      `);
      /* Grant-prefix match via substring (the standard-SQL spelling —
         exact in real Postgres and in the embedded test DB). */
      const grantPrefix = `${sessionId}${BUNDLE_GRANT_INFIX}series:`;
      const grantSeries = await db.execute(sql`
        SELECT item_id, item_kind FROM digital_sales
        WHERE buyer_user_id = ${req.userId!} AND item_kind = 'series' AND status = 'completed'
          AND substring(stripe_session_id, 1, ${grantPrefix.length}::int) = ${grantPrefix}
      `);
      const bundleItem = await resolveSellableItem(BUNDLE_KIND, itemId);
      let downloads: {
        itemKind: string; itemId: string; title: string;
        token: string; url: string; expiresAt: string; maxUses: number;
      }[] = [];
      let unlockedSeries: { id: string; title: string; watchUrl: string }[] = [];
      if (grantFiles.rows.length > 0 || grantSeries.rows.length > 0) {
        const titles = new Map<string, { kind: string; title: string }>();
        if (!("notForSale" in bundleItem) && !("notWired" in bundleItem) && bundleItem.bundle) {
          for (const c of bundleItem.bundle.components) titles.set(c.id, { kind: c.kind, title: c.title });
        }
        for (const fr of grantFiles.rows) {
          const fileUrl = String((fr as Record<string, unknown>)["file_url"]);
          const comp = !("notForSale" in bundleItem) && !("notWired" in bundleItem) && bundleItem.bundle
            ? bundleItem.bundle.components.find((c) => c.fileUrl === fileUrl)
            : undefined;
          const l = await mintDownloadLink(saleId, fileUrl);
          downloads.push({
            itemKind: comp?.kind ?? "track",
            itemId: comp?.id ?? itemId,
            title: comp?.title ?? "Bundle item",
            token: l.token,
            url: `/api/store/download/${l.token}`,
            expiresAt: l.expiresAt.toISOString(),
            maxUses: DOWNLOAD_MAX_USES,
          });
        }
        unlockedSeries = grantSeries.rows.map((gr) => {
          const gid = String((gr as Record<string, unknown>)["item_id"]);
          return {
            id: gid,
            title: titles.get(gid)?.title ?? "Series",
            watchUrl: `/playlist/${gid}`,
          };
        });
      } else if (!("notForSale" in bundleItem) && !("notWired" in bundleItem) && bundleItem.bundle) {
        /* No grants recorded (a verify interrupted before granting):
           fall back to the live bundle so the buyer isn't stranded —
           verify re-runs the same grants and settles the record. */
        for (const comp of bundleItem.bundle.components) {
          if (comp.kind === "series") {
            await db.execute(sql`
              INSERT INTO digital_sales
                (buyer_user_id, profile_id, item_kind, item_id, stripe_session_id,
                 amount_cents, platform_fee_cents, creator_amount_cents)
              VALUES (${req.userId!}, ${bundleItem.profileId}, 'series', ${comp.id},
                      ${`${sessionId}${BUNDLE_GRANT_INFIX}series:${comp.id}`}, 0, 0, 0)
              ON CONFLICT (stripe_session_id) DO NOTHING
            `);
            unlockedSeries.push({ id: comp.id, title: comp.title, watchUrl: `/playlist/${comp.id}` });
          } else {
            const l = await mintDownloadLink(saleId, comp.fileUrl);
            downloads.push({
              itemKind: comp.kind,
              itemId: comp.id,
              title: comp.title,
              token: l.token,
              url: `/api/store/download/${l.token}`,
              expiresAt: l.expiresAt.toISOString(),
              maxUses: DOWNLOAD_MAX_USES,
            });
          }
        }
      } else {
        res.status(400).json({ error: "This content is no longer available." });
        return;
      }
      res.json({ bundle: true, downloads, unlockedSeries });
      return;
    }
    const item = await resolveSellableItem(kind, itemId);
    if ("notForSale" in item || "notWired" in item || !("fileUrl" in item)) {
      res.status(400).json({ error: "This content is no longer available." });
      return;
    }
    const link = await mintDownloadLink(parsed.data.saleId, item.fileUrl);
    res.json({
      token: link.token,
      url: `/api/store/download/${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
      maxUses: DOWNLOAD_MAX_USES,
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] token mint failed");
    res.status(500).json({ error: "Could not create a download link." });
  }
});

/* ── Helpers: creator ownership ────────────────────────────────────────── */
async function callerProfile(userId: string): Promise<{ id: string; slug: string } | null> {
  const r = await db.execute(sql`
    SELECT id, slug FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? { id: String(row["id"]), slug: String(row["slug"]) } : null;
}
/* Back-compat alias used below. */
const callerProfileId = (userId: string) => callerProfile(userId).then((p) => (p ? p.id : null));

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ── GET /api/store/sales — creator sales dashboard ────────────────────── */
router.get("/store/sales", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const profileId = profile.id;
    const sales = await db.execute(sql`
      SELECT ds.id, ds.item_kind, ds.item_id, ds.amount_cents,
             ds.platform_fee_cents, ds.creator_amount_cents, ds.created_at,
             COALESCE(t.title, v.title, pl.title) AS item_title
      FROM digital_sales ds
      LEFT JOIN profile_tracks t ON ds.item_kind = 'track' AND t.id = ds.item_id
      LEFT JOIN profile_videos v ON ds.item_kind = 'video' AND v.id = ds.item_id
      LEFT JOIN playlists pl ON ds.item_kind IN ('series', 'bundle') AND pl.id = ds.item_id
      WHERE ds.profile_id = ${profileId}
      ORDER BY ds.created_at DESC
      LIMIT 500
    `);
    const byKind = await db.execute(sql`
      SELECT ds.item_kind,
             COUNT(*)::int AS sales,
             COALESCE(SUM(ds.amount_cents), 0)::int AS gross_cents,
             COALESCE(SUM(ds.creator_amount_cents), 0)::int AS creator_cents
      FROM digital_sales ds
      WHERE ds.profile_id = ${profileId}
      GROUP BY ds.item_kind
      ORDER BY gross_cents DESC
    `);
    /* Which sales already landed in the Money Tracker (note marker). */
    const logged = await db.execute(sql`
      SELECT note FROM money_entries
      WHERE user_id = ${req.userId!}
        AND entry_type = 'income'
        AND note LIKE 'Music store sale %'
      LIMIT 1000
    `);
    const loggedIds = new Set(
      logged.rows.map((r) => String((r as Record<string, unknown>)["note"]).replace("Music store sale ", "").trim())
    );

    const rows = sales.rows.map((r) => {
      const row = r as Record<string, unknown>;
      const gross = Number(row["amount_cents"]);
      const fee = Number(row["platform_fee_cents"]);
      const net = Number(row["creator_amount_cents"]);
      const kind = String(row["item_kind"]);
      const itemId = String(row["item_id"]);
      return {
        id: String(row["id"]),
        itemKind: kind,
        itemId,
        itemTitle: String(row["item_title"] ?? "Content"),
        grossCents: gross,
        gross: money(gross),
        platformFeeCents: fee,
        platformFee: money(fee),
        creatorCents: net,
        creatorAmount: money(net),
        soldAt: String(row["created_at"]),
        loggedToTracker: loggedIds.has(String(row["id"])),
        /* Link graph: every sale links back to the drop page. */
        buyUrl: `/store/buy/${kind}/${itemId}`,
      };
    });
    const totals = rows.reduce(
      (a, s) => ({
        sales: a.sales + 1,
        grossCents: a.grossCents + s.grossCents,
        feeCents: a.feeCents + s.platformFeeCents,
        creatorCents: a.creatorCents + s.creatorCents,
      }),
      { sales: 0, grossCents: 0, feeCents: 0, creatorCents: 0 }
    );
    res.json({
      totals: {
        ...totals,
        gross: money(totals.grossCents),
        platformFee: money(totals.feeCents),
        pendingPayout: money(totals.creatorCents),
        pendingPayoutCents: totals.creatorCents,
      },
      byKind: byKind.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          kind: String(row["item_kind"]),
          sales: Number(row["sales"]),
          gross: money(Number(row["gross_cents"])),
          creatorAmount: money(Number(row["creator_cents"])),
        };
      }),
      sales: rows,
      platformFeePct: PLATFORM_FEE_PCT,
      /* Link graph: dashboard → creator's public profile. */
      profileUrl: `/artist/${profile.slug}`,
      payoutNote:
        "Your cut is tracked as a pending payout balance. Real payouts need Stripe Connect — that's the next build before anyone gets paid out.",
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] sales dashboard failed");
    res.status(500).json({ error: "Could not load your sales." });
  }
});

/* ── POST /api/store/log-to-tracker — push a sale into the Money Tracker ─ */
const LogSchema = z.object({
  saleId: z.string().regex(UUID_RE, "saleId must be a UUID"),
});

router.post("/store/log-to-tracker", requireAuth, async (req, res) => {
  const parsed = LogSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "saleId is required" });
    return;
  }
  try {
    const profileId = await callerProfileId(req.userId!);
    if (!profileId) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const sale = await db.execute(sql`
      SELECT ds.id, ds.item_kind, ds.item_id, ds.creator_amount_cents,
             COALESCE(t.title, v.title, pl.title) AS item_title
      FROM digital_sales ds
      LEFT JOIN profile_tracks t ON ds.item_kind = 'track' AND t.id = ds.item_id
      LEFT JOIN profile_videos v ON ds.item_kind = 'video' AND v.id = ds.item_id
      LEFT JOIN playlists pl ON ds.item_kind IN ('series', 'bundle') AND pl.id = ds.item_id
      WHERE ds.id = ${parsed.data.saleId} AND ds.profile_id = ${profileId}
      LIMIT 1
    `);
    const srow = sale.rows[0] as Record<string, unknown> | undefined;
    if (!srow) {
      res.status(404).json({ error: "Sale not found." });
      return;
    }
    const marker = `Music store sale ${parsed.data.saleId}`;
    const dup = await db.execute(sql`
      SELECT id FROM money_entries
      WHERE user_id = ${req.userId!}
        AND entry_type = 'income'
        AND note = ${marker}
      LIMIT 1
    `);
    if (dup.rows.length > 0) {
      res.status(409).json({ error: "ALREADY_LOGGED", message: "This sale is already in your Money Tracker." });
      return;
    }
    const cents = Number(srow["creator_amount_cents"]);
    const title = String(srow["item_title"] ?? "Content");
    const inserted = await db.execute(sql`
      INSERT INTO money_entries
        (user_id, entry_type, category, amount_cents, note, source, entry_date)
      VALUES (${req.userId!}, 'income', 'digital_sales', ${cents},
              ${marker}, ${"Music Store — " + title}, ${todayYmd()})
      RETURNING id, amount_cents, entry_date
    `);
    const erow = inserted.rows[0] as Record<string, unknown>;
    logger.info({ userId: req.userId, saleId: parsed.data.saleId, cents }, "[store] sale logged to money tracker");
    res.status(201).json({
      entry: {
        id: String(erow["id"]),
        amountCents: Number(erow["amount_cents"]),
        amount: money(Number(erow["amount_cents"])),
        date: String(erow["entry_date"]),
      },
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] log-to-tracker failed");
    res.status(500).json({ error: "Could not log this sale." });
  }
});

/* ── Pricing intelligence ────────────────────────────────────────────────
   GUIDE THEM TO THE MONEY: every creator vertical gets honest pricing
   benchmarks ("here's what creators in your vertical charge"). The difficulty
   ladder maps onto Creator Level stars:
     1 star = "Smart price it for me"  (one tap, vertical-aware default)
     2-3    = guided pricing presets   (pick from proven price points)
     4-6    = full control             (any price, live fee preview)
   Checkout and payout visibility are NEVER gated by level. */

export const STORE_VERTICALS = [
  "music", "video", "gaming", "podcast", "film", "tv", "influencer", "education", "other",
] as const;
export type StoreVertical = (typeof STORE_VERTICALS)[number];

interface PricePoint {
  smart: number;
  low: number;
  high: number;
  presets: number[];
  blurb: string;
}

const KIND_DEFAULTS: Record<string, PricePoint> = {
  track: {
    smart: 199, low: 99, high: 499, presets: [99, 199, 299],
    blurb: "Single tracks move at impulse prices. $1.99 is the sweet spot — cheap enough to cop on sight, real enough to stack.",
  },
  video: {
    smart: 499, low: 199, high: 1999, presets: [199, 499, 999],
    blurb: "Exclusive videos price on access. $4.99 beats a paywall subscription for one drop fans actually want.",
  },
  album: {
    smart: 799, low: 399, high: 1499, presets: [399, 799, 1299],
    blurb: "Albums and EPs bundle value. $7.99 undercuts streaming apathy — fans pay to OWN the body of work.",
  },
  pack: {
    smart: 999, low: 499, high: 2999, presets: [499, 999, 1999],
    blurb: "Packs sell leverage: sounds, highlights, or assets buyers reuse forever. $9.99 prices the shortcut, not the files.",
  },
  digital: {
    smart: 499, low: 199, high: 1999, presets: [199, 499, 999],
    blurb: "Presets, templates, ebooks — price the transformation. $4.99 for the thing that saves them 10 hours is a steal.",
  },
  series: {
    smart: 1499, low: 499, high: 9999, presets: [499, 999, 1499, 2999],
    blurb: "A season pass prices the whole arc, not the episode. $14.99 for the full season undercuts every streaming sub — and unlike the platforms, the buyer list is yours.",
  },
  bundle: {
    smart: 1499, low: 799, high: 4999, presets: [799, 1499, 2999],
    blurb: "A bundle prices the collection, not the parts. Price it under the bought-separately total and the saving sells itself — fans get everything in one tap, you keep 95% of one clean sale.",
  },
};

/* Vertical overrides: { [vertical]: { [kind]: PricePoint } }. Anything not
   listed falls back to KIND_DEFAULTS. */
const VERTICAL_OVERRIDES: Record<string, Record<string, PricePoint>> = {
  education: {
    video: {
      smart: 2999, low: 999, high: 9999, presets: [999, 2999, 5999],
      blurb: "Courses sell transformation, not content. Educators routinely charge $29.99+ — price the outcome, not the runtime.",
    },
    digital: {
      smart: 1499, low: 499, high: 4999, presets: [499, 1499, 2999],
      blurb: "Templates and guides that shortcut learning command premium prices. $14.99 is the educator's impulse tier.",
    },
  },
  film: {
    video: {
      smart: 999, low: 499, high: 2499, presets: [499, 999, 1999],
      blurb: "Series passes and exclusive premieres: $9.99 beats a theater ticket and fans keep it forever.",
    },
  },
  tv: {
    video: {
      smart: 1499, low: 499, high: 2999, presets: [499, 1499, 2499],
      blurb: "Episodic drops and season passes. $14.99 for the full season undercuts every streaming sub.",
    },
  },
  gaming: {
    pack: {
      smart: 499, low: 199, high: 1499, presets: [199, 499, 999],
      blurb: "Highlight packs and asset bundles: gamers pay $4.99 for the clips that make THEM look good.",
    },
    video: {
      smart: 299, low: 99, high: 999, presets: [99, 299, 599],
      blurb: "Exclusive gameplay and tutorials move fast at low prices. $2.99 is the gamer impulse buy.",
    },
  },
  podcast: {
    track: {
      smart: 299, low: 99, high: 999, presets: [99, 299, 499],
      blurb: "Bonus episodes and ad-free feeds: $2.99/mo-equivalent pricing wins. One payment, no subscription fatigue.",
    },
  },
  influencer: {
    digital: {
      smart: 1499, low: 499, high: 2999, presets: [499, 1499, 2499],
      blurb: "Presets are the influencer money printer. $14.99 for YOUR look is the industry standard.",
    },
    video: {
      smart: 999, low: 299, high: 2999, presets: [299, 999, 1999],
      blurb: "Behind-the-scenes and tutorials: $9.99 turns followers into customers.",
    },
  },
  music: {
    track: {
      smart: 199, low: 99, high: 499, presets: [99, 199, 299],
      blurb: "Singles move at $1.99. Price the feeling, not the file — fans cop the vibe.",
    },
    pack: {
      smart: 1499, low: 499, high: 3999, presets: [499, 1499, 2999],
      blurb: "Sample and loop packs: producers pay $14.99 for sounds that land placements.",
    },
  },
  video: {
    video: {
      smart: 999, low: 299, high: 2999, presets: [299, 999, 1999],
      blurb: "Video creators sell access and exclusivity. $9.99 is the proven drop price.",
    },
  },
};

const VERTICAL_LABELS: Record<string, string> = {
  music: "Music", video: "Video", gaming: "Gaming", podcast: "Podcast",
  film: "Film", tv: "TV", influencer: "Influencer", education: "Education", other: "Creator",
};

export function pricePointFor(vertical: string, kind: string): { point: PricePoint; vertical: string } {
  const v = (STORE_VERTICALS as readonly string[]).includes(vertical) ? vertical : "other";
  const override = VERTICAL_OVERRIDES[v]?.[kind];
  return { point: override ?? KIND_DEFAULTS[kind] ?? KIND_DEFAULTS["digital"]!, vertical: v };
}

function pricePointJson(point: PricePoint) {
  return {
    smartCents: point.smart,
    smart: money(point.smart),
    lowCents: point.low,
    low: money(point.low),
    highCents: point.high,
    high: money(point.high),
    presets: point.presets.map((c) => ({ cents: c, label: money(c) })),
    blurb: point.blurb,
  };
}

/* ── GET /api/store/price-guide — public pricing benchmarks ────────────── */
router.get("/store/price-guide", publicApiLimiter, (req, res) => {
  const vertical = String(req.query["vertical"] ?? "other");
  const kind = String(req.query["kind"] ?? "");
  if (kind && !STORE_ITEM_KINDS.includes(kind as (typeof STORE_ITEM_KINDS)[number])) {
    res.status(400).json({ error: "Unknown content kind." });
    return;
  }
  const kinds = kind ? [kind] : [...STORE_ITEM_KINDS];
  const guide: Record<string, ReturnType<typeof pricePointJson>> = {};
  for (const k of kinds) guide[k] = pricePointJson(pricePointFor(vertical, k).point);
  res.json({
    vertical: pricePointFor(vertical, kind || "track").vertical,
    verticalLabel: VERTICAL_LABELS[pricePointFor(vertical, kind || "track").vertical] ?? "Creator",
    verticals: STORE_VERTICALS.map((v) => ({ id: v, label: VERTICAL_LABELS[v] })),
    guide,
    note: "Benchmarks from what creators actually charge — a starting point, not a rule. You keep 95% of every sale.",
  });
});

/* ── POST /api/store/suggest-price — 1-star "price it for me" ──────────── */
const SuggestPriceSchema = z.object({
  kind: ItemKindSchema,
  itemId: z.string().regex(UUID_RE).optional(),
});

router.post("/store/suggest-price", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = SuggestPriceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  try {
    const prof = await db.execute(sql`
      SELECT id, vertical FROM creator_profiles WHERE user_id = ${req.userId!} LIMIT 1
    `);
    const prow = prof.rows[0] as Record<string, unknown> | undefined;
    if (!prow) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const vertical = String(prow["vertical"] ?? "other");
    let title: string | null = null;
    if (parsed.data.itemId) {
      const item = await resolveSellableItem(parsed.data.kind, parsed.data.itemId);
      if ("notForSale" in item || "notWired" in item) {
        /* Item may be unpriced/unpublished — still suggest a price for it. */
      } else if (item.profileId !== String(prow["id"])) {
        res.status(403).json({ error: "That's not your content." });
        return;
      } else {
        title = item.title;
      }
    }
    const { point } = pricePointFor(vertical, parsed.data.kind);
    const { feeCents, creatorCents } = splitFee(point.smart);
    res.json({
      kind: parsed.data.kind,
      title,
      vertical,
      verticalLabel: VERTICAL_LABELS[vertical] ?? "Creator",
      suggestedCents: point.smart,
      suggested: money(point.smart),
      youKeep: money(creatorCents),
      platformFee: money(feeCents),
      range: { low: money(point.low), high: money(point.high) },
      presets: point.presets.map((c) => ({ cents: c, label: money(c) })),
      blurb: point.blurb,
      note: "Smart default from your vertical's benchmarks. One tap applies it — change it anytime.",
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] suggest-price failed");
    res.status(500).json({ error: "Could not suggest a price." });
  }
});

/* ── GET /api/store/products — creator's sellable catalog ──────────────── */
router.get("/store/products", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const tracks = await db.execute(sql`
      SELECT id, title, download_price_cents, is_published, artwork_url, pwyw_enabled, pwyw_min_cents
      FROM profile_tracks WHERE profile_id = ${profile.id}
      ORDER BY created_at DESC LIMIT 200
    `);
    const videos = await db.execute(sql`
      SELECT id, title, download_price_cents, is_published, thumbnail_url AS artwork_url, pwyw_enabled, pwyw_min_cents
      FROM profile_videos WHERE profile_id = ${profile.id}
      ORDER BY created_at DESC LIMIT 200
    `);
    /* Refresh at the response boundary: artwork_url / thumbnail_url
       are stored as storage refs (r2:// / supabase://), which clients
       cannot render — mint a fresh signed URL per product. */
    const map = async (rows: Record<string, unknown>[], kind: string) =>
      Promise.all(rows.map(async (r) => {
        const price = Number(r["download_price_cents"]);
        const { creatorCents } = splitFee(price);
        const rawArtwork = (r["artwork_url"] as string | null) ?? null;
        return {
          kind,
          id: String(r["id"]),
          title: String(r["title"]),
          priceCents: price,
          price: money(price),
          youKeep: money(creatorCents),
          isPublished: !!r["is_published"],
          forSale: !!r["is_published"] && (price > 0 || (r["pwyw_enabled"] === true && Number(r["pwyw_min_cents"] ?? 0) > 0)),
          pwyw: {
            enabled: r["pwyw_enabled"] === true,
            minCents: Number(r["pwyw_min_cents"] ?? 0),
            minPrice: money(Number(r["pwyw_min_cents"] ?? 0)),
          },
          artworkUrl: rawArtwork ? await refreshSupabaseStorageUrl(rawArtwork) : null,
          buyUrl: `/store/buy/${kind}/${String(r["id"])}`,
        };
      }));
    const prof = await db.execute(sql`
      SELECT vertical FROM creator_profiles WHERE id = ${profile.id} LIMIT 1
    `);
    const vertical = String((prof.rows[0] as Record<string, unknown> | undefined)?.["vertical"] ?? "other");
    res.json({
      vertical,
      verticalLabel: VERTICAL_LABELS[vertical] ?? "Creator",
      profileUrl: `/artist/${profile.slug}`,
      products: [
        ...(await map(tracks.rows as Record<string, unknown>[], "track")),
        ...(await map(videos.rows as Record<string, unknown>[], "video")),
      ],
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] products failed");
    res.status(500).json({ error: "Could not load your products." });
  }
});

/* ── PATCH /api/store/price — owner sets a price (full control, 4-6★) ────
   Checkout and payout visibility are NEVER gated by level — this endpoint
   only changes the price tag. */
const SetPriceSchema = z.object({
  kind: z.enum(["track", "video"]),
  id: z.string().regex(UUID_RE, "id must be a UUID"),
  priceCents: z.number().int().min(0).max(100_000_00),
  /* Name-your-price (0132): creator opt-in + minimum, set with the price. */
  pwywEnabled: z.boolean().optional(),
  pwywMinCents: z.number().int().min(0).max(100_000_00).optional(),
});

router.patch("/store/price", requireAuth, async (req, res) => {
  const parsed = SetPriceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { kind, id, priceCents, pwywEnabled, pwywMinCents } = parsed.data;
  if (pwywEnabled && !(pwywMinCents && pwywMinCents > 0)) {
    res.status(400).json({
      error: "PWYW_MIN_REQUIRED",
      message: "Name-your-price needs a minimum above $0 — fans can pay more, never less.",
    });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const table = kind === "track" ? "profile_tracks" : "profile_videos";
    const updated = await db.execute(sql`
      UPDATE ${sql.raw(table)}
      SET download_price_cents = ${priceCents},
          pwyw_enabled = COALESCE(${pwywEnabled ?? null}, pwyw_enabled),
          pwyw_min_cents = COALESCE(${pwywMinCents ?? null}, pwyw_min_cents)
      WHERE id = ${id} AND profile_id = ${profile.id}
      RETURNING id, title, download_price_cents, is_published, pwyw_enabled, pwyw_min_cents
    `);
    const row = updated.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: "Content not found — or it isn't yours." });
      return;
    }
    const { feeCents, creatorCents } = splitFee(priceCents);
    logger.info({ userId: req.userId, kind, id, priceCents }, "[store] price set");
    res.json({
      product: {
        kind,
        id: String(row["id"]),
        title: String(row["title"]),
        priceCents,
        price: money(priceCents),
        youKeep: money(creatorCents),
        platformFee: money(feeCents),
        platformFeePct: PLATFORM_FEE_PCT,
        isPublished: !!row["is_published"],
        forSale: !!row["is_published"] && priceCents > 0,
        pwyw: {
          enabled: row["pwyw_enabled"] === true,
          minCents: Number(row["pwyw_min_cents"] ?? 0),
          minPrice: money(Number(row["pwyw_min_cents"] ?? 0)),
        },
        buyUrl: `/store/buy/${kind}/${id}`,
      },
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] set-price failed");
    res.status(500).json({ error: "Could not set the price." });
  }
});

/* ── Bundle management (Stack-100 #3, feature #15) ───────────────────────
   A bundle is a playlists row (kind='bundle'). These endpoints are the
   seller's desk for it: create from their own sellable products, list
   with live component health, edit for FUTURE sales — a recorded sale
   snapshots its amount and grants, so edits never rewrite a past
   purchase. */

const BundleItemRefSchema = z.object({
  kind: z.enum(["track", "video", "series"]),
  id: z.string().regex(UUID_RE, "id must be a UUID"),
});
const BundlePriceSchema = z.number().int().min(BUNDLE_PRICE_MIN_CENTS).max(BUNDLE_PRICE_MAX_CENTS);
const CreateBundleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(""),
  coverUrl: z.string().trim().max(500).optional().nullable(),
  priceCents: BundlePriceSchema,
  isPublic: z.boolean().optional().default(true),
  items: z.array(BundleItemRefSchema).min(BUNDLE_MIN_COMPONENTS).max(BUNDLE_MAX_COMPONENTS),
});
const UpdateBundleSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  coverUrl: z.string().trim().max(500).optional().nullable(),
  priceCents: BundlePriceSchema.optional(),
  isPublic: z.boolean().optional(),
  items: z.array(BundleItemRefSchema).min(BUNDLE_MIN_COMPONENTS).max(BUNDLE_MAX_COMPONENTS).optional(),
}).refine((d) => Object.values(d).some((v) => v !== undefined), {
  message: "Nothing to update.",
});

type BundleRef = { kind: string; id: string };

/** Strict component check (create / contents change): every component
    must resolve sellable TODAY and belong to the seller. */
async function validateBundleComponents(
  profileId: string,
  refs: BundleRef[],
): Promise<
  | { ok: true; components: BundleComponent[]; sumCents: number }
  | { ok: false; status: number; error: string; message: string }
> {
  const seen = new Set<string>();
  for (const r of refs) {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) {
      return { ok: false, status: 400, error: "DUPLICATE_COMPONENT", message: "Each item can only be in the bundle once." };
    }
    seen.add(key);
  }
  const components: BundleComponent[] = [];
  let sumCents = 0;
  for (const r of refs) {
    const resolved = await resolveSellableItem(r.kind, r.id);
    if ("notWired" in resolved) {
      return { ok: false, status: 400, error: "COMPONENT_NOT_SELLABLE", message: `${r.kind} can't be sold in a bundle.` };
    }
    if ("notForSale" in resolved) {
      return { ok: false, status: 400, error: "COMPONENT_NOT_SELLABLE", message: "One of the items isn't for sale right now — publish it and set a price first." };
    }
    if (resolved.profileId !== profileId) {
      return { ok: false, status: 403, error: "NOT_YOUR_ITEM", message: "A bundle can only contain your own products." };
    }
    const listPriceCents = bundleComponentListPriceCents(resolved);
    sumCents += listPriceCents;
    components.push({ kind: r.kind, id: r.id, title: resolved.title, listPriceCents, fileUrl: resolved.fileUrl });
  }
  return { ok: true, components, sumCents };
}

function parseBundleRefs(row: Record<string, unknown>): BundleRef[] {
  let raw: unknown = row["items"];
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((e) => ({ kind: String(e?.["kind"] ?? ""), id: String(e?.["id"] ?? "") }))
    .filter((r) => ["track", "video", "series"].includes(r.kind) && UUID_RE.test(r.id));
}

/** Light per-component view for the seller's desk: title + list price +
    whether it still sells — a component pulled from sale shows up
    flagged instead of vanishing (or breaking the whole list). */
async function lightComponent(ref: BundleRef): Promise<{
  kind: string; id: string; title: string; listPriceCents: number; sellable: boolean;
}> {
  if (ref.kind === "series") {
    const r = await db.execute(sql`
      SELECT title, price_cents, is_public FROM playlists WHERE id = ${ref.id} LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ...ref, title: "Removed content", listPriceCents: 0, sellable: false };
    const price = Number(row["price_cents"] ?? 0) || 0;
    return { ...ref, title: String(row["title"]), listPriceCents: price, sellable: !!row["is_public"] && price > 0 };
  }
  const table = ref.kind === "video" ? "profile_videos" : "profile_tracks";
  const r = await db.execute(sql`
    SELECT title, download_price_cents, pwyw_enabled, pwyw_min_cents, is_published, file_url
    FROM ${sql.raw(table)} WHERE id = ${ref.id} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ...ref, title: "Removed content", listPriceCents: 0, sellable: false };
  const listPriceCents = bundleComponentListPriceCents({
    priceCents: Number(row["download_price_cents"] ?? 0) || 0,
    pwywEnabled: row["pwyw_enabled"] === true,
    pwywMinCents: Number(row["pwyw_min_cents"] ?? 0) || 0,
  });
  const sellable = !!row["is_published"] && !!row["file_url"] && listPriceCents > 0;
  return { ...ref, title: String(row["title"]), listPriceCents, sellable };
}

function bundleJson(
  row: Record<string, unknown>,
  contents: { kind: string; id: string; title: string; listPriceCents: number; sellable?: boolean }[],
  extra?: { sellable?: boolean; salesCount?: number },
) {
  const priceCents = Number(row["price_cents"] ?? 0) || 0;
  const sumCents = contents.reduce((a, c) => a + c.listPriceCents, 0);
  return {
    id: String(row["id"]),
    kind: BUNDLE_KIND,
    title: String(row["title"]),
    description: String(row["description"] ?? ""),
    coverUrl: (row["cover_url"] as string | null) ?? null,
    priceCents,
    price: money(priceCents),
    isPublic: !!row["is_public"],
    contents: contents.map((c) => ({
      kind: c.kind, id: c.id, title: c.title,
      listPriceCents: c.listPriceCents, listPrice: money(c.listPriceCents),
      ...(c.sellable === undefined ? {} : { sellable: c.sellable }),
    })),
    sumCents,
    sum: money(sumCents),
    savingsCents: Math.max(0, sumCents - priceCents),
    savings: money(Math.max(0, sumCents - priceCents)),
    buyUrl: `/store/buy/bundle/${String(row["id"])}`,
    ...(extra?.sellable === undefined ? {} : { sellable: extra.sellable }),
    ...(extra?.salesCount === undefined ? {} : { salesCount: extra.salesCount }),
  };
}

async function loadBundleRow(id: string): Promise<Record<string, unknown> | undefined> {
  const r = await db.execute(sql`
    SELECT id, owner_profile_id, title, description, cover_url, is_public,
           price_cents, items, created_at
    FROM playlists WHERE id = ${id} AND kind = 'bundle' LIMIT 1
  `);
  return r.rows[0] as Record<string, unknown> | undefined;
}

router.post("/store/bundles", requireAuth, async (req, res) => {
  const parsed = CreateBundleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const check = await validateBundleComponents(profile.id, parsed.data.items);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error, message: check.message });
      return;
    }
    const inserted = await db.execute(sql`
      INSERT INTO playlists
        (owner_profile_id, title, description, cover_url, is_public, kind, price_cents, items)
      VALUES (${profile.id}, ${parsed.data.title}, ${parsed.data.description},
              ${parsed.data.coverUrl ?? null}, ${parsed.data.isPublic}, 'bundle',
              ${parsed.data.priceCents}, ${JSON.stringify(parsed.data.items)}::jsonb)
      RETURNING id, created_at
    `);
    const row = inserted.rows[0] as Record<string, unknown>;
    const bundleRow: Record<string, unknown> = {
      id: row["id"], title: parsed.data.title, description: parsed.data.description,
      cover_url: parsed.data.coverUrl ?? null, is_public: parsed.data.isPublic,
      price_cents: parsed.data.priceCents, items: parsed.data.items,
    };
    logger.info({ userId: req.userId, bundleId: String(row["id"]) }, "[store] bundle created");
    res.status(201).json({ bundle: bundleJson(bundleRow, check.components) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] bundle create failed");
    res.status(500).json({ error: "Could not create the bundle." });
  }
});

router.get("/store/bundles", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const rows = await db.execute(sql`
      SELECT id, owner_profile_id, title, description, cover_url, is_public,
             price_cents, items, created_at
      FROM playlists
      WHERE owner_profile_id = ${profile.id} AND kind = 'bundle'
      ORDER BY created_at DESC
    `);
    const bundles: ReturnType<typeof bundleJson>[] = [];
    for (const r of rows.rows) {
      const row = r as Record<string, unknown>;
      const refs = parseBundleRefs(row);
      const contents: Awaited<ReturnType<typeof lightComponent>>[] = [];
      for (const ref of refs) contents.push(await lightComponent(ref));
      const countRows = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM digital_sales
        WHERE item_kind = 'bundle' AND item_id = ${String(row["id"])}
      `);
      const salesCount = Number((countRows.rows[0] as Record<string, unknown>)?.["c"] ?? 0);
      const sellable = !!row["is_public"] && Number(row["price_cents"] ?? 0) > 0
        && contents.length >= BUNDLE_MIN_COMPONENTS && contents.every((c) => c.sellable);
      bundles.push(bundleJson(row, contents, { sellable, salesCount }));
    }
    /* The component catalog: everything of the seller's that checkout
       would accept right now — the picker can only offer real bundles. */
    const sellable: { kind: string; id: string; title: string; listPriceCents: number; listPrice: string }[] = [];
    const candidateQueries: { kind: string; q: ReturnType<typeof sql> }[] = [
      { kind: "track", q: sql`SELECT id FROM profile_tracks WHERE profile_id = ${profile.id} AND is_published AND file_url IS NOT NULL AND file_url <> ''` },
      { kind: "video", q: sql`SELECT id FROM profile_videos WHERE profile_id = ${profile.id} AND is_published AND file_url IS NOT NULL AND file_url <> ''` },
      { kind: "series", q: sql`SELECT id FROM playlists WHERE owner_profile_id = ${profile.id} AND kind = 'series' AND is_public AND price_cents > 0` },
    ];
    for (const { kind, q } of candidateQueries) {
      const cand = await db.execute(q);
      for (const cr of cand.rows) {
        const cid = String((cr as Record<string, unknown>)["id"]);
        const resolved = await resolveSellableItem(kind, cid);
        if ("notForSale" in resolved || "notWired" in resolved) continue;
        if (resolved.profileId !== profile.id) continue;
        const lp = bundleComponentListPriceCents(resolved);
        sellable.push({ kind, id: cid, title: resolved.title, listPriceCents: lp, listPrice: money(lp) });
      }
    }
    res.json({ bundles, sellable });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] bundles list failed");
    res.status(500).json({ error: "Could not load your bundles." });
  }
});

router.patch("/store/bundles/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid bundle id." });
    return;
  }
  const parsed = UpdateBundleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const existing = await loadBundleRow(id);
    if (!existing) {
      res.status(404).json({ error: "Bundle not found." });
      return;
    }
    if (String(existing["owner_profile_id"]) !== profile.id) {
      res.status(403).json({ error: "NOT_YOURS", message: "That bundle isn't yours." });
      return;
    }
    let components: BundleComponent[] | null = null;
    if (parsed.data.items) {
      const check = await validateBundleComponents(profile.id, parsed.data.items);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error, message: check.message });
        return;
      }
      components = check.components;
    }
    const merged: Record<string, unknown> = {
      ...existing,
      title: parsed.data.title ?? existing["title"],
      description: parsed.data.description ?? existing["description"],
      cover_url: parsed.data.coverUrl !== undefined ? parsed.data.coverUrl : existing["cover_url"],
      is_public: parsed.data.isPublic ?? existing["is_public"],
      price_cents: parsed.data.priceCents ?? existing["price_cents"],
      items: parsed.data.items ?? parseBundleRefs(existing),
    };
    await db.execute(sql`
      UPDATE playlists
      SET title = ${String(merged["title"])}, description = ${String(merged["description"] ?? "")},
          cover_url = ${(merged["cover_url"] as string | null) ?? null},
          is_public = ${!!merged["is_public"]}, price_cents = ${Number(merged["price_cents"])},
          items = ${JSON.stringify(merged["items"])}::jsonb
      WHERE id = ${id} AND owner_profile_id = ${profile.id}
    `);
    const contents = components
      ?? (await Promise.all(parseBundleRefs(merged).map((ref) => lightComponent(ref))));
    logger.info({ userId: req.userId, bundleId: id }, "[store] bundle updated");
    res.json({
      bundle: bundleJson(merged, contents),
      note: "Changes apply to new sales — past buyers keep exactly what they bought.",
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] bundle update failed");
    res.status(500).json({ error: "Could not update the bundle." });
  }
});

/* ── GET /api/store/checklist — the Get Paid checklist ────────────────────
   product live → priced → first sale → logged. The finale the seller owns. */
router.get("/store/checklist", requireAuth, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const pid = profile.id;
    const live = await db.execute(sql`
      SELECT (SELECT COUNT(*)::int FROM profile_tracks WHERE profile_id = ${pid} AND is_published)
           + (SELECT COUNT(*)::int FROM profile_videos WHERE profile_id = ${pid} AND is_published)
           AS c
    `);
    const priced = await db.execute(sql`
      SELECT (SELECT COUNT(*)::int FROM profile_tracks WHERE profile_id = ${pid} AND is_published AND download_price_cents > 0)
           + (SELECT COUNT(*)::int FROM profile_videos WHERE profile_id = ${pid} AND is_published AND download_price_cents > 0)
           AS c
    `);
    const salesCount = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM digital_sales WHERE profile_id = ${pid}
    `);
    const firstDrop = await db.execute(sql`
      SELECT item_kind, item_id FROM digital_sales WHERE profile_id = ${pid}
      ORDER BY created_at ASC LIMIT 1
    `);
    const firstPriced = await db.execute(sql`
      SELECT 'track' AS kind, id FROM profile_tracks
      WHERE profile_id = ${pid} AND is_published AND download_price_cents > 0
      UNION ALL
      SELECT 'video' AS kind, id FROM profile_videos
      WHERE profile_id = ${pid} AND is_published AND download_price_cents > 0
      LIMIT 1
    `);
    const loggedCount = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM money_entries
      WHERE user_id = ${req.userId!} AND entry_type = 'income' AND note LIKE 'Music store sale %'
    `);

    const liveCount = Number((live.rows[0] as Record<string, unknown>)["c"]);
    const pricedCount = Number((priced.rows[0] as Record<string, unknown>)["c"]);
    const saleCount = Number((salesCount.rows[0] as Record<string, unknown>)["c"]);
    const logged = Number((loggedCount.rows[0] as Record<string, unknown>)["c"]);
    const fdrop = firstDrop.rows[0] as Record<string, unknown> | undefined;
    const fpriced = firstPriced.rows[0] as Record<string, unknown> | undefined;

    const steps = [
      {
        id: "list",
        label: "List your first product",
        detail:
          liveCount > 0
            ? `${liveCount} live ${liveCount === 1 ? "drop" : "drops"} on your profile`
            : "Tracks, videos, courses, packs — your content, your store",
        done: liveCount > 0,
        cta: { label: "View your profile", href: `/artist/${profile.slug}` },
      },
      {
        id: "price",
        label: "Put a price on it",
        detail:
          pricedCount > 0
            ? `${pricedCount} priced for sale`
            : "One tap: smart price from your vertical's benchmarks",
        done: pricedCount > 0,
        cta: { label: "Price your content", href: "#pricing" },
      },
      {
        id: "promote",
        label: "Share your drop link",
        detail: "Every drop page has one-tap share — fans can't buy what they can't find",
        done: saleCount > 0,
        cta: fpriced
          ? {
              label: "Share your first drop",
              href: `/store/buy/${String(fpriced["kind"])}/${String(fpriced["id"])}`,
            }
          : { label: "Price something first", href: "#pricing" },
      },
      {
        id: "sale",
        label: "Make your first sale",
        detail:
          saleCount > 0
            ? `${saleCount} ${saleCount === 1 ? "sale" : "sales"} — you just got paid 👑`
            : "The moment the first payment lands, you get pinged instantly",
        done: saleCount > 0,
        cta: fdrop
          ? {
              label: "See what sold",
              href: `/store/buy/${String(fdrop["item_kind"])}/${String(fdrop["item_id"])}`,
            }
          : { label: "How pricing works", href: "#pricing" },
      },
      {
        id: "log",
        label: "Log it in the Money Tracker",
        detail:
          saleCount > 0
            ? logged >= saleCount
              ? "Every sale logged — your books are clean"
              : `${saleCount - logged} sale${saleCount - logged === 1 ? "" : "s"} waiting to be logged`
            : "One tap per sale — your income ledger builds itself",
        done: saleCount > 0 && logged >= saleCount,
        cta: { label: "Open Money Tracker", href: "/coach?tab=money" },
      },
    ];
    res.json({ steps, complete: steps.every((s) => s.done), profileUrl: `/artist/${profile.slug}` });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] checklist failed");
    res.status(500).json({ error: "Could not load your checklist." });
  }
});

export default router;
