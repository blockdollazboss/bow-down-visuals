/**
 * sale-splits.ts — Co-seller revenue splits on store & shop products
 * (Wave 4 #36, migration 0235).
 *
 * Two creators sell ONE product together; the sale divides
 * automatically instead of one collecting everything and paying the
 * other by hand.
 *
 * THE MACHINE (the publishing-splits pattern, lib/publishing-splits):
 * the product carries a splits list — [{ userId, sharePct }] — whose
 * shares sum to exactly 100 (0.01 tolerance), each share > 0 and
 * ≤ 100 with at most two decimals, no account listed twice, and the
 * product's OWNER is one row of the list with their own share. The
 * sellers set every percentage; the platform invents none. A seller
 * with no creator profile can't be verified as an account and is
 * refused (the publishing registry's resolveWriters rule).
 *
 * THE MONEY (the affiliate rail's fee order): the flat 5% platform
 * fee comes off the TOP first — it is already out of the parent sale
 * rows' creator net (store_orders.creator_amount_cents, shop_events
 * amount − platform_fee) — and the split divides what remains.
 * recordStoreOrderSplits / recordShopEventSplits write one
 * sale_split_entries row per seller per product line at fulfillment,
 * snapshotting the shares, so later edits never rewrite history.
 * Parent sale rows are NEVER modified: earnings and pending-payout
 * sums subtract the co-seller rows from the owner and add them to the
 * co-seller (saleSplitPayoutAdjustments), in the bulk-ledger
 * discipline of digital_sales / store_orders.
 *
 * REFUNDS: payment-reversals flips the parent sale and calls
 * reverseSplitEntriesForSession in the same pass — every entry on the
 * sale flips 'earned' → 'reversed' with it, so BOTH sellers lose the
 * sale symmetrically, exactly once (the flip is status-guarded and
 * the engine's claim makes the pass itself exactly-once). Partial
 * refunds never reach the flip, mirroring the engine's rule that
 * seller ledgers reverse only on a full refund / lost dispute.
 *
 * Pre-migration posture (0235 not yet applied): product writes that
 * carry splits answer 503 (routes probe their column first); sale
 * recording degrades to "no splits" and adjustments read 0 — every
 * surface behaves exactly as it did before the feature.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { pgErrorCode, pgErrorText } from "./pg-errors";

export const SALE_SPLIT_SURFACES = ["store_product", "shop_product"] as const;
export type SaleSplitSurface = (typeof SALE_SPLIT_SURFACES)[number];
export type SaleSplitKind = "store_order" | "shop_event";

export interface ProductSplit {
  userId: string;
  sharePct: number;
}

export class SaleSplitError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ── Validation — the publishing sum-to-100 machine ──────────────────── */

export const SPLIT_SUM_TOLERANCE = 0.01;
export const MAX_SELLERS_PER_PRODUCT = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a splits list for a product owned by `ownerUserId`.
 * Returns the normalized list, or null when the feature is off
 * (null / empty input). Throws SaleSplitError with a seller-facing
 * message on any rule break — the same rules as songwriter splits:
 * sum to exactly 100, each share in (0, 100] with ≤ 2 decimals, no
 * duplicate accounts, and the owner must hold a share themselves.
 */
