/**
 * Route tests for post reply drafts (STACK-20 R2 item #8 —
 * UPGRADE-PROGRAM 2.19, the reply-drafts bench at the Community
 * Board).
 *
 * The REAL social router runs over an ephemeral server against the
 * house cond-aware fake db (the close-friends-enforcement harness),
 * with the drafts table implemented honestly (upsert on the
 * (post, author) pair + real deletes), so the pins below are about
 * the HANDLER's behavior, not the fake's.
 *
 * Pins:
 *  - a draft saves with its tone, reads back verbatim, and a second
 *    save replaces it — still ONE row per member per post;
 *  - tone: an omitted tone defaults to "hype" on first save and is
 *    KEPT on later body-only saves; an explicit tone retunes; a tone
 *    outside the assistant's set is a 400;
 *  - saving an empty/whitespace body clears; DELETE clears (and is a
 *    calm no-op when nothing is saved);
 *  - the draft is private scratch: another member reads only their
 *    OWN (empty) slot on the same post and their save never touches
 *    mine; guests get 401; unknown posts get 404; a malformed id 400;
 *  - the post's own visibility gate governs drafts: a close-friends
 *    post is a 404 to a non-circle member on read/save/clear, while
 *    a circle member drafts on it freely;
 *  - the reply route's own 500-char cap is the draft cap (500 ok,
 *    501 refused);
 *  - a landed reply retires the SENDER's draft and only the sender's
 *    — another member's saved words on the same post survive; a
 *    FAILED send leaves the draft exactly as it was.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-1111111111a1";
const MEMBER = "00000000-0000-4000-8000-0000000000b1";
const MEMBER_PROFILE = "11111111-1111-4111-8111-1111111111b1";
const OTHER = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROFILE = "11111111-1111-4111-8111-1111111111c1";
const PUB_POST = "22222222-2222-4222-8222-2222222222a2";
const CF_POST = "22222222-2222-4222-8222-2222222222a1";
const UNKNOWN_POST = "99999999-9999-4999-8999-999999999999";

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
  const fake = createFakeDb(
    {
      creatorProfiles: actual.creatorProfilesTable,
      posts: actual.postsTable,
      postReplyDrafts: actual.postReplyDraftsTable,
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
    },
    { postReplyDrafts: [["postId", "userId"]] },
  );
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

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

const draftPath = (postId: string) => `/posts/${postId}/reply-draft`;
const draftRows = () => h.fake.store("postReplyDrafts").rows as Array<Record<string, unknown>>;

const NOW = new Date("2026-10-19T12:00:00Z");
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
    { id: MEMBER_PROFILE, userId: MEMBER, slug: "member", displayName: "Member", avatarUrl: null, isVerified: false },
    { id: OTHER_PROFILE, userId: OTHER, slug: "other", displayName: "Other", avatarUrl: null, isVerified: false },
  ]);
  h.fake.seed("posts", [
    postRow(PUB_POST, { body: "for everyone" }),
    postRow(CF_POST, { body: "circle only", audience: "close_friends" }),
  ]);
  h.fake.seed("follows", [
    { followerUserId: MEMBER, profileId: AUTHOR_PROFILE, createdAt: NOW },
    { followerUserId: OTHER, profileId: AUTHOR_PROFILE, createdAt: NOW },
  ]);
  // MEMBER is in the author's circle; OTHER follows but is NOT in it.
  h.fake.seed("closeFriends", [
    { owner_user_id: AUTHOR, owner_profile_id: AUTHOR_PROFILE, friend_user_id: MEMBER, friend_profile_id: MEMBER_PROFILE, created_at: NOW },
  ]);
});

describe("post reply drafts — save, read, replace", () => {
  it("a draft saves with its tone and reads back verbatim; a second save replaces it — still one row", async () => {
    const put = await call("PUT", draftPath(PUB_POST), {
      user: MEMBER,
      body: { body: "half a thought", tone: "playful" },
    });
    expect(put.status).toBe(200);
    expect(put.json.draft.body).toBe("half a thought");
    expect(put.json.draft.tone).toBe("playful");
    expect(put.json.draft.updated_at).toBeTruthy();

    const got = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(got.status).toBe(200);
    expect(got.json.draft.body).toBe("half a thought");
    expect(got.json.draft.tone).toBe("playful");

    const put2 = await call("PUT", draftPath(PUB_POST), {
      user: MEMBER,
      body: { body: "a better thought", tone: "grateful" },
    });
    expect(put2.status).toBe(200);
    expect(draftRows()).toHaveLength(1);
    const got2 = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(got2.json.draft.body).toBe("a better thought");
    expect(got2.json.draft.tone).toBe("grateful");
  });

  it("no saved draft reads as null, not an error", async () => {
    const got = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(got.status).toBe(200);
    expect(got.json.draft).toBeNull();
  });

  it("an omitted tone defaults to hype on first save and is kept on body-only saves; a bad tone is a 400", async () => {
    const first = await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "one" } });
    expect(first.json.draft.tone).toBe("hype");
    await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "one", tone: "professional" } });
    const kept = await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "two" } });
    expect(kept.json.draft.body).toBe("two");
    expect(kept.json.draft.tone).toBe("professional");
    const bad = await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "x", tone: "sarcastic" } });
    expect(bad.status).toBe(400);
    const got = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(got.json.draft.body).toBe("two");
  });

  it("the cap is the reply route's own 500: 500 saves, 501 is refused and changes nothing", async () => {
    const ok = await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "x".repeat(500) } });
    expect(ok.status).toBe(200);
    const tooLong = await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "x".repeat(501) } });
    expect(tooLong.status).toBe(400);
    const got = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(got.json.draft.body).toHaveLength(500);
  });
});

describe("post reply drafts — clearing", () => {
  it("saving an empty or whitespace body clears; DELETE clears and is a calm no-op when nothing is saved", async () => {
    await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "words" } });
    const blanked = await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "   " } });
    expect(blanked.json.draft).toBeNull();
    expect(draftRows()).toHaveLength(0);

    await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "words again" } });
    const del = await call("DELETE", draftPath(PUB_POST), { user: MEMBER });
    expect(del.status).toBe(200);
    expect(del.json.ok).toBe(true);
    expect(draftRows()).toHaveLength(0);
    const delAgain = await call("DELETE", draftPath(PUB_POST), { user: MEMBER });
    expect(delAgain.status).toBe(200);
  });
});

describe("post reply drafts — privacy and gates", () => {
  it("another member reads only their own slot on the same post; their save never touches mine", async () => {
    await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "mine", tone: "hype" } });
    const otherView = await call("GET", draftPath(PUB_POST), { user: OTHER });
    expect(otherView.json.draft).toBeNull();
    await call("PUT", draftPath(PUB_POST), { user: OTHER, body: { body: "theirs", tone: "playful" } });
    expect(draftRows()).toHaveLength(2);
    const myView = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(myView.json.draft.body).toBe("mine");
    const theirView = await call("GET", draftPath(PUB_POST), { user: OTHER });
    expect(theirView.json.draft.body).toBe("theirs");
  });

  it("guests get 401 on read, save and clear — and nothing is written", async () => {
    expect((await call("GET", draftPath(PUB_POST))).status).toBe(401);
    expect((await call("PUT", draftPath(PUB_POST), { body: { body: "anon" } })).status).toBe(401);
    expect((await call("DELETE", draftPath(PUB_POST))).status).toBe(401);
    expect(draftRows()).toHaveLength(0);
  });

  it("unknown posts are 404 and malformed ids are 400 on every verb", async () => {
    expect((await call("GET", draftPath(UNKNOWN_POST), { user: MEMBER })).status).toBe(404);
    expect((await call("PUT", draftPath(UNKNOWN_POST), { user: MEMBER, body: { body: "x" } })).status).toBe(404);
    expect((await call("DELETE", draftPath(UNKNOWN_POST), { user: MEMBER })).status).toBe(404);
    expect((await call("GET", draftPath("not-a-uuid"), { user: MEMBER })).status).toBe(400);
    expect((await call("PUT", draftPath("not-a-uuid"), { user: MEMBER, body: { body: "x" } })).status).toBe(400);
    expect(draftRows()).toHaveLength(0);
  });

  it("a close-friends post is a 404 to a non-circle member on read/save/clear; the circle member drafts freely", async () => {
    expect((await call("GET", draftPath(CF_POST), { user: OTHER })).status).toBe(404);
    expect((await call("PUT", draftPath(CF_POST), { user: OTHER, body: { body: "sneak" } })).status).toBe(404);
    expect((await call("DELETE", draftPath(CF_POST), { user: OTHER })).status).toBe(404);
    expect(draftRows()).toHaveLength(0);

    const put = await call("PUT", draftPath(CF_POST), { user: MEMBER, body: { body: "inner circle words", tone: "grateful" } });
    expect(put.status).toBe(200);
    const got = await call("GET", draftPath(CF_POST), { user: MEMBER });
    expect(got.json.draft.body).toBe("inner circle words");
  });
});

describe("post reply drafts — a landed reply retires the draft", () => {
  it("sending clears the SENDER's draft only; the other member's words on the same post survive", async () => {
    await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "about to send this" } });
    await call("PUT", draftPath(PUB_POST), { user: OTHER, body: { body: "still thinking" } });

    const sent = await call("POST", `/posts/${PUB_POST}/reply`, {
      user: MEMBER,
      body: { body: "about to send this" },
    });
    expect(sent.status).toBe(201);

    const mine = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(mine.json.draft).toBeNull();
    const theirs = await call("GET", draftPath(PUB_POST), { user: OTHER });
    expect(theirs.json.draft.body).toBe("still thinking");
    expect(draftRows()).toHaveLength(1);
  });

  it("a FAILED send leaves the draft exactly as it was", async () => {
    await call("PUT", draftPath(PUB_POST), { user: MEMBER, body: { body: "keep me" } });
    const failed = await call("POST", `/posts/${PUB_POST}/reply`, {
      user: MEMBER,
      body: { body: "   " },
    });
    expect(failed.status).toBe(400);
    const got = await call("GET", draftPath(PUB_POST), { user: MEMBER });
    expect(got.json.draft.body).toBe("keep me");
  });
});
