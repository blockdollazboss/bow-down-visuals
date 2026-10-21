/**
 * Wave-3 #11 (sponsors dedupe) — characterization of the wave8 pipeline's
 * CHARGED surface, written before any consolidation work:
 *
 *   POST /api/wave8/sponsors/followup — 50 Visual Bucs AI follow-up draft.
 *
 * This was the one money-moving sponsor behavior with no test coverage
 * (sponsors-divergence-characterization.test.ts pins the free CRUD +
 * mark-paid; generate/__tests__ pins the marketplace). These tests pin
 * the follow-up's actual current behavior exactly as-is:
 *
 *   - AI unconfigured → 503 ai_unavailable BEFORE any charge
 *   - balance < 50   → 402 out_of_credits, no charge attempted
 *   - invalid body   → 400, no charge
 *   - happy path     → charge 50 once, draft returned, last_followup_at
 *                      stamped on the deal row
 *   - foreign deal   → charge happened, then 404, then a full refund
 *                      (the handler charges BEFORE the ownership lookup)
 *   - provider error → 502, full refund, last_followup_at NOT stamped
 *
 * Plus the wave8 CRUD validation edges the divergence suite did not pin
 * (create/patch 400 shapes, foreign mark-paid 404 with no money entry).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  byTable: new Map<any, Array<Record<string, any>>>(),
  tables: null as any,
  userId: "",
  userCredits: 100000,
  charges: [] as Array<{ userId: string; cost: number; action?: string }>,
  refunds: [] as Array<{ userId: string; cost: number; action?: string }>,
  aiMode: "ok" as "ok" | "missing" | "fail",
}));

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
function matches(row: Record<string, any>, cond: any): boolean {
  const eqs: Record<string, unknown> = {};
  collectEq(cond, eqs);
  return Object.entries(eqs).every(([k, v]) => String(row[k]) === String(v));
}
function rowsOf(table: any) {
  if (!h.byTable.has(table)) h.byTable.set(table, []);
  return h.byTable.get(table)!;
}
function fakeDb(): any {
  const api: any = {
    select: (fields?: Record<string, any>) => ({
      from: (table: any) => {
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = cond ? rowsOf(table).filter((r) => matches(r, cond)) : [...rowsOf(table)];
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
    insert: (table: any) => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = { ...v, id: v.id ?? randomUUID(), created_at: new Date(), updated_at: new Date(), last_followup_at: null };
          rowsOf(table).push(row);
          return [row];
        },
      }),
    }),
    update: (table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            const hit = rowsOf(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
        }),
      }),
    }),
    execute: async () => ({ rows: [] }),
    transaction: async (cb: any) => cb(api),
  };
  return api;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userCredits = h.userCredits;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  h.tables = actual;
  return { ...actual, db: fakeDb() };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (u: string, cost: number, opts?: { action?: string }) => {
    h.charges.push({ userId: u, cost, action: opts?.action });
    h.userCredits -= cost;
    return h.userCredits;
  }),
  refundCredits: vi.fn(async (u: string, cost: number, opts?: { action?: string }) => {
    h.refunds.push({ userId: u, cost, action: opts?.action });
    h.userCredits += cost;
    return h.userCredits;
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => {
    if (h.aiMode === "missing") throw new Error("OPENAI_API_KEY is not configured");
    return {
      chat: {
        completions: {
          create: async () => {
            if (h.aiMode === "fail") throw new Error("provider boom");
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      subject: "Quick check-in",
                      body: "Hi there — circling back on our chat.",
                    }),
                  },
                },
              ],
            };
          },
        },
      },
    };
  }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

import wave8Router from "../wave8-sponsors";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const OTHER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(wave8Router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  h.byTable.clear();
  h.userId = USER;
  h.userCredits = 100000;
  h.charges = [];
  h.refunds = [];
  h.aiMode = "ok";
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function seedDeal(): Promise<string> {
  const created = await req("POST", "/wave8/sponsors/deals", {
    sponsorName: "Shoe Co", dealValueCents: 50000, contact: "a@b.co", notes: "n",
  });
  expect(created.status).toBe(201);
  return created.json.deal.id;
}

describe("POST /wave8/sponsors/followup — the 50 VB draft, characterized", () => {
  it("AI unconfigured → 503 ai_unavailable and NO charge is attempted", async () => {
    const id = await seedDeal();
    h.aiMode = "missing";
    const { status, json } = await req("POST", "/wave8/sponsors/followup", { dealId: id });
    expect(status).toBe(503);
    expect(json.error).toBe("ai_unavailable");
    expect(h.charges).toHaveLength(0);
    expect(h.refunds).toHaveLength(0);
    expect(h.userCredits).toBe(100000);
  });

  it("balance below 50 → 402 out_of_credits, no charge attempted", async () => {
    const id = await seedDeal();
    h.userCredits = 10;
    const { status, json } = await req("POST", "/wave8/sponsors/followup", { dealId: id });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(h.charges).toHaveLength(0);
  });

  it("missing dealId → 400 before any charge", async () => {
    const { status } = await req("POST", "/wave8/sponsors/followup", {});
    expect(status).toBe(400);
    expect(h.charges).toHaveLength(0);
  });

  it("happy path → charges exactly 50 once, returns the draft, stamps last_followup_at", async () => {
    const id = await seedDeal();
    const { status, json } = await req("POST", "/wave8/sponsors/followup", { dealId: id });
    expect(status).toBe(200);
    expect(json.subject).toBe("Quick check-in");
    expect(json.body).toContain("circling back");
    expect(json.creditsUsed).toBe(50);
    expect(json.creditsRemaining).toBe(100000 - 50);
    expect(h.charges).toEqual([{ userId: USER, cost: 50, action: "Sponsor Follow-up Draft" }]);
    expect(h.refunds).toHaveLength(0);
    const list = await req("GET", "/wave8/sponsors/deals");
    expect(list.json.deals[0].lastFollowupAt).not.toBeNull();
  });

  it("foreign deal → 404, and the upfront charge is fully refunded", async () => {
    const id = await seedDeal();
    h.userId = OTHER;
    const { status, json } = await req("POST", "/wave8/sponsors/followup", { dealId: id });
    expect(status).toBe(404);
    expect(json.error).toBe("Sponsor deal not found.");
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([
      { userId: OTHER, cost: 50, action: "Sponsor Follow-up Draft — Refund (draft failed)" },
    ]);
    expect(h.userCredits).toBe(100000);
  });

  it("provider failure → 502, full refund, last_followup_at NOT stamped", async () => {
    const id = await seedDeal();
    h.aiMode = "fail";
    const { status } = await req("POST", "/wave8/sponsors/followup", { dealId: id });
    expect(status).toBe(502);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toHaveLength(1);
    expect(h.userCredits).toBe(100000);
    const list = await req("GET", "/wave8/sponsors/deals");
    expect(list.json.deals[0].lastFollowupAt).toBeNull();
  });
});

describe("wave8 CRUD validation edges (not pinned by the divergence suite)", () => {
  it("create with an empty sponsor name → 400 with field details, nothing stored", async () => {
    const { status, json } = await req("POST", "/wave8/sponsors/deals", { sponsorName: "  " });
    expect(status).toBe(400);
    expect(json.error).toBe("Invalid sponsor deal.");
    expect(Array.isArray(json.details)).toBe(true);
    expect(rowsOf(h.tables.wave8SponsorDealsTable)).toHaveLength(0);
  });

  it("PATCH with an empty body → 400 (nothing to update)", async () => {
    const id = await seedDeal();
    const { status, json } = await req("PATCH", `/wave8/sponsors/deals/${id}`, {});
    expect(status).toBe(400);
    expect(json.error).toBe("Invalid sponsor deal update.");
  });

  it("PATCH with an unknown stage → 400", async () => {
    const id = await seedDeal();
    const { status } = await req("PATCH", `/wave8/sponsors/deals/${id}`, { stage: "bogus" });
    expect(status).toBe(400);
  });

  it("mark-paid by a non-owner → 404 and NO money entry is posted", async () => {
    const id = await seedDeal();
    h.userId = OTHER;
    const { status } = await req("POST", `/wave8/sponsors/deals/${id}/mark-paid`);
    expect(status).toBe(404);
    expect(rowsOf(h.tables.moneyEntriesTable)).toHaveLength(0);
  });
});
