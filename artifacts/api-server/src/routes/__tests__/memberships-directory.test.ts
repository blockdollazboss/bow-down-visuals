/**
 * Route tests for the club DIRECTORY (parity P3, lane
 * par-membership-depth): GET /api/memberships/directory.
 *
 * Before this lane, the only way to a club — on the website and in
 * the World alike — was a pasted join ID (/memberships?creator=…);
 * nothing listed the clubs that exist. The directory is the missing
 * browse rail: every creator with at least one ACTIVE tier, with
 * only what the join cards themselves show (public profile name /
 * handle, crown count, cheapest crown, trial presence). No member
 * data rides along.
 *
 * The REAL memberships router runs over an ephemeral server against
 * a cond-aware fake db, in the house style of
 * memberships-management.test.ts; checkout/verify/ai-perks are
 * mocked away (untested here).
 *
 * Pins:
 *  - a creator with only paused tiers never lists;
 *  - paused tiers don't count toward a listed club's crowns, its
 *    starting price, or its trial flag;
 *  - a creator with no public profile still lists (name null —
 *    the join ID is the identity, the name is decoration);
 *  - ordering is deterministic: most crowns first, then the
 *    cheapest starting crown;
 *  - the endpoint is public (no auth header needed).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR_A = "11111111-1111-4111-8111-111111111111";
const CREATOR_B = "22222222-2222-4222-8222-222222222222";
const CREATOR_C = "33333333-3333-4333-8333-333333333333";
const CREATOR_D = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  state: {
    tiers: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers["x-anon"]) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = req.headers["x-user-id"] ?? CREATOR_A;
    req.userEmail = "creator@example.test";
    req.userCredits = 1000;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => { throw new Error("no AI in route tests"); },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: async () => 900,
  refundCredits: async () => undefined,
}));

vi.mock("../../lib/stripe-checkout", () => ({
  createPaymentCheckout: async () => { throw new Error("no checkout in directory tests"); },
  retrieveCheckoutSession: async () => { throw new Error("no checkout in directory tests"); },
  refundCheckoutSessionPayment: async () => false,
  checkoutBaseUrl: () => "http://localhost",
  isCheckoutTestMode: () => true,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { fanTiersTable, creatorProfilesTable } = actual;

  /* Condition shapes used by the route under test:
       fanTiers        eq(is_active)   → ["true"]        (directory read)
       creatorProfiles inArray(userId) → [id, id, …]     (profile join)
     The profiles select passes a fields object to db.select — the
     fake ignores it and returns full rows, like the house fakes. */
  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    if (table === fanTiersTable) {
      if (cond === undefined || cond === null) return state.tiers;
      const { params } = render(cond);
      return state.tiers.filter((t) => String(t["is_active"]) === String(params[0]));
    }
    if (table === creatorProfilesTable) {
      if (cond === undefined || cond === null) return state.profiles;
      const { params } = render(cond);
      const wanted = new Set(params.map((p) => String(p)));
      return state.profiles.filter((p) => wanted.has(String(p["userId"])));
    }
    return [];
  }

  function chain(table: unknown): any {
    let cond: unknown;
    const c: any = {
      where: (w: unknown) => { cond = w; return c; },
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table, cond).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({ from: (table: unknown) => chain(table) }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    delete: () => ({ where: () => ({ returning: async () => [] }) }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import membershipsRouter from "../generate/memberships";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", membershipsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function tier(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `tier-${Math.random().toString(36).slice(2, 10)}`,
    user_id: CREATOR_A,
    name: "Crown",
    price_cents: 500,
    description: "",
    perks: [],
    sort_order: 0,
    trial_enabled: false,
    pause_enabled: true,
    annual_discount_pct: 0,
    is_active: "true",
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    updated_at: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  h.state.tiers = [
    /* A: two live crowns (one with a trial) + a cheaper PAUSED crown
       that must not count toward anything. */
    tier({ id: "a-1", user_id: CREATOR_A, name: "Gold", price_cents: 1000 }),
    tier({ id: "a-2", user_id: CREATOR_A, name: "Silver", price_cents: 500, trial_enabled: true }),
    tier({ id: "a-3", user_id: CREATOR_A, name: "Paused Bronze", price_cents: 300, is_active: "false" }),
    /* B: one free crown. */
    tier({ id: "b-1", user_id: CREATOR_B, name: "Open Gate", price_cents: 0 }),
    /* C: paused only — never lists. */
    tier({ id: "c-1", user_id: CREATOR_C, name: "Shut", price_cents: 100, is_active: "false" }),
    /* D: one paid crown, NO public profile. */
    tier({ id: "d-1", user_id: CREATOR_D, name: "Solo", price_cents: 2500 }),
  ];
  h.state.profiles = [
    { userId: CREATOR_A, displayName: "Queen A", slug: "queen-a", avatarUrl: "https://img/a.png" },
    { userId: CREATOR_B, displayName: "Bee", slug: "bee", avatarUrl: null },
  ];
});

describe("GET /memberships/directory", () => {
  it("lists every club with a live crown — and only those", async () => {
    const res = await fetch(`${baseUrl}/memberships/directory`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { clubs: Array<Record<string, unknown>>; testMode: boolean };
    expect(data.testMode).toBe(true);
    expect(data.clubs.map((c) => c["creatorUserId"])).toEqual([CREATOR_A, CREATOR_B, CREATOR_D]);
  });

  it("counts only live crowns toward the row, its starting price and its trial flag", async () => {
    const res = await fetch(`${baseUrl}/memberships/directory`);
    const data = (await res.json()) as { clubs: Array<Record<string, unknown>> };
    const a = data.clubs.find((c) => c["creatorUserId"] === CREATOR_A)!;
    expect(a["tierCount"]).toBe(2);
    expect(a["startingPriceCents"]).toBe(500);
    expect(a["startingPriceDollars"]).toBe(5);
    expect(a["hasTrial"]).toBe(true);
    const b = data.clubs.find((c) => c["creatorUserId"] === CREATOR_B)!;
    expect(b["tierCount"]).toBe(1);
    expect(b["startingPriceCents"]).toBe(0);
    expect(b["hasTrial"]).toBe(false);
  });

  it("carries the public profile's name/handle when one exists, null when it doesn't", async () => {
    const res = await fetch(`${baseUrl}/memberships/directory`);
    const data = (await res.json()) as { clubs: Array<Record<string, unknown>> };
    const a = data.clubs.find((c) => c["creatorUserId"] === CREATOR_A)!;
    expect(a["displayName"]).toBe("Queen A");
    expect(a["slug"]).toBe("queen-a");
    expect(a["avatarUrl"]).toBe("https://img/a.png");
    const d = data.clubs.find((c) => c["creatorUserId"] === CREATOR_D)!;
    expect(d["displayName"]).toBeNull();
    expect(d["slug"]).toBeNull();
    expect(d["avatarUrl"]).toBeNull();
  });

  it("is an empty list, not an error, when no club has a live crown", async () => {
    h.state.tiers = [tier({ id: "c-1", user_id: CREATOR_C, is_active: "false" })];
    const res = await fetch(`${baseUrl}/memberships/directory`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { clubs: unknown[] };
    expect(data.clubs).toEqual([]);
  });
});
