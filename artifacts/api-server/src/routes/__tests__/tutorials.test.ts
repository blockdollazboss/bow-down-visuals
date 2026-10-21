/**
 * Tutorials V1 (0201) — HTTP over pg-mem, the move-home pattern.
 * Pins the discipline the feature lives by:
 *   - OFFICIAL IS ADMIN-ONLY: a member can designate their own video
 *     as a tutorial, but marking anything official (designate, series
 *     create, PATCH flip) without an ADMIN_EMAILS account is a 403.
 *   - designation is owner-scoped and published-videos-only, one
 *     tutorial per video.
 *   - series grouping + chapter order are server-kept (array order
 *     IS the order; the client never supplies positions to trust).
 *   - progress is server-derived and resumable: the read returns the
 *     exact chapter + furthest position a returning fan lands on.
 *   - FREE: this test DB has no credits table at all, so any charge
 *     attempt anywhere in the flow would fail the request loudly.
 *   - the official seed is the production pack's pilot, verbatim,
 *     and exactly-once: repeated catalog reads never duplicate it.
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
    req.userId = String(u);
    req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

import tutorialsRouter from "../tutorials";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/* Same shim as the move-home suite: strip drizzle's `types` config
   and `rowMode: 'array'` (pg-mem can't produce array rows), then
   rebuild array rows from the result's field order. */
function createTutorialsTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    /* impure matters: without it pg-mem simplifies the call to one
       constant, and every second insert into a table collides on
       its primary key. */
    impure: true,
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
CREATE TABLE tutorial_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  profile_id uuid REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'creator',
  is_official boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tutorials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES tutorial_series(id) ON DELETE SET NULL,
  owner_user_id uuid NOT NULL,
  profile_id uuid REFERENCES creator_profiles(id) ON DELETE CASCADE,
  video_id uuid REFERENCES profile_videos(id) ON DELETE SET NULL,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'creator',
  position integer NOT NULL DEFAULT 0,
  is_official boolean NOT NULL DEFAULT false,
  access text NOT NULL DEFAULT 'free',
  guide_route text,
  try_route text,
  transcript text,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tutorials_video_unique ON tutorials (video_id) WHERE video_id IS NOT NULL;
