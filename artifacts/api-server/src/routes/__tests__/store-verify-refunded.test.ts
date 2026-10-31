/**
 * store-verify-refunded.test.ts — money-hardening round 2, area 3:
 * POST /api/store/verify must not deliver against a refunded payment.
 *
 * The unhappy path: the buyer pays, the payment is refunded IN FULL
 * before the buyer ever lands on the verify page (a dashboard
 * refund, a lost dispute, or D5's own webhook auto-refund racing a
 * slow buyer). No digital_sales row existed when the reversal engine
 * saw the refund, so it parked the charge 'unidentified' — and the
 * old verify then recorded the sale anyway: download links minted,
 * license keys issued, the seller's payout ledgers credited. Goods
 * and seller earnings against money the buyer already got back.
 *
 * Verify now refuses a fully-reversed payment (two witnesses: the
 * reversal ledger, and the charge expanded on the session itself).
 * Partial refunds keep the engine's entitlement-kept posture; an
 * already-recorded sale stays the reversal engine's domain.
 *
 * Real store router over pg-mem; Stripe faked at the `stripe` module
 * seam — the store-checkout-row9 harness pattern.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-store-verify-refunded";
process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_store_verify_refunded";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<{ params: any; options: any }>,
  sessions: new Map<string, any>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, options: any) => {
          const id = `cs_test_${h.stripeCreates.length + 1}`;
          h.stripeCreates.push({ params, options });
          const amount_total = (params.line_items as Array<any>).reduce(
            (sum, li) => sum + li.price_data.unit_amount * (li.quantity ?? 1),
            0,
          );
          h.sessions.set(id, {
            id,
            payment_status: "paid",
            amount_total,
            metadata: params.metadata,
            payment_intent: `pi_test_${h.stripeCreates.length}`,
            customer_details: { email: "buyer@example.com" },
          });
          return { id, url: "https://checkout.example.com/pay" };
        },
        retrieve: async (id: string) => {
          const s = h.sessions.get(id);
          if (!s) throw new Error("No such checkout session");
          return s;
        },
      },
    };
    refunds = {
      create: async () => ({ id: "re_test", status: "succeeded" }),
    };
  }
  return { default: FakeStripe };
});

vi.mock("../generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (_title: string, html: string) => html,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

import storeRouter from "../store";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL,
  download_price_cents integer, is_published boolean NOT NULL DEFAULT true,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  audio_url text, artwork_url text
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL,
  download_price_cents integer, is_published boolean NOT NULL DEFAULT true,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  video_url text, thumbnail_url text, thumbnail_alt_text text
);
CREATE TABLE playlists (
  id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL, title text NOT NULL,
  price_cents integer, is_public boolean NOT NULL DEFAULT true,
  kind text NOT NULL DEFAULT 'series', cover_url text,
  items jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  item_kind text NOT NULL, item_id uuid NOT NULL,
  stripe_session_id text UNIQUE, amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed', refunded_at timestamptz,
  bump_item_kind text, bump_item_id uuid, bump_title text,
  bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE download_links (
  token text PRIMARY KEY, sale_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0
);
CREATE TABLE money_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  entry_type text NOT NULL, category text, amount_cents integer,
  note text, source text, entry_date text
);
CREATE TABLE digital_bump_offers (
  item_kind text NOT NULL, item_id uuid NOT NULL,
  bump_kind text NOT NULL, bump_item_id uuid NOT NULL,
  percent_off integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id)
);
CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY,
  stripe_payment_intent_id text,
  refunded_cents_seen integer NOT NULL DEFAULT 0,
  charge_amount_cents integer NOT NULL DEFAULT 0,
  dispute_lost boolean NOT NULL DEFAULT false
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
const BUYER = randomUUID();
const PRICE = 1999;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storeRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[store-verify-refunded] unhandled route error:", err?.message ?? err);
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
  h.userId = BUYER;
  h.stripeCreates = [];
  h.sessions = new Map();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** Seed a sellable track and run the REAL checkout to get a session. */
