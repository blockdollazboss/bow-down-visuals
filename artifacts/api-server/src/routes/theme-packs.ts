import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
} from "../lib/credits";
import { resolveCreatorTier } from "../middlewares/require-tier";
import { logger } from "../lib/logger";

/* ─── Theme pack purchases (owner pricing ruling, Oct 24 2026) ────────
   The model, exactly as ruled:
   - The house packs (Golden Marble light + dark) and every "included"
     pack are FREE for everyone — never sold, never charged.
   - Each PREMIUM pack costs THEME_PACK_PRICE_VB (1,000 VB) one-time,
     owned forever: the theme_pack_purchases row (migration 0220) is
     the ownership record and its (user_id, pack_id) primary key is the
     exactly-once anchor.
   - Creator Elite members have ALL packs included while subscribed:
     resolved live through resolveCreatorTier (active/trialing only),
     so a lapse ends Elite access — but packs bought outright keep
     their rows and stay owned.
   The pack registry itself lives in the frontend
   (bow-down-visuals/src/lib/theme-packs.ts); the two premium ids and
   the price are mirrored here and pinned equal by tests on both sides
   — displays must equal charges.

   Purchase discipline (charge-first, like the export reserve rail):
   1. Already owned → 200 alreadyOwned, NO charge.
   2. Elite active → 200 eliteIncluded, NO charge (never sell a member
      what their plan already includes).
   3. chargeCredits with idempotency key `theme-pack:<user>:<pack>` —
      insufficient balance throws OutOfCreditsError → 402, no row, no
      partial charge. A retry after a crash between charge and insert
      replays the same key: the ledger returns the original charge as
      an idempotent success and the insert then lands — the purchase
      heals instead of double-charging.
   4. INSERT … ON CONFLICT DO NOTHING — a lost race inserts nothing;
      the winner's row stands and both callers converge on owned.
   5. D5 (payments sweep): if the INSERT itself throws, the charge is
      refunded in full and the charge's idempotency key is voided
      before the 500 — the member never sits on a paid-but-unowned
      pack waiting for a retry that may never come, and the voided
      key means their next attempt charges fresh exactly once
      (never double, never free-after-refund). */

export const THEME_PACK_PRICE_VB = 1000;
export const THEME_PACK_PREMIUM_IDS: ReadonlySet<string> = new Set([
  "kings-set",
  "arcade-gold",
]);
/** Every pack id the desk sells or gives away — anything else is not a pack. */
export const THEME_PACK_KNOWN_IDS: ReadonlySet<string> = new Set([
  "golden-marble",
  "shark-tank",
  "golden-hour",
  "kings-set",
  "arcade-gold",
]);

const router = Router();

async function ownedPackIds(userId: string): Promise<string[]> {
  const { rows } = await db.execute(
    sql`SELECT pack_id FROM theme_pack_purchases WHERE user_id = ${userId}`,
  );
  return (rows as Array<{ pack_id: string }>).map((r) => r.pack_id);
}

/* ── GET /theme-packs/state — what the desk needs: owned ids, the live
      Elite entitlement, and the one price displays must equal. ─────── */
router.get("/theme-packs/state", requireAuth, async (req, res) => {
  try {
    const { tier } = await resolveCreatorTier(req.userId, req.userPlan);
    const owned = await ownedPackIds(req.userId!);
    res.json({
      owned,
      elite: tier === "elite",
      priceVb: THEME_PACK_PRICE_VB,
      premiumPackIds: [...THEME_PACK_PREMIUM_IDS],
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "theme-packs state read failed");
    res.status(500).json({ error: "Couldn't read your theme packs. Try again in a minute." });
  }
});

/* ── POST /theme-packs/purchase { packId } ──────────────────────────── */
router.post("/theme-packs/purchase", requireAuth, async (req, res) => {
  const packId = (req.body as { packId?: unknown } | undefined)?.packId;
  if (typeof packId !== "string" || !THEME_PACK_KNOWN_IDS.has(packId)) {
    res.status(400).json({ error: "PACK_UNKNOWN", message: "That's not a theme pack." });
    return;
  }
  if (!THEME_PACK_PREMIUM_IDS.has(packId)) {
    res.status(400).json({
      error: "PACK_NOT_FOR_SALE",
      message: "That pack is free — it's already yours.",
    });
    return;
  }
  const userId = req.userId!;
  try {
    const { rows: existingRows } = await db.execute(
      sql`SELECT pack_id FROM theme_pack_purchases
          WHERE user_id = ${userId} AND pack_id = ${packId} LIMIT 1`,
    );
    if (existingRows.length > 0) {
      res.json({ owned: true, alreadyOwned: true, chargedVb: 0 });
      return;
    }
    const { tier } = await resolveCreatorTier(userId, req.userPlan);
    if (tier === "elite") {
      res.json({ owned: false, eliteIncluded: true, chargedVb: 0 });
      return;
    }
    let balance: number;
    try {
      balance = await chargeCredits(
        userId,
        THEME_PACK_PRICE_VB,
        { action: "theme_pack_purchase" },
        { idempotencyKey: `theme-pack:${userId}:${packId}` },
      );
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "INSUFFICIENT_VB",
          message: `That pack is ${THEME_PACK_PRICE_VB.toLocaleString()} VB — your balance doesn't cover it yet. Nothing was charged.`,
          priceVb: THEME_PACK_PRICE_VB,
        });
        return;
      }
      if (err instanceof CreditsDisabledError) {
        res.status(403).json({ error: "CREDITS_DISABLED", message: "Purchases are paused right now." });
        return;
      }
      throw err;
    }
    try {
      await db.execute(
        sql`INSERT INTO theme_pack_purchases (user_id, pack_id, price_vb)
            VALUES (${userId}, ${packId}, ${THEME_PACK_PRICE_VB})
            ON CONFLICT DO NOTHING`,
      );
    } catch (insertErr) {
      /* D5 refund leg: the charge landed but ownership didn't. Refund
         in full, then void the charge's idempotency key so a retry
         charges fresh (refundCredits alone would leave the key spent
         and the retry would replay-suppress the charge — a free pack
         after a refund). If the refund itself fails, the error below
         still surfaces and the log line carries the reconciliation
         context. */
      let refunded = false;
      try {
        await refundCredits(userId, THEME_PACK_PRICE_VB, {
          action: "theme_pack_purchase (ownership record failed refund)",
        });
        refunded = true;
        await voidChargeIdempotencyKey(`theme-pack:${userId}:${packId}`);
      } catch (refundErr) {
        logger.error(
          { err: refundErr, userId, packId },
          "theme-packs: CRITICAL — ownership insert failed AND refund failed; manual reconciliation required",
        );
      }
      logger.error(
        { err: insertErr, userId, packId, refunded },
        "theme-packs: ownership insert failed after charge — charge refunded, purchase aborted",
      );
      throw insertErr;
    }
    res.json({ owned: true, alreadyOwned: false, chargedVb: THEME_PACK_PRICE_VB, balance });
  } catch (err) {
    logger.error({ err, userId, packId }, "theme-packs purchase failed");
    res.status(500).json({ error: "PURCHASE_FAILED", message: "That purchase hit a snag — if you were charged, the Visual Bucs were refunded. Please try again." });
  }
});

export default router;
