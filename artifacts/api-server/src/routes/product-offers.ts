/**
 * product-offers.ts — Make-an-offer (Wave 4 #43, migration
 * 9999-wave4346 PROVISIONAL).
 *
 * Buyers propose a price below list on a storefront product or a shop
 * product; the seller accepts / declines / counters; the buyer answers
 * a counter the same way. An accepted offer's agreed price is charged
 * by the EXISTING checkouts (POST /storefront/checkout and
 * POST /storefronts/checkout accept `offerId`) — this router never
 * charges anything. lib/product-offers owns the state machine, the
 * price law and the notifications.
 *
 * Endpoints (mounted at /api):
 *   POST /product-offers                 auth: make an offer
 *          { itemKind, itemId, amountCents, message? }
 *   GET  /product-offers/mine            auth: offers I made
 *   GET  /product-offers/received        auth: offers on my products
 *   GET  /product-offers/for-item?itemKind=&itemId=
 *          auth: my OPEN offer on one product (the product page panel)
 *   POST /product-offers/:id/act         auth: { action, amountCents? }
 *          action: accept | decline | counter | withdraw — the lib's
 *          role/status table decides who may do which.
 *
 * Privacy: every read is scoped to the caller as buyer or as seller;
 * there is no public read of anyone's offers.
 */
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { isUndefinedTable } from "../lib/pg-errors";
import {
  createOffer,
  actOnOffer,
  listBuyerOffers,
  listSellerOffers,
  getOfferForBuyer,
  type ProductOfferItemKind,
} from "../lib/product-offers";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ItemKindSchema = z.enum(["store_product", "shop_product"]);

const CreateOfferSchema = z.object({
  itemKind: ItemKindSchema,
  itemId: z.string().regex(UUID_RE, "Invalid item id."),
  amountCents: z.number().int(),
  message: z.string().max(500).optional(),
});

const ActSchema = z.object({
  action: z.enum(["accept", "decline", "counter", "withdraw"]),
  amountCents: z.number().int().optional(),
});

function migrationPending(res: import("express").Response): void {
  res.status(503).json({ error: "PRODUCT_OFFERS_NOT_DEPLOYED", message: "Make-an-offer is not available yet." });
}

router.post("/product-offers", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CreateOfferSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid offer.", details: parsed.error.issues });
    return;
  }
  try {
    const result = await createOffer({
      buyerUserId: req.userId!,
      itemKind: parsed.data.itemKind,
      itemId: parsed.data.itemId,
      amountCents: parsed.data.amountCents,
      message: parsed.data.message,
    });
    if (!result.ok) {
      const status = result.reason === "item_not_found" ? 404
        : result.reason === "bad_amount" ? 400
        : 409;
      res.status(status).json({ error: result.reason.toUpperCase(), message: result.message });
      return;
    }
    res.status(201).json({ offer: result.offer });
  } catch (err) {
    if (isUndefinedTable(err)) { migrationPending(res); return; }
    logger.error({ err, userId: req.userId }, "[product-offers] create failed");
    res.status(500).json({ error: "Could not make that offer." });
  }
});

router.get("/product-offers/mine", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    res.json({ offers: await listBuyerOffers(req.userId!) });
  } catch (err) {
    if (isUndefinedTable(err)) { res.json({ offers: [] }); return; }
    logger.error({ err, userId: req.userId }, "[product-offers] mine failed");
    res.status(500).json({ error: "Could not load your offers." });
  }
});

router.get("/product-offers/received", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    res.json({ offers: await listSellerOffers(req.userId!) });
  } catch (err) {
    if (isUndefinedTable(err)) { res.json({ offers: [] }); return; }
    logger.error({ err, userId: req.userId }, "[product-offers] received failed");
    res.status(500).json({ error: "Could not load offers on your products." });
  }
});

router.get("/product-offers/for-item", requireAuth, publicApiLimiter, async (req, res) => {
  const kindParsed = ItemKindSchema.safeParse(req.query["itemKind"]);
  const itemId = String(req.query["itemId"] ?? "");
  if (!kindParsed.success || !UUID_RE.test(itemId)) {
    res.status(400).json({ error: "Invalid item." });
    return;
  }
  try {
    const offer = await getOfferForBuyer(req.userId!, kindParsed.data as ProductOfferItemKind, itemId);
    res.json({ offer });
  } catch (err) {
    if (isUndefinedTable(err)) { res.json({ offer: null }); return; }
    logger.error({ err, userId: req.userId }, "[product-offers] for-item failed");
    res.status(500).json({ error: "Could not load your offer." });
  }
});

router.post("/product-offers/:id/act", requireAuth, publicApiLimiter, async (req, res) => {
  const offerId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(offerId)) {
    res.status(400).json({ error: "Invalid offer." });
    return;
  }
  const parsed = ActSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid action.", details: parsed.error.issues });
    return;
  }
  try {
    const result = await actOnOffer({
      offerId,
      actorUserId: req.userId!,
      action: parsed.data.action,
      amountCents: parsed.data.amountCents,
    });
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404
        : result.reason === "forbidden" ? 403
        : result.reason === "bad_amount" ? 400
        : 409;
      res.status(status).json({ error: result.reason.toUpperCase(), message: result.message });
      return;
    }
    res.json({ offer: result.offer });
  } catch (err) {
    if (isUndefinedTable(err)) { migrationPending(res); return; }
    logger.error({ err, userId: req.userId, offerId }, "[product-offers] act failed");
    res.status(500).json({ error: "Could not update that offer." });
  }
});

export default router;
