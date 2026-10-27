/**
 * Book the Artist (#158) — performance bookings with escrow.
 * Drives the REAL performance-bookings router over pg-mem with Stripe
 * faked at the lib/stripe-client seam and pins the full deal walk:
 *  - a promoter books an artist: the record is created 'proposed'
 *    with the plain-words terms summary attached, generated from the
 *    agreed facts (fee + 15% split spelled out);
 *  - only the artist answers, only from 'proposed'; only the promoter
 *    funds, only after acceptance, exactly once (deterministic Stripe
 *    idempotency key on the performance-escrow rail);
 *  - the webhook seam (markPerformanceEscrowFunded) flips the escrow
 *    to funded idempotently;
 *  - only the artist completes, only the promoter releases, and the
 *    release splits the fee exactly once (15% platform / 85% artist);
 *  - decline and cancel paths behave, funded cancels mark the escrow
 *    refunded, and outsiders can neither see nor touch a booking;
 *  - with no Stripe key the sandbox fund + confirm path works and
 *    refuses unknown sessions.
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

/* The suite drives the real router over one loopback IP; the public
   limiter is not what's under test here (same call as storefront). */
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
            const session = {
              id,
              url: "https://checkout.example.com/pay",
              payment_status: "paid",
              payment_intent: `pi_test_${h.sessionSeq}`,
              metadata: params.metadata ?? {},
            };
            h.sessions.set(id, session);
            h.createCalls.push({ params, options });
            return session;
          }),
        },
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
let server: any; let baseUrl: string;
const ARTIST = randomUUID();
const PROMOTER = randomUUID();
const OUTSIDER = randomUUID();
const PROFILE_ID = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", performanceBookingsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[performance-bookings] unhandled route error:", err?.message ?? err);
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
function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    profileId: PROFILE_ID,
    promoterName: "Harbor Lights Venue",
    eventTitle: "Harbor Nights Live",
    eventDate: FUTURE,
    venueName: "The Harbor Room",
    venueAddress: "12 Pier Street",
    venueCity: "Norfolk",
    feeCents: 250_00,
    terms: { performance: "a 45-minute headline set", setLengthMin: 45 },
    ...overrides,
  };
}

async function propose(as = PROMOTER, body = bookingBody()) {
  h.userId = as;
  return req("POST", "/performance-bookings", body);
}
async function walkToFundedWithStripe() {
  const created = await propose();
  const id = created.json.booking.id as string;
  h.userId = ARTIST;
  await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" });
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  h.userId = PROMOTER;
  const funded = await req("POST", `/performance-bookings/${id}/fund`, {});
  const marked = await markPerformanceEscrowFunded(id, funded.json.sessionId, "pi_test_1");
  return { id, funded, marked };
}

describe("create", () => {
  it("creates a proposed booking with the plain-words terms attached", async () => {
    const r = await propose();
    expect(r.status).toBe(201);
    const b = r.json.booking;
    expect(b.status).toBe("proposed");
    expect(b.escrowStatus).toBe("unfunded");
    expect(b.role).toBe("promoter");
    expect(b.artistName).toBe("Thy Cheat Code");
    expect(b.feeCents).toBe(250_00);
    expect(b.plainWords).toContain("The fee is $250.00.");
    expect(b.plainWords).toContain("Thy Cheat Code receives $212.50");
    expect(b.plainWords).toContain("a 45-minute headline set");
    expect(b.feePreview).toEqual({ feeCents: 37_50, netCents: 212_50 });
  });
  it("refuses booking your own profile, a past date, and a broken body", async () => {
    const own = await propose(ARTIST);
    expect(own.status).toBe(400);
    expect(own.json.error).toBe("OWN_PROFILE");
    const past = await propose(PROMOTER, bookingBody({ eventDate: "2020-01-01T00:00:00.000Z" }));
    expect(past.status).toBe(400);
    const broken = await propose(PROMOTER, bookingBody({ feeCents: 0 }));
    expect(broken.status).toBe(400);
    const noProfile = await propose(PROMOTER, bookingBody({ profileId: randomUUID() }));
    expect(noProfile.status).toBe(404);
  });
  it("the artist sees it as incoming; outsiders see nothing", async () => {
    await propose();
    h.userId = ARTIST;
    const list = await req("GET", "/performance-bookings");
    expect(list.json.bookings).toHaveLength(1);
    expect(list.json.bookings[0].role).toBe("artist");
    expect(list.json.counts.proposed).toBe(1);
    h.userId = OUTSIDER;
    const outside = await req("GET", "/performance-bookings");
    expect(outside.json.bookings).toHaveLength(0);
  });
});

