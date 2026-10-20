/**
 * Catalog export BUILDER (stack3) — POST /api/catalog-export/build over
 * HTTP against pg-mem, the trust-money.test.ts pattern, with the
 * header-driven requireAuth mock from trust.test.ts so the 401 case is
 * real. Pins: the export carries exactly the caller's rows across two
 * seeded owners, field selection is honored in both formats, bad
 * kind/field/format/empty-fields are 400s, and the CSV is well-formed
 * (RFC-4180 quoting) under hostile titles.
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

import trustRouter from "../trust";
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
CREATE TABLE catalog_export_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, status text NOT NULL DEFAULT 'running', progress integer NOT NULL DEFAULT 0, manifest jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
`;

const OWNER = randomUUID(), STRANGER = randomUUID();
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
  testState.db = db;
});

async function seedCatalog() {
  const db = testState.db;
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source, duration_sec) VALUES (${randomUUID()}, ${OWNER}, 'Song "A", Live', 'https://files.example/a.wav', 'upload', '187')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url, source) VALUES (${randomUUID()}, ${OWNER}, 'Second Song', 'https://files.example/b.wav', 'generated')`);
  await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url) VALUES (${randomUUID()}, ${STRANGER}, 'Not Mine', 'https://files.example/x.wav')`);
  await db.execute(sql`INSERT INTO distribution_releases (id, user_id, title, artist_name, status, audio_url) VALUES (${randomUUID()}, ${OWNER}, 'Rel A', 'Me', 'live', 'https://files.example/r.wav')`);
  await db.execute(sql`INSERT INTO distribution_releases (id, user_id, title, artist_name, status) VALUES (${randomUUID()}, ${STRANGER}, 'Their Rel', 'Them', 'draft')`);
  await db.execute(sql`INSERT INTO generated_clips (id, user_id, title, video_url, status) VALUES (${randomUUID()}, ${OWNER}, 'Clip A', 'https://files.example/a.mp4', 'completed')`);
  await db.execute(sql`INSERT INTO generated_clips (id, user_id, title, video_url) VALUES (${randomUUID()}, ${STRANGER}, 'Their Clip', 'https://files.example/y.mp4')`);
}

async function build(user: string | null, body: unknown) {
  const r = await realFetch(`${baseUrl}/catalog-export/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
  return r;
}

/* Minimal RFC-4180 parser: enough to prove our own output round-trips. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

describe("catalog export builder", () => {
  it("tracks CSV carries exactly the caller's rows, default fields, and round-trips hostile titles", async () => {
    await seedCatalog();
    const r = await build(OWNER, { kind: "tracks" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("my-catalog-tracks.csv");
    expect(r.headers.get("x-export-truncated")).toBeNull();
    const rows = parseCsv(await r.text());
    expect(rows[0]).toEqual(["id", "title", "source", "durationSec", "fileUrl", "createdAt"]);
    expect(rows).toHaveLength(3); // header + the owner's 2 songs
    const titles = rows.slice(1).map((row) => row[1]);
    expect(titles).toContain('Song "A", Live');
    expect(titles).toContain("Second Song");
    expect(titles).not.toContain("Not Mine");
  });

  it("field selection is honored in JSON: rows carry exactly the picked keys", async () => {
    await seedCatalog();
    const r = await build(OWNER, { kind: "tracks", fields: ["title", "createdAt"], format: "json" });
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.format).toBe("catalog-export");
    expect(j.kind).toBe("tracks");
    expect(j.fields).toEqual(["title", "createdAt"]);
    expect(j.count).toBe(2);
    expect(j.truncated).toBe(false);
    for (const row of j.rows) expect(Object.keys(row).sort()).toEqual(["createdAt", "title"]);
  });

  it("field selection is honored in CSV: the header is exactly the picked fields", async () => {
    await seedCatalog();
    const r = await build(OWNER, { kind: "releases", fields: ["title", "status"], format: "csv" });
    expect(r.status).toBe(200);
    const rows = parseCsv(await r.text());
    expect(rows[0]).toEqual(["title", "status"]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["Rel A", "live"]);
  });

  it("releases and videos are owner-scoped too", async () => {
    await seedCatalog();
    const rel = await (await build(OWNER, { kind: "releases", format: "json" })).json() as any;
    expect(rel.count).toBe(1);
    expect(rel.rows[0].title).toBe("Rel A");
    expect(rel.rows[0].artistName).toBe("Me");
    const vid = await (await build(OWNER, { kind: "videos", format: "json" })).json() as any;
    expect(vid.count).toBe(1);
    expect(vid.rows[0].title).toBe("Clip A");
    expect(vid.rows[0].fileUrl).toContain("a.mp4");
    const theirs = await (await build(STRANGER, { kind: "videos", format: "json" })).json() as any;
    expect(theirs.count).toBe(1);
    expect(theirs.rows[0].title).toBe("Their Clip");
  });

  it("an owner with nothing gets a header-only CSV / an empty JSON, never an error", async () => {
    await seedCatalog();
    const r = await build(randomUUID(), { kind: "tracks" });
    expect(r.status).toBe(200);
    const rows = parseCsv(await r.text());
    expect(rows).toHaveLength(1); // header only
    const j = await (await build(randomUUID(), { kind: "tracks", format: "json" })).json() as any;
    expect(j.count).toBe(0);
    expect(j.rows).toEqual([]);
  });

  it("bad kind, bad field, bad format, and empty fields are all 400s", async () => {
    await seedCatalog();
    expect((await build(OWNER, { kind: "audience" })).status).toBe(400);
    expect((await build(OWNER, { kind: "tracks", fields: ["email"] })).status).toBe(400);
    expect((await build(OWNER, { kind: "tracks", fields: ["title", "user_id"] })).status).toBe(400);
    expect((await build(OWNER, { kind: "tracks", format: "xml" })).status).toBe(400);
    expect((await build(OWNER, { kind: "tracks", fields: [] })).status).toBe(400);
    expect((await build(OWNER, {})).status).toBe(400);
  });

  it("duplicate fields are deduped, not doubled", async () => {
    await seedCatalog();
    const r = await build(OWNER, { kind: "videos", fields: ["title", "title"], format: "json" });
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.fields).toEqual(["title"]);
  });

  it("unauthenticated is a 401", async () => {
    await seedCatalog();
    expect((await build(null, { kind: "tracks" })).status).toBe(401);
  });
});
