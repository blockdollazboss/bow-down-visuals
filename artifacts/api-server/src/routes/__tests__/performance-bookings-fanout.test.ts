/**
 * Performance-booking lifecycle fan-out (stack1100 Y3). The mirror
 * escrow lifecycle ran with zero notifications. These tests pin the
 * new tells: each fires through the booking seam exactly once, on the
 * landed transition only, and money copy names the amount that
 * actually moved. Harness mirrors performance-bookings.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
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

import performanceBookingsRouter, {
  markPerformanceEscrowFunded,
  __setPerformanceEventNotifier,
  buildPerformanceEvent,
} from "../performance-bookings";
import type { UserEventInput } from "../../lib/push-events";
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
);
CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_payment_intent_id text,
  refunded_cents_seen integer,
  dispute_lost boolean
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
const ARTIST = randomUUID();
const PROMOTER = randomUUID();
const PROFILE_ID = randomUUID();

let events: UserEventInput[];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", performanceBookingsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  __setPerformanceEventNotifier(null);
  await new Promise<void>((r) => server.close(() => r()));
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
  events = [];
  __setPerformanceEventNotifier(async (input) => {
    events.push(input);
  });
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
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function createBooking() {
  h.userId = PROMOTER;
  const r = await req("POST", "/performance-bookings", {
    profileId: PROFILE_ID,
    promoterName: "Golden Promotions",
    eventTitle: "Palace Launch Night",
    eventDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    venueName: "The Palace",
    venueAddress: "1 Crown Way",
    venueCity: "Atlanta",
    feeCents: 100_00,
    terms: { performance: "Headline set", setLengthMin: 60 },
  });
  expect(r.status).toBe(201);
  return r.json.booking.id as string;
}

describe("buildPerformanceEvent", () => {
  it("builds a money event, link only when given", () => {
    expect(buildPerformanceEvent({ userId: "u", kind: "k", title: "t", body: "b" })).toEqual({
      userId: "u",
      category: "money",
      kind: "k",
      title: "t",
      body: "b",
    });
  });
});

describe("the walk tells each party, once", () => {
  it("create → artist; accept → promoter; funded → artist (replay silent); complete → promoter; release → artist with the NET", async () => {
    const bookingId = await createBooking();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: ARTIST, kind: "performance_booking_proposed", category: "money" });
    expect(events[0]!.body).toContain("$100.00");
    expect(events[0]!.link).toBe(`/artist/thy-cheat-code?booking=${bookingId}`);

    h.userId = ARTIST;
    const acc = await req("POST", `/performance-bookings/${bookingId}/respond`, { action: "accept" });
    expect(acc.status).toBe(200);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ userId: PROMOTER, kind: "performance_booking_accepted" });

    /* A repeat answer is refused by the guard — and silent. */
    const again = await req("POST", `/performance-bookings/${bookingId}/respond`, { action: "accept" });
    expect(again.status).toBe(409);
    expect(events).toHaveLength(2);

    const funded = await markPerformanceEscrowFunded(bookingId, "cs_test_1", "pi_test_1");
    expect(funded).toEqual({ ok: true });
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({ userId: ARTIST, kind: "performance_escrow_funded" });
    const replay = await markPerformanceEscrowFunded(bookingId, "cs_test_1", "pi_test_1");
    expect(replay).toEqual({ ok: true, reason: "already-funded" });
    expect(events).toHaveLength(3);

    h.userId = ARTIST;
    const done = await req("POST", `/performance-bookings/${bookingId}/complete`);
    expect(done.status).toBe(200);
    expect(events).toHaveLength(4);
    expect(events[3]).toMatchObject({ userId: PROMOTER, kind: "performance_booking_completed" });

    h.userId = PROMOTER;
    const rel = await req("POST", `/performance-bookings/${bookingId}/release`);
    expect(rel.status).toBe(200);
    expect(rel.json.artistPayoutCents).toBe(85_00);
    const released = events.filter((e) => e.kind === "performance_payment_released");
    expect(released).toHaveLength(1);
    expect(released[0]!.userId).toBe(ARTIST);
    expect(released[0]!.body).toContain("$85.00");
  });

  it("decline → promoter, once", async () => {
    const bookingId = await createBooking();
    events = [];
    h.userId = ARTIST;
    const r = await req("POST", `/performance-bookings/${bookingId}/respond`, { action: "decline" });
    expect(r.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: PROMOTER, kind: "performance_booking_declined" });
  });

  it("cancel by the promoter → the artist, with the no-money-moved truth", async () => {
    const bookingId = await createBooking();
    events = [];
    h.userId = PROMOTER;
    const r = await req("POST", `/performance-bookings/${bookingId}/cancel`);
    expect(r.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: ARTIST, kind: "performance_booking_cancelled" });
    expect(events[0]!.body).toContain("No money had moved");
    expect(events[0]!.body).toContain("Golden Promotions");
  });
});