describe("respond + fund guards", () => {
  it("only the artist can answer, and only once", async () => {
    const created = await propose();
    const id = created.json.booking.id;
    h.userId = PROMOTER;
    expect((await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" })).status).toBe(403);
    h.userId = ARTIST;
    const ok = await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" });
    expect(ok.json.booking.status).toBe("accepted");
    expect((await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" })).status).toBe(409);
  });
  it("fund refuses before acceptance and for the artist", async () => {
    const created = await propose();
    const id = created.json.booking.id;
    h.userId = PROMOTER;
    expect((await req("POST", `/performance-bookings/${id}/fund`, {})).status).toBe(409);
    h.userId = ARTIST;
    await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" });
    expect((await req("POST", `/performance-bookings/${id}/fund`, {})).status).toBe(403);
  });
  it("decline closes the booking to funding", async () => {
    const created = await propose();
    const id = created.json.booking.id;
    h.userId = ARTIST;
    const declined = await req("POST", `/performance-bookings/${id}/respond`, { action: "decline" });
    expect(declined.json.booking.status).toBe("declined");
    h.userId = PROMOTER;
    expect((await req("POST", `/performance-bookings/${id}/fund`, {})).status).toBe(409);
  });
});

describe("the full escrow walk (Stripe configured, client faked)", () => {
  it("fund → webhook mark → complete → release splits the fee exactly once", async () => {
    const { id, funded, marked } = await walkToFundedWithStripe();
    expect(funded.json.sandbox).toBe(false);
    expect(funded.json.checkoutUrl).toContain("checkout.example.com");
    /* The Stripe session carries the booking id the webhook routes on,
       and the deterministic performance-escrow idempotency key. */
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]!.params.metadata.performance_booking_id).toBe(id);
    expect(h.createCalls[0]!.options.idempotencyKey).toContain("performance-escrow");
    expect(marked).toEqual({ ok: true });
    /* Funding twice is refused — the escrow state machine says no. */
    h.userId = PROMOTER;
    expect((await req("POST", `/performance-bookings/${id}/fund`, {})).status).toBe(409);
    /* The webhook seam is idempotent on the same session. */
    expect(await markPerformanceEscrowFunded(id, funded.json.sessionId, "pi_test_1"))
      .toEqual({ ok: true, reason: "already-funded" });

    h.userId = PROMOTER;
    expect((await req("POST", `/performance-bookings/${id}/complete`, {})).status).toBe(403);
    h.userId = ARTIST;
    const completed = await req("POST", `/performance-bookings/${id}/complete`, {});
    expect(completed.json.booking.status).toBe("completed");

    h.userId = ARTIST;
    expect((await req("POST", `/performance-bookings/${id}/release`, {})).status).toBe(403);
    h.userId = PROMOTER;
    const released = await req("POST", `/performance-bookings/${id}/release`, {});
    expect(released.json.booking.status).toBe("paid");
    expect(released.json.booking.escrowStatus).toBe("released");
    expect(released.json.platformFeeCents).toBe(37_50);
    expect(released.json.artistPayoutCents).toBe(212_50);
    expect(released.json.booking.platformFeeCents).toBe(37_50);
    /* A second release is refused before any money column moves again. */
    expect((await req("POST", `/performance-bookings/${id}/release`, {})).status).toBe(409);
  });
  it("release refuses before the show is complete", async () => {
    const { id } = await walkToFundedWithStripe();
    h.userId = PROMOTER;
    expect((await req("POST", `/performance-bookings/${id}/release`, {})).status).toBe(409);
  });
});

describe("sandbox funding (no Stripe key)", () => {
  it("fund returns a sandbox session and confirm marks it funded", async () => {
    const created = await propose();
    const id = created.json.booking.id;
    h.userId = ARTIST;
    await req("POST", `/performance-bookings/${id}/respond`, { action: "accept" });
    h.userId = PROMOTER;
    const funded = await req("POST", `/performance-bookings/${id}/fund`, {});
    expect(funded.json.sandbox).toBe(true);
    const wrong = await req("POST", "/performance-bookings/escrow/confirm", {
      bookingId: id, sessionId: "sandbox_nope",
    });
    expect(wrong.status).toBe(400);
    const confirmed = await req("POST", "/performance-bookings/escrow/confirm", {
      bookingId: id, sessionId: funded.json.sessionId,
    });
    expect(confirmed.json).toEqual({ success: true, escrowStatus: "funded" });
    const detail = await req("GET", `/performance-bookings/${id}`);
    expect(detail.json.booking.status).toBe("funded");
    expect(detail.json.booking.escrowStatus).toBe("funded");
  });
});

describe("cancel", () => {
  it("an unfunded cancel moves no money; a funded cancel marks the escrow refunded", async () => {
    const a = await propose();
    h.userId = ARTIST;
    const cancelledA = await req("POST", `/performance-bookings/${a.json.booking.id}/cancel`, {});
    expect(cancelledA.json.booking.status).toBe("cancelled");
    expect(cancelledA.json.booking.escrowStatus).toBe("unfunded");
    expect(cancelledA.json.note).toContain("No money had moved");

    const { id } = await walkToFundedWithStripe();
    h.userId = PROMOTER;
    const cancelledB = await req("POST", `/performance-bookings/${id}/cancel`, {});
    expect(cancelledB.json.booking.status).toBe("cancelled");
    expect(cancelledB.json.booking.escrowStatus).toBe("refunded");
    expect(cancelledB.json.note).toContain("refund");
  });
  it("outsiders cannot see or act on a booking", async () => {
    const created = await propose();
    const id = created.json.booking.id;
    h.userId = OUTSIDER;
    expect((await req("GET", `/performance-bookings/${id}`)).status).toBe(403);
    expect((await req("POST", `/performance-bookings/${id}/cancel`, {})).status).toBe(403);
  });
});
