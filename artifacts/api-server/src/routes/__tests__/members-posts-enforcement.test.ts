/**
 * Members-only feed posts (Wave 4 #33) — read-time enforcement.
 *
 * THE failure mode is a leak: a non-member must NEVER receive a
 * members post's body, media, poll or quote embed — on ANY surface.
 * What they receive instead is the locked teaser (the post exists,
 * it's members-only, which tier opens it, the join door).
 *
 * One author with a two-tier fan club (Bronze < Gold), one members
 * post open to any member, one gated to Gold-and-up, viewers:
 * author / Bronze member / Gold member / lapsed Gold member /
 * trialing Bronze member / follower with no membership / outsider.
 *
 * Surfaces: GET /feed (chrono + foryou) · GET /posts/:id ·
 * GET /posts/:id/replies (+ POST reply) · GET /hashtag/:tag/posts ·
 * GET /saves/mine · quote embeds · POST /posts (create validation) ·
 * POST /posts/:id/repost · POST /posts/:id/quote.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-1111111111a1";
const MEMBER_LOW = "00000000-0000-4000-8000-0000000000b1";
const MEMBER_LOW_PROFILE = "11111111-1111-4111-8111-1111111111b1";
const MEMBER_HIGH = "00000000-0000-4000-8000-0000000000c1";
const MEMBER_HIGH_PROFILE = "11111111-1111-4111-8111-1111111111c1";
const LAPSED = "00000000-0000-4000-8000-0000000000d1";
const TRIAL = "00000000-0000-4000-8000-0000000000e1";
const OUTSIDER = "00000000-0000-4000-8000-0000000000f1";
const OUTSIDER_PROFILE = "11111111-1111-4111-8111-1111111111f1";
const FOLLOWER = "00000000-0000-4000-8000-0000000000a2";
const FOLLOWER_PROFILE = "11111111-1111-4111-8111-1111111111a2";
const OTHER_CREATOR = "00000000-0000-4000-8000-0000000000b2";

const TIER_LOW = "44444444-4444-4444-8444-444444444401";
const TIER_HIGH = "44444444-4444-4444-8444-444444444402";
const OTHER_TIER = "44444444-4444-4444-8444-444444444403";
const GHOST_TIER = "99999999-9999-4999-8999-999999999999";

const MEMBERS_ANY = "22222222-2222-4222-8222-222222222201";
const MEMBERS_HIGH = "22222222-2222-4222-8222-222222222202";
const PUB_POST = "22222222-2222-4222-8222-222222222203";
const MEMBERS_REMOVED = "22222222-2222-4222-8222-222222222204";
const QUOTE_ANY = "22222222-2222-4222-8222-222222222205";
const QUOTE_HIGH = "22222222-2222-4222-8222-222222222206";

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
  buildChargeIdempotencyKey: () => "k",
  voidChargeIdempotencyKey: async () => undefined,
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
    fanTiers: actual.fanTiersTable,
    fanMembers: actual.fanMembersTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import router from "../social";
import { evaluateMemberPost } from "../../lib/close-friends";

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

const NOW = new Date("2026-10-24T12:00:00Z");
const FUTURE = new Date("2027-06-01T00:00:00Z");

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
    minTierId: null,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    createdAt: NOW,
    removedAt: null,
    removedByEmail: null,
    removalReason: null,
    removalNote: null,
    ...over,
  };
}

function memberRow(fanUserId: string, tierId: string, over: Record<string, unknown> = {}) {
  return {
    id: `55555555-5555-4555-8555-${fanUserId.slice(-12)}`,
    user_id: AUTHOR,
    tier_id: tierId,
    fan_label: fanUserId,
    fan_user_id: fanUserId,
    status: "active",
    price_cents: 500,
    external_ref: null,
    billing_period: "monthly",
    current_period_start: NOW,
    current_period_end: FUTURE,
    trial_ends_at: null,
    stripe_session_id: null,
    settled_payout_id: null,
    settled_at: null,
    is_gift: false,
    gifted_by_user_id: null,
    joined_at: NOW,
    canceled_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

beforeEach(() => {
  h.fake.clear();
  h.fake.seed("creatorProfiles", [
    { id: AUTHOR_PROFILE, userId: AUTHOR, slug: "author", displayName: "Author", avatarUrl: null, isVerified: false },
    { id: MEMBER_LOW_PROFILE, userId: MEMBER_LOW, slug: "bronze", displayName: "Bronze Fan", avatarUrl: null, isVerified: false },
    { id: MEMBER_HIGH_PROFILE, userId: MEMBER_HIGH, slug: "gold", displayName: "Gold Fan", avatarUrl: null, isVerified: false },
    { id: FOLLOWER_PROFILE, userId: FOLLOWER, slug: "fan", displayName: "Fan", avatarUrl: null, isVerified: false },
    /* The outsider HAS a profile — so on write surfaces it is the
       post's visibility gate, not the no-profile check, that refuses. */
    { id: OUTSIDER_PROFILE, userId: OUTSIDER, slug: "outsider", displayName: "Outsider", avatarUrl: null, isVerified: false },
  ]);
  h.fake.seed("fanTiers", [
    { id: TIER_LOW, user_id: AUTHOR, name: "Bronze", price_cents: 500, description: "", perks: [], sort_order: 0, trial_enabled: false, annual_discount_pct: 0, is_active: "true", created_at: NOW, updated_at: NOW },
    { id: TIER_HIGH, user_id: AUTHOR, name: "Gold", price_cents: 1500, description: "", perks: [], sort_order: 1, trial_enabled: false, annual_discount_pct: 0, is_active: "true", created_at: NOW, updated_at: NOW },
    { id: OTHER_TIER, user_id: OTHER_CREATOR, name: "Theirs", price_cents: 500, description: "", perks: [], sort_order: 0, trial_enabled: false, annual_discount_pct: 0, is_active: "true", created_at: NOW, updated_at: NOW },
  ]);
  h.fake.seed("fanMembers", [
    memberRow(MEMBER_LOW, TIER_LOW),
    memberRow(MEMBER_HIGH, TIER_HIGH),
    memberRow(LAPSED, TIER_HIGH, { status: "canceled", canceled_at: NOW }),
    memberRow(TRIAL, TIER_LOW, { status: "trialing", trial_ends_at: FUTURE, current_period_end: null }),
  ]);
  h.fake.seed("posts", [
    postRow(MEMBERS_ANY, {
      body: "any member secret #memberspost",
      audience: "members",
      mediaUrls: [{ kind: "image", url: "https://cdn.example.com/secret.jpg" }],
    }),
    postRow(MEMBERS_HIGH, { body: "gold tier secret", audience: "members", minTierId: TIER_HIGH }),
    postRow(PUB_POST, { body: "for everyone #memberspost" }),
    postRow(MEMBERS_REMOVED, {
      body: "removed secret",
      audience: "members",
      removedAt: NOW,
      removalReason: "spam",
    }),
    postRow(QUOTE_ANY, { body: "quoting the members post", kind: "quote", quoteOf: MEMBERS_ANY, profileId: FOLLOWER_PROFILE }),
    postRow(QUOTE_HIGH, { body: "quoting the gold post", kind: "quote", quoteOf: MEMBERS_HIGH, profileId: MEMBER_HIGH_PROFILE }),
  ]);
  h.fake.seed("pollOptions", [
    { id: "66666666-6666-4666-8666-666666666601", postId: MEMBERS_HIGH, optionText: "secret option A", position: 0, voteCount: 3 },
    { id: "66666666-6666-4666-8666-666666666602", postId: MEMBERS_HIGH, optionText: "secret option B", position: 1, voteCount: 1 },
  ]);
  h.fake.seed("follows", [{ followerUserId: FOLLOWER, profileId: AUTHOR_PROFILE, createdAt: NOW }]);
  // A non-member saved the any-member post; a Gold member saved the Gold post.
  h.fake.seed("saves", [
    { userId: OUTSIDER, kind: "post", targetId: MEMBERS_ANY, createdAt: NOW },
    { userId: MEMBER_HIGH, kind: "post", targetId: MEMBERS_HIGH, createdAt: NOW },
  ]);
});

