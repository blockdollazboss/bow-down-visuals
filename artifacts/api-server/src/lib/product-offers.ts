import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db as defaultDb } from "@workspace/db";
import { formatUsd } from "./platform-fees";
import { logger } from "./logger";
import { isUndefinedTable } from "./pg-errors";

/* ── Make-an-offer (Wave 4 #43, migration 9999-wave4346 PROVISIONAL) ────
   The negotiation rail behind schema/product-offers.ts. This lib owns
   the state machine and the money law; the routes own HTTP shape; the
   two EXISTING checkouts own charging:

     pending ──seller accept──▶ accepted ──paid flip──▶ consumed
       │  ▲                       │
       │  └── buyer counter ──┐   │ buyer withdraw / expiry
       ▼                      ▼   ▼
     countered ──buyer accept──▶ accepted
       │  seller decline / buyer decline / withdraw / expiry
       ▼
     declined / withdrawn / expired (terminal)

   PRICE LAW: an offer is 1..list-1 cents. A counter sits strictly
   between the amount it answers and list. Accepting pins
   agreed_amount_cents (the buyer's amount on a seller accept, the
   counter amount on a buyer accept) — checkout reads ONLY that column,
   server-side, so no client ever names the price it pays. The fee rule
   never changes: the existing checkouts split the agreed gross at
   their flat 5%, out of the seller's cut.

   CLAIM LAW (the gift-card hold pattern): an accepted offer is
   claimed by ONE checkout at a time for 30 minutes
   (claimed_ref = storefront session id / shops checkout group id).
   Session-creation failure releases the claim at once; an abandoned
   checkout's claim goes stale and can be taken over; the sale's paid
   flip consumes the offer exactly once (status-guarded UPDATE).

   FAILURE ISOLATION: notifications ride the existing notifications
   table and NEVER throw into a negotiation or a sale. Pre-migration
   reads treat the feature as not deployed (the routes answer
   503-honest on writes, empty on reads). */

export const PRODUCT_OFFER_TTL_DAYS = 7;
export const PRODUCT_OFFER_CLAIM_MINUTES = 30;

export type OfferDb = typeof defaultDb;
export type ProductOfferItemKind = "store_product" | "shop_product";
export type ProductOfferStatus =
  | "pending" | "countered" | "accepted" | "declined" | "withdrawn" | "expired" | "consumed";

export const OPEN_OFFER_STATUSES: ProductOfferStatus[] = ["pending", "countered", "accepted"];

/* ── Pure negotiation law (unit-tested without a DB) ────────────────── */

export function validateOfferAmount(
  amountCents: unknown,
  listPriceCents: number,
): { ok: true; amountCents: number } | { ok: false; reason: string } {
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) {
    return { ok: false, reason: "Name a whole-cent price for your offer." };
  }
  if (amountCents <= 0) return { ok: false, reason: "An offer has to be more than $0 — a free product is claimed, not negotiated." };
  if (amountCents >= listPriceCents) {
    return { ok: false, reason: "That's the list price (or more) — just buy it at checkout. An offer is a price below list." };
  }
  return { ok: true, amountCents };
}

/** A counter must narrow the gap: strictly above the countering
 *  side's own last price (`floorCents`) and strictly below the other
 *  side's standing price (`ceilingCents` — the list price for a
 *  seller countering a buyer's offer; the seller's counter for a
 *  buyer's counter-counter). */
export function validateCounterAmount(
  amountCents: unknown,
  floorCents: number,
  ceilingCents: number,
): { ok: true; amountCents: number } | { ok: false; reason: string } {
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) {
    return { ok: false, reason: "Name a whole-cent price for your counter." };
  }
  if (amountCents <= floorCents) {
    return { ok: false, reason: `A counter has to move toward the other side — above ${formatUsd(floorCents)}.` };
  }
  if (amountCents >= ceilingCents) {
    return { ok: false, reason: `A counter has to stay below ${formatUsd(ceilingCents)} — at that price, it's just a purchase.` };
  }
  return { ok: true, amountCents };
}

