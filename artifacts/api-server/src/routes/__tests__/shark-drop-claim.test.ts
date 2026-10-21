/**
 * Route tests for POST /api/retention/shark-drop/claim (retention-delight).
 *
 * The claim used to grant credits BEFORE marking the drop claimed, with an
 * unconditional final UPDATE — two concurrent claims both read the drop
 * as unclaimed and both got paid (double-pay of 100–500 VB). The hardened
 * handler claims FIRST via a conditional UPDATE (claimed_at IS NULL is
 * the lock) and releases the claim if any payout step fails, so a failed
 * payout never burns the drop.
 *
 * Fake-db style (mirrors lib/__tests__/credits-team-pool.test.ts): the
 * fake implements only the chains this handler uses, but its claim
 * UPDATE applies the claimed_at-IS-NULL predicate as one synchronous
 * check-and-set — the same atomicity Postgres gives the real statement —
 * and the tests assert the rendered WHERE actually carries the IS NULL
 * guard, the drop id, and the owner id. Supabase grants and the strict
 * ledger are mocked: no network, no real credits move.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

interface DropRow {
  id: string;
  userId: string;
  amount: number;
  droppedAt: Date;
  claimedAt: Date | null;
  expiresAt: Date;
}

const h = vi.hoisted(() => {
  const state = {
    userId: "" as string | null,
    drops: new Map<string, DropRow>(),
    grantCalls: [] as Array<{ userId: string; amount: number }>,
    grantFailures: 0,
    ledgerCalls: [] as any[],
    ledgerFailures: 0,
    restoreCalls: 0,
    /** Rendered WHERE of every claim/release UPDATE, for CAS assertions. */
    updateConditions: [] as Array<{ sql: string; params: unknown[] }>,
  };
  return { state };
});

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/* The fake @workspace/db: table objects stay the REAL module's (identity
   comparisons work); only the `db` handle is replaced. */
const fakeDbHolder = vi.hoisted(() => ({ db: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!h.state.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = h.state.userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const fakeDb = {
    // Only the prefs read (getDelightPrefs) runs a select on the claim
    // path: no prefs row → defaults (all systems enabled).
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => [] as unknown[],
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          let promise: Promise<DropRow[]> | null = null;
          const apply = (): Promise<DropRow[]> => {
            if (promise) return promise;
            promise = (async () => {
              const rendered = render(cond);
              state.updateConditions.push(rendered);
              // The handler passes (dropId, userId) as the first params.
              const [dropId, userId] = rendered.params as [string, string];
              const row = state.drops.get(dropId);
              if ("claimedAt" in vals && vals["claimedAt"] instanceof Date) {
                // THE CLAIM: atomic check-and-set on claimed_at IS NULL.
                if (row && row.userId === userId && row.claimedAt === null) {
                  row.claimedAt = vals["claimedAt"] as Date;
                  return [row];
                }
                return [];
              }
              // THE RELEASE: clear the stamp this flow set.
              if (row && row.claimedAt !== null) row.claimedAt = null;
              return [];
            })();
            return promise;
          };
          return {
            returning: (_fields?: unknown) => apply(),
            then: (res: any, rej: any) => apply().then(res, rej),
          };
        },
      }),
    }),
  };
  fakeDbHolder.db = fakeDb;
  return {
    ...actual,
    get db() {
      return fakeDbHolder.db;
    },
  };
});

vi.mock("../../lib/supabase-admin", () => ({
  addCreditsToProfile: vi.fn(async (userId: string, amount: number) => {
    if (h.state.grantFailures > 0) {
      h.state.grantFailures--;
      throw new Error("grant failed (test)");
    }
    h.state.grantCalls.push({ userId, amount });
    return { oldCredits: 5000, newCredits: 5000 + amount, created: false };
  }),
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      update: (_vals: unknown) => ({
        eq: async () => {
          h.state.restoreCalls++;
          return { error: null };
        },
      }),
      select: (_cols: string) => ({
        in: async () => ({ data: [] }),
      }),
    }),
  }),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async (rec: any) => {
    if (h.state.ledgerFailures > 0) {
      h.state.ledgerFailures--;
      throw new Error("ledger failed (test)");
    }
    h.state.ledgerCalls.push(rec);
  }),
}));

