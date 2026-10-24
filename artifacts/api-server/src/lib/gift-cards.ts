/**
 * gift-cards.ts — stored-value gift cards for a seller's whole store
 * (Stack-100 #3 item 26).
 *
 * A gift card is a LIABILITY, not revenue: at issuance the platform
 * holds the buyer's money and owes it to the holder. The seller is
 * credited only when the card is redeemed — at the real sale — where
 * the existing rails charge their platform fee exactly once, on the
 * sale's full gross.
 *
 * FEE LAW (derived from the codebase, never invented):
 *  - Issuance: NO platform fee and NO seller credit. platform-fees.ts
 *    is explicit that feeSplit applies to sales ("Every sale surface —
 *    downloads, products, services, tickets — must compute its split
 *    through this module"), and a gift-card issuance is not a sale of
 *    goods — it is prepaid tender. Taking the fee at issuance AND at
 *    redemption would charge the same dollar twice.
 *  - Redemption: the card is a payment TENDER, not a discount. The
 *    storefront rail's sequence is "discount first, then fee out of
 *    the discounted gross" (routes/storefront.ts splitTotals over the
 *    discounted line total) — tender never reduces the gross, so the
 *    rails' feeSplit(gross) applies unchanged to the full sale gross,
 *    including the gift-card-paid portion. The seller's net is the
 *    same as if the buyer had paid cash.
 *
 * MONEY HYGIENE:
 *  - Codes are bearer secrets: only SHA-256(code) + last4 are stored.
 *    The plaintext code exists once — at issuance (buyer's verify
 *    response + the recipient's delivery email).
 *  - Balance never goes below zero and never double-spends: reserve
 *    and redeem are single conditional UPDATEs
 *    (… WHERE balance_cents - reserved_cents >= $amount / reserved
 *    covers the debit), so concurrent checkouts serialize on the row.
 *  - Every money movement writes an append-only ledger row under a
 *    UNIQUE idempotency key: issue:{sessionId}, redeem:{reservationId},
 *    refund:{cardId}. Replays are no-ops.
 *  - A checkout RESERVES its tender (30 min); verify REDEEMS the
 *    reservation; expiry/cancel RELEASES it. Reserved cents are not
 *    spendable elsewhere and are not refundable until released.
 *  - Refund of a gift-card purchase claws back only the UNSPENT,
 *    UNRESERVED balance, exactly once, and voids the card — it can
 *    never create negative value or refund spent cents twice.
 *  - Reconciliation identity per card, to the cent:
 *      initial = balance + Σ(ledger redeem) + Σ(ledger refund_clawback)
 *
 * ⚠️ PENDING-MIGRATION: gift_cards / gift_card_ledger /
 * gift_card_reservations land in the held migration (see
 * .lane/MIGRATION-NEEDED.md). Until then every DB helper here throws
 * GiftCardsUnavailable and routes answer 503 — money fails closed.
 *
 * Queries use raw SQL via db.execute(sql``) — the storefront/store
 * convention (pg-mem cannot run the drizzle query builder).
 */
import { createHash, randomBytes } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/* ── Code scheme ─────────────────────────────────────────────────────
   BDV-XXXX-XXXX-XXXX-XXXX over an unambiguous alphabet (no 0/O/1/I/L):
   16 chars ≈ 79 bits — unguessable, typable from an email. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGiftCardCode(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  const grouped = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
  return `BDV-${grouped}`;
}

/** Normalize a holder-typed code to canonical form (case/space-insensitive). */
export function normalizeGiftCardCode(raw: string): string {
  const cleaned = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = cleaned.startsWith("BDV") ? cleaned.slice(3) : cleaned;
  if (body.length !== 16) return cleaned; // hash of garbage simply won't match a card
  return `BDV-${[0, 4, 8, 12].map((i) => body.slice(i, i + 4)).join("-")}`;
}

export function hashGiftCardCode(code: string): string {
  return createHash("sha256").update(normalizeGiftCardCode(code)).digest("hex");
}

export function giftCardLast4(code: string): string {
  const cleaned = String(code ?? "").replace(/[^A-Za-z0-9]/g, "");
  return cleaned.slice(-4).toUpperCase();
}

const CODE_RE = /^BDV(-[A-HJ-KM-NP-Z2-9]{4}){4}$/;
export function isGiftCardCodeShape(raw: string): boolean {
  return CODE_RE.test(normalizeGiftCardCode(raw));
}

/* ── Pure money math (unit-tested without a DB) ────────────────────── */

/** Cents of a due amount a card can cover: never more than the due,
 *  never more than the unreserved balance, never negative. */