export type OfferActor = "buyer" | "seller";
export type OfferAction = "accept" | "decline" | "counter" | "withdraw";

/** Who may do what, from which status. The one table the routes and
 *  the FE both mirror — a move not listed here does not exist. */
export function offerActionAllowed(
  status: ProductOfferStatus,
  actor: OfferActor,
  action: OfferAction,
): boolean {
  if (status === "pending") {
    if (actor === "seller") return action === "accept" || action === "decline" || action === "counter";
    return action === "withdraw";
  }
  if (status === "countered") {
    if (actor === "buyer") return action === "accept" || action === "decline" || action === "counter" || action === "withdraw";
    return false;
  }
  if (status === "accepted") {
    return actor === "buyer" && action === "withdraw";
  }
  return false;
}

/** The price the buyer currently faces: the counter while countered,
 *  the agreed price once accepted, the standing offer while pending. */
export function currentOfferPriceCents(row: {
  status: ProductOfferStatus;
  offer_amount_cents: number;
  counter_amount_cents: number | null;
  agreed_amount_cents: number | null;
}): number {
  if (row.status === "accepted" || row.status === "consumed") return row.agreed_amount_cents ?? row.offer_amount_cents;
  if (row.status === "countered" && row.counter_amount_cents != null) return row.counter_amount_cents;
  return row.offer_amount_cents;
}

/* ── Rows ────────────────────────────────────────────────────────────── */

export interface ProductOfferRow {
  id: string;
  buyer_user_id: string;
  seller_user_id: string;
  item_kind: ProductOfferItemKind;
  item_id: string;
  profile_id: string | null;
  shop_id: string | null;
  list_price_cents: number;
  offer_amount_cents: number;
  counter_amount_cents: number | null;
  agreed_amount_cents: number | null;
  status: ProductOfferStatus;
  message: string;
  expires_at: string;
  claimed_ref: string | null;
  created_at: string;
  updated_at: string;
}

const OFFER_COLUMNS = sql`
  id, buyer_user_id, seller_user_id, item_kind, item_id, profile_id, shop_id,
  list_price_cents, offer_amount_cents, counter_amount_cents, agreed_amount_cents,
  status, message, expires_at, claimed_ref, created_at, updated_at
`;

function rowToOffer(r: Record<string, unknown>): ProductOfferRow {
  return {
    id: String(r["id"]),
    buyer_user_id: String(r["buyer_user_id"]),
    seller_user_id: String(r["seller_user_id"]),
    item_kind: r["item_kind"] as ProductOfferItemKind,
    item_id: String(r["item_id"]),
    profile_id: r["profile_id"] ? String(r["profile_id"]) : null,
    shop_id: r["shop_id"] ? String(r["shop_id"]) : null,
    list_price_cents: Number(r["list_price_cents"]),
    offer_amount_cents: Number(r["offer_amount_cents"]),
    counter_amount_cents: r["counter_amount_cents"] == null ? null : Number(r["counter_amount_cents"]),
    agreed_amount_cents: r["agreed_amount_cents"] == null ? null : Number(r["agreed_amount_cents"]),
    status: r["status"] as ProductOfferStatus,
    message: String(r["message"] ?? ""),
    expires_at: String(r["expires_at"] ?? ""),
    claimed_ref: r["claimed_ref"] ? String(r["claimed_ref"]) : null,
    created_at: String(r["created_at"] ?? ""),
    updated_at: String(r["updated_at"] ?? ""),
  };
}

export interface ResolvedOfferItem {
  itemKind: ProductOfferItemKind;
  itemId: string;
  title: string;
  priceCents: number;
  available: boolean;
  sellerUserId: string;
  profileId: string | null;
  shopId: string | null;
  link: string;
}

