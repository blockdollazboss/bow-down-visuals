/**
 * Performance-booking escrow ABANDONED-CHECKOUT RE-FUND
 * (stack1400 item 5).
 *
 * The bug: a promoter who opened the funding Checkout and walked
 * away left the booking in 'funding' forever — every re-fund was
 * refused ("already funding") and the session's expiry freed
 * nothing.
 *
 * The fix pinned here (mirror of the sponsor escrow rail):
 *  - classifyPerformanceEscrowCheckoutSession: expired / open /
 *    paid / pending.
 *  - freePerformanceEscrowFundingForSession (the webhook's door):
 *    a guarded flip that only lands for the exact stored session
 *    id — replays and stale expiries change nothing; a funded
 *    booking can never be freed.
 *  - POST /fund lazily reconciles a 'funding' row against Stripe:
 *    expired → freed + a FRESH session under a superseded-scoped
 *    idempotency key; open → the SAME session handed back (resume,
 *    zero new sessions, so no double charge); paid → 409 (webhook
 *    owns settlement); unverifiable → 503 with no state change.
 *
 * Harness mirrors performance-bookings-embedded-fund.test.ts
 * (pg-mem via createTestDb; guarded Stripe client faked at
 * lib/stripe-client with a session store tests can expire / pay).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  sessions: new Map<string, any>(),
  sessionSeq: 0,
  createCalls: [] as Array<{ params: any; options: any }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn(async (params: any, options: any) => {
            h.sessionSeq += 1;
            const id = `cs_test_${h.sessionSeq}`;
            const embedded = params.ui_mode === "embedded_page";
            const session = {
              id,
              url: embedded ? null : "https://checkout.example.com/pay",
              client_secret: embedded ? `${id}_secret` : null,
              status: "open",
              payment_status: "unpaid",
              payment_intent: `pi_test_${h.sessionSeq}`,
              metadata: params.metadata ?? {},
            };
            h.sessions.set(id, session);
            h.createCalls.push({ params, options });
            return session;
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = h.sessions.get(id);
            if (!s) throw new Error("No such checkout session");
            return s;
          }),
        },
      },
      charges: { list: vi.fn(async () => ({ data: [] })) },
      refunds: { create: vi.fn(async () => ({ id: "re_test_fake", status: "succeeded" })) },
    })),
  };
});

import performanceBookingsRouter, {
  classifyPerformanceEscrowCheckoutSession,
  freePerformanceEscrowFundingForSession,
} from "../performance-bookings";
import { buildPerformanceEscrowCheckoutKey } from "../../lib/performance-bookings";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE performance_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  artist_user_id text NOT NULL,
  artist_name text NOT NULL,
  promoter_user_id text NOT NULL,
  promoter_name text NOT NULL,
  event_title text NOT NULL,
  event_date timestamptz NOT NULL,
  venue_name text NOT NULL,
  venue_address text NOT NULL,
  venue_city text NOT NULL,
  fee_cents integer NOT NULL,
  terms jsonb NOT NULL,
  plain_words text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'proposed',
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  stripe_payment_intent_id text,
  platform_fee_cents integer,
  artist_payout_cents integer,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const ARTIST = randomUUID();
const PROMOTER = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", performanceBookingsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = PROMOTER;
  h.sessions = new Map();
  h.sessionSeq = 0;
  h.createCalls = [];
  delete process.env["EMBEDDED_CHECKOUT"];
  await h.db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name)
    VALUES (${PROFILE_ID}, ${ARTIST}, 'thy-cheat-code', 'Thy Cheat Code')
  `);
});
afterEach(() => {
  delete process.env["STRIPE_SECRET_KEY"];
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();

/** Propose as promoter, accept as artist — ready to fund at $250.00. */
async function acceptedBooking() {
  h.userId = PROMOTER;
  const created = await req("POST", "/performance-bookings", {
    profileId: PROFILE_ID,
    promoterName: "Harbor Lights Venue",
    eventTitle: "Harbor Nights Live",
    eventDate: FUTURE,
    venueName: "The Harbor Room",
    venueAddress: "12 Pier Street",
    venueCity: "Norfolk",
    feeCents: 250_00,
    terms: { performance: "a 45-minute headline set", setLengthMin: 45 },
  });
  expect(created.status).toBe(201);
  const id = created.json.booking.id as string;
  h.userId = ARTIST;
  await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" });
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  h.userId = PROMOTER;
  return id;
}

