import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { publicApiLimiter } from "../lib/rate-limit";
import {
  listSplitEntriesForSeller,
  listSplitEntriesForOwner,
  saleSplitAdjustments,
  saleSplitEntriesReady,
  isMissingSaleSplitsStorage,
} from "../lib/sale-splits";

/* ─── Co-seller revenue splits — read views (Wave 4 #36) ──────────────
   Both chairs, honestly:
     GET /api/sale-splits/mine    every split entry where I am a seller
                                  (my owner shares + my co-seller
                                  shares), with my money totals: what
                                  my co-sold products earned me, and
                                  what my own sales paid my partners.
     GET /api/sale-splits/owed    the co-seller entries on MY products —
                                  what my sales owe my partners, per sale.
   Read-only: splits are SET on the product write rails
   (storefront + shops product create/PATCH) and RECORDED at
   fulfillment by lib/sale-splits. Amounts are cents of the seller net
   (the flat 5% platform fee came off the top before the split).
   A 'reversed' entry is a refunded sale — it counts for neither side.
   Pre-migration (0235 not landed) both views answer the honest
   not-ready state instead of a fake empty picture. */

const router = Router();

async function splitsReadyOr503(res: import("express").Response): Promise<boolean> {
  let ready = false;
  try {
    ready = await saleSplitEntriesReady();
  } catch {
    ready = false;
  }
  if (!ready) {
    res.status(503).json({
      error: "SPLITS_NOT_READY",
      message: "Co-seller splits aren't switched on yet.",
      entries: [],
    });
  }
  return ready;
}

router.get("/sale-splits/mine", requireAuth, publicApiLimiter, async (req, res) => {
  const userId = req.userId!;
  if (!(await splitsReadyOr503(res))) return;
  try {
    const [entries, adj] = await Promise.all([
      listSplitEntriesForSeller(userId),
      saleSplitAdjustments(userId),
    ]);
    const earned = entries.filter((e) => e.status === "earned");
    const asOwner = earned.filter((e) => e.role === "owner");
    const asCoSeller = earned.filter((e) => e.role === "co_seller");
    res.json({
      entries,
      totals: {
        /* My shares of other creators' co-sold products. */
        coSellerEarnedCents: adj.addCents,
        coSellerSales: adj.addCount,
        /* My partners' shares of my sales (already out of my net). */
        paidToCoSellersCents: adj.subtractCents,
        /* My owner shares on my own co-sold products (these also live
           in my parent sale rows — shown here so the split picture is
           complete in one place; /api/earnings counts them once). */
        ownerShareCents: asOwner.reduce((s, e) => s + e.amountCents, 0),
        ownerShareSales: asOwner.length,
        reversedCents: entries
          .filter((e) => e.status === "reversed")
          .reduce((s, e) => s + e.amountCents, 0),
        reversedSales: entries.filter((e) => e.status === "reversed").length,
        coSellerEntryCount: asCoSeller.length,
      },
    });
  } catch (err) {
    if (isMissingSaleSplitsStorage(err)) {
      res.status(503).json({ error: "SPLITS_NOT_READY", message: "Co-seller splits aren't switched on yet.", entries: [] });
      return;
    }
    logger.error({ err, userId }, "[sale-splits] mine failed");
    res.status(500).json({ error: "Could not load your split earnings." });
  }
});

router.get("/sale-splits/owed", requireAuth, publicApiLimiter, async (req, res) => {
  const userId = req.userId!;
  if (!(await splitsReadyOr503(res))) return;
  try {
    const entries = await listSplitEntriesForOwner(userId);
    const earned = entries.filter((e) => e.status === "earned");
    res.json({
      entries,
      totals: {
        owedCents: earned.reduce((s, e) => s + e.amountCents, 0),
        sales: earned.length,
        reversedCents: entries
          .filter((e) => e.status === "reversed")
          .reduce((s, e) => s + e.amountCents, 0),
      },
    });
  } catch (err) {
    if (isMissingSaleSplitsStorage(err)) {
      res.status(503).json({ error: "SPLITS_NOT_READY", message: "Co-seller splits aren't switched on yet.", entries: [] });
      return;
    }
    logger.error({ err, userId }, "[sale-splits] owed failed");
    res.status(500).json({ error: "Could not load your co-seller splits." });
  }
});

export default router;
