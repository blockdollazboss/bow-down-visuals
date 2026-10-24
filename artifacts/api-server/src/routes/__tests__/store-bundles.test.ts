/**
 * Product Bundles (Stack-100 #3, feature #15) — bundles ride the SAME
 * digital store rail as tracks/videos/series (routes/store.ts):
 *   - a bundle is a playlists row with kind='bundle'; its price is the
 *     seller-set bundle price and the flat 5% fee splits ONCE, on the
 *     bundle total (splitFee / STOREFRONT_PLATFORM_FEE_BPS = 500);
 *   - buying grants EVERY component exactly once per purchase: download
 *     links against the bundle sale for tracks/videos, a completed $0
 *     'series' sale row for a series (the row IS the unlock), keyed by a
 *     "#grant:" session suffix so refunds can unwind it;
 *   - duplicate discipline follows the rail: a bundle carrying a series
 *     the buyer already owns is refused at checkout (ALREADY_OWNED, like
 *     a standalone series), track/video components re-sell freely;
 *   - a component pulled from sale takes the whole bundle off sale —
 *     a fan can never pay for a partial package;
 *   - past purchases are snapshots: /store/token re-mints from the
 *     RECORDED grants, so later bundle edits can't rewrite them.
 *
 * Fake-db style mirrors paid-series-store.test.ts (db.execute dispatched
 * on the rendered SQL text) with Stripe mocked at the boundary.
 * NOTE: prod additionally needs migration 0205 to widen the
 * digital_sales item_kind CHECK to include 'bundle' — the fake db here
 * models the post-migration constraint (see .lane/f15/migration-needed.md).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_bundles";

const CREATOR_USER = "20000000-0000-4000-8000-0000000000c1";
const OTHER_USER = "20000000-0000-4000-8000-0000000000c2";
const BUYER_USER = "20000000-0000-4000-8000-0000000000b1";
const CREATOR_PROFILE = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE = "22222222-2222-4222-8222-222222222222";
const TRACK1 = "31313131-3131-4131-8131-313131313131";
const TRACK2 = "32323232-3232-4232-8232-323232323232";
const VIDEO1 = "34343434-3434-4434-8434-343434343434";
const SERIES1 = "35353535-3535-4535-8535-353535353535";
const OTHER_TRACK = "36363636-3636-4636-8636-363636363636";
const BUNDLE_ID = "37373737-3737-4737-8737-373737373737";

const BUNDLE_PRICE = 1299; /* sum 500+999+1999 = 3498 → saving 2199 */
const BUNDLE_FEE = 65;     /* round(1299 * 500 / 10000) */
const BUNDLE_CREATOR = 1234;

const h = vi.hoisted(() => ({
  tracks: new Map<string, any>(),
  videos: new Map<string, any>(),
  playlists: new Map<string, any>(),
  sales: [] as Array<Record<string, any>>,
  links: [] as Array<Record<string, any>>,
  emails: [] as Array<any>,
  nextSale: 1,
  nextPlaylist: 1,
  stripe: {
    createCalls: [] as Array<{ params: any; options: any }>,
    refundCalls: [] as Array<{ params: any; options: any }>,
    session: null as any,
    sessionId: "cs_test_checkout_bundle",
  },
}));

const dialect = new PgDialect();

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (typeof user !== "string" || !user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => next(),
}));

vi.mock("../generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../../lib/job-notifications", () => ({
  createJobNotification: vi.fn(async () => undefined),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: vi.fn(async (args: any) => { h.emails.push(args); }),
  emailShell: (_title: string, inner: string) => inner,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://bowdownvisuals.test",
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, options: any) => {
          h.stripe.createCalls.push({ params, options });
          return { id: h.stripe.sessionId, url: "https://checkout.stripe.test/pay" };
        },
        retrieve: async (_id: string) => h.stripe.session,
      },
    };
    refunds = {
      create: async (params: any, options: any) => {
        h.stripe.refundCalls.push({ params, options });
        return { id: "re_fake" };
      },
    };
    paymentIntents = { retrieve: async () => ({ latest_charge: null }) };
    charges = { retrieve: async () => ({ receipt_url: null }) };
  },
}));

function artistFor(profileId: string) {
  return profileId === OTHER_PROFILE
    ? { artist_name: "Other Creator", artist_slug: "other-creator" }
    : { artist_name: "Queen Creator", artist_slug: "queen-creator" };
}

