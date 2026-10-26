/**
 * loop-exchange.test.ts — Loop Exchange (Stack-200 #168, TRULY NEW).
 *
 * Pins:
 * - Poster terms: a share in (0, 100) with ≤2 decimals; nothing invented.
 * - Build splits ride the EXISTING sale-splits rail (validateProductSplits):
 *   sum-to-100, builder must hold a share, no duplicates — plus the Loop
 *   Exchange rule on top: the original poster must appear at >= the share
 *   they posted as their terms.
 * - Sale planning: the flat 5% platform fee comes off the top FIRST
 *   (platform-fees feeSplit), the net divides by largest remainder and
 *   ALWAYS sums exactly to the net; roles resolve poster/builder/collaborator.
 * - Recording is exactly-once, three layers deep: replaying the same
 *   sale_ref pays nobody twice, a racing insert completes against the
 *   winner's row, a retry after a mid-pass crash completes only what's
 *   missing, and a sale_ref can never be re-pointed at a different build.
 * - Only an 'agreed' build can record a sale (terms agreed UP FRONT).
 * - Money is TEST MODE Visual Bucs only: the deps surface has no cash /
 *   Stripe path at all, and zero-VB shares still get their ledger row.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";

/* The units under test are the pure validators/planner and the
   deps-injected recorder — the real DB, the credits rail, and the
   credit-usage writer are mocked so nothing here touches a database.
   (defaultRecordLoopSaleDeps is exercised by the routes' own shape:
   its find/insert/list functions only run against a live DB.) */
vi.mock("@workspace/db", () => ({
  db: {},
  loopExchangeLoopsTable: {},
  loopExchangeBuildsTable: {},
  loopExchangeSalesTable: {},
  loopExchangeSplitLedgerTable: {},
  creditUsageTable: { id: "id", idempotencyKey: "idempotency_key" },
}));
vi.mock("../supabase-admin", () => ({ addCreditsAtomic: vi.fn(async () => {}) }));
vi.mock("../payment-record", () => ({ recordCreditUsageStrict: vi.fn(async () => {}) }));
import {
  LoopExchangeError,
  validatePosterSharePct,
  validateBuildSplits,
  planLoopSale,
  recordLoopSale,
  loopCreditKey,
  loopRoleFor,
  isMissingLoopExchangeStorage,
  type RecordLoopSaleDeps,
  type LoopSaleRecord,
  type LoopLedgerRecord,
} from "../loop-exchange";

const POSTER = randomUUID();
const BUILDER = randomUUID();
const COLLAB = randomUUID();
const BUYER = randomUUID();

function throwsCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LoopExchangeError);
    expect((e as LoopExchangeError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected LoopExchangeError ${code}`);
}

async function throwsCodeAsync(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LoopExchangeError);
    expect((e as LoopExchangeError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected LoopExchangeError ${code}`);
}

describe("validatePosterSharePct — the poster's up-front terms", () => {
  it("accepts a share inside (0, 100) with up to two decimals", () => {
    expect(validatePosterSharePct(25)).toBe(25);
    expect(validatePosterSharePct(12.5)).toBe(12.5);
    expect(validatePosterSharePct(0.01)).toBe(0.01);
    expect(validatePosterSharePct(99.99)).toBe(99.99);
  });

  it("refuses non-numbers, the endpoints, and >2dp precision", () => {
    throwsCode(() => validatePosterSharePct("25"), "poster_share_invalid");
    throwsCode(() => validatePosterSharePct(Number.NaN), "poster_share_invalid");
    throwsCode(() => validatePosterSharePct(0), "poster_share_range");
    throwsCode(() => validatePosterSharePct(100), "poster_share_range");
    throwsCode(() => validatePosterSharePct(-5), "poster_share_range");
    throwsCode(() => validatePosterSharePct(10.001), "poster_share_precision");
  });
});

