/**
 * Lane V-bucs — GET /api/credits/balance + the additive `balance` field
 * on GET /api/credits/history.
 *
 * The dedicated read returns the permanent/temporary composition; the
 * history response carries the same composition for its header. A
 * balance-read failure must degrade the history field to null — never
 * fail the ledgers the page came for.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  balanceFails: false,
  composition: {
    total: 87_575,
    permanentCredits: 87_475,
    temporaryCredits: 100,
    temporaryGrants: [{ amount: 100, expiresAt: "2026-10-30T12:00:00.000Z" }],
    soonestTemporaryExpiry: { amount: 100, expiresAt: "2026-10-30T12:00:00.000Z" },
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/payment-record", () => ({
  getPaymentHistory: async () => [{ id: "pay-1", creditsAmount: 1000 }],
  getCreditUsage: async () => [{ id: "use-1", action: "song", creditsUsed: 400 }],
}));

vi.mock("../../lib/credits", () => ({
  getCreditBalanceComposition: async () => {
    if (h.balanceFails) throw new Error("balance read down");
    return h.composition;
  },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("not used by these routes in these tests");
  },
  addCreditsAtomic: async () => undefined,
}));

vi.mock("../../lib/grant-ledger", () => ({
  recordGrantLedger: async () => undefined,
  TRIAL_GRANT_CREDITS: 1000,
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
  h.balanceFails = false;
});

describe("GET /api/credits/balance — composition read", () => {
  it("returns permanent, temporary, and the soonest expiry", async () => {
    const r = await realFetch(`${baseUrl}/credits/balance`);
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.balance).toEqual(h.composition);
  });

  it("fails honestly when the balance read fails", async () => {
    h.balanceFails = true;
    const r = await realFetch(`${baseUrl}/credits/balance`);
    const json = (await r.json()) as any;
    expect(r.status).toBe(500);
    expect(json.error).toBe("Failed to load Visual Buc balance.");
  });
});

describe("GET /api/credits/history — additive balance field", () => {
  it("carries the composition alongside both ledgers", async () => {
    const r = await realFetch(`${baseUrl}/credits/history`);
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.balance).toEqual(h.composition);
    expect(json.purchases).toHaveLength(1);
    expect(json.usage).toHaveLength(1);
    expect(json.partial).toBe(false);
  });

  it("degrades balance to null — ledgers and partial untouched — when the balance read fails", async () => {
    h.balanceFails = true;
    const r = await realFetch(`${baseUrl}/credits/history`);
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.balance).toBeNull();
    expect(json.purchases).toHaveLength(1);
    expect(json.usage).toHaveLength(1);
    expect(json.partial).toBe(false);
  });
});
