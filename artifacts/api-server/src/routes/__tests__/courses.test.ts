/**
 * Creator Courses — HTTP over pg-mem (the tutorials pattern).
 *
 * A course is a store_products row (kind='course') sold on the
 * storefront rail; these tests pin the course law end to end:
 *   - the price is the CREATOR's: create requires an explicit
 *     priceCents (no default is ever supplied), $0 is allowed (free
 *     course), negatives are refused;
 *   - curriculum order is server-kept (array order IS the order),
 *     text lessons need a body, lesson videos must be the creator's
 *     own published videos;
 *   - the public outline carries titles/structure ONLY — a locked
 *     lesson's body, video URL, and attachment URL never appear
 *     anywhere in the payload (asserted on the raw JSON);
 *   - ENTITLEMENT = a completed store_orders row (Paid Series
 *     pattern): non-buyers are locked, buyers unlock, a REFUNDED
 *     order locks again, the owner always has access;
 *   - preview lessons are the free sample — open to anyone;
 *   - DRIP: a lesson with drip_day_offset 7 stays content-locked
 *     until 7 days after the buyer's order, then opens;
 *   - progress is server-derived with a forward-only resume point,
 *     and progress writes obey the same gates as the learn read.
 *
 * Buying is simulated by inserting the store_orders row the
 * storefront verify/claim flows write — that row IS the entitlement.
 * The storefront-side course guards live in
 * storefront-course.test.ts.
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
vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const u = req.headers["x-test-user"];
    if (typeof u === "string" && u) req.userId = u;
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

import coursesRouter from "../courses";
import {
  lessonLock,
  dripUnlockAt,
  courseProgressPct,
  validateCoursePriceCents,
  isCourseNotLiveError,
  CourseError,
} from "../../lib/courses";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/* Same shim as the tutorials suite: strip drizzle's `types` config
   and `rowMode: 'array'` (pg-mem can't produce array rows), then
   rebuild array rows from the result's field order. */
function createCoursesTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
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
        return { ...result, rows: result.rows.map((row: any) => names.map((n: string) => row[n])) };
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
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL,
  compare_at_cents integer,
  inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]',
  service_details jsonb,
  event_id uuid,
  related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('download','merch','digital','service','ticket','course')),
  CHECK (price_cents >= 0)
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  product_id uuid REFERENCES store_products(id) ON DELETE SET NULL,
  product_title text NOT NULL DEFAULT '',
  product_kind text NOT NULL DEFAULT 'digital',
  quantity integer NOT NULL DEFAULT 1,
  amount_cents integer NOT NULL,
  discount_code text,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text,
  status text NOT NULL DEFAULT 'completed',
  fulfillment_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_orders_session_ux ON store_orders (stripe_session_id);