function titleOf(kind: string, id: string): string {
  if (kind === "track") return h.tracks.get(id)?.title ?? "Content";
  if (kind === "video") return h.videos.get(id)?.title ?? "Content";
  return h.playlists.get(id)?.title ?? "Content";
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();

  const fakeDb = {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never) as {
        sql: string; params: unknown[];
      };

      /* ── writes ─────────────────────────────────────────────────── */
      if (text.includes("INSERT INTO digital_sales")) {
        const [buyer, profileId] = params;
        /* The bundle grant insert carries 'series' and 0,0,0 as SQL
           literals, so only 4 params render: buyer, profile, item, key. */
        const isGrant = params.length === 4;
        const kind = isGrant ? "series" : params[2];
        const itemId = isGrant ? params[2] : params[3];
        const sessionId = isGrant ? params[3] : params[4];
        const amount = isGrant ? 0 : params[5];
        const fee = isGrant ? 0 : params[6];
        const creator = isGrant ? 0 : params[7];
        if (h.sales.some((s) => s.stripeSessionId === sessionId)) {
          return { rows: [] }; /* ON CONFLICT (stripe_session_id) DO NOTHING */
        }
        const id = `51515151-5151-4151-8151-${String(h.nextSale++).padStart(12, "0")}`;
        h.sales.push({
          id, buyerUserId: buyer, profileId, itemKind: kind, itemId,
          stripeSessionId: sessionId, amountCents: amount,
          platformFeeCents: fee, creatorAmountCents: creator,
          status: "completed", refundedAt: null,
        });
        return { rows: [{ id }] };
      }

      if (text.includes("INSERT INTO download_links")) {
        const [token, saleId, fileUrl, expiresAt] = params;
        h.links.push({ token, sale_id: saleId, file_url: fileUrl, expires_at: expiresAt, used_count: 0 });
        return { rows: [] };
      }

      if (text.includes("INSERT INTO playlists")) {
        const [owner, title, description, cover, isPublic, priceCents, itemsJson] = params;
        const id = `61616161-6161-4161-8161-${String(h.nextPlaylist++).padStart(12, "0")}`;
        h.playlists.set(id, {
          id, owner_profile_id: owner, title, description,
          cover_url: cover, is_public: isPublic, kind: "bundle",
          price_cents: priceCents, items: JSON.parse(String(itemsJson)),
        });
        return { rows: [{ id, created_at: "2026-10-24T00:00:00.000Z" }] };
      }

      if (text.includes("UPDATE playlists")) {
        const [title, description, cover, isPublic, priceCents, itemsJson, id, owner] = params;
        const row = h.playlists.get(String(id));
        if (row && row.owner_profile_id === owner) {
          Object.assign(row, {
            title, description, cover_url: cover, is_public: isPublic,
            price_cents: priceCents, items: JSON.parse(String(itemsJson)),
          });
        }
        return { rows: [] };
      }

      /* ── verify / token reads ───────────────────────────────────── */
      if (text.includes("SELECT status FROM digital_sales WHERE id")) {
        const sale = h.sales.find((s) => s.id === params[0]);
        return { rows: sale ? [{ status: sale.status }] : [] };
      }

      if (text.includes("SELECT stripe_session_id FROM digital_sales WHERE id")) {
        const sale = h.sales.find((s) => s.id === params[0]);
        return { rows: sale ? [{ stripe_session_id: sale.stripeSessionId }] : [] };
      }

      if (text.includes("SELECT id FROM digital_sales WHERE stripe_session_id")) {
        const sale = h.sales.find((s) => s.stripeSessionId === params[0]);
        return { rows: sale ? [{ id: sale.id }] : [] };
      }

      if (text.includes("SELECT DISTINCT file_url FROM download_links")) {
        const seen = new Set<string>();
        const rows: { file_url: string }[] = [];
        for (const l of h.links) {
          if (l.sale_id === params[0] && !seen.has(l.file_url)) {
            seen.add(l.file_url);
            rows.push({ file_url: l.file_url });
          }
        }
        return { rows };
      }

      if (text.includes("substring(stripe_session_id")) {
        /* params: (buyer, prefixLength, prefix). */
        const prefix = String(params[2]);
        const rows = h.sales
          .filter((s) => s.buyerUserId === params[0] && s.itemKind === "series"
            && s.status === "completed" && String(s.stripeSessionId).startsWith(prefix))
          .map((s) => ({ item_id: s.itemId, item_kind: s.itemKind }));
        return { rows };
      }

      if (text.includes("SELECT token, expires_at FROM download_links")) {
        const now = Date.now();
        const live = h.links
          .filter((l) => l.sale_id === params[0] && l.file_url === params[1]
            && new Date(l.expires_at).getTime() > now && l.used_count < 5)
          .sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)));
        return { rows: live.length ? [{ token: live[0].token, expires_at: live[0].expires_at }] : [] };
      }

      if (text.includes("WHERE ds.id =")) {
        const sale = h.sales.find((s) =>
          s.id === params[0] && s.buyerUserId === params[1] && s.status !== "refunded");
        return {
          rows: sale
            ? [{ id: sale.id, item_kind: sale.itemKind, item_id: sale.itemId, stripe_session_id: sale.stripeSessionId }]
            : [],
        };
      }

      /* ── counts ─────────────────────────────────────────────────── */
      if (text.includes("COUNT(*)::int AS c") && text.includes("status = 'completed'")) {
        const c = h.sales.filter((s) =>
          s.buyerUserId === params[0] && s.itemKind === "series"
          && s.itemId === params[1] && s.status === "completed").length;
        return { rows: [{ c }] };
      }

      if (text.includes("COUNT(*)::int AS c") && text.includes("item_kind = 'bundle'")) {
        const c = h.sales.filter((s) => s.itemKind === "bundle" && s.itemId === params[0]).length;
        return { rows: [{ c }] };
      }

      if (text.includes("COUNT(*)::int AS c") && text.includes("amount_cents")) {
        const c = h.sales.filter((s) =>
          s.buyerUserId === params[0] && s.itemKind === params[1]
          && s.itemId === params[2]).length;
        return { rows: [{ c }] };
      }

      /* ── profiles ───────────────────────────────────────────────── */
      if (text.includes("display_name FROM creator_profiles")) {
        return { rows: [{ user_id: params[0], display_name: "Fan One" }] };
      }

      if (text.includes("SELECT id, slug FROM creator_profiles")) {
        if (params[0] === CREATOR_USER) return { rows: [{ id: CREATOR_PROFILE, slug: "queen-creator" }] };
        if (params[0] === OTHER_USER) return { rows: [{ id: OTHER_PROFILE, slug: "other-creator" }] };
        return { rows: [] };
      }

      /* ── purchases / sales lists ────────────────────────────────── */
      if (text.includes("LEFT JOIN playlists")) {
        const forSales = text.includes("WHERE ds.profile_id");
        const rows = h.sales
          .filter((s) => (forSales ? s.profileId === params[0] : s.buyerUserId === params[0]))
          .map((s) => {
            const pl = h.playlists.get(s.itemId);
            return {
              id: s.id, item_kind: s.itemKind, item_id: s.itemId,
              amount_cents: s.amountCents, platform_fee_cents: s.platformFeeCents,
              creator_amount_cents: s.creatorAmountCents,
              created_at: "2026-10-24T00:00:00.000Z",
              stripe_session_id: s.stripeSessionId,
              item_title: titleOf(s.itemKind, s.itemId),
              artwork_url: null,
              ...artistFor(s.profileId),
              bundle_count: s.itemKind === "bundle" ? (pl?.items?.length ?? 0) : null,
            };
          });
        return { rows };
      }

      if (text.includes("GROUP BY ds.item_kind")) return { rows: [] };
      if (text.includes("FROM money_entries")) return { rows: [] };

      /* ── bundle management reads ────────────────────────────────── */
      if (text.includes("FROM playlists") && text.includes("kind = 'bundle'") && text.includes("LIMIT 1")) {
        const row = h.playlists.get(String(params[0]));
        return { rows: row && row.kind === "bundle" ? [row] : [] };
      }

      if (text.includes("FROM playlists") && text.includes("kind = 'series'") && text.includes("SELECT id FROM")) {
        const rows = [...h.playlists.values()]
          .filter((p) => p.owner_profile_id === params[0] && p.kind === "series" && p.is_public && p.price_cents > 0)
          .map((p) => ({ id: p.id }));
        return { rows };
      }

      if (text.includes("FROM playlists") && text.includes("ORDER BY created_at DESC")) {
        const rows = [...h.playlists.values()]
          .filter((p) => p.owner_profile_id === params[0] && p.kind === "bundle");
        return { rows };
      }

      if (text.includes("SELECT id FROM profile_tracks")) {
        const rows = [...h.tracks.values()]
          .filter((t) => t.profile_id === params[0] && t.is_published && t.file_url)
          .map((t) => ({ id: t.id }));
        return { rows };
      }

      if (text.includes("SELECT id FROM profile_videos")) {
        const rows = [...h.videos.values()]
          .filter((v) => v.profile_id === params[0] && v.is_published && v.file_url)
          .map((v) => ({ id: v.id }));
        return { rows };
      }

      /* ── light component rows (seller desk) ─────────────────────── */
      if (text.includes("SELECT title, price_cents, is_public FROM playlists")) {
        const row = h.playlists.get(String(params[0]));
        return {
          rows: row
            ? [{ title: row.title, price_cents: row.price_cents, is_public: row.is_public }]
            : [],
        };
      }

      if (text.includes("SELECT title, download_price_cents")) {
        const src = text.includes("profile_videos") ? h.videos : h.tracks;
        const row = src.get(String(params[0]));
        return {
          rows: row
            ? [{
                title: row.title, download_price_cents: row.download_price_cents,
                pwyw_enabled: row.pwyw_enabled, pwyw_min_cents: row.pwyw_min_cents,
                is_published: row.is_published, file_url: row.file_url,
              }]
            : [],
        };
      }

      /* ── resolvers ──────────────────────────────────────────────── */
      if (text.includes("FROM playlists pl")) {
        const row = h.playlists.get(String(params[0]));
        if (!row) return { rows: [] };
        return {
          rows: [{
            id: row.id, profile_id: row.owner_profile_id, title: row.title,
            price_cents: row.price_cents, is_public: row.is_public,
            playlist_kind: row.kind, items: row.items,
            artwork_url: row.cover_url, ...artistFor(row.owner_profile_id),
          }],
        };
      }

      if (text.includes("FROM profile_tracks m") || text.includes("FROM profile_videos m")) {
        const src = text.includes("profile_tracks m") ? h.tracks : h.videos;
        const row = src.get(String(params[0]));
        if (!row) return { rows: [] };
        return {
          rows: [{
            id: row.id, profile_id: row.profile_id, title: row.title,
            download_price_cents: row.download_price_cents,
            is_published: row.is_published, pwyw_enabled: row.pwyw_enabled,
            pwyw_min_cents: row.pwyw_min_cents, file_url: row.file_url,
            artwork_url: null, ...artistFor(row.profile_id),
          }],
        };
      }

      if (text.includes("FROM playlists")) {
        const row = h.playlists.get(String(params[0]));
        return { rows: row ? [row] : [] };
      }

      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const { default: storeRouter } = await import("../store");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", storeRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}, 30_000);