async function bookingRow(id: string) {
  const rows = await h.db.execute(sql`SELECT escrow_status, stripe_session_id FROM performance_bookings WHERE id = ${id}`);
  return (rows.rows as any[])[0];
}

/** Drive a booking into 'funding' with a live (open) session. */
async function fundOnce(id: string) {
  const first = await req("POST", `/performance-bookings/${id}/fund`, {});
  expect(first.status).toBe(200);
  return first.json.sessionId as string;
}

describe("classifyPerformanceEscrowCheckoutSession", () => {
  it("reads Stripe session states honestly", () => {
    expect(classifyPerformanceEscrowCheckoutSession({ status: "expired", payment_status: "unpaid" })).toBe("expired");
    expect(classifyPerformanceEscrowCheckoutSession({ status: "open", payment_status: "unpaid" })).toBe("open");
    expect(classifyPerformanceEscrowCheckoutSession({ status: "complete", payment_status: "paid" })).toBe("paid");
    expect(classifyPerformanceEscrowCheckoutSession({ status: "complete", payment_status: "unpaid" })).toBe("pending");
    expect(classifyPerformanceEscrowCheckoutSession({ status: null, payment_status: null })).toBe("pending");
  });
});

describe("buildPerformanceEscrowCheckoutKey — superseded sessions", () => {
  it("first-attempt keys are unchanged; a supersede gets its own deterministic key", () => {
    const base = { promoterUserId: PROMOTER, bookingId: randomUUID(), feeCents: 25000 };
    const first = buildPerformanceEscrowCheckoutKey(base);
    expect(buildPerformanceEscrowCheckoutKey({ ...base, supersededSessionId: null })).toBe(first);
    const superseding = buildPerformanceEscrowCheckoutKey({ ...base, supersededSessionId: "cs_dead_1" });
    expect(superseding).not.toBe(first);
    expect(buildPerformanceEscrowCheckoutKey({ ...base, supersededSessionId: "cs_dead_1" })).toBe(superseding);
    expect(buildPerformanceEscrowCheckoutKey({ ...base, supersededSessionId: "cs_dead_2" })).not.toBe(superseding);
  });
});

describe("freePerformanceEscrowFundingForSession (the webhook door)", () => {
  it("frees a funding booking for its exact dead session — once; replays and stale ids change nothing", async () => {
    const id = await acceptedBooking();
    const sessionId = await fundOnce(id);

    expect(await freePerformanceEscrowFundingForSession(id, "cs_someone_else")).toBe(false);
    expect((await bookingRow(id)).escrow_status).toBe("funding");

    expect(await freePerformanceEscrowFundingForSession(id, sessionId)).toBe(true);
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("unfunded");
    expect(row.stripe_session_id).toBeNull();

    /* Webhook replay: idempotent no-op. */
    expect(await freePerformanceEscrowFundingForSession(id, sessionId)).toBe(false);
    expect((await bookingRow(id)).escrow_status).toBe("unfunded");
  });

  it("can never free a funded booking", async () => {
    const id = await acceptedBooking();
    const sessionId = await fundOnce(id);
    await h.db.execute(sql`UPDATE performance_bookings SET escrow_status = 'funded', status = 'funded' WHERE id = ${id}`);
    expect(await freePerformanceEscrowFundingForSession(id, sessionId)).toBe(false);
    expect((await bookingRow(id)).escrow_status).toBe("funded");
  });
});

