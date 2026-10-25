/**
 * License keys + per-buyer download limits on the digital-store rail
 * (Wave 4 #35, migration 0234). Real store router + real
 * lib/license-keys over pg-mem (harness mirrors
 * store-gift-tender.test.ts; Stripe at the lib/stripe-client seam).
 *
 * Pins:
 *  - seller settings are owner-only, series excluded, cap validated;
 *  - a keyed purchase issues EXACTLY ONE key (verify replayed, and the
 *    gift-card fulfillment path), delivered in the verify response AND
 *    the receipt email, and readable again in the buyer's library;
 *  - downloads count PER BUYER on the key: fresh links never reset the
 *    count, the cap stops downloads honestly, an unlimited key bypasses
 *    the per-link cap;
 *  - revoke stops downloads + mints at once; re-issue rotates the key
 *    and resets the count; a refunded sale's key can never re-issue;
 *  - strangers see nothing: no key in the seller's masked list, no
 *    minting against someone else's sale.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-license-keys";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<any>,
  session: null as any,
  emails: [] as Array<{ to: string; subject: string; html: string }>,
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
      refunds: { create: vi.fn(async () => ({ id: "re_unused", status: "succeeded" })) },
    })),
  };
});

vi.mock("../../lib/job-notifications", () => ({
  createJobNotification: vi.fn(async () => undefined),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: vi.fn(async (mail: any) => {
    h.emails.push(mail);
    return { ok: true };
  }),
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
import { hashGiftCardCode } from "../../lib/gift-cards";
import {
  LICENSE_KEY_RE,
  decryptLicenseKey,
  encryptLicenseKey,
  generateLicenseKey,
  hashLicenseKey,
  licenseBlocksMint,
  licenseKeySuffix,
  maskLicenseKey,
} from "../../lib/license-keys";
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
  audio_url text, artwork_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL,
  download_price_cents integer, is_published boolean NOT NULL DEFAULT true,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  video_url text, thumbnail_url text, thumbnail_alt_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE playlists (
  id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL, title text,
  price_cents integer, is_public boolean NOT NULL DEFAULT true, kind text, cover_url text,
  items jsonb
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  item_kind text NOT NULL, item_id uuid NOT NULL, stripe_session_id text UNIQUE,
  amount_cents integer NOT NULL, platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  refunded_at timestamptz,
  bump_item_kind text, bump_item_id uuid, bump_title text,
  bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE download_links (
  token text PRIMARY KEY, sale_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE digital_product_settings (
  item_kind text NOT NULL, item_id uuid NOT NULL,
  license_keys_enabled boolean NOT NULL DEFAULT false,
  max_downloads integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id)
);
CREATE TABLE digital_license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES digital_sales(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL, buyer_user_id uuid NOT NULL,
  item_kind text NOT NULL, item_id uuid NOT NULL,
  item_title text NOT NULL DEFAULT '', file_url text NOT NULL,
  key_hash text NOT NULL UNIQUE, key_cipher text NOT NULL, key_suffix text NOT NULL,
  max_downloads integer, download_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz, revoked_reason text,
  reissue_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, item_kind, item_id)
);
CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL, code_last4 text NOT NULL,
  profile_id uuid NOT NULL, product_id uuid,
  buyer_user_id uuid, recipient_email text NOT NULL,
  recipient_name text, message text,
  initial_cents integer NOT NULL, balance_cents integer NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active', stripe_session_id text,
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
let server: any;
let baseUrl: string;
const CREATOR = randomUUID();
const OTHER_CREATOR = randomUUID();
const BUYER = randomUUID();
const STRANGER = randomUUID();
const PROFILE_ID = randomUUID();
const OTHER_PROFILE_ID = randomUUID();
const TRACK_ID = randomUUID();
const CARD_CODE = "BDV-AAAA-BBBB-CCCC-DDDD";
const TRACK_PRICE = 2000;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storeRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[store-license-keys] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  /* pg-mem ships almost no native functions; /store/purchases counts
     bundle contents with jsonb_array_length (real Postgres has it). */
  mem.public.registerFunction({
    name: "jsonb_array_length",
    args: ["jsonb"],
    returns: "int" as never,
    implementation: (v: unknown) => {
      if (Array.isArray(v)) return v.length;
      if (typeof v === "string") {
        try {
          const parsed: unknown = JSON.parse(v);
          return Array.isArray(parsed) ? parsed.length : 0;
        } catch {
          return 0;
        }
      }
      return 0;
    },
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = BUYER;
  h.userEmail = "buyer@example.com";
  h.stripeCreates = [];
  h.session = null;
  h.emails = [];
  await h.db.execute(
    sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${CREATOR}, 'queen-creator', 'Queen Creator')`,
  );
  await h.db.execute(
    sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${OTHER_PROFILE_ID}, ${OTHER_CREATOR}, 'other-creator', 'Other Creator')`,
  );
  await h.db.execute(
    sql`INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, is_published, audio_url) VALUES (${TRACK_ID}, ${PROFILE_ID}, 'Golden Track', ${TRACK_PRICE}, true, 'https://cdn.example.com/track.mp3')`,
  );
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* the download page is HTML */
  }
  return { status: r.status, json, text };
}

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = h.userId;
  h.userId = userId;
  try {
    return await fn();
  } finally {
    h.userId = prev;
  }
}