const feedPost = (json: any, id: string) => (json.posts ?? []).find((p: any) => p.id === id);

function expectTeaser(p: any, status: string) {
  expect(p, "post should be present as a teaser").toBeTruthy();
  expect(p.body).toBe("");
  expect(p.media_urls).toEqual([]);
  expect(p.poll).toBeNull();
  expect(p.quoted).toBeNull();
  expect(p.member_lock).toBeTruthy();
  expect(p.member_lock.viewer_status).toBe(status);
  expect(p.member_lock.join_url).toBe(`/memberships?creator=${AUTHOR}`);
}

function expectFull(p: any, body: string) {
  expect(p, "post should be present in full").toBeTruthy();
  expect(p.body).toBe(body);
  expect(p.member_lock).toBeNull();
}

describe("feed surfaces — teaser vs full", () => {
  it("chrono feed: outsider gets locked teasers (never the words), members get their posts in full", async () => {
    const outsider = await call("GET", "/feed", { user: OUTSIDER });
    expectTeaser(feedPost(outsider.json, MEMBERS_ANY), "not_member");
    const high = feedPost(outsider.json, MEMBERS_HIGH);
    expectTeaser(high, "not_member");
    expect(high.member_lock.required_tier?.name).toBe("Gold");
    expect(high.min_tier?.name).toBe("Gold");
    expectFull(feedPost(outsider.json, PUB_POST), "for everyone #memberspost");
    // The media URL is content — it must not appear anywhere in the payload.
    expect(JSON.stringify(outsider.json)).not.toContain("secret.jpg");
    expect(JSON.stringify(outsider.json)).not.toContain("any member secret");
    expect(JSON.stringify(outsider.json)).not.toContain("gold tier secret");
    expect(JSON.stringify(outsider.json)).not.toContain("secret option");

    const low = await call("GET", "/feed", { user: MEMBER_LOW });
    const anyFull = feedPost(low.json, MEMBERS_ANY);
    expectFull(anyFull, "any member secret #memberspost");
    expect(anyFull.media_urls?.[0]?.url).toBe("https://cdn.example.com/secret.jpg");
    const lowHigh = feedPost(low.json, MEMBERS_HIGH);
    expectTeaser(lowHigh, "below_tier");
    expect(lowHigh.member_lock.viewer_tier?.name).toBe("Bronze");
    expect(lowHigh.member_lock.required_tier?.name).toBe("Gold");

    const gold = await call("GET", "/feed", { user: MEMBER_HIGH });
    expectFull(feedPost(gold.json, MEMBERS_ANY), "any member secret #memberspost");
    const goldFull = feedPost(gold.json, MEMBERS_HIGH);
    expectFull(goldFull, "gold tier secret");
    expect(goldFull.poll?.options?.map((o: any) => o.option_text)).toEqual(["secret option A", "secret option B"]);

    const author = await call("GET", "/feed", { user: AUTHOR });
    expectFull(feedPost(author.json, MEMBERS_ANY), "any member secret #memberspost");
    expectFull(feedPost(author.json, MEMBERS_HIGH), "gold tier secret");
  });

  it("lapsed member reads as lapsed (not as a stranger, not as a member); a trialing member reads in full", async () => {
    const lapsed = await call("GET", "/feed", { user: LAPSED });
    expectTeaser(feedPost(lapsed.json, MEMBERS_ANY), "lapsed");
    expectTeaser(feedPost(lapsed.json, MEMBERS_HIGH), "lapsed");
    const trial = await call("GET", "/feed", { user: TRIAL });
    expectFull(feedPost(trial.json, MEMBERS_ANY), "any member secret #memberspost");
  });

  it("for-you feed: same enforcement", async () => {
    const outsider = await call("GET", "/feed?mode=foryou", { user: OUTSIDER });
    expectTeaser(feedPost(outsider.json, MEMBERS_ANY), "not_member");
    expect(JSON.stringify(outsider.json)).not.toContain("gold tier secret");
    const gold = await call("GET", "/feed?mode=foryou", { user: MEMBER_HIGH });
    expectFull(feedPost(gold.json, MEMBERS_HIGH), "gold tier secret");
  });

  it("a removed members post leaves every list — even for members and the author", async () => {
    for (const u of [OUTSIDER, MEMBER_HIGH, AUTHOR]) {
      const feed = await call("GET", "/feed", { user: u });
      expect(feedPost(feed.json, MEMBERS_REMOVED)).toBeUndefined();
    }
  });
});

