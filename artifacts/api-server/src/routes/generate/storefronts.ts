/**
 * storefronts.ts — Customer Storefronts platform layer.
 *
 * Bow Down Visuals becomes the platform: every customer gets their OWN shop,
 * browsable in a public hub, with custom domains and per-shop analytics.
 *
 * Endpoints:
 *   GET    /api/storefronts                      public hub (search, product counts)
 *   GET    /api/storefronts/slug/:slug           public storefront + records a view
 *   GET    /api/storefronts/:id/analytics        owner-only: views + sales
 *   POST   /api/storefronts/checkout             record a sale (10% platform fee)
 *   POST   /api/storefronts/:id/domain           attach a custom domain (Pro+)
 *   POST   /api/storefronts/domain/verify        verify domain via DNS TXT
 *   DELETE /api/storefronts/:id/domain           detach a custom domain
 *
 * Money rules (standing): shops themselves require a paid tier (Pro or
 * higher). Shop/product CRUD is FREE (pure data). The 10% platform fee is
 * taken from the seller's cut on every recorded sale — the buyer never pays
 * extra. Views/sales analytics are FREE to view.
 *
 * Queries use raw SQL via db.execute(sql``) — pg-mem (vitest) cannot
 * handle the drizzle query builder's rowMode:'array'.
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID, createHash } from "crypto";
import { promises as dns } from "dns";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../../middlewares/require-auth";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";

const router = Router();

/* ── Platform economics — env-overridable without a deploy ─────────────── */
export const STOREFRONT_PLATFORM_FEE_BPS =
  Number(process.env["STOREFRONT_PLATFORM_FEE_BPS"]) || 1000; // 1000 bps = 10%
export const PLATFORM_FEE_PCT = STOREFRONT_PLATFORM_FEE_BPS / 100;

/**
 * "Pro or higher" tier gate. Plan names on the pricing page: Creator,
 * Pro Artist, Studio, VIP, MVP. Shops + custom domains require Pro Artist
 * or above — free / Creator plans are redirected to /pricing.
 */
export function meetsProTier(plan: string | null | undefined): boolean {
  const p = (plan ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!p) return false;
  return (
    p.includes("pro") ||
    p.includes("studio") ||
    p.includes("vip") ||
    p.includes("mvp")
  );
}

export function requireProTier(req: any, res: any, next: any) {
  if (meetsProTier(req.userPlan)) return next();
  res.status(403).json({
    error: "PRO_TIER_REQUIRED",
    message:
      "Storefronts require a Pro plan or higher. Upgrade to open your own shop.",
    upgradeUrl: "/pricing",
  });
}

/* ── Domain rules ──────────────────────────────────────────────────────────
   Real verification: the owner publishes a TXT record at
   bdv-verify.<domain> containing the issued token. We never fake this. */
const DOMAIN_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/;
const VERIFY_HOST_PREFIX = "bdv-verify";

function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN_RE.test(d) || d.length > 253) return null;
  if (d.endsWith(".bowdownvisuals.com")) return null; // platform subdomains stay ours
  return d;
}

export function issueDomainToken(): string {
  return `bdv-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Pure: does any TXT record at the host match the token? */
export function txtRecordsMatch(records: string[][], token: string): boolean {
  for (const rec of records) {
    if (rec.join("").trim() === token) return true;
  }
  return false;
}

async function checkDomainTxt(domain: string, token: string): Promise<{ ok: boolean; reason: string }> {
  const host = `${VERIFY_HOST_PREFIX}.${domain}`;
  let records: string[][];
  try {
    records = await dns.resolveTxt(host);
  } catch (err: any) {
    const code = err?.code ?? "UNKNOWN";
    return {
      ok: false,
      reason:
        code === "ENOTFOUND" || code === "ENODATA"
          ? `No TXT record found at ${host} yet — DNS can take a few minutes to propagate.`
          : `DNS lookup failed (${code}). Try again in a minute.`,
    };
  }
  if (txtRecordsMatch(records, token)) return { ok: true, reason: "verified" };
  return {
    ok: false,
    reason: `TXT record at ${host} doesn't match the verification token yet.`,
  };
}

/* ── View dedup: one counted view per IP+shop per hour ───────────────────── */
function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`shop-view|${ip}`).digest("hex").slice(0, 32);
}