async function enableKeys(maxDownloads: number | null) {
  return asUser(CREATOR, () =>
    req("PUT", `/store/item/track/${TRACK_ID}/license-settings`, {
      licenseKeysEnabled: true,
      maxDownloads,
    }),
  );
}

function paidSession(sessionId = "cs_test_1") {
  return {
    id: sessionId,
    payment_status: "paid",
    amount_total: TRACK_PRICE,
    payment_intent: "pi_test_1",
    metadata: {
      buyer_user_id: BUYER,
      item_kind: "track",
      item_id: TRACK_ID,
      profile_id: PROFILE_ID,
    },
    customer_details: null,
  };
}

async function buyViaVerify(sessionId = "cs_test_1") {
  h.session = paidSession(sessionId);
  return asUser(BUYER, () => req("POST", "/store/verify", { sessionId }));
}

async function keyRows() {
  const r = await h.db.execute(sql`SELECT * FROM digital_license_keys ORDER BY created_at ASC`);
  return r.rows as Array<Record<string, unknown>>;
}

async function download(token: string) {
  return req("GET", `/store/download/${token}`);
}

/* ── Lib units ─────────────────────────────────────────────────────────── */
describe("license key primitives", () => {
  it("generated keys match the BDV shape and are unique in practice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const k = generateLicenseKey();
      expect(k).toMatch(LICENSE_KEY_RE);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("hash, suffix and mask never expose the key", () => {
    const k = generateLicenseKey();
    expect(hashLicenseKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLicenseKey(k)).not.toContain(k);
    expect(licenseKeySuffix(k)).toBe(k.split("-").pop());
    const masked = maskLicenseKey(licenseKeySuffix(k));
    expect(masked.endsWith(licenseKeySuffix(k))).toBe(true);
    expect(masked).not.toContain(k.slice(0, -5));
  });

  it("encryption round-trips; tampering reads as null, never a throw", () => {
    const k = generateLicenseKey();
    const cipher = encryptLicenseKey(k);
    expect(cipher).not.toContain(k);
    expect(decryptLicenseKey(cipher)).toBe(k);
    expect(decryptLicenseKey(cipher.slice(0, -2) + "ff")).toBeNull();
    expect(decryptLicenseKey("not-a-cipher")).toBeNull();
    expect(decryptLicenseKey("")).toBeNull();
  });

  it("mint blocking matrix", () => {
    const base = {
      id: "x", sale_id: "s", profile_id: "p", buyer_user_id: "b",
      item_kind: "track", item_id: "i", item_title: "t", file_url: "f",
      key_hash: "h", key_cipher: "c", key_suffix: "zz",
      max_downloads: 3, download_count: 1, status: "active" as const,
      revoked_at: null, revoked_reason: null, reissue_count: 0, created_at: "",
    };
    expect(licenseBlocksMint(null)).toEqual({ blocked: false });
    expect(licenseBlocksMint(base)).toEqual({ blocked: false });
    expect(licenseBlocksMint({ ...base, max_downloads: null, download_count: 9999 })).toEqual({ blocked: false });
    expect(licenseBlocksMint({ ...base, download_count: 3 })).toEqual({ blocked: true, reason: "cap" });
    expect(licenseBlocksMint({ ...base, status: "revoked" })).toEqual({ blocked: true, reason: "revoked" });
  });
});

/* ── Seller settings ───────────────────────────────────────────────────── */
describe("license settings", () => {
  it("the owner sets them; they ride the products payload", async () => {
    const put = await enableKeys(3);
    expect(put.status).toBe(200);
    expect(put.json.settings).toEqual({ licenseKeysEnabled: true, maxDownloads: 3 });

    const products = await asUser(CREATOR, () => req("GET", "/store/products"));
    const mine = products.json.products.find((p: any) => p.id === TRACK_ID);
    expect(mine.licenseConfig).toEqual({ licenseKeysEnabled: true, maxDownloads: 3 });
  });

  it("a different creator cannot touch the item's settings (404)", async () => {
    const put = await asUser(OTHER_CREATOR, () =>
      req("PUT", `/store/item/track/${TRACK_ID}/license-settings`, { licenseKeysEnabled: true, maxDownloads: 3 }),
    );
    expect(put.status).toBe(404);
    const rows = await h.db.execute(sql`SELECT * FROM digital_product_settings`);
    expect(rows.rows).toHaveLength(0);
  });

  it("a user with no creator profile gets NO_PROFILE", async () => {
    const put = await asUser(STRANGER, () =>
      req("PUT", `/store/item/track/${TRACK_ID}/license-settings`, { licenseKeysEnabled: true, maxDownloads: 3 }),
    );
    expect(put.status).toBe(404);
    expect(put.json.error).toBe("NO_PROFILE");
  });

  it("a series can't take license settings (it unlocks, it doesn't download)", async () => {
    const put = await asUser(CREATOR, () =>
      req("PUT", `/store/item/series/${TRACK_ID}/license-settings`, { licenseKeysEnabled: true, maxDownloads: 3 }),
    );
    expect(put.status).toBe(400);
    expect(put.json.error).toBe("SERIES_UNLOCK");
  });

  it("the cap is validated (0 and negatives are not caps)", async () => {
    const put = await asUser(CREATOR, () =>
      req("PUT", `/store/item/track/${TRACK_ID}/license-settings`, { licenseKeysEnabled: true, maxDownloads: 0 }),
    );
    expect(put.status).toBe(400);
  });
});

/* ── Issuance ──────────────────────────────────────────────────────────── */
describe("issuance at fulfillment", () => {
  it("verify issues exactly one key — replayed verify reuses it, receipt carries it once", async () => {
    await enableKeys(3);
    const v = await buyViaVerify();
    expect(v.status).toBe(200);
    expect(v.json.license).toBeTruthy();
    expect(v.json.license.key).toMatch(LICENSE_KEY_RE);
    expect(v.json.license.maxDownloads).toBe(3);
    expect(v.json.license.downloadsUsed).toBe(0);
    expect(v.json.license.downloadsLeft).toBe(3);

    const rows = await keyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["key_hash"]).toBe(hashLicenseKey(v.json.license.key));
    /* The stored row never carries the plaintext key. */
    expect(JSON.stringify(rows[0])).not.toContain(v.json.license.key);

    /* Receipt email (first verify only) carries the full key. */
    const receipt = h.emails.find((e) => e.subject.includes("receipt"));
    expect(receipt).toBeTruthy();
    expect(receipt!.html).toContain(v.json.license.key);
    expect(receipt!.html).toContain("3 downloads included");

    /* Replay: same key, still one row, no second receipt. */
    const again = await buyViaVerify();
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(again.json.license.key).toBe(v.json.license.key);
    expect(await keyRows()).toHaveLength(1);
    expect(h.emails.filter((e) => e.subject.includes("receipt"))).toHaveLength(1);
  });

  it("with keys off, a purchase issues nothing and behaves as before", async () => {
    const v = await buyViaVerify();
    expect(v.status).toBe(200);
    expect(v.json.license).toBeNull();
    expect(await keyRows()).toHaveLength(0);
    expect(v.json.download?.url).toContain("/api/store/download/");
  });

  it("a gift-card full-pay purchase issues its key too", async () => {
    await enableKeys(5);
    const cardId = randomUUID();
    await h.db.execute(sql`
      INSERT INTO gift_cards (id, code_hash, code_last4, profile_id, buyer_user_id, recipient_email, initial_cents, balance_cents, status, stripe_session_id)
      VALUES (${cardId}, ${hashGiftCardCode(CARD_CODE)}, 'DDDD', ${PROFILE_ID}, ${BUYER}, 'friend@example.com', 5000, 5000, 'active', 'cs_seed_card')
    `);
    const r = await asUser(BUYER, () =>
      req("POST", "/store/checkout", { kind: "track", id: TRACK_ID, giftCardCode: CARD_CODE }),
    );
    expect(r.status).toBe(200);
    expect(r.json.paidWithGiftCard).toBe(true);
    expect(r.json.license?.key).toMatch(LICENSE_KEY_RE);
    expect(r.json.license?.maxDownloads).toBe(5);
    expect(await keyRows()).toHaveLength(1);
  });

  it("the key snapshots the cap at purchase — a later settings edit doesn't rewrite it", async () => {
    await enableKeys(3);
    const v = await buyViaVerify();
    await enableKeys(9);
    const rows = await keyRows();
    expect(rows[0]?.["max_downloads"]).toBe(3);
    expect(v.json.license.maxDownloads).toBe(3);
  });
});