describe("single post — direct link", () => {
  it("anonymous and non-members get the teaser with a 200; qualifying members and the author get the content", async () => {
    const anon = await call("GET", `/posts/${MEMBERS_ANY}`);
    expect(anon.status).toBe(200);
    expectTeaser(anon.json.post, "not_member");

    const outsider = await call("GET", `/posts/${MEMBERS_HIGH}`, { bearer: OUTSIDER });
    expect(outsider.status).toBe(200);
    expectTeaser(outsider.json.post, "not_member");
    expect(outsider.json.post.member_lock.required_tier?.name).toBe("Gold");

    const low = await call("GET", `/posts/${MEMBERS_HIGH}`, { bearer: MEMBER_LOW });
    expectTeaser(low.json.post, "below_tier");

    const gold = await call("GET", `/posts/${MEMBERS_HIGH}`, { bearer: MEMBER_HIGH });
    expect(gold.status).toBe(200);
    expectFull(gold.json.post, "gold tier secret");
    expect(gold.json.post.poll).toBeTruthy();

    const author = await call("GET", `/posts/${MEMBERS_ANY}`, { bearer: AUTHOR });
    expectFull(author.json.post, "any member secret #memberspost");
  });

  it("a removed members post is a 404 to everyone but its author (removal law beats the teaser)", async () => {
    expect((await call("GET", `/posts/${MEMBERS_REMOVED}`)).status).toBe(404);
    expect((await call("GET", `/posts/${MEMBERS_REMOVED}`, { bearer: MEMBER_HIGH })).status).toBe(404);
    const author = await call("GET", `/posts/${MEMBERS_REMOVED}`, { bearer: AUTHOR });
    expect(author.status).toBe(200);
    expect(author.json.post.moderation_removed).toBe(true);
    expect(author.json.post.body).toBe("removed secret");
  });
});

