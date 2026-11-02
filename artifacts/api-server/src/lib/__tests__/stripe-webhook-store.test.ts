/**
 * stripe-webhook-store.test.ts — WEBHOOK-SETTLE (stack1200).
 *
 * The digital store was in the Gate #5 tip defect CLASS: the
 * webhook's digital-store branch ran ONLY the auto-refund probe —
 * deliverable purchases answered "not due" and fulfillment stayed
 * with /store/verify, so a buyer who closed the tab after paying
 * had no sale recorded: no download link, no license keys, no
 * bundle grants, no seller tell, no receipt.
 *
 * This suite drives the REAL webhook handler (pg-mem, harness
 * mirrors store-verify-refunded.test.ts) and pins:
 *   - a paid digital-store session records the sale and mints the
 *     download link exactly once, with NO verify call;
 *   - a replayed delivery records nothing twice;
 *   - an unpaid session records nothing;
 *   - the refunded-payment guard holds on the webhook door: a
 *     payment refunded in full before settlement delivers nothing
 *     (the branch re-retrieves the session WITH the
 *     payment_intent.latest_charge expansion, exactly as verify
 *     does, so both guard witnesses are live).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-store-webhook";

const BUYER = randomUUID();
const SELLER = randomUUID();
const PROFILE_ID = randomUUID();
const TRACK_ID = randomUUID();
const SESSION_ID = "cs_store_webhook_1";
const PI_ID = "pi_store_webhook_1";
const PRICE = 1999;

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    db: null as any,
    event: null as any,
    expandedSession: null as any,
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async () => 0),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => false),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = BUYER;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      webhooks: { constructEvent: () => h.event },
      checkout: {
        sessions: {
          create: vi.fn(async () => ({ id: "cs_unused", url: "https://checkout.example.com/pay" })),
          retrieve: vi.fn(async () => h.expandedSession),
        },
      },
      refunds: { create: vi.fn(async () => ({ id: "re_test", status: "succeeded" })) },
    })),
  };
});

vi.mock("../../routes/generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../email", () => ({
  sendEmail: async () => undefined,
  emailShell: (_title: string, html: string) => html,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
  EMAIL_COLORS: { muted: "#888", boxBorder: "#ddd", goldDeep: "#960", box: "#fff", body: "#333", ink: "#111", gold: "#c9a227" },
}));

vi.mock("../objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { createTestDb } from "./test-db";
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

function sessionObject(paymentStatus: string, expanded: boolean) {
  return {
    id: SESSION_ID,
    payment_status: paymentStatus,
    amount_total: PRICE,
    currency: "usd",
    payment_intent: expanded
      ? { id: PI_ID, latest_charge: { id: "ch_store_1", refunded: false, amount: PRICE, amount_refunded: 0 } }
      : PI_ID,
    customer_details: { email: "buyer@example.com" },
    metadata: {
      buyer_user_id: BUYER,
      profile_id: PROFILE_ID,
      item_kind: "track",
      item_id: TRACK_ID,
    },
  };
}

function storeEvent(paymentStatus: string) {
  h.expandedSession = sessionObject(paymentStatus, true);
  return {
    id: "evt_store_1",
    type: "checkout.session.completed",
    data: { object: sessionObject(paymentStatus, false) },
  };
}

async function deliver(event: unknown) {
  h.event = event;
  const res: any = { statusCode: 0, body: null as any };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  const req: any = {
    headers: { "stripe-signature": "sig_test" },
    body: Buffer.from("payload"),
  };
  await stripeWebhookHandler(req, res);
  return res;
}

async function saleCount(): Promise<number> {
  const r = await h.db.execute(sql`SELECT id FROM digital_sales WHERE stripe_session_id = ${SESSION_ID}`);
  return r.rows.length;
}
async function linkCount(): Promise<number> {
  const r = await h.db.execute(sql`SELECT token FROM download_links`);
  return r.rows.length;
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
  h.event = null;
  h.expandedSession = null;
  await h.db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name)
    VALUES (${PROFILE_ID}, ${SELLER}, 'queen-creator', 'Queen Creator')
  `);
  await h.db.execute(sql`
    INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, audio_url)
    VALUES (${TRACK_ID}, ${PROFILE_ID}, 'Golden Track', ${PRICE}, 'https://cdn.example.com/golden-track.mp3')
  `);
});

describe("stripe webhook — digital store settle (WEBHOOK-SETTLE)", () => {
  it("a paid digital-store session records the sale and mints the download link, with no verify call", async () => {
    const res = await deliver(storeEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "digital_store" });

    expect(await saleCount()).toBe(1);
    const sales = await h.db.execute(sql`SELECT buyer_user_id, amount_cents, platform_fee_cents, creator_amount_cents FROM digital_sales`);
    const sale = sales.rows[0] as any;
    expect(sale.buyer_user_id).toBe(BUYER);
    expect(sale.amount_cents).toBe(PRICE);
    expect(sale.platform_fee_cents).toBeGreaterThan(0);
    expect(sale.platform_fee_cents + sale.creator_amount_cents).toBe(PRICE);

    expect(await linkCount()).toBe(1);
    /* The seller tell fires inside the settle behind its own
       exactly-once claim and is explicitly non-fatal there (a tell
       failure never fails a recorded sale — the same posture the
       verify path has always had), so this suite pins the sale
       record itself, not the tell row. */
  });

  it("a replayed delivery records no second sale and mints no second link", async () => {
    await deliver(storeEvent("paid"));
    const res = await deliver(storeEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(await saleCount()).toBe(1);
    expect(await linkCount()).toBe(1);
  });

  it("an unpaid digital-store session records nothing", async () => {
    const res = await deliver(storeEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(await saleCount()).toBe(0);
    expect(await linkCount()).toBe(0);
  });

  it("a payment refunded in full before settlement delivers nothing (guard holds on the webhook door)", async () => {
    await h.db.execute(sql`
      INSERT INTO payment_reversals (id, stripe_payment_intent_id, refunded_cents_seen, charge_amount_cents, dispute_lost)
      VALUES (${randomUUID()}, ${PI_ID}, ${PRICE}, ${PRICE}, false)
    `);
    const res = await deliver(storeEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(await saleCount()).toBe(0);
    expect(await linkCount()).toBe(0);
  });
});
