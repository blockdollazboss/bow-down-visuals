/**
 * Order bumps (Stack-100 #3, feature #13) — the DIGITAL STORE rail
 * (routes/store.ts). Drives the REAL store router over pg-mem with
 * Stripe faked at the `stripe` package seam and pins:
 *  - a seller attaches ONE add-on (own items only, never itself,
 *    never a series, never a free / name-your-price item); the item
 *    payload resolves the live offer at the seller-set price / % off;
 *  - checkout totals are server-computed: bump ticked → one session,
 *    two line items, flat-5% fee split across the lines via
 *    lib/order-bumps; unticked → byte-identical legacy totals; a tick
 *    with no live offer refuses (no session, no charge);
 *  - double-charge impossibility: the checkout idempotency intent
 *    includes the bump (same tick double-submit → SAME key; ticked vs
 *    unticked → different keys), and a duplicate verify records ONE
 *    sale with both download links reused, nothing re-minted;
 *  - the sale record carries the bump as its own line (bump_* columns
 *    + receipt `lines[]` on verify, purchases and sales), and an
 *    add-on that vanishes after payment still records — with the
 *    exact add-on refund owed stated;
 *  - pre-migration (no digital_bump_offers table, no bump columns):
 *    no offers anywhere, legacy checkout/verify byte-identical,
 *    attach answers an honest 500.
 *
 * Hand-computed money (fee = feeSplit(session total) at flat 5%; the
 * bump's fee is its own split, the main line absorbs the remainder):
 *  main track 2000¢ · bump track 3000¢ at 10% off = 2700 · total 4700
 *  fee total 235 · bump fee 135 / creator 2565 · main fee 100 / 1900
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-store-bumps";
process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_store_bump_route_tests";

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
    refunds = { create: async () => ({ id: "re_test" }) };
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

const DDL = (withBump: boolean) => `
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
  status text NOT NULL DEFAULT 'completed', refunded_at timestamptz${withBump ? ",\n  bump_item_kind text, bump_item_id uuid, bump_title text,\n  bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer" : ""},
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
);${withBump ? `
CREATE TABLE digital_bump_offers (
  item_kind text NOT NULL, item_id uuid NOT NULL,
  bump_kind text NOT NULL, bump_item_id uuid NOT NULL,
  percent_off integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id)
);` : ""}`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();
const OTHER_CREATOR = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const OTHER_PROFILE_ID = randomUUID();
let withBumpSchema = true;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storeRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[store-bumps] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

let MAIN: string; let BUMP: string; let VIDEO: string; let SERIES: string; let PWYW: string; let FOREIGN: string;

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  /* Join addition (Stack-100 #3): the bundles lane's purchases select
     calls jsonb_array_length for bundle_count; pg-mem doesn't ship it. */
  mem.public.registerFunction({
    name: "jsonb_array_length",
    args: ["jsonb" as never],
    returns: "integer" as never,
    implementation: (v: unknown) => (Array.isArray(v) ? v.length : 0),
  });
  mem.public.none(DDL(withBumpSchema));
  h.db = db;
  h.userId = CREATOR;
  h.userEmail = "creator@example.com";
  h.stripeCreates = [];
  h.sessions = new Map();
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`);
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${OTHER_PROFILE_ID}, ${OTHER_CREATOR}, 'other-creator', 'Other Creator')`);
  MAIN = randomUUID(); BUMP = randomUUID(); VIDEO = randomUUID();
  SERIES = randomUUID(); PWYW = randomUUID(); FOREIGN = randomUUID();
  await h.db.execute(sql`INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, audio_url) VALUES (${MAIN}, ${PROFILE_ID}, 'Golden Track', 2000, 'https://cdn.example.com/main.mp3')`);
  await h.db.execute(sql`INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, audio_url) VALUES (${BUMP}, ${PROFILE_ID}, 'Bonus Beats Pack', 3000, 'https://cdn.example.com/bump.zip')`);
  await h.db.execute(sql`INSERT INTO profile_videos (id, profile_id, title, download_price_cents, video_url) VALUES (${VIDEO}, ${PROFILE_ID}, 'Golden Video', 4000, 'https://cdn.example.com/video.mp4')`);
  await h.db.execute(sql`INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, pwyw_enabled, pwyw_min_cents, audio_url) VALUES (${PWYW}, ${PROFILE_ID}, 'Tip Jar Track', 0, true, 1000, 'https://cdn.example.com/pwyw.mp3')`);
  await h.db.execute(sql`INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, audio_url) VALUES (${FOREIGN}, ${OTHER_PROFILE_ID}, 'Foreign Track', 5000, 'https://cdn.example.com/foreign.mp3')`);
  await h.db.execute(sql`INSERT INTO playlists (id, owner_profile_id, title, price_cents, kind) VALUES (${SERIES}, ${PROFILE_ID}, 'Golden Series', 5000, 'series')`);
});

