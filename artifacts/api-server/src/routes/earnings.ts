import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { tipJarPendingForUser } from "./generate/tip-jar";

/* ─── Unified earnings (Stack 8 #5) ──────────────────────────────────────
   ONE money picture per creator, read-only over the existing ledgers —
   no money movement, no new tables:
     storeSales   store_orders.creator_amount_cents (profile store,
                  status 'completed', via creator_profiles ownership)
                  + shop_events 'sale' net (amount − platform fee) from
                  the shops/storefronts surface
     memberships  fan_members.price_cents for verified paid checkouts
                  (stripe_session_id present — Stack 1's paid marker)
     tips         live_stream_tips.amount_vb actually credited to the
                  creator (creator_credited_at set) — Visual Bucs, kept
                  in its own unit, NEVER folded into the USD total;
                  plus tip-jar intents, which are pending_payment by
                  design (no real charge exists yet) and are reported
                  as pending, never as earnings
     brandDeals   sponsor_payouts.net_cents (escrow released, 15% fee
                  already taken) for this creator

   Honesty contract: a source with no rows reads 0 (status "ok"); a
   source whose query fails reads status "error" with null totals —
   never a fake 0 — and the response carries partial: true. The USD
   total sums only the sources that loaded.

   Deliberately NOT aggregated: money_entries (the manual Money
   Tracker) already receives postings from store sales and wave8
   mark-paid, so counting it here would double-count; and wave8
   pipeline deals are not earnings until paid — their paid postings
   live in the tracker by the creator's own action. */

const router = Router();

type SourceResult =
  | { status: "ok"; totalCents: number; count: number }
  | { status: "error"; totalCents: null; count: null };

const errSource = (): SourceResult => ({ status: "error", totalCents: null, count: null });

/* The four per-source readers are exported for ONE other caller:
   the Cloud Operator's Tier-0 earnings tool (lib/operator-tools),
   which reads the member's own picture through these same builders
   — never a parallel query — and applies the same per-source
   settle discipline the route below does. */

export async function storeSales(userId: string) {
  const orders = await db.execute(sql`
    SELECT COALESCE(SUM(o.creator_amount_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM store_orders o
    JOIN creator_profiles cp ON cp.id = o.profile_id
    WHERE cp.user_id = ${userId} AND o.status = 'completed'
  `);
  const shopSales = await db.execute(sql`
    SELECT COALESCE(SUM(amount_cents - platform_fee_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM shop_events
    WHERE user_id = ${userId} AND event_type = 'sale'
  `);
  const o = (orders.rows as any[])[0] ?? { cents: 0, n: 0 };
  const s = (shopSales.rows as any[])[0] ?? { cents: 0, n: 0 };
  return {
    status: "ok" as const,
    totalCents: Number(o.cents) + Number(s.cents),
    count: Number(o.n) + Number(s.n),
    breakdown: {
      profileStoreCents: Number(o.cents),
      profileStoreOrders: Number(o.n),
      shopSalesCents: Number(s.cents),
      shopSales: Number(s.n),
    },
  };
}

export async function memberships(userId: string) {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(price_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM fan_members
    WHERE user_id = ${userId} AND stripe_session_id IS NOT NULL
  `);
  const row = (r.rows as any[])[0] ?? { cents: 0, n: 0 };
  return { status: "ok" as const, totalCents: Number(row.cents), count: Number(row.n) };
}

export async function brandDeals(userId: string) {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(net_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM sponsor_payouts
    WHERE creator_user_id = ${userId} AND status = 'released'
  `);
  const row = (r.rows as any[])[0] ?? { cents: 0, n: 0 };
  return { status: "ok" as const, totalCents: Number(row.cents), count: Number(row.n) };
}

export async function tips(userId: string) {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(amount_vb), 0)::int AS vb, COUNT(*)::int AS n
    FROM live_stream_tips
    WHERE creator_user_id = ${userId} AND creator_credited_at IS NOT NULL
  `);
  const row = (r.rows as any[])[0] ?? { vb: 0, n: 0 };
  const pending = tipJarPendingForUser(userId);
  return {
    status: "ok" as const,
    /* Visual Bucs — a different unit from cents; never added to totalCents. */
    streamTipsVb: Number(row.vb),
    streamTipCount: Number(row.n),
    /* Tip-jar intents are pending_payment (no charge exists yet). */
    tipJarPendingCents: pending.totalCents,
    tipJarPendingCount: pending.count,
    tipJarStatus: "pending_payment" as const,
  };
}

router.get("/earnings", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const settle = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      logger.error({ err, userId, source: name }, "[earnings] source failed");
      return null;
    }
  };

  const store = await settle("storeSales", () => storeSales(userId));
  const memb = await settle("memberships", () => memberships(userId));
  const deals = await settle("brandDeals", () => brandDeals(userId));
  const tip = await settle("tips", () => tips(userId));

  const sources = {
    storeSales: store ?? { ...errSource(), breakdown: null },
    memberships: memb ?? errSource(),
    brandDeals: deals ?? errSource(),
    tips: tip ?? {
      status: "error" as const, streamTipsVb: null, streamTipCount: null,
      tipJarPendingCents: null, tipJarPendingCount: null, tipJarStatus: "pending_payment" as const,
    },
  };
  const partial = !store || !memb || !deals || !tip;
  const totalCents =
    (store?.totalCents ?? 0) + (memb?.totalCents ?? 0) + (deals?.totalCents ?? 0);

  res.json({
    userId,
    currency: "USD",
    totalCents,
    totalTipsVb: tip?.streamTipsVb ?? null,
    partial,
    sources,
  });
});

export default router;
