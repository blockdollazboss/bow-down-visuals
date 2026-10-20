/**
 * Route tests for membership MANAGEMENT (Stack-3 #26).
 *
 * Verify-first finding: the creator rail (tier CRUD, dashboard, member
 * tracking) and the fan read rail (GET /memberships/mine) already
 * existed, but two management verbs had no surface —
 *   1. pausing/unpublishing a tier: PUT /tiers/:id always accepted
 *      is_active and the public list + checkout honor it, yet no test
 *      pinned that behavior;
 *   2. a fan canceling their OWN membership: the only status rail was
 *      creator-scoped (PATCH /members/:id), so this stack added the
 *      fan-scoped POST /memberships/mine/:memberId/cancel.
 *
 * The REAL memberships router runs over an ephemeral server against a
 * cond-aware fake db, in the house style of dm-drafts.test.ts. The fake
 * is tuned to the routes under test (documented per branch below);
 * checkout/verify/ai-perks are mocked away or untested here.
 *
 * Pins:
 *  - a fan cancels their own active membership → 200, the row lands in
 *    the same end state the creator rail writes (status canceled +
 *    canceled_at set), and GET /mine reads it back canceled;
 *  - a fan can also cancel a trialing membership;
 *  - another fan's seat, the creator's view of a seat, and manual
 *    tracking rows (fan_user_id null) all read 404 on the fan door and
 *    stay untouched;
 *  - canceling an already-canceled or time-expired membership is a
 *    409, never a silent rewrite; guests get 401;
 *  - GET /mine carries joinedAt (the fan's "member since") + tierName;
 *  - tier pause: PUT is_active "false" hides the tier from the public
 *    join list, "true" brings it back, and a non-owner PUT is a 404
 *    that changes nothing.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const FAN = "22222222-2222-4222-8222-222222222222";
const OTHER_FAN = "33333333-3333-4333-8333-333333333333";
const TIER_ID = "44444444-4444-4444-8444-444444444444";
const M_ACTIVE = "55555555-5555-4555-8555-555555555555";
const M_TRIAL = "66666666-6666-4666-8666-666666666666";
const M_OTHER = "77777777-7777-4777-8777-777777777777";
const M_MANUAL = "88888888-8888-4888-8888-888888888888";
const M_EXPIRED = "99999999-9999-4999-8999-999999999999";
const JOINED = new Date("2026-08-15T12:00:00.000Z");

const h = vi.hoisted(() => ({
  state: {
    tiers: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    gifts: [] as Array<Record<string, unknown>>,
    seq: 0,
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
    req.userId = req.headers["x-user-id"] ?? FAN;
    req.userEmail = "fan@example.test";
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
  createPaymentCheckout: async () => { throw new Error("no checkout in management tests"); },
  retrieveCheckoutSession: async () => { throw new Error("no checkout in management tests"); },
  refundCheckoutSessionPayment: async () => false,
  checkoutBaseUrl: () => "http://localhost",
  isCheckoutTestMode: () => true,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { fanTiersTable, fanMembersTable, fanMembershipGiftsTable } = actual;

  function nextId(): string {
    state.seq += 1;
    return `aaaaaaaa-aaaa-4aaa-8aaa-${String(state.seq).padStart(12, "0")}`;
  }

  /* Condition shapes used by the routes under test:
       fanTiers   eq(id)                       → [tierId]        (findTierById)
                  eq(user_id)                  → [creatorId]     (GET /tiers)
                  and(eq(user_id), eq(active)) → [creatorId, x]  (public list)
       fanMembers and(eq(id), eq(fan_user_id)) → [memberId, fan] (cancel read)
                  eq(fan_user_id)              → [fan]           (GET /mine)
       gifts      eq(purchaser|recipient)      → [user]          (GET /mine)
     Single-param tier reads are told apart by value: a param that is a
     seeded tier id is an id lookup, anything else is a creator id. */
  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    if (cond === undefined || cond === null) {
      if (table === fanTiersTable) return state.tiers;
      if (table === fanMembersTable) return state.members;
      if (table === fanMembershipGiftsTable) return state.gifts;
      return [];
    }
    const { params } = render(cond);
    if (table === fanTiersTable) {
      if (params.length >= 2) {
        return state.tiers.filter(
          (t) => String(t["user_id"]) === String(params[0]) && String(t["is_active"]) === String(params[1]),
        );
      }
      const byId = state.tiers.filter((t) => String(t["id"]) === String(params[0]));
      if (byId.length > 0) return byId;
      return state.tiers.filter((t) => String(t["user_id"]) === String(params[0]));
    }
    if (table === fanMembersTable) {
      if (params.length >= 2) {
        return state.members.filter(
          (m) => String(m["id"]) === String(params[0]) && String(m["fan_user_id"]) === String(params[1]),
        );
      }
      return state.members.filter((m) => String(m["fan_user_id"]) === String(params[0]));
    }
    if (table === fanMembershipGiftsTable) {
      return state.gifts.filter(
        (g) => String(g["purchaser_user_id"]) === String(params[0]) || String(g["recipient_user_id"]) === String(params[0]),
      );
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

  function thenable(extra: Record<string, unknown> = {}): any {
    return { ...extra, then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const now = new Date();
        let full: Record<string, unknown>;
        if (table === fanTiersTable) {
          full = {
            id: nextId(), sort_order: 0, trial_enabled: false, annual_discount_pct: 0,
            is_active: "true", description: "", perks: [], created_at: now, updated_at: now, ...v,
          };
          state.tiers.push(full);
        } else if (table === fanMembersTable) {
          full = {
            id: nextId(), external_ref: null, stripe_session_id: null, settled_payout_id: null,
            settled_at: null, is_gift: false, gifted_by_user_id: null, trial_ends_at: null,
            current_period_start: null, current_period_end: null, canceled_at: null,
            joined_at: now, created_at: now, updated_at: now, ...v,
          };
          state.members.push(full);
        } else if (table === fanMembershipGiftsTable) {
          full = { id: nextId(), member_id: null, created_at: now, updated_at: now, ...v };
          state.gifts.push(full);
        } else {
          full = { id: nextId(), ...v };
        }
        return thenable({ returning: async () => [full] });
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const { params } = render(cond);
          let matched: Array<Record<string, unknown>> = [];
          if (table === fanTiersTable) {
            /* PUT /tiers/:id — and(eq(id), eq(user_id)). */
            matched = state.tiers.filter(
              (t) => String(t["id"]) === String(params[0]) && String(t["user_id"]) === String(params[1]),
            );
          } else if (table === fanMembersTable) {
            if (params.length >= 2) {
              matched = state.members.filter(
                (m) => String(m["id"]) === String(params[0]) && String(m["user_id"]) === String(params[1]),
              );
            } else {
              /* The fan-cancel write — eq(id) alone, after the fan-scoped read. */
              matched = state.members.filter((m) => String(m["id"]) === String(params[0]));
            }
          }
          for (const row of matched) Object.assign(row, patch);
          return thenable({ returning: async () => matched });
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const { params } = render(cond);
        const id = String(params[0]);
        let removed: Array<Record<string, unknown>> = [];
        if (table === fanTiersTable) {
          removed = state.tiers.filter((t) => String(t["id"]) === id);
          state.tiers = state.tiers.filter((t) => String(t["id"]) !== id);
        } else if (table === fanMembersTable) {
          removed = state.members.filter(
            (m) => String(m["id"]) === id || String(m["tier_id"]) === id,
          );
          state.members = state.members.filter(
            (m) => !(String(m["id"]) === id || String(m["tier_id"]) === id),
          );
        }
        return thenable({ returning: async () => removed });
      },
    }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import membershipsRouter from "../generate/memberships";

const realFetch = globalThis.fetch;
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

function tierRow(): Record<string, unknown> {
  const now = new Date();
  return {
    id: TIER_ID, user_id: CREATOR, name: "Gold Circle", price_cents: 1000,
    description: "The inner circle", perks: ["Early access"], sort_order: 0,
    trial_enabled: false, annual_discount_pct: 10, is_active: "true",
    created_at: now, updated_at: now,
  };
}

function memberRow(over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return {
    id: M_ACTIVE, user_id: CREATOR, tier_id: TIER_ID, fan_label: "fan@example.test",
    fan_user_id: FAN, status: "active", price_cents: 1000, external_ref: null,
    billing_period: "monthly", current_period_start: now, current_period_end: future,
    trial_ends_at: null, stripe_session_id: null, settled_payout_id: null, settled_at: null,
    is_gift: false, gifted_by_user_id: null, joined_at: JOINED, canceled_at: null,
    created_at: now, updated_at: now, ...over,
  };
}

beforeEach(() => {
  const s = h.state;
  const past = new Date(Date.now() - 24 * 3600 * 1000);
  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  s.tiers = [tierRow()];
  s.members = [
    memberRow({ id: M_ACTIVE }),
    memberRow({ id: M_TRIAL, status: "trialing", trial_ends_at: future, current_period_end: future }),
    memberRow({ id: M_OTHER, fan_user_id: OTHER_FAN, fan_label: "other@example.test" }),
    memberRow({ id: M_MANUAL, fan_user_id: null, fan_label: "imported@example.test" }),
    memberRow({ id: M_EXPIRED, current_period_start: past, current_period_end: past }),
  ];
  s.gifts = [];
  s.seq = 0;
});

async function req(
  method: string,
  path: string,
  opts: { userId?: string; anon?: boolean; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.anon) headers["x-anon"] = "1";
  else headers["x-user-id"] = opts.userId ?? FAN;
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /memberships/mine/:memberId/cancel — the fan's own door", () => {
  it("cancels the fan's own active membership and writes the standard end state", async () => {
    const { status, json } = await req("POST", `/memberships/mine/${M_ACTIVE}/cancel`);
    expect(status).toBe(200);
    expect(json.membership.id).toBe(M_ACTIVE);
    expect(json.membership.status).toBe("canceled");
    expect(json.membership.tierName).toBe("Gold Circle");
    const row = h.state.members.find((m) => m["id"] === M_ACTIVE)!;
    expect(row["status"]).toBe("canceled");
    expect(row["canceled_at"]).toBeInstanceOf(Date);
  });

  it("cancels a trialing membership too", async () => {
    const { status, json } = await req("POST", `/memberships/mine/${M_TRIAL}/cancel`);
    expect(status).toBe(200);
    expect(json.membership.status).toBe("canceled");
  });

  it("reads back canceled through GET /mine, with the member-since date", async () => {
    await req("POST", `/memberships/mine/${M_ACTIVE}/cancel`);
    const { status, json } = await req("GET", "/memberships/mine");
    expect(status).toBe(200);
    const mine = (json.memberships as any[]).find((m) => m.id === M_ACTIVE);
    expect(mine.status).toBe("canceled");
    expect(mine.tierName).toBe("Gold Circle");
    expect(mine.joinedAt).toBe(JOINED.toISOString());
  });

  it("404s on another fan's seat and changes nothing", async () => {
    const { status } = await req("POST", `/memberships/mine/${M_OTHER}/cancel`);
    expect(status).toBe(404);
    const row = h.state.members.find((m) => m["id"] === M_OTHER)!;
    expect(row["status"]).toBe("active");
    expect(row["canceled_at"]).toBeNull();
  });

  it("404s when the creator tries the fan door on a seat", async () => {
    const { status } = await req("POST", `/memberships/mine/${M_ACTIVE}/cancel`, { userId: CREATOR });
    expect(status).toBe(404);
    expect(h.state.members.find((m) => m["id"] === M_ACTIVE)!["status"]).toBe("active");
  });

  it("404s on manual tracking rows — they have no fan to cancel them", async () => {
    const { status } = await req("POST", `/memberships/mine/${M_MANUAL}/cancel`, { userId: CREATOR });
    expect(status).toBe(404);
    expect(h.state.members.find((m) => m["id"] === M_MANUAL)!["status"]).toBe("active");
  });

  it("409s on a membership whose period already ran out (effective expired)", async () => {
    const { status } = await req("POST", `/memberships/mine/${M_EXPIRED}/cancel`);
    expect(status).toBe(409);
    /* The stored row is never silently rewritten by a refused cancel. */
    expect(h.state.members.find((m) => m["id"] === M_EXPIRED)!["status"]).toBe("active");
  });

  it("409s on a second cancel — already ended", async () => {
    const first = await req("POST", `/memberships/mine/${M_ACTIVE}/cancel`);
    expect(first.status).toBe(200);
    const second = await req("POST", `/memberships/mine/${M_ACTIVE}/cancel`);
    expect(second.status).toBe(409);
  });

  it("401s for guests", async () => {
    const { status } = await req("POST", `/memberships/mine/${M_ACTIVE}/cancel`, { anon: true });
    expect(status).toBe(401);
  });
});