describe("replies — the thread is content too", () => {
  it("non-members cannot read or write replies under a members post; members can", async () => {
    expect((await call("GET", `/posts/${MEMBERS_ANY}/replies`, { bearer: OUTSIDER })).status).toBe(404);
    expect((await call("GET", `/posts/${MEMBERS_ANY}/replies`, { bearer: MEMBER_LOW })).status).toBe(200);
    const write = await call("POST", `/posts/${MEMBERS_ANY}/reply`, { user: OUTSIDER, body: { body: "let me in" } });
    expect(write.status).toBe(404);
    const memberWrite = await call("POST", `/posts/${MEMBERS_ANY}/reply`, { user: MEMBER_LOW, body: { body: "member reply" } });
    expect(memberWrite.status).toBe(201);
  });
});

describe("hashtag + saves surfaces", () => {
  it("hashtag page: the members post shows as a teaser to non-members, full to members", async () => {
    const outsider = await call("GET", "/hashtag/memberspost/posts", { bearer: OUTSIDER });
    expectTeaser(feedPost(outsider.json, MEMBERS_ANY), "not_member");
    expectFull(feedPost(outsider.json, PUB_POST), "for everyone #memberspost");
    const member = await call("GET", "/hashtag/memberspost/posts", { bearer: MEMBER_LOW });
    expectFull(feedPost(member.json, MEMBERS_ANY), "any member secret #memberspost");
  });

  it("saves: a saved members post renders as a teaser once the saver doesn't qualify — and in full when they do", async () => {
    const outsider = await call("GET", "/saves/mine", { user: OUTSIDER });
    const entry = (outsider.json.saves ?? []).find((s: any) => s.target_id === MEMBERS_ANY);
    expect(entry).toBeTruthy();
    expectTeaser(entry.post, "not_member");
    const gold = await call("GET", "/saves/mine", { user: MEMBER_HIGH });
    const goldEntry = (gold.json.saves ?? []).find((s: any) => s.target_id === MEMBERS_HIGH);
    expect(goldEntry).toBeTruthy();
    expectFull(goldEntry.post, "gold tier secret");
  });
});

describe("quote embeds inherit the gate", () => {
  it("a public quote of a members post embeds the teaser for non-members and the post for members", async () => {
    const outsider = await call("GET", "/feed", { user: OUTSIDER });
    const q = feedPost(outsider.json, QUOTE_ANY);
    expect(q).toBeTruthy();
    expect(q.body).toBe("quoting the members post"); // the quoter's own words are theirs
    expectTeaser(q.quoted, "not_member");

    const member = await call("GET", "/feed", { user: MEMBER_LOW });
    const q2 = feedPost(member.json, QUOTE_ANY);
    expectFull(q2.quoted, "any member secret #memberspost");

    const single = await call("GET", `/posts/${QUOTE_HIGH}`, { bearer: OUTSIDER });
    expect(single.status).toBe(200);
    expectTeaser(single.json.post.quoted, "not_member");
    const singleGold = await call("GET", `/posts/${QUOTE_HIGH}`, { bearer: MEMBER_HIGH });
    expectFull(singleGold.json.post.quoted, "gold tier secret");
  });
});

