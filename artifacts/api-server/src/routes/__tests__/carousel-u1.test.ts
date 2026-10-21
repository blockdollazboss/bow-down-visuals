/**
 * U1 pin — POST /carousel/export derives its idempotency key
 * server-side when the client sends none, so a retry of the same
 * export can't double-charge for one delivery. A genuinely different
 * export (different slide count) still charges.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; idempotencyKey?: string }>,
  chargedKeys: new Set<string>(),
}));

function creditsFactory() {
  return {
    chargeCredits: vi.fn(async (_u: string, amount: number, _meta: any, opts: any) => {
      const key = opts?.idempotencyKey as string | undefined;
      if (key) {
        if (h.chargedKeys.has(key)) return 4242;
        h.chargedKeys.add(key);
      }
      h.charges.push({ amount, idempotencyKey: key });
      return 4242;
    }),
    buildChargeIdempotencyKey: (
      scope: string,
      userId: string,
      clientKey: string | null | undefined,
      intent: Record<string, unknown>,
    ) =>
      clientKey
        ? `${scope}:${userId}:client:${clientKey}`
        : `${scope}:${userId}:auto:${JSON.stringify(intent)}`,
    OutOfCreditsError: class OutOfCreditsError extends Error {},
    LedgerWriteError: class LedgerWriteError extends Error {},
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => creditsFactory());
vi.mock("../../lib/credits.js", () => creditsFactory());

import carouselRouter from "../carousel";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(carouselRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.charges = [];
  h.chargedKeys = new Set();
  vi.clearAllMocks();
});

async function post(body: unknown) {
  const r = await realFetch(`${baseUrl}/carousel/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("U1 — POST /carousel/export server-derived idempotency", () => {
  it("two identical keyless exports charge once", async () => {
    const first = await post({ slideCount: 5 });
    const second = await post({ slideCount: 5 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.charges[0]!.idempotencyKey).toMatch(/^carousel_export:user-1:auto:/);
  });

  it("a different slide count is a different purchase and charges again", async () => {
    await post({ slideCount: 5 });
    const second = await post({ slideCount: 6 });
    expect(second.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });

  it("a client-supplied key is honored verbatim", async () => {
    await post({ slideCount: 5, idempotencyKey: "client-key-1" });
    await post({ slideCount: 5, idempotencyKey: "client-key-1" });
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.idempotencyKey).toBe("carousel_export:user-1:client:client-key-1");
  });
});