/** Resolve a product in either catalog: seller, current list price,
 *  buyable state and the buyer-facing link. Null when it does not
 *  exist. Mirrors lib/wishlists.resolveWishlistItem. */
export async function resolveOfferItem(
  itemKind: ProductOfferItemKind,
  itemId: string,
  db: OfferDb = defaultDb,
): Promise<ResolvedOfferItem | null> {
  if (itemKind === "store_product") {
    const r = await db.execute(sql`
      SELECT p.id, p.title, p.price_cents, p.is_active, p.inventory, p.profile_id,
             cp.user_id AS seller_user_id
      FROM store_products p
      JOIN creator_profiles cp ON cp.id = p.profile_id
      WHERE p.id = ${itemId}::uuid LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      itemKind, itemId,
      title: String(row["title"] ?? ""),
      priceCents: Number(row["price_cents"]),
      available: row["is_active"] === true && Number(row["inventory"]) !== 0,
      sellerUserId: String(row["seller_user_id"]),
      profileId: String(row["profile_id"]),
      shopId: null,
      link: `/storefront/product/${itemId}`,
    };
  }
  const r = await db.execute(sql`
    SELECT sp.id, sp.name, sp.price_cents, sp.status, sp.shop_id, s.user_id AS seller_user_id, s.handle AS shop_handle
    FROM shop_products sp
    JOIN shops s ON s.id = sp.shop_id
    WHERE sp.id = ${itemId}::uuid LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    itemKind, itemId,
    title: String(row["name"] ?? ""),
    priceCents: Number(row["price_cents"]),
    available: row["status"] === "active",
    sellerUserId: String(row["seller_user_id"]),
    profileId: null,
    shopId: String(row["shop_id"]),
    link: `/shop/${String(row["shop_handle"] ?? "")}`,
  };
}

async function notifySafely(
  db: OfferDb,
  input: { userId: string; kind: string; title: string; body: string; link: string },
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO notifications (id, user_id, kind, title, body, link)
      VALUES (${randomUUID()}::uuid, ${input.userId}::uuid, ${input.kind}, ${input.title}, ${input.body}, ${input.link})
    `);
  } catch (err) {
    logger.warn({ err, userId: input.userId, kind: input.kind }, "[product-offers] notification failed (negotiation stands)");
  }
}

/** Flip stale open rows to 'expired'. Returns how many flipped. */
export async function expireStaleOffers(db: OfferDb = defaultDb): Promise<number> {
  const r = await db.execute(sql`
    UPDATE product_offers SET status = 'expired', updated_at = now()
    WHERE status IN ('pending', 'countered', 'accepted') AND expires_at <= now()
    RETURNING id
  `);
  return r.rows.length;
}

async function getOfferRow(offerId: string, db: OfferDb): Promise<ProductOfferRow | null> {
  const r = await db.execute(sql`
    SELECT ${OFFER_COLUMNS} FROM product_offers WHERE id = ${offerId}::uuid LIMIT 1
  `);
  return r.rows.length ? rowToOffer(r.rows[0] as Record<string, unknown>) : null;
}

/* ── Create ──────────────────────────────────────────────────────────── */

export type CreateOfferResult =
  | { ok: true; offer: ProductOfferRow; created: boolean }
  | { ok: false; reason: "item_not_found" | "item_unavailable" | "own_product" | "bad_amount" | "open_offer_exists"; message: string };

export async function createOffer(
  input: { buyerUserId: string; itemKind: ProductOfferItemKind; itemId: string; amountCents: unknown; message?: string },
  db: OfferDb = defaultDb,
): Promise<CreateOfferResult> {
  const item = await resolveOfferItem(input.itemKind, input.itemId, db);
  if (!item) return { ok: false, reason: "item_not_found", message: "That product could not be found." };
  if (item.sellerUserId === input.buyerUserId) {
    return { ok: false, reason: "own_product", message: "You can't make an offer on your own product." };
  }
  if (!item.available) return { ok: false, reason: "item_unavailable", message: "That product is not on sale right now." };
  const valid = validateOfferAmount(input.amountCents, item.priceCents);
  if (!valid.ok) return { ok: false, reason: "bad_amount", message: valid.reason };
  if (item.priceCents <= 1) {
    return { ok: false, reason: "bad_amount", message: "This product's price leaves no room below list to negotiate." };
  }

  await expireStaleOffers(db).catch(() => 0);
  const existing = await db.execute(sql`
    SELECT ${OFFER_COLUMNS} FROM product_offers
    WHERE buyer_user_id = ${input.buyerUserId}::uuid AND item_kind = ${input.itemKind}
      AND item_id = ${input.itemId}::uuid AND status IN ('pending', 'countered', 'accepted')
    ORDER BY created_at DESC LIMIT 1
  `);
  if (existing.rows.length) {
    return {
      ok: false, reason: "open_offer_exists",
      message: "You already have an open offer on this product — answer it or withdraw it before making a new one.",
    };
  }

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + PRODUCT_OFFER_TTL_DAYS * 86_400_000).toISOString();
  const message = (input.message ?? "").slice(0, 500);
  const inserted = await db.execute(sql`
    INSERT INTO product_offers
      (id, buyer_user_id, seller_user_id, item_kind, item_id, profile_id, shop_id,
       list_price_cents, offer_amount_cents, message, expires_at)
    VALUES (${id}::uuid, ${input.buyerUserId}::uuid, ${item.sellerUserId}::uuid, ${input.itemKind},
            ${input.itemId}::uuid, ${item.profileId}::uuid, ${item.shopId}::uuid,
            ${item.priceCents}, ${valid.amountCents}, ${message}, ${expiresAt})
    RETURNING ${OFFER_COLUMNS}
  `);
  const offer = rowToOffer(inserted.rows[0] as Record<string, unknown>);
  await notifySafely(db, {
    userId: item.sellerUserId, kind: "product_offer_received",
    title: "New offer on your product",
    body: `A buyer offered ${formatUsd(valid.amountCents)} for "${item.title}" (listed at ${formatUsd(item.priceCents)}). Accept, decline, or counter from your store dashboard.`,
    link: item.itemKind === "store_product" ? "/music-sales" : "/my-shop",
  });
  return { ok: true, offer, created: true };
}

/* ── Act (accept / decline / counter / withdraw) ─────────────────────── */

export type ActOnOfferResult =
  | { ok: true; offer: ProductOfferRow }
  | { ok: false; reason: "not_found" | "forbidden" | "not_open" | "not_allowed" | "bad_amount" | "expired"; message: string };

export async function actOnOffer(
  input: { offerId: string; actorUserId: string; action: OfferAction; amountCents?: unknown },
  db: OfferDb = defaultDb,
): Promise<ActOnOfferResult> {
  await expireStaleOffers(db).catch(() => 0);
  const row = await getOfferRow(input.offerId, db);
  if (!row) return { ok: false, reason: "not_found", message: "That offer could not be found." };
  const actor: OfferActor | null =
    row.buyer_user_id === input.actorUserId ? "buyer" : row.seller_user_id === input.actorUserId ? "seller" : null;
  if (!actor) return { ok: false, reason: "forbidden", message: "That offer isn't yours to act on." };
  if (!OPEN_OFFER_STATUSES.includes(row.status)) {
    return { ok: false, reason: "not_open", message: "That offer is already settled." };
  }
  if (!offerActionAllowed(row.status, actor, input.action)) {
    return {
      ok: false, reason: "not_allowed",
      message: row.status === "countered" && actor === "seller"
        ? "Your counter is with the buyer — they answer it next."
        : "That move isn't available on this offer right now.",
    };
  }

  const expiresSql = sql`${new Date(Date.now() + PRODUCT_OFFER_TTL_DAYS * 86_400_000).toISOString()}`;
  let updated: ProductOfferRow | null = null;

  if (input.action === "accept") {
    const agreed = row.status === "countered" ? row.counter_amount_cents! : row.offer_amount_cents;
    const r = await db.execute(sql`
      UPDATE product_offers
      SET status = 'accepted', agreed_amount_cents = ${agreed}, decided_at = now(), updated_at = now(),
          expires_at = ${expiresSql}
      WHERE id = ${row.id}::uuid AND status = ${row.status}
      RETURNING ${OFFER_COLUMNS}
    `);
    if (r.rows.length) updated = rowToOffer(r.rows[0] as Record<string, unknown>);
  } else if (input.action === "decline") {
    const r = await db.execute(sql`
      UPDATE product_offers
      SET status = 'declined', decided_at = now(), updated_at = now(), claimed_ref = NULL, claimed_at = NULL
      WHERE id = ${row.id}::uuid AND status = ${row.status}
      RETURNING ${OFFER_COLUMNS}
    `);
    if (r.rows.length) updated = rowToOffer(r.rows[0] as Record<string, unknown>);
  } else if (input.action === "withdraw") {
    const r = await db.execute(sql`
      UPDATE product_offers
      SET status = 'withdrawn', decided_at = now(), updated_at = now(), claimed_ref = NULL, claimed_at = NULL
      WHERE id = ${row.id}::uuid AND status = ${row.status}
      RETURNING ${OFFER_COLUMNS}
    `);
    if (r.rows.length) updated = rowToOffer(r.rows[0] as Record<string, unknown>);
  } else {
    /* counter: the floor is the countering side's OWN last price and
       the ceiling is the other side's standing price — a seller
       counters up from the buyer's offer toward list; a buyer
       counters up from their own offer toward the seller's counter. */
    const floor = row.offer_amount_cents;
    const ceiling = actor === "seller" ? row.list_price_cents : row.counter_amount_cents!;
    const valid = validateCounterAmount(input.amountCents, floor, ceiling);
    if (!valid.ok) return { ok: false, reason: "bad_amount", message: valid.reason };
    if (actor === "seller") {
      const r = await db.execute(sql`
        UPDATE product_offers
        SET status = 'countered', counter_amount_cents = ${valid.amountCents}, updated_at = now(),
            expires_at = ${expiresSql}
        WHERE id = ${row.id}::uuid AND status = 'pending'
        RETURNING ${OFFER_COLUMNS}
      `);
      if (r.rows.length) updated = rowToOffer(r.rows[0] as Record<string, unknown>);
    } else {
      /* Buyer counter-counter: their new price becomes the standing
         offer, the seller's counter clears, the turn returns. */
      const r = await db.execute(sql`
        UPDATE product_offers
        SET status = 'pending', offer_amount_cents = ${valid.amountCents}, counter_amount_cents = NULL,
            updated_at = now(), expires_at = ${expiresSql}
        WHERE id = ${row.id}::uuid AND status = 'countered'
        RETURNING ${OFFER_COLUMNS}
      `);
      if (r.rows.length) updated = rowToOffer(r.rows[0] as Record<string, unknown>);
    }
  }

  if (!updated) return { ok: false, reason: "not_open", message: "That offer just changed — refresh and try again." };

  const item = await resolveOfferItem(row.item_kind, row.item_id, db).catch(() => null);
  const title = item?.title ?? "a product";
  const link = item?.link ?? "";
  if (input.action === "accept") {
    const other = actor === "seller" ? row.buyer_user_id : row.seller_user_id;
    await notifySafely(db, {
      userId: other, kind: "product_offer_accepted",
      title: "Offer accepted",
      body: actor === "seller"
        ? `Your ${formatUsd(updated.agreed_amount_cents!)} offer for "${title}" was accepted — check out at that price before it expires.`
        : `You accepted the ${formatUsd(updated.agreed_amount_cents!)} counter for "${title}" — check out at that price before it expires.`,
      link,
    });
  } else if (input.action === "counter") {
    const other = actor === "seller" ? row.buyer_user_id : row.seller_user_id;
    await notifySafely(db, {
      userId: other, kind: "product_offer_countered",
      title: "Counter-offer",
      body: `"${title}" was countered at ${formatUsd(currentOfferPriceCents(updated))} (listed at ${formatUsd(row.list_price_cents)}).`,
      link: actor === "seller" ? link : row.item_kind === "store_product" ? "/music-sales" : "/my-shop",
    });
  } else {
    const other = actor === "buyer" && input.action === "withdraw" ? row.seller_user_id : row.buyer_user_id;
    if (input.action === "decline") {
      await notifySafely(db, {
        userId: other, kind: "product_offer_declined",
        title: "Offer declined",
        body: `The offer on "${title}" was declined.`,
        link,
      });
    }
  }
  return { ok: true, offer: updated };
}

/* ── Lists ───────────────────────────────────────────────────────────── */

export interface OfferListEntry extends ProductOfferRow {
  title: string;
  currentListPriceCents: number | null;
  available: boolean;
  link: string;
  currentPriceCents: number;
}

async function listOffers(where: ReturnType<typeof sql>, db: OfferDb): Promise<OfferListEntry[]> {
  const r = await db.execute(sql`
    SELECT ${OFFER_COLUMNS} FROM product_offers WHERE ${where} ORDER BY updated_at DESC LIMIT 100
  `);
  const entries: OfferListEntry[] = [];
  for (const raw of r.rows as unknown as Array<Record<string, unknown>>) {
    const row = rowToOffer(raw);
    const item = await resolveOfferItem(row.item_kind, row.item_id, db).catch(() => null);
    entries.push({
      ...row,
      title: item?.title ?? "",
      currentListPriceCents: item ? item.priceCents : null,
      available: item ? item.available : false,
      link: item?.link ?? "",
      currentPriceCents: currentOfferPriceCents(row),
    });
  }
  return entries;
}

export async function listBuyerOffers(buyerUserId: string, db: OfferDb = defaultDb): Promise<OfferListEntry[]> {
  await expireStaleOffers(db).catch(() => 0);
  return listOffers(sql`buyer_user_id = ${buyerUserId}::uuid`, db);
}

export async function listSellerOffers(sellerUserId: string, db: OfferDb = defaultDb): Promise<OfferListEntry[]> {
  await expireStaleOffers(db).catch(() => 0);
  return listOffers(sql`seller_user_id = ${sellerUserId}::uuid`, db);
}

export async function getOfferForBuyer(
  buyerUserId: string, itemKind: ProductOfferItemKind, itemId: string, db: OfferDb = defaultDb,
): Promise<OfferListEntry | null> {
  await expireStaleOffers(db).catch(() => 0);
  const entries = await listOffers(
    sql`buyer_user_id = ${buyerUserId}::uuid AND item_kind = ${itemKind} AND item_id = ${itemId}::uuid AND status IN ('pending', 'countered', 'accepted')`,
    db,
  );
  return entries[0] ?? null;
}

/* ── Checkout claim / consume ────────────────────────────────────────── */

export interface AcceptedOfferForCheckout {
  offer: ProductOfferRow;
  agreedAmountCents: number;
}

/** Resolve the accepted offer a checkout may charge: the caller's own
 *  accepted, unexpired offer for THIS product on THIS surface. When
 *  `claimRef` is given, the call also takes the checkout claim
 *  (guarded — a live claim by another checkout refuses). */
export async function resolveAcceptedOfferForCheckout(
  input: {
    offerId: string; buyerUserId: string; itemKind: ProductOfferItemKind; itemId: string;
    claimRef?: string;
  },
  db: OfferDb = defaultDb,
): Promise<
  | { ok: true; offer: ProductOfferRow; agreedAmountCents: number }
  | { ok: false; reason: "not_found" | "not_accepted" | "expired" | "claimed" | "unavailable"; message: string }
> {
  await expireStaleOffers(db).catch(() => 0);
  const row = await getOfferRow(input.offerId, db);
  if (!row || row.buyer_user_id !== input.buyerUserId || row.item_kind !== input.itemKind || row.item_id !== input.itemId) {
    return { ok: false, reason: "not_found", message: "That offer could not be found for this product." };
  }
  if (row.status === "expired") return { ok: false, reason: "expired", message: "That offer has expired — make a fresh one." };
  if (row.status !== "accepted" || row.agreed_amount_cents == null) {
    return { ok: false, reason: "not_accepted", message: "That offer hasn't been accepted yet — the price is agreed only once the seller accepts (or you accept their counter)." };
  }
  if (input.claimRef) {
    const cutoff = new Date(Date.now() - PRODUCT_OFFER_CLAIM_MINUTES * 60_000).toISOString();
    const claimed = await db.execute(sql`
      UPDATE product_offers SET claimed_ref = ${input.claimRef}, claimed_at = now(), updated_at = now()
      WHERE id = ${row.id}::uuid AND status = 'accepted'
        AND (claimed_ref IS NULL OR claimed_at < ${cutoff} OR claimed_ref = ${input.claimRef})
      RETURNING ${OFFER_COLUMNS}
    `);
    if (!claimed.rows.length) {
      return { ok: false, reason: "claimed", message: "That offer is already in another checkout — finish that one, or wait a few minutes for it to free up." };
    }
    return { ok: true, offer: rowToOffer(claimed.rows[0] as Record<string, unknown>), agreedAmountCents: row.agreed_amount_cents };
  }
  return { ok: true, offer: row, agreedAmountCents: row.agreed_amount_cents };
}

/** Move a claim from its provisional ref (minted before the Stripe
 *  session exists) to the session id, so the paid flip can find the
 *  offer by the ref the sale carries. Returns false when the claim
 *  was lost meanwhile (taken over after going stale, or consumed). */
export async function restampOfferClaim(
  offerId: string, fromRef: string, toRef: string, db: OfferDb = defaultDb,
): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      UPDATE product_offers SET claimed_ref = ${toRef}, claimed_at = now(), updated_at = now()
      WHERE id = ${offerId}::uuid AND claimed_ref = ${fromRef} AND status = 'accepted'
      RETURNING id
    `);
    return r.rows.length > 0;
  } catch (err) {
    if (!isUndefinedTable(err)) logger.warn({ err, offerId }, "[product-offers] claim restamp failed");
    return false;
  }
}