describe("validateBuildSplits — the existing splits rail + the poster rule", () => {
  const base = { builderUserId: BUILDER, posterUserId: POSTER, posterSharePct: 25 };

  it("accepts a sum-to-100 list that honours the poster's terms", () => {
    const out = validateBuildSplits({
      ...base,
      splits: [
        { userId: BUILDER, sharePct: 60 },
        { userId: POSTER, sharePct: 25 },
        { userId: COLLAB, sharePct: 15 },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out.find((s) => s.userId === POSTER)?.sharePct).toBe(25);
  });

  it("accepts the poster ABOVE their posted terms (terms are a floor, not a cap)", () => {
    const out = validateBuildSplits({
      ...base,
      splits: [
        { userId: BUILDER, sharePct: 60 },
        { userId: POSTER, sharePct: 40 },
      ],
    });
    expect(out.find((s) => s.userId === POSTER)?.sharePct).toBe(40);
  });

  it("refuses a list with no poster share at all", () => {
    throwsCode(
      () =>
        validateBuildSplits({
          ...base,
          splits: [
            { userId: BUILDER, sharePct: 85 },
            { userId: COLLAB, sharePct: 15 },
          ],
        }),
      "poster_missing",
    );
  });

  it("refuses a poster share below the posted terms", () => {
    throwsCode(
      () =>
        validateBuildSplits({
          ...base,
          splits: [
            { userId: BUILDER, sharePct: 80 },
            { userId: POSTER, sharePct: 20 },
          ],
        }),
      "poster_share_below_terms",
    );
  });

  it("the rail's own rules still bite: sum, builder presence, duplicates", () => {
    throwsCode(
      () =>
        validateBuildSplits({
          ...base,
          splits: [
            { userId: BUILDER, sharePct: 60 },
            { userId: POSTER, sharePct: 25 },
          ],
        }),
      "split_sum",
    );
    throwsCode(
      () =>
        validateBuildSplits({
          ...base,
          splits: [
            { userId: POSTER, sharePct: 50 },
            { userId: COLLAB, sharePct: 50 },
          ],
        }),
      "owner_missing",
    );
    throwsCode(
      () =>
        validateBuildSplits({
          ...base,
          splits: [
            { userId: BUILDER, sharePct: 50 },
            { userId: BUILDER, sharePct: 25 },
            { userId: POSTER, sharePct: 25 },
          ],
        }),
      "duplicate_seller",
    );
  });

  it("an empty / null list is not a Loop Exchange build (poster_missing, never null)", () => {
    throwsCode(() => validateBuildSplits({ ...base, splits: [] }), "poster_missing");
    throwsCode(() => validateBuildSplits({ ...base, splits: null }), "poster_missing");
  });
});

describe("planLoopSale — fee off the top, then the agreed split", () => {
  const splits = [
    { userId: BUILDER, sharePct: 60 },
    { userId: POSTER, sharePct: 25 },
    { userId: COLLAB, sharePct: 15 },
  ];

  it("takes the flat 5% fee first and divides the net exactly", () => {
    const plan = planLoopSale({ grossVb: 1000, splits, posterUserId: POSTER, builderUserId: BUILDER });
    expect(plan.feeVb).toBe(50);
    expect(plan.netVb).toBe(950);
    expect(plan.allocations.reduce((s, a) => s + a.amountVb, 0)).toBe(950);
    expect(plan.allocations.find((a) => a.userId === POSTER)).toMatchObject({ role: "loop_poster", amountVb: 238 });
    expect(plan.allocations.find((a) => a.userId === BUILDER)).toMatchObject({ role: "builder", amountVb: 570 });
    expect(plan.allocations.find((a) => a.userId === COLLAB)).toMatchObject({ role: "collaborator", amountVb: 142 });
  });

  it("largest remainder: odd nets still sum exactly, nobody loses a Buc to rounding", () => {
    for (const grossVb of [1, 3, 7, 101, 999, 12345]) {
      const plan = planLoopSale({ grossVb, splits, posterUserId: POSTER, builderUserId: BUILDER });
      expect(plan.feeVb + plan.netVb).toBe(grossVb);
      expect(plan.allocations.reduce((s, a) => s + a.amountVb, 0)).toBe(plan.netVb);
    }
  });

  it("refuses a non-whole or non-positive price, unreadable splits, and a poster-less split", () => {
    throwsCode(() => planLoopSale({ grossVb: 10.5, splits, posterUserId: POSTER, builderUserId: BUILDER }), "gross_invalid");
    throwsCode(() => planLoopSale({ grossVb: 0, splits, posterUserId: POSTER, builderUserId: BUILDER }), "gross_invalid");
    throwsCode(() => planLoopSale({ grossVb: "1000", splits, posterUserId: POSTER, builderUserId: BUILDER }), "gross_invalid");
    throwsCode(() => planLoopSale({ grossVb: 1000, splits: [{ userId: BUILDER, sharePct: 90 }], posterUserId: POSTER, builderUserId: BUILDER }), "splits_invalid");
    throwsCode(
      () =>
        planLoopSale({
          grossVb: 1000,
          splits: [
            { userId: BUILDER, sharePct: 85 },
            { userId: COLLAB, sharePct: 15 },
          ],
          posterUserId: POSTER,
          builderUserId: BUILDER,
        }),
      "poster_missing",
    );
  });

  it("roles resolve poster first, then builder, then collaborator", () => {
    expect(loopRoleFor(POSTER, POSTER, BUILDER)).toBe("loop_poster");
    expect(loopRoleFor(BUILDER, POSTER, BUILDER)).toBe("builder");
    expect(loopRoleFor(COLLAB, POSTER, BUILDER)).toBe("collaborator");
  });
});

/* ── Recording, against an in-memory deps fake ──────────────────────── */

interface FakeStore {
  sales: LoopSaleRecord[];
  ledger: LoopLedgerRecord[];
  ledgerRows: Array<{ creditKey: string; role: string; sharePct: number }>;
  credits: Map<string, number>; // creditKey -> amountVb credited
  creditCalls: Array<{ userId: string; amountVb: number; creditKey: string }>;
}

function fakeDeps(store: FakeStore, hooks: Partial<RecordLoopSaleDeps> = {}): RecordLoopSaleDeps {
  let seq = 0;
  return {
    findSaleByRef: async (saleRef) => store.sales.find((s) => s.saleRef === saleRef) ?? null,
    insertSale: async (rec) => {
      seq += 1;
      const sale: LoopSaleRecord = { id: `sale-${seq}`, buildId: rec.buildId, loopId: rec.loopId, saleRef: rec.saleRef, grossVb: rec.grossVb, feeVb: rec.feeVb, netVb: rec.netVb };
      store.sales.push(sale);
      return sale;
    },
    listLedger: async (saleId) => store.ledger.filter((r) => r.saleId === saleId),
    insertLedgerRow: async (row) => {
      if (store.ledger.some((r) => r.saleId === row.saleId && r.recipientUserId === row.recipientUserId)) {
        throw new Error("duplicate key value violates unique constraint");
      }
      store.ledger.push({ saleId: row.saleId, recipientUserId: row.recipientUserId, amountVb: row.amountVb });
      store.ledgerRows.push({ creditKey: row.creditKey, role: row.role, sharePct: row.sharePct });
    },
    creditExists: async (creditKey) => store.credits.has(creditKey),
    creditRecipient: async (userId, amountVb, creditKey) => {
      store.creditCalls.push({ userId, amountVb, creditKey });
      store.credits.set(creditKey, amountVb);
    },
    ...hooks,
  };
}

function newStore(): FakeStore {
  return { sales: [], ledger: [], ledgerRows: [], credits: new Map(), creditCalls: [] };
}

const AGREED_BUILD = {
  id: randomUUID(),
  loopId: randomUUID(),
  builderUserId: BUILDER,
  status: "agreed",
  splits: [
    { userId: BUILDER, sharePct: 60 },
    { userId: POSTER, sharePct: 25 },
    { userId: COLLAB, sharePct: 15 },
  ],
};

const saleInput = (over: Partial<Parameters<typeof recordLoopSale>[1]> = {}) => ({
  build: AGREED_BUILD,
  posterUserId: POSTER,
  saleRef: "order-123",
  grossVb: 1000,
  buyerUserId: BUYER,
  recordedByUserId: BUILDER,
  ...over,
});

describe("recordLoopSale — exactly-once split payments", () => {
  it("records the sale, one ledger row per recipient, one credit per share", async () => {
    const store = newStore();
    const { outcome, sale, plan } = await recordLoopSale(fakeDeps(store), saleInput());
    expect(outcome).toBe("recorded");
    expect(sale).toMatchObject({ saleRef: "order-123", grossVb: 1000, feeVb: 50, netVb: 950 });
    expect(store.ledger).toHaveLength(3);
    expect(store.creditCalls).toHaveLength(3);
    expect(store.creditCalls.reduce((s, c) => s + c.amountVb, 0)).toBe(plan.netVb);
    // Every credit rides its exactly-once key, and the poster is paid on the sale:
    for (const c of store.creditCalls) expect(c.creditKey).toBe(loopCreditKey(sale.id, c.userId));
    expect(store.credits.get(loopCreditKey(sale.id, POSTER))).toBe(238);
    expect(store.ledgerRows.find((r) => r.creditKey === loopCreditKey(sale.id, POSTER))?.role).toBe("loop_poster");
  });

  it("a replay of the same sale_ref pays nobody twice", async () => {
    const store = newStore();
    const deps = fakeDeps(store);
    await recordLoopSale(deps, saleInput());
    const callsAfterFirst = store.creditCalls.length;
    const second = await recordLoopSale(deps, saleInput());
    expect(second.outcome).toBe("already-recorded");
    expect(store.sales).toHaveLength(1);
    expect(store.ledger).toHaveLength(3);
    expect(store.creditCalls).toHaveLength(callsAfterFirst);
  });

  it("a sale_ref already used by a DIFFERENT build is a conflict, never a re-point", async () => {
    const store = newStore();
    const deps = fakeDeps(store);
    await recordLoopSale(deps, saleInput());
    const otherBuild = { ...AGREED_BUILD, id: randomUUID() };
    await throwsCodeAsync(() => recordLoopSale(deps, saleInput({ build: otherBuild })), "sale_ref_conflict");
    expect(store.creditCalls).toHaveLength(3);
  });

  it("only an agreed build can sell — pending and declined terms refuse", async () => {
    const store = newStore();
    const deps = fakeDeps(store);
    await throwsCodeAsync(
      () => recordLoopSale(deps, saleInput({ build: { ...AGREED_BUILD, status: "pending_terms" } })),
      "terms_not_agreed",
    );
    await throwsCodeAsync(
      () => recordLoopSale(deps, saleInput({ build: { ...AGREED_BUILD, status: "declined" } })),
      "terms_not_agreed",
    );
    expect(store.sales).toHaveLength(0);
    expect(store.creditCalls).toHaveLength(0);
  });

  it("a missing sale_ref is refused before any planning or payment", async () => {
    const store = newStore();
    await throwsCodeAsync(() => recordLoopSale(fakeDeps(store), saleInput({ saleRef: "  " })), "sale_ref_required");
    expect(store.sales).toHaveLength(0);
  });

  it("a retry after a mid-pass crash completes only the missing shares", async () => {
    const store = newStore();
    // First pass: the sale + the builder's ledger row + credit land, then it dies.
    const crashing = fakeDeps(store, {
      insertLedgerRow: async (row) => {
        if (row.recipientUserId !== BUILDER) throw new Error("connection lost");
        store.ledger.push({ saleId: row.saleId, recipientUserId: row.recipientUserId, amountVb: row.amountVb });
        store.ledgerRows.push({ creditKey: row.creditKey, role: row.role, sharePct: row.sharePct });
      },
    });
    await expect(recordLoopSale(crashing, saleInput())).rejects.toThrow("connection lost");
    expect(store.sales).toHaveLength(1);
    expect(store.ledger).toHaveLength(1);

    // Retry with healthy deps: same sale row, remaining rows/credits only.
    const retry = await recordLoopSale(fakeDeps(store), saleInput());
    expect(retry.outcome).toBe("already-recorded");
    expect(store.sales).toHaveLength(1);
    expect(store.ledger).toHaveLength(3);
    const creditedUsers = store.creditCalls.map((c) => c.userId);
    expect(new Set(creditedUsers).size).toBe(3); // nobody credited twice
    expect(store.creditCalls.reduce((s, c) => s + c.amountVb, 0)).toBe(950);
  });

  it("a racing insert (unique sale_ref) completes against the winner's row", async () => {
    const store = newStore();
    const winner: LoopSaleRecord = { id: "sale-winner", buildId: AGREED_BUILD.id, loopId: AGREED_BUILD.loopId, saleRef: "order-123", grossVb: 1000, feeVb: 50, netVb: 950 };
    let findCalls = 0;
    const deps = fakeDeps(store, {
      findSaleByRef: async () => {
        findCalls += 1;
        return findCalls === 1 ? null : winner; // the twin lands between check and insert
      },
      insertSale: async () => {
        const err = new Error("duplicate key value violates unique constraint \"loop_exchange_sales_ref_ux\"") as Error & { code?: string };
        err.code = "23505";
        throw err;
      },
    });
    const { outcome, sale } = await recordLoopSale(deps, saleInput());
    expect(outcome).toBe("recorded");
    expect(sale.id).toBe("sale-winner");
    expect(store.ledger).toHaveLength(3);
    expect(store.creditCalls).toHaveLength(3);
  });

  it("zero-VB shares still get their ledger row — the credit step is skipped, not the record", async () => {
    const store = newStore();
    // gross 2 VB: fee 0 (5% rounds to 0), net 2 — the 15% share floors to 0
    // after largest-remainder hands the 2 Bucs to the larger fractions.
    const { plan } = await recordLoopSale(fakeDeps(store), saleInput({ grossVb: 2, saleRef: "order-tiny" }));
    expect(plan.allocations.reduce((s, a) => s + a.amountVb, 0)).toBe(plan.netVb);
    expect(store.ledger).toHaveLength(3);
    const zeroShare = plan.allocations.filter((a) => a.amountVb === 0);
    for (const z of zeroShare) {
      expect(store.ledger.some((r) => r.recipientUserId === z.userId)).toBe(true);
      expect(store.creditCalls.some((c) => c.userId === z.userId)).toBe(false);
    }
  });

  it("every downstream sale pays the poster again — not just the first", async () => {
    const store = newStore();
    const deps = fakeDeps(store);
    await recordLoopSale(deps, saleInput({ saleRef: "order-1" }));
    await recordLoopSale(deps, saleInput({ saleRef: "order-2" }));
    const posterCredits = store.creditCalls.filter((c) => c.userId === POSTER);
    expect(posterCredits).toHaveLength(2);
    expect(posterCredits.every((c) => c.amountVb === 238)).toBe(true);
  });
});

describe("storage detection + credit keys", () => {
  it("credit keys are namespaced per sale and recipient", () => {
    expect(loopCreditKey("s1", "u1")).toBe("loop-exchange:s1:u1");
    expect(loopCreditKey("s1", "u1")).not.toBe(loopCreditKey("s1", "u2"));
    expect(loopCreditKey("s1", "u1")).not.toBe(loopCreditKey("s2", "u1"));
  });

  it("missing-storage detection keys off pg codes and loop_exchange table text", () => {
    const undefinedTable = new Error("relation \"loop_exchange_loops\" does not exist") as Error & { code?: string };
    undefinedTable.code = "42P01";
    expect(isMissingLoopExchangeStorage(undefinedTable)).toBe(true);
    expect(isMissingLoopExchangeStorage(new Error("column loop_exchange_loops.poster_share_pct does not exist"))).toBe(true);
    expect(isMissingLoopExchangeStorage(new Error("some other failure"))).toBe(false);
    expect(isMissingLoopExchangeStorage(null)).toBe(false);
  });
});
