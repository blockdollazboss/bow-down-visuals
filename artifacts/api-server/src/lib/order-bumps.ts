/**
 * order-bumps.ts — Order bumps for the Sell Everything storefront
 * (Stack-100 #3, feature #13). Pure domain logic: no DB, no Stripe.
 *
 * A bump is ONE add-on offer attached to a product: at checkout the
 * buyer can tick it to add a second product (same seller) to the same
 * payment. The bump price is the seller-set price of that product,
 * optionally reduced by a seller-set percent off — this module never
 * invents a price.
 *
 * Money law (platform-fees.ts is the single source of truth):
 *  - The platform fee stays the flat 5% (PLATFORM_FEE_BPS) on the whole
 *    session, bump included — the fee story never changes per line.
 *  - Total fee = feeSplit(session total). Line attribution for
 *    receipts: the bump line's fee is feeSplit(bump gross); the main
 *    line carries the remainder, so the two lines always sum exactly
 *    to the session fee — no cent is created or lost.
 *  - With no bump, every figure is identical to the pre-bump rail.
 *
 * Persistence (migration reported by the lane, applied separately):
 * the attachment lives on store_products.bump_product_id /
 * bump_percent_off and the purchased line on store_orders.bump_*.
 * readBumpConfig is deliberately defensive: it reads those keys off a
 * product row when present and returns null when they are absent or
 * invalid, so every surface simply offers no bump until the columns
 * exist and a seller sets one.
 */
import { feeSplit, PLATFORM_FEE_BPS } from "./platform-fees";

/** Percent-off ceiling for a bump — mirrors discount_codes (1..90). */
export const MAX_BUMP_PERCENT_OFF = 90;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BumpConfig {
  bumpProductId: string;
  /** 0 = the add-on sells at its listed price. */
  percentOff: number;
}

/**
 * Read a product row's bump attachment. Accepts both the raw SQL row
 * shape (bump_product_id / bump_percent_off) and camelCase. Returns
 * null for anything missing or malformed — a bad attachment must never
 * break the main product's sale, it just offers no bump.
 */
export function readBumpConfig(row: Record<string, unknown> | null | undefined): BumpConfig | null {
  if (!row) return null;
  const idRaw = row["bump_product_id"] ?? row["bumpProductId"];
  const pctRaw = row["bump_percent_off"] ?? row["bumpPercentOff"];
  if (typeof idRaw !== "string" || !UUID_RE.test(idRaw)) return null;
  const pct = Number(pctRaw ?? 0);
  if (!Number.isInteger(pct) || pct < 0 || pct > MAX_BUMP_PERCENT_OFF) return null;
  return { bumpProductId: idRaw, percentOff: pct };
}

export interface BumpProductFacts {
  id: string;
  profileId: string;
  priceCents: number;
  isActive: boolean;
  inventory: number;
}

export type BumpTargetVerdict =
  | { ok: true }
  | { ok: false; code: "BUMP_SELF" | "BUMP_OTHER_SELLER" | "BUMP_INACTIVE" | "BUMP_FREE" | "BUMP_SOLD_OUT"; reason: string };

/**
 * May `target` serve as the bump on `main`? One seller only (a bump is
 * fulfilled and paid out as part of the same creator's order), never
 * the product itself, never a $0 lead magnet (those ride the free
 * claim rail — a paid checkout line of $0 would corrupt the session),
 * never a sold-out item.
 */
export function validateBumpTarget(
  main: { id: string; profileId: string },
  target: BumpProductFacts,
): BumpTargetVerdict {
  if (target.id === main.id) {
    return { ok: false, code: "BUMP_SELF", reason: "A product can't be its own add-on." };
  }
  if (target.profileId !== main.profileId) {
    return { ok: false, code: "BUMP_OTHER_SELLER", reason: "The add-on has to be one of your own products." };
  }
  if (!target.isActive) {
    return { ok: false, code: "BUMP_INACTIVE", reason: "That add-on isn't for sale right now." };
  }
  if (Math.round(target.priceCents) <= 0) {
    return { ok: false, code: "BUMP_FREE", reason: "A free product can't be a paid add-on — it's claimed by email instead." };
  }
  if (Number(target.inventory) === 0) {
    return { ok: false, code: "BUMP_SOLD_OUT", reason: "That add-on just sold out." };
  }
  return { ok: true };
}

/**
 * The buyer-facing price of the bump line: the seller-set price with
 * the seller-set percent off, rounded to the cent, floored at 1¢ so a
 * genuinely priced product never becomes a $0 Stripe line.
 */
export function bumpUnitCents(listPriceCents: number, percentOff: number): number {
  const list = Math.max(0, Math.round(listPriceCents));
  const pct = Math.max(0, Math.min(MAX_BUMP_PERCENT_OFF, Math.round(percentOff)));
  if (list === 0) return 0;
  return Math.max(1, Math.round((list * (100 - pct)) / 100));
}

export interface OrderLineSplit {
  grossCents: number;
  feeCents: number;
  creatorCents: number;
}

export interface BumpTotals {
  main: OrderLineSplit;
  bump: OrderLineSplit | null;
  totalGrossCents: number;
  totalFeeCents: number;
  totalCreatorCents: number;
  feeBps: number;
}

/**
 * Attribute a session's amounts across the main line and the bump
 * line. The session fee is computed ONCE on the total (the rail's
 * historic behaviour); the bump's fee is its own split; the main line
 * absorbs any rounding remainder so lines sum exactly to the session.
 * Used at checkout (to quote) and at verify (to record) — same inputs,
 * same numbers, which is what makes double-recording impossible to
 * drift.
 */
export function splitOrderAmounts(
  totalGrossCents: number,
  bumpGrossCents: number,
  feeBps: number = PLATFORM_FEE_BPS,
): BumpTotals {
  const total = feeSplit(Math.max(0, Math.round(totalGrossCents)), feeBps);
  const bumpGross = Math.max(0, Math.min(Math.round(bumpGrossCents), total.gross));
  if (bumpGross <= 0) {
    return {
      main: { grossCents: total.gross, feeCents: total.fee, creatorCents: total.net },
      bump: null,
      totalGrossCents: total.gross,
      totalFeeCents: total.fee,
      totalCreatorCents: total.net,
      feeBps: total.feeBps,
    };
  }
  const bumpFee = feeSplit(bumpGross, feeBps).fee;
  const mainGross = total.gross - bumpGross;
  const mainFee = total.fee - bumpFee;
  return {
    main: { grossCents: mainGross, feeCents: mainFee, creatorCents: mainGross - mainFee },
    bump: { grossCents: bumpGross, feeCents: bumpFee, creatorCents: bumpGross - bumpFee },
    totalGrossCents: total.gross,
    totalFeeCents: total.fee,
    totalCreatorCents: total.net,
    feeBps: total.feeBps,
  };
}
