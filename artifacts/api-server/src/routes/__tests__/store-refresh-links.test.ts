/**
 * Route tests for the creator store (routes/store.ts):
 * storage-ref artwork refresh + creator-link namespace.
 *
 * DEFECT GROUP 1 — raw storage refs in artworkUrl: GET /store/item,
 * GET /store/purchases and GET /store/products sourced artworkUrl RAW
 * from profile_tracks.artwork_url / profile_videos.thumbnail_url,
 * which can be an r2:// / supabase:// storage ref a client cannot
 * render. Sibling read endpoints refresh at the response boundary.
 * The Stripe checkout image for /store/item flows from the same stored
 * value — an r2:// ref is unfetchable by Stripe, a signed URL works.
 *
 * DEFECT GROUP 2 — creator links pointed at the NFC-card namespace:
 * /c/:slug renders "This card isn't active" for creator profiles; the
 * canonical profile path is /artist/:slug. Every artistUrl /
 * profileUrl / checklist profile href in store.ts must use /artist/.
 *
 * The objectStorage mock below SIMULATES the real helpers' contract
 * (a ref string becomes a fresh signed https URL; everything else
 * passes through) rather than mocking them as identity — an identity
 * mock could never catch a missing refresh call.
 *
 * Fake-db style mirrors challenge-engine-refresh.test.ts: real
 * exports via importOriginal, db.execute dispatched on the flattened
 * SQL text (PgDialect) the handler emitted.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const SALE_ID = "44444444-4444-4444-8444-444444444444";
const ARTIST_SLUG = "queen-creator";
const SIGNED_TRACK_ART = "https://signed.example.com/media/artwork/track.jpg?sig=test";
const SIGNED_PURCHASE_ART = "https://signed.example.com/media/artwork/bought.jpg?sig=test";
const SIGNED_VIDEO_THUMB = "https://signed.example.com/media/thumbs/video.jpg?sig=test";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  state: {
    stripeCreateParams: null as any,
    stripeSession: null as any,
  },
}));

process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_store_route_tests";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

vi.mock("../generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 1000,
}));

vi.mock("../../lib/job-notifications", () => ({
  createJobNotification: async () => undefined,
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (_title: string, html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
}));

/* Simulated refresh: refs (r2:// / supabase://) become signed https
   URLs; plain objects/arrays are walked; Dates and other values pass
   through untouched — mirroring refreshSupabaseStorageUrl(sDeep). */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}
async function deepRefresh(v: unknown): Promise<unknown> {
  if (typeof v === "string") {
    return v.startsWith("r2://") || v.startsWith("supabase://") ? signedFor(v) : v;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => deepRefresh(x)));
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const entries = await Promise.all(
        Object.entries(v as Record<string, unknown>).map(
          async ([k, val]) => [k, await deepRefresh(val)] as const,
        ),
      );
      return Object.fromEntries(entries);
    }
  }
  return v;
}

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? signedFor(v)
      : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any) => {
          h.state.stripeCreateParams = params;
          return { id: "cs_test_123", url: "https://checkout.example.com/cs_test_123" };
        },
        retrieve: async () => h.state.stripeSession,
      },
    };
  }
  return { default: FakeStripe };
});

