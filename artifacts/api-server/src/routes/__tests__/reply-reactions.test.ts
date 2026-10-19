/**
 * Route tests for reactions on thread REPLIES (the STACK-20 R2
 * residual: in-world, reactions existed only on top-level posts).
 *
 * THE SHAPE, proven before building: a reply is a row in `posts`
 * (kind 'thread_reply', reply_to self-FK, its own uuid) — so the
 * reaction rail (POST/DELETE /api/react, target_kind "post") already
 * stores, switches and removes reactions on a reply id identically
 * to a top-level post, like_count maintenance included; and
 * GET /api/posts/:id/replies enriches every row through enrichPosts,
 * so reaction_counts + viewer_emoji already ride the replies DTO.
 * The website proved the same shape first: PostCard renders replies
 * as recursive PostCards with the full reaction row. These tests pin
 * the rail contract for reply targets so the in-world wiring (and
 * any future surface) can never silently lose it:
 *
 *  - toggle on / switch / toggle off against a REPLY id, with the
 *    counts + viewer state read back through the replies DTO;
 *  - the same at nesting depth 2 (a reply's own replies);
 *  - guests refused at the rail (requireAuth) but able to READ the
 *    counts (the replies read is public, viewer_emoji null);
 *  - read-time visibility: replies under a followers-only parent
 *    404 for strangers, open for followers — reacting never leaks
 *    them;
 *  - the closed contract: emoji and target_kind stay the server's
 *    sets (a "reply" target kind is refused — replies ride "post").
 *
 * Harness: the house generic fake db (_reach-fake-db) over the REAL
 * table objects — conditions are rendered with PgDialect and
 * evaluated, inserts honor the on-conflict update the rail uses.
 * Auth rides a test Bearer token: require-auth is mocked to it, and
 * live-ws' verifyAccessToken resolves the same identity for the
 * optional-auth reads. The fake's set-expression evaluator was
 * extended (in _reach-fake-db) with GREATEST/LEAST so the DELETE
 * path's like_count floor is honored here too.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createFakeDb } from "./_reach-fake-db";

const AUTHOR_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-111111111111";
const FAN_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const REPLY_ID = "33333333-3333-4333-8333-333333333333";
const NESTED_ID = "44444444-4444-4444-8444-444444444444";
const PRIVATE_PARENT_ID = "55555555-5555-4555-8555-555555555555";
const PRIVATE_REPLY_ID = "66666666-6666-4666-8666-666666666666";
const CREATED = new Date("2026-10-19T12:00:00.000Z");

const testState = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof createFakeDb>,
  viewerUserId: null as string | null,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!testState.viewerUserId || req.headers["authorization"] !== "Bearer test-token") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = testState.viewerUserId;
    next();
  },
}));

vi.mock("../../lib/live-ws", async (importOriginal) => {
  const actual = await importOriginal<any>().catch(() => ({}));
  return {
    ...actual,
    verifyAccessToken: async (token: string) =>
      token === "test-token" && testState.viewerUserId
        ? { userId: testState.viewerUserId }
        : null,
  };
});

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
  const fake = createFakeDb(
    {
      profiles: actual.creatorProfilesTable,
      posts: actual.postsTable,
      reactions: actual.reactionsTable,
      saves: actual.savesTable,
      follows: actual.followsTable,
      closeFriends: actual.closeFriendsTable,
      pollOptions: actual.pollOptionsTable,
      pollVotes: actual.pollVotesTable,
    },
    { reactions: [["userId", "targetKind", "targetId"]] },
  );
  testState.fake = fake;
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
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function postRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    profileId: AUTHOR_PROFILE,
    body: "post",
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
    createdAt: CREATED,
    ...over,
  };
}

function seed() {
  const fake = testState.fake!;
  fake.seed("profiles", [
    { id: AUTHOR_PROFILE, userId: AUTHOR_USER, slug: "hall-host", displayName: "Hall Host", avatarUrl: null, isVerified: false },
  ]);
  fake.seed("posts", [
    postRow({ id: PARENT_ID, body: "Board opener", replyCount: 1 }),
    postRow({ id: REPLY_ID, body: "First answer", kind: "thread_reply", replyTo: PARENT_ID, replyCount: 1 }),
    postRow({ id: NESTED_ID, body: "Answer to the answer", kind: "thread_reply", replyTo: REPLY_ID }),
    postRow({ id: PRIVATE_PARENT_ID, body: "Followers only", audience: "followers", replyCount: 1 }),
    postRow({ id: PRIVATE_REPLY_ID, body: "Insider answer", kind: "thread_reply", replyTo: PRIVATE_PARENT_ID }),
  ]);
}

beforeEach(() => {
  testState.fake!.clear();
  testState.viewerUserId = null;
  seed();
});

function as(userId: string | null) {
  testState.viewerUserId = userId;
}

async function req(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (testState.viewerUserId) headers["Authorization"] = "Bearer test-token";
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function replyDto(parentId: string, replyId: string) {
  const { status, json } = await req("GET", `/posts/${parentId}/replies`);
  expect(status).toBe(200);
  const reply = (json.replies as any[]).find((r) => r.id === replyId);
  expect(reply, `reply ${replyId} in DTO`).toBeTruthy();
  return reply;
}

function likeCountOf(postId: string): number {
  const row = testState.fake!.store("posts").rows.find((r) => r["id"] === postId);
  return Number(row?.["likeCount"] ?? 0);
}

describe("reactions on a thread reply (target_kind 'post', reply id)", () => {
  it("toggles on and reads back through the replies DTO — counts for everyone, viewer state only for the reactor", async () => {
    as(FAN_USER);
    const on = await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "like" });
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ ok: true, emoji: "like" });
    expect(likeCountOf(REPLY_ID)).toBe(1);

    const mine = await replyDto(PARENT_ID, REPLY_ID);
    expect(mine.reaction_counts).toEqual({ like: 1 });
    expect(mine.viewer_emoji).toBe("like");

    as(AUTHOR_USER);
    const others = await replyDto(PARENT_ID, REPLY_ID);
    expect(others.reaction_counts).toEqual({ like: 1 });
    expect(others.viewer_emoji).toBeNull();

    as(null);
    const guest = await replyDto(PARENT_ID, REPLY_ID);
    expect(guest.reaction_counts).toEqual({ like: 1 });
    expect(guest.viewer_emoji).toBeNull();
  });

  it("re-posting the same emoji is an unchanged no-op, never a double count", async () => {
    as(FAN_USER);
    await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "fire" });
    const again = await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "fire" });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, unchanged: true });
    const dto = await replyDto(PARENT_ID, REPLY_ID);
    expect(dto.reaction_counts).toEqual({ fire: 1 });
  });

  it("switching emoji moves the count and restores the reply's like_count", async () => {
    as(FAN_USER);
    await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "like" });
    expect(likeCountOf(REPLY_ID)).toBe(1);
    const swap = await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "fire" });
    expect(swap.status).toBe(200);
    const dto = await replyDto(PARENT_ID, REPLY_ID);
    expect(dto.reaction_counts).toEqual({ fire: 1 });
    expect(dto.viewer_emoji).toBe("fire");
    expect(likeCountOf(REPLY_ID)).toBe(0);
  });

  it("DELETE removes the reaction — counts empty out, never fake-zero", async () => {
    as(FAN_USER);
    await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "like" });
    const off = await req("DELETE", `/react?target_kind=post&target_id=${REPLY_ID}`);
    expect(off.status).toBe(200);
    const dto = await replyDto(PARENT_ID, REPLY_ID);
    expect(dto.reaction_counts).toEqual({});
    expect(dto.viewer_emoji).toBeNull();
    /* The GREATEST floor: like_count returns to 0, never negative. */
    expect(likeCountOf(REPLY_ID)).toBe(0);
    /* Removing again is a quiet no-op, not an error. */
    const offAgain = await req("DELETE", `/react?target_kind=post&target_id=${REPLY_ID}`);
    expect(offAgain.status).toBe(200);
    const rows = testState.fake!.store("reactions").rows;
    expect(rows).toEqual([]);
  });

  it("works at nesting depth 2 — a reply's own replies carry reactions too", async () => {
    as(FAN_USER);
    const on = await req("POST", "/react", { target_kind: "post", target_id: NESTED_ID, emoji: "clap" });
    expect(on.status).toBe(200);
    const dto = await replyDto(REPLY_ID, NESTED_ID);
    expect(dto.kind).toBe("thread_reply");
    expect(dto.reaction_counts).toEqual({ clap: 1 });
    expect(dto.viewer_emoji).toBe("clap");
  });
});

