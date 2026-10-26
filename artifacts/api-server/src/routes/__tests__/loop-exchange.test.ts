/**
 * loop-exchange.test.ts (routes) — Loop Exchange (#168) end-to-end on
 * pg-mem against the provisional migration 9999's own DDL.
 *
 * Pins the whole deal over HTTP:
 * - a poster posts a loop with their terms UP FRONT (share in (0,100));
 * - a builder cannot build on their own loop, cannot offer the poster
 *   less than their posted terms, and the splits ride the existing
 *   sale-splits rail (sum-to-100);
 * - only the poster decides, only once, and only an AGREED build can
 *   record a downstream sale — recorded by the builder only;
 * - a sale pays EVERY split share exactly once in TEST MODE Visual
 *   Bucs: flat 5% fee off the top, net divided by the agreed splits,
 *   one split-ledger row + one keyed credit_usage row + one balance
 *   credit per recipient — and a replay of the same sale_ref pays
 *   nobody twice;
 * - /mine reports the poster's real earnings from the ledger.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  balances: new Map<string, number>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

/* The balance rail is the only Supabase touch in the flow — track it
   in memory so the test can assert exactly-once credits by amount. */
vi.mock("../../lib/supabase-admin", async (importOriginal) => {
  const actual = await importOriginal<any>().catch(() => ({} as any));
  return {
    ...actual,
    addCreditsAtomic: vi.fn(async (userId: string, amount: number) => {
      h.balances.set(userId, (h.balances.get(userId) ?? 0) + amount);
    }),
  };
});

import loopExchangeRouter from "../loop-exchange";
import { __resetLoopExchangeProbes } from "../../lib/loop-exchange";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/* Local pg-mem harness (the catalog-import pattern): pg-mem rejects
   the `rowMode: "array"` drizzle's typed queries send, so the shim
   strips it and re-shapes rows into arrays when drizzle asked for
   them. The shared test-db shim only strips `types`, which is why
   .returning() inserts fail there with "Not supported: pg rowMode". */
function createLoopTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const shim = {
    query: async (config: unknown, values?: unknown[]) => {
      let cfg: unknown = config;
      let wantArray = false;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        const { types: _t, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const result = (await (pool as any).query(cfg, values)) as any;
      if (wantArray && Array.isArray(result?.rows) && result.rows.length > 0) {
        const names = Object.keys(result.rows[0]);
        return { ...result, rows: result.rows.map((row: any) => names.map((n) => row[n])) };
      }
      return result;
    },
  };
  return drizzle(shim as never);
}

/* The migration's own DDL (9999-loop-exchange.sql) + the two tables the
   flow touches outside it: creator_profiles (poster/builder profile
   ids) and credit_usage (the keyed split-payment ledger). */
const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL
);
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, action text NOT NULL, credits_used integer NOT NULL,
  project_id uuid, team_id uuid, idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_usage_idempotency_ux ON credit_usage (idempotency_key);
