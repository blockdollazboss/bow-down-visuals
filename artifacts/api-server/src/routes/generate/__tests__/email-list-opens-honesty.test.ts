/**
 * Stack-30 D2 — email opens honesty.
 *
 * There is NO open-tracking signal anywhere in the system: no tracking
 * pixel endpoint, no provider webhook, and the email-list feature never
 * sends through the mail helper (campaigns are queued rows). The
 * email_subscribers.opens column is therefore a permanent 0 — yet the
 * subscribers dashboard used to turn it into an "openRate" and present
 * it as a measured stat ("Avg. opens / subscriber: 0", footnoted
 * "best-effort pixel tracking" — tracking that does not exist).
 *
 * The honest contract, driven here against the REAL router: stats
 * report openRate: null + opensTracked: false, while the stats that DO
 * have real data behind them (total / active / unsubscribed) keep
 * computing from the actual rows.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";

const h = vi.hoisted(() => ({
  lists: [] as Array<Record<string, any>>,
  subscribers: [] as Array<Record<string, any>>,
  userId: "",
}));

/** Walk a drizzle condition's queryChunks collecting column = param pairs. */
function collectEq(node: any, out: Record<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  const chunks: any[] = Array.isArray(node.queryChunks) ? node.queryChunks : [];
  let pendingCol: string | null = null;
  for (const ch of chunks) {
    if (ch && typeof ch === "object") {
      if (typeof ch.name === "string" && ch.table) { pendingCol = ch.name; continue; }
      if (ch.constructor?.name === "Param" && pendingCol) { out[pendingCol] = ch.value; pendingCol = null; continue; }
      if (Array.isArray(ch.queryChunks)) collectEq(ch, out);
      if (Array.isArray(ch.value)) for (const v of ch.value) collectEq(v, out);
    }
  }
}
/* Drizzle conditions name DB columns (list_id); stored fake rows carry
   the TS shape (listId) the route code reads. */
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
function matches(row: Record<string, any>, cond: any): boolean {
  const eqs: Record<string, unknown> = {};
  collectEq(cond, eqs);
  return Object.entries(eqs).every(([k, v]) => String(row[camel(k)] ?? row[k]) === String(v));
}

function tableRows(table: any): Array<Record<string, any>> {
  /* The fake distinguishes the two tables by the drizzle table object
     identity the route passes to .from(). */
  return table === (globalThis as any).__emailListsTable ? h.lists : h.subscribers;
}

function fakeDb() {
  return {
    select: (fields?: Record<string, any>) => ({
      from: (table: any) => {
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = cond ? tableRows(table).filter((r) => matches(r, cond)) : [...tableRows(table)];
          if (lim !== null) rows = rows.slice(0, lim);
          if (fields) rows = rows.map((r) => Object.fromEntries(Object.keys(fields).map((k) => [k, r[k]])));
          return rows;
        };
        const chain: any = {
          where: (c: any) => { cond = c; return chain; },
          orderBy: (..._a: any[]) => chain,
          limit: async (n: number) => { lim = n; return run(); },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return chain;
      },
    }),
  };
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = h.userId; req.userCredits = 100000; next(); },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  (globalThis as any).__emailListsTable = actual.emailListsTable;
  return { ...actual, db: fakeDb() };
});

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => { throw new Error("no ai in opens-honesty tests"); }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {} },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 100000),
  refundCredits: vi.fn(async () => 100000),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/payment-record", () => ({
  recordCreditUsage: vi.fn(async () => {}),
}));

import emailListRouter from "../email-list";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const LIST = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use(emailListRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  h.userId = USER;
  h.lists = [{ id: LIST, userId: USER, name: "The List", handle: "the-list" }];
  h.subscribers = [
    { id: randomUUID(), listId: LIST, email: "a@x.com", name: "A", source: "landing", confirmed: true, opens: 0, unsubscribedAt: null, subscribedAt: new Date() },
    { id: randomUUID(), listId: LIST, email: "b@x.com", name: "B", source: "embed", confirmed: true, opens: 0, unsubscribedAt: null, subscribedAt: new Date() },
    { id: randomUUID(), listId: LIST, email: "c@x.com", name: "C", source: "landing", confirmed: true, opens: 0, unsubscribedAt: new Date(), subscribedAt: new Date() },
  ];
  vi.clearAllMocks();
});

describe("GET /email-list/lists/:id/subscribers — opens stat honesty", () => {
  it("reports opens as NOT TRACKED (openRate null), never a fabricated 0 rate", async () => {
    const r = await realFetch(`${baseUrl}/email-list/lists/${LIST}/subscribers`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as any;
    expect(json.stats.openRate).toBeNull();
    expect(json.stats.opensTracked).toBe(false);
  });

  it("the stats backed by real data still compute from the actual rows", async () => {
    const r = await realFetch(`${baseUrl}/email-list/lists/${LIST}/subscribers`);
    const json = (await r.json()) as any;
    expect(json.stats.total).toBe(3);
    expect(json.stats.active).toBe(2);
    expect(json.stats.unsubscribed).toBe(1);
    expect(json.subscribers).toHaveLength(3);
  });

  it("another user's list still 404s (ownership unchanged)", async () => {
    h.userId = randomUUID();
    const r = await realFetch(`${baseUrl}/email-list/lists/${LIST}/subscribers`);
    expect(r.status).toBe(404);
  });
});

describe("the fake stat cannot come back (source)", () => {
  it("the route no longer derives a rate from the never-written opens column", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "email-list.ts"), "utf8");
    expect(src).not.toContain("totalOpens");
    expect(src).not.toContain("pixel-based");
    expect(src).toContain("opensTracked: false");
  });

  it("the schema no longer claims pixel tracking exists", () => {
    const schemaSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "..", "..", "lib", "db", "src", "schema", "email-lists.ts"),
      "utf8",
    );
    expect(schemaSrc).not.toContain("best-effort pixel");
    expect(schemaSrc).toContain("NOT TRACKED");
  });
});