async function req(method: string, path: string, body?: unknown, as?: string) {
  if (as) { h.userId = as; h.userEmail = as === BUYER ? "buyer@example.com" : "creator@example.com"; }
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function attachMain(percentOff = 10) {
  return req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "track", bumpItemId: BUMP, percentOff }, CREATOR);
}

describe("store bumps — seller attach", () => {
  it("attaches, reports live, and detaches", async () => {
    const r = await attachMain(10);
    expect(r.status).toBe(200);
    expect(r.json.bumpConfig).toEqual({ bumpKind: "track", bumpItemId: BUMP, percentOff: 10 });
    expect(r.json.offerLive).toBe(true);
    expect(r.json.bump.priceCents).toBe(2700);

    const off = await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: null, bumpItemId: null }, CREATOR);
    expect(off.status).toBe(200);
    expect(off.json.bumpConfig).toBeNull();
    expect(off.json.offerLive).toBe(false);
  });

  it("refuses foreign targets, self, series targets, PWYW targets; non-owner 404s", async () => {
    expect((await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "track", bumpItemId: FOREIGN, percentOff: 0 }, CREATOR)).json.error).toBe("BUMP_NOT_YOURS");
    expect((await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "track", bumpItemId: MAIN, percentOff: 0 }, CREATOR)).json.error).toBe("BUMP_SELF");
    expect((await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "series", bumpItemId: SERIES, percentOff: 0 }, CREATOR)).json.error).toBe("BUMP_KIND");
    expect((await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "track", bumpItemId: PWYW, percentOff: 0 }, CREATOR)).json.error).toBe("BUMP_FREE");
    const notMine = await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "track", bumpItemId: BUMP, percentOff: 0 }, OTHER_CREATOR);
    expect(notMine.status).toBe(404);
  });

  it("a video can ride as the add-on for a track", async () => {
    const r = await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "video", bumpItemId: VIDEO, percentOff: 25 }, CREATOR);
    expect(r.status).toBe(200);
    expect(r.json.bump).toMatchObject({ kind: "video", priceCents: 3000, listPriceCents: 4000, percentOff: 25 });
  });
});

