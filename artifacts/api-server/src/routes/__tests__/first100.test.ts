/**
 * First 100 Fans (#155) — HTTP over pg-mem. Pins the wire contract:
 *  - auth is required on every door;
 *  - GET reads the REAL count from follows (a seeded creator with
 *    10 follows reads 10 fans, milestones 1 + 10 reached);
 *  - POST /celebrate writes exactly one notification per pending
 *    milestone, and a second celebrate writes none (exactly once);
 *  - POST /dismiss snoozes the card (surface=false on the next read
 *    while no new milestone is pending);
 *  - this test DB has no credits table at all — any charge attempt
 *    would fail the request loudly. The feature moves no money.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
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

import first100Router from "../first100";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

function createTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
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
        const { types: _strippedTypes, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const result = (await (pool as unknown as {
        query: (c: unknown, v?: unknown[]) => Promise<any>;
      }).query(cfg, values)) as any;
      if (wantArray && Array.isArray(result?.rows) && result.rows.length > 0) {
        const names = Object.keys(result.rows[0]);
        return { ...result, rows: result.rows.map((row: any) => names.map((n) => row[n])) };
      }
      return result;
    },
  };
  return { mem, db: drizzle(shim as never) };
}

const DDL = `
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
  meta_pixel_id text, tiktok_pixel_id text, google_tag_id text,
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
CREATE TABLE follows (
  follower_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, profile_id)
);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  is_published boolean NOT NULL DEFAULT false
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  is_published boolean NOT NULL DEFAULT false
);
CREATE TABLE groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE group_members (
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE first100_state (
  user_id uuid PRIMARY KEY,
  celebrated_milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  dismissed_at timestamptz,
  snooze_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const CREATOR = randomUUID();
const PROFILE_ID = randomUUID();
let base = "";
let server: ReturnType<typeof express.application.listen>;

async function call(method: string, path: string, user?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: user ? { "x-test-user": user } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

beforeAll(async () => {
  const { db } = createTestDb();
  testState.db = db;
  await db.execute(
    `INSERT INTO creator_profiles (id, user_id, slug, display_name, bio, avatar_url, is_public)
     VALUES ('${PROFILE_ID}', '${CREATOR}', 'test-creator', 'Test Creator', 'I make things.', 'https://x/a.png', true)`,
  );
  // 10 real follows, in order.
  for (let i = 1; i <= 10; i++) {
    await db.execute(
      `INSERT INTO follows (follower_user_id, profile_id, created_at)
       VALUES ('${randomUUID()}', '${PROFILE_ID}', '2026-01-${String(i).padStart(2, "0")}T00:00:00Z')`,
    );
  }
  const app = express();
  app.use(express.json());
  app.use("/api", first100Router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("first100 routes", () => {
  it("requires auth on every door", async () => {
    expect((await call("GET", "/api/first100")).status).toBe(401);
    expect((await call("POST", "/api/first100/celebrate")).status).toBe(401);
    expect((await call("POST", "/api/first100/dismiss")).status).toBe(401);
  });

  it("GET reads the real count and milestone states from follows", async () => {
    const { status, body } = await call("GET", "/api/first100", CREATOR);
    expect(status).toBe(200);
    expect(body.first100.fanCount).toBe(10);
    expect(body.first100.currentMilestone).toBe(10);
    expect(body.first100.nextMilestone).toBe(25);
    expect(body.first100.fansToNext).toBe(15);
    expect(body.first100.earlyFans).toHaveLength(10);
    expect(body.first100.earlyFans[0].fanNumber).toBe(1);
    expect(body.first100.pendingCelebrations).toEqual([1, 10]);
    // GET is a read: it must not have written any notification.
    const notes = await testState.db.execute(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = '${CREATOR}'`,
    );
    expect((notes.rows ?? notes)[0].n ?? (notes.rows ?? notes)[0].count).toBe(0);
  });

  it("celebrate writes exactly one notification per pending milestone, once", async () => {
    const first = await call("POST", "/api/first100/celebrate", CREATOR);
    expect(first.status).toBe(200);
    expect(first.body.first100.pendingCelebrations).toEqual([]);
    const rows = await testState.db.execute(
      `SELECT kind, title FROM notifications WHERE user_id = '${CREATOR}' ORDER BY created_at, title`,
    );
    const list = (rows.rows ?? rows) as Array<{ kind: string; title: string }>;
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.kind === "first100_milestone")).toBe(true);

    const second = await call("POST", "/api/first100/celebrate", CREATOR);
    expect(second.status).toBe(200);
    const again = await testState.db.execute(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = '${CREATOR}'`,
    );
    expect((again.rows ?? again)[0].n ?? (again.rows ?? again)[0].count).toBe(2);
  });

  it("dismiss snoozes the card on the next read", async () => {
    const d = await call("POST", "/api/first100/dismiss", CREATOR);
    expect(d.status).toBe(200);
    expect(d.body.first100.surface).toBe(false);
    const after = await call("GET", "/api/first100", CREATOR);
    expect(after.body.first100.surface).toBe(false);
    expect(after.body.first100.snoozeUntil).toBeTruthy();
  });

  it("a creator with no profile reads as zero fans, first step open", async () => {
    const stranger = randomUUID();
    const { status, body } = await call("GET", "/api/first100", stranger);
    expect(status).toBe(200);
    expect(body.first100.fanCount).toBe(0);
    expect(body.first100.nextStep).toBe("finish_profile");
    expect(body.first100.earlyFans).toEqual([]);
  });
});