function sellableRow(): Record<string, unknown> {
  return {
    id: TRACK_ID,
    profile_id: PROFILE_ID,
    title: "Golden Track",
    download_price_cents: 199,
    is_published: true,
    file_url: "r2://media/audio/track.mp3",
    artwork_url: "r2://media/artwork/track.jpg",
    artist_name: "Queen Creator",
    artist_slug: ARTIST_SLUG,
  };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();

  const fakeDb: any = {
    execute: async (q: unknown) => {
      const { sql: text } = dialect.sqlToQuery(q as never);
      // resolveSellableItem (item / checkout / verify / suggest-price) —
      // keyed on its unique `AS file_url` projection (the purchases query
      // also selects artist_slug, so that column alone cannot dispatch).
      if (text.includes("AS file_url")) return { rows: [sellableRow()] };
      // verify: record the sale + mint the download link
      if (text.includes("INSERT INTO digital_sales")) return { rows: [{ id: SALE_ID }] };
      if (text.includes("INSERT INTO download_links")) return { rows: [] };
      if (text.includes("SELECT id FROM digital_sales")) return { rows: [{ id: SALE_ID }] };
      // verify: creator lookup for the sale notification (same user → skipped)
      if (text.includes("SELECT user_id, display_name FROM creator_profiles")) {
        return { rows: [{ user_id: VIEWER_ID, display_name: "Queen Creator" }] };
      }
      // purchases: joined sales + COALESCE artwork
      if (text.includes("COALESCE(t.artwork_url")) {
        return {
          rows: [
            {
              id: SALE_ID,
              item_kind: "track",
              item_id: TRACK_ID,
              amount_cents: 199,
              created_at: "2026-10-14T15:04:05.000Z",
              stripe_session_id: "cs_test_123",
              artist_name: "Queen Creator",
              artist_slug: ARTIST_SLUG,
              item_title: "Golden Track",
              artwork_url: "supabase://media/artwork/bought.jpg",
            },
          ],
        };
      }
      // callerProfile (sales / products / checklist)
      if (text.includes("SELECT id, slug FROM creator_profiles")) {
        return { rows: [{ id: PROFILE_ID, slug: ARTIST_SLUG }] };
      }
      // sales: by-kind rollup + tracker-logged notes
      if (text.includes("GROUP BY ds.item_kind")) return { rows: [] };
      if (text.includes("SELECT note FROM money_entries")) return { rows: [] };
      // sales: main rows
      if (text.includes("ds.creator_amount_cents")) {
        return {
          rows: [
            {
              id: SALE_ID,
              item_kind: "track",
              item_id: TRACK_ID,
              amount_cents: 199,
              platform_fee_cents: 20,
              creator_amount_cents: 179,
              created_at: "2026-10-14T15:04:05.000Z",
              item_title: "Golden Track",
            },
          ],
        };
      }
      // products: videos (thumbnail aliased as artwork) before tracks
      if (text.includes("thumbnail_url AS artwork_url")) {
        return {
          rows: [
            {
              id: VIDEO_ID,
              title: "Golden Video",
              download_price_cents: 499,
              is_published: true,
              artwork_url: "supabase://media/thumbs/video.jpg",
            },
          ],
        };
      }
      if (text.includes("FROM profile_tracks") && text.includes("ORDER BY created_at DESC")) {
        return {
          rows: [
            {
              id: TRACK_ID,
              title: "Golden Track",
              download_price_cents: 199,
              is_published: true,
              artwork_url: "r2://media/artwork/track.jpg",
            },
          ],
        };
      }
      // products: creator vertical lookup
      if (text.includes("SELECT vertical FROM creator_profiles")) {
        return { rows: [{ vertical: "music" }] };
      }
      // checklist: first priced item (UNION), counts, first drop
      if (text.includes("UNION ALL")) {
        return { rows: [{ kind: "track", id: TRACK_ID }] };
      }
      if (text.includes("COUNT") && text.includes("money_entries")) return { rows: [{ c: 1 }] };
      if (text.includes("COUNT") && text.includes("digital_sales")) return { rows: [{ c: 1 }] };
      if (text.includes("COUNT") && text.includes("download_price_cents")) return { rows: [{ c: 1 }] };
      if (text.includes("COUNT")) return { rows: [{ c: 1 }] };
      if (text.includes("ORDER BY created_at ASC")) {
        return { rows: [{ item_kind: "track", item_id: TRACK_ID }] };
      }
      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../store";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null — assertions on status/body will surface it */
  }
  return { status: r.status, text, json };
}

function expectNoRawRefs(text: string) {
  expect(text).not.toContain("r2://");
  expect(text).not.toContain("supabase://");
}

beforeEach(() => {
  h.state.stripeCreateParams = null;
  h.state.stripeSession = {
    payment_status: "paid",
    amount_total: 199,
    metadata: {
      buyer_user_id: VIEWER_ID,
      item_kind: "track",
      item_id: TRACK_ID,
      profile_id: PROFILE_ID,
    },
    customer_details: { email: null },
  };
});

describe("GET /store/item/:kind/:id — artworkUrl refreshed at the response boundary", () => {
  it("returns a signed https artworkUrl, not the raw r2:// ref", async () => {
    const { status, text, json } = await req("GET", `/store/item/track/${TRACK_ID}`);

    expect(status).toBe(200);
    expectNoRawRefs(text);
    expect(json.item.artworkUrl).toBe(SIGNED_TRACK_ART);
    expect(json.item.artistSlug).toBe(ARTIST_SLUG);
  });

  it("passes the refreshed artwork URL to Stripe as the checkout image", async () => {
    const { status, json } = await req("POST", "/store/checkout", { kind: "track", id: TRACK_ID });

    expect(status).toBe(200);
    expect(json.url).toBe("https://checkout.example.com/cs_test_123");
    const images = h.state.stripeCreateParams.line_items[0].price_data.product_data.images;
    expect(images).toEqual([SIGNED_TRACK_ART]);
  });
});

describe("GET /store/purchases — artworkUrl refreshed + artistUrl namespace", () => {
  it("returns a signed https artworkUrl and an /artist/ artistUrl", async () => {
    const { status, text, json } = await req("GET", "/store/purchases");

    expect(status).toBe(200);
    expectNoRawRefs(text);
    expect(json.purchases).toHaveLength(1);
    expect(json.purchases[0].artworkUrl).toBe(SIGNED_PURCHASE_ART);
    expect(json.purchases[0].artistUrl).toBe(`/artist/${ARTIST_SLUG}`);
  });
});

describe("GET /store/products — artworkUrl refreshed + profileUrl namespace", () => {
  it("refreshes track artwork and video thumbnails, and links to /artist/", async () => {
    const { status, text, json } = await req("GET", "/store/products");

    expect(status).toBe(200);
    expectNoRawRefs(text);
    expect(json.profileUrl).toBe(`/artist/${ARTIST_SLUG}`);
    const byKind = Object.fromEntries(json.products.map((p: any) => [p.kind, p]));
    expect(byKind.track.artworkUrl).toBe(SIGNED_TRACK_ART);
    expect(byKind.video.artworkUrl).toBe(SIGNED_VIDEO_THUMB);
  });
});

describe("POST /store/verify — artistUrl namespace", () => {
  it("links the purchased item's creator to /artist/<slug>", async () => {
    const { status, json } = await req("POST", "/store/verify", { sessionId: "cs_test_123" });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.item.artistUrl).toBe(`/artist/${ARTIST_SLUG}`);
  });
});

describe("GET /store/sales — profileUrl namespace", () => {
  it("links the dashboard to /artist/<slug>", async () => {
    const { status, json } = await req("GET", "/store/sales");

    expect(status).toBe(200);
    expect(json.profileUrl).toBe(`/artist/${ARTIST_SLUG}`);
  });
});

describe("GET /store/checklist — profile href + profileUrl namespace", () => {
  it("links the profile step and profileUrl to /artist/<slug>", async () => {
    const { status, json } = await req("GET", "/store/checklist");

    expect(status).toBe(200);
    expect(json.profileUrl).toBe(`/artist/${ARTIST_SLUG}`);
    const listStep = json.steps.find((s: any) => s.id === "list");
    expect(listStep.cta.href).toBe(`/artist/${ARTIST_SLUG}`);
  });
});
