/**
 * Back-Catalog Migration Assistant (0200) — HTTP over pg-mem.
 * Pins the wire shape: members-only, honest provider states over the
 * wire (TikTok = 422 PROVIDER_BLOCKED with the reason in plain words),
 * the upload key guard, and the full scan → fetch → rebuild → approve
 * journey landing a published profile video. No credits table exists
 * in this DB — any charge attempt would fail the request loudly.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
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

import catalogImportRouter from "../catalog-import";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { encryptToken } from "../../lib/social-crypto";
import { setCatalogImportDeps } from "../../lib/catalog-import";

function createTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const shim = {
    query: async (config: unknown, values?: unknown[]) => {
      let cfg: unknown = config;
      let wantArray = false;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        const { types: _t, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const result = (await (pool as any).query(cfg, values)) as any;
      if (wantArray && Array.isArray(result?.rows) && result.rows.length > 0) {
        const names = Object.keys(result.rows[0]);
        return { ...result, rows: result.rows.map((row: any) => names.map((n) => row[n])) };
      }
      return result;
    },
  };
  return drizzle(shim as never);
}

const DDL = `
CREATE TABLE social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'instagram',
  ig_user_id text, provider_user_id text, username text,
  page_id text, page_name text,
  access_token_encrypted text, refresh_token_encrypted text,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  avatar_url text, banner_url text,
  theme_id text NOT NULL DEFAULT 'gold-lux',
  vertical text NOT NULL DEFAULT 'music',
  stream_schedule jsonb NOT NULL DEFAULT '[]',
  media_kit jsonb,
  theme_config jsonb NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',
  layout_blocks jsonb NOT NULL DEFAULT '[]',
  pinned_kind text, pinned_item_id uuid,
  collection_visibility text NOT NULL DEFAULT 'public',
  featured_media jsonb,
  merch_items jsonb NOT NULL DEFAULT '[]',
  events jsonb NOT NULL DEFAULT '[]',
  series jsonb NOT NULL DEFAULT '[]',
  social_posts jsonb NOT NULL DEFAULT '[]',
  social_links jsonb NOT NULL DEFAULT '{}',
  top_creators jsonb NOT NULL DEFAULT '[]',
  tip_jar_enabled boolean NOT NULL DEFAULT true,
  ai_design jsonb,
  is_public boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  is_official boolean NOT NULL DEFAULT false,
  follower_count integer NOT NULL DEFAULT 0,
  total_plays integer NOT NULL DEFAULT 0,
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean NOT NULL DEFAULT false,
  stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  title text NOT NULL, video_url text NOT NULL, thumbnail_url text,
  description text NOT NULL DEFAULT '', genre text, tags text[] NOT NULL DEFAULT '{}',
  duration_sec integer NOT NULL DEFAULT 0,
  season integer, episode integer, sound_track_id uuid,
  download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false,
  pwyw_min_cents integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  is_short boolean NOT NULL DEFAULT false,
  duet_with uuid, stitch_with uuid,
  sound_id text, sound_title text, sound_url text,
  sound_use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  cover_url text,
  is_public boolean NOT NULL DEFAULT true,
  kind text NOT NULL DEFAULT 'playlist',
  price_cents integer,
  preview_item jsonb DEFAULT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  follower_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  audio_url text NOT NULL,
  audio_path text,
  source text NOT NULL DEFAULT 'upload',
  parent_song_id uuid,
  artist_vault_id uuid,
  mashup_sources jsonb,
  mashup_style text,
  duration_sec text,
  lyrics text, genre text, isrc text, cover_art_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalog_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_kind text NOT NULL,
  platform text,
  social_account_id uuid,
  external_id text,
  kind text NOT NULL,
  title text NOT NULL,
  original_caption text,
  original_url text,
  remote_file_url text,
  remote_thumbnail_url text,
  media_url text,
  storage_key text,
  thumbnail_url text,
  duration_sec integer,
  status text NOT NULL DEFAULT 'listed',
  status_note text,
  draft jsonb,
  target_kind text,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_import_items_dedupe_ux ON catalog_import_items (user_id, platform, external_id);
`;

const USER = randomUUID();
const IG_ID = randomUUID();
const TT_ID = randomUUID();
const PROFILE_ID = randomUUID();
const TEST_KEY = "b".repeat(64);

let server: any;
let baseUrl: string;

async function call(method: string, path: string, body?: unknown, user: string | null = USER) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, json };
}

beforeAll(async () => {
  process.env["SOCIAL_TOKEN_KEY"] = TEST_KEY;
  testState.db = createTestDb();
  const app = express();
  app.use(express.json());
  app.use("/api", catalogImportRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  setCatalogImportDeps({
    fetchImpl: async (url: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        data: [
          {
            id: "ig-1",
            caption: "Harbor Nights S1E1 — the pilot\n#harbor",
            media_type: "VIDEO",
            media_product_type: "FEED",
            media_url: "https://cdn.ig.test/pilot.mp4",
            thumbnail_url: "https://cdn.ig.test/pilot.jpg",
            permalink: "https://instagram.com/p/pilot",
            timestamp: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    }) as any,
    downloadBuffer: async (url: string) => Buffer.from(`bytes:${url}`),
    uploadObject: async (key: string) => `https://cdn.bowdown.test/${key}`,
    publicUrl: (key: string) => `https://cdn.bowdown.test/${key}`,
    transcribe: async () => ({ text: "the pilot opens on the harbor.", duration: 30, language: "en", words: [], segments: [] }),
    aiText: async () => ({ title: "Harbor Nights — The Pilot", description: "The pilot.", tags: ["harbor"] }),
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { sql } = await import("drizzle-orm");
  for (const t of ["social_accounts", "creator_profiles", "profile_videos", "playlists", "songs", "catalog_import_items"]) {
    await testState.db.execute(sql.raw(`DELETE FROM ${t}`));
  }
  const { socialAccountsTable, creatorProfilesTable } = await import("@workspace/db");
  await testState.db.insert(socialAccountsTable).values([
    { id: IG_ID, user_id: USER, platform: "instagram", ig_user_id: "ig-1", username: "nova", access_token_encrypted: encryptToken("tok") },
    { id: TT_ID, user_id: USER, platform: "tiktok", provider_user_id: "tt-1", username: "nova.tt", access_token_encrypted: encryptToken("tok") },
  ]);
  await testState.db.insert(creatorProfilesTable).values({
    id: PROFILE_ID, userId: USER, slug: "nova", displayName: "Nova", socialLinks: {},
  });
});

describe("catalog-import HTTP", () => {
  it("is members-only", async () => {
    const res = await call("GET", "/api/catalog-import", undefined, null);
    expect(res.status).toBe(401);
  });

  it("state carries the honest account verdicts", async () => {
    const res = await call("GET", "/api/catalog-import");
    expect(res.status).toBe(200);
    const tt = res.json.accounts.find((a: any) => a.platform === "tiktok");
    expect(tt.state).toBe("blocked");
    expect(tt.note).toContain("TikTok doesn't give apps a way");
    expect(res.json.honesty.movesLine).toContain("Your followers don't");
  });

  it("tiktok scan over the wire is 422 PROVIDER_BLOCKED with the reason", async () => {
    const res = await call("POST", "/api/catalog-import/scan", { accountId: TT_ID });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("PROVIDER_BLOCKED");
    expect(res.json.error).toContain("bulk upload");
  });

  it("bad bodies are 400s, not 500s", async () => {
    expect((await call("POST", "/api/catalog-import/scan", { accountId: "nope" })).status).toBe(400);
    expect((await call("POST", "/api/catalog-import/fetch", { itemIds: [] })).status).toBe(400);
    expect((await call("POST", "/api/catalog-import/items/not-a-uuid/approve", {})).status).toBe(400);
  });

  it("upload registration refuses a foreign storage key", async () => {
    const res = await call("POST", "/api/catalog-import/uploads", {
      files: [{ key: `${randomUUID()}/catalog-import/x.mp4`, filename: "x.mp4", kind: "video" }],
    });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("BAD_KEY");
  });

  it("the full journey: scan → fetch → rebuild → approve lands a published video", async () => {
    const scan = await call("POST", "/api/catalog-import/scan", { accountId: IG_ID });
    expect(scan.status).toBe(200);
    expect(scan.json.listed).toBe(1);
    const itemId = scan.json.items[0].id;

    const fetched = await call("POST", "/api/catalog-import/fetch", { itemIds: [itemId] });
    expect(fetched.json.results[0]).toMatchObject({ ok: true, status: "here" });

    const rebuilt = await call("POST", `/api/catalog-import/items/${itemId}/rebuild`);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.json.item.status).toBe("ready");
    expect(rebuilt.json.item.draft.source).toBe("ai");

    const approved = await call("POST", `/api/catalog-import/items/${itemId}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.json.item.status).toBe("approved");
    expect(approved.json.item.targetKind).toBe("profile_video");

    const { profileVideosTable } = await import("@workspace/db");
    const videos = await testState.db.select().from(profileVideosTable);
    expect(videos).toHaveLength(1);
    expect(videos[0]!.isPublished).toBe(true);
    expect(videos[0]!.title).toBe("Harbor Nights — The Pilot");
  });
});
