/**
 * Membership pause routes (wave-4 #39) on routes/generate/memberships.
 *
 * Pins:
 *  - POST /mine/:id/pause rests an active seat for 1–3 months: the
 *    stored status becomes "paused", paused_until is the resume date
 *    stated in the response, and /mine reads the seat back as paused
 *    with that same date (access asleep everywhere — the gates' own
 *    honoring is pinned in lib/__tests__/membership-pause.test.ts);
 *  - pause refuses honestly: months outside 1–3 (400), another fan's
 *    seat (404), guests (401), a past-due seat (409 — dunning's door,
 *    never entangled), a trialing seat (409), an already-paused seat
 *    (409), and a tier whose creator disabled the offer (403);
 *  - POST /mine/:id/resume is one tap back: the period end shifts by
 *    exactly the time rested (the billing skip — no paid time burns),
 *    the pause window clears, and the seat reads active;
 *  - a seat whose stated resume date already passed reads ACTIVE in
 *    /mine (auto-resume at read time, stored row untouched), and a
 *    resume tap on it performs the same capped shift as a write;
 *  - a seat whose shifted period also ran out gets an honest 409 on
 *    resume — rejoining is the door, not a fake extension;
 *  - the creator Recovery (dunning) list never includes a paused
 *    member: the chase works past_due only.
 *
 * Harness: the real router over an ephemeral server against a
 * cond-aware fake db, house style of memberships-dunning.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const FAN = "22222222-2222-4222-8222-222222222222";
const OTHER_FAN = "33333333-3333-4333-8333-333333333333";
const TIER_ID = "44444444-4444-4444-8444-444444444444";
const NOPAUSE_TIER_ID = "45454545-4545-4454-8454-454545454545";
const M_ACTIVE = "55555555-5555-4555-8555-555555555555";
const M_PASTDUE = "66666666-6666-4666-8666-666666666666";
const M_TRIAL = "77777777-7777-4777-8777-777777777777";
const M_NOPAUSE = "88888888-8888-4888-8888-888888888888";
const M_RESTING = "99999999-9999-4999-8999-999999999999";
const M_AUTO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M_SPENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = 24 * 3600 * 1000;

const h = vi.hoisted(() => ({
  state: {
    tiers: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    gifts: [] as Array<Record<string, unknown>>,
    lists: [] as Array<Record<string, unknown>>,
    automations: [] as Array<Record<string, unknown>>,
    sends: [] as Array<Record<string, unknown>>,
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
  createPaymentCheckout: async () => { throw new Error("no checkout in pause tests"); },
  retrieveCheckoutSession: async () => { throw new Error("no verify in pause tests"); },
  refundCheckoutSessionPayment: async () => false,
  checkoutBaseUrl: () => "http://localhost",
  isCheckoutTestMode: () => true,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    fanTiersTable, fanMembersTable, fanMembershipGiftsTable,
    emailListsTable, emailAutomationsTable, emailAutomationSendsTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    if (cond === undefined || cond === null) return [];
    const { params } = render(cond);
    if (table === fanTiersTable) {
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
      if (String(params[0]) === CREATOR) {
        return state.members.filter((m) => String(m["user_id"]) === String(params[0]));
      }
      return state.members.filter((m) => String(m["fan_user_id"]) === String(params[0]));
    }
    if (table === fanMembershipGiftsTable) {
      return state.gifts.filter(
        (g) => String(g["purchaser_user_id"]) === String(params[0]) || String(g["recipient_user_id"]) === String(params[0]),
      );
    }
    if (table === emailListsTable) {
      return state.lists.filter((l) => String(l["userId"]) === String(params[0]));
    }
    if (table === emailAutomationsTable) {
      return state.automations.filter((a) => params.map(String).includes(String(a["listId"])));
    }
    if (table === emailAutomationSendsTable) {
      return state.sends.filter((s) => params.map(String).includes(String(s["automationId"])));
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
    insert: (_table: unknown) => ({
      values: () => thenable({ returning: async () => [] }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const { params } = render(cond);
          let matched: Array<Record<string, unknown>> = [];
          if (table === fanMembersTable) {
            matched = state.members.filter((m) => String(m["id"]) === String(params[0]));
          }
          for (const row of matched) Object.assign(row, patch);
          return thenable({ returning: async () => matched });
        },
      }),
    }),
    delete: (_table: unknown) => ({ where: () => thenable({ returning: async () => [] }) }),
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

function tierRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    id: TIER_ID, user_id: CREATOR, name: "Gold Circle", price_cents: 1000,
    description: "", perks: [], sort_order: 0, trial_enabled: false,
    annual_discount_pct: 0, pause_enabled: true, is_active: "true",
    created_at: now, updated_at: now, ...over,
  };
}

function memberRow(over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    id: M_ACTIVE, user_id: CREATOR, tier_id: TIER_ID, fan_label: "fan@example.test",
    fan_user_id: FAN, status: "active", price_cents: 1000, external_ref: null,
    billing_period: "monthly", current_period_start: new Date(now.getTime() - 5 * DAY),
    current_period_end: new Date(now.getTime() + 25 * DAY),
    trial_ends_at: null, stripe_session_id: null, settled_payout_id: null, settled_at: null,
    is_gift: false, gifted_by_user_id: null, joined_at: now, canceled_at: null,
    paused_at: null, paused_until: null,
    created_at: now, updated_at: now, ...over,
  };
}

beforeEach(() => {
  const s = h.state;
  const now = Date.now();
  s.tiers = [
    tierRow(),
    tierRow({ id: NOPAUSE_TIER_ID, name: "No Rest Tier", pause_enabled: false }),
  ];
  s.members = [
    memberRow({ id: M_ACTIVE }),
    memberRow({ id: M_PASTDUE, status: "past_due", updated_at: new Date(now - 2 * DAY) }),
    memberRow({
      id: M_TRIAL, status: "trialing",
      trial_ends_at: new Date(now + 5 * DAY), current_period_end: new Date(now + 5 * DAY),
    }),
    memberRow({ id: M_NOPAUSE, tier_id: NOPAUSE_TIER_ID }),
    /* Resting: paused 10 days ago for ~2 months; 20 days of period left. */
    memberRow({
      id: M_RESTING, status: "paused",
      paused_at: new Date(now - 10 * DAY), paused_until: new Date(now + 50 * DAY),
      current_period_start: new Date(now - 20 * DAY), current_period_end: new Date(now + 20 * DAY),
    }),
    /* Auto-resume: the stated date passed 10 days ago; stored period
       end was +80d from the pause start, so the seat is live again. */
    memberRow({
      id: M_AUTO, status: "paused",
      paused_at: new Date(now - 40 * DAY), paused_until: new Date(now - 10 * DAY),
      current_period_start: new Date(now - 50 * DAY), current_period_end: new Date(now + 40 * DAY),
    }),
    /* Spent: paused 40 days ago for 1 month, but only 10 days of paid
       period remained — pause + shifted period are both over. */
    memberRow({
      id: M_SPENT, status: "paused",
      paused_at: new Date(now - 40 * DAY), paused_until: new Date(now - 10 * DAY),
      current_period_start: new Date(now - 70 * DAY), current_period_end: new Date(now - 30 * DAY),
    }),
  ];
  s.gifts = [];
  s.lists = [];
  s.automations = [];
  s.sends = [];
});

