/**
 * Paid Priority DMs (Wave-4 #44) — route gate tests.
 *
 * PRICE GATE: PRIORITY_DM_ENABLED ships OFF (open owner call). With
 * the gate off the routes must (a) say so plainly, (b) never expose a
 * purchasable price, and (c) refuse a send BEFORE any charge or row.
 * The core money promises (exactly-once charge, refund-on-block,
 * expiry refund, reply payout) are covered in lib/__tests__/priority-dms.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({ chargeCalls: 0 }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = ME; next(); },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => { h.chargeCalls++; },
  refundCredits: async () => {},
  OutOfCreditsError: class extends Error {},
  CreditsDisabledError: class extends Error {},
  LedgerWriteError: class extends Error {},
}));

vi.mock("../../lib/supabase-admin", () => ({ addCreditsToProfile: async () => {} }));
vi.mock("../../lib/payment-record", () => ({ recordCreditUsageStrict: async () => {} }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [],
    then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
  };
  const fakeDb: any = {
    select: () => chain,
    insert: () => ({ values: () => ({ returning: async () => [], onConflictDoUpdate: async () => {} }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../priority-dms";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  delete process.env["PRIORITY_DM_ENABLED"]; // gate OFF, as shipped
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

beforeEach(() => { h.chargeCalls = 0; });

describe("gate OFF (the shipped default)", () => {
  it("status says not available and exposes no price", async () => {
    const res = await fetch(`${baseUrl}/priority-dms/status?creator=${CREATOR}`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.platform_enabled).toBe(false);
    expect(body.available).toBe(false);
    expect(body.reason).toBe("gate_off");
    expect(body).not.toHaveProperty("price_vb");
  });

  it("send is refused before any charge", async () => {
    const res = await fetch(`${baseUrl}/priority-dms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creator_user_id: CREATOR, body: "hello", idempotency_key: "intent-1000" }),
    });
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(body.error).toBe("priority_dm_unavailable");
    expect(h.chargeCalls).toBe(0);
  });

  it("my-settings loads honest defaults — opted out, no price invented", async () => {
    const res = await fetch(`${baseUrl}/priority-dms/my-settings`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.platform_enabled).toBe(false);
    expect(body.opted_in).toBe(false);
    expect(body.min_price_vb).toBeNull();
  });

  it("opting in without my own price is refused — no default fills in", async () => {
    const res = await fetch(`${baseUrl}/priority-dms/my-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opted_in: true }),
    });
    expect(res.status).toBe(400);
  });
});
