/**
 * Stack 10 raw-SQL surfaces against pg-mem (createTestDb), the pattern
 * earnings.test.ts uses: #3 catalog manifest completeness on a fixture
 * account (via the exported builder — the job row shell is covered in
 * trust.test.ts) and #5 annual statements over HTTP (those handlers
 * are execute-only), including the error-vs-fake-zero discipline.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any, userId: "" }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = testState.userId; next(); },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

import trustRouter, { buildCatalogManifest } from "../trust";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text);
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL, amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, stripe_session_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sponsor_payouts (id uuid PRIMARY KEY, creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'released', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE royalty_entries (id uuid PRIMARY KEY, user_id uuid NOT NULL, song_title text NOT NULL, platform text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, gross_amount numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, audio_url text NOT NULL, source text NOT NULL DEFAULT 'upload', duration_sec text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE generated_clips (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text, video_url text, thumbnail_url text, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE distribution_releases (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, artist_name text NOT NULL, status text NOT NULL DEFAULT 'draft', audio_url text, artwork_url text, platforms jsonb, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE store_products (id uuid PRIMARY KEY, profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL, price_cents integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, media_urls jsonb);
CREATE TABLE email_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL);
CREATE TABLE email_subscribers (id uuid PRIMARY KEY, list_id uuid NOT NULL, email text NOT NULL, name text, source text NOT NULL DEFAULT 'landing', unsubscribed_at timestamptz, subscribed_at timestamptz NOT NULL DEFAULT now());
`;

const OWNER = randomUUID(), STRANGER = randomUUID(), PROFILE = randomUUID();
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(trustRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(DDL);
  testState.db = db; testState.userId = OWNER;
});

describe("#3 catalog manifest completeness (fixture account)", () => {
  it("carries every section with the fixture rows; audience excludes unsubscribed; other creators never leak in", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url) VALUES (${randomUUID()}, ${OWNER}, 'Song A', 'https://files.example/a.wav')`);
    await db.execute(sql`INSERT INTO generated_clips (id, user_id, title, video_url) VALUES (${randomUUID()}, ${OWNER}, 'Clip A', 'https://files.example/a.mp4')`);
    await db.execute(sql`INSERT INTO distribution_releases (id, user_id, title, artist_name, status) VALUES (${randomUUID()}, ${OWNER}, 'Rel A', 'Me', 'draft')`);
    await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents) VALUES (${randomUUID()}, ${PROFILE}, 'digital', 'Pack A', 1900)`);
    const list = randomUUID();
    await db.execute(sql`INSERT INTO email_lists (id, user_id, name, handle) VALUES (${list}, ${OWNER}, 'Fans', 'fans-a')`);
    await db.execute(sql`INSERT INTO email_subscribers (id, list_id, email) VALUES (${randomUUID()}, ${list}, 'fan@example.com')`);
    await db.execute(sql`INSERT INTO email_subscribers (id, list_id, email, unsubscribed_at) VALUES (${randomUUID()}, ${list}, 'gone@example.com', now())`);
    await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url) VALUES (${randomUUID()}, ${STRANGER}, 'Not Mine', 'https://files.example/x.wav')`);

    const m: any = await buildCatalogManifest(OWNER);
    expect(m.format).toBe("manifest+links");
    expect(m.partial).toBe(false);
    expect(m.songs.count).toBe(1); expect(m.songs.items[0].title).toBe("Song A"); expect(m.songs.items[0].fileUrl).toContain("a.wav");
    expect(m.videos.count).toBe(1);
    expect(m.releases.count).toBe(1);
    expect(m.storeProducts.count).toBe(1);
    expect(m.audience.count).toBe(1); expect(m.audience.items[0].email).toBe("fan@example.com");
  });

  it("a missing source table reads status error + partial — never a fake empty section presented as complete", async () => {
    const { db, mem } = createTestDb();
    mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
    mem.public.none(DDL.replace(/CREATE TABLE songs[^;]+;/, ""));
    testState.db = db;
    const m: any = await buildCatalogManifest(OWNER);
    expect(m.songs.status).toBe("error");
    expect(m.songs.count).toBeNull();
    expect(m.partial).toBe(true);
    expect(m.videos.status).toBe("ok");
  });
});

describe("#5 earnings statements", () => {
  it("sums only recorded rows for the year, royalties converted from dollars, other years excluded; PDF renders", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 5000, 'completed', '2026-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 9999, 'completed', '2025-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, stripe_session_id, created_at) VALUES (${randomUUID()}, ${OWNER}, 1500, 'cs_1', '2026-05-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO royalty_entries (id, user_id, song_title, platform, period_start, period_end, gross_amount) VALUES (${randomUUID()}, ${OWNER}, 'S', 'manual', '2026-01-01', '2026-01-31', 12.34)`);

    const r = await realFetch(`${baseUrl}/earnings/statements/2026`);
    const json: any = await r.json();
    expect(json.statement.sources.storeSales.totalCents).toBe(5000);
    expect(json.statement.sources.memberships.totalCents).toBe(1500);
    expect(json.statement.sources.royalties.totalCents).toBe(1234);
    expect(json.statement.totalCents).toBe(7734);
    expect(json.statement.documentKind).toBe("statement_of_platform_recorded_earnings");
    expect(json.statement.disclaimer).toMatch(/not a filed tax form/);

    const pdf = await realFetch(`${baseUrl}/earnings/statements/2026/pdf`);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect((await pdf.text()).startsWith("%PDF")).toBe(true);
  });

  it("a year with no records reads honest zeros, not an error", async () => {
    const r = await realFetch(`${baseUrl}/earnings/statements/2024`);
    const json: any = await r.json();
    expect(json.statement.totalCents).toBe(0);
    expect(json.statement.partial).toBe(false);
  });
});
