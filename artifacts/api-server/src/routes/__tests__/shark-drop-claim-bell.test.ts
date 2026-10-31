/**
 * Shark-drop claim landed → member bell + device-push wiring
 * (M3 R2, stack1000 lane N1 — the King-gift precedent, lane A4).
 *
 * The authoritative moment is the claim landing in
 * POST /api/retention/shark-drop/claim: the conditional-UPDATE
 * claim flip (claimed_at IS NULL is the lock), the grant, and the
 * strict ledger, in that order. The tell fires only from the path
 * that lands all three — a replay 404s at the flip and never
 * reaches it, an expired drop releases and 410s before it, and a
 * grant/ledger failure rolls back and 500s before it, so the
 * retry that finally lands tells exactly once. Category money
 * (every landed-credit precedent), deep link /credit-history —
 * the balance surface where this claim's ledger row shows.
 *
 * Harness mirrors shark-drop-claim.test.ts (the rail suite): the
 * fake db applies the claimed_at-IS-NULL predicate as one
 * synchronous check-and-set; grants and the strict ledger are
 * mocked. This suite adds the notifier capture via the route's
 * exported test seam.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import type { UserEventInput } from "../../lib/push-events";

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
  };
  return { state };
});

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

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
              const [dropId, userId] = rendered.params as [string, string];
              const row = state.drops.get(dropId);
              if ("claimedAt" in vals && vals["claimedAt"] instanceof Date) {
                if (row && row.userId === userId && row.claimedAt === null) {
                  row.claimedAt = vals["claimedAt"] as Date;
                  return [row];
                }
                return [];
              }
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

import router, {
  buildSharkDropClaimEvent,
  __setSharkDropClaimEventNotifier,
} from "../retention-delight";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const events: UserEventInput[] = [];

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
  events.length = 0;
  __setSharkDropClaimEventNotifier(async (input) => {
    events.push(input);
  });
});

afterEach(() => {
  __setSharkDropClaimEventNotifier(null);
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

describe("buildSharkDropClaimEvent", () => {
  it("addresses the member, money category, drop_claim kind, /credit-history link, honest amount", () => {
    const ev = buildSharkDropClaimEvent("user-a", 250);
    expect(ev).toMatchObject({
      userId: "user-a",
      category: "money",
      kind: "drop_claim",
      link: "/credit-history",
    });
    expect(ev.body).toContain("250 VB");
  });
});

describe("POST /api/retention/shark-drop/claim — the bell", () => {
  it("a landed claim tells the member exactly once", async () => {
    const drop = seedDrop({ amount: 250 });
    const res = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: h.state.userId,
      category: "money",
      kind: "drop_claim",
      link: "/credit-history",
    });
    expect(events[0]!.body).toContain("250 VB");
  });

  it("a replayed claim 404s at the flip and never re-bells — and never re-pays", async () => {
    const drop = seedDrop();
    const first = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(first.status).toBe(200);
    const second = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(second.status).toBe(404);
    expect(h.state.grantCalls).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("two concurrent claims bell exactly once", async () => {
    const drop = seedDrop();
    const [a, b] = await Promise.all([
      req("POST", "/retention/shark-drop/claim", { dropId: drop.id }),
      req("POST", "/retention/shark-drop/claim", { dropId: drop.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect(h.state.grantCalls).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("a failed grant tells nobody; the retry that lands tells exactly once", async () => {
    const drop = seedDrop();
    h.state.grantFailures = 1;
    const failed = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(failed.status).toBe(500);
    expect(events).toEqual([]);
    const retry = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(retry.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it("a failed ledger tells nobody (grant rolled back, claim released); the retry tells once", async () => {
    const drop = seedDrop();
    h.state.ledgerFailures = 1;
    const failed = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(failed.status).toBe(500);
    expect(h.state.restoreCalls).toBe(1);
    expect(events).toEqual([]);
    const retry = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(retry.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it("an expired drop tells nobody", async () => {
    const drop = seedDrop({ expiresInMs: -1000 });
    const res = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(res.status).toBe(410);
    expect(events).toEqual([]);
  });

  it("a throwing notifier cannot unwind a landed claim", async () => {
    __setSharkDropClaimEventNotifier(async () => {
      throw new Error("push down");
    });
    const drop = seedDrop();
    const res = await req("POST", "/retention/shark-drop/claim", { dropId: drop.id });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ claimed: true, amount: 250 });
    expect(h.state.grantCalls).toHaveLength(1);
    expect(drop.claimedAt).not.toBeNull();
  });
});
