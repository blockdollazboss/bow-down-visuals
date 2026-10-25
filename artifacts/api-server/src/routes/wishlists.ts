/**
 * wishlists.ts — Wishlists + price-drop alerts (Wave 4 #38, migration 0237).
 *
 * A fan saves any storefront product or shop product for later; when
 * its price drops below the lowest price since the save, the fan gets
 * one in-app notification per drop (lib/wishlists owns the price law
 * and the detector; seller price-edit routes call it after a write).
 *
 * Endpoints (mounted at /api):
 *   GET    /wishlists                  auth: my wishlist, each item
 *          resolved against its CURRENT price (drops show honestly)
 *   POST   /wishlists                  auth: save { itemKind, itemId }
 *          — records today's price; idempotent re-save returns the
 *          existing row without resetting its price history
 *   DELETE /wishlists/:itemKind/:itemId  auth: remove (stops alerts)
 *   GET    /wishlists/check?itemKind=&itemId=  auth: is it saved?
 *
 * Privacy: every read and write is scoped to the caller's own rows.
 * Sellers have NO read on who saved their products — there is no
 * endpoint here a seller could use, by design.
 */
import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { isUndefinedTable } from "../lib/pg-errors";
import {
  addWishlistItem,
  removeWishlistItem,
  listWishlistItems,
  type WishlistItemKind,
} from "../lib/wishlists";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ItemKindSchema = z.enum(["store_product", "shop_product"]);

const AddWishlistSchema = z.object({
  itemKind: ItemKindSchema,
  itemId: z.string().regex(UUID_RE, "Invalid item id."),
});

function parseItemKind(raw: unknown): WishlistItemKind | null {
  const parsed = ItemKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* Pre-migration the table is absent: reads answer empty and writes
   answer 503-honest rather than 500-noise (the product-drop pattern). */
function migrationPending(res: import("express").Response): void {
  res.status(503).json({ error: "WISHLISTS_NOT_DEPLOYED", message: "Wishlists are not available yet." });
}

router.get("/wishlists", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const items = await listWishlistItems(req.userId!);
    res.json({ items });
  } catch (err) {
    if (isUndefinedTable(err)) {
      res.json({ items: [] });
      return;
    }
    logger.error({ err, userId: req.userId }, "[wishlists] list failed");
    res.status(500).json({ error: "Could not load your wishlist." });
  }
});

router.get("/wishlists/check", requireAuth, publicApiLimiter, async (req, res) => {
  const itemKind = parseItemKind(req.query["itemKind"]);
  const itemId = String(req.query["itemId"] ?? "");
  if (!itemKind || !UUID_RE.test(itemId)) {
    res.status(400).json({ error: "Invalid item." });
    return;
  }
  try {
    const r = await db.execute(sql`
      SELECT id FROM wishlists
      WHERE user_id = ${req.userId!}::uuid AND item_kind = ${itemKind} AND item_id = ${itemId}::uuid
      LIMIT 1
    `);
    res.json({ wishlisted: r.rows.length > 0 });
  } catch (err) {
    if (isUndefinedTable(err)) {
      res.json({ wishlisted: false });
      return;
    }
    logger.error({ err, userId: req.userId }, "[wishlists] check failed");
    res.status(500).json({ error: "Could not check your wishlist." });
  }
});

router.post("/wishlists", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = AddWishlistSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid item.", details: parsed.error.issues });
    return;
  }
  const { itemKind, itemId } = parsed.data;
  try {
    const result = await addWishlistItem(req.userId!, itemKind, itemId);
    if (!result.ok) {
      if (result.reason === "item_not_found") {
        res.status(404).json({ error: "PRODUCT_NOT_FOUND", message: "That product could not be found." });
        return;
      }
      res.status(409).json({ error: "PRODUCT_UNAVAILABLE", message: "That product is not on sale right now." });
      return;
    }
    res.status(result.created ? 201 : 200).json({ wishlist: result.wishlist, created: result.created });
  } catch (err) {
    if (isUndefinedTable(err)) {
      migrationPending(res);
      return;
    }
    logger.error({ err, userId: req.userId, itemKind, itemId }, "[wishlists] add failed");
    res.status(500).json({ error: "Could not save this to your wishlist." });
  }
});

router.delete("/wishlists/:itemKind/:itemId", requireAuth, publicApiLimiter, async (req, res) => {
  const itemKind = parseItemKind(req.params["itemKind"]);
  const itemId = String(req.params["itemId"] ?? "");
  if (!itemKind || !UUID_RE.test(itemId)) {
    res.status(400).json({ error: "Invalid item." });
    return;
  }
  try {
    const removed = await removeWishlistItem(req.userId!, itemKind, itemId);
    res.json({ ok: true, removed });
  } catch (err) {
    if (isUndefinedTable(err)) {
      res.json({ ok: true, removed: false });
      return;
    }
    logger.error({ err, userId: req.userId, itemKind, itemId }, "[wishlists] remove failed");
    res.status(500).json({ error: "Could not remove this from your wishlist." });
  }
});

export default router;
