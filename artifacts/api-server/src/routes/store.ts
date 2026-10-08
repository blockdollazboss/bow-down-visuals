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
import { createJobNotification } from "../lib/job-notifications";

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

  let fileUrl: string;
  let itemTitle = "Your content";
  let artistName = "";
  let artistSlug = "";
  try {
    const item = await resolveSellableItem(kind, itemId);
    if ("notForSale" in item || "notWired" in item) {
      res.status(400).json({ error: "This content is no longer for sale." });
      return;
    }
    fileUrl = item.fileUrl;
    itemTitle = item.title;
    artistName = item.artistName;
    artistSlug = item.artistSlug;
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
      /* Link graph: no dead ends after payment — the highest-trust moment. */
      item: {
        kind,
        id: itemId,
        title: itemTitle,
        artistName,
        artistSlug,
        buyUrl: `/store/buy/${kind}/${itemId}`,
        artistUrl: artistSlug ? `/c/${artistSlug}` : null,
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
        const kind = String(row["item_kind"]);
        const itemId = String(row["item_id"]);
        const slug = String(row["artist_slug"] ?? "");
        return {
          id: String(row["id"]),
          itemKind: kind,
          itemId,
          title: String(row["item_title"] ?? "Content"),
          artistName: String(row["artist_name"] ?? "Creator"),
          artistSlug: slug,
          artworkUrl: (row["artwork_url"] as string | null) ?? null,
          amountCents: cents,
          amount: money(cents),
          purchasedAt: String(row["created_at"]),
          receiptId: String(row["stripe_session_id"] ?? row["id"]),
          /* Link graph: library → drop page, creator profile. */
          buyUrl: `/store/buy/${kind}/${itemId}`,
          artistUrl: slug ? `/c/${slug}` : null,
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
      profileUrl: `/c/${profile.slug}`,
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

function pricePointFor(vertical: string, kind: string): { point: PricePoint; vertical: string } {
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
  if (kind && !DIGITAL_ITEM_KINDS.includes(kind as (typeof DIGITAL_ITEM_KINDS)[number])) {
    res.status(400).json({ error: "Unknown content kind." });
    return;
  }
  const kinds = kind ? [kind] : [...DIGITAL_ITEM_KINDS];
  const guide: Record<string, ReturnType<typeof pricePointJson>> = {};
  for (const k of kinds) guide[k] = pricePointJson(pricePointFor(vertical, k).point);
  res.json({
    vertical: pricePointFor(vertical, kind || "track").vertical,
    verticalLabel: VERTICAL_LABELS[pricePointFor(vertical, kind || "track").vertical] ?? "Creator",
    verticals: STORE_VERTICALS.map((v) => ({ id: v, label: VERTICAL_LABELS[v] })),
    guide,
    note: "Benchmarks from what creators actually charge — a starting point, not a rule. You keep 90% of every sale.",
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
      SELECT id, title, download_price_cents, is_published, artwork_url
      FROM profile_tracks WHERE profile_id = ${profile.id}
      ORDER BY created_at DESC LIMIT 200
    `);
    const videos = await db.execute(sql`
      SELECT id, title, download_price_cents, is_published, thumbnail_url AS artwork_url
      FROM profile_videos WHERE profile_id = ${profile.id}
      ORDER BY created_at DESC LIMIT 200
    `);
    const map = (rows: Record<string, unknown>[], kind: string) =>
      rows.map((r) => {
        const price = Number(r["download_price_cents"]);
        const { creatorCents } = splitFee(price);
        return {
          kind,
          id: String(r["id"]),
          title: String(r["title"]),
          priceCents: price,
          price: money(price),
          youKeep: money(creatorCents),
          isPublished: !!r["is_published"],
          forSale: !!r["is_published"] && price > 0,
          artworkUrl: (r["artwork_url"] as string | null) ?? null,
          buyUrl: `/store/buy/${kind}/${String(r["id"])}`,
        };
      });
    const prof = await db.execute(sql`
      SELECT vertical FROM creator_profiles WHERE id = ${profile.id} LIMIT 1
    `);
    const vertical = String((prof.rows[0] as Record<string, unknown> | undefined)?.["vertical"] ?? "other");
    res.json({
      vertical,
      verticalLabel: VERTICAL_LABELS[vertical] ?? "Creator",
      profileUrl: `/c/${profile.slug}`,
      products: [
        ...map(tracks.rows as Record<string, unknown>[], "track"),
        ...map(videos.rows as Record<string, unknown>[], "video"),
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
});

router.patch("/store/price", requireAuth, async (req, res) => {
  const parsed = SetPriceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { kind, id, priceCents } = parsed.data;
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You don't have a creator profile yet." });
      return;
    }
    const table = kind === "track" ? "profile_tracks" : "profile_videos";
    const updated = await db.execute(sql`
      UPDATE ${sql.raw(table)}
      SET download_price_cents = ${priceCents}
      WHERE id = ${id} AND profile_id = ${profile.id}
      RETURNING id, title, download_price_cents, is_published
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
        buyUrl: `/store/buy/${kind}/${id}`,
      },
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] set-price failed");
    res.status(500).json({ error: "Could not set the price." });
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
        cta: { label: "View your profile", href: `/c/${profile.slug}` },
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
    res.json({ steps, complete: steps.every((s) => s.done), profileUrl: `/c/${profile.slug}` });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[store] checklist failed");
    res.status(500).json({ error: "Could not load your checklist." });
  }
});

export default router;