describe("store bumps — buyer offer + checkout", () => {
  it("the item payload resolves the live offer at the seller-set % off", async () => {
    await attachMain(10);
    const r = await req("GET", `/store/item/track/${MAIN}`);
    expect(r.status).toBe(200);
    expect(r.json.bump).toMatchObject({ kind: "track", id: BUMP, listPriceCents: 3000, percentOff: 10, priceCents: 2700 });
    const plain = await req("GET", `/store/item/track/${BUMP}`);
    expect(plain.json.bump).toBeNull();
  });

  it("ticked checkout: one session, two line items, totals + splits reconcile", async () => {
    await attachMain(10);
    const r = await req("POST", "/store/checkout", { kind: "track", id: MAIN, includeBump: true }, BUYER);
    expect(r.status).toBe(200);
    expect(r.json.amountCents).toBe(4700);
    expect(r.json.mainAmountCents).toBe(2000);
    expect(r.json.bump).toMatchObject({ grossCents: 2700, feeCents: 135, creatorCents: 2565 });
    expect(h.stripeCreates).toHaveLength(1);
    const create = h.stripeCreates[0];
    expect(create.params.line_items).toHaveLength(2);
    expect(create.params.line_items[1].price_data.unit_amount).toBe(2700);
    expect(create.params.line_items[1].price_data.product_data.name).toContain("(add-on)");
    expect(create.params.metadata.bump_amount_cents).toBe("2700");
    expect(create.params.metadata.platform_fee_cents).toBe("235");
    expect(create.params.metadata.creator_amount_cents).toBe("4465");
  });

  it("unticked checkout is byte-identical to the pre-feature rail", async () => {
    await attachMain(10);
    const r = await req("POST", "/store/checkout", { kind: "track", id: MAIN }, BUYER);
    expect(r.status).toBe(200);
    expect(r.json.amountCents).toBe(2000);
    expect(r.json.bump).toBeNull();
    expect(h.stripeCreates[0].params.line_items).toHaveLength(1);
    expect(h.stripeCreates[0].params.metadata.bump_amount_cents).toBe("0");
    expect(h.stripeCreates[0].params.metadata.platform_fee_cents).toBe("100");
  });

  it("a tick with no live offer refuses the checkout — no session created", async () => {
    const r = await req("POST", "/store/checkout", { kind: "track", id: MAIN, includeBump: true }, BUYER);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("BUMP_NOT_OFFERED");
    expect(h.stripeCreates).toHaveLength(0);
  });

  it("double-submit of the same ticked checkout derives the SAME idempotency key; unticked differs", async () => {
    await attachMain(10);
    await req("POST", "/store/checkout", { kind: "track", id: MAIN, includeBump: true }, BUYER);
    await req("POST", "/store/checkout", { kind: "track", id: MAIN, includeBump: true }, BUYER);
    await req("POST", "/store/checkout", { kind: "track", id: MAIN }, BUYER);
    expect(h.stripeCreates).toHaveLength(3);
    const k1 = h.stripeCreates[0].options.idempotencyKey;
    const k2 = h.stripeCreates[1].options.idempotencyKey;
    const k3 = h.stripeCreates[2].options.idempotencyKey;
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
  });

  it("a series main can carry a track bump; verify unlocks + delivers both", async () => {
    const att = await req("PUT", `/store/item/series/${SERIES}/bump`, { bumpKind: "track", bumpItemId: BUMP, percentOff: 0 }, CREATOR);
    expect(att.status).toBe(200);
    const co = await req("POST", "/store/checkout", { kind: "series", id: SERIES, includeBump: true }, BUYER);
    expect(co.status).toBe(200);
    expect(co.json.amountCents).toBe(8000);
    const v = await req("POST", "/store/verify", { sessionId: co.json.sessionId }, BUYER);
    expect(v.status).toBe(200);
    expect(v.json.access).toMatchObject({ unlocked: true });
    expect(v.json.download).toBeNull();
    expect(v.json.bumpDownload).toBeTruthy();
    expect(v.json.sale.lines).toHaveLength(2);
    expect(v.json.sale.lines[1]).toMatchObject({ kind: "bump", grossCents: 3000, platformFeeCents: 150, creatorAmountCents: 2850 });
  });
});

