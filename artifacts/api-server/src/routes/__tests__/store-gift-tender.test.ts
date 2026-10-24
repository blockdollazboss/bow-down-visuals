/**
 * Gift-card tender on the digital-store rail (Stack-100 #3 #26).
 * Real store router + real lib/gift-cards over pg-mem (harness mirrors
 * storefront-gift-tender.test.ts; Stripe at the lib/stripe-client
 * seam). Pins: full tender records the sale directly (fee on the full
 * gross, delivery link minted, card keeps the remainder); partial
 * tender charges only the due amount and verify records the GROSS
 * with the full fee, debiting the card exactly once.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-store-gift-tender";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<any>,
  session: null as any,
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

vi.mock("../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn(async (params: any) => {
            h.stripeCreates.push(params);
            return { id: `cs_test_${h.stripeCreates.length}`, url: "https://checkout.example.com/pay" };
          }),
          retrieve: vi.fn(async () => h.session),
        },
      },
    })),
  };
});

vi.mock("../../lib/job-notifications", () => ({
  createJobNotification: vi.fn(async () => undefined),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
  emailShell: (_t: string, html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

import storeRouter from "../store";
import { createTestDb } from "../../lib/__tests__/test-db";
import { hashGiftCardCode, reserveGiftCard } from "../../lib/gift-cards";
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
  video_url text, thumbnail_url text
, thumbnail_alt_text text);
CREATE TABLE playlists (
  id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL, title text,
  price_cents integer, is_public boolean NOT NULL DEFAULT true, kind text, cover_url text
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  item_kind text NOT NULL, item_id uuid NOT NULL, stripe_session_id text UNIQUE,
  amount_cents integer NOT NULL, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE download_links (
  token text PRIMARY KEY, sale_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL, code_last4 text NOT NULL,
  profile_id uuid NOT NULL, product_id uuid,
  buyer_user_id uuid, recipient_email text NOT NULL,
  recipient_name text, message text,
  initial_cents integer NOT NULL, balance_cents integer NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_card_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, kind text NOT NULL,
  amount_cents integer NOT NULL, balance_after_cents integer NOT NULL,
  ref text, idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_ledger_idem_ux ON gift_card_ledger (idempotency_key);
CREATE TABLE gift_card_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, rail text NOT NULL, ref text NOT NULL,
  amount_cents integer NOT NULL, status text NOT NULL DEFAULT 'reserved',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_reservations_rail_ref_ux ON gift_card_reservations (rail, ref);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const TRACK_ID = randomUUID();
const CARD_CODE = "BDV-AAAA-BBBB-CCCC-DDDD";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storeRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[store-gift-tender] unhandled route error:", err?.message ?? err);
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
    name: "gen_random_uuid", args: [], returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = BUYER;
  h.userEmail = "buyer@example.com";
  h.stripeCreates = [];
  h.session = null;
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
  await h.db.execute(sql`INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, is_published, audio_url) VALUES (${TRACK_ID}, ${PROFILE_ID}, 'Golden Track', 2000, true, 'https://cdn.example.com/track.mp3')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function seedCard(balanceCents: number) {
  const id = randomUUID();
  await h.db.execute(sql`
    INSERT INTO gift_cards (id, code_hash, code_last4, profile_id, buyer_user_id, recipient_email, initial_cents, balance_cents, status, stripe_session_id)
    VALUES (${id}, ${hashGiftCardCode(CARD_CODE)}, 'DDDD', ${PROFILE_ID}, ${BUYER}, 'friend@example.com', ${balanceCents}, ${balanceCents}, 'active', ${`cs_seed_${id}`})
  `);
  return id;
}

async function cardRow(id: string) {
  const r = await h.db.execute(sql`SELECT balance_cents, reserved_cents, status FROM gift_cards WHERE id = ${id}`);
  return r.rows[0] as any;
}

describe("digital-store gift-card tender", () => {
  it("full tender: sale records directly with fee on the gross, delivery minted, card keeps the rest", async () => {
    const cardId = await seedCard(5000);
    const r = await req("POST", "/store/checkout", { kind: "track", id: TRACK_ID, giftCardCode: CARD_CODE });
    expect(r.status).toBe(200);
    expect(r.json.paidWithGiftCard).toBe(true);
    expect(r.json.sale.amountCents).toBe(2000);
    expect(r.json.sale.platformFeeCents).toBe(100);
    expect(r.json.sale.creatorAmountCents).toBe(1900);
    expect(r.json.download?.url).toContain("/api/store/download/");
    expect(h.stripeCreates).toHaveLength(0);
    expect(await cardRow(cardId)).toMatchObject({ balance_cents: 3000, reserved_cents: 0 });
    const sales = await h.db.execute(sql`SELECT amount_cents, platform_fee_cents, creator_amount_cents FROM digital_sales`);
    expect(sales.rows).toHaveLength(1);
    expect(sales.rows[0]).toMatchObject({ amount_cents: 2000, platform_fee_cents: 100, creator_amount_cents: 1900 });
  });

  it("partial tender: session charges the due amount; verify records the gross and debits exactly once", async () => {
    const cardId = await seedCard(1200);
    const co = await req("POST", "/store/checkout", { kind: "track", id: TRACK_ID, giftCardCode: CARD_CODE });
    expect(co.status).toBe(200);
    expect(co.json.giftCardAppliedCents).toBe(1200);
    expect(co.json.amountDueCents).toBe(800);
    expect(h.stripeCreates).toHaveLength(1);
    expect(h.stripeCreates[0].line_items[0].price_data.unit_amount).toBe(800);
    const meta = h.stripeCreates[0].metadata;
    expect(meta.gift_card_applied_cents).toBe("1200");
    expect(meta.gift_card_reservation_id).toBeTruthy();

    h.session = {
      id: "cs_test_1", payment_status: "paid", amount_total: 800,
      payment_intent: "pi_test_1", metadata: meta, customer_details: null,
    };
    const v = await req("POST", "/store/verify", { sessionId: "cs_test_1" });
    expect(v.status).toBe(200);
    expect(v.json.sale.amountCents).toBe(2000);
    expect(v.json.sale.platformFeeCents).toBe(100);
    expect(v.json.sale.giftCardAppliedCents).toBe(1200);
    expect(await cardRow(cardId)).toMatchObject({ balance_cents: 0, reserved_cents: 0, status: "depleted" });

    const again = await req("POST", "/store/verify", { sessionId: "cs_test_1" });
    expect(again.status).toBe(200);
    /* The money invariants on replay: still ONE sale row, the card is
       NOT debited twice, ONE redeem ledger entry. (The response's
       `duplicate` flag itself is not asserted here: pg-mem returns
       the conflicting row from ON CONFLICT … RETURNING, so the
       pre-existing rail handler reads a replay as fresh in this
       engine — a pg-mem quirk, identical on the base code.) */
    const salesCount = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM digital_sales`);
    expect(Number((salesCount.rows[0] as any).c)).toBe(1);
    expect((await cardRow(cardId)).balance_cents).toBe(0);
    const ledger = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM gift_card_ledger WHERE kind = 'redeem'`);
    expect(Number((ledger.rows[0] as any).c)).toBe(1);
  });

  it("a checkout without a gift card is untouched (session for the full price)", async () => {
    const r = await req("POST", "/store/checkout", { kind: "track", id: TRACK_ID });
    expect(r.status).toBe(200);
    expect(h.stripeCreates).toHaveLength(1);
    expect(h.stripeCreates[0].line_items[0].price_data.unit_amount).toBe(2000);
    expect(r.json.giftCardAppliedCents).toBe(0);
  });
});
