/**
 * Book the Artist — escrow refund hardening (money-hardening round 2,
 * area 1). Three unhappy paths the old code failed:
 *
 *  1. RELEASE after a partial refund split the FULL fee. The release
 *     now splits only what is still held (Stripe charge state unioned
 *     with the reversal ledger), like sponsor escrow.
 *  2. CANCEL of a funded booking wrote escrow_status='refunded' and
 *     TOLD the promoter a refund was coming — but nothing anywhere
 *     created the Stripe refund. The cancel now fires the real
 *     refund (the shared idempotent rail, key refund:<sessionId>)
 *     BEFORE marking state, and refuses to cancel when the refund
 *     cannot be completed.
 *  3. A release whose conditional state flip matched nothing used to
 *     answer 200 for money that never moved; it now 409s.
 *
 * Real router over pg-mem; Stripe faked at the lib/stripe-client seam
 * with a controllable charge + refund registry.
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
  charge: null as any,
  refundCalls: [] as Array<{ params: any; options: any }>,
  refundThrows: false,
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
          create: vi.fn(async (params: any) => {
            h.sessionSeq += 1;
            const id = `cs_test_${h.sessionSeq}`;
            const session = {
              id,
              url: "https://checkout.example.com/pay",
              payment_status: "paid",
              payment_intent: `pi_test_${h.sessionSeq}`,
              metadata: params.metadata ?? {},
            };
            h.sessions.set(id, session);
            return session;
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = h.sessions.get(id);
            if (!s) throw new Error("No such checkout session");
            return s;
          }),
        },
      },
      charges: {
        list: vi.fn(async () => ({ data: h.charge ? [h.charge] : [] })),
      },
      refunds: {
        create: vi.fn(async (params: any, options: any) => {
          h.refundCalls.push({ params, options });
          if (h.refundThrows) throw new Error("Stripe refund failed");
          return { id: `re_test_${h.refundCalls.length}`, status: "succeeded" };
        }),
      },
    })),
  };
});

import performanceBookingsRouter, { markPerformanceEscrowFunded } from "../performance-bookings";
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
let server: any;
let baseUrl: string;

const ARTIST = randomUUID();
const PROMOTER = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", performanceBookingsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

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
  h.charge = null;
  h.refundCalls = [];
  h.refundThrows = false;
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
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();

async function propose() {
  h.userId = PROMOTER;
  return req("POST", "/performance-bookings", {
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
}

/** Propose → accept → fund (Stripe) → webhook-mark funded. */
async function walkToFunded() {
  const created = await propose();
  const id = created.json.booking.id as string;
  h.userId = ARTIST;
  await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" });
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  h.userId = PROMOTER;
  const funded = await req("POST", `/performance-bookings/${id}/fund`, {});
  const sessionId = funded.json.sessionId as string;
  const pi = h.sessions.get(sessionId).payment_intent as string;
  const marked = await markPerformanceEscrowFunded(id, sessionId, pi);
  expect(marked).toMatchObject({ ok: true });
  return { id, sessionId, pi };
}

async function bookingRow(id: string) {
  const r = await h.db.execute(sql`SELECT status, escrow_status, artist_payout_cents, platform_fee_cents FROM performance_bookings WHERE id = ${id}`);
  return r.rows[0] as Record<string, unknown>;
}

describe("release — refund netting", () => {
  it("a partial refund nets out: the release splits only what is still held", async () => {
    const { id, pi } = await walkToFunded();
    h.userId = ARTIST;
    await req("POST", `/performance-bookings/${id}/complete`, {});
    /* $100 of the $250 fee came back to the promoter before release. */
    h.charge = { id: "ch_perf_1", amount: 25000, amount_captured: 25000, amount_refunded: 10000, payment_intent: pi };

    h.userId = PROMOTER;
    const res = await req("POST", `/performance-bookings/${id}/release`, {});
    expect(res.status).toBe(200);
    /* Held $150 → fee $22.50 / artist $127.50. Pre-fix: $37.50/$212.50
       on the full fee — $100 paid out that Stripe had refunded. */
    expect(res.json.grossCents).toBe(15000);
    expect(res.json.platformFeeCents).toBe(2250);
    expect(res.json.artistPayoutCents).toBe(12750);
    expect(res.json.refundedCents).toBe(10000);
    expect(await bookingRow(id)).toMatchObject({ status: "paid", escrow_status: "released", artist_payout_cents: 12750 });
  });

  it("control: no refund — the release splits the full fee, as before", async () => {
    const { id } = await walkToFunded();
    h.userId = ARTIST;
    await req("POST", `/performance-bookings/${id}/complete`, {});
    h.charge = { id: "ch_perf_1", amount: 25000, amount_captured: 25000, amount_refunded: 0 };

    h.userId = PROMOTER;
    const res = await req("POST", `/performance-bookings/${id}/release`, {});
    expect(res.status).toBe(200);
    expect(res.json.platformFeeCents).toBe(3750);
    expect(res.json.artistPayoutCents).toBe(21250);
    expect(res.json.refundedCents).toBeUndefined();
  });
});

describe("cancel — the refund is real now", () => {
  it("cancelling a funded booking fires the Stripe refund with the shared idempotency key, then marks refunded", async () => {
    const { id, sessionId, pi } = await walkToFunded();
    h.userId = PROMOTER;
    const res = await req("POST", `/performance-bookings/${id}/cancel`, {});
    expect(res.status).toBe(200);
    expect(res.json.booking.status).toBe("cancelled");
    expect(res.json.booking.escrowStatus).toBe("refunded");
    expect(res.json.note).toContain("has been refunded in full");
    /* The money proof: exactly one refund, against the booking's
       payment intent, keyed so a webhook/verify retry can never
       double-refund. Pre-fix this array was empty — the promoter was
       told a refund was coming that nothing ever sent. */
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundCalls[0]!.params).toEqual({ payment_intent: pi });
    expect(h.refundCalls[0]!.options).toEqual({ idempotencyKey: `refund:${sessionId}` });
  });

  it("when the refund cannot be completed, the booking does NOT cancel and does NOT claim a refund", async () => {
    const { id } = await walkToFunded();
    h.refundThrows = true;
    h.userId = PROMOTER;
    const res = await req("POST", `/performance-bookings/${id}/cancel`, {});
    expect(res.status).toBe(500);
    expect(res.json.error).toContain("still on");
    /* State is exactly as before the attempt: still funded, still
       releasable. Pre-fix this answered 200 cancelled/refunded with
       no refund anywhere. */
    expect(await bookingRow(id)).toMatchObject({ status: "funded", escrow_status: "funded" });
  });

  it("control: an unfunded cancel fires no refund and says no money moved", async () => {
    const created = await propose();
    const id = created.json.booking.id as string;
    h.userId = ARTIST;
    const res = await req("POST", `/performance-bookings/${id}/cancel`, {});
    expect(res.status).toBe(200);
    expect(res.json.booking.escrowStatus).toBe("unfunded");
    expect(h.refundCalls).toHaveLength(0);
  });
});
