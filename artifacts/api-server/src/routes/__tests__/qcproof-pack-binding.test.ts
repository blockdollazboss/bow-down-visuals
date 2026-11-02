/**
 * qcproof-pack-binding.test.ts — QC-200 Q141 residual: the
 * PACK_MAP <-> env-price binding, behaviourally, for ALL FOUR packs
 * on EVERY creation rail.
 *
 * Gateproof-packs proved the grant side (a session/PI carrying the
 * right credits_amount grants exactly that, once — incl. the 71,000
 * sweep). What was never executed: that choosing pack "10"/"50"/
 * "150"/"500" at checkout CREATION actually charges the Stripe Price
 * named by that pack's STRIPE_PRICE_*_CREDITS env var and stamps the
 * matching credits_amount — a swapped envKey in any of the three
 * PACK_MAPs (stripe-payments / embedded-checkout / express-pay)
 * would charge one price and grant another pack's Bucs, and no grant
 * test could see it. This suite mounts all three real routers with a
 * capturing guarded-Stripe fake whose Prices carry the ruled dollar
 * amounts ($9/$39/$99/$249), and asserts per pack, per rail:
 *   - prices.retrieve / line_items use EXACTLY the env price id bound
 *     to that pack key (distinct sentinel ids per pack);
 *   - the charged amount equals that price's unit_amount;
 *   - metadata credits_amount / credit_pack match the pack table;
 *   - hosted + embedded creation carries a deterministic checkout
 *     idempotency key (same intent + same purchase count -> same key;
 *     count advances -> new key).
 * The key BUILDER itself is pinned by stripe-checkout-idempotency*.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash } from "node:crypto";

const USER_ID = "1596b9a1-bbd0-4bda-8bf2-a22443e6ace8";

/* pack key -> { env price id sentinel, unit_amount cents, credits } */
const PACKS = [
  { key: "10", priceId: "price_qc_10", cents: 900, credits: 1000, label: "1,000 Visual Bucs" },
  { key: "50", priceId: "price_qc_50", cents: 3900, credits: 5000, label: "5,000 Visual Bucs" },
  { key: "150", priceId: "price_qc_150", cents: 9900, credits: 15000, label: "15,000 Visual Bucs" },
  { key: "500", priceId: "price_qc_500", cents: 24900, credits: 50000, label: "50,000 Visual Bucs" },
] as const;

const h = vi.hoisted(() => ({
  sessionCreates: [] as Array<{ params: any; opts: any }>,
  piCreates: [] as Array<{ params: any; opts: any }>,
  priceRetrieves: [] as string[],
  completedCount: 0,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    checkout: {
      sessions: {
        create: async (params: any, opts: any) => {
          h.sessionCreates.push({ params, opts });
          return { id: "cs_qc", url: "https://checkout.example/cs_qc" };
        },
        retrieve: vi.fn(async () => { throw new Error("not used"); }),
      },
    },
    paymentIntents: {
      create: async (params: any, opts: any) => {
        h.piCreates.push({ params, opts });
        return { id: `pi_qc_${h.piCreates.length}`, client_secret: "pi_qc_secret" };
      },
      retrieve: vi.fn(async () => { throw new Error("not used"); }),
    },
    prices: {
      retrieve: async (id: string) => {
        h.priceRetrieves.push(id);
        const pack = [
          { priceId: "price_qc_10", cents: 900 },
          { priceId: "price_qc_50", cents: 3900 },
          { priceId: "price_qc_150", cents: 9900 },
          { priceId: "price_qc_500", cents: 24900 },
        ].find((p) => p.priceId === id);
        if (!pack) throw new Error(`unknown price ${id}`);
        return { id, unit_amount: pack.cents, currency: "usd" };
      },
    },
  })),
  /* Faithful stand-in: deterministic and intent-sensitive, like the
     real builder (whose own pin lives in stripe-checkout-idempotency*). */
  buildCheckoutSessionIdempotencyKey: vi.fn((args: any) =>
    "qc_" + createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 32),
  ),
}));

vi.mock("../../lib/payment-record", () => ({
  fulfillCreditPurchase: vi.fn(async () => ({ outcome: "granted", newCredits: 0 })),
  getStripePaymentStatus: vi.fn(async () => null),
  countCompletedCreditPurchases: vi.fn(async () => h.completedCount),
  getPaymentHistory: vi.fn(async () => []),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, db: {} };
});

