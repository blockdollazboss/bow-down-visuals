/**
 * Duet Rails delta (Stack-200 UPGRADE #173, absorbing N3 Duet the
 * King) — HTTP over pg-mem, the move-home pattern.
 *
 * Duets/Stitches themselves already ship; this suite pins ONLY the
 * delta:
 *   (a) the per-video DUET-DISABLE switch held by the original
 *       creator — enforced at POST (both doors: /videos/:id/duet
 *       and /shorts with duet_with) and flipped only by the owner
 *       via PATCH /videos/:id/duet-settings. Stitches are a
 *       separate kind and are NOT governed by the switch.
 *   (b) Duet the King as a thin application of the same rails:
 *       GET /shorts/king-duet surfaces the official (Thy Cheat
 *       Code) clips whose switch is ON plus the King's featured
 *       pick; POST /videos/:id/king-feature is house-only and can
 *       only stamp a published duet OF an official clip — the
 *       featured creator is always the fan, credited in the rail
 *       payload, and pick_kind is spelled out as "house_pick".
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
    req.userId = String(u);
    next();
  },
}));

/* shorts.ts imports the challenge engine's shared helpers. The
   engine's route tree is not what this suite guards — stub it with
   the REAL requireOwnProfile semantics (profile id + user id match)
   driven over the same pg-mem db, mirroring shorts-feed-sql.test.ts. */
vi.mock("../challenge-engine", async () => {
  const { Router } = await import("express");
  const { eq, and } = await import("drizzle-orm");
  const actual = await vi.importActual<any>("@workspace/db");
  return {
    effectiveStatus: (c: any) => c?.status ?? "live",
    optionalViewerId: async () => null,
    slugify: (s: string, max = 48) =>
      s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, max) || "untitled",
    requireOwnProfile: async (userId: string, profileId: string) => {
      const db = testState.db;
      if (!db) return null;
      const [p] = await db
        .select()
        .from(actual.creatorProfilesTable)
        .where(and(eq(actual.creatorProfilesTable.id, profileId), eq(actual.creatorProfilesTable.userId, userId)))
        .limit(1);
      return p ?? null;
    },
    toChallengeDto: (r: any) => r,
    default: Router(),
  };
});

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (u: unknown) => u,
}));

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
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")) ? signedFor(v) : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

import router from "../shorts";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { creatorProfilesTable, profileVideosTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/* Same construction as move-home.test.ts: strip drizzle's `types`
   config AND `rowMode: 'array'` (pg-mem can't produce array rows),
   rebuilding array rows from the result's field order for builder
   selects. */
function createDuetTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    /* impure: pg-mem otherwise SIMPLIFIES the call to a constant per
       query plan, and the second default-uuid INSERT on a table
       collides on its primary key (observed: the king_featured
       notification dying silently inside notify()'s catch). */
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
  declared_city text,
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
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  title text NOT NULL,
  video_url text NOT NULL,
  thumbnail_url text,
  thumbnail_alt_text text,
  description text NOT NULL DEFAULT '',
  genre text,
  tags text[] NOT NULL DEFAULT '{}',
  duration_sec integer NOT NULL DEFAULT 0,
  season integer, episode integer,
  sound_track_id uuid,
  download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false,
  pwyw_min_cents integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0,
  comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  is_short boolean NOT NULL DEFAULT false,
  duet_with uuid, stitch_with uuid,
  duets_enabled boolean NOT NULL DEFAULT true,
  king_featured_at timestamptz,
  sound_id text, sound_title text, sound_url text,
  sound_use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
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

/* ── Cast ─────────────────────────────────────────────────────────────── */
const KING_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KING_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CREATOR_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATOR_PROFILE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FAN_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FAN_PROFILE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const STRANGER_USER = "99999999-9999-4999-8999-999999999999";

const KING_CLIP = "11111111-1111-4111-8111-111111111111";
const OPEN_CLIP = "22222222-2222-4222-8222-222222222222";
const OFF_CLIP = "33333333-3333-4333-8333-333333333333";
const PLAIN_VIDEO = "44444444-4444-4444-8444-444444444444";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

async function seed() {
  const db = testState.db;
  /* Single-row inserts with uniform field sets: pg-mem misapplies
     `default` placeholders across rows of a multi-row INSERT whose
     rows provide different columns. */
  for (const p of [
    { id: KING_PROFILE, userId: KING_USER, slug: "thy-cheat-code", displayName: "Thy Cheat Code", isOfficial: true },
    { id: CREATOR_PROFILE, userId: CREATOR_USER, slug: "maker-mia", displayName: "Maker Mia", isOfficial: false },
    { id: FAN_PROFILE, userId: FAN_USER, slug: "fan-fred", displayName: "Fan Fred", isOfficial: false },
  ]) {
    await db.insert(creatorProfilesTable).values(p);
  }
  for (const v of [
    { id: KING_CLIP, profileId: KING_PROFILE, title: "King's open clip", videoUrl: "https://cdn.example.com/king.mp4", isPublished: true, isShort: true, duetsEnabled: true },
    { id: OPEN_CLIP, profileId: CREATOR_PROFILE, title: "Open for duets", videoUrl: "https://cdn.example.com/open.mp4", isPublished: true, isShort: true, duetsEnabled: true },
    { id: OFF_CLIP, profileId: CREATOR_PROFILE, title: "Duets off here", videoUrl: "https://cdn.example.com/off.mp4", isPublished: true, isShort: true, duetsEnabled: false },
    { id: PLAIN_VIDEO, profileId: CREATOR_PROFILE, title: "Just a video", videoUrl: "https://cdn.example.com/plain.mp4", isPublished: true, isShort: true, duetsEnabled: true },
  ]) {
    await db.insert(profileVideosTable).values(v);
  }
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db } = createDuetTestDb();
  testState.db = db;
  await seed();
});

