/**
 * Dunning routes (Stack-100 #3, #21) — the fan's update-payment door
 * and the creator's Recovery view on routes/generate/memberships.
 *
 * Pins:
 *  - GET /mine tells a past-due fan the truth BEFORE anything ends:
 *    when the payment failed, the exact date access pauses, and the
 *    days left — and once the 7-day grace has run out unpaid, the seat
 *    reads expired (stored status untouched);
 *  - POST /mine/:id/update-payment is fan-scoped (404 for anyone
 *    else's seat), refuses seats that aren't past due (409), and for
 *    a paid tier returns a Stripe-hosted checkout built exactly like
 *    a join checkout (same metadata + locked amount) WITHOUT marking
 *    anything paid — activation still belongs to /verify alone;
 *  - a free tier has no payment to fix: the door reactivates it
 *    directly with a fresh period;
 *  - GET /memberships/recovery is creator-scoped and joins the claim
 *    ledger honestly: steps actually sent (never assumed), the grace
 *    end the fan was told, in_grace vs access_ended, and whether the
 *    recovery automation is actually switched on.
 *
 * Harness: the real router over an ephemeral server against a
 * cond-aware fake db, house style of memberships-management.test.ts.
 * Stripe checkout is a recording stub.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const OTHER_CREATOR = "99999999-9999-4999-8999-999999999999";
const FAN = "22222222-2222-4222-8222-222222222222";
const OTHER_FAN = "33333333-3333-4333-8333-333333333333";
const TIER_ID = "44444444-4444-4444-8444-444444444444";
const FREE_TIER_ID = "45454545-4545-4454-8454-454545454545";
const M_PASTDUE = "55555555-5555-4555-8555-555555555555";
const M_OLD = "66666666-6666-4666-8666-666666666666";
const M_ACTIVE = "77777777-7777-4777-8777-777777777777";
const M_FREE = "88888888-8888-4888-8888-888888888888";
const M_FOREIGN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DAY = 24 * 3600 * 1000;

const h = vi.hoisted(() => ({
  state: {
    tiers: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    gifts: [] as Array<Record<string, unknown>>,
    lists: [] as Array<Record<string, unknown>>,
    automations: [] as Array<Record<string, unknown>>,
    sends: [] as Array<Record<string, unknown>>,
    checkouts: [] as Array<Record<string, unknown>>,
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
  createPaymentCheckout: async (input: Record<string, unknown>) => {
    h.state.checkouts.push(input);
    return { sessionId: "cs_test_dunning", url: "https://checkout.stripe.test/pay/cs_test_dunning" };
  },
  retrieveCheckoutSession: async () => { throw new Error("no verify in dunning tests"); },
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
      /* Single param: CREATOR/OTHER_CREATOR reads are creator-scoped
         (user_id); fan reads are fan-scoped (fan_user_id). */
      if (String(params[0]) === CREATOR || String(params[0]) === OTHER_CREATOR) {
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
    annual_discount_pct: 0, is_active: "true", created_at: now, updated_at: now, ...over,
  };
}

function memberRow(over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    id: M_ACTIVE, user_id: CREATOR, tier_id: TIER_ID, fan_label: "fan@example.test",
    fan_user_id: FAN, status: "active", price_cents: 1000, external_ref: null,
    billing_period: "monthly", current_period_start: now, current_period_end: new Date(now.getTime() + 30 * DAY),
    trial_ends_at: null, stripe_session_id: null, settled_payout_id: null, settled_at: null,
    is_gift: false, gifted_by_user_id: null, joined_at: now, canceled_at: null,
    created_at: now, updated_at: now, ...over,
  };
}

let pastDueAt: Date;