CREATE TABLE course_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX course_sections_position_unique ON course_sections (product_id, position);
CREATE TABLE course_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES course_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'video',
  video_id uuid REFERENCES profile_videos(id) ON DELETE SET NULL,
  body text NOT NULL DEFAULT '',
  attachment_title text,
  attachment_url text,
  drip_day_offset integer NOT NULL DEFAULT 0,
  is_preview boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('video','text')),
  CHECK (drip_day_offset >= 0)
);
CREATE UNIQUE INDEX course_lessons_position_unique ON course_lessons (section_id, position);
CREATE TABLE course_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'started',
  last_position_sec integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('started','in_progress','completed'))
);
CREATE UNIQUE INDEX course_lesson_progress_user_lesson_unique ON course_lesson_progress (user_id, lesson_id);
`;

let server: any; let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {}, warn: () => {} }; next(); });
  app.use("/api", coursesRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  const { db } = createCoursesTestDb();
  testState.db = db;
});

async function call(user: string | null, method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, json, raw: JSON.stringify(json) };
}

/* ── fixtures ─────────────────────────────────────────────────────── */

const owner = randomUUID();
const buyer = randomUUID();
const stranger = randomUUID();

const SECRET_BODY = "SECRET-LESSON-BODY-mix-like-a-pro";
const SECRET_VIDEO = "https://cdn.example/secret-lesson.mp4";
const SECRET_ATTACHMENT = "https://cdn.example/secret-cheatsheet.pdf";
const PREVIEW_BODY = "PREVIEW-BODY-watch-this-first";

async function makeProfile(userId: string, slug: string): Promise<string> {
  const id = randomUUID();
  await testState.db.execute(sql.raw(
    `INSERT INTO creator_profiles (id, user_id, slug, display_name)
     VALUES ('${id}', '${userId}', '${slug}', 'Nova Reign')`,
  ));
  return id;
}

async function makeVideo(profileId: string, title: string, url: string, opts: { published?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await testState.db.execute(sql.raw(
    `INSERT INTO profile_videos (id, profile_id, title, video_url, description, duration_sec, is_published)
     VALUES ('${id}', '${profileId}', '${title}', '${url}', 'A lesson video.', 120, ${opts.published === false ? "false" : "true"})`,
  ));
  return id;
}

/** A published course with two sections / three lessons:
    S1: preview text lesson, locked video lesson (secret content)
    S2: drip-7 text lesson (secret body)                          */
async function makeCourse() {
  const profileId = await makeProfile(owner, "nova-reign");
  const videoId = await makeVideo(profileId, "Mixing Vocals", SECRET_VIDEO);
  const created = await call(owner, "POST", "/api/courses", {
    title: "Mix Like a Pro", description: "The full vocal chain.", priceCents: 4900,
  });
  expect(created.status).toBe(201);
  const productId = created.json.product.id as string;
  const curr = await call(owner, "PUT", `/api/courses/${productId}/curriculum`, {
    sections: [
      {
        title: "Foundations",
        lessons: [
          { title: "Welcome (free preview)", kind: "text", body: PREVIEW_BODY, isPreview: true },
          {
            title: "The Vocal Chain", kind: "video", videoId, body: SECRET_BODY,
            attachmentTitle: "Chain cheat sheet", attachmentUrl: SECRET_ATTACHMENT,
          },
        ],
      },
      {
        title: "Week Two",
        lessons: [
          { title: "Advanced Doubles", kind: "text", body: SECRET_BODY, dripDayOffset: 7 },
        ],
      },
    ],
  });
  expect(curr.status).toBe(200);
  const published = await call(owner, "PATCH", `/api/courses/${productId}`, { isActive: true });
  expect(published.status).toBe(200);
  const lessonIds = {
    preview: curr.json.curriculum.sections[0].lessons[0].id as string,
    locked: curr.json.curriculum.sections[0].lessons[1].id as string,
    drip: curr.json.curriculum.sections[1].lessons[0].id as string,
  };
  return { profileId, productId, videoId, lessonIds };
}

async function insertOrder(userId: string, profileId: string, productId: string, opts: { status?: string; daysAgo?: number } = {}) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000).toISOString();
  await testState.db.execute(sql`
    INSERT INTO store_orders
      (id, buyer_user_id, profile_id, product_id, product_title, product_kind,
       quantity, amount_cents, platform_fee_cents, creator_amount_cents,
       stripe_session_id, status, created_at)
    VALUES (${id}, ${userId}, ${profileId}, ${productId}, 'Mix Like a Pro', 'course',
            1, 4900, 245, 4655, ${`cs_test_${id}`}, ${opts.status ?? "completed"}, ${createdAt})
  `);
  return id;
}

/* ── pure helpers ─────────────────────────────────────────────────── */

describe("courses — pure helpers", () => {
  it("lessonLock: preview always open; owner always open; non-buyer purchase-locked", () => {
    const now = new Date();
    expect(lessonLock({ access: "locked", isPreview: true, dripDayOffset: 0, purchasedAt: null, now }).locked).toBe(false);
    expect(lessonLock({ access: "owner", isPreview: false, dripDayOffset: 30, purchasedAt: null, now }).locked).toBe(false);
    expect(lessonLock({ access: "locked", isPreview: false, dripDayOffset: 0, purchasedAt: null, now }))
      .toEqual({ locked: true, reason: "purchase", unlockAt: null });
  });

  it("lessonLock: drip opens exactly at purchase + offset days", () => {
    const bought = new Date("2026-10-01T12:00:00.000Z");
    const before = lessonLock({ access: "purchased", isPreview: false, dripDayOffset: 7, purchasedAt: bought, now: new Date("2026-10-08T11:59:59.000Z") });
    expect(before.locked).toBe(true);
    expect(before.reason).toBe("drip");
    expect(before.unlockAt).toBe("2026-10-08T12:00:00.000Z");
    const at = lessonLock({ access: "purchased", isPreview: false, dripDayOffset: 7, purchasedAt: bought, now: new Date("2026-10-08T12:00:00.000Z") });
    expect(at.locked).toBe(false);
    expect(dripUnlockAt(bought, 7).toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });

  it("progress pct + price validation (creator-set, never defaulted)", () => {
    expect(courseProgressPct(0, 0)).toBe(0);
    expect(courseProgressPct(3, 1)).toBe(33);
    expect(courseProgressPct(3, 3)).toBe(100);
    expect(validateCoursePriceCents(0)).toBe(0);
    expect(validateCoursePriceCents(4900)).toBe(4900);
    expect(() => validateCoursePriceCents(-1)).toThrow(CourseError);
    expect(() => validateCoursePriceCents(49.5)).toThrow(CourseError);
    expect(() => validateCoursePriceCents(undefined)).toThrow(CourseError);
  });

  it("isCourseNotLiveError recognizes the pending-migration failures", () => {
    expect(isCourseNotLiveError(new Error('relation "course_lessons" does not exist'))).toBe(true);
    expect(isCourseNotLiveError(Object.assign(new Error("check"), { code: "23514" }))).toBe(true);
    expect(isCourseNotLiveError(new Error("some other failure"))).toBe(false);
  });
});

/* ── creation + ownership ─────────────────────────────────────────── */

describe("courses — creation", () => {
  it("creating a course requires a creator profile", async () => {
    const res = await call(stranger, "POST", "/api/courses", { title: "X", priceCents: 1000 });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("NO_PROFILE");
  });

  it("price is required and creator-set: missing or negative price is refused, $0 is a free course", async () => {
    await makeProfile(owner, "nova-reign");
    const missing = await call(owner, "POST", "/api/courses", { title: "No Price" });
    expect(missing.status).toBe(400);
    const negative = await call(owner, "POST", "/api/courses", { title: "Bad", priceCents: -100 });
    expect(negative.status).toBe(400);
    const free = await call(owner, "POST", "/api/courses", { title: "Free Intro", priceCents: 0 });
    expect(free.status).toBe(201);
    expect(free.json.product.priceCents).toBe(0);
    expect(free.json.product.free).toBe(true);
    /* A new course starts as a draft. */
    expect(free.json.product.isActive).toBe(false);
  });

  it("the stored price is exactly the creator's price", async () => {
    await makeProfile(owner, "nova-reign");
    const res = await call(owner, "POST", "/api/courses", { title: "Priced", priceCents: 12345 });
    expect(res.status).toBe(201);
    expect(res.json.product.priceCents).toBe(12345);
  });

  it("a stranger cannot edit, publish, or rewrite someone else's course", async () => {
    const { productId } = await makeCourse();
    await makeProfile(stranger, "rando");
    expect((await call(stranger, "PATCH", `/api/courses/${productId}`, { priceCents: 1 })).status).toBe(403);
    expect((await call(stranger, "PUT", `/api/courses/${productId}/curriculum`, { sections: [] })).status).toBe(403);
    expect((await call(stranger, "GET", `/api/courses/${productId}/curriculum`)).status).toBe(403);
  });
});

/* ── curriculum rules ─────────────────────────────────────────────── */

describe("courses — curriculum", () => {
  it("array order IS the order: sections and lessons come back in the order sent", async () => {
    const { productId } = await makeCourse();
    const outline = await call(null, "GET", `/api/courses/${productId}`);
    expect(outline.status).toBe(200);
    expect(outline.json.course.sections.map((s: any) => s.title)).toEqual(["Foundations", "Week Two"]);
    expect(outline.json.course.sections[0].lessons.map((l: any) => l.title)).toEqual([
      "Welcome (free preview)", "The Vocal Chain",
    ]);
    expect(outline.json.course.lessonCount).toBe(3);
    expect(outline.json.course.access).toBe("locked");
  });

  it("a text lesson without a body is refused; a foreign or unpublished video is refused", async () => {
    const profileId = await makeProfile(owner, "nova-reign");
    const created = await call(owner, "POST", "/api/courses", { title: "C", priceCents: 100 });
    const productId = created.json.product.id;
    const noBody = await call(owner, "PUT", `/api/courses/${productId}/curriculum`, {
      sections: [{ title: "S", lessons: [{ title: "T", kind: "text", body: "  " }] }],
    });
    expect(noBody.status).toBe(400);
    expect(noBody.json.code).toBe("BAD_LESSON");

    const otherProfile = await makeProfile(stranger, "other-creator");
    const foreignVideo = await makeVideo(otherProfile, "Foreign", "https://cdn.example/foreign.mp4");
    const foreign = await call(owner, "PUT", `/api/courses/${productId}/curriculum`, {
      sections: [{ title: "S", lessons: [{ title: "V", kind: "video", videoId: foreignVideo }] }],
    });
    expect(foreign.status).toBe(403);
    expect(foreign.json.code).toBe("NOT_OWNER");

    const draftVideo = await makeVideo(profileId, "Draft", "https://cdn.example/draft.mp4", { published: false });
    const draft = await call(owner, "PUT", `/api/courses/${productId}/curriculum`, {
      sections: [{ title: "S", lessons: [{ title: "V", kind: "video", videoId: draftVideo }] }],
    });
    expect(draft.status).toBe(400);
    expect(draft.json.code).toBe("VIDEO_NOT_PUBLISHED");
  });

  it("an unpublished course is invisible to the public but visible to its owner", async () => {
    const profileId = await makeProfile(owner, "nova-reign");
    void profileId;
    const created = await call(owner, "POST", "/api/courses", { title: "Draft Course", priceCents: 500 });
    const productId = created.json.product.id;
    expect((await call(null, "GET", `/api/courses/${productId}`)).status).toBe(404);
    const own = await call(owner, "GET", `/api/courses/${productId}`);
    expect(own.status).toBe(200);
    expect(own.json.course.access).toBe("owner");
  });
});

/* ── content gating (the leak tests) ──────────────────────────────── */

describe("courses — server-side content gating", () => {
  it("the public outline NEVER carries lesson content", async () => {
    const { productId } = await makeCourse();
    const outline = await call(null, "GET", `/api/courses/${productId}`);
    expect(outline.status).toBe(200);
    expect(outline.raw).not.toContain(SECRET_BODY);
    expect(outline.raw).not.toContain(SECRET_VIDEO);
    expect(outline.raw).not.toContain(SECRET_ATTACHMENT);
    expect(outline.raw).not.toContain(PREVIEW_BODY);
    const lesson = outline.json.course.sections[0].lessons[1];
    expect(lesson.hasVideo).toBe(true);
    expect(lesson.durationSec).toBe(120);
    expect(lesson).not.toHaveProperty("body");
    expect(lesson).not.toHaveProperty("video");
  });

  it("learn requires auth; a non-buyer gets preview content and NOTHING else", async () => {
    const { productId } = await makeCourse();
    expect((await call(null, "GET", `/api/courses/${productId}/learn`)).status).toBe(401);
    const learn = await call(stranger, "GET", `/api/courses/${productId}/learn`);
    expect(learn.status).toBe(200);
    expect(learn.json.course.access).toBe("locked");
    const [preview, locked] = learn.json.course.sections[0].lessons;
    expect(preview.locked).toBe(false);
    expect(preview.body).toBe(PREVIEW_BODY);
    expect(locked.locked).toBe(true);
    expect(locked.lockReason).toBe("purchase");
    expect(locked.body).toBeNull();
    expect(locked.video).toBeNull();
    expect(locked.attachment).toBeNull();
    expect(learn.raw).not.toContain(SECRET_BODY);
    expect(learn.raw).not.toContain(SECRET_VIDEO);
    expect(learn.raw).not.toContain(SECRET_ATTACHMENT);
  });

  it("a completed order unlocks; the drip lesson stays locked with its unlock date", async () => {
    const { profileId, productId } = await makeCourse();
    await insertOrder(buyer, profileId, productId);
    const learn = await call(buyer, "GET", `/api/courses/${productId}/learn`);
    expect(learn.json.course.access).toBe("purchased");
    const lockedLesson = learn.json.course.sections[0].lessons[1];
    expect(lockedLesson.locked).toBe(false);
    expect(lockedLesson.body).toBe(SECRET_BODY);
    expect(lockedLesson.video.url).toBe(SECRET_VIDEO);
    expect(lockedLesson.attachment.url).toBe(SECRET_ATTACHMENT);
    const dripLesson = learn.json.course.sections[1].lessons[0];
    expect(dripLesson.locked).toBe(true);
    expect(dripLesson.lockReason).toBe("drip");
    expect(dripLesson.body).toBeNull();
    expect(dripLesson.unlockAt).toBeTruthy();
    /* The dripped body must not ride along anywhere in the payload. */
    expect(learn.raw.split(SECRET_BODY).length - 1).toBe(1);
  });

  it("after the drip window the lesson opens", async () => {
    const { profileId, productId } = await makeCourse();
    await insertOrder(buyer, profileId, productId, { daysAgo: 8 });
    const learn = await call(buyer, "GET", `/api/courses/${productId}/learn`);
    const dripLesson = learn.json.course.sections[1].lessons[0];
    expect(dripLesson.locked).toBe(false);
    expect(dripLesson.body).toBe(SECRET_BODY);
  });

  it("a REFUNDED order locks the course again", async () => {
    const { profileId, productId } = await makeCourse();
    await insertOrder(buyer, profileId, productId, { status: "refunded" });
    const learn = await call(buyer, "GET", `/api/courses/${productId}/learn`);
    expect(learn.json.course.access).toBe("locked");
    expect(learn.raw).not.toContain(SECRET_VIDEO);
  });

  it("the owner always has full access, drip included", async () => {
    const { productId } = await makeCourse();
    const learn = await call(owner, "GET", `/api/courses/${productId}/learn`);
    expect(learn.json.course.access).toBe("owner");
    for (const s of learn.json.course.sections) {
      for (const l of s.lessons) expect(l.locked).toBe(false);
    }
  });
});

/* ── progress ─────────────────────────────────────────────────────── */

describe("courses — buyer progress", () => {
  it("progress beats derive status and the resume position only moves forward", async () => {
    const { profileId, productId, lessonIds } = await makeCourse();
    await insertOrder(buyer, profileId, productId);
    const beat = await call(buyer, "POST", `/api/courses/${productId}/lessons/${lessonIds.locked}/progress`, { positionSec: 47 });
    expect(beat.status).toBe(200);
    expect(beat.json.progress.status).toBe("in_progress");
    expect(beat.json.progress.lastPositionSec).toBe(47);
    const smaller = await call(buyer, "POST", `/api/courses/${productId}/lessons/${lessonIds.locked}/progress`, { positionSec: 12 });
    expect(smaller.json.progress.lastPositionSec).toBe(47);
    const done = await call(buyer, "POST", `/api/courses/${productId}/lessons/${lessonIds.locked}/progress`, { complete: true });
    expect(done.json.progress.status).toBe("completed");
    expect(done.json.progress.completedAt).toBeTruthy();
    const reopened = await call(buyer, "POST", `/api/courses/${productId}/lessons/${lessonIds.locked}/progress`, { uncomplete: true });
    expect(reopened.json.progress.status).toBe("in_progress");
    expect(reopened.json.progress.completedAt).toBeNull();
  });

  it("progress is refused on purchase-locked and drip-locked lessons, allowed on previews", async () => {
    const { profileId, productId, lessonIds } = await makeCourse();
    const lockedBeat = await call(stranger, "POST", `/api/courses/${productId}/lessons/${lessonIds.locked}/progress`, { complete: true });
    expect(lockedBeat.status).toBe(403);
    expect(lockedBeat.json.code).toBe("COURSE_LOCKED");
    const previewBeat = await call(stranger, "POST", `/api/courses/${productId}/lessons/${lessonIds.preview}/progress`, { complete: true });
    expect(previewBeat.status).toBe(200);

    await insertOrder(buyer, profileId, productId);
    const dripBeat = await call(buyer, "POST", `/api/courses/${productId}/lessons/${lessonIds.drip}/progress`, { complete: true });
    expect(dripBeat.status).toBe(403);
    expect(dripBeat.json.code).toBe("LESSON_DRIPPED");
  });

  it("progress is per-buyer and surfaces on the learn view + My Courses shelf", async () => {
    const { profileId, productId, lessonIds } = await makeCourse();
    await insertOrder(buyer, profileId, productId);
    await call(buyer, "POST", `/api/courses/${productId}/lessons/${lessonIds.locked}/progress`, { complete: true });

    const learn = await call(buyer, "GET", `/api/courses/${productId}/learn`);
    expect(learn.json.course.completedLessons).toBe(1);
    expect(learn.json.course.progressPct).toBe(33);

    const mine = await call(buyer, "GET", "/api/courses/mine");
    expect(mine.status).toBe(200);
    expect(mine.json.courses).toHaveLength(1);
    expect(mine.json.courses[0].product.id).toBe(productId);
    expect(mine.json.courses[0].access).toBe("purchased");
    expect(mine.json.courses[0].progressPct).toBe(33);

    const strangerMine = await call(stranger, "GET", "/api/courses/mine");
    expect(strangerMine.json.courses).toEqual([]);
    const ownerMine = await call(owner, "GET", "/api/courses/mine");
    expect(ownerMine.json.courses).toHaveLength(1);
    expect(ownerMine.json.courses[0].access).toBe("owner");
  });
});