export function tenderFor(availableCents: number, dueCents: number): number {
  const a = Math.max(0, Math.floor(availableCents));
  const d = Math.max(0, Math.floor(dueCents));
  return Math.min(a, d);
}

/** What a refund may claw back: the unspent, unreserved balance only. */
export function refundableCents(balanceCents: number, reservedCents: number): number {
  return Math.max(0, Math.floor(balanceCents) - Math.max(0, Math.floor(reservedCents)));
}

/** The reconciliation identity, to the cent. */
export function reconciles(input: {
  initialCents: number;
  balanceCents: number;
  redeemedCents: number;
  refundedCents: number;
}): boolean {
  return (
    input.initialCents ===
    input.balanceCents + input.redeemedCents + input.refundedCents
  );
}

/** Seller-configured denominations are valid when: 1–8 distinct
 *  integer-cent amounts, each $5–$500 (house price sanity band). */
export function validateDenominations(input: unknown): { ok: true; denominations: number[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "Pick at least one gift-card amount." };
  }
  if (input.length > 8) return { ok: false, error: "At most 8 gift-card amounts." };
  const values = input.map((v) => (typeof v === "number" ? v : NaN));
  if (values.some((v) => !Number.isInteger(v) || v < 500 || v > 50_000)) {
    return { ok: false, error: "Gift-card amounts must be whole cents between $5 and $500." };
  }
  const denominations = [...new Set(values)].sort((a, b) => a - b);
  return { ok: true, denominations };
}

/* ── Fail-closed plumbing ──────────────────────────────────────────── */

export class GiftCardsUnavailable extends Error {
  constructor() {
    super("Gift cards are not available yet.");
    this.name = "GiftCardsUnavailable";
  }
}

function rethrowGiftCardErrors(err: unknown): never {
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? "";
  /* 42P01 undefined_table / 42703 undefined_column = the held migration
     hasn't landed. Anything else is a real error — let it surface. */
  if (e?.code === "42P01" || e?.code === "42703" || /relation "gift_card|column .*gift_card/i.test(msg)) {
    throw new GiftCardsUnavailable();
  }
  throw err;
}

async function exec(query: Parameters<typeof db.execute>[0]) {
  try {
    return await db.execute(query);
  } catch (err) {
    rethrowGiftCardErrors(err);
  }
}

export interface GiftCardRow extends Record<string, unknown> {
  id: string;
  code_last4: string;
  profile_id: string;
  product_id: string | null;
  buyer_user_id: string | null;
  recipient_email: string;
  initial_cents: number;
  balance_cents: number;
  reserved_cents: number;
  status: string;
  stripe_session_id: string | null;
  created_at: string;
}

/** Available (unreserved) balance of a card row. */
export function availableCents(card: Pick<GiftCardRow, "balance_cents" | "reserved_cents">): number {
  return Math.max(0, Number(card.balance_cents) - Number(card.reserved_cents));
}

export async function findCardByCode(code: string): Promise<GiftCardRow | null> {
  const r = await exec(sql`
    SELECT * FROM gift_cards WHERE code_hash = ${hashGiftCardCode(code)} LIMIT 1
  `);
  return (r.rows[0] as unknown as GiftCardRow | undefined) ?? null;
}

export async function findCardById(id: string): Promise<GiftCardRow | null> {
  const r = await exec(sql`SELECT * FROM gift_cards WHERE id = ${id} LIMIT 1`);
  return (r.rows[0] as unknown as GiftCardRow | undefined) ?? null;
}

/* ── Issuance (verify-time, exactly once per Stripe session) ──────── */

export async function issueGiftCard(args: {
  code: string;
  profileId: string;
  productId: string | null;
  buyerUserId: string;
  recipientEmail: string;
  recipientName: string | null;
  message: string | null;
  amountCents: number;
  stripeSessionId: string;
}): Promise<{ card: GiftCardRow; duplicate: boolean }> {
  const inserted = await exec(sql`
    INSERT INTO gift_cards
      (code_hash, code_last4, profile_id, product_id, buyer_user_id,
       recipient_email, recipient_name, message, initial_cents, balance_cents,
       reserved_cents, status, stripe_session_id)
    VALUES (${hashGiftCardCode(args.code)}, ${giftCardLast4(args.code)}, ${args.profileId},
            ${args.productId}, ${args.buyerUserId}, ${args.recipientEmail},
            ${args.recipientName}, ${args.message}, ${args.amountCents}, ${args.amountCents},
            0, 'active', ${args.stripeSessionId})
    ON CONFLICT (stripe_session_id) DO NOTHING
    RETURNING *
  `);
  if (inserted.rows.length === 0) {
    const existing = await exec(sql`
      SELECT * FROM gift_cards WHERE stripe_session_id = ${args.stripeSessionId} LIMIT 1
    `);
    const card = existing.rows[0] as unknown as GiftCardRow;
    return { card, duplicate: true };
  }
  const card = inserted.rows[0] as unknown as GiftCardRow;
  await exec(sql`
    INSERT INTO gift_card_ledger
      (gift_card_id, kind, amount_cents, balance_after_cents, ref, idempotency_key)
    VALUES (${card.id}, 'issue', ${args.amountCents}, ${args.amountCents},
            ${args.stripeSessionId}, ${`issue:${args.stripeSessionId}`})
    ON CONFLICT (idempotency_key) DO NOTHING
  `);
  return { card, duplicate: false };
}

