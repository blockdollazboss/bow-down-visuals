/**
 * Sponsor rail parity — the two sponsor FEATURES on the ONE rail
 * (stack800 Lane 2 consolidation).
 *
 * History: Stack 8 Item 3 characterized two separate routers and proved
 * the features are NOT duplicates of each other. That evidence stands —
 * different tables, different money semantics — but the duplicate ROUTER
 * is now retired: both features ride generate/sponsors.ts.
 *
 *   /sponsors/*           tables sponsor_deals / sponsor_applications /
 *     sponsor_payouts. A MARKETPLACE: brands post deals (500 VB),
 *     creators apply, escrow flow fund → confirm → start → complete →
 *     release with a 15% platform fee and a sponsor_payouts ledger row.
 *     Escrow behavior is characterized by sponsors-escrow.test.ts +
 *     sponsors.test.ts (existing suite).
 *
 *   /sponsors/pipeline/*  table wave8_sponsor_deals (+ money_entries on
 *     mark-paid). A personal PIPELINE CRM: the creator tracks their OWN
 *     deals through pitched → negotiating → closed → paid; mark-paid
 *     posts the value to their money tracker. No applications, no
 *     escrow, no counterparty, no fund/release. (Formerly
 *     /api/wave8/sponsors/* — those paths now 404; pinned below.)
 *
 * These tests pin the pipeline surface's actual behaviour on the
 * surviving rail and the fact that the two surfaces still do not see
 * each other's data.
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
  chargeCredits: vi.fn(async (_u: string, cost: number) => { h.userCredits -= cost; return h.userCredits; }),
  refundCredits: vi.fn(async (_u: string, cost: number) => { h.userCredits += cost; return h.userCredits; }),
  canUseCredits: vi.fn(async () => true),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  CreditsDisabledError: class CreditsDisabledError extends Error {
    readonly status = 403;
    constructor() {
      super("credits_disabled");
      this.name = "CreditsDisabledError";
    }
  },
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => { throw new Error("no ai in characterization"); }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

import sponsorsRouter from "../generate/sponsors";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const OTHER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(sponsorsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => { h.byTable.clear(); h.userId = USER; h.userCredits = 100000; vi.clearAllMocks(); });

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("pipeline surface on the sponsors rail (wave8_sponsor_deals)", () => {
  it("create is free, starts at stage pitched, returns the camelCase DTO", async () => {
    const { status, json } = await req("POST", "/sponsors/pipeline/deals", {
      sponsorName: "Shoe Co", dealValueCents: 50000, contact: "a@b.co", notes: "n",
    });
    expect(status).toBe(201);
    expect(json.deal).toMatchObject({ sponsorName: "Shoe Co", stage: "pitched", dealValueCents: 50000 });
  });

  it("list shows only the owner's deals; PATCH moves stage; foreign PATCH 404s", async () => {
    const created = await req("POST", "/sponsors/pipeline/deals", { sponsorName: "A", dealValueCents: 100 });
    const id = created.json.deal.id;
    h.userId = OTHER;
    await req("POST", "/sponsors/pipeline/deals", { sponsorName: "B", dealValueCents: 200 });
    const foreign = await req("PATCH", `/sponsors/pipeline/deals/${id}`, { stage: "closed" });
    expect(foreign.status).toBe(404);
    h.userId = USER;
    const list = await req("GET", "/sponsors/pipeline/deals");
    expect(list.json.deals).toHaveLength(1);
    const moved = await req("PATCH", `/sponsors/pipeline/deals/${id}`, { stage: "negotiating" });
    expect(moved.json.deal.stage).toBe("negotiating");
  });

  it("mark-paid flips stage to paid AND posts a Sponsorship money entry", async () => {
    const created = await req("POST", "/sponsors/pipeline/deals", { sponsorName: "Paid Co", dealValueCents: 75000 });
    const id = created.json.deal.id;
    const { status, json } = await req("POST", `/sponsors/pipeline/deals/${id}/mark-paid`);
    expect(status).toBe(200);
    expect(json.deal.stage).toBe("paid");
    expect(json.posted).toBe(true);
    expect(json.entry).toMatchObject({ entry_type: "income", category: "Sponsorship", amount_cents: 75000 });
    const entries = rowsOf(h.tables.moneyEntriesTable);
    expect(entries).toHaveLength(1);
  });

  it("mark-paid on a zero-value deal posts NO money entry (posted:false)", async () => {
    const created = await req("POST", "/sponsors/pipeline/deals", { sponsorName: "Free Co", dealValueCents: 0 });
    const { json } = await req("POST", `/sponsors/pipeline/deals/${created.json.deal.id}/mark-paid`);
    expect(json.posted).toBe(false);
    expect(rowsOf(h.tables.moneyEntriesTable)).toHaveLength(0);
  });

  it("the pipeline has NO escrow flow: fund/release paths do not exist on this surface", async () => {
    const created = await req("POST", "/sponsors/pipeline/deals", { sponsorName: "X", dealValueCents: 1 });
    const id = created.json.deal.id;
    expect((await req("POST", `/sponsors/pipeline/deals/${id}/fund`, { amountCents: 1 })).status).toBe(404);
    expect((await req("POST", `/sponsors/pipeline/deals/${id}/release`)).status).toBe(404);
    expect((await req("POST", `/sponsors/pipeline/deals/${id}/start`)).status).toBe(404);
    expect((await req("POST", `/sponsors/pipeline/deals/${id}/complete`)).status).toBe(404);
  });
});

describe("surface separation (the features stay distinct on one rail)", () => {
  it("a pipeline deal is invisible to the marketplace surface (different table)", async () => {
    await req("POST", "/sponsors/pipeline/deals", { sponsorName: "Pipeline Only", dealValueCents: 100 });
    const { status, json } = await req("GET", "/sponsors/deals");
    expect(status).toBe(200);
    expect(json.deals ?? json).toBeDefined();
    const list = Array.isArray(json) ? json : json.deals;
    expect(list).toHaveLength(0); // marketplace reads sponsor_deals, not wave8_sponsor_deals
    // and the pipeline list reads only its own table
    const wave = await req("GET", "/sponsors/pipeline/deals");
    expect(wave.json.deals).toHaveLength(1);
  });
});

describe("the retired wave8 mount", () => {
  it("the old /wave8/sponsors/* paths are gone (404) — one rail only", async () => {
    expect((await req("GET", "/wave8/sponsors/deals")).status).toBe(404);
    expect((await req("POST", "/wave8/sponsors/deals", { sponsorName: "Ghost" })).status).toBe(404);
    expect((await req("POST", "/wave8/sponsors/followup", { dealId: "x" })).status).toBe(404);
    expect(rowsOf(h.tables.wave8SponsorDealsTable)).toHaveLength(0);
  });
});