function seedCatalog() {
  h.tracks.set(TRACK1, {
    id: TRACK1, profile_id: CREATOR_PROFILE, title: "Midnight Crown",
    download_price_cents: 500, is_published: true, pwyw_enabled: false,
    pwyw_min_cents: 0, file_url: "https://cdn.example.com/t1.mp3",
  });
  h.tracks.set(TRACK2, {
    id: TRACK2, profile_id: CREATOR_PROFILE, title: "Second Verse",
    download_price_cents: 300, is_published: true, pwyw_enabled: false,
    pwyw_min_cents: 0, file_url: "https://cdn.example.com/t2.mp3",
  });
  h.tracks.set(OTHER_TRACK, {
    id: OTHER_TRACK, profile_id: OTHER_PROFILE, title: "Not Yours",
    download_price_cents: 400, is_published: true, pwyw_enabled: false,
    pwyw_min_cents: 0, file_url: "https://cdn.example.com/other.mp3",
  });
  h.videos.set(VIDEO1, {
    id: VIDEO1, profile_id: CREATOR_PROFILE, title: "Throne Room (Video)",
    download_price_cents: 999, is_published: true, pwyw_enabled: false,
    pwyw_min_cents: 0, file_url: "https://cdn.example.com/v1.mp4",
  });
  h.playlists.set(SERIES1, {
    id: SERIES1, owner_profile_id: CREATOR_PROFILE, title: "Crown City",
    description: "", cover_url: null, is_public: true, kind: "series",
    price_cents: 1999, items: [],
  });
  h.playlists.set(BUNDLE_ID, {
    id: BUNDLE_ID, owner_profile_id: CREATOR_PROFILE, title: "The Full Coronation",
    description: "Everything in one drop.", cover_url: null, is_public: true,
    kind: "bundle", price_cents: BUNDLE_PRICE,
    items: [
      { kind: "track", id: TRACK1 },
      { kind: "video", id: VIDEO1 },
      { kind: "series", id: SERIES1 },
    ],
  });
}

