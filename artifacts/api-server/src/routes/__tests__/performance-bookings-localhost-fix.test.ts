/**
 * Performance-booking escrow return-URL fix (stack1300 sibling lane):
 *
 * POST /performance-bookings/:id/fund built its success/return/cancel
 * URLs from REPLIT_DOMAINS alone with an "http://localhost" fallback —
 * the identical hand-rolled derivation the escrow lane proved in
 * sponsors.ts (Gate #5, Nov 2). On Render (REPLIT_DOMAINS unset) every
 * deployed booking funding session sent the promoter's browser to
 * http://localhost/artist/<slug>?booking=<id>&funded=1 after paying.
 * Bookings was the only other money rail missing the getBaseUrl(req)
 * fallback chain every sibling uses (REPLIT_DOMAINS → REPLIT_DEV_DOMAIN
 * → x-forwarded-proto + host header → localhost last resort).
 *
 * The fix derives through the shared checkoutBaseUrl(req) — the lib
 * implementation of that same chain — and fails closed on a deployed
 * runtime when the only derivable base is loopback.
 *
 * Settlement is NOT pinned here because it is not this defect: booking
 * escrow settlement is webhook-owned (checkout.session.completed with
 * metadata.performance_booking_id → markPerformanceEscrowFunded in
 * lib/stripe-webhook.ts, idempotent, 500-on-failure so Stripe retries)
 * and is pinned by the booking/webhook suites. The localhost return
 * only ever broke the post-payment landing.
 *
 * Harness mirrors performance-bookings-embedded-fund.test.ts (pg-mem
 * via createTestDb; guarded Stripe client faked at lib/stripe-client,
 * recording create params) plus the proxy-header simulator from
 * sponsors-escrow-settle-fix.test.ts for the deployed shape.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  sessionSeq: 0,
  createCalls: [] as Array<{ params: any; options: any }>,
  simHost: null as string | null,
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
            h.createCalls.push({ params, options });
            return {
              id,
              url: embedded ? null : "https://checkout.example.com/pay",
              client_secret: embedded ? `${id}_secret` : null,
              payment_status: "paid",
              payment_intent: `pi_test_${h.sessionSeq}`,
              metadata: params.metadata ?? {},
            };
          }),
        },
      },
      charges: { list: vi.fn(async () => ({ data: [] })) },
      refunds: { create: vi.fn(async () => ({ id: "re_test_fake", status: "succeeded" })) },
    })),
  };
});

import performanceBookingsRouter from "../performance-bookings";
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
  /* Simulate Render's proxy: a deployed request carries the public
     host + forwarded proto. The fund route must derive its return
     base from these, exactly as it would in production. */
  app.use((req: any, _res: any, next: any) => {
    if (h.simHost) {
      req.headers.host = h.simHost;
      req.headers["x-forwarded-proto"] = "https";
    }
    next();
  });
  app.use("/api", performanceBookingsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function cleanEnv() {
  delete process.env["STRIPE_SECRET_KEY"];
  delete process.env["EMBEDDED_CHECKOUT"];
  delete process.env["REPLIT_DOMAINS"];
  delete process.env["REPLIT_DEV_DOMAIN"];
  delete process.env["RENDER"];
}

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
  h.sessionSeq = 0;
  h.createCalls = [];
  h.simHost = null;
  cleanEnv();
  await h.db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name)
    VALUES (${PROFILE_ID}, ${ARTIST}, 'thy-cheat-code', 'Thy Cheat Code')
  `);
});
afterEach(() => { cleanEnv(); });

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

describe("performance-booking fund return_url — never localhost on a deployed build", () => {
  it("derives the embedded return_url (and hosted success/cancel URLs) from the request's public host", async () => {
    h.simHost = "bow-down-visuals-staging.onrender.com";
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, { uiMode: "embedded" });
    expect(funded.status).toBe(200);
    expect(h.createCalls[0]!.params.return_url).toBe(
      `https://bow-down-visuals-staging.onrender.com/artist/thy-cheat-code?booking=${id}&funded=1`,
    );

    const id2 = await acceptedBooking();
    const hosted = await req("POST", `/performance-bookings/${id2}/fund`, {});
    expect(hosted.status).toBe(200);
    expect(h.createCalls[1]!.params.success_url).toBe(
      `https://bow-down-visuals-staging.onrender.com/artist/thy-cheat-code?booking=${id2}&funded=1`,
    );
    expect(h.createCalls[1]!.params.cancel_url).toBe(
      `https://bow-down-visuals-staging.onrender.com/artist/thy-cheat-code?booking=${id2}&funded=0`,
    );
    for (const call of h.createCalls) {
      expect(JSON.stringify(call.params)).not.toContain("localhost");
    }
  });

  it("fails closed on a deployed runtime when the only derivable base is loopback", async () => {
    process.env["RENDER"] = "true"; /* deployed signal; no public host on this request */
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, { uiMode: "embedded" });
    expect(funded.status).toBe(500);
    expect(funded.json.error).toContain("Could not start the funding flow");
    expect(h.createCalls).toHaveLength(0);
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("unfunded");
    expect(row.stripe_session_id).toBeNull();
  });

  it("honours an explicit REPLIT_DOMAINS deployment domain ahead of the request host", async () => {
    process.env["REPLIT_DOMAINS"] = "bowdownvisuals.com";
    h.simHost = "bow-down-visuals-staging.onrender.com";
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(funded.status).toBe(200);
    expect(h.createCalls[0]!.params.success_url).toBe(
      `https://bowdownvisuals.com/artist/thy-cheat-code?booking=${id}&funded=1`,
    );
  });
});