CREATE TABLE loop_exchange_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_user_id uuid NOT NULL,
  poster_profile_id uuid,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  audio_url text NOT NULL,
  bpm integer,
  musical_key text,
  duration_seconds integer,
  poster_share_pct numeric(5,2) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_loops_status_check CHECK (status IN ('open', 'paused', 'closed')),
  CONSTRAINT loop_exchange_loops_share_check CHECK (poster_share_pct > 0 AND poster_share_pct < 100)
);
CREATE TABLE loop_exchange_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id uuid NOT NULL REFERENCES loop_exchange_loops(id) ON DELETE CASCADE,
  builder_user_id uuid NOT NULL,
  builder_profile_id uuid,
  title text NOT NULL,
  audio_url text,
  splits jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending_terms',
  agreed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_builds_status_check CHECK (status IN ('pending_terms', 'agreed', 'declined'))
);
CREATE TABLE loop_exchange_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES loop_exchange_builds(id) ON DELETE CASCADE,
  loop_id uuid NOT NULL REFERENCES loop_exchange_loops(id) ON DELETE CASCADE,
  sale_ref text NOT NULL,
  buyer_user_id uuid,
  recorded_by_user_id uuid NOT NULL,
  gross_vb integer NOT NULL,
  fee_vb integer NOT NULL DEFAULT 0,
  net_vb integer NOT NULL DEFAULT 0,
  test_mode boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_sales_gross_check CHECK (gross_vb > 0),
  CONSTRAINT loop_exchange_sales_net_check CHECK (net_vb >= 0 AND fee_vb >= 0)
);
CREATE UNIQUE INDEX loop_exchange_sales_ref_ux ON loop_exchange_sales (sale_ref);
CREATE TABLE loop_exchange_split_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES loop_exchange_sales(id) ON DELETE CASCADE,
  build_id uuid NOT NULL,
  loop_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'collaborator',
  share_pct numeric(5,2) NOT NULL,
  amount_vb integer NOT NULL DEFAULT 0,
  credit_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_exchange_split_ledger_role_check CHECK (role IN ('loop_poster', 'builder', 'collaborator')),
  CONSTRAINT loop_exchange_split_ledger_amount_check CHECK (amount_vb >= 0)
);
CREATE UNIQUE INDEX loop_exchange_split_ledger_sale_recipient_ux ON loop_exchange_split_ledger (sale_id, recipient_user_id);
`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

const POSTER = randomUUID();
const BUILDER = randomUUID();
const COLLAB = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", loopExchangeRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[loop-exchange] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  h.db = createLoopTestDb();
  h.balances = new Map();
  h.userId = POSTER;
  __resetLoopExchangeProbes();
});

async function req(method: string, path: string, body?: unknown, as?: string) {
  if (as) h.userId = as;
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function postLoop(as = POSTER) {
  return req("POST", "/loop-exchange/loops", {
    title: "Midnight Hook",
    audioUrl: "https://cdn/hook.mp3",
    bpm: 142,
    musicalKey: "G minor",
    posterSharePct: 25,
  }, as);
}

async function postBuild(loopId: string, splits: unknown, as = BUILDER) {
  return req("POST", `/loop-exchange/loops/${loopId}/builds`, { title: "Midnight Anthem", splits }, as);
}

const GOOD_SPLITS = [
  { userId: BUILDER, sharePct: 60 },
  { userId: POSTER, sharePct: 25 },
  { userId: COLLAB, sharePct: 15 },
];

describe("loop exchange routes — the deal over HTTP", () => {
  it("posts a loop on the poster's terms and lists it publicly", async () => {
    const posted = await postLoop();
    expect(posted.status).toBe(201);
    expect(posted.json.loop).toMatchObject({ title: "Midnight Hook", posterSharePct: 25, status: "open" });

    const list = await req("GET", "/loop-exchange/loops");
    expect(list.status).toBe(200);
    expect(list.json.loops).toHaveLength(1);
    expect(list.json.loops[0].posterUserId).toBe(POSTER);
  });

  it("refuses a poster share outside (0, 100) — terms are never invented", async () => {
    const bad = await req("POST", "/loop-exchange/loops", {
      title: "X", audioUrl: "https://cdn/x.mp3", posterSharePct: 100,
    });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("poster_share_range");
  });

  it("a builder can't build on their own loop, lowball the poster, or break the sum", async () => {
    const { json } = await postLoop();
    const loopId = json.loop.id as string;

    const own = await postBuild(loopId, GOOD_SPLITS, POSTER);
    expect(own.status).toBe(400);
    expect(own.json.code).toBe("own_loop");

    const lowball = await postBuild(loopId, [
      { userId: BUILDER, sharePct: 80 },
      { userId: POSTER, sharePct: 20 },
    ]);
    expect(lowball.status).toBe(400);
    expect(lowball.json.code).toBe("poster_share_below_terms");

    const badSum = await postBuild(loopId, [
      { userId: BUILDER, sharePct: 60 },
      { userId: POSTER, sharePct: 25 },
    ]);
    expect(badSum.status).toBe(400);
    expect(badSum.json.code).toBe("split_sum");
  });

  it("only the poster decides, only once — and no sale before agreement", async () => {
    const { json } = await postLoop();
    const loopId = json.loop.id as string;
    const build = await postBuild(loopId, GOOD_SPLITS);
    expect(build.status).toBe(201);
    expect(build.json.build.status).toBe("pending_terms");
    const buildId = build.json.build.id as string;

    const earlySale = await req("POST", `/loop-exchange/builds/${buildId}/sales`, { saleRef: "order-1", grossVb: 1000 }, BUILDER);
    expect(earlySale.status).toBe(409);
    expect(earlySale.json.code).toBe("terms_not_agreed");

    const builderDecides = await req("POST", `/loop-exchange/builds/${buildId}/decision`, { decision: "agreed" }, BUILDER);
    expect(builderDecides.status).toBe(403);
    expect(builderDecides.json.code).toBe("not_poster");

    const agreed = await req("POST", `/loop-exchange/builds/${buildId}/decision`, { decision: "agreed" }, POSTER);
    expect(agreed.status).toBe(200);
    expect(agreed.json.build.status).toBe("agreed");
    expect(agreed.json.build.agreedAt).toBeTruthy();

    const redecide = await req("POST", `/loop-exchange/builds/${buildId}/decision`, { decision: "declined" }, POSTER);
    expect(redecide.status).toBe(409);
    expect(redecide.json.code).toBe("already_decided");
  });

  it("an agreed build's sale pays every share exactly once — replay pays nobody twice", async () => {
    const { json } = await postLoop();
    const loopId = json.loop.id as string;
    const build = await postBuild(loopId, GOOD_SPLITS);
    const buildId = build.json.build.id as string;
    await req("POST", `/loop-exchange/builds/${buildId}/decision`, { decision: "agreed" }, POSTER);

    const notBuilder = await req("POST", `/loop-exchange/builds/${buildId}/sales`, { saleRef: "order-1", grossVb: 1000 }, POSTER);
    expect(notBuilder.status).toBe(403);
    expect(notBuilder.json.code).toBe("not_builder");

    const sale = await req("POST", `/loop-exchange/builds/${buildId}/sales`, { saleRef: "order-1", grossVb: 1000 }, BUILDER);
    expect(sale.status).toBe(201);
    expect(sale.json.outcome).toBe("recorded");
    expect(sale.json.sale).toMatchObject({ grossVb: 1000, feeVb: 50, netVb: 950 });
    expect(sale.json.allocations.reduce((s: number, a: any) => s + a.amountVb, 0)).toBe(950);

    // Balances: poster 25% of 950 = 238 (largest remainder), builder 570, collab 142.
    expect(h.balances.get(POSTER)).toBe(238);
    expect(h.balances.get(BUILDER)).toBe(570);
    expect(h.balances.get(COLLAB)).toBe(142);

    const ledger = await h.db.execute(sql`SELECT recipient_user_id, amount_vb, credit_key FROM loop_exchange_split_ledger`);
    expect(ledger.rows).toHaveLength(3);
    const usage = await h.db.execute(sql`SELECT idempotency_key, credits_used FROM credit_usage`);
    expect(usage.rows).toHaveLength(3);
    for (const row of usage.rows as any[]) {
      expect(row.idempotency_key).toMatch(/^loop-exchange:/);
      expect(row.credits_used).toBeLessThan(0); // grant convention: negative creditsUsed
    }
    const sales = await h.db.execute(sql`SELECT test_mode FROM loop_exchange_sales`);
    expect(sales.rows).toHaveLength(1);
    expect((sales.rows[0] as any).test_mode).toBe(true);

    // Replay: same sale_ref — 200 already-recorded, nothing moves.
    const replay = await req("POST", `/loop-exchange/builds/${buildId}/sales`, { saleRef: "order-1", grossVb: 1000 }, BUILDER);
    expect(replay.status).toBe(200);
    expect(replay.json.outcome).toBe("already-recorded");
    expect(h.balances.get(POSTER)).toBe(238);
    expect(h.balances.get(BUILDER)).toBe(570);
    const ledgerAfter = await h.db.execute(sql`SELECT id FROM loop_exchange_split_ledger`);
    expect(ledgerAfter.rows).toHaveLength(3);

    // A SECOND downstream sale pays the poster again — every sale, not just the first.
    const sale2 = await req("POST", `/loop-exchange/builds/${buildId}/sales`, { saleRef: "order-2", grossVb: 1000 }, BUILDER);
    expect(sale2.status).toBe(201);
    expect(h.balances.get(POSTER)).toBe(476);
  });

  it("/mine reports the poster's loops and real ledger earnings; the builder sees their builds", async () => {
    const { json } = await postLoop();
    const loopId = json.loop.id as string;
    const build = await postBuild(loopId, GOOD_SPLITS);
    const buildId = build.json.build.id as string;
    await req("POST", `/loop-exchange/builds/${buildId}/decision`, { decision: "agreed" }, POSTER);
    await req("POST", `/loop-exchange/builds/${buildId}/sales`, { saleRef: "order-9", grossVb: 1000 }, BUILDER);

    const minePoster = await req("GET", "/loop-exchange/mine", undefined, POSTER);
    expect(minePoster.status).toBe(200);
    expect(minePoster.json.loops).toHaveLength(1);
    expect(minePoster.json.totalEarnedVb).toBe(238);
    expect(minePoster.json.earnings[0]).toMatchObject({ role: "loop_poster", sharePct: 25, amountVb: 238 });

    const mineBuilder = await req("GET", "/loop-exchange/mine", undefined, BUILDER);
    expect(mineBuilder.json.builds).toHaveLength(1);
    expect(mineBuilder.json.totalEarnedVb).toBe(570);
  });

  it("the poster can pause their loop — a paused loop takes no new builds", async () => {
    const { json } = await postLoop();
    const loopId = json.loop.id as string;

    const byBuilder = await req("PATCH", `/loop-exchange/loops/${loopId}`, { status: "paused" }, BUILDER);
    expect(byBuilder.status).toBe(403);

    const paused = await req("PATCH", `/loop-exchange/loops/${loopId}`, { status: "paused" }, POSTER);
    expect(paused.status).toBe(200);
    expect(paused.json.loop.status).toBe("paused");

    const build = await postBuild(loopId, GOOD_SPLITS);
    expect(build.status).toBe(409);
    expect(build.json.code).toBe("loop_not_open");

    const list = await req("GET", "/loop-exchange/loops");
    expect(list.json.loops).toHaveLength(0); // only OPEN loops are listed
  });
});