/* ── Reservations: hold at checkout, settle at verify ─────────────── */

export const RESERVATION_TTL_MINUTES = 30;

export interface ReservationRow extends Record<string, unknown> {
  id: string;
  gift_card_id: string;
  rail: string;
  ref: string;
  amount_cents: number;
  status: string;
  expires_at: string;
}

/** Release every expired hold (sweep-on-read: called before reserving,
 *  so an abandoned checkout's cents come back without a cron). */
export async function releaseExpiredReservations(): Promise<void> {
  const stale = await exec(sql`
    SELECT id, gift_card_id, amount_cents FROM gift_card_reservations
    WHERE status = 'reserved' AND expires_at < now()
    LIMIT 200
  `);
  for (const row of stale.rows as unknown as ReservationRow[]) {
    await releaseReservation(String(row.id));
  }
}

/**
 * Atomically hold `amountCents` of a card for one checkout.
 * One reservation per (rail, ref): a replay returns the same hold.
 * The conditional UPDATE is the concurrency guard — two checkouts
 * racing the same card cannot both hold more than its balance.
 */
export async function reserveGiftCard(args: {
  cardId: string;
  rail: string;
  ref: string;
  amountCents: number;
}): Promise<ReservationRow | null> {
  const existing = await exec(sql`
    SELECT * FROM gift_card_reservations
    WHERE rail = ${args.rail} AND ref = ${args.ref} LIMIT 1
  `);
  const prior = existing.rows[0] as unknown as ReservationRow | undefined;
  if (prior && prior.status !== "released") return prior;

  const held = await exec(sql`
    UPDATE gift_cards
    SET reserved_cents = reserved_cents + ${args.amountCents}, updated_at = now()
    WHERE id = ${args.cardId} AND status = 'active'
      AND balance_cents - reserved_cents >= ${args.amountCents}
    RETURNING id
  `);
  if (held.rows.length === 0) return null;

  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000);
  const inserted = await exec(sql`
    INSERT INTO gift_card_reservations
      (gift_card_id, rail, ref, amount_cents, status, expires_at)
    VALUES (${args.cardId}, ${args.rail}, ${args.ref}, ${args.amountCents},
            'reserved', ${expiresAt.toISOString()})
    ON CONFLICT (rail, ref) DO NOTHING
    RETURNING *
  `);
  if (inserted.rows.length === 0) {
    /* Lost a race on the same (rail, ref): undo our hold, use theirs. */
    await exec(sql`
      UPDATE gift_cards
      SET reserved_cents = reserved_cents - ${args.amountCents}, updated_at = now()
      WHERE id = ${args.cardId} AND reserved_cents >= ${args.amountCents}
    `);
    const again = await exec(sql`
      SELECT * FROM gift_card_reservations
      WHERE rail = ${args.rail} AND ref = ${args.ref} LIMIT 1
    `);
    return (again.rows[0] as unknown as ReservationRow | undefined) ?? null;
  }
  return inserted.rows[0] as unknown as ReservationRow;
}

/** Settle a hold into a real debit. Idempotent: an already-redeemed
 *  reservation returns its amount without debiting again. */
