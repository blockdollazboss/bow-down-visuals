/**
 * GET /api/sponsors/can-spend — the can-spend readout (stack800 Lane 2).
 *
 * A poster under the pre-launch credit lockdown (CREDITS_ADMIN_ONLY)
 * could previously learn they're paused only from the 403 on their first
 * post attempt. The readout exposes the SAME predicate chargeCredits
 * enforces (lib/credits canUseCredits) as a free GET, so the sponsors
 * surface can show the paused state before the first attempt.
 *
 * Pinned here:
 *   - can spend     → 200 { canSpend: true } and nothing else
 *   - paused        → 200 { canSpend: false, code: "CREDITS_DISABLED",
 *                     message: <the shipped plain-words paused message> }
 *                     — the message is the sentence, never the raw code
 *   - the readout never charges or refunds (it is a pure read)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  userId: "",
  canSpend: true,
  charges: [] as Array<{ userId: string; cost: number }>,
  refunds: [] as Array<{ userId: string; cost: number }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userCredits = 100000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, db: { execute: async () => ({ rows: [] }) } };
});

vi.mock("../../lib/credits", () => {
  class CreditsDisabledError extends Error {
    readonly status = 403;
    constructor() {
      super("credits_disabled");
      this.name = "CreditsDisabledError";
    }
  }
  return {
    chargeCredits: vi.fn(async (u: string, cost: number) => {
      h.charges.push({ userId: u, cost });
      return 100000 - cost;
    }),
    refundCredits: vi.fn(async (u: string, cost: number) => {
      h.refunds.push({ userId: u, cost });
      return 100000;
    }),
    canUseCredits: vi.fn(async () => h.canSpend),
    OutOfCreditsError: class OutOfCreditsError extends Error {},
    CreditsDisabledError,
    LedgerWriteError: class LedgerWriteError extends Error {},
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => { throw new Error("no ai in can-spend tests"); }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

import sponsorsRouter, { SPONSOR_SPENDING_PAUSED_MESSAGE } from "../generate/sponsors";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();

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

beforeEach(() => {
  h.userId = USER;
  h.canSpend = true;
  h.charges = [];
  h.refunds = [];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("GET /sponsors/can-spend", () => {
  it("answers { canSpend: true } — and only that — when the account may spend", async () => {
    const { status, json } = await get("/sponsors/can-spend");
    expect(status).toBe(200);
    expect(json).toEqual({ canSpend: true });
  });

  it("answers the paused state with the shipped plain-words message when locked down", async () => {
    h.canSpend = false;
    const { status, json } = await get("/sponsors/can-spend");
    expect(status).toBe(200);
    expect(json.canSpend).toBe(false);
    expect(json.code).toBe("CREDITS_DISABLED");
    expect(json.message).toBe(SPONSOR_SPENDING_PAUSED_MESSAGE);
    /* The raw internal code is never the user-facing text. */
    expect(json.message).not.toContain("credits_disabled");
  });

  it("is a pure read: no charge and no refund in either state", async () => {
    await get("/sponsors/can-spend");
    h.canSpend = false;
    await get("/sponsors/can-spend");
    expect(h.charges).toHaveLength(0);
    expect(h.refunds).toHaveLength(0);
  });
});