export function validateProductSplits(
  ownerUserId: string,
  input: unknown,
): ProductSplit[] | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) {
    throw new SaleSplitError("splits_invalid", "Splits must be a list of sellers and shares.");
  }
  if (input.length === 0) return null;
  if (input.length > MAX_SELLERS_PER_PRODUCT) {
    throw new SaleSplitError(
      "too_many_sellers",
      `A product can list at most ${MAX_SELLERS_PER_PRODUCT} sellers.`,
    );
  }
  const seen = new Set<string>();
  const out: ProductSplit[] = [];
  for (const raw of input) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const userId = typeof row["userId"] === "string" ? row["userId"] : "";
    if (!UUID_RE.test(userId)) {
      throw new SaleSplitError("seller_invalid", "Each co-seller must be a Bow Down Visuals creator account.");
    }
    if (seen.has(userId)) {
      throw new SaleSplitError(
        "duplicate_seller",
        "The same account can't be listed twice on one product — combine their shares into one entry.",
      );
    }
    seen.add(userId);
    const sharePct = row["sharePct"];
    if (typeof sharePct !== "number" || !Number.isFinite(sharePct)) {
      throw new SaleSplitError("split_invalid", "Each seller's share must be a number.");
    }
    if (sharePct <= 0 || sharePct > 100) {
      throw new SaleSplitError(
        "split_range",
        "Each seller's share must be more than 0% and no more than 100%.",
      );
    }
    if (Math.abs(sharePct * 100 - Math.round(sharePct * 100)) > 1e-9) {
      throw new SaleSplitError("split_precision", "Shares can have at most two decimal places.");
    }
    out.push({ userId, sharePct });
  }
  if (!seen.has(ownerUserId)) {
    throw new SaleSplitError(
      "owner_missing",
      "Your own share must be in the list — the shares divide the whole sale, including your part.",
    );
  }
  const total = out.reduce((sum, s) => sum + s.sharePct, 0);
  if (Math.abs(total - 100) > SPLIT_SUM_TOLERANCE) {
    throw new SaleSplitError(
      "split_sum",
      `Seller shares must total 100% — yours total ${total.toFixed(2)}%.`,
    );
  }
  /* A lone entry can only be the owner at 100% (the checks above force
     it) — that IS "no co-sellers", so the setting collapses to off and
     the product stores null, exactly like an empty list. */
  if (out.length === 1) return null;
  return out;
}

/** Defensive read of a stored splits value. Anything malformed reads
 *  as "no splits" — a corrupt setting must never break a sale; the
 *  write path is where validation lives. */
export function normalizeSplits(raw: unknown): ProductSplit[] | null {
  if (raw === null || raw === undefined) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ProductSplit[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const row = (item ?? {}) as Record<string, unknown>;
    const userId = typeof row["userId"] === "string" ? row["userId"] : "";
    const sharePct = typeof row["sharePct"] === "number" ? row["sharePct"] : Number(row["sharePct"]);
    if (!UUID_RE.test(userId) || !Number.isFinite(sharePct) || sharePct <= 0 || sharePct > 100) return null;
    if (seen.has(userId)) return null;
    seen.add(userId);
    out.push({ userId, sharePct });
  }
  const total = out.reduce((sum, s) => sum + s.sharePct, 0);
  if (Math.abs(total - 100) > SPLIT_SUM_TOLERANCE) return null;
  return out;
}

/* ── Cent allocation — largest remainder, exact to the cent ─────────── */

/**
 * Divide `netCents` across the shares. Floors every share, then hands
 * the remaining cents one each to the largest fractional parts (ties
 * keep list order), so the amounts ALWAYS sum to exactly netCents —
 * the same reconciliation discipline as feeSplit (gross − fee = net).
 */
export function allocateSplitCents(
  netCents: number,
  splits: ProductSplit[],
): Array<{ userId: string; sharePct: number; amountCents: number }> {
  const net = Math.max(0, Math.round(netCents));
  const parts = splits.map((s, i) => {
    const raw = (net * s.sharePct) / 100;
    const floor = Math.floor(raw);
    return { userId: s.userId, sharePct: s.sharePct, amountCents: floor, frac: raw - floor, i };
  });
  let remainder = net - parts.reduce((sum, p) => sum + p.amountCents, 0);
  const byFrac = [...parts].sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const p of byFrac) {
    if (remainder <= 0) break;
    p.amountCents += 1;
    remainder -= 1;
  }
  return parts.map(({ userId, sharePct, amountCents }) => ({ userId, sharePct, amountCents }));
}

/* ── Co-seller resolution (product writes) ───────────────────────────── */

/**
 * Every non-owner seller must resolve to a creator profile — the
 * platform's creator-account index (publishing registry rule). An id
 * that names nobody is refused, never silently dropped: a split that
 * pays a ghost would strand real money.
 */
export async function assertCoSellersResolvable(
  ownerUserId: string,
  splits: ProductSplit[],
): Promise<void> {
  for (const s of splits) {
    if (s.userId === ownerUserId) continue;
    const r = await db.execute(sql`
      SELECT id FROM creator_profiles WHERE user_id = ${s.userId} LIMIT 1
    `);
    if (r.rows.length === 0) {
      throw new SaleSplitError(
        "seller_not_found",
        "One of the co-sellers isn't a creator on Bow Down Visuals yet — they need a creator profile before they can share a product.",
      );
    }
  }
}

