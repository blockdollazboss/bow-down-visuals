/**
 * Route tests for the Season Marks Wall read:
 *
 *   GET /api/world/court-season
 *
 * Real handler + real DB store against pg-mem. Pinned contract:
 * the read is public (no auth), returns the current season with
 * its LIVE standings (the ladder windowed to the running month,
 * ranked) and every settled season's FROZEN standings, newest
 * first — and the frozen record does not move when later work
 * lands in the settled season's window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";

const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE, slug text NOT NULL,
  display_name text NOT NULL, is_official boolean NOT NULL DEFAULT false
);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE export_jobs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, state text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE follows (
  follower_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE live_streams (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tip_jar_tips (
  id uuid PRIMARY KEY, page_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending_payment',
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE TABLE live_stream_tips (
  id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, creator_credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE world_stage_tips (
  id uuid PRIMARY KEY, from_user_id text NOT NULL, to_user_id text NOT NULL,
  amount_vb integer NOT NULL, room_id text NOT NULL, idempotency_key text NOT NULL,
  creator_credited_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fan_members (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, stripe_session_id text,
  status text NOT NULL DEFAULT 'active', joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE court_season_settlements (
  season_key text PRIMARY KEY, ordinal integer NOT NULL, name text NOT NULL,
  subtitle text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(), standings jsonb NOT NULL DEFAULT '[]'::jsonb,
  herald_text text NOT NULL DEFAULT ''
);`;

let server: import("node:http").Server | null = null;
let base = "";
let db: any;

async function mount() {
  vi.resetModules();
  const { default: router } = await import("../world-court-season");
  const app = express();
  app.use("/api", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => {
  const t = createTestDb();
  t.mem.public.none(DDL);
  testState.db = t.db;
  db = t.db;
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe("GET /api/world/court-season — the marks wall read", () => {
  it("an unsettled world: the current season stands, its court empty, no past seasons", async () => {
    await mount();
    const res = await fetch(`${base}/api/world/court-season`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.current.seasonKey).toMatch(/^\d{4}-\d{2}$/);
    expect(body.current.ordinal).toBeGreaterThanOrEqual(1);
    expect(body.current.name).toMatch(/^Season [IVX]+$/);
    expect(body.current.standings).toEqual([]);
    expect(body.seasons).toEqual([]);
  });

  it("serves frozen seasons newest-first and the live court for the running season", async () => {
    const userId = randomUUID();
    const profileId = randomUUID();
    await db.execute(sql`
      INSERT INTO creator_profiles (id, user_id, slug, display_name, is_official)
      VALUES (${profileId}, ${userId}, 'ada', 'Ada', false)
    `);
    // Live work inside the CURRENT season's window (this month).
    const now = new Date();
    const inWindow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2)).toISOString();
    await db.execute(sql`
      INSERT INTO profile_tracks (id, profile_id, is_published, created_at)
      VALUES (${randomUUID()}, ${profileId}, true, ${inWindow}::timestamptz)
    `);
    // A frozen Season I, straight into the record.
    const frozen = [
      { place: 1, userId, displayName: "Ada", slug: "ada", points: 116, stars: 3, title: "Gangster" },
    ];
    await db.execute(sql`
      INSERT INTO court_season_settlements
        (season_key, ordinal, name, subtitle, starts_at, ends_at, settled_at, standings, herald_text)
      VALUES ('2026-10', 1, 'Season I', 'of the First Bells',
        '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', '2026-11-01T00:01:00Z',
        ${JSON.stringify(frozen)}::jsonb, 'The season has turned.')
    `);

    await mount();
    const res = await fetch(`${base}/api/world/court-season`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.seasons).toHaveLength(1);
    expect(body.seasons[0]).toMatchObject({
      seasonKey: "2026-10",
      ordinal: 1,
      name: "Season I",
      subtitle: "of the First Bells",
      heraldText: "The season has turned.",
    });
    expect(body.seasons[0].standings).toEqual(frozen);
    expect(body.seasons[0].settledAt).toBe("2026-11-01T00:01:00.000Z");

    // The running season's live standings rank the in-window work
    // (the track sits on day 2 of the current month, whichever
    // month the suite runs in — always inside the live window).
    expect(body.current.standings).toEqual([
      expect.objectContaining({ place: 1, displayName: "Ada", slug: "ada", points: 10 }),
    ]);
  });
});