CREATE TABLE tutorial_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutorial_id uuid NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  start_sec integer,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tutorial_chapters_position_unique ON tutorial_chapters (tutorial_id, position);
CREATE TABLE tutorial_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutorial_id uuid NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES tutorial_chapters(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  kind text NOT NULL DEFAULT 'link',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tutorial_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tutorial_id uuid NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'started',
  completed_chapters jsonb NOT NULL DEFAULT '[]',
  last_chapter_id uuid REFERENCES tutorial_chapters(id) ON DELETE SET NULL,
  last_position_sec integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tutorial_progress_user_tutorial_unique ON tutorial_progress (user_id, tutorial_id);
`;

let server: any; let baseUrl: string;
const realFetch = globalThis.fetch;

const ADMIN_EMAIL = "boss@example.com";
const OWNER_EMAIL = "nova@example.com";
const STRANGER_EMAIL = "rando@example.com";

beforeAll(async () => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {}, warn: () => {} }; next(); });
  app.use("/api", tutorialsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  const { db } = createTutorialsTestDb();
  testState.db = db;
});

async function call(user: string | null, method: string, path: string, body?: unknown, email?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
      ...(email ? { "x-test-email": email } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, json };
}

async function count(table: string): Promise<number> {
  const r = await testState.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  return (r.rows[0] as any).n as number;
}

/* ── fixtures ─────────────────────────────────────────────────────── */

async function makeProfile(userId: string, slug: string, opts: { official?: boolean; name?: string } = {}): Promise<string> {
  const id = randomUUID();
  await testState.db.execute(sql.raw(
    `INSERT INTO creator_profiles (id, user_id, slug, display_name, is_official)
     VALUES ('${id}', '${userId}', '${slug}', '${opts.name ?? "Nova Reign"}', ${opts.official ? "true" : "false"})`,
  ));
  return id;
}

async function makeVideo(profileId: string, title: string, opts: { published?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await testState.db.execute(sql.raw(
    `INSERT INTO profile_videos (id, profile_id, title, video_url, description, duration_sec, is_published)
     VALUES ('${id}', '${profileId}', '${title}', 'https://cdn.example/${id}.mp4', 'A lesson video.', 95, ${opts.published === false ? "false" : "true"})`,
  ));
  return id;
}

const owner = randomUUID();
const stranger = randomUUID();
const admin = randomUUID();
const fan = randomUUID();

async function designateAsOwner(extra: Record<string, unknown> = {}) {
  const profileId = await makeProfile(owner, "nova-reign");
  const videoId = await makeVideo(profileId, "Mixing Vocals 101");
  const res = await call(owner, "POST", "/api/tutorials/designate", { videoId, ...extra }, OWNER_EMAIL);
  return { profileId, videoId, res };
}

/* ── designation + the official gate ──────────────────────────────── */

describe("tutorials — designation", () => {
  it("the catalog is public and free (no auth, no credits anywhere)", async () => {
    const res = await call(null, "GET", "/api/tutorials");
    expect(res.status).toBe(200);
    expect(res.json.catalog).toEqual({ series: [], standalone: [] });
  });

  it("an owner designates their own published video; it lists in the catalog", async () => {
    const { res } = await designateAsOwner();
    expect(res.status).toBe(201);
    expect(res.json.tutorial.title).toBe("Mixing Vocals 101");
    expect(res.json.tutorial.isOfficial).toBe(false);
    expect(res.json.tutorial.access).toBe("free");
    expect(res.json.tutorial.video.url).toContain(".mp4");

    const catalog = await call(null, "GET", "/api/tutorials");
    expect(catalog.json.catalog.standalone).toHaveLength(1);
    expect(catalog.json.catalog.standalone[0].hasVideo).toBe(true);
    expect(catalog.json.catalog.standalone[0].creatorSlug).toBe("nova-reign");
  });

  it("a stranger cannot designate someone else's video", async () => {
    const profileId = await makeProfile(owner, "nova-reign");
    const videoId = await makeVideo(profileId, "Mixing Vocals 101");
    const res = await call(stranger, "POST", "/api/tutorials/designate", { videoId }, STRANGER_EMAIL);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("NOT_OWNER");
    expect(await count("tutorials")).toBe(0);
  });

  it("an unpublished video cannot be designated", async () => {
    const profileId = await makeProfile(owner, "nova-reign");
    const videoId = await makeVideo(profileId, "Draft Lesson", { published: false });
    const res = await call(owner, "POST", "/api/tutorials/designate", { videoId }, OWNER_EMAIL);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("VIDEO_NOT_PUBLISHED");
  });

  it("one tutorial per video: a second designation is a 409", async () => {
    const { videoId } = await designateAsOwner();
    const again = await call(owner, "POST", "/api/tutorials/designate", { videoId }, OWNER_EMAIL);
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("ALREADY_DESIGNATED");
  });

  it("OFFICIAL IS ADMIN-ONLY: a member marking their content official is refused", async () => {
    const profileId = await makeProfile(owner, "nova-reign");
    const videoId = await makeVideo(profileId, "Mixing Vocals 101");
    const res = await call(
      owner, "POST", "/api/tutorials/designate",
      { videoId, isOfficial: true }, OWNER_EMAIL,
    );
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("OFFICIAL_REQUIRES_ADMIN");
    expect(await count("tutorials")).toBe(0);
  });

  it("an admin CAN designate an official tutorial on a creator's video", async () => {
    const profileId = await makeProfile(owner, "nova-reign");
    const videoId = await makeVideo(profileId, "Mixing Vocals 101");
    const res = await call(
      admin, "POST", "/api/tutorials/designate",
      { videoId, isOfficial: true }, ADMIN_EMAIL,
    );
    expect(res.status).toBe(201);
    expect(res.json.tutorial.isOfficial).toBe(true);
  });

  it("the official flag cannot be flipped by the owner afterwards — admin only", async () => {
    const { res } = await designateAsOwner();
    const id = res.json.tutorial.id;
    const flip = await call(owner, "PATCH", `/api/tutorials/${id}`, { isOfficial: true }, OWNER_EMAIL);
    expect(flip.status).toBe(403);
    expect(flip.json.code).toBe("OFFICIAL_REQUIRES_ADMIN");
    const adminFlip = await call(admin, "PATCH", `/api/tutorials/${id}`, { isOfficial: true }, ADMIN_EMAIL);
    expect(adminFlip.status).toBe(200);
    expect(adminFlip.json.tutorial.isOfficial).toBe(true);
  });

  it("creating an official series is admin-only too", async () => {
    const res = await call(owner, "POST", "/api/tutorials/series", { title: "House Picks", isOfficial: true }, OWNER_EMAIL);
    expect(res.status).toBe(403);
    const ok = await call(admin, "POST", "/api/tutorials/series", { title: "House Picks", isOfficial: true }, ADMIN_EMAIL);
    expect(ok.status).toBe(201);
    expect(ok.json.series.isOfficial).toBe(true);
  });
});

/* ── series + chapters + resources ────────────────────────────────── */

describe("tutorials — series, chapters, resources", () => {
  it("series grouping keeps the server's order, not the insert order", async () => {
    const seriesRes = await call(owner, "POST", "/api/tutorials/series", { title: "Vocal Chain" }, OWNER_EMAIL);
    expect(seriesRes.status).toBe(201);
    const seriesId = seriesRes.json.series.id;

    const profileId = await makeProfile(owner, "nova-reign");
    const vSecond = await makeVideo(profileId, "Second Lesson");
    const vFirst = await makeVideo(profileId, "First Lesson");
    await call(owner, "POST", "/api/tutorials/designate", { videoId: vSecond, seriesId, position: 2 }, OWNER_EMAIL);
    await call(owner, "POST", "/api/tutorials/designate", { videoId: vFirst, seriesId, position: 1 }, OWNER_EMAIL);

    const catalog = await call(null, "GET", "/api/tutorials");
    expect(catalog.json.catalog.series).toHaveLength(1);
    expect(catalog.json.catalog.series[0].title).toBe("Vocal Chain");
    expect(catalog.json.catalog.series[0].tutorials.map((t: any) => t.title)).toEqual([
      "First Lesson", "Second Lesson",
    ]);
  });

  it("chapters: array order IS the chapter order; detail returns them in order with a next pointer", async () => {
    const seriesRes = await call(owner, "POST", "/api/tutorials/series", { title: "Vocal Chain" }, OWNER_EMAIL);
    const seriesId = seriesRes.json.series.id;
    const profileId = await makeProfile(owner, "nova-reign");
    const v1 = await makeVideo(profileId, "First Lesson");
    const v2 = await makeVideo(profileId, "Second Lesson");
    const d1 = await call(owner, "POST", "/api/tutorials/designate", { videoId: v1, seriesId, position: 1 }, OWNER_EMAIL);
    await call(owner, "POST", "/api/tutorials/designate", { videoId: v2, seriesId, position: 2 }, OWNER_EMAIL);
    const t1 = d1.json.tutorial;

    const put = await call(owner, "PUT", `/api/tutorials/${t1.id}/chapters`, {
      chapters: [
        { title: "Warm up", startSec: 0, body: "Breathe first." },
        { title: "The chain", startSec: 40, body: "EQ, then compression." },
      ],
    }, OWNER_EMAIL);
    expect(put.status).toBe(200);
    expect(put.json.chapters.map((c: any) => [c.position, c.title])).toEqual([
      [1, "Warm up"], [2, "The chain"],
    ]);

    const detail = await call(null, "GET", `/api/tutorials/${t1.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.json.tutorial.chapters.map((c: any) => c.title)).toEqual(["Warm up", "The chain"]);
    expect(detail.json.tutorial.next).toEqual({ slug: expect.any(String), title: "Second Lesson" });
    expect(detail.json.tutorial.series.title).toBe("Vocal Chain");
  });

  it("a stranger cannot rewrite someone else's chapters", async () => {
    const { res } = await designateAsOwner();
    const put = await call(stranger, "PUT", `/api/tutorials/${res.json.tutorial.id}/chapters`, {
      chapters: [{ title: "Hijacked" }],
    }, STRANGER_EMAIL);
    expect(put.status).toBe(403);
  });

  it("resources pin to the tutorial's own chapters only", async () => {
    const a = await designateAsOwner();
    const aId = a.res.json.tutorial.id;
    const bProfile = await makeProfile(stranger, "other-creator");
    const bVideo = await makeVideo(bProfile, "Other Lesson");
    const bDes = await call(stranger, "POST", "/api/tutorials/designate", { videoId: bVideo }, STRANGER_EMAIL);
    const bId = bDes.json.tutorial.id;
    const bChapters = await call(stranger, "PUT", `/api/tutorials/${bId}/chapters`, {
      chapters: [{ title: "Foreign chapter" }],
    }, STRANGER_EMAIL);
    const foreignChapterId = bChapters.json.chapters[0].id;

    const bad = await call(owner, "PUT", `/api/tutorials/${aId}/resources`, {
      resources: [{ title: "Cheat sheet", url: "https://example.com/sheet.pdf", chapterId: foreignChapterId }],
    }, OWNER_EMAIL);
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("BAD_CHAPTER");

    const chapters = await call(owner, "PUT", `/api/tutorials/${aId}/chapters`, {
      chapters: [{ title: "Intro", body: "Start here." }],
    }, OWNER_EMAIL);
    const ownChapterId = chapters.json.chapters[0].id;
    const good = await call(owner, "PUT", `/api/tutorials/${aId}/resources`, {
      resources: [{ title: "Cheat sheet", url: "https://example.com/sheet.pdf", kind: "download", chapterId: ownChapterId }],
    }, OWNER_EMAIL);
    expect(good.status).toBe(200);
    expect(good.json.resources[0].chapterId).toBe(ownChapterId);

    const detail = await call(null, "GET", `/api/tutorials/${a.res.json.tutorial.slug}`);
    expect(detail.json.tutorial.resources).toHaveLength(1);
  });

  it("the profile shelf scopes the catalog to one creator", async () => {
    await designateAsOwner();
    const otherProfile = await makeProfile(stranger, "other-creator");
    const otherVideo = await makeVideo(otherProfile, "Other Lesson");
    await call(stranger, "POST", "/api/tutorials/designate", { videoId: otherVideo }, STRANGER_EMAIL);

    const shelf = await call(null, "GET", "/api/tutorials?profile=nova-reign");
    const titles = [
      ...shelf.json.catalog.standalone,
      ...shelf.json.catalog.series.flatMap((s: any) => s.tutorials),
    ].map((t: any) => t.title);
    expect(titles).toEqual(["Mixing Vocals 101"]);
  });

  it("unpublishing hides the tutorial from the catalog and the detail read", async () => {
    const { res } = await designateAsOwner();
    const t = res.json.tutorial;
    const unpub = await call(owner, "PATCH", `/api/tutorials/${t.id}`, { isPublished: false }, OWNER_EMAIL);
    expect(unpub.status).toBe(200);
    expect((await call(null, "GET", `/api/tutorials/${t.slug}`)).status).toBe(404);
    const catalog = await call(null, "GET", "/api/tutorials");
    expect(catalog.json.catalog.standalone).toHaveLength(0);
  });
});

