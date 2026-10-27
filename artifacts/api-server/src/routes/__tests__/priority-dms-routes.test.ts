/**
 * Paid Priority DMs (Wave-4 #44) — route gate tests.
 *
 * PRICE + GATE — OWNER RULED 2026-10-27: the gate ships OPEN and the
 * price is the platform's ruled 100 VB per message. With the gate on
 * the routes must (a) say so, (b) expose the ruled price on the
 * creator's own settings, and (c) let a creator opt in with no price
 * of their own. With the kill switch (PRIORITY_DM_ENABLED=false) the
 * routes must say so plainly, expose no purchasable price, and refuse
 * a send BEFORE any charge or row. The core money promises
 * (exactly-once charge at 100 VB, refund-on-block, expiry refund,
 * reply payout) are covered in lib/__tests__/priority-dms.
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
  delete process.env["PRIORITY_DM_ENABLED"]; // gate ON, as shipped after the ruling
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  delete process.env["PRIORITY_DM_ENABLED"];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { h.chargeCalls = 0; });

describe("gate ON (the shipped default — owner ruling 2026-10-27)", () => {
  it("status is honest: platform on, this creator not opted in, no price leaked", async () => {
    const res = await fetch(`${baseUrl}/priority-dms/status?creator=${CREATOR}`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.platform_enabled).toBe(true);
    expect(body.available).toBe(false);
    expect(body.reason).toBe("not_opted_in");
    expect(body).not.toHaveProperty("price_vb");
  });

  it("my-settings loads defaults plus the ruled platform price of 100 VB", async () => {
    const res = await fetch(`${baseUrl}/priority-dms/my-settings`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.platform_enabled).toBe(true);
    expect(body.opted_in).toBe(false);
    expect(body.min_price_vb).toBeNull();
    expect(body.price_vb).toBe(100);
  });

  it("opting in WITHOUT a price of my own succeeds — the platform price rules", async () => {
    const res = await fetch(`${baseUrl}/priority-dms/my-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opted_in: true, reply_window_hours: 24 }),
    });
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.opted_in).toBe(true);
    expect(body.price_vb).toBe(100);
  });
});

describe("gate OFF (the PRIORITY_DM_ENABLED=false kill switch)", () => {
  beforeAll(() => { process.env["PRIORITY_DM_ENABLED"] = "false"; });
  afterAll(() => { delete process.env["PRIORITY_DM_ENABLED"]; });

  it("status says gate_off and exposes no price", async () => {
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
});
