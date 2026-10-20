/**
 * Route tests for the store download rail (routes/store.ts) — the
 * rail Ring 2 item 2.16 ("take your music out") rides at the World's
 * Listening Booth, and the same rail the website's /my-music page
 * mints from:
 *
 *   POST /api/store/token        mint a download link for a purchase
 *   GET  /api/store/purchases    the caller's receipts (the library)
 *   GET  /api/store/download/:t  token-gated delivery page
 *
 * The token is a DELIVERY credential — HMAC-signed, 48-hour TTL,
 * 5 uses — minted against a digital_sales row the CALLER bought
 * (`buyer_user_id = caller` is in the lookup's WHERE). Until this
 * file, no route test exercised the mint at all.
 *
 * The fake db SIMULATES the WHERE semantics on the params the
 * handler actually sends (a sale row comes back only when BOTH the
 * sale id and the buyer id match), so a handler that dropped the
 * buyer predicate would fail the happy path too; the suites also
 * pin the buyer predicate in the rendered SQL text itself.
 *
 * Fake-db style mirrors store-refresh-links.test.ts: real exports
 * via importOriginal, db.execute dispatched on the flattened SQL
 * text (PgDialect) the handler emitted.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { createHmac } from "node:crypto";

const BUYER_ID = "00000000-0000-4000-8000-0000000000b1";
const STRANGER_ID = "00000000-0000-4000-8000-0000000000b2";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const SALE_ID = "44444444-4444-4444-8444-444444444444";
const STRANGER_SALE_ID = "55555555-5555-4555-8555-555555555555";
const ARTIST_SLUG = "queen-creator";
const TOKEN_SECRET = "test-download-secret";
const FILE_REF = "r2://media/audio/track.mp3";
const SIGNED_FILE = "https://signed.example.com/media/audio/track.mp3?sig=test";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  state: {
    itemGone: false,
    queries: [] as Array<{ text: string; params: unknown[] }>,
    linkInserts: [] as Array<{ token: string; saleId: string; fileUrl: string; expiresAt: string }>,
    mintedToken: null as string | null,
  },
}));

process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_store_route_tests";
process.env["STORE_DOWNLOAD_SECRET"] = TOKEN_SECRET;

/* The house requireAuth mock sets ONE fixed user; this rail's whole
   point is per-caller scoping, so the mock switches identity on the
   x-test-user header and 401s without one — the real middleware's
   contract (no Bearer credentials → 401, no userId set). */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = String(u);
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
  STOREFRONT_PLATFORM_FEE_BPS: 500,
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
   URLs; everything else passes through — mirroring the real helpers. */
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
    checkout = { sessions: { create: async () => ({ id: "cs_unused", url: "https://checkout.example.com" }), retrieve: async () => null } };
    refunds = { create: async () => ({ id: "re_unused", status: "succeeded" }) };
  }
  return { default: FakeStripe };
});

/* The sales table the fake db serves: two buyers, one track each. */
const SALES = [
  { id: SALE_ID, buyer: BUYER_ID, item_kind: "track", item_id: TRACK_ID },
  { id: STRANGER_SALE_ID, buyer: STRANGER_ID, item_kind: "track", item_id: TRACK_ID },
];

function purchaseRow(saleId: string, sessionId: string): Record<string, unknown> {
  return {
    id: saleId,
    item_kind: "track",
    item_id: TRACK_ID,
    amount_cents: 199,
    created_at: "2026-10-14T15:04:05.000Z",
    stripe_session_id: sessionId,
    artist_name: "Queen Creator",
    artist_slug: ARTIST_SLUG,
    item_title: "Golden Track",
    artwork_url: "r2://media/artwork/track.jpg",
  };
}