describe("store bumps — verify / receipts / double-charge impossibility", () => {
  async function paidSession() {
    await attachMain(10);
    const co = await req("POST", "/store/checkout", { kind: "track", id: MAIN, includeBump: true }, BUYER);
    expect(co.status).toBe(200);
    return co.json.sessionId as string;
  }

  it("verify records ONE sale with the bump as its own line; receipts reconcile", async () => {
    const sessionId = await paidSession();
    const v = await req("POST", "/store/verify", { sessionId }, BUYER);
    expect(v.status).toBe(200);
    expect(v.json.success).toBe(true);
    expect(v.json.duplicate).toBe(false);
    expect(v.json.sale.amountCents).toBe(4700);
    expect(v.json.sale.platformFeeCents).toBe(235);
    expect(v.json.sale.creatorAmountCents).toBe(4465);
    expect(v.json.sale.lines).toEqual([
      expect.objectContaining({ kind: "main", grossCents: 2000, platformFeeCents: 100, creatorAmountCents: 1900 }),
      expect.objectContaining({ kind: "bump", itemId: BUMP, title: "Bonus Beats Pack", grossCents: 2700, platformFeeCents: 135, creatorAmountCents: 2565 }),
    ]);
    expect(v.json.download?.token).toBeTruthy();
    expect(v.json.bumpDownload?.token).toBeTruthy();
    expect(v.json.bumpDownload.token).not.toBe(v.json.download.token);
    expect(v.json.bumpNote).toBeNull();

    const sales = await h.db.execute(sql`SELECT * FROM digital_sales`);
    expect(sales.rows).toHaveLength(1);
    const row = sales.rows[0] as Record<string, unknown>;
    expect(Number(row["bump_amount_cents"])).toBe(2700);
    expect(Number(row["bump_platform_fee_cents"])).toBe(135);
    expect(Number(row["bump_creator_amount_cents"])).toBe(2565);
    const links = await h.db.execute(sql`SELECT * FROM download_links`);
    expect(links.rows).toHaveLength(2);
  });

  it("duplicate verify is a pure no-op: one sale, both links reused, nothing re-minted", async () => {
    const sessionId = await paidSession();
    const v1 = await req("POST", "/store/verify", { sessionId }, BUYER);
    const v2 = await req("POST", "/store/verify", { sessionId }, BUYER);
    expect(v2.json.duplicate).toBe(true);
    expect(v2.json.sale.id).toBe(v1.json.sale.id);
    expect(v2.json.download.token).toBe(v1.json.download.token);
    expect(v2.json.bumpDownload.token).toBe(v1.json.bumpDownload.token);
    const sales = await h.db.execute(sql`SELECT * FROM digital_sales`);
    expect(sales.rows).toHaveLength(1);
    const links = await h.db.execute(sql`SELECT * FROM download_links`);
    expect(links.rows).toHaveLength(2);
  });

  it("purchases + sales carry lines[] that sum to the recorded totals", async () => {
    const sessionId = await paidSession();
    await req("POST", "/store/verify", { sessionId }, BUYER);
    const purchases = await req("GET", "/store/purchases", undefined, BUYER);
    expect(purchases.status).toBe(200);
    expect(purchases.json.purchases).toHaveLength(1);
    const pLines = purchases.json.purchases[0].lines as Array<any>;
    expect(pLines).toHaveLength(2);
    expect(pLines.reduce((s, l) => s + l.grossCents, 0)).toBe(4700);

    const salesRes = await req("GET", "/store/sales", undefined, CREATOR);
    expect(salesRes.status).toBe(200);
    expect(salesRes.json.totals.grossCents).toBe(4700);
    expect(salesRes.json.totals.creatorCents).toBe(4465);
    const sLines = salesRes.json.sales[0].lines as Array<any>;
    expect(sLines).toHaveLength(2);
    expect(sLines[1]).toMatchObject({ kind: "bump", grossCents: 2700, platformFeeCents: 135, creatorAmountCents: 2565 });
  });

  it("an add-on that vanishes after payment still records, with the exact refund owed", async () => {
    const sessionId = await paidSession();
    await h.db.execute(sql`UPDATE profile_tracks SET is_published = false WHERE id = ${BUMP}`);
    const v = await req("POST", "/store/verify", { sessionId }, BUYER);
    expect(v.status).toBe(200);
    expect(v.json.success).toBe(true);
    expect(v.json.bumpDownload).toBeNull();
    expect(v.json.bumpNote).toContain("$27.00 refund for the add-on");
    const sales = await h.db.execute(sql`SELECT * FROM digital_sales`);
    expect(sales.rows).toHaveLength(1);
    expect(Number((sales.rows[0] as any).bump_amount_cents)).toBe(2700);
  });
});

describe("store bumps — pre-migration (attachment table + bump columns absent)", () => {
  beforeAll(() => { withBumpSchema = false; });
  afterAll(() => { withBumpSchema = true; });

  it("no offers anywhere; a tick refuses; attach 500s honestly", async () => {
    const item = await req("GET", `/store/item/track/${MAIN}`);
    expect(item.status).toBe(200);
    expect(item.json.bump).toBeNull();
    const ticked = await req("POST", "/store/checkout", { kind: "track", id: MAIN, includeBump: true }, BUYER);
    expect(ticked.status).toBe(400);
    expect(ticked.json.error).toBe("BUMP_NOT_OFFERED");
    expect(h.stripeCreates).toHaveLength(0);
    const put = await req("PUT", `/store/item/track/${MAIN}/bump`, { bumpKind: "track", bumpItemId: BUMP, percentOff: 10 }, CREATOR);
    expect(put.status).toBe(500);
  });

  it("legacy checkout + verify + purchases work byte-identically", async () => {
    const co = await req("POST", "/store/checkout", { kind: "track", id: MAIN }, BUYER);
    expect(co.status).toBe(200);
    expect(co.json.amountCents).toBe(2000);
    const v = await req("POST", "/store/verify", { sessionId: co.json.sessionId }, BUYER);
    expect(v.status).toBe(200);
    expect(v.json.sale.amountCents).toBe(2000);
    expect(v.json.sale.lines).toHaveLength(1);
    const purchases = await req("GET", "/store/purchases", undefined, BUYER);
    expect(purchases.status).toBe(200);
    expect(purchases.json.purchases[0].lines).toHaveLength(1);
  });
});
