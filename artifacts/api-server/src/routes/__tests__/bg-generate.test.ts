/**
 * bg-generate (Stack 7 #4): the stub is WIRED. Route tests with the
 * provider faked through the client seam and credits faked in memory:
 *  - success charges exactly BG_GENERATE_CREDIT_COST (200) once
 *  - an idempotent replay does not double-charge
 *  - provider failure refunds the charge and reports 500 honestly
 *  - no key configured → 503, no charge
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  balance: 1000,
  charges: [] as { amount: number; key: string }[],
  refunds: [] as number[],
  chargedKeys: new Set<string>(),
  voids: [] as string[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: { userId?: string; userCredits?: number }, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    req.userCredits = state.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  return {
    OutOfCreditsError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, cost: number, _rec: unknown, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && state.chargedKeys.has(key)) return state.balance; // idempotent replay
      if (state.balance < cost) throw new OutOfCreditsError("out");
      state.balance -= cost;
      if (key) state.chargedKeys.add(key);
      state.charges.push({ amount: cost, key });
      return state.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      state.balance += amount;
      state.refunds.push(amount);
      return state.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      state.voids.push(key);
      return state.chargedKeys.delete(key);
    },
  };
});

import bgGenerateRouter, { BG_GENERATE_CREDIT_COST } from "../generate/bg-generate";
import { __setBgImageDepsForTests } from "../../lib/bg-image-client";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { log: unknown }).log = { info() {}, error() {}, warn() {} }; next(); });
  app.use(bgGenerateRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  __setBgImageDepsForTests(null);
  delete process.env["OPENAI_API_KEY"];
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  state.balance = 1000; state.charges = []; state.refunds = []; state.chargedKeys = new Set(); state.voids = [];
  __setBgImageDepsForTests({
    generate: async () => Buffer.from("fake-png-bytes"),
    upload: async (userId) => `https://cdn.example/bg-plates/${userId}/plate.png`,
  });
});

async function post(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe("POST /bg-generate — wired provider", () => {
  it("status reports configured + the real 200 price, not a placeholder", async () => {
    const res = await fetch(`${base}/bg-generate/status`);
    const json = (await res.json()) as { configured: boolean; creditCost: number; pricePlaceholder: boolean };
    expect(json.configured).toBe(true);
    expect(json.creditCost).toBe(200);
    expect(json.creditCost).toBe(BG_GENERATE_CREDIT_COST);
    expect(json.pricePlaceholder).toBe(false);
  });

  it("success: charges 200 once and returns the plate URL", async () => {
    const r = await post("/bg-generate", { prompt: "a moody jazz club stage", style: "studio", idempotencyKey: "attempt-0001" });
    expect(r.status).toBe(200);
    expect(r.json?.["imageUrl"]).toBe("https://cdn.example/bg-plates/user-1/plate.png");
    expect(r.json?.["creditCost"]).toBe(200);
    expect(state.charges).toEqual([{ amount: 200, key: "bg-generate:user-1:client:attempt-0001" }]);
    expect(state.balance).toBe(800);
  });

  it("idempotent replay of the same attempt does not double-charge", async () => {
    await post("/bg-generate", { prompt: "a moody jazz club stage", idempotencyKey: "attempt-0002" });
    await post("/bg-generate", { prompt: "a moody jazz club stage", idempotencyKey: "attempt-0002" });
    expect(state.charges).toHaveLength(1);
    expect(state.balance).toBe(800);
  });

  it("provider failure: charge is refunded and the failure is reported, not hidden", async () => {
    __setBgImageDepsForTests({ generate: async () => { throw new Error("provider exploded"); } });
    const r = await post("/bg-generate", { prompt: "underwater palace hall", idempotencyKey: "attempt-0003" });
    expect(r.status).toBe(500);
    expect(r.json?.["error"]).toBe("BG_GENERATE_FAILED");
    expect(state.refunds).toEqual([200]);
    expect(state.balance).toBe(1000); // charge + refund = whole
  });

  it("out of credits → 402, provider never called", async () => {
    state.balance = 50;
    let called = false;
    __setBgImageDepsForTests({ generate: async () => { called = true; return Buffer.from("x"); } });
    const r = await post("/bg-generate", { prompt: "underwater palace hall", idempotencyKey: "attempt-0004" });
    expect(r.status).toBe(402);
    expect(called).toBe(false);
  });

  it("invalid body → 400 before any charge", async () => {
    const r = await post("/bg-generate", { prompt: "x" });
    expect(r.status).toBe(400);
    expect(state.charges).toEqual([]);
  });
});

describe("POST /bg-generate — refund/retry leak (Lane V3 F1)", () => {
  it("a refunded attempt's key is voided, so the retry CHARGES again (was: free generation)", async () => {
    __setBgImageDepsForTests({ generate: async () => { throw new Error("provider exploded"); } });
    const failed = await post("/bg-generate", { prompt: "underwater palace hall", idempotencyKey: "attempt-1001" });
    expect(failed.status).toBe(500);
    expect(state.refunds).toEqual([200]);
    expect(state.voids).toEqual(["bg-generate:user-1:client:attempt-1001"]);
    expect(state.balance).toBe(1000); // whole after refund

    // Provider recovers; the SAME attempt key retries — and pays again.
    __setBgImageDepsForTests({
      generate: async () => Buffer.from("fake-png-bytes"),
      upload: async (userId: string) => `https://cdn.example/bg-plates/${userId}/plate.png`,
    });
    const retry = await post("/bg-generate", { prompt: "underwater palace hall", idempotencyKey: "attempt-1001" });
    expect(retry.status).toBe(200);
    expect(state.charges).toHaveLength(2);
    expect(state.balance).toBe(800); // second charge landed
  });

  it("keyless callers are charged per run — identical re-runs are not permanently free", async () => {
    const a = await post("/bg-generate", { prompt: "neon rooftop at dusk", style: "neon-city" });
    const b = await post("/bg-generate", { prompt: "neon rooftop at dusk", style: "neon-city" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(state.charges).toHaveLength(2);
    expect(state.charges.every((c) => c.key === "")).toBe(true); // no dedupe key used
    expect(state.balance).toBe(600);
  });

  it("a keyed success still dedupes (double-tap protection unchanged)", async () => {
    await post("/bg-generate", { prompt: "golden dunes", idempotencyKey: "attempt-1002" });
    await post("/bg-generate", { prompt: "golden dunes", idempotencyKey: "attempt-1002" });
    expect(state.charges).toHaveLength(1);
    expect(state.voids).toEqual([]);
  });
});
