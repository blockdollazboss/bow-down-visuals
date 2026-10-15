/**
 * Route tests for the comment DTOs in routes/creator-platform:
 *   GET/POST /api/creator-profiles/:id/comments   (profile Shout Wall)
 *   GET/POST /api/media/:kind/:id/comments        (player CommentThread)
 *
 * THE REGRESSION: both endpoints spread the raw Drizzle row and attached
 * only `author_profile_slug`. No author name or avatar was ever sent, and
 * the date rode as camelCase `createdAt`. The clients render strictly
 * from their snake_case contracts —
 *   wall   (lib/artist-profiles.ts ProfileComment):
 *          author_name, author_avatar_url, author_slug, created_at
 *   player (lib/streaming.ts MediaComment):
 *          user_id, display_name, avatar_url, created_at
 * — so every wall comment rendered a blank name with no avatar, no
 * working profile link and no date, and every player comment fell back
 * to "Creator" + "?" with no date.
 *
 * These tests mount the real router over a fake db (style mirrors
 * creator-profile-public.test.ts: real table objects via importOriginal,
 * WHERE params read back through PgDialect rendering) and pin the full
 * DTO for both surfaces: author fields resolved from the author's
 * creator profile in one batched lookup, a no-profile author degrading
 * to "Creator" + null avatar/slug, created_at as an ISO string, and the
 * raw-row camelCase fields absent.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const AUTH_USER = "00000000-0000-4000-8000-000000000099";
const WALL_ID = "11111111-1111-4111-8111-111111111111";
const WALL_OWNER = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";
const GHOST_ID = "44444444-4444-4444-8444-444444444444";
const TRACK_ID = "55555555-5555-4555-8555-555555555555";
const WALL_COMMENT_1 = "66666666-6666-4666-8666-666666666666";
const WALL_COMMENT_2 = "77777777-7777-4777-8777-777777777777";
const MEDIA_COMMENT_1 = "88888888-8888-4888-8888-888888888888";
const MEDIA_COMMENT_2 = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    wallComments: [] as Array<Record<string, unknown>>,
    mediaComments: [] as Array<Record<string, unknown>>,
    tracksById: new Map<string, Record<string, unknown>>(),
    insertedComments: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = AUTH_USER;
    next();
  },
}));

vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileCommentsTable,
    mediaCommentsTable,
  } = actual;

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    const params = cond !== undefined ? render(cond).params : [];
    if (table === creatorProfilesTable) {
      // Author batch lookup: select({userId, slug, displayName, avatarUrl})
      // with an inArray(userId, [...]) condition.
      if (fields && typeof fields === "object" && "displayName" in (fields as object)) {
        const wanted = new Set(params.map(String));
        return [...state.profilesByUserId.values()]
          .filter((p) => wanted.has(String(p["userId"])))
          .map((p) => ({
            userId: p["userId"],
            slug: p["slug"],
            displayName: p["displayName"],
            avatarUrl: p["avatarUrl"],
          }));
      }
      // Slug lookup: select() with eq(slug) — answer from the same rows.
      if (render(cond).sql.includes('"slug"')) {
        const row = [...state.profilesById.values()].find(
          (p) => String(p["slug"]) === String(params[0] ?? ""),
        );
        return row ? [row] : [];
      }
      // getProfileById: select() with eq(id).
      const row = state.profilesById.get(String(params[0] ?? ""));
      return row ? [row] : [];
    }
    if (table === profileCommentsTable) {
      return state.wallComments.filter((c) => String(c["profileId"]) === String(params[0]));
    }
    if (table === profileTracksTable) {
      const row = state.tracksById.get(String(params[0] ?? ""));
      return row ? [row] : [];
    }
    if (table === mediaCommentsTable) {
      return state.mediaComments.filter((c) => params.map(String).includes(String(c["mediaId"])));
    }
    return [];
  }

  function chain(table: unknown, fields: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      offset: (_n: number) => self,
      orderBy: (..._args: unknown[]) => self,
      then: (res: any, rej: any) =>
        Promise.resolve(rowsFor(table, fields, cond)).then(res, rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, fields, cond),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const self: any = {
          returning: async () => {
            if (table === profileCommentsTable || table === mediaCommentsTable) {
              const row = {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                kind: "track",
                ...v,
                createdAt: new Date("2026-10-14T09:30:00.000Z"),
              };
              state.insertedComments.push(row);
              return [row];
            }
            return [{ ...v }];
          },
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
        return self;
      },
    }),
    execute: async () => [],
  };

  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

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

function profileRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: WALL_ID,
    userId: WALL_OWNER,
    slug: "wall-owner",
    displayName: "Wall Owner",
    avatarUrl: "/images/avatars/owner.png",
    isPublic: true,
    followerCount: 0,
    ...over,
  };
}

beforeEach(() => {
  const s = h.state;
  s.profilesById = new Map();
  s.profilesByUserId = new Map();
  s.wallComments = [];
  s.mediaComments = [];
  s.tracksById = new Map();
  s.insertedComments = [];

  const wall = profileRow({});
  s.profilesById.set(WALL_ID, wall);
  s.profilesByUserId.set(WALL_OWNER, wall);

  const author = profileRow({
    id: "12121212-1212-4212-8212-121212121212",
    userId: AUTHOR_ID,
    slug: "mira-waves",
    displayName: "Mira Waves",
    avatarUrl: "/images/avatars/mira.png",
  });
  s.profilesByUserId.set(AUTHOR_ID, author);

  const poster = profileRow({
    id: "13131313-1313-4313-8313-131313131313",
    userId: AUTH_USER,
    slug: "poster-shark",
    displayName: "Poster Shark",
    avatarUrl: "/images/avatars/poster.png",
  });
  s.profilesByUserId.set(AUTH_USER, poster);

  s.wallComments = [
    {
      id: WALL_COMMENT_1,
      profileId: WALL_ID,
      authorUserId: AUTHOR_ID,
      body: "This wall eats. 🦈",
      createdAt: new Date("2026-10-01T12:00:00.000Z"),
    },
    {
      id: WALL_COMMENT_2,
      profileId: WALL_ID,
      authorUserId: GHOST_ID,
      body: "drive-by love",
      createdAt: new Date("2026-10-02T12:00:00.000Z"),
    },
  ];

  s.tracksById.set(TRACK_ID, {
    id: TRACK_ID,
    profileId: WALL_ID,
    title: "Midnight Gold",
    isPublished: true,
    commentCount: 2,
  });

  s.mediaComments = [
    {
      id: MEDIA_COMMENT_1,
      kind: "track",
      mediaId: TRACK_ID,
      authorUserId: AUTHOR_ID,
      body: "that drop though",
      createdAt: new Date("2026-10-03T12:00:00.000Z"),
    },
    {
      id: MEDIA_COMMENT_2,
      kind: "track",
      mediaId: TRACK_ID,
      authorUserId: GHOST_ID,
      body: "anonymous heat",
      createdAt: new Date("2026-10-04T12:00:00.000Z"),
    },
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function expectCommentDto(c: any, want: {
  name: string; avatar: string | null; slug: string | null; userId: string; iso: string;
}) {
  // Wall contract (ProfileComment).
  expect(c.author_name).toBe(want.name);
  expect(c.author_avatar_url).toBe(want.avatar);
  expect(c.author_slug).toBe(want.slug);
  // Player contract (MediaComment) — same mapper, both field sets present.
  expect(c.display_name).toBe(want.name);
  expect(c.avatar_url).toBe(want.avatar);
  expect(c.user_id).toBe(want.userId);
  // Link-graph field from the old payload stays for compatibility.
  expect(c.author_profile_slug).toBe(want.slug);
  // Date: snake_case ISO string, parseable, exactly the row's instant.
  expect(c.created_at).toBe(want.iso);
  expect(Number.isNaN(Date.parse(c.created_at))).toBe(false);
  // The raw-row camelCase fields are gone — the DTO is explicit.
  expect(c).not.toHaveProperty("createdAt");
  expect(c).not.toHaveProperty("authorUserId");
}

describe("wall comments DTO — GET /api/creator-profiles/:id/comments", () => {
  it("populates author name, avatar, slug and ISO date from the author's profile", async () => {
    const { status, json } = await get(`/creator-profiles/${WALL_ID}/comments`);
    expect(status).toBe(200);
    expect(json.comments).toHaveLength(2);
    const c = json.comments.find((x: any) => x.id === WALL_COMMENT_1);
    expect(c.body).toBe("This wall eats. 🦈");
    expectCommentDto(c, {
      name: "Mira Waves",
      avatar: "/images/avatars/mira.png",
      slug: "mira-waves",
      userId: AUTHOR_ID,
      iso: "2026-10-01T12:00:00.000Z",
    });
  });

  it("degrades a profile-less author to Creator + null avatar/slug, list intact", async () => {
    const { status, json } = await get(`/creator-profiles/${WALL_ID}/comments`);
    expect(status).toBe(200);
    const c = json.comments.find((x: any) => x.id === WALL_COMMENT_2);
    expect(c.body).toBe("drive-by love");
    expectCommentDto(c, {
      name: "Creator",
      avatar: null,
      slug: null,
      userId: GHOST_ID,
      iso: "2026-10-02T12:00:00.000Z",
    });
  });
});

/**
 * THE SHOUT WALL REGRESSION: the only production caller
 * (profile-sections.tsx ShoutWallSection → lib/artist-profiles.ts) passes
 * the profile SLUG to both wall endpoints, but the handlers resolved the
 * :id param through an id-only lookup — a slug could never match a UUID,
 * so the wall's GET 404'd (swallowed by the client → permanently empty
 * wall) and its POST 404'd (the shout never landed). These tests drive
 * both endpoints BY SLUG, the production caller's shape.
 */
