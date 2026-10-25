/**
 * Co-seller revenue splits (Wave 4 #36) — the shared machine.
 *
 * Pure layer: sum-to-100 validation (the publishing-splits contract),
 * largest-remainder cent allocation (the split of a net always sums
 * EXACTLY to the net), stored-shape normalization.
 *
 * pg-mem layer: recording on both money rails (store_orders +
 * shop_events), the fee-off-the-top order (splits divide the seller
 * NET — the flat 5% platform fee is already out), exactly-once
 * recording under replays, snapshot semantics (editing the product's
 * splits never rewrites a recorded sale), the earnings adjustments,
 * and the refund flip: reversed from BOTH sides, exactly once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import {
  validateProductSplits,
  normalizeSplits,
  allocateSplitCents,
  recordStoreOrderSplits,
  recordShopEventSplits,
  reverseSplitEntriesForSession,
  saleSplitAdjustments,
  SaleSplitError,
  __resetSaleSplitProbes,
} from "../sale-splits";
import { createTestDb } from "./test-db";

const OWNER = randomUUID();
const CO = randomUUID();
const PROFILE_ID = randomUUID();
const SHOP_ID = randomUUID();

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL
);
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL DEFAULT '', splits jsonb
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, product_id uuid, product_title text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  bump_product_id uuid, bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed'
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL DEFAULT '', splits jsonb
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL, product_id uuid,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text
);
CREATE TABLE sale_split_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_kind text NOT NULL, sale_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid NOT NULL, product_title text NOT NULL DEFAULT '',
  owner_user_id uuid NOT NULL, seller_user_id uuid NOT NULL, seller_profile_id uuid,
  role text NOT NULL CHECK (role IN ('owner', 'co_seller')),
  share_pct numeric NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  gross_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'reversed')),
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(), reversed_at timestamptz
);
CREATE UNIQUE INDEX sale_split_entries_once_ux
  ON sale_split_entries (sale_kind, sale_id, product_id, seller_user_id);
`;

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  __resetSaleSplitProbes();
});

async function entries(): Promise<any[]> {
  const r = await h.db.execute(sql`SELECT * FROM sale_split_entries ORDER BY role DESC, amount_cents DESC`);
  return r.rows as any[];
}

describe("validateProductSplits — the sum-to-100 contract", () => {
  it("accepts a full allocation including the owner", () => {
    const out = validateProductSplits(OWNER, [
      { userId: OWNER, sharePct: 60 },
      { userId: CO, sharePct: 40 },
    ]);
    expect(out).toEqual([
      { userId: OWNER, sharePct: 60 },
      { userId: CO, sharePct: 40 },
    ]);
  });

  it("single seller at 100 is the no-op shape → null", () => {
    expect(validateProductSplits(OWNER, [{ userId: OWNER, sharePct: 100 }])).toBeNull();
    expect(validateProductSplits(OWNER, null)).toBeNull();
    expect(validateProductSplits(OWNER, [])).toBeNull();
  });

  function throwsCode(fn: () => unknown, code: string) {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(SaleSplitError);
      expect((e as SaleSplitError).code).toBe(code);
      return;
    }
    expect.unreachable(`expected SaleSplitError ${code}`);
  }

  it("refuses a sum that is not 100", () => {
    throwsCode(
      () =>
        validateProductSplits(OWNER, [
          { userId: OWNER, sharePct: 60 },
          { userId: CO, sharePct: 30 },
        ]),
      "split_sum",
    );
  });

  it("refuses when the owner holds no share", () => {
    throwsCode(() => validateProductSplits(OWNER, [{ userId: CO, sharePct: 100 }]), "owner_missing");
  });

  it("refuses duplicates, zero/over-100 shares, and >2dp precision", () => {
    throwsCode(
      () =>
        validateProductSplits(OWNER, [
          { userId: OWNER, sharePct: 50 },
          { userId: OWNER, sharePct: 50 },
        ]),
      "duplicate_seller",
    );
    throwsCode(
      () =>
        validateProductSplits(OWNER, [
          { userId: OWNER, sharePct: 100 },
          { userId: CO, sharePct: 0 },
        ]),
      "split_range",
    );
    throwsCode(
      () =>
        validateProductSplits(OWNER, [
          { userId: OWNER, sharePct: 66.667 },
          { userId: CO, sharePct: 33.333 },
        ]),
      "split_precision",
    );
  });

  it("thirds at 33.33/33.33/33.34 pass within tolerance", () => {
    const a = randomUUID(); const b = randomUUID(); const c = randomUUID();
    const out = validateProductSplits(a, [
      { userId: a, sharePct: 33.33 },
      { userId: b, sharePct: 33.33 },
      { userId: c, sharePct: 33.34 },
    ]);
    expect(out).toHaveLength(3);
  });

  it("SaleSplitError is an Error with a stable code", () => {
    try {
      validateProductSplits(OWNER, [{ userId: CO, sharePct: 100 }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SaleSplitError);
      expect((e as SaleSplitError).code).toBe("owner_missing");
    }
  });
});

describe("allocateSplitCents — exact to the cent", () => {
  it("50/50 on an odd net sums exactly", () => {
    const out = allocateSplitCents(999, [
      { userId: OWNER, sharePct: 50 },
      { userId: CO, sharePct: 50 },
    ]);
    expect(out.reduce((s, x) => s + x.amountCents, 0)).toBe(999);
    expect(out.map((x) => x.amountCents).sort()).toEqual([499, 500]);
  });

  it("thirds on 100 land 33/33/34 and sum to 100", () => {
    const out = allocateSplitCents(100, [
      { userId: OWNER, sharePct: 33.33 },
      { userId: CO, sharePct: 33.33 },
      { userId: randomUUID(), sharePct: 33.34 },
    ]);
    expect(out.reduce((s, x) => s + x.amountCents, 0)).toBe(100);
    expect(out[2].amountCents).toBe(34);
  });

  it("zero net allocates zeros", () => {
    const out = allocateSplitCents(0, [{ userId: OWNER, sharePct: 100 }]);
    expect(out[0].amountCents).toBe(0);
  });
});

describe("normalizeSplits — stored shapes", () => {
  it("passes a valid stored list through, drops garbage to null", () => {
    expect(normalizeSplits([{ userId: OWNER, sharePct: 100 }])).toEqual([{ userId: OWNER, sharePct: 100 }]);
    expect(normalizeSplits("junk")).toBeNull();
    expect(normalizeSplits([{ userId: "not-a-uuid", sharePct: 100 }])).toBeNull();
    expect(normalizeSplits([{ userId: OWNER, sharePct: 150 }])).toBeNull();
    expect(normalizeSplits(null)).toBeNull();
  });
});

describe("recording on the store rail", () => {
  const PRODUCT = randomUUID();
  async function seedOrder(net = 9500, gross = 10000, fee = 500, status = "completed") {
    const orderId = randomUUID();
    await h.db.execute(sql`
      INSERT INTO store_products (id, title, splits)
      VALUES (${PRODUCT}, 'Collab Track', ${JSON.stringify([
        { userId: OWNER, sharePct: 60 },
        { userId: CO, sharePct: 40 },
      ])}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `);
    await h.db.execute(sql`
      INSERT INTO store_orders (id, profile_id, product_id, product_title, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status)
      VALUES (${orderId}, ${PROFILE_ID}, ${PRODUCT}, 'Collab Track', ${gross}, ${fee}, ${net}, 'cs_split_1', ${status})
    `);
    return orderId;
  }

  beforeEach(async () => {
    await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${OWNER}, 'owner', 'Owner')`);
  });

  it("records BOTH sellers off the NET (fee already out), exactly once", async () => {
    const orderId = await seedOrder();
    expect((await recordStoreOrderSplits(orderId)).recorded).toBe(2);
    const rows = await entries();
    expect(rows).toHaveLength(2);
    const owner = rows.find((r) => r.role === "owner");
    const co = rows.find((r) => r.role === "co_seller");
    /* Net 9500 at 60/40 → 5700 / 3800. The 500 fee never enters. */
    expect(Number(owner.amount_cents)).toBe(5700);
    expect(Number(co.amount_cents)).toBe(3800);
    /* The snapshot carries the line's gross + fee, so the divided net
       is always gross − fee = 9500 on every entry. */
    expect(Number(owner.gross_cents)).toBe(10000);
    expect(Number(owner.platform_fee_cents)).toBe(500);
    expect(owner.status).toBe("earned");

    /* Replay: the unique key holds the line. */
    expect((await recordStoreOrderSplits(orderId)).recorded).toBe(0);
    expect(await entries()).toHaveLength(2);
  });

  it("a product without splits records nothing", async () => {
    const plain = randomUUID();
    const orderId = randomUUID();
    await h.db.execute(sql`INSERT INTO store_products (id, title) VALUES (${plain}, 'Solo')`);
    await h.db.execute(sql`
      INSERT INTO store_orders (id, profile_id, product_id, amount_cents, creator_amount_cents, stripe_session_id)
      VALUES (${orderId}, ${PROFILE_ID}, ${plain}, 5000, 4750, 'cs_solo')`);
    expect((await recordStoreOrderSplits(orderId)).recorded).toBe(0);
    expect(await entries()).toHaveLength(0);
  });

  it("a non-completed order records nothing", async () => {
    const orderId = await seedOrder(9500, 10000, 500, "refunded");
    expect((await recordStoreOrderSplits(orderId)).recorded).toBe(0);
  });

  it("snapshot: editing the product's splits after the sale changes nothing recorded", async () => {
    const orderId = await seedOrder();
    await recordStoreOrderSplits(orderId);
    await h.db.execute(sql`UPDATE store_products SET splits = ${JSON.stringify([
      { userId: OWNER, sharePct: 90 },
      { userId: CO, sharePct: 10 },
    ])}::jsonb WHERE id = ${PRODUCT}`);
    const rows = await entries();
    expect(Number(rows.find((r) => r.role === "co_seller").amount_cents)).toBe(3800);
    expect(Number(rows.find((r) => r.role === "co_seller").share_pct)).toBe(40);
  });

  it("adjustments: the owner is charged the co-seller share, the co-seller gains it", async () => {
    const orderId = await seedOrder();
    await recordStoreOrderSplits(orderId);
    const ownerAdj = await saleSplitAdjustments(OWNER);
    expect(ownerAdj.subtractCents).toBe(3800);
    expect(ownerAdj.addCents).toBe(0);
    const coAdj = await saleSplitAdjustments(CO);
    expect(coAdj.addCents).toBe(3800);
    expect(coAdj.addCount).toBe(1);
    expect(coAdj.subtractCents).toBe(0);
  });

  it("refund flip: BOTH sides reverse, exactly once, and adjustments zero out", async () => {
    const orderId = await seedOrder();
    await recordStoreOrderSplits(orderId);
    expect(await reverseSplitEntriesForSession("store_order", "cs_split_1")).toBe(2);
    const rows = await entries();
    expect(rows.every((r) => r.status === "reversed")).toBe(true);
    expect(rows.every((r) => r.reversed_at != null)).toBe(true);
    /* Replay: nothing left to flip. */
    expect(await reverseSplitEntriesForSession("store_order", "cs_split_1")).toBe(0);
    expect((await saleSplitAdjustments(OWNER)).subtractCents).toBe(0);
    expect((await saleSplitAdjustments(CO)).addCents).toBe(0);
    /* A session with no splits is a no-op. */
    expect(await reverseSplitEntriesForSession("store_order", "cs_nope")).toBe(0);
  });
});