beforeEach(() => {
  h.tracks.clear();
  h.videos.clear();
  h.playlists.clear();
  h.sales = [];
  h.links = [];
  h.emails = [];
  h.nextSale = 1;
  h.nextPlaylist = 1;
  h.stripe.createCalls = [];
  h.stripe.refundCalls = [];
  h.stripe.session = null;
  seedCatalog();
});

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function bundlePaidSession(over: Record<string, any> = {}) {
  return {
    id: "cs_test_paid_bundle", mode: "payment", payment_status: "paid",
    amount_total: BUNDLE_PRICE, currency: "usd", payment_intent: "pi_b1",
    customer_details: { email: "fan@example.com" },
    metadata: {
      buyer_user_id: BUYER_USER, profile_id: CREATOR_PROFILE,
      item_kind: "bundle", item_id: BUNDLE_ID,
      platform_fee_cents: String(BUNDLE_FEE), creator_amount_cents: String(BUNDLE_CREATOR),
    },
    ...over,
  };
}

describe("GET /api/store/item/bundle/:id", () => {
  it("itemizes contents, the bought-separately total and the honest saving", async () => {
    const { status, json } = await call("GET", `/store/item/bundle/${BUNDLE_ID}`);
    expect(status).toBe(200);
    expect(json.item.kind).toBe("bundle");
    expect(json.item.priceCents).toBe(BUNDLE_PRICE);
    expect(json.bundle.sumCents).toBe(3498);
    expect(json.bundle.savingsCents).toBe(2199);
    expect(json.bundle.contents.map((c: any) => c.title)).toEqual([
      "Midnight Crown", "Throne Room (Video)", "Crown City",
    ]);
    expect(json.bundle.contents.map((c: any) => c.listPriceCents)).toEqual([500, 999, 1999]);
    expect(json.feeSplit.platformFeePct).toBe(5);
  });

  it("a component pulled from sale takes the whole bundle off sale", async () => {
    h.tracks.get(TRACK1).is_published = false;
    const { status } = await call("GET", `/store/item/bundle/${BUNDLE_ID}`);
    expect(status).toBe(404);
  });

  it("a bundle with fewer than 2 components is not for sale", async () => {
    h.playlists.get(BUNDLE_ID).items = [{ kind: "track", id: TRACK1 }];
    const { status } = await call("GET", `/store/item/bundle/${BUNDLE_ID}`);
    expect(status).toBe(404);
  });

  it("a private bundle is not for sale", async () => {
    h.playlists.get(BUNDLE_ID).is_public = false;
    const { status } = await call("GET", `/store/item/bundle/${BUNDLE_ID}`);
    expect(status).toBe(404);
  });
});