/* ── Download counting + cap ───────────────────────────────────────────── */
describe("download counting and the cap", () => {
  it("counts per buyer on the key and stops honestly at the cap", async () => {
    await enableKeys(2);
    const v = await buyViaVerify();
    const token = v.json.download.token as string;

    const d1 = await download(token);
    expect(d1.status).toBe(200);
    expect(d1.text).toContain("1 of 2 license downloads left");

    const d2 = await download(token);
    expect(d2.status).toBe(200);
    expect(d2.text).toContain("0 of 2 license downloads left");

    const d3 = await download(token);
    expect(d3.status).toBe(410);
    expect(d3.text).toContain("used all 2 downloads");

    const rows = await keyRows();
    expect(rows[0]?.["download_count"]).toBe(2);

    /* And minting stops too — the cap is the buyer's, not the link's. */
    const saleId = v.json.sale.id as string;
    const mint = await asUser(BUYER, () => req("POST", "/store/token", { saleId }));
    expect(mint.status).toBe(403);
    expect(mint.json.error).toBe("DOWNLOAD_LIMIT_REACHED");
  });

  it("a fresh link never resets the count", async () => {
    await enableKeys(3);
    const v = await buyViaVerify();
    await download(v.json.download.token as string); // count 1 on link 1

    const saleId = v.json.sale.id as string;
    const mint = await asUser(BUYER, () => req("POST", "/store/token", { saleId }));
    expect(mint.status).toBe(200);
    const fresh = mint.json.token as string;
    expect(fresh).not.toBe(v.json.download.token);

    await download(fresh); // count 2
    const d3 = await download(fresh); // count 3 — cap reached across links
    expect(d3.status).toBe(200);
    const d4 = await download(fresh);
    expect(d4.status).toBe(410);
    const rows = await keyRows();
    expect(rows[0]?.["download_count"]).toBe(3);
  });

  it("an unlimited key bypasses the per-link cap and says so", async () => {
    await enableKeys(null);
    const v = await buyViaVerify();
    const token = v.json.download.token as string;
    for (let i = 0; i < 6; i++) {
      const d = await download(token);
      expect(d.status).toBe(200);
      expect(d.text).toContain("Unlimited downloads with your license key");
    }
    const rows = await keyRows();
    expect(rows[0]?.["download_count"]).toBe(6);
  });

  it("a non-keyed purchase keeps the legacy per-link behavior", async () => {
    const v = await buyViaVerify();
    const token = v.json.download.token as string;
    for (let i = 0; i < 5; i++) {
      expect((await download(token)).status).toBe(200);
    }
    const d6 = await download(token);
    expect(d6.status).toBe(410);
    expect(d6.text).toContain("hit its 5-download limit");
  });
});

