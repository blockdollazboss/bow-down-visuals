import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db as defaultDb } from "@workspace/db";
import { formatUsd } from "./platform-fees";
import { logger } from "./logger";
import { isUndefinedTable } from "./pg-errors";

/* ── Wishlists + price-drop alerts (Wave 4 #38, migration 0237) ──────────
   A fan saves a product for later; a price drop tells them, once.

   PRICE LAW: every wishlist row carries price_at_add_cents (the price
   when saved) and lowest_cents — the lowest price since the save AND
   since the last alert. lowest_cents only ever moves down:
   - a price edit to P alerts iff P < lowest_cents;
   - the alert CLAIMS the row first (guarded UPDATE … SET
     lowest_cents = P WHERE lowest_cents > P) and only a claim that
     lands may notify — concurrent edits can never double-alert, and
     after the claim the baseline IS the new price, so a further drop
     can alert again;
   - rises never alert and never raise the floor (a rise followed by a
     fall back to the old floor is not a new drop);
   - removing the row ends it — the detector finds nothing to claim.

   THE RAIL: alerts are rows in the existing `notifications` table
   (kind 'wishlist_price_drop') — the same bell every other fan-facing
   alert uses. No email, no nag copy, drops only.

   PRIVACY: rows belong to the fan. Nothing here (or in the routes)
   exposes one user's wishlist to another; sellers get no read at all.

   FAILURE ISOLATION: the detector runs inside seller price-edit
   requests, so it NEVER throws — a wishlist hiccup must not fail a
   seller's price change. Pre-migration (table absent) it reads as
   "feature not deployed yet" and returns zero. */

export const WISHLIST_PRICE_DROP_KIND = "wishlist_price_drop";

export type WishlistDb = typeof defaultDb;

export type WishlistItemKind = "store_product" | "shop_product";

export interface ResolvedWishlistItem {
  itemKind: WishlistItemKind;
  itemId: string;
  title: string;
  priceCents: number;
  /** Buyable right now (store product active / shop product 'active'). */
  available: boolean;
  /** Where a fan goes to buy it. */
  link: string;
}

interface WishlistRow {
  id: string;
  user_id: string;
  item_kind: WishlistItemKind;
  item_id: string;
  price_at_add_cents: number;
  lowest_cents: number;
  created_at: string;
}

function rowToWishlist(r: Record<string, unknown>): WishlistRow {
  return {
    id: String(r["id"]),
    user_id: String(r["user_id"]),
    item_kind: r["item_kind"] as WishlistItemKind,
    item_id: String(r["item_id"]),
    price_at_add_cents: Number(r["price_at_add_cents"]),
    lowest_cents: Number(r["lowest_cents"]),
    created_at: String(r["created_at"] ?? ""),
  };
}

/** Resolve a product in either catalog: current title, price, buyable
 *  state and the fan-facing link. Null when the product does not exist. */
