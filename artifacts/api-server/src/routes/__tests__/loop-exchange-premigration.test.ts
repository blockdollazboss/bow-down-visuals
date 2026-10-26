/**
 * loop-exchange-premigration.test.ts — Loop Exchange (#168) BEFORE the
 * provisional migration 9999 lands. Separate file on purpose: the
 * readiness probe caches per process, so the no-tables world needs its
 * own module registry (the commerce-pixels-premigration pattern).
 *
 * With no loop_exchange_* tables anywhere:
 *  - every WRITE answers an honest 503 (code not_ready) — a loop, a
 *    build, a decision, or a sale is never silently dropped or faked;
 *  - reads degrade honestly: the public list is empty, a loop detail
 *    is a plain 404, and /mine is an empty account — never a 500.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

const h = vi.hoisted(() => ({ db: null as any, userId: "" }));

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

vi.mock("../../lib/supabase-admin", async (importOriginal) => {
  const actual = await importOriginal<any>().catch(() => ({} as any));
  return { ...actual, addCreditsAtomic: vi.fn(async () => {}) };
});

import loopExchangeRouter from "../loop-exchange";

/* No loop tables — only the neighbours the routes might touch. */
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
`;

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

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();

beforeAll(async () => {
  h.db = createLoopTestDb();
  h.userId = USER;
  const app = express();
  app.use(express.json());
  app.use("/api", loopExchangeRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[loop-exchange-premigration] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("loop exchange pre-migration — honest not-ready, nothing faked", () => {
  it("writes answer 503 not_ready", async () => {
    const post = await req("POST", "/loop-exchange/loops", {
      title: "Midnight Hook", audioUrl: "https://cdn/hook.mp3", posterSharePct: 25,
    });
    expect(post.status).toBe(503);
    expect(post.json.code).toBe("not_ready");

    const build = await req("POST", `/loop-exchange/loops/${randomUUID()}/builds`, {
      title: "Build", splits: [{ userId: USER, sharePct: 100 }],
    });
    expect(build.status).toBe(503);
    expect(build.json.code).toBe("not_ready");

    const decision = await req("POST", `/loop-exchange/builds/${randomUUID()}/decision`, { decision: "agreed" });
    expect(decision.status).toBe(503);

    const sale = await req("POST", `/loop-exchange/builds/${randomUUID()}/sales`, { saleRef: "order-1", grossVb: 1000 });
    expect(sale.status).toBe(503);

    const patch = await req("PATCH", `/loop-exchange/loops/${randomUUID()}`, { status: "paused" });
    expect(patch.status).toBe(503);
  });

  it("reads degrade to empty / 404, never a 500 and never invented data", async () => {
    const list = await req("GET", "/loop-exchange/loops");
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ loops: [] });

    const detail = await req("GET", `/loop-exchange/loops/${randomUUID()}`);
    expect(detail.status).toBe(404);

    const mine = await req("GET", "/loop-exchange/mine");
    expect(mine.status).toBe(200);
    expect(mine.json).toEqual({ loops: [], builds: [], earnings: [], totalEarnedVb: 0 });
  });
});
