/**
 * Performance-booking escrow fund EMBEDDED checkout (stack1200
 * hosted-checkout sweep): POST /performance-bookings/:id/fund
 * accepts uiMode: "embedded" (gated on the EMBEDDED_CHECKOUT kill
 * switch) and creates the SAME escrow session in embedded_page
 * ui_mode — same fee, metadata and buildPerformanceEscrowCheckoutKey
 * idempotency — answering clientSecret with checkoutUrl null.
 * Hosted stays the default; the sandbox (no-key) shape is untouched.
 *
 * Harness mirrors performance-bookings.test.ts (pg-mem via
 * createTestDb; guarded Stripe client faked at lib/stripe-client,
 * recording create params/options, embedded-aware).
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
              payment_status: "paid",
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

describe("performance-booking fund — embedded checkout (sweep)", () => {
  it("embedded ask answers clientSecret + checkoutUrl null and creates the session embedded", async () => {
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, { uiMode: "embedded" });
    expect(funded.status).toBe(200);
    expect(funded.json.sandbox).toBe(false);
    expect(funded.json.checkoutUrl).toBeNull();
    expect(funded.json.clientSecret).toBe("cs_test_1_secret");
    expect(funded.json.uiMode).toBe("embedded");
    expect(funded.json.sessionId).toBe("cs_test_1");
    const { params } = h.createCalls[0]!;
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toContain(`/artist/thy-cheat-code?booking=${id}&funded=1`);
    expect(params.success_url).toBeUndefined();
    const row = await bookingRow(id);
    expect(row.stripe_session_id).toBe("cs_test_1");
    expect(row.escrow_status).toBe("funding");
  });

  it("embedded and hosted create the identical session but for presentation (same amount + metadata; different idempotency key — stack1300)", async () => {
    const id = await acceptedBooking();
    await req("POST", `/performance-bookings/${id}/fund`, { uiMode: "embedded" });
    await h.db.execute(sql`UPDATE performance_bookings SET escrow_status = 'unfunded', stripe_session_id = NULL WHERE id = ${id}`);
    await req("POST", `/performance-bookings/${id}/fund`, {});
    const [emb, host] = h.createCalls;
    const strip = (p: Record<string, any>) => {
      const { ui_mode, return_url, success_url, cancel_url, ...rest } = p;
      return rest;
    };
    expect(strip(emb!.params)).toEqual(strip(host!.params));
    expect(emb!.params.line_items[0].price_data.unit_amount).toBe(250_00);
    expect(emb!.params.metadata).toMatchObject({
      performance_booking_id: id,
      performance_escrow: "true",
      amount_cents: "25000",
    });
    /* Different presentations = different Stripe requests; the key
       fingerprints the exact parameters, so they must NOT share one
       (a shared key is what Stripe refused on staging). */
    expect(emb!.options.idempotencyKey).not.toBe(host!.options.idempotencyKey);
  });

  it("hosted stays the default shape", async () => {
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(funded.json.checkoutUrl).toBe("https://checkout.example.com/pay");
    expect(funded.json.clientSecret).toBeUndefined();
    expect(h.createCalls[0]!.params.ui_mode).toBeUndefined();
    expect(h.createCalls[0]!.params.success_url).toContain("&funded=1");
  });

  it("EMBEDDED_CHECKOUT=off forces hosted even when embedded is asked", async () => {
    process.env["EMBEDDED_CHECKOUT"] = "off";
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, { uiMode: "embedded" });
    expect(funded.json.checkoutUrl).toBe("https://checkout.example.com/pay");
    expect(funded.json.clientSecret).toBeUndefined();
    expect(h.createCalls[0]!.params.ui_mode).toBeUndefined();
  });

  it("unknown uiMode is a 400 and no session is created", async () => {
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, { uiMode: "popup" });
    expect(funded.status).toBe(400);
    expect(h.createCalls).toHaveLength(0);
    const row = await bookingRow(id);
    expect(row.escrow_status).toBe("unfunded");
  });

  it("an embedded-funded escrow still marks funded with the $250.00 split intact (fee $37.50 / artist $212.50)", async () => {
    const id = await acceptedBooking();
    const funded = await req("POST", `/performance-bookings/${id}/fund`, { uiMode: "embedded" });
    const marked = await markPerformanceEscrowFunded(id, funded.json.sessionId, "pi_test_1");
    expect(marked.ok).toBe(true);
    const detail = await req("GET", `/performance-bookings/${id}`);
    expect(detail.json.booking.escrowStatus).toBe("funded");
    expect(detail.json.booking.feePreview).toEqual({ feeCents: 37_50, netCents: 212_50 });
  });
});