vi.mock("../creator-tiers", () => ({ ensureProfile: vi.fn(async () => ({})) }));
vi.mock("../../lib/creator-tier-upgrade", () => ({ previewCreatorTierChange: vi.fn() }));
vi.mock("../../lib/tier-change", () => ({
  buildTierChangePreviewView: vi.fn(),
  isChangeableRow: vi.fn(() => false),
}));
vi.mock("../referrals", () => ({ awardReferralPayout: vi.fn(async () => 0) }));

import stripePaymentsRouter from "../stripe-payments";
import embeddedCheckoutRouter from "../embedded-checkout";
import expressPayRouter from "../express-pay";

let server: Server;
let base = "";

beforeAll(async () => {
  for (const p of PACKS) {
    process.env[`STRIPE_PRICE_${p.key}_CREDITS`] = p.priceId;
  }
  const app = express();
  app.use(express.json());
  app.use("/api", stripePaymentsRouter);
  app.use("/api", embeddedCheckoutRouter);
  app.use("/api", expressPayRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.sessionCreates = [];
  h.piCreates = [];
  h.priceRetrieves = [];
  h.completedCount = 0;
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": USER_ID },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("Q141 pack binding — hosted rail POST /create-checkout-session", () => {
  for (const p of PACKS) {
    it(`pack ${p.key}: charges env price ${p.priceId} ($${p.cents / 100}) and stamps ${p.credits} VB`, async () => {
      const { status, body } = await post("/api/create-checkout-session", { pack: p.key });
      expect(status).toBe(200);
      expect(body.url).toBeTruthy();
      expect(h.sessionCreates).toHaveLength(1);
      const { params, opts } = h.sessionCreates[0]!;
      expect(params.line_items).toEqual([{ price: p.priceId, quantity: 1 }]);
      expect(params.metadata).toMatchObject({
        user_id: USER_ID,
        credit_pack: p.label,
        credits_amount: String(p.credits),
      });
      expect(typeof opts?.idempotencyKey).toBe("string");
      expect(opts.idempotencyKey.length).toBeGreaterThan(8);
    });
  }

  it("the idempotency key repeats for the same intent and advances after a completed purchase", async () => {
    await post("/api/create-checkout-session", { pack: "50" });
    await post("/api/create-checkout-session", { pack: "50" });
    expect(h.sessionCreates[1]!.opts.idempotencyKey).toBe(h.sessionCreates[0]!.opts.idempotencyKey);
    h.completedCount = 1;
    await post("/api/create-checkout-session", { pack: "50" });
    expect(h.sessionCreates[2]!.opts.idempotencyKey).not.toBe(h.sessionCreates[0]!.opts.idempotencyKey);
    /* A different pack never shares the key. */
    await post("/api/create-checkout-session", { pack: "150" });
    expect(h.sessionCreates[3]!.opts.idempotencyKey).not.toBe(h.sessionCreates[2]!.opts.idempotencyKey);
  });
});

describe("Q141 pack binding — embedded rail POST /embedded-checkout/credit-pack/intent", () => {
  for (const p of PACKS) {
    it(`pack ${p.key}: resolves env price ${p.priceId}, PI amount $${p.cents / 100}, stamps ${p.credits} VB`, async () => {
      const { status, body } = await post("/api/embedded-checkout/credit-pack/intent", { pack: p.key });
      expect(status).toBe(200);
      expect(body).toMatchObject({ success: true, amount: p.cents, credits: p.credits, label: p.label });
      expect(h.priceRetrieves).toEqual([p.priceId]);
      expect(h.piCreates).toHaveLength(1);
      const { params, opts } = h.piCreates[0]!;
      expect(params.amount).toBe(p.cents);
      expect(params.metadata).toMatchObject({
        source: "embedded_checkout",
        kind: "credit_pack",
        credit_pack: p.label,
        credits_amount: String(p.credits),
        pack_key: p.key,
      });
      expect(typeof opts?.idempotencyKey).toBe("string");
    });
  }
});

describe("Q141/Q142 pack binding — express rail POST /payments/express", () => {
  for (const p of PACKS) {
    it(`pack ${p.key}: resolves env price ${p.priceId}, PI amount $${p.cents / 100}, stamps ${p.credits} VB as express_pay`, async () => {
      const { status, body } = await post("/api/payments/express", { pack: p.key });
      expect(status).toBe(200);
      expect(body).toMatchObject({ success: true, amount: p.cents, label: p.label });
      expect(h.priceRetrieves).toEqual([p.priceId]);
      expect(h.piCreates).toHaveLength(1);
      const { params } = h.piCreates[0]!;
      expect(params.amount).toBe(p.cents);
      expect(params.metadata).toMatchObject({
        source: "express_pay",
        credit_pack: p.label,
        credits_amount: String(p.credits),
        pack_key: p.key,
      });
    });
  }
});