async function buySession(): Promise<{ sessionId: string; pi: string }> {
  const sellerUserId = randomUUID();
  const profileId = randomUUID();
  const trackId = randomUUID();
  await h.db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name)
    VALUES (${profileId}, ${sellerUserId}, ${`seller-${profileId.slice(0, 8)}`}, 'Queen Creator')
  `);
  await h.db.execute(sql`
    INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, audio_url)
    VALUES (${trackId}, ${profileId}, 'Golden Track', ${PRICE}, 'https://cdn.example.com/golden-track.mp3')
  `);
  h.userId = BUYER;
  const co = await req("POST", "/store/checkout", { kind: "track", id: trackId });
  expect(co.status).toBe(200);
  const sessionId = co.json.sessionId as string;
  return { sessionId, pi: h.sessions.get(sessionId).payment_intent as string };
}

async function ledgerFullRefund(pi: string, refunded: number, chargeAmount: number, disputeLost = false) {
  await h.db.execute(sql`
    INSERT INTO payment_reversals (id, stripe_payment_intent_id, refunded_cents_seen, charge_amount_cents, dispute_lost)
    VALUES (${randomUUID()}, ${pi}, ${refunded}, ${chargeAmount}, ${disputeLost})
  `);
}

async function saleCount(sessionId: string): Promise<number> {
  const r = await h.db.execute(sql`SELECT id FROM digital_sales WHERE stripe_session_id = ${sessionId}`);
  return r.rows.length;
}
async function linkCount(): Promise<number> {
  const r = await h.db.execute(sql`SELECT token FROM download_links`);
  return r.rows.length;
}

describe("POST /store/verify — refunded payments deliver nothing", () => {
  it("a payment refunded IN FULL before first verify (ledger witness) records no sale, mints no links", async () => {
    const { sessionId, pi } = await buySession();
    await ledgerFullRefund(pi, PRICE, PRICE);

    const res = await req("POST", "/store/verify", { sessionId });
    /* Pre-fix: 200 with a recorded sale + download links against
       refunded money. */
    expect(res.status).toBe(400);
    expect(res.json.refunded).toBe(true);
    expect(res.json.error).toContain("refunded in full");
    expect(await saleCount(sessionId)).toBe(0);
    expect(await linkCount()).toBe(0);
  });

  it("a lost dispute (ledger witness — dispute debits never show as refunds at Stripe) refuses the same way", async () => {
    const { sessionId, pi } = await buySession();
    await ledgerFullRefund(pi, 0, PRICE, true);

    const res = await req("POST", "/store/verify", { sessionId });
    expect(res.status).toBe(400);
    expect(res.json.refunded).toBe(true);
    expect(await saleCount(sessionId)).toBe(0);
  });

  it("a charge refunded in full at Stripe (expanded-charge witness, no ledger row) refuses too", async () => {
    const { sessionId, pi } = await buySession();
    const s = h.sessions.get(sessionId);
    s.payment_intent = {
      id: pi,
      latest_charge: { id: "ch_1", amount: PRICE, amount_refunded: PRICE, refunded: true },
    };

    const res = await req("POST", "/store/verify", { sessionId });
    expect(res.status).toBe(400);
    expect(res.json.refunded).toBe(true);
    expect(await saleCount(sessionId)).toBe(0);
    expect(await linkCount()).toBe(0);
  });

  it("control: a PARTIAL refund keeps the entitlement — verify records the sale as before", async () => {
    const { sessionId, pi } = await buySession();
    await ledgerFullRefund(pi, 500, PRICE);

    const res = await req("POST", "/store/verify", { sessionId });
    expect(res.status).toBe(200);
    expect(await saleCount(sessionId)).toBe(1);
  });

  it("control: no reversal anywhere — verify records the sale as before", async () => {
    const { sessionId } = await buySession();
    const res = await req("POST", "/store/verify", { sessionId });
    expect(res.status).toBe(200);
    expect(await saleCount(sessionId)).toBe(1);
  });

  it("boundary: a sale ALREADY recorded stays the reversal engine's domain — a later verify is the plain duplicate, not a re-judgement", async () => {
    const { sessionId, pi } = await buySession();
    const first = await req("POST", "/store/verify", { sessionId });
    expect(first.status).toBe(200);
    await ledgerFullRefund(pi, PRICE, PRICE);

    const second = await req("POST", "/store/verify", { sessionId });
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(await saleCount(sessionId)).toBe(1);
  });
});
