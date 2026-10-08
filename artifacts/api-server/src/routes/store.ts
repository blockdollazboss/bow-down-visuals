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
 *  - Platform fee: 10% of every sale, taken from the SELLER's cut — the buyer
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

const router = Router();

/* ── Platform economics ──────────────────────────────────────────────────
   10% platform fee (same knob as storefronts — one fee site-wide). Fee comes
   out of the seller's cut; the buyer pays the listed price, nothing extra. */
const PLATFORM_FEE_BPS = STOREFRONT_PLATFORM_FEE_BPS;
export const PLATFORM_FEE_PCT = PLATFORM_FEE_BPS / 100;

/* ── Download token rules ──────────────────────────────────────────────── */
const DOWNLOAD_TTL_HOURS = 48;
const DOWNLOAD_MAX_USES = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ItemKindSchema = z.enum(DIGITAL_ITEM_KINDS);

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
   profile_videos. album/pack/digital are valid store kinds (migration 0090)
   but their catalog entities haven't shipped yet — they 400 with a clear
   message instead of silently failing. */
interface SellableItem {
  profileId: string;
  itemKind: string;
  title: string;
  priceCents: number;
  fileUrl: string;
  artworkUrl: string | null;
  artistName: string;
  artistSlug: string;
}

async function resolveSellableItem(
  kind: string,
  id: string
): Promise<SellableItem | { notForSale: true } | { notWired: true }> {
  if (!UUID_RE.test(id)) return { notForSale: true };
  if (kind === "track" || kind === "video") {
    const table = kind === "track" ? "profile_tracks" : "profile_videos";
    const fileCol = kind === "track" ? "audio_url" : "video_url";
    const artCol = kind === "track" ? "artwork_url" : "thumbnail_url";
    const result = await db.execute(sql`
      SELECT m.id, m.profile_id, m.title, m.download_price_cents, m.is_published,
             m.${sql.raw(fileCol)} AS file_url, m.${sql.raw(artCol)} AS artwork_url,
             p.display_name AS artist_name, p.slug AS artist_slug
      FROM ${sql.raw(table)} m
      JOIN creator_profiles p ON p.id = m.profile_id
      WHERE m.id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || !row["is_published"] || !Number(row["download_price_cents"]) || !row["file_url"]) {
      return { notForSale: true };
    }
    return {
      profileId: String(row["profile_id"]),
      itemKind: kind,
      title: String(row["title"]),
      priceCents: Number(row["download_price_cents"]),
      fileUrl: String(row["file_url"]),
      artworkUrl: (row["artwork_url"] as string | null) ?? null,
      artistName: String(row["artist_name"]),
      artistSlug: String(row["artist_slug"]),
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

/* ── GET /api/store/item/:kind/:id — public buy-page data ─────────────── */
router.get("/store/item/:kind/:id", publicApiLimiter, async (req, res) => {
  const kind = String(req.params.kind ?? "");
  const id = String(req.params.id ?? "");
  if (!DIGITAL_ITEM_KINDS.includes(kind as (typeof DIGITAL_ITEM_KINDS)[number])) {
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
        message: `Selling ${kind} bundles isn't wired up yet — tracks and videos are live today.`,
      });
      return;
    }
    const { feeCents, creatorCents } = splitFee(item.priceCents);
    res.json({
      item: {
        kind: item.itemKind,
        id,
        title: item.title,
        artworkUrl: item.artworkUrl,
        artistName: item.artistName,
        artistSlug: item.artistSlug,
        priceCents: item.priceCents,
        price: money(item.priceCents),
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
});

router.post("/store/checkout", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CheckoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { kind, id } = parsed.data;

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
        message: `Selling ${kind} bundles isn't wired up yet — tracks and videos are live today.`,
      });
      return;
    }
    const { feeCents, creatorCents } = splitFee(item.priceCents);
    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: item.priceCents,
            product_data: {
              name: `${item.title} — ${item.artistName}`,
              description: `Digital download · ${kind}`,
              images: item.artworkUrl ? [item.artworkUrl] : undefined,
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
      },
    });

    logger.info(
      { userId: req.userId, kind, id, priceCents: item.priceCents, sessionId: session.id },
      "[store] checkout session created"
    );
    res.json({ url: session.url, sessionId: session.id });
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

  /* Re-resolve the item for the file URL (price ground truth = Stripe). */
  let fileUrl: string;
  try {
    const item = await resolveSellableItem(kind, itemId);
    if ("notForSale" in item || "notWired" in item) {
      res.status(400).json({ error: "This content is no longer for sale." });
      return;
    }
    fileUrl = item.fileUrl;
  } catch (err) {
    logger.error({ err, sessionId }, "[store] verify: item re-resolve failed");
    res.status(500).json({ error: "Could not locate the purchased file." });
    return;
  }

  const amountCents = session.amount_total ?? 0;
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

    const link = await mintDownloadLink(saleId, fileUrl);
    res.json({
      success: true,
      duplicate,
      sale: {
        id: saleId,
        itemKind: kind,
        amountCents,
        amount: money(amountCents),
        platformFeeCents: feeCents,
        creatorAmountCents: creatorCents,
      },
      download: {
        token: link.token,
        url: `/api/store/download/${link.token}`,
        expiresAt: link.expiresAt.toISOString(),
        maxUses: DOWNLOAD_MAX_USES,
      },
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
    ${ok ? `<div class="meta">${usesLeft ?? 0} download${(usesLeft ?? 0) === 1 ? "" : "s"} left · link expires ${safe(expiresAt ?? "")}<br/>Lost this file? Re-download anytime from <b>My Music</b> on Bow Down Visuals.</div>` : ""}
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
        fileUrl: String(row["file_url"]),
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
             COALESCE(t.title, v.title) AS item_title,
             COALESCE(t.artwork_url, v.thumbnail_url) AS artwork_url
      FROM digital_sales ds
      LEFT JOIN creator_profiles cp ON cp.id = ds.profile_id
      LEFT JOIN profile_tracks t ON ds.item_kind = 'track' AND t.id = ds.item_id
      LEFT JOIN profile_videos v ON ds.item_kind = 'video' AND v.id = ds.item_id
      WHERE ds.buyer_user_id = ${req.userId!}
      ORDER BY ds.created_at DESC
      LIMIT 200
    `);
    res.json({
      purchases: result.rows.map((r) => {
        const row = r as Record<string, unknown>;
        const cents = Number(row["amount_cents"]);
        return {
          id: String(row["id"]),
          itemKind: String(row["item_kind"]),
          itemId: String(row["item_id"]),
          title: String(row["item_title"] ?? "Content"),
          artistName: String(row["artist_name"] ?? "Creator"),
          artistSlug: String(row["artist_slug"] ?? ""),
          artworkUrl: (row["artwork_url"] as string | null) ?? null,
          amountCents: cents,
          amount: money(cents),
          purchasedAt: String(row["created_at"]),
          receiptId: String(row["stripe_session_id"] ?? row["id"]),
        };
      }),
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
      LIMIT 1
    `);
    const srow = sale.rows[0] as Record<string, unknown> | undefined;
    if (!srow) {
      res.status(404).json({ error: "Purchase not found." });
      return;
    }
    const kind = String(srow["item_kind"]);
    const itemId = String(srow["item_id"]);
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
async function callerProfileId(userId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT id FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? String(row["id"]) : null;
}

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ── GET /api/store/sales — creator sales dashboard ────────────────────── */
router.get("/store/sales", requireAuth, async (req, res) => {
  try {
    const profileId = await callerProfileId(req.userId!);
    if (!profileId) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const sales = await db.execute(sql`
      SELECT ds.id, ds.item_kind, ds.item_id, ds.amount_cents,
             ds.platform_fee_cents, ds.creator_amount_cents, ds.created_at,
             COALESCE(t.title, v.title) AS item_title
      FROM digital_sales ds
      LEFT JOIN profile_tracks t ON ds.item_kind = 'track' AND t.id = ds.item_id
      LEFT JOIN profile_videos v ON ds.item_kind = 'video' AND v.id = ds.item_id
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
      return {
        id: String(row["id"]),
        itemKind: String(row["item_kind"]),
        itemTitle: String(row["item_title"] ?? "Content"),
        grossCents: gross,
        gross: money(gross),
        platformFeeCents: fee,
        platformFee: money(fee),
        creatorCents: net,
        creatorAmount: money(net),
        soldAt: String(row["created_at"]),
        loggedToTracker: loggedIds.has(String(row["id"])),
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
             COALESCE(t.title, v.title) AS item_title
      FROM digital_sales ds
      LEFT JOIN profile_tracks t ON ds.item_kind = 'track' AND t.id = ds.item_id
      LEFT JOIN profile_videos v ON ds.item_kind = 'video' AND v.id = ds.item_id
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

export default router;