describe("Tier pause/unpublish — the is_active verb on PUT /tiers/:id", () => {
  it("pausing hides the tier from the public join list; resuming brings it back", async () => {
    const before = await req("GET", `/memberships/public/${CREATOR}`, { anon: true });
    expect(before.status).toBe(200);
    expect((before.json.tiers as any[]).map((t) => t.id)).toContain(TIER_ID);

    const paused = await req("PUT", `/memberships/tiers/${TIER_ID}`, {
      userId: CREATOR,
      body: { is_active: "false" },
    });
    expect(paused.status).toBe(200);
    expect(paused.json.tier.isActive).toBe(false);

    const during = await req("GET", `/memberships/public/${CREATOR}`, { anon: true });
    expect((during.json.tiers as any[]).map((t) => t.id)).not.toContain(TIER_ID);

    /* The creator's own list still shows the paused tier — it's
       unpublished, not deleted. */
    const own = await req("GET", "/memberships/tiers", { userId: CREATOR });
    expect((own.json.tiers as any[]).find((t) => t.id === TIER_ID)?.isActive).toBe(false);

    const resumed = await req("PUT", `/memberships/tiers/${TIER_ID}`, {
      userId: CREATOR,
      body: { is_active: "true" },
    });
    expect(resumed.status).toBe(200);
    expect(resumed.json.tier.isActive).toBe(true);
    const after = await req("GET", `/memberships/public/${CREATOR}`, { anon: true });
    expect((after.json.tiers as any[]).map((t) => t.id)).toContain(TIER_ID);
  });

  it("a non-owner cannot pause someone else's tier (404, nothing changes)", async () => {
    const { status } = await req("PUT", `/memberships/tiers/${TIER_ID}`, {
      userId: OTHER_FAN,
      body: { is_active: "false" },
    });
    expect(status).toBe(404);
    expect(h.state.tiers.find((t) => t["id"] === TIER_ID)!["is_active"]).toBe("true");
  });
});
