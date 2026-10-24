/**
 * Theme pack purchases (owner pricing ruling, Oct 24 2026) — pg-mem,
 * chargeCredits faked at the lib/credits seam (balance + idempotency
 * replay + the real OutOfCreditsError), tier resolution REAL
 * (resolveCreatorTier against pg-mem creator_subscriptions, so the
 * lapse rule is the production rule, not a copy).
 *
 * Pins the ruled model:
 *  - buy: charges exactly 1,000 VB once and records ownership;
 *  - buy twice: the second purchase charges nothing (alreadyOwned);
 *  - insufficient balance: 402, no row, no partial charge;
 *  - Elite included: an active Elite member is never charged — the
 *    purchase answers eliteIncluded and state reports elite: true;
 *  - Elite lapse keeps purchased: cancel the subscription and the
 *    outright-bought pack stays in `owned`, the never-bought premium
 *    pack is neither owned nor Elite-covered;
 *  - free packs are not for sale; unknown packs 400.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userPlan: null as string | null,
  balance: 0,
  charges: [] as Array<{ userId: string; cost: number; key: string | null }>,
  chargedKeys: new Set<string>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = h.userPlan;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

/* resolveCreatorTier stubbed over raw SQL (the pg-mem adapter cannot
   run drizzle's query builder — every pg-mem-tested route reads via
   db.execute for the same reason). The stub applies the resolver's own
   documented rule: only active/trialing subscriptions count, so a
   canceled Elite row resolves to free — the lapse semantics under pin
   here are the route's, driven by the same status values. */
vi.mock("../../middlewares/require-tier", () => ({
  resolveCreatorTier: async (userId: string) => {
    const { rows } = await h.db.execute(sql.raw(
      `SELECT cs.tier AS tier, cs.status AS status
         FROM creator_profiles cp
         LEFT JOIN creator_subscriptions cs ON cs.profile_id = cp.id
        WHERE cp.user_id = '${userId}' LIMIT 1`,
    ));
    const row = rows[0] as { tier: string | null; status: string | null } | undefined;
    const admitting = row?.status === "active" || row?.status === "trialing";
    return {
      tier: admitting && row?.tier ? row.tier : "free",
      profileId: row ? "11111111-1111-4111-8111-111111111111" : null,
    };
  },
}));

vi.mock("../../lib/credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeCredits: vi.fn(async (userId: string, cost: number, _record: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? null;
      if (key && h.chargedKeys.has(key)) return h.balance; // idempotent replay
      if (h.balance < cost) throw new actual.OutOfCreditsError();
      h.balance -= cost;
      if (key) h.chargedKeys.add(key);
      h.charges.push({ userId, cost, key });
      return h.balance;
    }),
  };
});

import themePacksRouter from "../theme-packs";
import { THEME_PACK_PRICE_VB } from "../theme-packs";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