/* ── fan progress ─────────────────────────────────────────────────── */

describe("tutorials — fan progress + resume", () => {
  async function tutorialWithChapters() {
    const { res } = await designateAsOwner();
    const t = res.json.tutorial;
    const chapters = await call(owner, "PUT", `/api/tutorials/${t.id}/chapters`, {
      chapters: [
        { title: "One", startSec: 0, body: "First." },
        { title: "Two", startSec: 30, body: "Second." },
      ],
    }, OWNER_EMAIL);
    return { t, chapters: chapters.json.chapters };
  }

  it("a bare open is 'started'; progress requires auth", async () => {
    const { t } = await tutorialWithChapters();
    expect((await call(null, "POST", `/api/tutorials/${t.id}/progress`, {})).status).toBe(401);
    const started = await call(fan, "POST", `/api/tutorials/${t.id}/progress`, {}, STRANGER_EMAIL);
    expect(started.status).toBe(200);
    expect(started.json.progress.status).toBe("started");
    expect(started.json.progress.completedChapterIds).toEqual([]);
  });

  it("completing chapters moves to in_progress, then completed when all are done", async () => {
    const { t, chapters } = await tutorialWithChapters();
    const [c1, c2] = chapters;
    const mid = await call(fan, "POST", `/api/tutorials/${t.id}/progress`, { completeChapterId: c1.id }, STRANGER_EMAIL);
    expect(mid.json.progress.status).toBe("in_progress");
    expect(mid.json.progress.completedChapterIds).toEqual([c1.id]);

    const done = await call(fan, "POST", `/api/tutorials/${t.id}/progress`, { completeChapterId: c2.id }, STRANGER_EMAIL);
    expect(done.json.progress.status).toBe("completed");
    expect(done.json.progress.completedAt).toBeTruthy();

    /* Un-marking a chapter honestly reopens the tutorial. */
    const reopened = await call(fan, "POST", `/api/tutorials/${t.id}/progress`, { uncompleteChapterId: c2.id }, STRANGER_EMAIL);
    expect(reopened.json.progress.status).toBe("in_progress");
    expect(reopened.json.progress.completedAt).toBeNull();
  });

  it("RESUME: a returning fan's progress read lands on their last chapter + furthest position", async () => {
    const { t, chapters } = await tutorialWithChapters();
    const [c1, c2] = chapters;
    await call(fan, "POST", `/api/tutorials/${t.id}/progress`, { completeChapterId: c1.id, chapterId: c2.id, positionSec: 47 }, STRANGER_EMAIL);
    /* A later, smaller position beat must not rewind the resume point. */
    await call(fan, "POST", `/api/tutorials/${t.id}/progress`, { positionSec: 12 }, STRANGER_EMAIL);

    const mine = await call(fan, "GET", "/api/tutorials/mine/progress", undefined, STRANGER_EMAIL);
    expect(mine.status).toBe(200);
    const mineRow = mine.json.progress.find((p: any) => p.tutorialId === t.id);
    expect(mineRow.status).toBe("in_progress");
    expect(mineRow.lastChapterId).toBe(c2.id);
    expect(mineRow.lastPositionSec).toBe(47);
    expect(mineRow.completedChapterIds).toEqual([c1.id]);
  });

  it("a chapter from another tutorial is refused", async () => {
    const { t } = await tutorialWithChapters();
    const otherUser = randomUUID();
    const otherProfile = await makeProfile(otherUser, "other-creator");
    const otherVideo = await makeVideo(otherProfile, "Other Lesson");
    const other = await call(otherUser, "POST", "/api/tutorials/designate", { videoId: otherVideo }, STRANGER_EMAIL);
    const otherChapters = await call(otherUser, "PUT", `/api/tutorials/${other.json.tutorial.id}/chapters`, {
      chapters: [{ title: "Foreign" }],
    }, STRANGER_EMAIL);
    const foreignId = otherChapters.json.chapters[0].id;
    const res = await call(fan, "POST", `/api/tutorials/${t.id}/progress`, { completeChapterId: foreignId }, STRANGER_EMAIL);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("BAD_CHAPTER");
  });

  it("progress is per-fan: one fan's completion never leaks to another", async () => {
    const { t, chapters } = await tutorialWithChapters();
    for (const c of chapters) {
      await call(fan, "POST", `/api/tutorials/${t.id}/progress`, { completeChapterId: c.id }, STRANGER_EMAIL);
    }
    const otherFan = randomUUID();
    const mine = await call(otherFan, "GET", "/api/tutorials/mine/progress", undefined, STRANGER_EMAIL);
    expect(mine.json.progress).toEqual([]);
  });
});