describe("guests at the reaction rail", () => {
  it("cannot POST or DELETE a reaction (401), members-only", async () => {
    as(null);
    const post = await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "like" });
    expect(post.status).toBe(401);
    const del = await req("DELETE", `/react?target_kind=post&target_id=${REPLY_ID}`);
    expect(del.status).toBe(401);
    const dto = await replyDto(PARENT_ID, REPLY_ID);
    expect(dto.reaction_counts).toEqual({});
  });
});

describe("the closed contract", () => {
  it("refuses an emoji outside the server's set and a 'reply' target kind — replies ride 'post'", async () => {
    as(FAN_USER);
    const badEmoji = await req("POST", "/react", { target_kind: "post", target_id: REPLY_ID, emoji: "wow" });
    expect(badEmoji.status).toBe(400);
    const badKind = await req("POST", "/react", { target_kind: "reply", target_id: REPLY_ID, emoji: "like" });
    expect(badKind.status).toBe(400);
    const badId = await req("POST", "/react", { target_kind: "post", target_id: "not-a-uuid", emoji: "like" });
    expect(badId.status).toBe(400);
  });
});

describe("visibility — reactions never leak a thread the viewer can't read", () => {
  it("replies under a followers-only parent 404 for strangers; a follower reads and reacts", async () => {
    as(STRANGER_USER);
    const hidden = await req("GET", `/posts/${PRIVATE_PARENT_ID}/replies`);
    expect(hidden.status).toBe(404);

    /* The author reacts to their own insider reply; the stranger's
       read still 404s — the reaction changes nothing about who can
       see the thread. */
    as(AUTHOR_USER);
    await req("POST", "/react", { target_kind: "post", target_id: PRIVATE_REPLY_ID, emoji: "like" });
    as(STRANGER_USER);
    const stillHidden = await req("GET", `/posts/${PRIVATE_PARENT_ID}/replies`);
    expect(stillHidden.status).toBe(404);

    /* Follow the author and the thread — with its counts — opens. */
    testState.fake!.seed("follows", [{ followerUserId: STRANGER_USER, profileId: AUTHOR_PROFILE, createdAt: CREATED }]);
    const dto = await replyDto(PRIVATE_PARENT_ID, PRIVATE_REPLY_ID);
    expect(dto.reaction_counts).toEqual({ like: 1 });
    expect(dto.viewer_emoji).toBeNull();
  });
});
