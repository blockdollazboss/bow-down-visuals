/**
 * One Fan Graph — route contract: owner-scoping, honesty filters, and
 * pagination over HTTP.
 *
 * The REAL fan-graph router + lib run against a select-only fake db
 * (house pattern: drizzle conditions rendered with PgDialect and
 * evaluated against seeded rows). Two creators share one fan email on
 * purpose: creator A's graph must contain ONLY A's facts about that
 * fan — B's tier, B's sales, and B's other fans must never leak —
 * and the rails' honesty filters (completed-only sales, paid-only
 * live sales, credited-only tips) must hold end to end.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const auth = vi.hoisted(() => ({ userId: "" as string }));

/* ── Select-only fake db ─────────────────────────────────────────── */
const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
type Row = Record<string, any>;

function buildFakeDb(actual: Record<string, any>) {
  /* Inside the builder: the vi.mock factory runs at import time,
     before module-level consts initialize. */
  const TABLE_NAMES = [
    "creatorProfilesTable",
    "emailListsTable",
    "emailSubscribersTable",
    "followsTable",
    "fanTiersTable",
    "fanMembersTable",
    "storeOrdersTable",
    "digitalSalesTable",
    "shopEventsTable",
    "liveShopSalesTable",
    "worldStageTipsTable",
  ] as const;
  const tables = new Map<string, any>();
  const stores = new Map<string, Row[]>();
  for (const name of TABLE_NAMES) {
    const t = actual[name];
    if (t) tables.set(getTableName(t), t);
  }
  const rowsOf = (table: any): Row[] => {
    const n = getTableName(table);
    if (!stores.has(n)) stores.set(n, []);
    return stores.get(n)!;
  };
  const keyByDbName = (table: any, dbName: string): string | null => {
    for (const [k, v] of Object.entries(table)) {
      if (v && typeof v === "object" && (v as any).name === dbName) return k;
    }
    return null;
  };

  function splitTopLevelAnd(sql: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i]!;
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth === 0 && sql.startsWith(" and ", i)) {
        parts.push(cur);
        cur = "";
        i += 4;
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
  }
  function stripOuterParens(s: string): string {
    let out = s.trim();
    while (out.startsWith("(") && out.endsWith(")")) {
      let depth = 0;
      let wraps = true;
      for (let i = 0; i < out.length; i++) {
        if (out[i] === "(") depth++;
        if (out[i] === ")") depth--;
        if (depth === 0 && i < out.length - 1) { wraps = false; break; }
      }
      if (!wraps) break;
      out = out.slice(1, -1).trim();
    }
    return out;
  }
  function evalCondition(merged: Record<string, Row>, cond: unknown): boolean {
    if (cond === undefined || cond === null) return true;
    const { sql, params } = render(cond);
    return splitTopLevelAnd(stripOuterParens(sql)).every((rawPred) => {
      const pred = stripOuterParens(rawPred);
      let m = pred.match(/^"(\w+)"\."(\w+)"\s+is\s+(not\s+)?null$/);
      if (m) {
        const row = merged[m[1]!];
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        const val = row && key ? row[key] : null;
        return m[3] ? val != null : val == null;
      }
      m = pred.match(/^"(\w+)"\."(\w+)"\s+in\s*\(([^)]*)\)$/);
      if (m) {
        const row = merged[m[1]!];
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        const idxs = [...m[3]!.matchAll(/\$(\d+)/g)].map((x) => Number(x[1]) - 1);
        return idxs.some((ix) => row && key && row[key] === params[ix]);
      }
      m = pred.match(/^"(\w+)"\."(\w+)"\s*=\s*\$(\d+)$/);
      if (m) {
        const row = merged[m[1]!];
        const key = keyByDbName(tables.get(m[1]!), m[2]!);
        return !!(row && key && row[key] === params[Number(m[3]) - 1]);
      }
      throw new Error(`fake-db: unsupported predicate: ${pred}`);
    });
  }
  function projectRow(row: Row, table: any, fields: Record<string, any>): Row {
    const out: Row = {};
    for (const [k, f] of Object.entries(fields)) {
      if (f && typeof f === "object" && "name" in f && "table" in f) {
        const key = keyByDbName(table, (f as any).name);
        out[k] = key ? row[key] : null;
      } else out[k] = null;
    }
    return out;
  }

  const db = {
    select: (fields?: Record<string, any>) => ({
      from: (table: any) => {
        let cond: unknown;
        const chain: any = {
          where: (c: unknown) => { cond = c; return chain; },
          then: (onF: any, onR: any) => {
            const rows = rowsOf(table)
              .filter((r) => evalCondition({ [getTableName(table)]: r }, cond))
              .map((r) => (fields ? projectRow(structuredClone(r), table, fields) : structuredClone(r)));
            return Promise.resolve(rows).then(onF, onR);
          },
        };
        return chain;
      },
    }),
  };
  const seed = (table: any, rows: Row[]) => { stores.set(getTableName(table), rows); };
  const reset = () => stores.clear();
  return { db, seed, reset };
}