function sellableRow(): Record<string, unknown> {
  return {
    id: TRACK_ID,
    profile_id: PROFILE_ID,
    title: "Golden Track",
    download_price_cents: 199,
    is_published: true,
    pwyw_enabled: false,
    pwyw_min_cents: 0,
    file_url: FILE_REF,
    artwork_url: "r2://media/artwork/track.jpg",
    artist_name: "Queen Creator",
    artist_slug: ARTIST_SLUG,
  };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();

  const fakeDb: any = {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      h.state.queries.push({ text, params: params as unknown[] });

      // Delivery: the atomic use-burn. Only the token this suite
      // minted (captured at INSERT) still has uses left.
      if (text.includes("UPDATE download_links")) {
        if (h.state.mintedToken && params[0] === h.state.mintedToken) {
          const ins = h.state.linkInserts.find((i) => i.token === h.state.mintedToken);
          return {
            rows: [
              {
                file_url: FILE_REF,
                expires_at: ins?.expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
                used_count: 1,
                sale_id: SALE_ID,
              },
            ],
          };
        }
        return { rows: [] };
      }
      // The mint itself: capture exactly what was written.
      if (text.includes("INSERT INTO download_links")) {
        h.state.linkInserts.push({
          token: String(params[0]),
          saleId: String(params[1]),
          fileUrl: String(params[2]),
          expiresAt: String(params[3]),
        });
        h.state.mintedToken = String(params[0]);
        return { rows: [] };
      }
      // resolveSellableItem — keyed on its unique `AS file_url` projection.
      if (text.includes("AS file_url")) {
        return { rows: [h.state.itemGone ? { ...sellableRow(), is_published: false } : sellableRow()] };
      }
      // Purchases: buyer's library — rows filtered by the buyer param,
      // exactly as the WHERE ds.buyer_user_id = $1 does in Postgres.
      if (text.includes("ds.stripe_session_id")) {
        const buyer = String(params[0]);
        if (buyer === BUYER_ID) return { rows: [purchaseRow(SALE_ID, "cs_test_123")] };
        if (buyer === STRANGER_ID) return { rows: [purchaseRow(STRANGER_SALE_ID, "cs_test_999")] };
        return { rows: [] };
      }
      // Token mint: the sale lookup — the row comes back only when
      // BOTH the sale id and the buyer id params match a stored sale.
      if (text.includes("FROM digital_sales ds") && text.includes("buyer_user_id")) {
        const sale = SALES.find((s) => s.id === String(params[0]) && s.buyer === String(params[1]));
        return { rows: sale ? [{ id: sale.id, item_kind: sale.item_kind, item_id: sale.item_id }] : [] };
      }
      // Delivery page: the sale behind a spent token.
      if (text.includes("AS artist_name") && text.includes("digital_sales")) {
        return { rows: [{ item_kind: "track", item_id: TRACK_ID, artist_name: "Queen Creator" }] };
      }
      // Delivery page: item title.
      if (text.includes("SELECT title FROM profile_tracks")) {
        return { rows: [{ title: "Golden Track" }] };
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

async function req(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.user) headers["x-test-user"] = opts.user;
  if (opts.body) headers["Content-Type"] = "application/json";
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
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

beforeEach(() => {
  h.state.itemGone = false;
  h.state.queries = [];
  h.state.linkInserts = [];
  h.state.mintedToken = null;
});

describe("POST /store/token — mint a download link for a purchase (2.16's rail)", () => {
  it("the buyer mints against their own purchase: signed token, download URL, 48h expiry, 5 uses", async () => {
    const { status, json } = await req("POST", "/store/token", { user: BUYER_ID, body: { saleId: SALE_ID } });

    expect(status).toBe(200);
    expect(json.token).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}$/);
    expect(json.url).toBe(`/api/store/download/${json.token}`);
    expect(json.maxUses).toBe(5);
    const ttlMs = Date.parse(json.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(47.9 * 3600_000);
    expect(ttlMs).toBeLessThanOrEqual(48 * 3600_000 + 5_000);

    /* Exactly one link row was written, for THIS sale and the item's
       stored file, expiring when the response says it expires. */
    expect(h.state.linkInserts).toHaveLength(1);
    expect(h.state.linkInserts[0]).toEqual({
      token: json.token,
      saleId: SALE_ID,
      fileUrl: FILE_REF,
      expiresAt: json.expiresAt,
    });
  });

  it("the sale lookup carries the buyer predicate — ownership is in the query, not the client", async () => {
    await req("POST", "/store/token", { user: BUYER_ID, body: { saleId: SALE_ID } });
    const lookup = h.state.queries.find(
      (q) => q.text.includes("FROM digital_sales ds") && q.text.includes("buyer_user_id"),
    );
    expect(lookup).toBeTruthy();
    expect(lookup!.params).toEqual([SALE_ID, BUYER_ID]);
  });

  it("another member's purchase refuses: 404, and nothing is minted", async () => {
    const { status, json } = await req("POST", "/store/token", { user: STRANGER_ID, body: { saleId: SALE_ID } });

    expect(status).toBe(404);
    expect(json.error).toBe("Purchase not found.");
    expect(h.state.linkInserts).toHaveLength(0);
  });

  it("a sale id that exists for nobody refuses the same way", async () => {
    const { status } = await req("POST", "/store/token", {
      user: BUYER_ID,
      body: { saleId: "99999999-9999-4999-8999-999999999999" },
    });
    expect(status).toBe(404);
    expect(h.state.linkInserts).toHaveLength(0);
  });

  it("guests cannot mint", async () => {
    const { status } = await req("POST", "/store/token", { body: { saleId: SALE_ID } });
    expect(status).toBe(401);
    expect(h.state.linkInserts).toHaveLength(0);
  });

  it("a malformed saleId is a 400 before any lookup", async () => {
    const { status, json } = await req("POST", "/store/token", { user: BUYER_ID, body: { saleId: "not-a-uuid" } });
    expect(status).toBe(400);
    expect(json.error).toBe("saleId is required");
    expect(h.state.linkInserts).toHaveLength(0);
  });

  it("a purchase whose content was withdrawn refuses honestly: 400, no link", async () => {
    h.state.itemGone = true;
    const { status, json } = await req("POST", "/store/token", { user: BUYER_ID, body: { saleId: SALE_ID } });
    expect(status).toBe(400);
    expect(json.error).toBe("This content is no longer available.");
    expect(h.state.linkInserts).toHaveLength(0);
  });
});

describe("GET /store/purchases — receipts show only the caller's records", () => {
  it("the buyer sees their receipt: title, artist, amount, date, receipt id", async () => {
    const { status, json } = await req("GET", "/store/purchases", { user: BUYER_ID });

    expect(status).toBe(200);
    expect(json.purchases).toHaveLength(1);
    const p = json.purchases[0];
    expect(p.id).toBe(SALE_ID);
    expect(p.title).toBe("Golden Track");
    expect(p.artistName).toBe("Queen Creator");
    expect(p.amount).toBe("$1.99");
    expect(p.amountCents).toBe(199);
    expect(p.purchasedAt).toBe("2026-10-14T15:04:05.000Z");
    expect(p.receiptId).toBe("cs_test_123");
    expect(p.buyUrl).toBe(`/store/buy/track/${TRACK_ID}`);
  });

  it("the other buyer sees only their own receipt — never the first buyer's", async () => {
    const { status, text, json } = await req("GET", "/store/purchases", { user: STRANGER_ID });

    expect(status).toBe(200);
    expect(json.purchases).toHaveLength(1);
    expect(json.purchases[0].id).toBe(STRANGER_SALE_ID);
    expect(json.purchases[0].receiptId).toBe("cs_test_999");
    expect(text).not.toContain("cs_test_123");
    expect(text).not.toContain(SALE_ID);
  });

  it("the purchases query is scoped by the caller in SQL", async () => {
    await req("GET", "/store/purchases", { user: BUYER_ID });
    const q = h.state.queries.find((x) => x.text.includes("ds.stripe_session_id"));
    expect(q).toBeTruthy();
    expect(q!.text).toContain("ds.buyer_user_id");
    expect(q!.params).toEqual([BUYER_ID]);
  });

  it("guests get no library", async () => {
    const { status } = await req("GET", "/store/purchases");
    expect(status).toBe(401);
  });
});

describe("GET /store/download/:token — the minted link delivers, once per open", () => {
  it("a token straight from the mint serves the file page with uses left counted down", async () => {
    const mint = await req("POST", "/store/token", { user: BUYER_ID, body: { saleId: SALE_ID } });
    expect(mint.status).toBe(200);

    const { status, text } = await req("GET", `/store/download/${mint.json.token}`);
    expect(status).toBe(200);
    expect(text).toContain("Your download is ready");
    expect(text).toContain("Golden Track");
    expect(text).toContain(SIGNED_FILE);
    expect(text).toContain("4 downloads left");
    /* The stored r2:// ref itself never reaches the page. */
    expect(text).not.toContain("r2://");
  });

  it("a tampered token never reaches the database's delivery path", async () => {
    const forged = `${"a".repeat(64)}.${"b".repeat(64)}`;
    const { status, text } = await req("GET", `/store/download/${forged}`);
    expect(status).toBe(404);
    expect(text).toContain("doesn't look right");
    expect(h.state.queries.some((q) => q.text.includes("UPDATE download_links"))).toBe(false);
  });

  it("a well-signed token that was never minted reads as spent/expired, not as a file", async () => {
    const raw = "c".repeat(64);
    const sig = createHmac("sha256", TOKEN_SECRET).update(raw).digest("hex");
    const { status, text } = await req("GET", `/store/download/${raw}.${sig}`);
    expect(status).toBe(410);
    expect(text).toContain("hit its 5-download limit");
  });
});