describe("wall comments resolve BY SLUG — GET/POST /api/creator-profiles/:slug/comments", () => {
  it("GET by slug loads the wall's comments with the full DTO", async () => {
    const { status, json } = await get(`/creator-profiles/wall-owner/comments`);
    expect(status).toBe(200);
    expect(json.comments).toHaveLength(2);
    const c = json.comments.find((x: any) => x.id === WALL_COMMENT_1);
    expect(c.body).toBe("This wall eats. 🦈");
    expectCommentDto(c, {
      name: "Mira Waves",
      avatar: "/images/avatars/mira.png",
      slug: "mira-waves",
      userId: AUTHOR_ID,
      iso: "2026-10-01T12:00:00.000Z",
    });
  });

  it("POST by slug lands the shout on the resolved profile", async () => {
    const { status, json } = await post(`/creator-profiles/wall-owner/comments`, { body: "slug shout" });
    expect(status).toBe(201);
    expect(json.comment.body).toBe("slug shout");
    expectCommentDto(json.comment, {
      name: "Poster Shark",
      avatar: "/images/avatars/poster.png",
      slug: "poster-shark",
      userId: AUTH_USER,
      iso: "2026-10-14T09:30:00.000Z",
    });
    // The insert targeted the profile the slug resolved to, not a slug string.
    expect(h.state.insertedComments).toHaveLength(1);
    expect(h.state.insertedComments[0]!["profileId"]).toBe(WALL_ID);
  });

  it("GET by an unknown slug still 404s", async () => {
    const { status } = await get(`/creator-profiles/no-such-creator/comments`);
    expect(status).toBe(404);
  });

  it("a non-public profile still 404s by slug, same as by id", async () => {
    const row = h.state.profilesById.get(WALL_ID)!;
    row["isPublic"] = false;
    const bySlug = await get(`/creator-profiles/wall-owner/comments`);
    expect(bySlug.status).toBe(404);
    const byId = await get(`/creator-profiles/${WALL_ID}/comments`);
    expect(byId.status).toBe(404);
  });
});