/* ── Revoke + re-issue ─────────────────────────────────────────────────── */
describe("revoke and re-issue", () => {
  it("the seller's list is masked; revoke stops downloads and mints at once", async () => {
    await enableKeys(3);
    const v = await buyViaVerify();
    const fullKey = v.json.license.key as string;

    const list = await asUser(CREATOR, () => req("GET", `/store/item/track/${TRACK_ID}/licenses`));
    expect(list.status).toBe(200);
    expect(list.json.licenses).toHaveLength(1);
    expect(list.json.licenses[0].maskedKey).toBe(maskLicenseKey(licenseKeySuffix(fullKey)));
    /* The seller surface never carries the full key. */
    expect(JSON.stringify(list.json)).not.toContain(fullKey);
    const keyId = list.json.licenses[0].id as string;

    const revoke = await asUser(CREATOR, () => req("POST", `/store/licenses/${keyId}/revoke`));
    expect(revoke.status).toBe(200);
    expect(revoke.json.license.status).toBe("revoked");

    const d = await download(v.json.download.token as string);
    expect(d.status).toBe(410);
    expect(d.text).toContain("license key has been revoked");

    const mint = await asUser(BUYER, () => req("POST", "/store/token", { saleId: v.json.sale.id }));
    expect(mint.status).toBe(403);
    expect(mint.json.error).toBe("LICENSE_REVOKED");

    /* The buyer's library states the revocation honestly. */
    const purchases = await asUser(BUYER, () => req("GET", "/store/purchases"));
    expect(purchases.json.purchases[0].license.status).toBe("revoked");
    expect(purchases.json.purchases[0].license.key).toBe(fullKey);
  });

  it("re-issue rotates the key, resets the count, and downloads flow again", async () => {
    await enableKeys(2);
    const v = await buyViaVerify();
    const oldKey = v.json.license.key as string;
    await download(v.json.download.token as string); // count 1

    const list = await asUser(CREATOR, () => req("GET", `/store/item/track/${TRACK_ID}/licenses`));
    const keyId = list.json.licenses[0].id as string;
    const re = await asUser(CREATOR, () => req("POST", `/store/licenses/${keyId}/reissue`));
    expect(re.status).toBe(200);
    expect(re.json.license.status).toBe("active");
    expect(re.json.license.downloadsUsed).toBe(0);

    const rows = await keyRows();
    expect(rows).toHaveLength(1); // rotation is in place — still exactly one key per purchase
    expect(rows[0]?.["key_hash"]).not.toBe(hashLicenseKey(oldKey));
    expect(rows[0]?.["reissue_count"]).toBe(1);

    const purchases = await asUser(BUYER, () => req("GET", "/store/purchases"));
    const newKey = purchases.json.purchases[0].license.key as string;
    expect(newKey).toMatch(LICENSE_KEY_RE);
    expect(newKey).not.toBe(oldKey);
    expect(purchases.json.purchases[0].license.downloadsUsed).toBe(0);

    const d = await download(v.json.download.token as string);
    expect(d.status).toBe(200);
  });

  it("a refunded sale's key can never be re-issued", async () => {
    await enableKeys(3);
    const v = await buyViaVerify();
    await h.db.execute(sql`UPDATE digital_sales SET status = 'refunded' WHERE id = ${v.json.sale.id}`);
    await h.db.execute(sql`UPDATE digital_license_keys SET status = 'revoked', revoked_reason = 'refund'`);
    const list = await asUser(CREATOR, () => req("GET", `/store/item/track/${TRACK_ID}/licenses`));
    const keyId = list.json.licenses[0].id as string;
    const re = await asUser(CREATOR, () => req("POST", `/store/licenses/${keyId}/reissue`));
    expect(re.status).toBe(404);
    const rows = await keyRows();
    expect(rows[0]?.["status"]).toBe("revoked");
  });

  it("another creator can't revoke or re-issue keys that aren't theirs", async () => {
    await enableKeys(3);
    await buyViaVerify();
    const list = await asUser(CREATOR, () => req("GET", `/store/item/track/${TRACK_ID}/licenses`));
    const keyId = list.json.licenses[0].id as string;

    const revoke = await asUser(OTHER_CREATOR, () => req("POST", `/store/licenses/${keyId}/revoke`));
    expect(revoke.status).toBe(404);
    const reissue = await asUser(OTHER_CREATOR, () => req("POST", `/store/licenses/${keyId}/reissue`));
    expect(reissue.status).toBe(404);
    const rows = await keyRows();
    expect(rows[0]?.["status"]).toBe("active");
  });
});

