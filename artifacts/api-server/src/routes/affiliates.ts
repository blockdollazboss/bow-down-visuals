import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { bpsToPct, formatUsd } from "../lib/platform-fees";
import {
  claimAffiliateCode,
  fetchAffiliateCode,
  fetchAffiliateProductSetting,
  affiliateSharePath,
  type AffiliateSurface,
} from "../lib/affiliates";

/* ── Creator Product Affiliates (#16, migration 0205) ────────────────────
   The affiliate desk API. Product SETTINGS live on the product rails
   (PATCH /storefront/products/:id, PATCH /shops/:id/products/:id) — this
   router owns codes, offers and the money-desk read:

     POST /affiliates/codes              fan claims a share code for a product
     GET  /affiliates/codes/mine         my codes + share links + per-code sales
     POST /affiliates/codes/:id/deactivate
     GET  /affiliates/offers             products open to affiliates (both rails)
     GET  /affiliates/desk               money desk: as-seller + as-affiliate
     GET  /affiliates/resolve/:code      public: what a share link points at

   Money truth: commissions are a creator-set % of the SELLER's net,
   recorded as 'owed' in affiliate_sales when a sale lands (see
   lib/affiliates). Nothing here moves money or marks anything paid —
   settlement rides the existing creator-payout rails. */

const router = Router();

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ClaimCodeSchema = z.object({
  surface: z.enum(["store_product", "shop_product"]),
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
});

function presentCode(row: Record<string, unknown>, setting: { shopHandle: string | null; profileSlug: string | null } | null) {
  const surface = String(row["surface"]) as AffiliateSurface;
  const productId = String(row["product_id"]);
  const path = setting
    ? affiliateSharePath(surface, { enabled: true, commissionBps: null, sellerUserId: "", title: "", priceCents: 0, shopHandle: setting.shopHandle, profileSlug: setting.profileSlug }, productId)
    : surface === "shop_product" ? `/shop` : `/storefront/product/${productId}`;
  return {
    id: String(row["id"]),
    code: String(row["code"]),
    surface,
    productId,
    sellerUserId: String(row["seller_user_id"]),
    isActive: row["is_active"] === true,
    createdAt: row["created_at"],
    sharePath: path,
    shareLink: `${path}?ref=${String(row["code"])}`,
  };
}

router.post("/affiliates/codes", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = ClaimCodeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.issues });
    return;
  }
  try {
    const result = await claimAffiliateCode({
      affiliateUserId: req.userId!,
      surface: parsed.data.surface,
      productId: parsed.data.productId,
    });
    if (!result.ok) {
      res.status(400).json({ error: "CANNOT_CLAIM", message: result.reason });
      return;
    }
    const setting = await fetchAffiliateProductSetting(parsed.data.surface, parsed.data.productId);
    res.status(result.created ? 201 : 200).json({
      code: presentCode(result.code as unknown as Record<string, unknown>, setting),
      created: result.created,
      commissionBps: setting?.commissionBps ?? null,
      commissionPct: setting?.commissionBps != null ? bpsToPct(setting.commissionBps) : null,
      note: "Share the link — when someone buys through it, the commission the creator set is recorded as owed to you. It comes out of the creator's cut, never added to the buyer's price.",
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[affiliates] code claim failed");
    res.status(500).json({ error: "Could not create your affiliate code." });
  }
});