import router from "../retention-delight";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.userId = randomUUID();
  h.state.drops = new Map();
  h.state.grantCalls = [];
  h.state.grantFailures = 0;
  h.state.ledgerCalls = [];
  h.state.ledgerFailures = 0;
  h.state.restoreCalls = 0;
  h.state.updateConditions = [];
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function seedDrop(opts: { userId?: string; amount?: number; expiresInMs?: number } = {}): DropRow {
  const row: DropRow = {
    id: randomUUID(),
    userId: opts.userId ?? h.state.userId!,
    amount: opts.amount ?? 250,
    droppedAt: new Date(),
    claimedAt: null,
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 60_000)),
  };
  h.state.drops.set(row.id, row);
  return row;
}

describe("POST /api/retention/shark-drop/claim", () => {
  it("happy path: claims once, grants once, writes the ledger once", async () => {
    const drop = seedDrop({ amount: 250 });
    const res = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ claimed: true, amount: 250 });
    expect(h.state.grantCalls).toEqual([{ userId: h.state.userId, amount: 250 }]);
    expect(h.state.ledgerCalls).toHaveLength(1);
    expect(drop.claimedAt).not.toBeNull();
  });

  it("the claim UPDATE is a CAS: WHERE carries claimed_at IS NULL + id + owner", async () => {
    const drop = seedDrop();
    await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    const claim = h.state.updateConditions[0]!;
    expect(claim.sql).toContain('"claimed_at" is null');
    expect(claim.params).toContain(drop.id);
    expect(claim.params).toContain(h.state.userId);
  });

  it("a second claim of the same drop 404s and never grants again", async () => {
    const drop = seedDrop();
    const first = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(first.status).toBe(200);
    const second = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(second.status).toBe(404);
    expect(h.state.grantCalls).toHaveLength(1);
  });

  it("two concurrent claims pay exactly once", async () => {
    const drop = seedDrop();
    const [a, b] = await Promise.all([
      req("POST", "/retention/shark-drop/claim", { dropId: drop.id }),
      req("POST", "/retention/shark-drop/claim", { dropId: drop.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect(h.state.grantCalls).toHaveLength(1);
    expect(h.state.ledgerCalls).toHaveLength(1);
  });

  it("ledger failure: grant rolled back, claim released, retry succeeds", async () => {
    const drop = seedDrop();
    h.state.ledgerFailures = 1;
    const failed = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(failed.status).toBe(500);
    expect(h.state.restoreCalls).toBe(1); // balance restored
    expect(drop.claimedAt).toBeNull(); // claim released

    const retry = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(retry.status).toBe(200);
    expect(h.state.grantCalls).toHaveLength(2); // failed attempt + retry
    expect(drop.claimedAt).not.toBeNull();
  });

  it("grant failure: claim released, retry succeeds", async () => {
    const drop = seedDrop();
    h.state.grantFailures = 1;
    const failed = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(failed.status).toBe(500);
    expect(drop.claimedAt).toBeNull();

    const retry = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(retry.status).toBe(200);
    expect(h.state.grantCalls).toHaveLength(1); // only the retry granted
  });

  it("expired drop: 410, no grant, claim released", async () => {
    const drop = seedDrop({ expiresInMs: -1000 });
    const res = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(res.status).toBe(410);
    expect(h.state.grantCalls).toHaveLength(0);
    expect(drop.claimedAt).toBeNull();
  });

  it("another user's drop 404s", async () => {
    const drop = seedDrop({ userId: randomUUID() });
    const res = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(res.status).toBe(404);
    expect(h.state.grantCalls).toHaveLength(0);
  });
});