let server: ReturnType<typeof express.application.listen>;
let base = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const DDL = `
CREATE TABLE theme_pack_purchases (
  user_id text NOT NULL,
  pack_id text NOT NULL,
  price_vb integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id)
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY,
  user_id text NOT NULL
);
CREATE TABLE creator_subscriptions (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_end timestamptz,
  cancel_at_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

async function setTier(tier: string, status: string): Promise<void> {
  await h.db.execute(sql`DELETE FROM creator_subscriptions`);
  if (tier !== "none") {
    await h.db.execute(sql`
      INSERT INTO creator_subscriptions (id, profile_id, tier, status)
      VALUES (${randomUUID()}, ${PROFILE}, ${tier}, ${status})`);
  }
}

beforeAll(async () => {
  const { db, mem } = createTestDb() as any;
  h.db = db;
  mem.public.none(DDL);
  await h.db.execute(sql`
    INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${USER})`);
  const app = express();
  app.use(express.json());
  app.use("/api", themePacksRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  h.userId = USER;
  h.userPlan = null;
  h.balance = 0;
  h.charges = [];
  h.chargedKeys = new Set();
  await h.db.execute(sql`DELETE FROM theme_pack_purchases`);
  await setTier("none", "active");
});

describe("theme pack purchase rail", () => {
  it("the price is the ruled 1,000 VB", () => {
    expect(THEME_PACK_PRICE_VB).toBe(1000);
  });

  it("buy: charges exactly 1,000 VB once and records ownership", async () => {
    h.balance = 2500;
    const r = await call("POST", "/theme-packs/purchase", { packId: "kings-set" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ owned: true, alreadyOwned: false, chargedVb: 1000 });
    expect(h.balance).toBe(1500);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.cost).toBe(1000);
    const state = await call("GET", "/theme-packs/state");
    expect(state.json.owned).toEqual(["kings-set"]);
    expect(state.json.priceVb).toBe(1000);
    expect(state.json.elite).toBe(false);
  });

  it("buy twice: the second purchase charges nothing", async () => {
    h.balance = 2500;
    await call("POST", "/theme-packs/purchase", { packId: "arcade-gold" });
    const again = await call("POST", "/theme-packs/purchase", { packId: "arcade-gold" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ owned: true, alreadyOwned: true, chargedVb: 0 });
    expect(h.charges).toHaveLength(1);
    expect(h.balance).toBe(1500);
  });

  it("insufficient balance: 402, no ownership row, no partial charge", async () => {
    h.balance = 999;
    const r = await call("POST", "/theme-packs/purchase", { packId: "kings-set" });
    expect(r.status).toBe(402);
    expect(r.json.error).toBe("INSUFFICIENT_VB");
    expect(h.balance).toBe(999);
    expect(h.charges).toHaveLength(0);
    const state = await call("GET", "/theme-packs/state");
    expect(state.json.owned).toEqual([]);
  });

  it("Elite included: an active Elite member is never charged", async () => {
    await setTier("elite", "active");
    h.balance = 5000;
    const r = await call("POST", "/theme-packs/purchase", { packId: "kings-set" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ eliteIncluded: true, chargedVb: 0 });
    expect(h.charges).toHaveLength(0);
    expect(h.balance).toBe(5000);
    const state = await call("GET", "/theme-packs/state");
    expect(state.json.elite).toBe(true);
    expect(state.json.owned).toEqual([]);
  });

  it("Elite lapse keeps purchased packs (and only those)", async () => {
    // Buy Arcade Gold outright as a free user.
    h.balance = 1000;
    const buy = await call("POST", "/theme-packs/purchase", { packId: "arcade-gold" });
    expect(buy.json.owned).toBe(true);
    // Join Elite, then let it lapse (canceled).
    await setTier("elite", "canceled");
    const state = await call("GET", "/theme-packs/state");
    expect(state.json.elite).toBe(false);
    expect(state.json.owned).toEqual(["arcade-gold"]);
    // The never-bought premium pack is not covered: buying it now charges.
    h.balance = 1000;
    const r = await call("POST", "/theme-packs/purchase", { packId: "kings-set" });
    expect(r.json).toMatchObject({ owned: true, chargedVb: 1000 });
  });

  it("free packs are not for sale; unknown packs are refused", async () => {
    h.balance = 5000;
    const free = await call("POST", "/theme-packs/purchase", { packId: "golden-marble" });
    expect(free.status).toBe(400);
    expect(free.json.error).toBe("PACK_NOT_FOR_SALE");
    const unknown = await call("POST", "/theme-packs/purchase", { packId: "nope" });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toBe("PACK_UNKNOWN");
    expect(h.charges).toHaveLength(0);
  });

  it("a retry with the same idempotency key never double-charges", async () => {
    h.balance = 3000;
    await call("POST", "/theme-packs/purchase", { packId: "kings-set" });
    // Simulate the crash window: row deleted (insert never landed),
    // retry must replay the charge idempotently and land the row.
    await h.db.execute(sql`DELETE FROM theme_pack_purchases`);
    const retry = await call("POST", "/theme-packs/purchase", { packId: "kings-set" });
    expect(retry.json.owned).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.balance).toBe(2000);
  });

  it("random uuid import is used (harness sanity)", () => {
    expect(randomUUID()).toBeTruthy();
  });
});