/* ── Buyer vs stranger ─────────────────────────────────────────────────── */
describe("buyer vs stranger", () => {
  it("the buyer's library shows the full key and the live remaining count", async () => {
    await enableKeys(3);
    const v = await buyViaVerify();
    await download(v.json.download.token as string);
    const purchases = await asUser(BUYER, () => req("GET", "/store/purchases"));
    const p = purchases.json.purchases[0];
    expect(p.license.key).toBe(v.json.license.key);
    expect(p.license.downloadsUsed).toBe(1);
    expect(p.license.downloadsLeft).toBe(2);
    expect(p.licenses).toHaveLength(1);
  });

  it("a stranger's library is empty and they cannot mint against the buyer's sale", async () => {
    await enableKeys(3);
    const v = await buyViaVerify();
    const purchases = await asUser(STRANGER, () => req("GET", "/store/purchases"));
    expect(purchases.json.purchases).toHaveLength(0);
    const mint = await asUser(STRANGER, () => req("POST", "/store/token", { saleId: v.json.sale.id }));
    expect(mint.status).toBe(404);
    const list = await asUser(STRANGER, () => req("GET", `/store/item/track/${TRACK_ID}/licenses`));
    expect(list.status).toBe(404);
  });

  it("the public buy page advertises the key and its cap up front", async () => {
    await enableKeys(4);
    const item = await req("GET", `/store/item/track/${TRACK_ID}`);
    expect(item.json.license).toEqual({ keysIssued: true, maxDownloads: 4 });
  });
});