router.get("/affiliates/codes/mine", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`
      SELECT c.id, c.code, c.affiliate_user_id, c.seller_user_id, c.surface, c.product_id,
             c.is_active, c.created_at
      FROM affiliate_codes c
      WHERE c.affiliate_user_id = ${req.userId!}
      ORDER BY c.created_at DESC
      LIMIT 200
    `);
    /* Per-code sales aggregates, grouped by status and merged here —
       owed vs paid must never blur (a FILTER aggregate is how they'd
       blur if an engine mis-evaluates it). */
    const agg = await db.execute(sql`
      SELECT affiliate_code_id, status, COUNT(*)::int AS n,
             COALESCE(SUM(commission_cents), 0)::int AS cents
      FROM affiliate_sales
      WHERE affiliate_user_id = ${req.userId!}
      GROUP BY affiliate_code_id, status
    `);
    const byCode = new Map<string, { sales: number; owed: number; paid: number }>();
    for (const a of agg.rows as Array<Record<string, unknown>>) {
      const key = String(a["affiliate_code_id"]);
      const cur = byCode.get(key) ?? { sales: 0, owed: 0, paid: 0 };
      cur.sales += Number(a["n"] ?? 0);
      if (a["status"] === "owed") cur.owed += Number(a["cents"] ?? 0);
      if (a["status"] === "paid") cur.paid += Number(a["cents"] ?? 0);
      byCode.set(key, cur);
    }
    const codes = [];
    for (const raw of r.rows as Array<Record<string, unknown>>) {
      const setting = await fetchAffiliateProductSetting(String(raw["surface"]) as AffiliateSurface, String(raw["product_id"]));
      const totals = byCode.get(String(raw["id"])) ?? { sales: 0, owed: 0, paid: 0 };
      codes.push({
        ...presentCode(raw, setting),
        productTitle: setting?.title ?? "",
        salesCount: totals.sales,
        owedCents: totals.owed,
        owed: formatUsd(totals.owed),
        paidCents: totals.paid,
        paid: formatUsd(totals.paid),
      });
    }
    res.json({ codes });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[affiliates] my codes failed");
    res.status(500).json({ error: "Could not load your affiliate codes." });
  }
});