export async function redeemReservation(args: {
  reservationId: string;
  ref: string;
}): Promise<{ redeemedCents: number; balanceAfterCents: number } | null> {
  const r = await exec(sql`
    SELECT * FROM gift_card_reservations WHERE id = ${args.reservationId} LIMIT 1
  `);
  const reservation = r.rows[0] as unknown as ReservationRow | undefined;
  if (!reservation) return null;
  if (reservation.status === "redeemed") {
    const card = await findCardById(reservation.gift_card_id);
    return { redeemedCents: Number(reservation.amount_cents), balanceAfterCents: card ? Number(card.balance_cents) : 0 };
  }
  if (reservation.status !== "reserved") return null;

  const amount = Number(reservation.amount_cents);
  const debited = await exec(sql`
    UPDATE gift_cards
    SET balance_cents = balance_cents - ${amount},
        reserved_cents = reserved_cents - ${amount},
        status = CASE WHEN balance_cents - ${amount} = 0 THEN 'depleted' ELSE status END,
        updated_at = now()
    WHERE id = ${reservation.gift_card_id}
      AND balance_cents >= ${amount} AND reserved_cents >= ${amount}
    RETURNING balance_cents
  `);
  if (debited.rows.length === 0) return null;
  const balanceAfter = Number((debited.rows[0] as Record<string, unknown>)["balance_cents"]);

  await exec(sql`
    UPDATE gift_card_reservations
    SET status = 'redeemed', updated_at = now()
    WHERE id = ${args.reservationId} AND status = 'reserved'
  `);
  await exec(sql`
    INSERT INTO gift_card_ledger
      (gift_card_id, kind, amount_cents, balance_after_cents, ref, idempotency_key)
    VALUES (${reservation.gift_card_id}, 'redeem', ${amount}, ${balanceAfter},
            ${args.ref}, ${`redeem:${args.reservationId}`})
    ON CONFLICT (idempotency_key) DO NOTHING
  `);
  return { redeemedCents: amount, balanceAfterCents: balanceAfter };
}

/** Give a hold back (checkout failed / expired / abandoned). */
export async function releaseReservation(reservationId: string): Promise<void> {
  const flipped = await exec(sql`
    UPDATE gift_card_reservations
    SET status = 'released', updated_at = now()
    WHERE id = ${reservationId} AND status = 'reserved'
    RETURNING gift_card_id, amount_cents
  `);
  const row = flipped.rows[0] as Record<string, unknown> | undefined;
  if (!row) return;
  await exec(sql`
    UPDATE gift_cards
    SET reserved_cents = reserved_cents - ${Number(row["amount_cents"])}, updated_at = now()
    WHERE id = ${String(row["gift_card_id"])} AND reserved_cents >= ${Number(row["amount_cents"])}
  `);
}

export async function findReservation(rail: string, ref: string): Promise<ReservationRow | null> {
  const r = await exec(sql`
    SELECT * FROM gift_card_reservations WHERE rail = ${rail} AND ref = ${ref} LIMIT 1
  `);
  return (r.rows[0] as unknown as ReservationRow | undefined) ?? null;
}

/* ── Refund clawback ─────────────────────────────────────────────────
   Claws back ONLY the unspent, unreserved balance, exactly once
   (ledger key refund:{cardId}), and closes the card. The Stripe
   refund itself is the caller's job (it owns the session); this is
   the ledger side, and it runs only after that refund lands. */
export async function clawbackUnspentBalance(cardId: string): Promise<{ refundedCents: number; duplicate: boolean } | null> {
  const card = await findCardById(cardId);
  if (!card) return null;
  if (card.status === "refunded") return { refundedCents: 0, duplicate: true };
  if (card.status !== "active" && card.status !== "depleted") return null;
  const amount = refundableCents(Number(card.balance_cents), Number(card.reserved_cents));
  if (amount <= 0 && Number(card.reserved_cents) > 0) return null; // holds in flight — refuse
  const updated = await exec(sql`
    UPDATE gift_cards
    SET balance_cents = balance_cents - ${amount},
        status = 'refunded', updated_at = now()
    WHERE id = ${cardId} AND status IN ('active','depleted')
      AND balance_cents - reserved_cents >= ${amount}
    RETURNING balance_cents
  `);
  if (updated.rows.length === 0) return null;
  const balanceAfter = Number((updated.rows[0] as Record<string, unknown>)["balance_cents"]);
  if (amount > 0) {
    await exec(sql`
      INSERT INTO gift_card_ledger
        (gift_card_id, kind, amount_cents, balance_after_cents, ref, idempotency_key)
      VALUES (${cardId}, 'refund_clawback', ${amount}, ${balanceAfter},
              ${card.stripe_session_id ?? ""}, ${`refund:${cardId}`})
      ON CONFLICT (idempotency_key) DO NOTHING
    `);
  }
  return { refundedCents: amount, duplicate: false };
}

/** Public-safe card view: never the code, never the hash. */
export function presentCard(card: GiftCardRow, storeName?: string) {
  return {
    id: card.id,
    codeLast4: String(card.code_last4),
    status: String(card.status),
    initialCents: Number(card.initial_cents),
    balanceCents: Number(card.balance_cents),
    reservedCents: Number(card.reserved_cents),
    availableCents: availableCents(card),
    recipientEmail: String(card.recipient_email),
    storeName: storeName ?? null,
    createdAt: String(card.created_at),
  };
}