async function req(method: string, path: string, opts: { userId?: string; anon?: boolean; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.anon) headers["x-anon"] = "1";
  else headers["x-user-id"] = opts.userId ?? FAN;
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const row = (id: string) => h.state.members.find((m) => m["id"] === id)!;

describe("POST /memberships/mine/:id/pause — rest instead of cancelling", () => {
  it("pauses an active seat and states the resume date the row stores", async () => {
    const before = Date.now();
    const r = await req("POST", `/memberships/mine/${M_ACTIVE}/pause`, { body: { months: 2 } });
    expect(r.status).toBe(200);
    expect(r.json.months).toBe(2);
    expect(r.json.membership.status).toBe("paused");
    const stored = row(M_ACTIVE);
    expect(stored["status"]).toBe("paused");
    /* The stated date IS the stored date — the promise and the row agree. */
    expect(r.json.resumesAt).toBe(new Date(stored["paused_until"] as string).toISOString());
    expect(r.json.membership.pauseResumesAt).toBe(r.json.resumesAt);
    const resumesMs = new Date(r.json.resumesAt).getTime();
    expect(resumesMs).toBeGreaterThan(before + 55 * DAY);
    expect(resumesMs).toBeLessThan(Date.now() + 65 * DAY);
    /* No period time burned by the pause write itself. */
    expect(new Date(stored["current_period_end"] as string).getTime()).toBeGreaterThan(Date.now() + 24 * DAY);
  });

  it("/mine reads the seat back as paused with the resume date + shifted period end", async () => {
    const r = await req("GET", "/memberships/mine");
    const m = r.json.memberships.find((x: any) => x.id === M_RESTING);
    expect(m.status).toBe("paused");
    expect(m.storedStatus).toBe("paused");
    expect(m.pauseOffered).toBe(true);
    expect(new Date(m.pauseResumesAt).getTime()).toBe(new Date(row(M_RESTING)["paused_until"] as string).getTime());
    /* Resuming on the stated date lands the period 60 days past the stored end. */
    const shifted = new Date(m.pauseNewPeriodEnd).getTime() - new Date(row(M_RESTING)["current_period_end"] as string).getTime();
    expect(shifted).toBe(60 * DAY);
  });

  it("refuses months outside 1–3 with a 400 and writes nothing", async () => {
    for (const months of [0, 4, 2.5, "2"]) {
      const r = await req("POST", `/memberships/mine/${M_ACTIVE}/pause`, { body: { months } });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("INVALID_PAUSE_MONTHS");
    }
    expect(row(M_ACTIVE)["status"]).toBe("active");
  });

  it("404s another fan's seat, 401s guests", async () => {
    expect((await req("POST", `/memberships/mine/${M_ACTIVE}/pause`, { userId: OTHER_FAN, body: { months: 1 } })).status).toBe(404);
    expect((await req("POST", `/memberships/mine/${M_ACTIVE}/pause`, { anon: true, body: { months: 1 } })).status).toBe(401);
    expect(row(M_ACTIVE)["status"]).toBe("active");
  });

  it("a past-due seat cannot pause — its rescue is dunning's card door, never entangled", async () => {
    const r = await req("POST", `/memberships/mine/${M_PASTDUE}/pause`, { body: { months: 1 } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("NOT_PAUSABLE");
    expect(r.json.message).toContain("failed payment");
    expect(row(M_PASTDUE)["status"]).toBe("past_due"); /* still dunning's, untouched */
  });

  it("a trialing seat and an already-paused seat both 409", async () => {
    expect((await req("POST", `/memberships/mine/${M_TRIAL}/pause`, { body: { months: 1 } })).status).toBe(409);
    const r = await req("POST", `/memberships/mine/${M_RESTING}/pause`, { body: { months: 1 } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("ALREADY_PAUSED");
  });

  it("a creator-disabled tier answers 403 PAUSE_NOT_OFFERED", async () => {
    const r = await req("POST", `/memberships/mine/${M_NOPAUSE}/pause`, { body: { months: 1 } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("PAUSE_NOT_OFFERED");
    expect(row(M_NOPAUSE)["status"]).toBe("active");
  });
});

describe("POST /memberships/mine/:id/resume — one tap back, no paid time burned", () => {
  it("resumes a resting seat: period end shifts by exactly the time rested", async () => {
    const oldEnd = new Date(row(M_RESTING)["current_period_end"] as string).getTime();
    const r = await req("POST", `/memberships/mine/${M_RESTING}/resume`);
    expect(r.status).toBe(200);
    expect(r.json.membership.status).toBe("active");
    const stored = row(M_RESTING);
    expect(stored["status"]).toBe("active");
    expect(stored["paused_at"]).toBeNull();
    expect(stored["paused_until"]).toBeNull();
    const shift = new Date(stored["current_period_end"] as string).getTime() - oldEnd;
    expect(shift).toBeGreaterThan(10 * DAY - 60_000);
    expect(shift).toBeLessThan(10 * DAY + 60_000);
  });

  it("409s a seat that isn't paused, 404s another fan's seat", async () => {
    expect((await req("POST", `/memberships/mine/${M_ACTIVE}/resume`)).status).toBe(409);
    expect((await req("POST", `/memberships/mine/${M_RESTING}/resume`, { userId: OTHER_FAN })).status).toBe(404);
  });

  it("an auto-resumed seat (date passed) performs the same capped shift as a write", async () => {
    const oldEnd = new Date(row(M_AUTO)["current_period_end"] as string).getTime();
    const r = await req("POST", `/memberships/mine/${M_AUTO}/resume`);
    expect(r.status).toBe(200);
    const shift = new Date(row(M_AUTO)["current_period_end"] as string).getTime() - oldEnd;
    /* Full planned pause (30 days), NOT the 40 days since it began. */
    expect(shift).toBe(30 * DAY);
  });

  it("a seat whose shifted period also ended gets an honest 409, not a fake extension", async () => {
    const r = await req("POST", `/memberships/mine/${M_SPENT}/resume`);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("PAUSE_PERIOD_ENDED");
    expect(row(M_SPENT)["status"]).toBe("paused"); /* nothing was written */
  });
});

describe("read-time truth + dunning separation", () => {
  it("/mine auto-resumes a seat whose stated date passed — stored row untouched", async () => {
    const r = await req("GET", "/memberships/mine");
    const auto = r.json.memberships.find((x: any) => x.id === M_AUTO);
    expect(auto.status).toBe("active");
    expect(auto.storedStatus).toBe("paused");
    const spent = r.json.memberships.find((x: any) => x.id === M_SPENT);
    expect(spent.status).toBe("expired");
  });

  it("the creator Recovery (dunning) list never includes a paused member", async () => {
    const r = await req("GET", "/memberships/recovery", { userId: CREATOR });
    expect(r.status).toBe(200);
    const ids = r.json.members.map((x: any) => x.member.id);
    expect(ids).toContain(M_PASTDUE); /* the chase's real subject */
    expect(ids).not.toContain(M_RESTING);
    expect(ids).not.toContain(M_AUTO);
    expect(ids).not.toContain(M_SPENT);
  });

  it("a paused seat can still be cancelled by its fan — and the pause window clears", async () => {
    const r = await req("POST", `/memberships/mine/${M_RESTING}/cancel`);
    expect(r.status).toBe(200);
    expect(r.json.membership.status).toBe("canceled");
    expect(row(M_RESTING)["paused_at"]).toBeNull();
    expect(row(M_RESTING)["paused_until"]).toBeNull();
  });
});