describe("POST /api/store/checkout — bundle", () => {
  it("charges the bundle total with the 5% fee split once, on the total", async () => {
    const { status } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "bundle", id: BUNDLE_ID },
    });
    expect(status).toBe(200);
    expect(h.stripe.createCalls).toHaveLength(1);
    const { params } = h.stripe.createCalls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(BUNDLE_PRICE);
    expect(params.metadata.item_kind).toBe("bundle");
    expect(params.metadata.platform_fee_cents).toBe(String(BUNDLE_FEE));
    expect(params.metadata.creator_amount_cents).toBe(String(BUNDLE_CREATOR));
  });

  it("refuses the bundle when the buyer already owns its series (ALREADY_OWNED)", async () => {
    h.sales.push({
      id: "51515151-5151-4151-8151-000000000099", buyerUserId: BUYER_USER,
      profileId: CREATOR_PROFILE, itemKind: "series", itemId: SERIES1,
      stripeSessionId: "cs_test_owned_series", amountCents: 1999,
      platformFeeCents: 100, creatorAmountCents: 1899,
      status: "completed", refundedAt: null,
    });
    const { status, json } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "bundle", id: BUNDLE_ID },
    });
    expect(status).toBe(409);
    expect(json.error).toBe("ALREADY_OWNED");
    expect(json.watchUrl).toBe(`/playlist/${SERIES1}`);
    expect(h.stripe.createCalls).toHaveLength(0);
  });

  it("a refunded series unlock does not block the bundle", async () => {
    h.sales.push({
      id: "51515151-5151-4151-8151-000000000098", buyerUserId: BUYER_USER,
      profileId: CREATOR_PROFILE, itemKind: "series", itemId: SERIES1,
      stripeSessionId: "cs_test_refunded_series", amountCents: 1999,
      platformFeeCents: 100, creatorAmountCents: 1899,
      status: "refunded", refundedAt: new Date(),
    });
    const { status } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "bundle", id: BUNDLE_ID },
    });
    expect(status).toBe(200);
    expect(h.stripe.createCalls).toHaveLength(1);
  });

  it("already owning a track component never blocks (downloads re-sell)", async () => {
    h.sales.push({
      id: "51515151-5151-4151-8151-000000000097", buyerUserId: BUYER_USER,
      profileId: CREATOR_PROFILE, itemKind: "track", itemId: TRACK1,
      stripeSessionId: "cs_test_owned_track", amountCents: 500,
      platformFeeCents: 25, creatorAmountCents: 475,
      status: "completed", refundedAt: null,
    });
    const { status } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "bundle", id: BUNDLE_ID },
    });
    expect(status).toBe(200);
  });
});

