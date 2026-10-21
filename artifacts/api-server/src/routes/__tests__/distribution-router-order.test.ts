/**
 * Lane V5 F-1 regression — router COMPOSITION, production mount order.
 *
 * routes/index.ts mounts generate/distribution BEFORE distribution-
 * legacy. The distribution router's GET /distribution/splits/:slug used
 * to 404 any slug failing its hex regex WITHOUT calling next(), so the
 * legacy router's literal GET /distribution/splits/statements (fetched
 * by DistributionLegacyPanels) was unreachable in production — while
 * the legacy test suite mounted the routers in the opposite order and
 * could never see it. This suite mounts them exactly as production
 * does and drives both routes over HTTP against pg-mem.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["SPOTIFY_CLIENT_ID"] = "test-client";
process.env["SPOTIFY_CLIENT_SECRET"] = "test-secret";
process.env["SOCIAL_TOKEN_KEY"] = "a".repeat(64);

const testState = vi.hoisted(() => ({ db: null as any, userId: "", userEmail: "" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = testState.userId; req.userEmail = testState.userEmail; req.userCredits = 10000; next(); },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 9000),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));
vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-6-sol",
  getOpenAI: () => ({ chat: { completions: { create: async () => { throw new Error("not used"); } } } }),
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: vi.fn(async (v: string) => v), mirrorProjectScenes: vi.fn(async (v: unknown) => v) }));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

import distributionRouter from "../generate/distribution";
import legacyRouter from "../distribution-legacy";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE distribution_releases (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, artist_name text NOT NULL,
  release_date text, platforms jsonb NOT NULL DEFAULT '[]'::jsonb, audio_url text, artwork_url text,
  metadata jsonb, strategy jsonb, status text NOT NULL DEFAULT 'draft', credits_charged integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  release_type text NOT NULL DEFAULT 'single', isrc text, genre text, explicit boolean NOT NULL DEFAULT false,
  explicit_declared boolean NOT NULL DEFAULT false, upc text, label text, copyright_line text, song_id uuid,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb, aggregator text NOT NULL DEFAULT 'none', aggregator_release_id text,
  platform_statuses jsonb NOT NULL DEFAULT '[]'::jsonb, presave_slug text, split_share_slug text,
  upc_kind text NOT NULL DEFAULT 'internal', label_imprint text, copyright_c_line text, copyright_p_line text,
  subgenre text, original_release_date text, preorder_date text, territories_mode text NOT NULL DEFAULT 'worldwide',
  territories jsonb NOT NULL DEFAULT '[]'::jsonb,
  presave_headline text, presave_platform_links jsonb NOT NULL DEFAULT '{}'::jsonb, presave_bonus_url text, meta_pixel_id text, tiktok_pixel_id text, google_tag_id text
);
CREATE TABLE royalty_entries (id uuid PRIMARY KEY, user_id uuid NOT NULL, song_title text NOT NULL, artist_name text, platform text NOT NULL, period_start text NOT NULL, period_end text NOT NULL, streams text, gross_amount numeric(12,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD', source text NOT NULL DEFAULT 'csv', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE distribution_royalty_splits (id uuid PRIMARY KEY, release_id uuid NOT NULL, user_id uuid NOT NULL, payee_name text NOT NULL, role text, share_pct numeric(5,2) NOT NULL, payee_email text, invite_status text NOT NULL DEFAULT 'not_invited', invite_token text, agreement_version integer NOT NULL DEFAULT 1, effective_from timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const OWNER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  /* PRODUCTION ORDER (routes/index.ts:568-569): distribution first. */
  app.use("/api", distributionRouter);
  app.use("/api", legacyRouter);
  app.use((_req: any, res: any) => res.status(404).json({ error: "Not found" }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = OWNER;
  testState.userEmail = "owner@example.com";
  vi.clearAllMocks();
});

async function req(method: string, path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" } });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("router composition in production order (Lane V5 F-1)", () => {
  it("GET /distribution/splits/statements reaches the legacy handler (not shadowed by :slug)", async () => {
    const { status, json } = await req("GET", "/distribution/splits/statements");
    expect(status).toBe(200);
    expect(Array.isArray(json.statements)).toBe(true);
    expect(json.hasData).toBe(false); // nothing seeded — honest empty, not the slug 404
  });

  it("the public split-share slug route still serves a well-formed slug", async () => {
    const releaseId = randomUUID();
    await testState.db.execute(sql`
      INSERT INTO distribution_releases (id, user_id, title, artist_name, split_share_slug)
      VALUES (${releaseId}, ${OWNER}, ${"Gold Water"}, ${"Test Artist"}, ${"abcdef0123"})`);
    await testState.db.execute(sql`
      INSERT INTO distribution_royalty_splits (id, release_id, user_id, payee_name, role, share_pct, agreement_version)
      VALUES (${randomUUID()}, ${releaseId}, ${OWNER}, ${"Me"}, ${"artist"}, ${70}, ${1})`);
    const { status, json } = await req("GET", "/distribution/splits/abcdef0123");
    expect(status).toBe(200);
    expect(json.title).toBe("Gold Water");
    expect(json.splits).toHaveLength(1);
    expect(json.splits[0].share).toBe(70);
  });

  it("a well-formed slug with no release still 404s from the slug handler", async () => {
    const { status, json } = await req("GET", "/distribution/splits/0123456789");
    expect(status).toBe(404);
    expect(json.error).toMatch(/not found/i);
  });

  it("a malformed non-literal segment falls through both routers to 404", async () => {
    const { status } = await req("GET", "/distribution/splits/not-a-slug-or-literal");
    expect(status).toBe(404);
  });
});
