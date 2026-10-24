/**
 * Shopify CSV bridge — POST /api/storefront/shopify-import/{preview,commit}
 * and GET /api/storefront/shopify-export/{products,orders,customers} over
 * HTTP against pg-mem, the catalog-export-builder.test.ts pattern.
 * Pins: a realistic Shopify products CSV maps fully (variants → listings,
 * HTML stripped, images gathered, draft respected), un-mappable rows are
 * listed with reasons and never silently dropped, prices land byte-exact
 * (string math, no floats), re-import UPDATES in place (never duplicates),
 * exports are Shopify-shaped and round-trip, and everything is scoped to
 * the caller's own profile/lists.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));
/* Mirroring is best-effort network I/O in production; in tests it is the
   identity so stored URLs are exactly the file's URLs. */
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: string) => v,
}));

import shopifyBridgeRouter from "../shopify-bridge";
import { parseCsv, parseMoneyToCents, formatMoneyFromCents } from "../shopify-bridge";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE store_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', price_cents integer NOT NULL, compare_at_cents integer, inventory integer NOT NULL DEFAULT -1, media_urls jsonb NOT NULL DEFAULT '[]', service_details jsonb, event_id uuid, related_links jsonb NOT NULL DEFAULT '[]', is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer, media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb, bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0);
CREATE TABLE store_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_user_id uuid, profile_id uuid NOT NULL, product_id uuid, product_title text NOT NULL DEFAULT '', product_kind text NOT NULL DEFAULT 'digital', quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL, discount_code text, platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0, stripe_session_id text, status text NOT NULL DEFAULT 'completed', fulfillment_note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE email_lists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL);
CREATE TABLE email_subscribers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL, email text NOT NULL, name text, source text NOT NULL DEFAULT 'landing', unsubscribed_at timestamptz, subscribed_at timestamptz NOT NULL DEFAULT now());
`;

const OWNER = randomUUID(), STRANGER = randomUUID(), NOPROFILE = randomUUID();
const OWNER_PROFILE = randomUUID(), STRANGER_PROFILE = randomUUID();
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(shopifyBridgeRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  const { db, mem } = createTestDb();
  /* impure: otherwise pg-mem constant-folds the default and every
     inserted row gets the same id (hub-projects.test.ts pattern). */
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID(), impure: true } as any);
  mem.public.none(DDL);
  testState.db = db;
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${OWNER_PROFILE}, ${OWNER}, 'owner-shop', 'Owner')`);
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${STRANGER_PROFILE}, ${STRANGER}, 'stranger-shop', 'Stranger')`);
});

/* ── Fixture: a realistic Shopify products export ─────────────────────── */
const HEADERS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
  "Variant SKU", "Variant Inventory Tracker", "Variant Inventory Qty",
  "Variant Inventory Policy", "Variant Price", "Variant Compare At Price",
  "Variant Requires Shipping", "Image Src", "Image Position", "Gift Card", "Status",
];
function fixtureCsv(rows: Record<string, string>[]): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [HEADERS.join(",")];
  for (const r of rows) lines.push(HEADERS.map((h) => esc(r[h] ?? "")).join(","));
  return lines.join("\r\n") + "\r\n";
}

const SHOPIFY_CSV = fixtureCsv([
  /* Golden Mic Tee — variant S */
  { Handle: "golden-mic-tee", Title: "Golden Mic Tee", "Body (HTML)": "<p>Soft &amp; heavy — the palace tee.</p>", Vendor: "BDV", Type: "Shirt", Tags: "gold,tee", Published: "TRUE", "Option1 Name": "Size", "Option1 Value": "S", "Variant SKU": "TEE-S", "Variant Inventory Tracker": "shopify", "Variant Inventory Qty": "12", "Variant Inventory Policy": "deny", "Variant Price": "29.99", "Variant Compare At Price": "39.99", "Variant Requires Shipping": "true", "Image Src": "https://files.example/tee-front.jpg", "Image Position": "1", "Gift Card": "false", Status: "active" },
  /* Golden Mic Tee — variant M */
  { Handle: "golden-mic-tee", "Option1 Name": "Size", "Option1 Value": "M", "Variant SKU": "TEE-M", "Variant Inventory Tracker": "shopify", "Variant Inventory Qty": "0", "Variant Inventory Policy": "deny", "Variant Price": "29.99", "Variant Compare At Price": "39.99", "Variant Requires Shipping": "true", "Gift Card": "false", Status: "active" },
  /* Golden Mic Tee — extra gallery image row */
  { Handle: "golden-mic-tee", "Image Src": "https://files.example/tee-back.jpg", "Image Position": "2" },
  /* Beat Pack — digital, single default variant, price with one decimal */
  { Handle: "beat-pack-vol-1", Title: "Beat Pack Vol. 1", "Body (HTML)": "20 royalty-free loops.", Published: "TRUE", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant SKU": "BEATPACK1", "Variant Price": "49.5", "Variant Requires Shipping": "false", "Gift Card": "false", Status: "active" },
  /* Palace Chain — $-and-comma price, byte-exact check */
  { Handle: "palace-chain", Title: "Palace Chain", Published: "TRUE", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant SKU": "CHAIN-1", "Variant Inventory Qty": "3", "Variant Price": "$1,299.00", "Variant Requires Shipping": "true", "Gift Card": "false", Status: "active" },
  /* Season Hoodie — draft stays draft */
  { Handle: "season-hoodie", Title: "Season Hoodie", Published: "FALSE", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant SKU": "HOOD-1", "Variant Price": "89.00", "Variant Requires Shipping": "true", "Gift Card": "false", Status: "draft" },
  /* Free Sticker — $0.00 can't map (store prices are > $0) */
  { Handle: "free-sticker", Title: "Free Sticker", Published: "TRUE", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant SKU": "STICK-0", "Variant Price": "0.00", "Variant Requires Shipping": "true", "Gift Card": "false", Status: "active" },
  /* Mystery Box — non-numeric price */
  { Handle: "mystery-box", Title: "Mystery Box", Published: "TRUE", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant SKU": "MYS-1", "Variant Price": "abc", "Variant Requires Shipping": "true", "Gift Card": "false", Status: "active" },
  /* Gift Card — no listing kind for it */
  { Handle: "gift-card-50", Title: "$50 Gift Card", Published: "TRUE", "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant Price": "50.00", "Variant Requires Shipping": "false", "Gift Card": "true", Status: "active" },
  /* Orphan row — no handle at all */
  { Title: "Orphan Row", "Variant Price": "9.99" },
]);

async function post(user: string | null, path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}
async function get(user: string | null, path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { headers: { ...(user ? { "x-test-user": user } : {}) } });
  return { status: r.status, text: await r.text(), contentType: r.headers.get("content-type") ?? "", disposition: r.headers.get("content-disposition") ?? "" };
}
async function myProducts(profileId: string) {
  const r = await testState.db.execute(sql`SELECT * FROM store_products WHERE profile_id = ${profileId} ORDER BY title ASC`);
  return r.rows as any[];
}
const mediaOf = (p: any): string[] => (Array.isArray(p.media_urls) ? p.media_urls : JSON.parse(p.media_urls ?? "[]"));

describe("money parsing is string-exact", () => {
  it("parses plain, one-decimal, $-prefixed and comma prices to exact cents", () => {
    expect(parseMoneyToCents("29.99")).toEqual({ cents: 2999 });
    expect(parseMoneyToCents("49.5")).toEqual({ cents: 4950 });
    expect(parseMoneyToCents("$1,299.00")).toEqual({ cents: 129900 });
    expect(parseMoneyToCents("7")).toEqual({ cents: 700 });
    expect(parseMoneyToCents("0.01")).toEqual({ cents: 1 });
  });
  it("refuses zero, non-numbers, and 3-decimal prices with reasons", () => {
    expect("error" in parseMoneyToCents("0.00")).toBe(true);
    expect("error" in parseMoneyToCents("abc")).toBe(true);
    expect("error" in parseMoneyToCents("1.999")).toBe(true);
    expect("error" in parseMoneyToCents("")).toBe(true);
  });
  it("formats cents back byte-exact", () => {
    expect(formatMoneyFromCents(2999)).toBe("29.99");
    expect(formatMoneyFromCents(4950)).toBe("49.50");
    expect(formatMoneyFromCents(5)).toBe("0.05");
    expect(formatMoneyFromCents(129900)).toBe("1299.00");
  });
});

describe("import preview", () => {
  it("maps the full fixture: variants become listings, bad rows carry reasons, nothing writes", async () => {
    const { status, json } = await post(OWNER, "/storefront/shopify-import/preview", { csv: SHOPIFY_CSV });
    expect(status).toBe(200);
    expect(json.summary.products).toBe(7); // tee, beat pack, chain, hoodie, sticker, mystery, gift card
    expect(json.summary.creates).toBe(5);   // Tee S, Tee M, Beat Pack, Chain, Hoodie
    expect(json.summary.updates).toBe(0);
    expect(json.summary.images).toBe(1);   // tee-back gallery row
    expect(json.summary.rejected).toBe(4); // sticker ($0), mystery (abc), gift card, orphan row
    const byTitle = new Map(json.rows.map((r: any) => [r.title, r]));
    expect(byTitle.get("Golden Mic Tee — S")?.action).toBe("create");
    expect(byTitle.get("Golden Mic Tee — M")?.sku).toBe("TEE-M");
    const sticker = json.rows.find((r: any) => r.handle === "free-sticker");
    expect(sticker.action).toBe("reject");
    expect(sticker.reason).toContain("above $0.00");
    const mystery = json.rows.find((r: any) => r.handle === "mystery-box");
    expect(mystery.reason).toContain("not a plain number");
    const gift = json.rows.find((r: any) => r.handle === "gift-card-50");
    expect(gift.reason).toContain("Gift cards");
    const orphan = json.rows.find((r: any) => r.handle === "");
    expect(orphan.reason).toContain("Handle");
    /* Preview wrote NOTHING. */
    expect(await myProducts(OWNER_PROFILE)).toHaveLength(0);
  });

  it("refuses a file that is not a Shopify products CSV, and empty input", async () => {
    const bad = await post(OWNER, "/storefront/shopify-import/preview", { csv: "a,b,c\n1,2,3\n" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("Shopify products CSV");
    const empty = await post(OWNER, "/storefront/shopify-import/preview", { csv: "" });
    expect(empty.status).toBe(400);
  });

  it("scopes: no profile → 404 NO_PROFILE; unauthenticated → 401", async () => {
    const np = await post(NOPROFILE, "/storefront/shopify-import/preview", { csv: SHOPIFY_CSV });
    expect(np.status).toBe(404);
    expect(np.json.error).toBe("NO_PROFILE");
    const unauth = await post(null, "/storefront/shopify-import/preview", { csv: SHOPIFY_CSV });
    expect(unauth.status).toBe(401);
  });
});

describe("import commit + idempotent re-import", () => {
  it("creates listings with exact prices, stripped HTML, gathered images, draft honored", async () => {
    const { status, json } = await post(OWNER, "/storefront/shopify-import/commit", { csv: SHOPIFY_CSV });
    expect(status).toBe(200);
    expect(json.summary.creates).toBe(5);
    expect(json.summary.rejected).toBe(4);
    const products = await myProducts(OWNER_PROFILE);
    expect(products).toHaveLength(5);
    const teeS = products.find((p) => p.title === "Golden Mic Tee — S");
    expect(teeS.price_cents).toBe(2999);                    // byte-exact
    expect(teeS.compare_at_cents).toBe(3999);
    expect(teeS.inventory).toBe(12);
    expect(teeS.kind).toBe("merch");
    expect(teeS.description).toBe("Soft & heavy — the palace tee."); // HTML stripped, entity decoded
    expect(mediaOf(teeS)).toEqual(["https://files.example/tee-front.jpg", "https://files.example/tee-back.jpg"]);
    const teeM = products.find((p) => p.title === "Golden Mic Tee — M");
    expect(teeM.inventory).toBe(0);
    const beats = products.find((p) => p.title === "Beat Pack Vol. 1");
    expect(beats.price_cents).toBe(4950);                   // "49.5" → 4950
    expect(beats.kind).toBe("digital");
    expect(beats.inventory).toBe(-1);                       // untracked
    const chain = products.find((p) => p.title === "Palace Chain");
    expect(chain.price_cents).toBe(129900);                 // "$1,299.00" byte-exact
    const hoodie = products.find((p) => p.title === "Season Hoodie");
    expect(hoodie.is_active).toBe(false);                   // draft stays draft
    /* The stranger's store got nothing. */
    expect(await myProducts(STRANGER_PROFILE)).toHaveLength(0);
  });

  it("re-import updates in place — same ids, no duplicates — and a changed price overwrites", async () => {
    await post(OWNER, "/storefront/shopify-import/commit", { csv: SHOPIFY_CSV });
    const before = await myProducts(OWNER_PROFILE);
    const teeSId = before.find((p) => p.title === "Golden Mic Tee — S").id;

    const again = await post(OWNER, "/storefront/shopify-import/commit", { csv: SHOPIFY_CSV });
    expect(again.json.summary.creates).toBe(0);
    expect(again.json.summary.updates).toBe(5);
    const after = await myProducts(OWNER_PROFILE);
    expect(after).toHaveLength(5);
    expect(after.find((p) => p.title === "Golden Mic Tee — S").id).toBe(teeSId);

    const repricedCsv = SHOPIFY_CSV.replace('TEE-S,shopify,12,deny,29.99', 'TEE-S,shopify,9,deny,24.99');
    expect(repricedCsv).not.toBe(SHOPIFY_CSV);
    const repriced = await post(OWNER, "/storefront/shopify-import/commit", { csv: repricedCsv });
    expect(repriced.json.summary.updates).toBe(5);
    const final = await myProducts(OWNER_PROFILE);
    expect(final).toHaveLength(5);
    const teeS = final.find((p) => p.title === "Golden Mic Tee — S");
    expect(teeS.id).toBe(teeSId);
    expect(teeS.price_cents).toBe(2499);
    expect(teeS.inventory).toBe(9);
  });
});

describe("exports are Shopify-shaped, owner-scoped, and round-trip", () => {
  beforeEach(async () => {
    await post(OWNER, "/storefront/shopify-import/commit", { csv: SHOPIFY_CSV });
    const db = testState.db;
    await db.execute(sql`INSERT INTO store_orders (profile_id, product_title, product_kind, quantity, amount_cents, discount_code, status) VALUES (${OWNER_PROFILE}, 'Golden Mic Tee — S', 'merch', 2, 5998, 'PALACE10', 'completed')`);
    await db.execute(sql`INSERT INTO store_orders (profile_id, product_title, product_kind, quantity, amount_cents, status) VALUES (${STRANGER_PROFILE}, 'Not Yours', 'digital', 1, 500, 'completed')`);
    const listId = randomUUID(), strangerListId = randomUUID();
    await db.execute(sql`INSERT INTO email_lists (id, user_id, name, handle) VALUES (${listId}, ${OWNER}, 'Main list', 'main')`);
    await db.execute(sql`INSERT INTO email_lists (id, user_id, name, handle) VALUES (${strangerListId}, ${STRANGER}, 'Theirs', 'theirs')`);
    await db.execute(sql`INSERT INTO email_subscribers (list_id, email, name, source) VALUES (${listId}, 'fan@example.com', 'Fred Fan', 'presave')`);
    await db.execute(sql`INSERT INTO email_subscribers (list_id, email, name, source, unsubscribed_at) VALUES (${listId}, 'gone@example.com', 'Gone Gary', 'landing', now())`);
    await db.execute(sql`INSERT INTO email_subscribers (list_id, email, name, source) VALUES (${strangerListId}, 'theirs@example.com', 'Their Fan', 'landing')`);
  });

  it("products export carries Shopify headers and byte-exact prices", async () => {
    const r = await get(OWNER, "/storefront/shopify-export/products");
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/csv");
    expect(r.disposition).toContain("shopify-products.csv");
    const table = parseCsv(r.text);
    expect(table.headers).toContain("Variant Price");
    const beats = table.records.find((x) => x.values["Title"] === "Beat Pack Vol. 1");
    expect(beats?.values["Variant Price"]).toBe("49.50");
    const teeS = table.records.find((x) => x.values["Title"] === "Golden Mic Tee — S");
    expect(teeS?.values["Variant Price"]).toBe("29.99");
    expect(teeS?.values["Variant Inventory Qty"]).toBe("12");
    expect(table.records.some((x) => x.values["Title"] === "Not Yours")).toBe(false);
  });

  it("the products export re-imports cleanly: updates for the owner, creates for a fresh store", async () => {
    const r = await get(OWNER, "/storefront/shopify-export/products");
    const back = await post(OWNER, "/storefront/shopify-import/preview", { csv: r.text });
    expect(back.json.summary.rejected).toBe(0);
    expect(back.json.summary.creates).toBe(0);
    expect(back.json.summary.updates).toBe(5);

    const fresh = await post(STRANGER, "/storefront/shopify-import/commit", { csv: r.text });
    expect(fresh.json.summary.creates).toBe(5);
    const strangerProducts = await myProducts(STRANGER_PROFILE);
    expect(strangerProducts).toHaveLength(5);
    expect(strangerProducts.find((p) => p.title === "Palace Chain").price_cents).toBe(129900);
    expect(strangerProducts.find((p) => p.title === "Beat Pack Vol. 1").price_cents).toBe(4950);
  });

  it("orders export is Shopify-shaped and only the caller's", async () => {
    const r = await get(OWNER, "/storefront/shopify-export/orders");
    expect(r.status).toBe(200);
    const table = parseCsv(r.text);
    expect(table.records).toHaveLength(1);
    const o = table.records[0]!.values;
    expect(o["Lineitem name"]).toBe("Golden Mic Tee — S");
    expect(o["Total"]).toBe("59.98");
    expect(o["Financial Status"]).toBe("paid");
    expect(o["Discount Code"]).toBe("PALACE10");
    expect(o["Lineitem quantity"]).toBe("2");
  });

  it("customers export carries active fans only, names split, marketing = yes", async () => {
    const r = await get(OWNER, "/storefront/shopify-export/customers");
    expect(r.status).toBe(200);
    const table = parseCsv(r.text);
    expect(table.records).toHaveLength(1);
    const c = table.records[0]!.values;
    expect(c["Email"]).toBe("fan@example.com");
    expect(c["First Name"]).toBe("Fred");
    expect(c["Last Name"]).toBe("Fan");
    expect(c["Accepts Email Marketing"]).toBe("yes");
    expect(c["Tags"]).toBe("presave");
  });

  it("exports refuse unauthenticated callers", async () => {
    expect((await get(null, "/storefront/shopify-export/products")).status).toBe(401);
    expect((await get(null, "/storefront/shopify-export/orders")).status).toBe(401);
    expect((await get(null, "/storefront/shopify-export/customers")).status).toBe(401);
  });
});
