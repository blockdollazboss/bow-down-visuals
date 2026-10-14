/**
 * Route tests for the social feed DTO contract (routes/social).
 *
 * THE REGRESSION: GET /feed built each post by spreading the raw Drizzle
 * row ({ ...p, mediaUrls, author, ... }) — so the wire payload carried
 * camelCase table keys (profileId, mediaUrls, createdAt, likeCount, …)
 * while the frontend contract (lib/social-api.ts FeedPost) is snake_case
 * end to end. Nothing errored; the feed just silently lost media
 * (post.media_urls), timestamps (post.created_at — feed.tsx also
 * paginates on it), and counts (like/reply/repost_count) on every post.
 * enrichPosts now builds the DTO field-by-field; these tests pin the
 * snake_case keys AND the absence of the camelCase leaks, for the feed
 * and for the post detail endpoint that shares enrichPosts.
 *
 * Fake-db style mirrors routes/__tests__/creator-profile-public.test.ts:
 * real table objects via importOriginal, a chainable select whose rows
 * dispatch on table identity.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const CREATED = new Date("2026-10-14T15:04:05.000Z");

const h = vi.hoisted(() => ({
  state: {
    profile: null as Record<string, unknown> | null,
    posts: [] as Array<Record<string, unknown>>,
    stories: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => {
    throw new Error("no AI in route tests");
  },
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => undefined,
  refundCredits: async () => undefined,
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => undefined,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/social-crypto", () => ({
  encryptToken: (s: string) => s,
  decryptToken: (s: string) => s,
  isSocialTokenKeyConfigured: () => false,
}));

vi.mock("../../lib/social-meta", () => ({
  buildAuthUrl: () => "",
  buildFacebookAuthUrl: () => "",
  exchangeCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  exchangeFacebookCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  fetchInstagramProfile: async () => {
    throw new Error("no Meta in route tests");
  },
  listPages: async () => [],
  publishReelToInstagram: async () => {
    throw new Error("no Meta in route tests");
  },
  publishVideoToPage: async () => {
    throw new Error("no Meta in route tests");
  },
  MetaApiError: class MetaApiError extends Error {},
}));

vi.mock("../../lib/social-idempotency", () => ({
  claimPublishAttempt: async () => ({ claimed: true }),
  createDrizzleAttemptStore: () => ({}),
}));

vi.mock("../../lib/social-tiktok", () => ({
  buildTikTokAuthUrl: () => "",
  exchangeCodeForTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  refreshTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  fetchTikTokUserInfo: async () => {
    throw new Error("no TikTok in route tests");
  },
  uploadDraftToTikTok: async () => {
    throw new Error("no TikTok in route tests");
  },
  downloadVideoBytes: async () => new Uint8Array(),
  TikTokApiError: class TikTokApiError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    postsTable,
    storiesTable,
  } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === creatorProfilesTable) return state.profile ? [state.profile] : [];
    if (table === postsTable) return state.posts;
    if (table === storiesTable) return state.stories;
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../social";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function profileRow(): Record<string, unknown> {
  return {
    id: PROFILE_ID,
    userId: VIEWER_ID,
    slug: "some-creator",
    displayName: "Some Creator",
    avatarUrl: "https://cdn.example.com/avatar.png",
    isVerified: true,
  };
}

function postRow(): Record<string, unknown> {
  return {
    id: POST_ID,
    profileId: PROFILE_ID,
    body: "New drop Friday 🦈",
    mediaUrls: [{ kind: "image", url: "https://cdn.example.com/pic.jpg" }],
    kind: "post",
    replyTo: null,
    quoteOf: null,
    repostOf: null,
    groupId: null,
    scheduledFor: null,
    audience: "public",
    likeCount: 7,
    repostCount: 2,
    replyCount: 3,
    createdAt: CREATED,
  };
}

const STORY_ID = "33333333-3333-4333-8333-333333333333";
const STORY_CREATED = new Date("2026-10-14T10:00:00.000Z");
const STORY_EXPIRES = new Date("2026-10-15T10:00:00.000Z");

function storyRow(): Record<string, unknown> {
  return {
    id: STORY_ID,
    profileId: PROFILE_ID,
    mediaUrl: "https://cdn.example.com/story.mp4",
    mediaKind: "video",
    caption: "Backstage 🦈",
    viewCount: 42,
    expiresAt: STORY_EXPIRES,
    createdAt: STORY_CREATED,
  };
}

beforeEach(() => {
  h.state.profile = profileRow();
  h.state.posts = [postRow()];
  h.state.stories = [storyRow()];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function expectPostDto(post: any) {
  expect(post.id).toBe(POST_ID);
  expect(post.profile_id).toBe(PROFILE_ID);
  expect(post.body).toBe("New drop Friday 🦈");
  // The regression pins: media, timestamps and counts under snake_case.
  expect(post.media_urls).toEqual([{ kind: "image", url: "https://cdn.example.com/pic.jpg" }]);
  expect(post.created_at).toBe("2026-10-14T15:04:05.000Z");
  expect(post.like_count).toBe(7);
  expect(post.repost_count).toBe(2);
  expect(post.reply_count).toBe(3);
  expect(post.kind).toBe("post");
  expect(post.reply_to).toBeNull();
  expect(post.quote_of).toBeNull();
  expect(post.repost_of).toBeNull();
  expect(post.group_id).toBeNull();
  expect(post.scheduled_for).toBeNull();
  expect(post.audience).toBe("public");
  // Enrichment fields ride along unchanged.
  expect(post.author?.slug).toBe("some-creator");
  expect(post.author?.display_name).toBe("Some Creator");
  expect(post.viewer_emoji).toBeNull();
  expect(post.viewer_saved).toBe(false);
  expect(post.reaction_counts).toEqual({});
  expect(post.quoted).toBeNull();
  expect(post.poll).toBeNull();
  // The camelCase table keys must NOT leak through the DTO.
  expect(post).not.toHaveProperty("profileId");
  expect(post).not.toHaveProperty("mediaUrls");
  expect(post).not.toHaveProperty("createdAt");
  expect(post).not.toHaveProperty("likeCount");
  expect(post).not.toHaveProperty("replyCount");
  expect(post).not.toHaveProperty("repostCount");
}

describe("GET /api/feed — post DTO contract", () => {
  it("ships snake_case post fields (media_urls, created_at, counts)", async () => {
    const { status, json } = await get("/feed");

    expect(status).toBe(200);
    expect(json.posts).toHaveLength(1);
    expectPostDto(json.posts[0]);
  });
});

describe("GET /api/posts/:id — post DTO contract", () => {
  it("ships the same snake_case DTO as the feed", async () => {
    const { status, json } = await get(`/posts/${POST_ID}`);

    expect(status).toBe(200);
    expectPostDto(json.post);
  });
});

function expectStoryDto(story: any, withAuthor: boolean) {
  expect(story.id).toBe(STORY_ID);
  expect(story.profile_id).toBe(PROFILE_ID);
  // The regression pins: StoryViewer reads expires_at / media_kind /
  // media_url — all must exist under snake_case.
  expect(story.media_url).toBe("https://cdn.example.com/story.mp4");
  expect(story.media_kind).toBe("video");
  expect(story.caption).toBe("Backstage 🦈");
  expect(story.view_count).toBe(42);
  expect(story.expires_at).toBe("2026-10-15T10:00:00.000Z");
  expect(story.created_at).toBe("2026-10-14T10:00:00.000Z");
  if (withAuthor) {
    expect(story.author?.slug).toBe("some-creator");
    expect(story.author?.display_name).toBe("Some Creator");
  } else {
    expect(story.author).toBeNull();
  }
  // The camelCase table keys must NOT leak through the DTO.
  expect(story).not.toHaveProperty("profileId");
  expect(story).not.toHaveProperty("mediaUrl");
  expect(story).not.toHaveProperty("mediaKind");
  expect(story).not.toHaveProperty("viewCount");
  expect(story).not.toHaveProperty("expiresAt");
  expect(story).not.toHaveProperty("createdAt");
}

describe("GET /api/stories/feed — story DTO contract", () => {
  it("ships snake_case story fields (media_url, media_kind, expires_at)", async () => {
    const { status, json } = await get("/stories/feed");

    expect(status).toBe(200);
    expect(json.stories).toHaveLength(1);
    expectStoryDto(json.stories[0], true);
  });
});

describe("GET /api/stories/by-profile/:profileId — story DTO contract", () => {
  it("ships the same snake_case story DTO (profile page consumes Story[])", async () => {
    const { status, json } = await get(`/stories/by-profile/${PROFILE_ID}`);

    expect(status).toBe(200);
    expect(json.stories).toHaveLength(1);
    expectStoryDto(json.stories[0], false);
  });
});