/* ── the official seed ────────────────────────────────────────────── */

describe("tutorials — official seed (the production pack's pilot)", () => {
  it("seeds the five flow-path series + the pilot with its scripted chapters, exactly once", async () => {
    const houseUser = randomUUID();
    await makeProfile(houseUser, "thy-cheat-code", { official: true, name: "Thy Cheat Code" });

    const first = await call(null, "GET", "/api/tutorials");
    expect(first.status).toBe(200);
    const createSeries = first.json.catalog.series.find((s: any) => s.slug === "create");
    expect(createSeries).toBeTruthy();
    expect(createSeries.isOfficial).toBe(true);
    const pilot = createSeries.tutorials.find((t: any) => t.slug === "make-your-first-song");
    expect(pilot).toBeTruthy();
    expect(pilot.isOfficial).toBe(true);
    /* No finished media yet: the card must say so, not fake a video. */
    expect(pilot.hasVideo).toBe(false);
    expect(pilot.chapterCount).toBe(6);

    const detail = await call(null, "GET", "/api/tutorials/make-your-first-song");
    expect(detail.json.tutorial.video).toBeNull();
    expect(detail.json.tutorial.guideRoute).toBe("/make-song");
    expect(detail.json.tutorial.tryRoute).toBe("/make-song");
    expect(detail.json.tutorial.chapters.map((c: any) => c.title)).toEqual([
      "Your first song starts now",
      "Step 1: Describe the vibe",
      "Step 2: Get the lyrics right",
      "Step 3: Produce the track",
      "Hear what you made",
      "Your move",
    ]);
    expect(detail.json.tutorial.chapters.map((c: any) => c.startSec)).toEqual([0, 8, 30, 52, 72, 84]);
    expect(detail.json.tutorial.transcript).toContain("Midnight Run");
    expect(detail.json.tutorial.creator.slug).toBe("thy-cheat-code");

    /* Second read: still exactly one pilot, five series, six chapters. */
    await call(null, "GET", "/api/tutorials");
    expect(await count("tutorial_series")).toBe(5);
    expect(await count("tutorials")).toBe(1);
    expect(await count("tutorial_chapters")).toBe(6);
  });

  it("plain-language search finds the pilot by a chapter title", async () => {
    const houseUser = randomUUID();
    await makeProfile(houseUser, "thy-cheat-code", { official: true, name: "Thy Cheat Code" });
    const res = await call(null, "GET", "/api/tutorials?q=lyrics");
    const found = res.json.catalog.series.flatMap((s: any) => s.tutorials);
    expect(found.map((t: any) => t.slug)).toContain("make-your-first-song");
  });

  it("without an official profile the seed stays silent — nothing is fabricated", async () => {
    const res = await call(null, "GET", "/api/tutorials");
    expect(res.status).toBe(200);
    expect(await count("tutorial_series")).toBe(0);
    expect(await count("tutorials")).toBe(0);
  });
});