/** Shop-surface variant: POST /api/storefronts/checkout is a PUBLIC
 *  checkout (no buyer auth — the buyer is an email), so the offer is
 *  bound by product + shop instead of by buyer. The offer id itself
 *  is the capability: it is only ever shown to its buyer and seller
 *  (both lists are auth-scoped), and the only privilege it carries is
 *  the agreed price on that one product, consumed exactly once by
 *  the paid flip. The claim ref is the checkout group id. */
export async function resolveAcceptedShopOfferForCheckout(
  input: { offerId: string; itemId: string; shopId: string; claimRef?: string },
  db: OfferDb = defaultDb,
): Promise<
  | { ok: true; offer: ProductOfferRow; agreedAmountCents: number }
  | { ok: false; reason: "not_found" | "not_accepted" | "expired" | "claimed"; message: string }
> {
  await expireStaleOffers(db).catch(() => 0);
  const row = await getOfferRow(input.offerId, db);
  if (!row || row.item_kind !== "shop_product" || row.item_id !== input.itemId || row.shop_id !== input.shopId) {
    return { ok: false, reason: "not_found", message: "That offer could not be found for this product." };
  }
  if (row.status === "expired") return { ok: false, reason: "expired", message: "That offer has expired — make a fresh one." };
  if (row.status !== "accepted" || row.agreed_amount_cents == null) {
    return { ok: false, reason: "not_accepted", message: "That offer hasn't been accepted yet — the price is agreed only once the seller accepts (or the buyer accepts a counter)." };
  }
  if (!input.claimRef) return { ok: true, offer: row, agreedAmountCents: row.agreed_amount_cents };
  const cutoff = new Date(Date.now() - PRODUCT_OFFER_CLAIM_MINUTES * 60_000).toISOString();
  const claimed = await db.execute(sql`
    UPDATE product_offers SET claimed_ref = ${input.claimRef}, claimed_at = now(), updated_at = now()
    WHERE id = ${row.id}::uuid AND status = 'accepted'
      AND (claimed_ref IS NULL OR claimed_at < ${cutoff} OR claimed_ref = ${input.claimRef})
    RETURNING ${OFFER_COLUMNS}
  `);
  if (!claimed.rows.length) {
    return { ok: false, reason: "claimed", message: "That offer is already in another checkout — finish that one, or wait a few minutes for it to free up." };
  }
  return { ok: true, offer: rowToOffer(claimed.rows[0] as Record<string, unknown>), agreedAmountCents: row.agreed_amount_cents };
}

