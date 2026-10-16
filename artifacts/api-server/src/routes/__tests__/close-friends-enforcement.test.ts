/**
 * Read-time audience enforcement (Stack 9 #7) — THE failure mode is a
 * leak through any surface. One author, one close-friends post + one
 * close-friends story, three viewers (circle member / follower who
 * is NOT in the circle / outsider), every surface that serves posts
 * or stories:
 *   GET /feed (chrono + foryou) · GET /posts/:id · GET /hashtag/:tag/posts
 *   GET /saves/mine · quoted embeds · GET /stories/feed
 *   GET /stories/by-profile/:id · POST /stories/:id/view
 * A follower alone must NEVER see close-friends content — following
 * is not being in the circle.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-1111111111a1";
const CIRCLE = "00000000-0000-4000-8000-0000000000b1";
const CIRCLE_PROFILE = "11111111-1111-4111-8111-1111111111b1";
const FOLLOWER = "00000000-0000-4000-8000-0000000000c1";
const FOLLOWER_PROFILE = "11111111-1111-4111-8111-1111111111c1";
const OUTSIDER = "00000000-0000-4000-8000-0000000000d1";
const CF_POST = "22222222-2222-4222-8222-2222222222a1";
const PUB_POST = "22222222-2222-4222-8222-2222222222a2";
const QUOTE_POST = "22222222-2222-4222-8222-2222222222a3";
const CF_STORY = "33333333-3333-4333-8333-3333333333a1";
const PUB_STORY = "33333333-3333-4333-8333-3333333333a2";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/live-ws", () => ({
  verifyAccessToken: async (token: string) =>
    token.startsWith("tok-") ? { userId: token.slice(4), email: null } : null,
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
  addCreditsAtomic: async () => ({ oldCredits: 0, newCredits: 0, created: false }),
}));
vi.mock("../../lib/payment-record", () => ({ recordCreditUsageStrict: async () => undefined }));
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
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    creatorProfiles: actual.creatorProfilesTable,
    posts: actual.postsTable,
    stories: actual.storiesTable,
    storyHighlights: actual.storyHighlightsTable,
    follows: actual.followsTable,
    closeFriends: actual.closeFriendsTable,
    reactions: actual.reactionsTable,
    saves: actual.savesTable,
    pollOptions: actual.pollOptionsTable,
    pollVotes: actual.pollVotesTable,
    notifications: actual.notificationsTable,
    profileTracks: actual.profileTracksTable,
    profileVideos: actual.profileVideosTable,
    likes: actual.likesTable,
    playEvents: actual.playEventsTable,
    conversations: actual.conversationsTable,
    messages: actual.messagesTable,
    socialAccounts: actual.socialAccountsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
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
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, opts: { user?: string; bearer?: string; body?: unknown } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
      ...(opts.bearer ? { Authorization: `Bearer tok-${opts.bearer}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

const NOW = new Date("2026-10-16T12:00:00Z");
function postRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    profileId: AUTHOR_PROFILE,
    body: "hello",
    mediaUrls: [],
    kind: "post",
    replyTo: null,
    quoteOf: null,
    repostOf: null,
    groupId: null,
    scheduledFor: null,
    audience: "public",
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    createdAt: NOW,
    ...over,
  };
}

beforeEach(() => {
  h.fake.clear();
  h.fake.seed("creatorProfiles", [
    { id: AUTHOR_PROFILE, userId: AUTHOR, slug: "author", displayName: "Author", avatarUrl: null, isVerified: false },
    { id: CIRCLE_PROFILE, userId: CIRCLE, slug: "circle", displayName: "Circle", avatarUrl: null, isVerified: false },
    { id: FOLLOWER_PROFILE, userId: FOLLOWER, slug: "fan", displayName: "Fan", avatarUrl: null, isVerified: false },
  ]);
  h.fake.seed("posts", [
    postRow(CF_POST, { body: "circle only #secret", audience: "close_friends" }),
    postRow(PUB_POST, { body: "for everyone #secret" }),
    postRow(QUOTE_POST, { body: "quoting the circle post", kind: "quote", quoteOf: CF_POST, profileId: FOLLOWER_PROFILE }),
  ]);
  h.fake.seed("stories", [
    { id: CF_STORY, profileId: AUTHOR_PROFILE, mediaUrl: "https://cdn.example.com/cf.mp4", mediaKind: "video", caption: "cf", audience: "close_friends", viewCount: 0, expiresAt: new Date(Date.now() + 3600_000), createdAt: NOW },
    { id: PUB_STORY, profileId: AUTHOR_PROFILE, mediaUrl: "https://cdn.example.com/pub.mp4", mediaKind: "video", caption: "pub", audience: "public", viewCount: 0, expiresAt: new Date(Date.now() + 3600_000), createdAt: NOW },
  ]);
  // CIRCLE and FOLLOWER both follow the author; only CIRCLE is in the circle.
  h.fake.seed("follows", [
    { followerUserId: CIRCLE, profileId: AUTHOR_PROFILE, createdAt: NOW },
    { followerUserId: FOLLOWER, profileId: AUTHOR_PROFILE, createdAt: NOW },
  ]);
  h.fake.seed("closeFriends", [
    { owner_user_id: AUTHOR, owner_profile_id: AUTHOR_PROFILE, friend_user_id: CIRCLE, friend_profile_id: CIRCLE_PROFILE, created_at: NOW },
  ]);
  // The follower saved the close-friends post earlier (bookmark leak surface).
  h.fake.seed("saves", [{ userId: FOLLOWER, kind: "post", targetId: CF_POST, createdAt: NOW }]);
});

const feedIds = (json: any) => (json.posts ?? []).map((p: any) => p.id);

describe("posts — feed surfaces", () => {
  it("chrono feed: follower-not-in-circle and outsider never receive the close-friends post; the circle member and author do", async () => {
    const follower = await call("GET", "/feed", { user: FOLLOWER });
    expect(feedIds(follower.json)).toContain(PUB_POST);
    expect(feedIds(follower.json)).not.toContain(CF_POST);
    const outsider = await call("GET", "/feed", { user: OUTSIDER });
    expect(feedIds(outsider.json)).not.toContain(CF_POST);
    const circle = await call("GET", "/feed", { user: CIRCLE });
    expect(feedIds(circle.json)).toContain(CF_POST);
    const author = await call("GET", "/feed", { user: AUTHOR });
    expect(feedIds(author.json)).toContain(CF_POST);
  });

  it("for-you feed: same enforcement, and the circle member's item carries an honest why", async () => {
    const follower = await call("GET", "/feed?mode=foryou", { user: FOLLOWER });
    expect(feedIds(follower.json)).not.toContain(CF_POST);
    const circle = await call("GET", "/feed?mode=foryou", { user: CIRCLE });
    const cf = (circle.json.posts ?? []).find((p: any) => p.id === CF_POST);
    expect(cf).toBeTruthy();
    expect(cf.why?.kind).toBe("following");
    expect(cf.why?.label).toMatch(/follow/i);
  });

  it("quoted embeds: a public quote of a close-friends post shows quoted=null outside the circle", async () => {
    const outsider = await call("GET", "/feed", { user: OUTSIDER });
    const q = (outsider.json.posts ?? []).find((p: any) => p.id === QUOTE_POST);
    expect(q).toBeTruthy();
    expect(q.quoted).toBeNull();
    const circle = await call("GET", "/feed", { user: CIRCLE });
    const q2 = (circle.json.posts ?? []).find((p: any) => p.id === QUOTE_POST);
    expect(q2?.quoted?.id).toBe(CF_POST);
  });
});

describe("posts — detail, hashtag, saves", () => {
  it("GET /posts/:id is a 404 (not a leak) for outsiders and non-circle followers; 200 in the circle", async () => {
    expect((await call("GET", `/posts/${CF_POST}`)).status).toBe(404);
    expect((await call("GET", `/posts/${CF_POST}`, { bearer: FOLLOWER })).status).toBe(404);
    const circle = await call("GET", `/posts/${CF_POST}`, { bearer: CIRCLE });
    expect(circle.status).toBe(200);
    expect(circle.json.post.id).toBe(CF_POST);
  });

  it("hashtag surface filters scoped posts for non-circle viewers", async () => {
    const follower = await call("GET", "/hashtag/secret/posts", { bearer: FOLLOWER });
    expect(feedIds(follower.json)).not.toContain(CF_POST);
    expect(feedIds(follower.json)).toContain(PUB_POST);
    const circle = await call("GET", "/hashtag/secret/posts", { bearer: CIRCLE });
    expect(feedIds(circle.json)).toContain(CF_POST);
  });

  it("saves: a saved close-friends post leaves the saver's list once they're outside the circle", async () => {
    const saves = await call("GET", "/saves/mine", { user: FOLLOWER });
    const entry = (saves.json.saves ?? []).find((s: any) => s.target_id === CF_POST);
    expect(entry).toBeTruthy();
    expect(entry.post).toBeNull();
  });
});

describe("stories — feed, by-profile, view", () => {
  it("stories/feed: non-circle follower gets only the public story; circle member gets both", async () => {
    const follower = await call("GET", "/stories/feed", { user: FOLLOWER });
    const ids = (follower.json.stories ?? []).map((s: any) => s.id);
    expect(ids).toContain(PUB_STORY);
    expect(ids).not.toContain(CF_STORY);
    const circle = await call("GET", "/stories/feed", { user: CIRCLE });
    const cids = (circle.json.stories ?? []).map((s: any) => s.id);
    expect(cids).toContain(CF_STORY);
  });

  it("stories/by-profile: anonymous sees public only; circle member (Bearer) sees both", async () => {
    const anon = await call("GET", `/stories/by-profile/${AUTHOR_PROFILE}`);
    const ids = (anon.json.stories ?? []).map((s: any) => s.id);
    expect(ids).toEqual([PUB_STORY]);
    const circle = await call("GET", `/stories/by-profile/${AUTHOR_PROFILE}`, { bearer: CIRCLE });
    const cids = (circle.json.stories ?? []).map((s: any) => s.id);
    expect(cids).toContain(CF_STORY);
    expect(cids).toContain(PUB_STORY);
  });

  it("story view counting refuses scoped stories to non-circle viewers", async () => {
    expect((await call("POST", `/stories/${CF_STORY}/view`, { user: FOLLOWER })).status).toBe(404);
    expect((await call("POST", `/stories/${CF_STORY}/view`, { user: CIRCLE })).status).toBe(200);
  });
});