const fakeHolder = vi.hoisted(() => ({ seed: null as any, reset: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fake = buildFakeDb(actual);
  fakeHolder.seed = fake.seed;
  fakeHolder.reset = fake.reset;
  return { ...actual, db: fake.db };
});

/* Mirrors requireAuth's contract for this test: no signed-in user →
   401 before the handler; otherwise req.userId is the caller. The
   real middleware is covered by its own suite. */
vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    req.userId = auth.userId;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import fanGraphRouter from "../fan-graph";
import * as dbModule from "@workspace/db";

const T = (iso: string) => new Date(iso);
const A = "creator-a";
const B = "creator-b";

function seedUniverse() {
  fakeHolder.reset();
  const t = dbModule as any;
  fakeHolder.seed(t.creatorProfilesTable, [
    { id: "prof-a", userId: A },
    { id: "prof-b", userId: B },
    { id: "prof-fan1", userId: "fan-1", displayName: "Fan One", slug: "fan-one", avatarUrl: null },
  ]);
  fakeHolder.seed(t.emailListsTable, [
    { id: "list-a", userId: A },
    { id: "list-b", userId: B },
  ]);
  fakeHolder.seed(t.emailSubscribersTable, [
    { listId: "list-a", email: "shared@x.io", name: "Shared A", subscribedAt: T("2026-01-01T00:00:00Z"), unsubscribedAt: null },
    { listId: "list-a", email: "only-a@x.io", name: null, subscribedAt: T("2026-01-02T00:00:00Z"), unsubscribedAt: null },
    { listId: "list-b", email: "shared@x.io", name: "Shared B", subscribedAt: T("2026-01-01T00:00:00Z"), unsubscribedAt: null },
    { listId: "list-b", email: "only-b@x.io", name: null, subscribedAt: T("2026-01-02T00:00:00Z"), unsubscribedAt: null },
  ]);
  fakeHolder.seed(t.followsTable, [
    { followerUserId: "fan-1", profileId: "prof-a", createdAt: T("2026-01-03T00:00:00Z") },
    { followerUserId: "fan-2", profileId: "prof-b", createdAt: T("2026-01-03T00:00:00Z") },
  ]);
  fakeHolder.seed(t.fanTiersTable, [
    { id: "tier-a1", name: "Gold" },
    { id: "tier-b1", name: "Platinum" },
  ]);
  fakeHolder.seed(t.fanMembersTable, [
    { user_id: A, tier_id: "tier-a1", fan_label: "shared@x.io", fan_user_id: null, status: "active", price_cents: 0, stripe_session_id: null, joined_at: T("2026-01-04T00:00:00Z"), updated_at: T("2026-01-04T00:00:00Z") },
    { user_id: B, tier_id: "tier-b1", fan_label: "shared@x.io", fan_user_id: null, status: "active", price_cents: 0, stripe_session_id: null, joined_at: T("2026-01-04T00:00:00Z"), updated_at: T("2026-01-04T00:00:00Z") },
  ]);
  fakeHolder.seed(t.storeOrdersTable, [
    { buyerUserId: "fan-1", profileId: "prof-a", amountCents: 1000, status: "completed", createdAt: T("2026-02-01T00:00:00Z") },
    { buyerUserId: "fan-9", profileId: "prof-a", amountCents: 9900, status: "refunded", createdAt: T("2026-02-01T00:00:00Z") },
    { buyerUserId: "fan-2", profileId: "prof-b", amountCents: 2000, status: "completed", createdAt: T("2026-02-01T00:00:00Z") },
  ]);
  fakeHolder.seed(t.digitalSalesTable, []);
  fakeHolder.seed(t.shopEventsTable, [
    { user_id: A, event_type: "sale", buyer_email: "shared@x.io", amount_cents: 500, created_at: T("2026-02-02T00:00:00Z") },
    { user_id: A, event_type: "view", buyer_email: "shared@x.io", amount_cents: 0, created_at: T("2026-02-02T00:00:00Z") },
    { user_id: B, event_type: "sale", buyer_email: "shared@x.io", amount_cents: 700, created_at: T("2026-02-02T00:00:00Z") },
  ]);
  fakeHolder.seed(t.liveShopSalesTable, [
    { user_id: A, status: "paid", buyer_user_id: "fan-1", price_cents: 300, created_at: T("2026-02-03T00:00:00Z") },
    { user_id: A, status: "test", buyer_user_id: "fan-8", price_cents: 5000, created_at: T("2026-02-03T00:00:00Z") },
    { user_id: B, status: "paid", buyer_user_id: "fan-2", price_cents: 400, created_at: T("2026-02-03T00:00:00Z") },
  ]);
  fakeHolder.seed(t.worldStageTipsTable, [
    { fromUserId: "fan-1", toUserId: A, amountVb: 250, creatorCreditedAt: T("2026-02-04T00:00:00Z"), createdAt: T("2026-02-04T00:00:00Z") },
    { fromUserId: "fan-7", toUserId: A, amountVb: 999, creatorCreditedAt: null, createdAt: T("2026-02-04T00:00:00Z") },
    { fromUserId: "fan-2", toUserId: B, amountVb: 100, creatorCreditedAt: T("2026-02-04T00:00:00Z"), createdAt: T("2026-02-04T00:00:00Z") },
  ]);
}

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", fanGraphRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => { seedUniverse(); auth.userId = A; });

const get = async (qs = "") => {
  const res = await fetch(`${baseUrl}/api/email-list/fan-graph${qs}`);
  return { status: res.status, body: await res.json() };
};

describe("GET /api/email-list/fan-graph", () => {
  it("returns only the caller's own fans, with the caller's own facts", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.summary.totalFans).toBe(3);
    const ids = body.fans.map((f: any) => f.id).sort();
    expect(ids).toEqual(["e:only-a@x.io", "e:shared@x.io", "u:fan-1"]);

    const shared = body.fans.find((f: any) => f.id === "e:shared@x.io");
    expect(shared.displayName).toBe("Shared A"); // not B's "Shared B"
    expect(shared.member.tierName).toBe("Gold"); // A's tier, not B's Platinum
    expect(shared.spentUsdCents).toBe(500); // A's shop sale only — B's 700 never leaks

    const fan1 = body.fans.find((f: any) => f.id === "u:fan-1");
    expect(fan1.follows).toBe(true);
    expect(fan1.displayName).toBe("Fan One");
    expect(fan1.spentUsdCents).toBe(1300); // store 1000 + live 300
    expect(fan1.spentVb).toBe(250);
  });

  it("honesty filters hold end to end: refunded, demo, and uncredited rows never appear", async () => {
    const { body } = await get();
    const ids = body.fans.map((f: any) => f.id);
    expect(ids).not.toContain("u:fan-9"); // refunded store order
    expect(ids).not.toContain("u:fan-8"); // 'test' live sale — no money moved
    expect(ids).not.toContain("u:fan-7"); // uncredited tip — transfer never landed
    expect(body.summary.totalSpentUsdCents).toBe(1800);
    expect(body.summary.totalSpentVb).toBe(250);
  });

  it("the other creator sees their own graph, not A's", async () => {
    auth.userId = B;
    const { body } = await get();
    const ids = body.fans.map((f: any) => f.id).sort();
    expect(ids).toEqual(["e:only-b@x.io", "e:shared@x.io", "u:fan-2"]);
    const shared = body.fans.find((f: any) => f.id === "e:shared@x.io");
    expect(shared.member.tierName).toBe("Platinum");
    expect(shared.spentUsdCents).toBe(700);
  });

  it("paginates and sorts by spend", async () => {
    const p1 = await get("?pageSize=2&page=1&sort=spent");
    expect(p1.body.total).toBe(3);
    expect(p1.body.fans.map((f: any) => f.id)).toEqual(["u:fan-1", "e:shared@x.io"]);
    const p2 = await get("?pageSize=2&page=2&sort=spent");
    expect(p2.body.fans.map((f: any) => f.id)).toEqual(["e:only-a@x.io"]);
  });

  it("search narrows the graph", async () => {
    const { body } = await get("?search=shared");
    expect(body.total).toBe(1);
    expect(body.fans[0].id).toBe("e:shared@x.io");
  });

  it("rejects a signed-out caller and a bad query", async () => {
    auth.userId = "";
    const anon = await get();
    expect(anon.status).toBe(401);
    auth.userId = A;
    const bad = await get("?sort=sideways");
    expect(bad.status).toBe(400);
  });
});