describe("POST /fund — re-fund reconciliation", () => {
  it("expired session: frees the booking and mints a FRESH session under a new key", async () => {
    const id = await acceptedBooking();
    const deadId = await fundOnce(id);
    const firstKey = h.createCalls[0]!.options.idempotencyKey;
    h.sessions.get(deadId).status = "expired";

    const second = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(second.status).toBe(200);
    expect(second.json.sessionId).not.toBe(deadId);
    expect(h.createCalls).toHaveLength(2);
    const newKey = h.createCalls[1]!.options.idempotencyKey;
    expect(newKey).not.toBe(firstKey);
    expect(newKey).toBe(
      buildPerformanceEscrowCheckoutKey({
        promoterUserId: PROMOTER,
        bookingId: id,
        feeCents: 25000,
        requestParams: h.createCalls[1]!.params,
        supersededSessionId: deadId,
      }),
    );
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe(second.json.sessionId);
  });

  it("a second expiry frees again — the booking is never stranded twice", async () => {
    const id = await acceptedBooking();
    const first = await fundOnce(id);
    h.sessions.get(first).status = "expired";
    const second = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(second.status).toBe(200);
    h.sessions.get(second.json.sessionId).status = "expired";
    const third = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(third.status).toBe(200);
    expect(third.json.sessionId).not.toBe(second.json.sessionId);
    expect(h.createCalls).toHaveLength(3);
    const keys = h.createCalls.map((c) => c.options.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
  });

  it("still-open session: hands back the SAME session and creates nothing (no double charge)", async () => {
    const id = await acceptedBooking();
    const liveId = await fundOnce(id);
    const again = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(again.status).toBe(200);
    expect(again.json.resumed).toBe(true);
    expect(again.json.sessionId).toBe(liveId);
    expect(again.json.checkoutUrl).toBe("https://checkout.example.com/pay");
    expect(h.createCalls).toHaveLength(1);
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe(liveId);
  });

  it("already-paid session: refuses and creates nothing — settlement stays webhook-owned", async () => {
    const id = await acceptedBooking();
    const paidId = await fundOnce(id);
    const s = h.sessions.get(paidId);
    s.status = "complete";
    s.payment_status = "paid";
    const again = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(again.status).toBe(409);
    expect(h.createCalls).toHaveLength(1);
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe(paidId);
  });

  it("complete-but-unpaid session: fails closed (409), creates nothing, changes nothing", async () => {
    const id = await acceptedBooking();
    const pendingId = await fundOnce(id);
    const s = h.sessions.get(pendingId);
    s.status = "complete";
    s.payment_status = "unpaid";
    const again = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(again.status).toBe(409);
    expect(h.createCalls).toHaveLength(1);
    expect((await bookingRow(id)).stripe_session_id).toBe(pendingId);
  });

  it("unverifiable session (Stripe retrieve fails): 503, creates nothing, booking stays in funding", async () => {
    const id = await acceptedBooking();
    await h.db.execute(sql`
      UPDATE performance_bookings SET escrow_status = 'funding', stripe_session_id = 'cs_missing' WHERE id = ${id}
    `);
    const res = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(res.status).toBe(503);
    expect(h.createCalls).toHaveLength(0);
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe("cs_missing");
  });

  it("funding with no stored session id fails closed (409) — never freed on a guess", async () => {
    const id = await acceptedBooking();
    await h.db.execute(sql`
      UPDATE performance_bookings SET escrow_status = 'funding', stripe_session_id = NULL WHERE id = ${id}
    `);
    const res = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(res.status).toBe(409);
    expect(h.createCalls).toHaveLength(0);
    expect((await bookingRow(id)).escrow_status).toBe("funding");
  });

  it("sandbox: an unconfirmed sandbox funding is superseded by a fresh sandbox session on re-fund", async () => {
    const id = await acceptedBooking();
    delete process.env["STRIPE_SECRET_KEY"]; /* force sandbox mode */
    const first = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(first.status).toBe(200);
    expect(first.json.sandbox).toBe(true);
    /* The promoter walks away — no confirm. Before the fix this
       booking was stuck in 'funding' forever; now a re-fund
       supersedes the abandoned sandbox session (no real money
       exists to double). */
    const second = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(second.status).toBe(200);
    expect(second.json.sandbox).toBe(true);
    expect(second.json.sessionId).not.toBe(first.json.sessionId);
    expect(h.createCalls).toHaveLength(0);
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe(second.json.sessionId);
    /* The abandoned session can no longer settle the escrow… */
    const confirmOld = await req("POST", "/performance-bookings/escrow/confirm", { bookingId: id, sessionId: first.json.sessionId });
    expect(confirmOld.status).toBe(400);
    /* …and the fresh one can. */
    const confirmNew = await req("POST", "/performance-bookings/escrow/confirm", { bookingId: id, sessionId: second.json.sessionId });
    expect(confirmNew.status).toBe(200);
    expect((await bookingRow(id)).escrow_status).toBe("funded");
  });
});