describe("recording on the shop rail", () => {
  it("a paid sale event records both sellers off amount − fee; other event types skip", async () => {
    const product = randomUUID();
    const eventId = randomUUID();
    await h.db.execute(sql`
      INSERT INTO shop_products (id, user_id, splits)
      VALUES (${product}, ${OWNER}, ${JSON.stringify([
        { userId: OWNER, sharePct: 75 },
        { userId: CO, sharePct: 25 },
      ])}::jsonb)`);
    await h.db.execute(sql`
      INSERT INTO shop_events (id, user_id, event_type, product_id, amount_cents, platform_fee_cents, stripe_session_id)
      VALUES (${eventId}, ${OWNER}, 'sale', ${product}, 20000, 1000, 'cs_shop_1')`);
    expect((await recordShopEventSplits(eventId)).recorded).toBe(2);
    const rows = await entries();
    /* Net 19000 at 75/25 → 14250 / 4750. */
    expect(Number(rows.find((r) => r.role === "owner").amount_cents)).toBe(14250);
    expect(Number(rows.find((r) => r.role === "co_seller").amount_cents)).toBe(4750);
    expect(rows[0].sale_kind).toBe("shop_event");

    const viewEvent = randomUUID();
    await h.db.execute(sql`
      INSERT INTO shop_events (id, user_id, event_type, product_id, amount_cents)
      VALUES (${viewEvent}, ${OWNER}, 'view', ${product}, 0)`);
    expect((await recordShopEventSplits(viewEvent)).recorded).toBe(0);
  });
});