beforeEach(() => {
  const s = h.state;
  const now = Date.now();
  pastDueAt = new Date(now - 2 * DAY);
  s.tiers = [
    tierRow(),
    tierRow({ id: FREE_TIER_ID, name: "Free Club", price_cents: 0 }),
  ];
  s.members = [
    memberRow({ id: M_PASTDUE, status: "past_due", updated_at: pastDueAt }),
    memberRow({ id: M_OLD, status: "past_due", updated_at: new Date(now - 10 * DAY) }),
    memberRow({ id: M_ACTIVE }),
    memberRow({ id: M_FREE, tier_id: FREE_TIER_ID, status: "past_due", price_cents: 0, updated_at: pastDueAt }),
    memberRow({ id: M_FOREIGN, user_id: OTHER_CREATOR, fan_user_id: OTHER_FAN, status: "past_due", updated_at: pastDueAt }),
  ];
  s.gifts = [];
  s.lists = [{ id: LIST_ID, userId: CREATOR, name: "Main list", handle: "main-list" }];
  s.automations = [{
    id: AUTO_ID, listId: LIST_ID, kind: "membership_payment_recovery", enabled: true,
    subject: "s", body: "b", delayHours: 0, enabledAt: new Date(now - 30 * DAY), lastRunAt: null,
    campaignId: null, createdAt: new Date(now - 30 * DAY), updatedAt: new Date(now - 30 * DAY),
  }];
  const episode = `member:${M_PASTDUE}:past_due:${pastDueAt.toISOString()}`;
  s.sends = [
    { id: "s1", automationId: AUTO_ID, subscriberId: "sub1", deliveryId: null, triggerKind: "membership_payment_recovery", triggerRef: `${episode}:payment_failed_notice`, recipientEmail: "fan@example.test", status: "sent", sentAt: pastDueAt, createdAt: pastDueAt },
    { id: "s2", automationId: AUTO_ID, subscriberId: "sub1", deliveryId: null, triggerKind: "membership_payment_recovery", triggerRef: `${episode}:payment_reminder`, recipientEmail: "fan@example.test", status: "sent", sentAt: new Date(now - DAY), createdAt: new Date(now - DAY) },
    { id: "s3", automationId: AUTO_ID, subscriberId: "sub1", deliveryId: null, triggerKind: "membership_payment_recovery", triggerRef: `${episode}:card_update_nudge`, recipientEmail: "fan@example.test", status: "no_provider", sentAt: null, createdAt: new Date(now - DAY) },
  ];
  s.checkouts = [];
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

describe("GET /memberships/mine — the fan hears it before access ends", () => {
  it("a past-due seat carries since / access-ends / days-left, still reading past_due in grace", async () => {
    const r = await req("GET", "/memberships/mine");
    expect(r.status).toBe(200);
    const m = r.json.memberships.find((x: any) => x.id === M_PASTDUE);
    expect(m.status).toBe("past_due");
    expect(m.pastDueSince).toBe(pastDueAt.toISOString());
    expect(m.accessEndsAt).toBe(new Date(pastDueAt.getTime() + 7 * DAY).toISOString());
    expect(m.pastDueDaysLeft).toBe(5);
  });

  it("a seat unpaid past grace reads expired — stored row untouched", async () => {
    const r = await req("GET", "/memberships/mine");
    const m = r.json.memberships.find((x: any) => x.id === M_OLD);
    expect(m.status).toBe("expired");
    expect(m.storedStatus).toBe("past_due");
    expect(h.state.members.find((x) => x["id"] === M_OLD)?.["status"]).toBe("past_due");
  });
});

describe("POST /memberships/mine/:id/update-payment — the fan's card-update door", () => {
  it("returns a Stripe-hosted checkout shaped like a join, and marks NOTHING paid", async () => {
    const r = await req("POST", `/memberships/mine/${M_PASTDUE}/update-payment`);
    expect(r.status).toBe(200);
    expect(r.json.url).toContain("checkout.stripe.test");
    expect(r.json.amountCents).toBe(1000);
    expect(h.state.checkouts).toHaveLength(1);
    const input = h.state.checkouts[0] as any;
    expect(input.metadata.purchase_kind).toBe("membership");
    expect(input.metadata.tier_id).toBe(TIER_ID);
    expect(input.metadata.fan_user_id).toBe(FAN);
    expect(input.metadata.purchaser_user_id).toBe(FAN);
    expect(input.metadata.amount_cents).toBe("1000");
    /* The seat is still past_due — only /verify after a real payment reactivates. */
    expect(h.state.members.find((x) => x["id"] === M_PASTDUE)?.["status"]).toBe("past_due");
  });

  it("409s a seat that isn't past due, 404s another fan's seat, 401s guests", async () => {
    expect((await req("POST", `/memberships/mine/${M_ACTIVE}/update-payment`)).status).toBe(409);
    expect((await req("POST", `/memberships/mine/${M_FOREIGN}/update-payment`)).status).toBe(404);
    expect((await req("POST", `/memberships/mine/${M_PASTDUE}/update-payment`, { anon: true })).status).toBe(401);
    expect(h.state.checkouts).toHaveLength(0);
  });

  it("a free tier reactivates directly with a fresh period — no checkout invented", async () => {
    const r = await req("POST", `/memberships/mine/${M_FREE}/update-payment`);
    expect(r.status).toBe(200);
    expect(r.json.free).toBe(true);
    expect(r.json.membership.status).toBe("active");
    expect(h.state.checkouts).toHaveLength(0);
    const row = h.state.members.find((x) => x["id"] === M_FREE)!;
    expect(row["status"]).toBe("active");
    expect(new Date(row["current_period_end"] as string).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GET /memberships/recovery — the creator's worklist", () => {
  it("shows the chase honestly: steps sent from the ledger, grace end, automation on", async () => {
    const r = await req("GET", "/memberships/recovery", { userId: CREATOR });
    expect(r.status).toBe(200);
    expect(r.json.automationEnabled).toBe(true);
    const ids = r.json.members.map((x: any) => x.member.id);
    expect(ids).toContain(M_PASTDUE);
    expect(ids).toContain(M_OLD);
    expect(ids).not.toContain(M_FOREIGN); /* another creator's member */
    expect(ids).not.toContain(M_ACTIVE); /* never past due, never chased */

    const live = r.json.members.find((x: any) => x.member.id === M_PASTDUE);
    expect(live.recovery.state).toBe("in_grace");
    expect(live.recovery.stepsSent).toBe(2); /* the no_provider step is NOT counted as sent */
    expect(live.recovery.lastStepKey).toBe("payment_reminder");
    expect(live.recovery.graceEndsAt).toBe(new Date(pastDueAt.getTime() + 7 * DAY).toISOString());

    const old = r.json.members.find((x: any) => x.member.id === M_OLD);
    expect(old.recovery.state).toBe("access_ended");
    expect(old.recovery.stepsSent).toBe(0);
  });

  it("reports automationEnabled false when the creator never switched it on", async () => {
    h.state.automations = [];
    h.state.sends = [];
    const r = await req("GET", "/memberships/recovery", { userId: CREATOR });
    expect(r.status).toBe(200);
    expect(r.json.automationEnabled).toBe(false);
    expect(r.json.automationProvisioned).toBe(false);
    /* The past-due members still show — the worklist exists whether
       or not the chase is running. */
    expect(r.json.members.map((x: any) => x.member.id)).toContain(M_PASTDUE);
  });
});
