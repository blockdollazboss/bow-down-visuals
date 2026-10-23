/**
 * S27-39 — GET /api/credits/history per-ledger settle.
 *
 * Purchases and usage are independent ledgers read through
 * Promise.all in one try — one failing used to 500 the whole history.
 * Now each settles on its own (earnings.ts pattern): the failed side
 * returns its empty shape ([]), the survivor returns its data, and the
 * response carries partial: true. Only BOTH ledgers failing keeps
 * the old 500.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  state: {
    purchasesFail: false,
    usageFail: false,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/payment-record", () => ({
  getPaymentHistory: async () => {
    if (h.state.purchasesFail) throw new Error("purchases ledger down");
    return [{ id: "pay-1", creditsAmount: 1000 }];
  },
  getCreditUsage: async () => {
    if (h.state.usageFail) throw new Error("usage ledger down");
    return [{ id: "use-1", action: "song", creditsUsed: 400 }];
  },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("not used by this route in these tests");
  },
  addCreditsAtomic: async () => undefined,
}));

import router from "../credits";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.purchasesFail = false;
  h.state.usageFail = false;
});

async function getHistory() {
  const r = await realFetch(`${baseUrl}/credits/history`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/credits/history — per-ledger settle (S27-39)", () => {
  it("returns both ledgers, not partial, when both are healthy", async () => {
    const { status, json } = await getHistory();
    expect(status).toBe(200);
    expect(json.purchases).toEqual([{ id: "pay-1", creditsAmount: 1000 }]);
    expect(json.usage).toEqual([{ id: "use-1", action: "song", creditsUsed: 400 }]);
    expect(json.partial).toBe(false);
  });

  it("purchases failing returns usage data with purchases as its empty shape", async () => {
    h.state.purchasesFail = true;
    const { status, json } = await getHistory();
    expect(status).toBe(200);
    expect(json.purchases).toEqual([]);
    expect(json.usage).toEqual([{ id: "use-1", action: "song", creditsUsed: 400 }]);
    expect(json.partial).toBe(true);
  });

  it("usage failing returns purchases data with usage as its empty shape", async () => {
    h.state.usageFail = true;
    const { status, json } = await getHistory();
    expect(status).toBe(200);
    expect(json.purchases).toEqual([{ id: "pay-1", creditsAmount: 1000 }]);
    expect(json.usage).toEqual([]);
    expect(json.partial).toBe(true);
  });

  it("keeps the 500 only when BOTH ledgers fail", async () => {
    h.state.purchasesFail = true;
    h.state.usageFail = true;
    const { status, json } = await getHistory();
    expect(status).toBe(500);
    expect(json.error).toBe("Failed to load Visual Buc history.");
  });
});