describe("media comments DTO — GET /api/media/:kind/:id/comments", () => {
  it("populates display_name, avatar_url, user_id and ISO date from the author's profile", async () => {
    const { status, json } = await get(`/media/track/${TRACK_ID}/comments`);
    expect(status).toBe(200);
    expect(json.comments).toHaveLength(2);
    const c = json.comments.find((x: any) => x.id === MEDIA_COMMENT_1);
    expect(c.body).toBe("that drop though");
    expectCommentDto(c, {
      name: "Mira Waves",
      avatar: "/images/avatars/mira.png",
      slug: "mira-waves",
      userId: AUTHOR_ID,
      iso: "2026-10-03T12:00:00.000Z",
    });
  });

  it("degrades a profile-less author to Creator + null avatar, list intact", async () => {
    const { status, json } = await get(`/media/track/${TRACK_ID}/comments`);
    expect(status).toBe(200);
    const c = json.comments.find((x: any) => x.id === MEDIA_COMMENT_2);
    expectCommentDto(c, {
      name: "Creator",
      avatar: null,
      slug: null,
      userId: GHOST_ID,
      iso: "2026-10-04T12:00:00.000Z",
    });
  });
});

describe("comment POST responses carry the same DTO", () => {
  it("wall POST returns the created comment fully attributed", async () => {
    const { status, json } = await post(`/creator-profiles/${WALL_ID}/comments`, { body: "fresh ink" });
    expect(status).toBe(201);
    expect(json.comment.body).toBe("fresh ink");
    expectCommentDto(json.comment, {
      name: "Poster Shark",
      avatar: "/images/avatars/poster.png",
      slug: "poster-shark",
      userId: AUTH_USER,
      iso: "2026-10-14T09:30:00.000Z",
    });
  });

  it("media POST returns the created comment fully attributed", async () => {
    const { status, json } = await post(`/media/track/${TRACK_ID}/comments`, { body: "first!" });
    expect(status).toBe(201);
    expect(json.comment.body).toBe("first!");
    expectCommentDto(json.comment, {
      name: "Poster Shark",
      avatar: "/images/avatars/poster.png",
      slug: "poster-shark",
      userId: AUTH_USER,
      iso: "2026-10-14T09:30:00.000Z",
    });
  });
});