describe("POST /api/store/verify — bundle grants", () => {
  it("grants every component exactly once: 2 download links + 1 series unlock row", async () => {
    h.stripe.session = bundlePaidSession();
    const { status, json } = await call("POST", "/store/verify", {
      user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" },
    });
    expect(status).toBe(200);
    expect(json.sale.amountCents).toBe(BUNDLE_PRICE);
    expect(json.sale.platformFeeCents).toBe(BUNDLE_FEE);
    expect(json.sale.creatorAmountCents).toBe(BUNDLE_CREATOR);
    expect(json.download).toBeNull();
    expect(json.bundle.downloads).toHaveLength(2);
    expect(json.bundle.downloads.map((d: any) => d.title).sort())
      .toEqual(["Midnight Crown", "Throne Room (Video)"]);
    expect(json.bundle.unlockedSeries).toEqual([
      { id: SERIES1, title: "Crown City", watchUrl: `/playlist/${SERIES1}` },
    ]);
    /* Ledger: ONE bundle sale + ONE $0 grant row for the series. */
    expect(h.sales).toHaveLength(2);
    const grant = h.sales.find((s) => s.itemKind === "series");
    expect(grant?.itemId).toBe(SERIES1);
    expect(grant?.amountCents).toBe(0);
    expect(grant?.stripeSessionId).toBe(`cs_test_paid_bundle#grant:series:${SERIES1}`);
    expect(h.links).toHaveLength(2);
  });

  it("a double verify grants nothing twice (links reused, grant ON CONFLICT)", async () => {
    h.stripe.session = bundlePaidSession();
    await call("POST", "/store/verify", { user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" } });
    const second = await call("POST", "/store/verify", {
      user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" },
    });
    expect(second.json.duplicate).toBe(true);
    expect(h.sales).toHaveLength(2);
    expect(h.links).toHaveLength(2);
    expect(second.json.bundle.downloads).toHaveLength(2);
    expect(second.json.bundle.unlockedSeries).toHaveLength(1);
  });

  it("the receipt email itemizes the bundle contents and the saving", async () => {
    h.stripe.session = bundlePaidSession();
    await call("POST", "/store/verify", { user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" } });
    expect(h.emails).toHaveLength(1);
    const html = h.emails[0].html as string;
    expect(html).toContain("Midnight Crown");
    expect(html).toContain("Throne Room (Video)");
    expect(html).toContain("Crown City");
    expect(html).toContain("Bought separately");
    expect(html).toContain("You saved");
    expect(html).toContain("$21.99");
  });

  it("a component pulled between payment and verify auto-refunds, no partial grants", async () => {
    h.stripe.session = bundlePaidSession();
    h.videos.get(VIDEO1).is_published = false;
    const { status, json } = await call("POST", "/store/verify", {
      user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" },
    });
    expect(status).toBe(400);
    expect(json.refunded).toBe(true);
    expect(h.stripe.refundCalls).toHaveLength(1);
    expect(h.sales).toHaveLength(0);
    expect(h.links).toHaveLength(0);
  });

  it("re-buying the bundle after owning its series is refused at checkout (grant counts as owned)", async () => {
    h.stripe.session = bundlePaidSession();
    await call("POST", "/store/verify", { user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" } });
    const { status, json } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "bundle", id: BUNDLE_ID },
    });
    expect(status).toBe(409);
    expect(json.error).toBe("ALREADY_OWNED");
  });
});

describe("POST /api/store/token — bundle re-delivery from recorded grants", () => {
  async function buyBundle() {
    h.stripe.session = bundlePaidSession();
    const v = await call("POST", "/store/verify", {
      user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" },
    });
    return v.json.sale.id as string;
  }

  it("re-mints per-component links and lists the series unlock", async () => {
    const saleId = await buyBundle();
    const { status, json } = await call("POST", "/store/token", {
      user: BUYER_USER, body: { saleId },
    });
    expect(status).toBe(200);
    expect(json.bundle).toBe(true);
    expect(json.downloads).toHaveLength(2);
    expect(json.unlockedSeries).toEqual([
      { id: SERIES1, title: "Crown City", watchUrl: `/playlist/${SERIES1}` },
    ]);
  });

  it("bundle edits after purchase do not rewrite the recorded grants", async () => {
    const saleId = await buyBundle();
    /* Seller swaps the video out of the live bundle and reprices it. */
    h.playlists.get(BUNDLE_ID).items = [
      { kind: "track", id: TRACK1 },
      { kind: "track", id: TRACK2 },
      { kind: "series", id: SERIES1 },
    ];
    h.playlists.get(BUNDLE_ID).price_cents = 4999;
    const { status, json } = await call("POST", "/store/token", {
      user: BUYER_USER, body: { saleId },
    });
    expect(status).toBe(200);
    /* Still the ORIGINAL two files (track + the removed video), not TRACK2. */
    expect(json.downloads).toHaveLength(2);
    const files = h.links.filter((l) => l.sale_id === saleId).map((l) => l.file_url);
    expect(new Set(files)).toEqual(new Set([
      "https://cdn.example.com/t1.mp3", "https://cdn.example.com/v1.mp4",
    ]));
    expect(json.unlockedSeries).toHaveLength(1);
  });

  it("a refunded bundle sale re-delivers nothing", async () => {
    const saleId = await buyBundle();
    h.sales.find((s) => s.id === saleId)!.status = "refunded";
    const { status } = await call("POST", "/store/token", {
      user: BUYER_USER, body: { saleId },
    });
    expect(status).toBe(404);
  });
});

describe("bundle surfaces — purchases + sales dashboards", () => {
  it("the buyer's library shows the bundle with its title and item count", async () => {
    h.stripe.session = bundlePaidSession();
    await call("POST", "/store/verify", { user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" } });
    const { status, json } = await call("GET", "/store/purchases", { user: BUYER_USER });
    expect(status).toBe(200);
    const row = json.purchases.find((p: any) => p.itemKind === "bundle");
    expect(row.title).toBe("The Full Coronation");
    expect(row.bundleItemCount).toBe(3);
    expect(row.amountCents).toBe(BUNDLE_PRICE);
  });

  it("the creator's sales dashboard shows the bundle sale at the bundle total", async () => {
    h.stripe.session = bundlePaidSession();
    await call("POST", "/store/verify", { user: BUYER_USER, body: { sessionId: "cs_test_paid_bundle" } });
    const { status, json } = await call("GET", "/store/sales", { user: CREATOR_USER });
    expect(status).toBe(200);
    const row = json.sales.find((s: any) => s.itemKind === "bundle");
    expect(row.itemTitle).toBe("The Full Coronation");
    expect(row.grossCents).toBe(BUNDLE_PRICE);
    expect(row.platformFeeCents).toBe(BUNDLE_FEE);
    expect(row.creatorCents).toBe(BUNDLE_CREATOR);
  });
});

describe("bundle management — POST / GET / PATCH /api/store/bundles", () => {
  it("creates a bundle from the seller's own sellable items", async () => {
    const { status, json } = await call("POST", "/store/bundles", {
      user: CREATOR_USER,
      body: {
        title: "Starter Pack", priceCents: 999,
        items: [{ kind: "track", id: TRACK1 }, { kind: "track", id: TRACK2 }],
      },
    });
    expect(status).toBe(201);
    expect(json.bundle.title).toBe("Starter Pack");
    expect(json.bundle.sumCents).toBe(800);
    expect(json.bundle.savingsCents).toBe(0); /* priced ABOVE the sum → no saving claimed */
    expect(json.bundle.contents).toHaveLength(2);
    expect(json.bundle.buyUrl).toContain("/store/buy/bundle/");
  });

  it("refuses a bundle containing someone else's product", async () => {
    const { status, json } = await call("POST", "/store/bundles", {
      user: CREATOR_USER,
      body: {
        title: "Stolen Pack", priceCents: 999,
        items: [{ kind: "track", id: TRACK1 }, { kind: "track", id: OTHER_TRACK }],
      },
    });
    expect(status).toBe(403);
    expect(json.error).toBe("NOT_YOUR_ITEM");
  });

  it("refuses a one-item bundle and a duplicate component", async () => {
    const one = await call("POST", "/store/bundles", {
      user: CREATOR_USER,
      body: { title: "Solo", priceCents: 999, items: [{ kind: "track", id: TRACK1 }] },
    });
    expect(one.status).toBe(400);
    const dup = await call("POST", "/store/bundles", {
      user: CREATOR_USER,
      body: {
        title: "Twin", priceCents: 999,
        items: [{ kind: "track", id: TRACK1 }, { kind: "track", id: TRACK1 }],
      },
    });
    expect(dup.status).toBe(400);
    expect(dup.json.error).toBe("DUPLICATE_COMPONENT");
  });

  it("lists the seller's bundles with the sellable component catalog", async () => {
    const { status, json } = await call("GET", "/store/bundles", { user: CREATOR_USER });
    expect(status).toBe(200);
    expect(json.bundles).toHaveLength(1);
    expect(json.bundles[0].sellable).toBe(true);
    expect(json.bundles[0].salesCount).toBe(0);
    const catalog = (json.sellable as any[]).map((s) => `${s.kind}:${s.id}`).sort();
    expect(catalog).toEqual([
      `series:${SERIES1}`, `track:${TRACK1}`, `track:${TRACK2}`, `video:${VIDEO1}`,
    ].sort());
  });

  it("a pulled component flags the bundle not-sellable on the seller's desk", async () => {
    h.videos.get(VIDEO1).is_published = false;
    const { json } = await call("GET", "/store/bundles", { user: CREATOR_USER });
    expect(json.bundles[0].sellable).toBe(false);
    const video = json.bundles[0].contents.find((c: any) => c.kind === "video");
    expect(video.sellable).toBe(false);
  });

  it("PATCH reprices the bundle for future sales and says so", async () => {
    const { status, json } = await call("PATCH", `/store/bundles/${BUNDLE_ID}`, {
      user: CREATOR_USER, body: { priceCents: 1499 },
    });
    expect(status).toBe(200);
    expect(json.bundle.priceCents).toBe(1499);
    expect(json.note).toContain("past buyers keep");
    const item = await call("GET", `/store/item/bundle/${BUNDLE_ID}`);
    expect(item.json.item.priceCents).toBe(1499);
  });

  it("PATCH by a non-owner is refused", async () => {
    const { status } = await call("PATCH", `/store/bundles/${BUNDLE_ID}`, {
      user: OTHER_USER, body: { priceCents: 100 },
    });
    expect(status).toBe(403);
  });

  it("a user without a creator profile can't create bundles", async () => {
    const { status, json } = await call("POST", "/store/bundles", {
      user: BUYER_USER,
      body: {
        title: "Nope", priceCents: 999,
        items: [{ kind: "track", id: TRACK1 }, { kind: "track", id: TRACK2 }],
      },
    });
    expect(status).toBe(404);
    expect(json.error).toBe("NO_PROFILE");
  });
});