async function call(method: string, path: string, user?: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* status assertions surface it */ }
  return { status: r.status, json, text };
}

const duetBody = (profileId: string, title = "My answer") => ({
  profile_id: profileId,
  title,
  video_url: "https://cdn.example.com/answer.mp4",
});

describe("(a) the per-video duet-disable switch", () => {
  it("POST /videos/:id/duet refuses a switched-off video with 403 and creates nothing", async () => {
    const res = await call("POST", `/videos/${OFF_CLIP}/duet`, FAN_USER, duetBody(FAN_PROFILE));
    expect(res.status).toBe(403);
    expect(res.json.error).toMatch(/turned them off/i);
    const kids = await call("GET", `/videos/${OFF_CLIP}/duets`);
    expect(kids.status).toBe(200);
    expect(kids.json.items).toHaveLength(0);
  });

  it("POST /shorts with duet_with is the same door — refused too", async () => {
    const res = await call("POST", "/shorts", FAN_USER, {
      ...duetBody(FAN_PROFILE), duet_with: OFF_CLIP,
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatch(/turned them off/i);
  });

  it("an open video duets fine and the child credits the parent chain", async () => {
    const res = await call("POST", `/videos/${OPEN_CLIP}/duet`, FAN_USER, duetBody(FAN_PROFILE));
    expect(res.status).toBe(201);
    expect(res.json.kind).toBe("duet");
    const kids = await call("GET", `/videos/${OPEN_CLIP}/duets`);
    expect(kids.json.items).toHaveLength(1);
    expect(kids.json.items[0].title).toBe("My answer");
    expect(kids.json.items[0].king_featured_at).toBeNull();
    /* NB: the children handler's creator lookup rides the
       pre-existing ANY(ARRAY[..]::uuid[]) form — pg-mem returns it
       empty (real Postgres serves it; the rendered form is pinned
       by shorts-feed-sql.test.ts), so creator credit for a duet is
       asserted on the King rail below, whose JOIN form pg-mem
       executes faithfully. */
  });

  it("the switch governs duets only — a stitch of a duets-off video still lands", async () => {
    const res = await call("POST", `/videos/${OFF_CLIP}/stitch`, FAN_USER, duetBody(FAN_PROFILE, "My stitch"));
    expect(res.status).toBe(201);
    expect(res.json.kind).toBe("stitch");
  });

  it("PATCH duet-settings: only the owning creator holds the switch", async () => {
    const stranger = await call("PATCH", `/videos/${OPEN_CLIP}/duet-settings`, STRANGER_USER, { duets_enabled: false });
    expect(stranger.status).toBe(403);
    const fan = await call("PATCH", `/videos/${OPEN_CLIP}/duet-settings`, FAN_USER, { duets_enabled: false });
    expect(fan.status).toBe(403);
    const missing = await call("PATCH", `/videos/${randomUUID()}/duet-settings`, CREATOR_USER, { duets_enabled: false });
    expect(missing.status).toBe(404);
  }, 30_000);

  it("flipping the switch off closes the POST door; flipping it back reopens it", async () => {
    const off = await call("PATCH", `/videos/${OPEN_CLIP}/duet-settings`, CREATOR_USER, { duets_enabled: false });
    expect(off.status).toBe(200);
    expect(off.json).toMatchObject({ id: OPEN_CLIP, duets_enabled: false });
    const refused = await call("POST", `/videos/${OPEN_CLIP}/duet`, FAN_USER, duetBody(FAN_PROFILE));
    expect(refused.status).toBe(403);
    const on = await call("PATCH", `/videos/${OPEN_CLIP}/duet-settings`, CREATOR_USER, { duets_enabled: true });
    expect(on.json.duets_enabled).toBe(true);
    const ok = await call("POST", `/videos/${OPEN_CLIP}/duet`, FAN_USER, duetBody(FAN_PROFILE));
    expect(ok.status).toBe(201);
  });

  it("a short can be published with duets already off", async () => {
    const res = await call("POST", "/shorts", CREATOR_USER, {
      profile_id: CREATOR_PROFILE, title: "Born closed", video_url: "https://cdn.example.com/closed.mp4",
      duets_enabled: false,
    });
    expect(res.status).toBe(201);
    expect(res.json.short.duetsEnabled).toBe(false);
    const refused = await call("POST", `/videos/${res.json.short.id}/duet`, FAN_USER, duetBody(FAN_PROFILE));
    expect(refused.status).toBe(403);
  });
});

describe("(b) Duet the King — the same rails, house pick, fan credited", () => {
  async function fanDuetOfKing(): Promise<string> {
    const res = await call("POST", `/videos/${KING_CLIP}/duet`, FAN_USER, duetBody(FAN_PROFILE, "Fred answers the King"));
    expect(res.status).toBe(201);
    return res.json.short.id as string;
  }

  it("GET /shorts/king-duet opens only the King's switched-on clips", async () => {
    const res = await call("GET", "/shorts/king-duet");
    expect(res.status).toBe(200);
    expect(res.json.event.pick_kind).toBe("house_pick");
    expect(res.json.king?.slug).toBe("thy-cheat-code");
    expect(res.json.open_clips.map((c: any) => c.id)).toEqual([KING_CLIP]);
    expect(res.json.open_clips[0].duets_enabled).toBe(true);
    expect(res.json.featured).toEqual([]);
  });

  it("king-feature is house-only: a fan cannot feature their own duet", async () => {
    const duetId = await fanDuetOfKing();
    const res = await call("POST", `/videos/${duetId}/king-feature`, FAN_USER);
    expect(res.status).toBe(403);
  });

  it("the King cannot feature a non-duet, nor a duet of a non-King clip", async () => {
    const notDuet = await call("POST", `/videos/${PLAIN_VIDEO}/king-feature`, KING_USER);
    expect(notDuet.status).toBe(400);
    const otherDuet = await call("POST", `/videos/${OPEN_CLIP}/duet`, FAN_USER, duetBody(FAN_PROFILE));
    expect(otherDuet.status).toBe(201);
    const wrongParent = await call("POST", `/videos/${otherDuet.json.short.id}/king-feature`, KING_USER);
    expect(wrongParent.status).toBe(400);
  });

  it("featuring stamps the pick, credits the fan on the rail, and notifies them", async () => {
    const duetId = await fanDuetOfKing();
    const res = await call("POST", `/videos/${duetId}/king-feature`, KING_USER);
    expect(res.status).toBe(200);
    expect(res.json.pick_kind).toBe("house_pick");
    expect(res.json.king_featured_at).toBeTruthy();

    const rail = await call("GET", "/shorts/king-duet");
    expect(rail.json.featured).toHaveLength(1);
    const pick = rail.json.featured[0];
    expect(pick.id).toBe(duetId);
    expect(pick.pick_kind).toBe("house_pick");
    expect(pick.creator.slug).toBe("fan-fred");
    expect(pick.duet_parent.id).toBe(KING_CLIP);
    expect(pick.duet_parent.creator_slug).toBe("thy-cheat-code");

    const kids = await call("GET", `/videos/${KING_CLIP}/duets`);
    expect(kids.json.items[0].king_featured_at).toBeTruthy();

    const notes = await testState.db.select().from(notificationsTable)
      .where(eq(notificationsTable.userId, FAN_USER));
    expect(notes.some((n: any) => n.kind === "king_featured")).toBe(true);

    const un = await call("DELETE", `/videos/${duetId}/king-feature`, KING_USER);
    expect(un.status).toBe(200);
    const rail2 = await call("GET", "/shorts/king-duet");
    expect(rail2.json.featured).toEqual([]);
  });

  it("when the King flips his clip's switch off, it leaves the open rail and refuses duets", async () => {
    const off = await call("PATCH", `/videos/${KING_CLIP}/duet-settings`, KING_USER, { duets_enabled: false });
    expect(off.status).toBe(200);
    const rail = await call("GET", "/shorts/king-duet");
    expect(rail.json.open_clips).toEqual([]);
    const refused = await call("POST", `/videos/${KING_CLIP}/duet`, FAN_USER, duetBody(FAN_PROFILE));
    expect(refused.status).toBe(403);
  });
});