async function recordView(shopId: string, userId: string, ip: string | undefined) {
  const ipHash = hashIp(ip);
  try {
    if (ipHash) {
      const recent = await db.execute(sql`
        SELECT id FROM shop_events
        WHERE shop_id = ${shopId} AND event_type = 'view' AND ip_hash = ${ipHash}
          AND created_at > NOW() - INTERVAL '1 hour'
        LIMIT 1
      `);
      if ((recent.rows as unknown[]).length > 0) return;
    }
    await db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, ip_hash)
      VALUES (${randomUUID()}, ${shopId}, ${userId}, 'view', ${ipHash})
    `);
  } catch (err) {
    /* Analytics must never break the storefront. */
    logger.warn({ err, shopId }, "[storefronts] view record failed");
  }
}

async function getOwnedShopFull(shopId: string, userId: string) {
  const result = await db.execute(sql`
    SELECT id, user_id, name, handle, tagline, description,
           banner_color, accent_color, banner_image_url,
           custom_domain, domain_verified, domain_verification_token,
           created_at, updated_at
    FROM shops
    WHERE id = ${shopId} AND user_id = ${userId}
    LIMIT 1
  `);
  const rows = result.rows as unknown as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

/* ── GET /api/storefronts — public hub ─────────────────────────────────────
   Every creator shop on the platform. Free, no auth. */
router.get("/storefronts", async (req, res) => {
  const q = (Array.isArray(req.query.q) ? req.query.q[0] : req.query.q ?? "").toString().trim().slice(0, 60);
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 100);
  const where = q
    ? sql`WHERE (s.name ILIKE ${"%" + q + "%"} OR s.handle ILIKE ${"%" + q + "%"} OR COALESCE(s.tagline, '') ILIKE ${"%" + q + "%"})`
    : sql``;
  const result = await db.execute(sql`
    SELECT s.id, s.name, s.handle, s.tagline, s.description,
           s.banner_color, s.accent_color, s.banner_image_url,
           s.custom_domain, s.domain_verified, s.created_at,
           (SELECT COUNT(*)::int FROM shop_products p WHERE p.shop_id = s.id) AS product_count
    FROM shops s
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `);
  res.json({ shops: result.rows, platformFeePct: PLATFORM_FEE_PCT });
});

/* ── GET /api/storefronts/slug/:slug — public storefront + view ────────────
   No auth: anyone can view. Records a (deduped) view. Never leaks user_id. */
router.get("/storefronts/slug/:slug", async (req, res) => {
  const slug = (Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug ?? "").toLowerCase();
  const shopResult = await db.execute(sql`
    SELECT id, user_id, name, handle, tagline, description,
           banner_color, accent_color, banner_image_url,
           custom_domain, domain_verified, created_at
    FROM shops
    WHERE handle = ${slug}
    LIMIT 1
  `);
  const shops = shopResult.rows as unknown as Array<Record<string, unknown> & { id: string; user_id: string }>;
  const shop = shops[0];
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const productsResult = await db.execute(sql`
    SELECT id, name, price_cents, description, image_url, created_at
    FROM shop_products
    WHERE shop_id = ${shop.id}
    ORDER BY created_at ASC
    LIMIT 200
  `);
  const { user_id, ...publicShop } = shop;
  /* Fire-and-forget analytics — never blocks the page. */
  recordView(shop.id, user_id, req.ip);
  res.json({
    shop: publicShop,
    products: productsResult.rows,
    platformFeePct: PLATFORM_FEE_PCT,
  });
});

/* ── GET /api/storefronts/:id/analytics — owner-only ─────────────────────── */
router.get("/storefronts/:id/analytics", requireAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const shop = await getOwnedShopFull(id ?? "", req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const totals = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'view')::int AS views,
      COUNT(*) FILTER (WHERE event_type = 'sale')::int AS sales,
      COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'sale'), 0)::int AS gross_cents,
      COALESCE(SUM(platform_fee_cents) FILTER (WHERE event_type = 'sale'), 0)::int AS platform_fee_cents
    FROM shop_events
    WHERE shop_id = ${shop.id}
  `);
  const daily = await db.execute(sql`
    SELECT DATE_TRUNC('day', created_at)::date AS day,
           COUNT(*)::int AS views
    FROM shop_events
    WHERE shop_id = ${shop.id} AND event_type = 'view'
      AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  const sales = await db.execute(sql`
    SELECT e.id, e.product_id, p.name AS product_name,
           e.amount_cents, e.platform_fee_cents,
           (e.amount_cents - e.platform_fee_cents) AS seller_net_cents,
           e.buyer_email, e.created_at
    FROM shop_events e
    LEFT JOIN shop_products p ON p.id = e.product_id
    WHERE e.shop_id = ${shop.id} AND e.event_type = 'sale'
    ORDER BY e.created_at DESC
    LIMIT 100
  `);
  const t = (totals.rows as unknown as Array<Record<string, number>>)[0] ?? {
    views: 0, sales: 0, gross_cents: 0, platform_fee_cents: 0,
  };
  res.json({
    totals: {
      views: t.views,
      sales: t.sales,
      gross_cents: t.gross_cents,
      platform_fee_cents: t.platform_fee_cents,
      seller_net_cents: t.gross_cents - t.platform_fee_cents,
    },
    dailyViews: daily.rows,
    sales: sales.rows,
    platformFeePct: PLATFORM_FEE_PCT,
  });
});

/* ── POST /api/storefronts/checkout — record a sale ────────────────────────
   Order capture (no card processing yet — Stripe Connect is the follow-up).
   The 10% platform fee comes out of the SELLER's cut; the buyer pays the
   listed price. All money math in integer cents. */
const checkoutSchema = z.object({
  shopId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).default(1),
  buyerEmail: z.string().trim().email().max(254).optional().default(""),
});

router.post("/storefronts/checkout", publicApiLimiter, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order." });
    return;
  }
  const { shopId, productId, quantity, buyerEmail } = parsed.data;
  const prod = await db.execute(sql`
    SELECT p.id, p.shop_id, p.name, p.price_cents, s.user_id
    FROM shop_products p
    JOIN shops s ON s.id = p.shop_id
    WHERE p.id = ${productId} AND p.shop_id = ${shopId}
    LIMIT 1
  `);
  const rows = prod.rows as unknown as Array<{
    id: string; shop_id: string; name: string; price_cents: number; user_id: string;
  }>;
  const product = rows[0];
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const gross = product.price_cents * quantity;
  const fee = Math.round((gross * STOREFRONT_PLATFORM_FEE_BPS) / 10_000);
  const net = gross - fee;
  const saleId = randomUUID();
  await db.execute(sql`
    INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email)
    VALUES (${saleId}, ${shopId}, ${product.user_id}, 'sale', ${productId}, ${gross}, ${fee}, ${buyerEmail || null})
  `);
  res.status(201).json({
    saleId,
    productName: product.name,
    quantity,
    gross_cents: gross,
    platform_fee_cents: fee,
    platform_fee_pct: PLATFORM_FEE_PCT,
    seller_net_cents: net,
    buyerEmail: buyerEmail || null,
    note: "Order recorded. Card processing via Stripe Connect is coming soon — the seller follows up to complete payment.",
  });
});

/* ── POST /api/storefronts/:id/domain — attach a custom domain (Pro+) ────── */
const domainSchema = z.object({
  domain: z.string().trim().min(4).max(253),
});

router.post("/storefronts/:id/domain", publicApiLimiter, requireAuth, requireProTier, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const shop = await getOwnedShopFull(id ?? "", req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const parsed = domainSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "A valid domain is required (e.g. shop.yourname.com)." });
    return;
  }
  const domain = normalizeDomain(parsed.data.domain);
  if (!domain) {
    res.status(400).json({ error: "That doesn't look like a valid domain." });
    return;
  }
  const clash = await db.execute(sql`
    SELECT id FROM shops WHERE custom_domain = ${domain} AND id != ${shop.id} LIMIT 1
  `);
  if ((clash.rows as unknown[]).length > 0) {
    res.status(409).json({ error: "That domain is already connected to another shop." });
    return;
  }
  const token = issueDomainToken();
  await db.execute(sql`
    UPDATE shops
    SET custom_domain = ${domain},
        domain_verified = FALSE,
        domain_verification_token = ${token},
        updated_at = NOW()
    WHERE id = ${shop.id}
  `);
  res.json({
    domain,
    verified: false,
    verification: {
      type: "TXT",
      host: `${VERIFY_HOST_PREFIX}.${domain}`,
      value: token,
    },
    dns: {
      step1: `Add a TXT record at host "${VERIFY_HOST_PREFIX}" with the value above in your DNS provider (Cloudflare, GoDaddy, Namecheap…).`,
      step2: `Add a CNAME record: host "@" (or "shop") → cname.bowdownvisuals.com — this points your domain at your storefront.`,
      step3: `Come back here and hit "Verify domain". DNS can take a few minutes to propagate.`,
      cnameTarget: "cname.bowdownvisuals.com",
    },
  });
});

/* ── POST /api/storefronts/domain/verify — verify via DNS TXT ────────────── */
const verifySchema = z.object({
  shopId: z.string().uuid(),
});

router.post("/storefronts/domain/verify", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "shopId is required." });
    return;
  }
  const shop = await getOwnedShopFull(parsed.data.shopId, req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const domain = shop.custom_domain as string | null;
  const token = shop.domain_verification_token as string | null;
  if (!domain || !token) {
    res.status(400).json({ error: "No domain is waiting for verification on this shop." });
    return;
  }
  const check = await checkDomainTxt(domain, token);
  if (check.ok) {
    await db.execute(sql`
      UPDATE shops SET domain_verified = TRUE, updated_at = NOW() WHERE id = ${shop.id}
    `);
    logger.info({ shopId: shop.id, domain }, "[storefronts] domain verified");
  }
  res.json({ domain, verified: check.ok, reason: check.reason });
});

/* ── DELETE /api/storefronts/:id/domain — detach (Pro+ not required) ─────── */
router.delete("/storefronts/:id/domain", requireAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const shop = await getOwnedShopFull(id ?? "", req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  await db.execute(sql`
    UPDATE shops
    SET custom_domain = NULL, domain_verified = FALSE, domain_verification_token = NULL, updated_at = NOW()
    WHERE id = ${shop.id}
  `);
  res.json({ detached: true });
});

export default router;