router.post("/affiliates/codes/:id/deactivate", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid code id." });
    return;
  }
  try {
    const r = await db.execute(sql`
      UPDATE affiliate_codes SET is_active = false
      WHERE id = ${id} AND affiliate_user_id = ${req.userId!}
      RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Code not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "[affiliates] deactivate failed");
    res.status(500).json({ error: "Could not deactivate that code." });
  }
});

/* Products open to affiliates, both rails, excluding the caller's own
   (a creator can't affiliate their own product — claim refuses too). */
router.get("/affiliates/offers", requireAuth, async (req, res) => {
  try {
    const store = await db.execute(sql`
      SELECT sp.id, sp.title, sp.price_cents, sp.affiliate_commission_bps,
             cp.user_id AS seller_user_id, cp.display_name AS seller_name, cp.slug AS profile_slug
      FROM store_products sp
      JOIN creator_profiles cp ON cp.id = sp.profile_id
      WHERE sp.affiliate_enabled = true AND sp.affiliate_commission_bps IS NOT NULL
        AND sp.is_active = true AND cp.user_id != ${req.userId!}
      ORDER BY sp.created_at DESC
      LIMIT 100
    `);
    const shop = await db.execute(sql`
      SELECT p.id, p.name AS title, p.price_cents, p.affiliate_commission_bps,
             p.user_id AS seller_user_id, s.name AS seller_name, s.handle AS shop_handle
      FROM shop_products p
      JOIN shops s ON s.id = p.shop_id
      WHERE p.affiliate_enabled = true AND p.affiliate_commission_bps IS NOT NULL
        AND p.status = 'active' AND p.user_id != ${req.userId!}
      ORDER BY p.created_at DESC
      LIMIT 100
    `);
    const offers = [
      ...(store.rows as Array<Record<string, unknown>>).map((r) => ({
        surface: "store_product" as const,
        productId: String(r["id"]),
        title: String(r["title"] ?? ""),
        priceCents: Number(r["price_cents"] ?? 0),
        price: formatUsd(Number(r["price_cents"] ?? 0)),
        sellerUserId: String(r["seller_user_id"]),
        sellerName: String(r["seller_name"] ?? ""),
        commissionBps: Number(r["affiliate_commission_bps"]),
        commissionPct: bpsToPct(Number(r["affiliate_commission_bps"])),
        productPath: `/storefront/product/${String(r["id"])}`,
      })),
      ...(shop.rows as Array<Record<string, unknown>>).map((r) => ({
        surface: "shop_product" as const,
        productId: String(r["id"]),
        title: String(r["title"] ?? ""),
        priceCents: Number(r["price_cents"] ?? 0),
        price: formatUsd(Number(r["price_cents"] ?? 0)),
        sellerUserId: String(r["seller_user_id"]),
        sellerName: String(r["seller_name"] ?? ""),
        commissionBps: Number(r["affiliate_commission_bps"]),
        commissionPct: bpsToPct(Number(r["affiliate_commission_bps"])),
        productPath: `/shop/${String(r["shop_handle"] ?? "")}`,
      })),
    ];
    res.json({ offers });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[affiliates] offers failed");
    res.status(500).json({ error: "Could not load affiliate offers." });
  }
});

/* ── The money desk ──────────────────────────────────────────────────────
   As SELLER: who is selling my products, how many attributed sales, how
   much commission I owe / has been paid. As AFFILIATE: what I've earned
   reselling, owed vs paid, per product. Commission owed is a liability
   recorded at sale time; 'paid' only ever appears when the existing
   payout rails settle it — this read never invents a payment. */
router.get("/affiliates/desk", requireAuth, async (req, res) => {
  const userId = req.userId!;
  try {
    /* Grouped by status and merged in JS — owed vs paid never blur. */
    const sellerRows = await db.execute(sql`
      SELECT s.affiliate_user_id, s.affiliate_code_id, c.code, s.status,
             COUNT(*)::int AS sales_count,
             COALESCE(SUM(s.gross_cents), 0)::int AS gross_cents,
             COALESCE(SUM(s.commission_cents), 0)::int AS commission_cents
      FROM affiliate_sales s
      JOIN affiliate_codes c ON c.id = s.affiliate_code_id
      WHERE s.seller_user_id = ${userId}
      GROUP BY s.affiliate_user_id, s.affiliate_code_id, c.code, s.status
      LIMIT 400
    `);
    const affiliateRows = await db.execute(sql`
      SELECT s.surface, s.product_id, s.product_title, s.seller_user_id, s.status,
             COUNT(*)::int AS sales_count,
             COALESCE(SUM(s.gross_cents), 0)::int AS gross_cents,
             COALESCE(SUM(s.commission_cents), 0)::int AS commission_cents
      FROM affiliate_sales s
      WHERE s.affiliate_user_id = ${userId}
      GROUP BY s.surface, s.product_id, s.product_title, s.seller_user_id, s.status
      LIMIT 400
    `);
    const recent = await db.execute(sql`
      SELECT id, surface, product_id, product_title, order_ref, gross_cents,
             platform_fee_cents, seller_net_cents, commission_bps, commission_cents,
             status, affiliate_user_id, seller_user_id, created_at
      FROM affiliate_sales
      WHERE seller_user_id = ${userId} OR affiliate_user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    interface DeskRow { salesCount: number; grossCents: number; owedCents: number; paidCents: number }
    const blank = (): DeskRow => ({ salesCount: 0, grossCents: 0, owedCents: 0, paidCents: 0 });
    const fold = (cur: DeskRow, r: Record<string, unknown>): DeskRow => {
      cur.salesCount += Number(r["sales_count"] ?? 0);
      cur.grossCents += Number(r["gross_cents"] ?? 0);
      if (r["status"] === "owed") cur.owedCents += Number(r["commission_cents"] ?? 0);
      if (r["status"] === "paid") cur.paidCents += Number(r["commission_cents"] ?? 0);
      return cur;
    };
    const sellerMap = new Map<string, DeskRow & { affiliateUserId: string; code: string }>();
    for (const r of sellerRows.rows as Array<Record<string, unknown>>) {
      const key = String(r["affiliate_code_id"]);
      const cur = sellerMap.get(key) ?? { ...blank(), affiliateUserId: String(r["affiliate_user_id"]), code: String(r["code"]) };
      sellerMap.set(key, fold(cur, r));
    }
    const affiliateMap = new Map<string, DeskRow & { surface: string; productId: string | null; productTitle: string; sellerUserId: string }>();
    for (const r of affiliateRows.rows as Array<Record<string, unknown>>) {
      const key = `${String(r["surface"])}:${String(r["product_id"])}:${String(r["seller_user_id"])}`;
      const cur = affiliateMap.get(key) ?? {
        ...blank(),
        surface: String(r["surface"]),
        productId: r["product_id"] ? String(r["product_id"]) : null,
        productTitle: String(r["product_title"] ?? ""),
        sellerUserId: String(r["seller_user_id"]),
      };
      affiliateMap.set(key, fold(cur, r));
    }
    const present = (r: DeskRow) => ({
      salesCount: r.salesCount,
      grossCents: r.grossCents,
      owedCents: r.owedCents,
      owed: formatUsd(r.owedCents),
      paidCents: r.paidCents,
      paid: formatUsd(r.paidCents),
    });
    const asSeller = [...sellerMap.values()]
      .sort((a, b) => b.owedCents - a.owedCents)
      .map((r) => ({ affiliateUserId: r.affiliateUserId, code: r.code, ...present(r) }));
    const asAffiliate = [...affiliateMap.values()]
      .sort((a, b) => b.owedCents - a.owedCents)
      .map((r) => ({ surface: r.surface, productId: r.productId, productTitle: r.productTitle, sellerUserId: r.sellerUserId, ...present(r) }));
    const sum = (rows: Array<{ owedCents: number; paidCents: number; salesCount: number }>) => ({
      salesCount: rows.reduce((s, r) => s + r.salesCount, 0),
      owedCents: rows.reduce((s, r) => s + r.owedCents, 0),
      owed: formatUsd(rows.reduce((s, r) => s + r.owedCents, 0)),
      paidCents: rows.reduce((s, r) => s + r.paidCents, 0),
      paid: formatUsd(rows.reduce((s, r) => s + r.paidCents, 0)),
    });
    res.json({
      asSeller: { affiliates: asSeller, totals: sum(asSeller) },
      asAffiliate: { products: asAffiliate, totals: sum(asAffiliate) },
      recentSales: (recent.rows as Array<Record<string, unknown>>).map((r) => ({
        id: String(r["id"]),
        surface: String(r["surface"]),
        productTitle: String(r["product_title"] ?? ""),
        grossCents: Number(r["gross_cents"] ?? 0),
        platformFeeCents: Number(r["platform_fee_cents"] ?? 0),
        sellerNetCents: Number(r["seller_net_cents"] ?? 0),
        commissionBps: Number(r["commission_bps"] ?? 0),
        commissionPct: bpsToPct(Number(r["commission_bps"] ?? 0)),
        commissionCents: Number(r["commission_cents"] ?? 0),
        commission: formatUsd(Number(r["commission_cents"] ?? 0)),
        status: String(r["status"]),
        mine: String(r["affiliate_user_id"]) === userId ? "earned" : "owed",
        createdAt: r["created_at"],
      })),
      note: "Commissions come out of the seller's cut — the platform fee stays 5% and buyers never pay extra. Owed commissions are recorded at sale time and settle through the same payout rails as creator earnings.",
    });
  } catch (err) {
    logger.error({ err, userId }, "[affiliates] desk failed");
    res.status(500).json({ error: "Could not load the affiliate desk." });
  }
});

/* Public: what a share link points at — lets buy pages show "shared by a
   fan · creator pays them X% of their cut" honestly before checkout. */
router.get("/affiliates/resolve/:code", publicApiLimiter, async (req, res) => {
  const codeParam = String(req.params.code ?? "");
  try {
    const row = await fetchAffiliateCode(codeParam);
    if (!row || !row.is_active) {
      res.status(404).json({ error: "That affiliate link isn't active." });
      return;
    }
    const setting = await fetchAffiliateProductSetting(row.surface, String(row.product_id));
    if (!setting || !setting.enabled || setting.commissionBps == null) {
      res.status(404).json({ error: "That affiliate link isn't active." });
      return;
    }
    res.json({
      code: row.code,
      surface: row.surface,
      productId: String(row.product_id),
      productTitle: setting.title,
      priceCents: setting.priceCents,
      price: formatUsd(setting.priceCents),
      commissionBps: setting.commissionBps,
      commissionPct: bpsToPct(setting.commissionBps),
      productPath: affiliateSharePath(row.surface, setting, String(row.product_id)),
    });
  } catch (err) {
    logger.error({ err }, "[affiliates] resolve failed");
    res.status(500).json({ error: "Could not load that affiliate link." });
  }
});

export default router;