export async function resolveWishlistItem(
  itemKind: WishlistItemKind,
  itemId: string,
  db: WishlistDb = defaultDb,
): Promise<ResolvedWishlistItem | null> {
  if (itemKind === "store_product") {
    const r = await db.execute(sql`
      SELECT id, title, price_cents, is_active
      FROM store_products WHERE id = ${itemId}::uuid LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      itemKind,
      itemId,
      title: String(row["title"] ?? ""),
      priceCents: Number(row["price_cents"]),
      available: row["is_active"] === true,
      link: `/storefront/product/${itemId}`,
    };
  }
  const r = await db.execute(sql`
    SELECT sp.id, sp.name, sp.price_cents, sp.status, s.handle AS shop_handle
    FROM shop_products sp
    JOIN shops s ON s.id = sp.shop_id
    WHERE sp.id = ${itemId}::uuid LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    itemKind,
    itemId,
    title: String(row["name"] ?? ""),
    priceCents: Number(row["price_cents"]),
    available: row["status"] === "active",
    link: `/shop/${String(row["shop_handle"] ?? "")}`,
  };
}

export type AddWishlistResult =
  | { ok: true; wishlist: WishlistRow; created: boolean }
  | { ok: false; reason: "item_not_found" | "item_unavailable" };

/** Save a product to the fan's wishlist, recording today's price as
 *  both the at-add price and the alert floor. Idempotent: saving the
 *  same product twice returns the existing row (created: false) and
 *  never resets its price history. */
export async function addWishlistItem(
  userId: string,
  itemKind: WishlistItemKind,
  itemId: string,
  db: WishlistDb = defaultDb,
): Promise<AddWishlistResult> {
  const item = await resolveWishlistItem(itemKind, itemId, db);
  if (!item) return { ok: false, reason: "item_not_found" };
  if (!item.available) return { ok: false, reason: "item_unavailable" };
  /* Existence is checked first and the insert is the fallback: an
     INSERT … ON CONFLICT … RETURNING cannot distinguish "inserted"
     from "skipped" under pg-mem (its RETURNING yields the conflicting
     row), while check-then-insert reads identically on both engines.
     The id is minted app-side (the product-reviews pattern): a
     gen_random_uuid() column default is evaluated once per prepared
     statement by pg-mem, which would collide on the second insert —
     and app-minted ids are equally valid on real Postgres. The
     ON CONFLICT stays as the real-Postgres race guard; if it ever
     skips, the re-read below returns the winner's row. */
  const selectExisting = async (): Promise<WishlistRow | null> => {
    const r = await db.execute(sql`
      SELECT id, user_id, item_kind, item_id, price_at_add_cents, lowest_cents, created_at
      FROM wishlists
      WHERE user_id = ${userId}::uuid AND item_kind = ${itemKind} AND item_id = ${itemId}::uuid
      LIMIT 1
    `);
    return r.rows.length ? rowToWishlist(r.rows[0] as Record<string, unknown>) : null;
  };
  const already = await selectExisting();
  if (already) return { ok: true, wishlist: already, created: false };
  const newId = randomUUID();
  const inserted = await db.execute(sql`
    INSERT INTO wishlists (id, user_id, item_kind, item_id, price_at_add_cents, lowest_cents)
    VALUES (${newId}::uuid, ${userId}::uuid, ${itemKind}, ${itemId}::uuid, ${item.priceCents}, ${item.priceCents})
    ON CONFLICT (user_id, item_kind, item_id) DO NOTHING
    RETURNING id, user_id, item_kind, item_id, price_at_add_cents, lowest_cents, created_at
  `);
  /* "Created" is proven by identity: the returned row is ours iff it
     carries the id this call minted. A skipped insert (real-PG race,
     or pg-mem's conflicting-row RETURNING echo) yields either no row
     or the winner's row — both mean created: false with that row. */
  if (inserted.rows.length && String((inserted.rows[0] as Record<string, unknown>)["id"]) === newId) {
    return { ok: true, wishlist: rowToWishlist(inserted.rows[0] as Record<string, unknown>), created: true };
  }
  const after = await selectExisting();
  if (!after) throw new Error("wishlist insert vanished");
  return { ok: true, wishlist: after, created: false };
}

/** Remove a product from the fan's own wishlist. Removing stops all
 *  future alerts for it (the detector claims rows — a gone row claims
 *  nothing). Returns true when a row was removed. */
export async function removeWishlistItem(
  userId: string,
  itemKind: WishlistItemKind,
  itemId: string,
  db: WishlistDb = defaultDb,
): Promise<boolean> {
  const r = await db.execute(sql`
    DELETE FROM wishlists
    WHERE user_id = ${userId}::uuid AND item_kind = ${itemKind} AND item_id = ${itemId}::uuid
    RETURNING id
  `);
  return r.rows.length > 0;
}

export interface WishlistListEntry {
  id: string;
  itemKind: WishlistItemKind;
  itemId: string;
  title: string;
  priceAtAddCents: number;
  lowestCents: number;
  /** Null when the product no longer exists. */
  currentPriceCents: number | null;
  available: boolean;
  link: string;
  createdAt: string;
}

/** The fan's own wishlist, newest first, each entry resolved against
 *  the product's CURRENT price so the view can show drops honestly. */
export async function listWishlistItems(
  userId: string,
  db: WishlistDb = defaultDb,
): Promise<WishlistListEntry[]> {
  const r = await db.execute(sql`
    SELECT id, user_id, item_kind, item_id, price_at_add_cents, lowest_cents, created_at
    FROM wishlists
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
  `);
  const rows = (r.rows as unknown as Array<Record<string, unknown>>).map(rowToWishlist);
  const entries: WishlistListEntry[] = [];
  for (const w of rows) {
    const item = await resolveWishlistItem(w.item_kind, w.item_id, db).catch(() => null);
    entries.push({
      id: w.id,
      itemKind: w.item_kind,
      itemId: w.item_id,
      title: item?.title ?? "",
      priceAtAddCents: w.price_at_add_cents,
      lowestCents: w.lowest_cents,
      currentPriceCents: item ? item.priceCents : null,
      available: item ? item.available : false,
      link: item?.link ?? "",
      createdAt: w.created_at,
    });
  }
  return entries;
}

/** The drop detector. Called from seller price-edit paths AFTER the
 *  product's price has been written. Alerts every fan whose saved
 *  floor is strictly above the new price — once each — and resets
 *  their floor to the new price. Never throws. */
export async function detectWishlistPriceDrop(
  input: { itemKind: WishlistItemKind; itemId: string; newPriceCents: number; title?: string; link?: string },
  db: WishlistDb = defaultDb,
): Promise<{ alerted: number }> {
  const { itemKind, itemId, newPriceCents } = input;
  if (!Number.isInteger(newPriceCents) || newPriceCents < 0) return { alerted: 0 };
  try {
    const candidates = await db.execute(sql`
      SELECT id, user_id, lowest_cents
      FROM wishlists
      WHERE item_kind = ${itemKind} AND item_id = ${itemId}::uuid
        AND lowest_cents > ${newPriceCents}
    `);
    if (!candidates.rows.length) return { alerted: 0 };

    let title = input.title;
    let link = input.link;
    if (title === undefined || link === undefined) {
      const item = await resolveWishlistItem(itemKind, itemId, db).catch(() => null);
      if (title === undefined) title = item?.title ?? "A product on your wishlist";
      if (link === undefined) link = item?.link ?? "";
    }

    let alerted = 0;
    for (const raw of candidates.rows as unknown as Array<Record<string, unknown>>) {
      const rowId = String(raw["id"]);
      const userId = String(raw["user_id"]);
      try {
        /* Claim-first: move the floor to the new price, guarded by the
           same predicate that selected the row. Only the edit whose
           claim lands may notify — a racing edit that already claimed
           (and notified for) this drop leaves nothing to claim. */
        const claim = await db.execute(sql`
          UPDATE wishlists
          SET lowest_cents = ${newPriceCents}, updated_at = now()
          WHERE id = ${rowId}::uuid AND lowest_cents > ${newPriceCents}
          RETURNING id
        `);
        if (!claim.rows.length) continue;
        await db.execute(sql`
          INSERT INTO notifications (id, user_id, kind, title, body, link)
          VALUES (
            ${randomUUID()}::uuid,
            ${userId}::uuid,
            ${WISHLIST_PRICE_DROP_KIND},
            ${"Price drop on your wishlist"},
            ${`"${title}" just dropped to ${formatUsd(newPriceCents)} — the lowest since you saved it.`},
            ${link ?? ""}
          )
        `);
        alerted += 1;
      } catch (err) {
        logger.warn({ err, wishlistId: rowId, itemKind, itemId }, "[wishlists] price-drop alert failed for one fan");
      }
    }
    if (alerted > 0) {
      logger.info({ itemKind, itemId, newPriceCents, alerted }, "[wishlists] price-drop alerts sent");
    }
    return { alerted };
  } catch (err) {
    if (!isUndefinedTable(err)) {
      logger.warn({ err, itemKind, itemId }, "[wishlists] price-drop detection failed");
    }
    return { alerted: 0 };
  }
}