describe("create — the floor tier must be the author's own", () => {
  it("members post without a floor is open to any member; with a floor it names the tier", async () => {
    const anyRes = await call("POST", "/posts", { user: AUTHOR, body: { body: "fresh members post", audience: "members" } });
    expect(anyRes.status).toBe(201);
    expect(anyRes.json.post.audience).toBe("members");
    expect(anyRes.json.post.min_tier_id).toBeNull();
    expect(anyRes.json.post.member_lock).toBeNull();
    // …and a stranger reading it back gets the teaser, not the words.
    const stranger = await call("GET", `/posts/${anyRes.json.post.id}`);
    expectTeaser(stranger.json.post, "not_member");

    const goldRes = await call("POST", "/posts", { user: AUTHOR, body: { body: "fresh gold post", audience: "members", min_tier_id: TIER_HIGH } });
    expect(goldRes.status).toBe(201);
    expect(goldRes.json.post.min_tier_id).toBe(TIER_HIGH);
    expect(goldRes.json.post.min_tier?.name).toBe("Gold");
    const low = await call("GET", `/posts/${goldRes.json.post.id}`, { bearer: MEMBER_LOW });
    expectTeaser(low.json.post, "below_tier");
  });

  it("another creator's tier, a ghost tier, and someone else's club all refuse with bad_min_tier", async () => {
    const theirs = await call("POST", "/posts", { user: AUTHOR, body: { body: "x", audience: "members", min_tier_id: OTHER_TIER } });
    expect(theirs.status).toBe(400);
    expect(theirs.json.error).toBe("bad_min_tier");
    const ghost = await call("POST", "/posts", { user: AUTHOR, body: { body: "x", audience: "members", min_tier_id: GHOST_TIER } });
    expect(ghost.status).toBe(400);
    expect(ghost.json.error).toBe("bad_min_tier");
    const notMine = await call("POST", "/posts", { user: MEMBER_LOW, body: { body: "x", audience: "members", min_tier_id: TIER_LOW } });
    expect(notMine.status).toBe(400);
    expect(notMine.json.error).toBe("bad_min_tier");
  });

  it("a floor sent with a public audience is not stored", async () => {
    const res = await call("POST", "/posts", { user: AUTHOR, body: { body: "public with tier", audience: "public", min_tier_id: TIER_HIGH } });
    expect(res.status).toBe(201);
    expect(res.json.post.min_tier_id).toBeNull();
    const read = await call("GET", `/posts/${res.json.post.id}`);
    expect(read.status).toBe(200);
    expectFull(read.json.post, "public with tier");
  });
});

describe("share verbs — a members post stays in the club", () => {
  it("repost refuses members posts even for a qualifying member; non-members get the 404", async () => {
    const member = await call("POST", `/posts/${MEMBERS_ANY}/repost`, { user: MEMBER_HIGH });
    expect(member.status).toBe(400);
    expect(member.json.error).toBe("members_only");
    const outsider = await call("POST", `/posts/${MEMBERS_ANY}/repost`, { user: OUTSIDER });
    expect(outsider.status).toBe(404);
  });

  it("quote writes need full access: outsiders and below-tier members get the 404, qualifying members may quote", async () => {
    expect((await call("POST", `/posts/${MEMBERS_ANY}/quote`, { user: OUTSIDER, body: { body: "my take" } })).status).toBe(404);
    expect((await call("POST", `/posts/${MEMBERS_HIGH}/quote`, { user: MEMBER_LOW, body: { body: "my take" } })).status).toBe(404);
    const ok = await call("POST", `/posts/${MEMBERS_ANY}/quote`, { user: MEMBER_LOW, body: { body: "member take" } });
    expect(ok.status).toBe(201);
  });
});

describe("evaluateMemberPost — the any-member floor (pure)", () => {
  const tiers = [
    { id: TIER_LOW, name: "Bronze", sort_order: 0, created_at: NOW },
    { id: TIER_HIGH, name: "Gold", sort_order: 1, created_at: NOW },
  ];
  const member = (tier_id: string, status: string) => ({
    tier_id,
    status,
    fan_user_id: "someone",
    trial_ends_at: null,
    current_period_end: FUTURE,
  });

  it("no membership rows → not_member; only lapsed rows → lapsed; an admitting row at any tier → access", () => {
    expect(evaluateMemberPost({ tiers, members: [] }, null).viewerStatus).toBe("not_member");
    expect(evaluateMemberPost({ tiers, members: [member(TIER_HIGH, "canceled")] }, null).viewerStatus).toBe("lapsed");
    const ok = evaluateMemberPost({ tiers, members: [member(TIER_LOW, "active")] }, null);
    expect(ok.hasAccess).toBe(true);
    expect(ok.viewerTier?.name).toBe("Bronze");
  });

  it("a named floor defers to the ladder: below-tier is below_tier, a vanished floor fails closed", () => {
    const below = evaluateMemberPost({ tiers, members: [member(TIER_LOW, "active")] }, TIER_HIGH);
    expect(below.hasAccess).toBe(false);
    expect(below.viewerStatus).toBe("below_tier");
    expect(below.requiredTier?.name).toBe("Gold");
    const vanished = evaluateMemberPost({ tiers, members: [member(TIER_HIGH, "active")] }, GHOST_TIER);
    expect(vanished.hasAccess).toBe(false);
  });
});