/** Release a checkout claim (session creation failed). Never throws —
 *  a stuck claim self-heals at the 30-minute stale window. */
export async function releaseOfferClaim(offerId: string, claimRef: string, db: OfferDb = defaultDb): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE product_offers SET claimed_ref = NULL, claimed_at = NULL, updated_at = now()
      WHERE id = ${offerId}::uuid AND claimed_ref = ${claimRef} AND status = 'accepted'
    `);
  } catch (err) {
    if (!isUndefinedTable(err)) logger.warn({ err, offerId }, "[product-offers] claim release failed (self-heals in 30m)");
  }
}

/** Release ANY claim held under a ref (an expired shops checkout
 *  frees its offer without knowing the offer id). Never throws. */
export async function releaseOfferClaimByRef(claimRef: string, db: OfferDb = defaultDb): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE product_offers SET claimed_ref = NULL, claimed_at = NULL, updated_at = now()
      WHERE claimed_ref = ${claimRef} AND status = 'accepted'
    `);
  } catch (err) {
    if (!isUndefinedTable(err)) logger.warn({ err, claimRef }, "[product-offers] claim release by ref failed (self-heals in 30m)");
  }
}

/** Consume the offer whose claim ref matches a recorded sale (the
 *  storefront session id or the shops checkout group id). Exactly-once
 *  by the status guard. Never throws into a sale's paid flip. */
export async function consumeOfferByClaimRef(claimRef: string, db: OfferDb = defaultDb): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      UPDATE product_offers
      SET status = 'consumed', consumed_ref = ${claimRef}, consumed_at = now(), decided_at = now(), updated_at = now()
      WHERE claimed_ref = ${claimRef} AND status = 'accepted'
      RETURNING id
    `);
    return r.rows.length > 0;
  } catch (err) {
    if (!isUndefinedTable(err)) logger.error({ err, claimRef }, "[product-offers] consume by claim failed — reconcile");
    return false;
  }
}

/** Consume by offer id (storefront verify knows both ids). */
export async function consumeOfferById(offerId: string, consumedRef: string, db: OfferDb = defaultDb): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      UPDATE product_offers
      SET status = 'consumed', consumed_ref = ${consumedRef}, consumed_at = now(), decided_at = now(), updated_at = now()
      WHERE id = ${offerId}::uuid AND status = 'accepted'
      RETURNING id
    `);
    return r.rows.length > 0;
  } catch (err) {
    if (!isUndefinedTable(err)) logger.error({ err, offerId }, "[product-offers] consume failed — reconcile");
    return false;
  }
}