/* ── Pre-migration detection ─────────────────────────────────────────── */

/** Postgres "undefined table/column" for the 0235 objects, scoped to
 *  our names (the publishing detector's pattern): real pg carries the
 *  code on the cause chain; pg-mem carries only the message. */
export function isMissingSaleSplitsStorage(err: unknown): boolean {
  const code = pgErrorCode(err);
  if (code === "42P01" || code === "42703") return true;
  const text = pgErrorText(err);
  return /(sale_split_entries|store_products|shop_products)/.test(text) &&
    /(does not exist|undefined table|undefined column|no such table|no such column)/i.test(text);
}

let entriesReadyCache: boolean | null = null;

/** Cached probe: has migration 0235 landed on this database? Earnings
 *  and payout adjustments consult it so pre-migration databases read
 *  exactly as before (adjustments of 0), never an error. */
export async function saleSplitEntriesReady(): Promise<boolean> {
  if (entriesReadyCache !== null) return entriesReadyCache;
  try {
    /* Row-length form, not COUNT: the pg-mem harness throws inside
       COUNT over information_schema.columns, and a thrown probe here
       would read as "not ready" forever in tests while meaning
       "landed" in production. */
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sale_split_entries' AND column_name = 'sale_kind'
      LIMIT 1
    `);
    entriesReadyCache = r.rows.length > 0;
  } catch {
    entriesReadyCache = false;
  }
  return entriesReadyCache;
}

/** Test seam: the probe cache is per-process; suites that swap the DB
 *  underneath the module reset it. */
export function __resetSaleSplitProbes(): void {
  entriesReadyCache = null;
}

/* ── Recording at fulfillment ────────────────────────────────────────── */

interface SplitLineFacts {
  productId: string;
  productTitle: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

async function profileIdsByUser(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const list = sql.join(userIds.map((u) => sql`${u}`), sql`, `);
  const r = await db.execute(sql`
    SELECT id, user_id FROM creator_profiles WHERE user_id IN (${list})
  `);
  for (const row of r.rows as Array<Record<string, unknown>>) {
    map.set(String(row["user_id"]), String(row["id"]));
  }
  return map;
}

async function readProductSplits(
  surface: SaleSplitSurface,
  productId: string,
): Promise<ProductSplit[] | null> {
  try {
    const r = surface === "store_product"
      ? await db.execute(sql`SELECT splits FROM store_products WHERE id = ${productId} LIMIT 1`)
      : await db.execute(sql`SELECT splits FROM shop_products WHERE id = ${productId} LIMIT 1`);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return normalizeSplits(row["splits"]);
  } catch (err) {
    if (isMissingSaleSplitsStorage(err)) return null;
    throw err;
  }
}

/**
 * Write the entries for one fulfilled product line. Exactly-once is
 * the unique (sale_kind, sale_id, product_id, seller_user_id) key +
 * ON CONFLICT DO NOTHING: verify replays, webhook races and flip
 * re-runs all converge on the same rows. A line with no splits, or a
 * net of 0 (free claim / giveaway), records nothing — there is no
 * money to divide.
 */
async function recordSplitLine(args: {
  saleKind: SaleSplitKind;
  saleId: string;
  surface: SaleSplitSurface;
  ownerUserId: string;
  sessionId: string | null;
  line: SplitLineFacts;
}): Promise<number> {
  const { line } = args;
  if (line.netCents <= 0) return 0;
  const splits = await readProductSplits(args.surface, line.productId);
  if (!splits) return 0;
  /* A stored list that no longer names the owner can't divide the
     sale honestly (the owner was removed after the setting was
     written — validation forbids it, so this is corruption defense):
     leave the parent row whole and log loudly. */
  if (!splits.some((s) => s.userId === args.ownerUserId)) {
    logger.error(
      { saleKind: args.saleKind, saleId: args.saleId, productId: line.productId },
      "[sale-splits] stored splits do not include the product owner — sale left unsplit",
    );
    return 0;
  }
  const profiles = await profileIdsByUser(splits.map((s) => s.userId));
  const amounts = allocateSplitCents(line.netCents, splits);
  /* Exactly-once, belt and suspenders (the affiliate rail's pattern):
     the pre-check answers replays deterministically; the UNIQUE key +
     ON CONFLICT below closes the race between two doors landing at
     the same instant. */
  const prior = await db.execute(sql`
    SELECT seller_user_id FROM sale_split_entries
    WHERE sale_kind = ${args.saleKind} AND sale_id = ${args.saleId} AND product_id = ${line.productId}
  `);
  const alreadyRecorded = new Set(
    (prior.rows as Array<Record<string, unknown>>).map((r) => String(r["seller_user_id"])),
  );
  let recorded = 0;
  for (const a of amounts) {
    if (alreadyRecorded.has(a.userId)) continue;
    const ins = await db.execute(sql`
      INSERT INTO sale_split_entries (
        sale_kind, sale_id, surface, product_id, product_title,
        owner_user_id, seller_user_id, seller_profile_id, role,
        share_pct, gross_cents, platform_fee_cents, amount_cents,
        status, stripe_session_id
      ) VALUES (
        ${args.saleKind}, ${args.saleId}, ${args.surface}, ${line.productId}, ${line.productTitle},
        ${args.ownerUserId}, ${a.userId}, ${profiles.get(a.userId) ?? null},
        ${a.userId === args.ownerUserId ? "owner" : "co_seller"},
        ${a.sharePct}, ${line.grossCents}, ${line.feeCents}, ${a.amountCents},
        'earned', ${args.sessionId}
      )
      ON CONFLICT (sale_kind, sale_id, product_id, seller_user_id) DO NOTHING
      RETURNING id
    `);
    recorded += ins.rows.length;
  }
  return recorded;
}

/**
 * Record the splits for a storefront order (store_orders row) from
 * the row's own recorded amounts — whatever the rail recorded is what
 * gets divided. The main line's net is the order's creator amount
 * minus the bump line's creator amount (the row's columns are session
 * totals); the bump line divides by the BUMP product's own splits.
 * Only 'completed' orders record (booking holds divide when verify
 * completes them — verify calls this after the flip).
 */
export async function recordStoreOrderSplits(orderId: string): Promise<{ recorded: number }> {
  const r = await db.execute(sql`
    SELECT o.id, o.status, o.product_id, o.product_title, o.amount_cents,
           o.platform_fee_cents, o.creator_amount_cents, o.bump_product_id,
           o.bump_amount_cents, o.bump_platform_fee_cents, o.bump_creator_amount_cents,
           o.stripe_session_id, cp.user_id AS owner_user_id
    FROM store_orders o
    JOIN creator_profiles cp ON cp.id = o.profile_id
    WHERE o.id = ${orderId}
    LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { recorded: 0 };
  if (String(row["status"]) !== "completed") return { recorded: 0 };
  const ownerUserId = String(row["owner_user_id"]);
  const sessionId = (row["stripe_session_id"] as string | null) ?? null;
  const bumpCreator = row["bump_creator_amount_cents"] == null ? 0 : Number(row["bump_creator_amount_cents"]);
  const bumpGross = row["bump_amount_cents"] == null ? 0 : Number(row["bump_amount_cents"]);
  const bumpFee = row["bump_platform_fee_cents"] == null ? 0 : Number(row["bump_platform_fee_cents"]);
  let recorded = 0;
  if (row["product_id"]) {
    recorded += await recordSplitLine({
      saleKind: "store_order",
      saleId: orderId,
      surface: "store_product",
      ownerUserId,
      sessionId,
      line: {
        productId: String(row["product_id"]),
        productTitle: String(row["product_title"] ?? ""),
        grossCents: Number(row["amount_cents"]) - bumpGross,
        feeCents: Number(row["platform_fee_cents"]) - bumpFee,
        netCents: Number(row["creator_amount_cents"]) - bumpCreator,
      },
    });
  }
  if (row["bump_product_id"] && bumpCreator > 0) {
    const bumpTitleRows = await db.execute(sql`
      SELECT title FROM store_products WHERE id = ${String(row["bump_product_id"])} LIMIT 1
    `);
    const bumpTitle = String(
      (bumpTitleRows.rows[0] as Record<string, unknown> | undefined)?.["title"] ?? "",
    );
    recorded += await recordSplitLine({
      saleKind: "store_order",
      saleId: orderId,
      surface: "store_product",
      ownerUserId,
      sessionId,
      line: {
        productId: String(row["bump_product_id"]),
        productTitle: bumpTitle,
        grossCents: bumpGross,
        feeCents: bumpFee,
        netCents: bumpCreator,
      },
    });
  }
  return { recorded };
}

/**
 * Record the splits for one marketplace shop line (shop_events row)
 * from the row's recorded amount − platform fee. Only rows already at
 * event_type='sale' record — the paid flip and the direct paid paths
 * call this once the line IS a sale.
 */
export async function recordShopEventSplits(shopEventId: string): Promise<{ recorded: number }> {
  const r = await db.execute(sql`
    SELECT e.id, e.event_type, e.user_id, e.product_id, e.amount_cents,
           e.platform_fee_cents, e.stripe_session_id, p.name AS product_name
    FROM shop_events e
    LEFT JOIN shop_products p ON p.id = e.product_id
    WHERE e.id = ${shopEventId}
    LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { recorded: 0 };
  if (String(row["event_type"]) !== "sale") return { recorded: 0 };
  if (!row["product_id"]) return { recorded: 0 };
  const gross = Number(row["amount_cents"]);
  const fee = Number(row["platform_fee_cents"]);
  const recorded = await recordSplitLine({
    saleKind: "shop_event",
    saleId: shopEventId,
    surface: "shop_product",
    ownerUserId: String(row["user_id"]),
    sessionId: (row["stripe_session_id"] as string | null) ?? null,
    line: {
      productId: String(row["product_id"]),
      productTitle: String(row["product_name"] ?? ""),
      grossCents: gross,
      feeCents: fee,
      netCents: gross - fee,
    },
  });
  return { recorded };
}

/* Safely wrappers — a split-ledger failure must never fail or roll
   back a paid sale (the affiliate rail's discipline); the parent sale
   row stands and the sale id is the reconciliation key. */
export async function recordStoreOrderSplitsSafely(orderId: string): Promise<void> {
  try {
    await recordStoreOrderSplits(orderId);
  } catch (err) {
    if (isMissingSaleSplitsStorage(err)) return; // pre-migration: no splits exist to record
    logger.error({ err, orderId }, "[sale-splits] store-order split record failed — sale stands, splits not recorded");
  }
}

export async function recordShopEventSplitsSafely(shopEventId: string): Promise<void> {
  try {
    await recordShopEventSplits(shopEventId);
  } catch (err) {
    if (isMissingSaleSplitsStorage(err)) return;
    logger.error({ err, shopEventId }, "[sale-splits] shop-event split record failed — sale stands, splits not recorded");
  }
}

/* ── Refund unwinding (payment-reversals) ────────────────────────────── */

/**
 * Flip every 'earned' entry on the sales a session recorded to
 * 'reversed'. Called by payment-reversals in the same pass that flips
 * the parent rows, keyed off the session id exactly like the parent
 * flips — both sellers' entries move in ONE statement, so the claw
 * back is symmetric by construction; the status guard makes any
 * replay a no-op (exactly once). Returns how many entries flipped.
 */
export async function reverseSplitEntriesForSession(
  saleKind: SaleSplitKind,
  sessionId: string,
): Promise<number> {
  const parent = saleKind === "store_order" ? "store_orders" : "shop_events";
  const r = await db.execute(sql`
    UPDATE sale_split_entries
    SET status = 'reversed', reversed_at = now()
    WHERE sale_kind = ${saleKind}
      AND status = 'earned'
      AND sale_id IN (SELECT id FROM ${sql.raw(parent)} WHERE stripe_session_id = ${sessionId})
    RETURNING id
  `);
  return r.rows.length;
}

/* ── Earnings / payout adjustments ───────────────────────────────────── */

/**
 * The split adjustments for one member's money picture, in cents:
 *  - subtractCents: the co-seller shares on sales *I* own (my parent
 *    rows carry the full net; my partners' parts are not mine);
 *  - addCents / addCount: my co-seller shares on other creators'
 *    sales (my split income, invisible to my own parent rows).
 * Owner-role entries are deliberately in NEITHER figure: the owner's
 * own share already lives in their parent sale rows.
 * Pre-migration (or any storage fault): zeros — the caller's picture
 * is exactly the pre-feature one, never an error.
 */
export async function saleSplitAdjustments(userId: string): Promise<{
  addCents: number;
  addCount: number;
  subtractCents: number;
}> {
  try {
    if (!(await saleSplitEntriesReady())) return { addCents: 0, addCount: 0, subtractCents: 0 };
    const sub = await db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0)::int AS cents
      FROM sale_split_entries
      WHERE owner_user_id = ${userId} AND role = 'co_seller' AND status = 'earned'
    `);
    const add = await db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0)::int AS cents, COUNT(*)::int AS n
      FROM sale_split_entries
      WHERE seller_user_id = ${userId} AND role = 'co_seller' AND status = 'earned'
    `);
    const s = sub.rows[0] as Record<string, unknown> | undefined;
    const a = add.rows[0] as Record<string, unknown> | undefined;
    return {
      addCents: Number(a?.["cents"] ?? 0),
      addCount: Number(a?.["n"] ?? 0),
      subtractCents: Number(s?.["cents"] ?? 0),
    };
  } catch (err) {
    if (isMissingSaleSplitsStorage(err)) return { addCents: 0, addCount: 0, subtractCents: 0 };
    throw err;
  }
}

/* ── Read views (routes/sale-splits.ts) ──────────────────────────────── */

export interface SplitEntryView {
  id: string;
  saleKind: SaleSplitKind;
  saleId: string;
  surface: SaleSplitSurface;
  productId: string;
  productTitle: string;
  ownerUserId: string;
  ownerName: string | null;
  sellerUserId: string;
  role: string;
  sharePct: number;
  grossCents: number;
  platformFeeCents: number;
  amountCents: number;
  status: string;
  createdAt: string | Date | null;
  reversedAt: string | Date | null;
}

function toView(r: Record<string, unknown>): SplitEntryView {
  return {
    id: String(r["id"]),
    saleKind: r["sale_kind"] as SaleSplitKind,
    saleId: String(r["sale_id"]),
    surface: r["surface"] as SaleSplitSurface,
    productId: String(r["product_id"]),
    productTitle: String(r["product_title"] ?? ""),
    ownerUserId: String(r["owner_user_id"]),
    ownerName: (r["owner_name"] as string | null) ?? null,
    sellerUserId: String(r["seller_user_id"]),
    role: String(r["role"]),
    sharePct: Number(r["share_pct"]),
    grossCents: Number(r["gross_cents"]),
    platformFeeCents: Number(r["platform_fee_cents"]),
    amountCents: Number(r["amount_cents"]),
    status: String(r["status"]),
    createdAt: (r["created_at"] as string | Date | null) ?? null,
    reversedAt: (r["reversed_at"] as string | Date | null) ?? null,
  };
}

const ENTRY_COLUMNS = sql`
  e.id, e.sale_kind, e.sale_id, e.surface, e.product_id, e.product_title,
  e.owner_user_id, ocp.display_name AS owner_name, e.seller_user_id, e.role,
  e.share_pct, e.gross_cents, e.platform_fee_cents, e.amount_cents,
  e.status, e.created_at, e.reversed_at
`;

/** Every split entry where I am a SELLER (owner share + co-seller
 *  shares), newest first — my split picture across both chairs. */
export async function listSplitEntriesForSeller(
  userId: string,
  limit = 100,
): Promise<SplitEntryView[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const r = await db.execute(sql`
    SELECT ${ENTRY_COLUMNS}
    FROM sale_split_entries e
    LEFT JOIN creator_profiles ocp ON ocp.user_id = e.owner_user_id
    WHERE e.seller_user_id = ${userId}
    ORDER BY e.created_at DESC
    LIMIT ${sql.raw(String(n))}
  `);
  return (r.rows as Array<Record<string, unknown>>).map(toView);
}

/** The co-seller entries on MY products — what my sales owe my
 *  partners, per sale. */
export async function listSplitEntriesForOwner(
  userId: string,
  limit = 100,
): Promise<SplitEntryView[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const r = await db.execute(sql`
    SELECT ${ENTRY_COLUMNS}
    FROM sale_split_entries e
    LEFT JOIN creator_profiles ocp ON ocp.user_id = e.owner_user_id
    WHERE e.owner_user_id = ${userId} AND e.role = 'co_seller'
    ORDER BY e.created_at DESC
    LIMIT ${sql.raw(String(n))}
  `);
  return (r.rows as Array<Record<string, unknown>>).map(toView);
}
