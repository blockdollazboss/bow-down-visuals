import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { AddressInfo } from "node:net";

/* Stack-4 — admin content-removal rail (routes/admin.ts × routes/social.ts).
 *
 * Until this rail, post/comment deletion was author-only: an admin
 * had no takedown hand at all. This suite pins the whole contract
 * against the REAL handlers on both routers, mounted together:
 *
 *  - the authorization matrix on the admin rail itself (guest 401,
 *    member 403, allowlisted admin 200, fail-closed when
 *    ADMIN_EMAILS is unset, allowlist matching case-insensitive)
 *    — the same matrix the DMCA bench pins;
 *  - the PATCH state machine: remove (reason REQUIRED, recorded
 *    with who/when) 200, remove-without-reason 400, unknown reason
 *    400, missing target 404, malformed id 400, double-remove 409,
 *    restore-of-live 409, restore 200 with the record cleared;
 *  - a member's PATCH attempt is a 403 AND the row is untouched;
 *  - the read-path proof: once removed, the item leaves the feed
 *    (for strangers AND its author), the single-post read 404s for
 *    everyone but the author, a removed reply leaves the replies
 *    read, and a removed quoted post renders quoted:null — while
 *    the AUTHOR still reads their own item with
 *    moderation_removed + the reason category attached (author
 *    honesty: never silently vanished);
 *  - comments (thread replies) ride the same rail.
 *
 * Same fake-db + module-mock kit as admin-moderation.test.ts and
 * close-friends-enforcement.test.ts: the require-auth stub keys off
 * x-test-user / x-test-email headers, live-ws verifies
 * "tok-<userId>" bearer tokens for the social router's optionalAuth
 * reads. */

const h = vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["SUPABASE_URL"] = "http://localhost";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test";
  return { fake: null as any };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    const e = req.headers["x-test-email"];
    if (e) req.userEmail = String(e);
    next();
  },
}));

vi.mock("../../lib/ai-clients", () => ({ getOpenAI: () => null, getTextModel: () => "gpt-test" }));
vi.mock("../../lib/live-ws", () => ({
  verifyAccessToken: (t: string) =>
    typeof t === "string" && t.startsWith("tok-") ? { userId: t.slice(4) } : null,
}));
vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => ({ charged: 0 }),
  refundCredits: async () => {},
  OutOfCreditsError: class extends Error {},
  LedgerWriteError: class extends Error {},
}));
vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => {},
  addAdminGrantedCredits: async () => ({ newBalance: 0 }),
  setProfilePlanTier: async () => ({ plan: "free" }),
  lookupAuthUserByEmail: async () => null,
}));
vi.mock("../../lib/payment-record", () => ({ recordCreditUsageStrict: async () => {} }));
vi.mock("../../lib/social-crypto", () => ({
  encryptToken: (t: string) => t,
  decryptToken: (t: string) => t,
  isSocialTokenKeyConfigured: () => true,
}));
vi.mock("../../lib/social-meta", () => ({
  buildAuthUrl: () => "",
  buildFacebookAuthUrl: () => "",
  exchangeCodeForLongLivedToken: async () => ({}),
  exchangeFacebookCodeForLongLivedToken: async () => ({}),
  fetchInstagramProfile: async () => ({}),
  listPages: async () => [],
  publishReelToInstagram: async () => ({}),
  publishVideoToPage: async () => ({}),
  MetaApiError: class extends Error {},
}));
vi.mock("../../lib/social-idempotency", () => ({
  claimSocialAction: async () => ({ fresh: true }),
  nonceFromRequest: () => null,
  nonceMatches: () => true,
  releaseSocialAction: async () => {},
  reuseSocialResult: async () => null,
}));
vi.mock("../../lib/social-tiktok", () => ({
  buildTikTokAuthUrl: () => "",
  exchangeTikTokCode: async () => ({}),
  fetchTikTokProfile: async () => ({}),
  publishVideoToTikTok: async () => ({}),
  TikTokApiError: class extends Error {},
  isTikTokConfigured: () => false,
}));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: (u: any) => u,
  refreshSupabaseStorageUrlsDeep: (v: any) => v,
  isStorageRef: () => false,
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: async (u: string) => u }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    posts: actual.postsTable,
    creatorProfiles: actual.creatorProfilesTable,
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
    stories: actual.storiesTable,
    storyHighlights: actual.storyHighlightsTable,
    artistVaults: actual.artistVaultsTable,
    spotlightInquiries: actual.spotlightInquiriesTable,
    contactMessages: actual.contactMessagesTable,
    dmcaReports: actual.dmcaReportsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import adminRouter from "../admin";
import socialRouter from "../social";

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {}, warn: () => {} }; next(); });
  app.use("/api", adminRouter);
  app.use("/api", socialRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const ADMIN_ID = "admin-user";
const ADMIN_EMAIL = "king@example.test";
const AUTHOR = "author-user";
const MEMBER = "member-user";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-111111111111";
const MEMBER_PROFILE = "22222222-2222-4222-8222-222222222222";
const POST_TARGET = "33333333-3333-4333-8333-333333333333";
const POST_LIVE = "44444444-4444-4444-8444-444444444444";
const REPLY_TARGET = "55555555-5555-4555-8555-555555555555";
const QUOTE_POST = "66666666-6666-4666-8666-666666666666";
const MISSING_ID = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-10-20T12:00:00Z");

function postRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    profileId: AUTHOR_PROFILE,
    body: "hello world",
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
    removedAt: null,
    removedByEmail: null,
    removalReason: null,
    removalNote: null,
    ...over,
  };
}

type Opts = { user?: string; email?: string; bearer?: string; body?: unknown };
async function call(method: string, path: string, opts: Opts = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
      ...(opts.email ? { "x-test-email": opts.email } : {}),
      ...(opts.bearer ? { authorization: `Bearer tok-${opts.bearer}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json };
}
const asAdmin = { user: ADMIN_ID, email: ADMIN_EMAIL };
const asMember = { user: MEMBER, email: "member@example.test" };

beforeEach(() => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  h.fake.clear();
  h.fake.seed("creatorProfiles", [
    { id: AUTHOR_PROFILE, userId: AUTHOR, slug: "author", displayName: "Author", avatarUrl: null, isVerified: false },
    { id: MEMBER_PROFILE, userId: MEMBER, slug: "member", displayName: "Member", avatarUrl: null, isVerified: false },
  ]);
  h.fake.seed("posts", [
    postRow(POST_TARGET, { body: "spammy offer you cannot refuse" }),
    postRow(POST_LIVE, { body: "an ordinary post" }),
    postRow(REPLY_TARGET, { body: "a nasty reply", kind: "thread_reply", replyTo: POST_LIVE, profileId: MEMBER_PROFILE }),
    postRow(QUOTE_POST, { body: "look at this", kind: "quote", quoteOf: POST_TARGET, profileId: MEMBER_PROFILE }),
  ]);
});

describe("authorization matrix", () => {
  it("guest gets 401, member gets 403, allowlisted admin gets 200", async () => {
    expect((await call("GET", `/admin/content/${POST_TARGET}`)).status).toBe(401);
    expect((await call("GET", `/admin/content/${POST_TARGET}`, asMember)).status).toBe(403);
    expect((await call("GET", `/admin/content/${POST_TARGET}`, asAdmin)).status).toBe(200);
  });

  it("fails closed when ADMIN_EMAILS is unset", async () => {
    delete process.env["ADMIN_EMAILS"];
    expect((await call("GET", `/admin/content/${POST_TARGET}`, asAdmin)).status).toBe(403);
    expect((await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: true, reason: "spam" } })).status).toBe(403);
  });

  it("allowlist matching is case-insensitive", async () => {
    const up = await call("GET", `/admin/content/${POST_TARGET}`, { user: ADMIN_ID, email: ADMIN_EMAIL.toUpperCase() });
    expect(up.status).toBe(200);
  });

  it("the removed-list rail carries the same gate", async () => {
    expect((await call("GET", "/admin/content/removed")).status).toBe(401);
    expect((await call("GET", "/admin/content/removed", asMember)).status).toBe(403);
    expect((await call("GET", "/admin/content/removed", asAdmin)).status).toBe(200);
  });
});

describe("state read", () => {
  it("a live post reads back live with its author and body", async () => {
    const r = await call("GET", `/admin/content/${POST_TARGET}`, asAdmin);
    expect(r.status).toBe(200);
    expect(r.json.content.id).toBe(POST_TARGET);
    expect(r.json.content.kind).toBe("post");
    expect(r.json.content.body).toBe("spammy offer you cannot refuse");
    expect(r.json.content.author.slug).toBe("author");
    expect(r.json.content.removed).toBe(false);
    expect(r.json.content.removedAt).toBeNull();
  });

  it("a thread reply reads back as a comment", async () => {
    const r = await call("GET", `/admin/content/${REPLY_TARGET}`, asAdmin);
    expect(r.status).toBe(200);
    expect(r.json.content.kind).toBe("comment");
    expect(r.json.content.postKind).toBe("thread_reply");
    expect(r.json.content.replyTo).toBe(POST_LIVE);
  });

  it("missing target 404s and a malformed id 400s", async () => {
    expect((await call("GET", `/admin/content/${MISSING_ID}`, asAdmin)).status).toBe(404);
    expect((await call("GET", "/admin/content/not-a-uuid", asAdmin)).status).toBe(400);
  });
});

describe("the PATCH state machine", () => {
  it("remove with a reason records who, when and why", async () => {
    const r = await call("PATCH", `/admin/content/${POST_TARGET}`, {
      ...asAdmin,
      body: { removed: true, reason: "spam", note: "third strike this week" },
    });
    expect(r.status).toBe(200);
    expect(r.json.content.removed).toBe(true);
    expect(r.json.content.removalReason).toBe("spam");
    expect(r.json.content.removalNote).toBe("third strike this week");
    expect(r.json.content.removedByEmail).toBe(ADMIN_EMAIL);
    expect(r.json.content.removedAt).toBeTruthy();
    // The record stands on re-read, and the item lands on the removal list.
    const again = await call("GET", `/admin/content/${POST_TARGET}`, asAdmin);
    expect(again.json.content.removed).toBe(true);
    expect(again.json.content.removalReason).toBe("spam");
    const list = await call("GET", "/admin/content/removed", asAdmin);
    expect((list.json.content ?? []).map((c: any) => c.id)).toContain(POST_TARGET);
    // Nothing was deleted: the body is still on the record.
    expect(again.json.content.body).toBe("spammy offer you cannot refuse");
  });

  it("removing without a reason is a 400 and changes nothing", async () => {
    const r = await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: true } });
    expect(r.status).toBe(400);
    const state = await call("GET", `/admin/content/${POST_TARGET}`, asAdmin);
    expect(state.json.content.removed).toBe(false);
  });

  it("an unknown reason category is a 400", async () => {
    const r = await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: true, reason: "vibes" } });
    expect(r.status).toBe(400);
  });

  it("double-remove is a 409; restore clears the record; restore-of-live is a 409", async () => {
    await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: true, reason: "harassment" } });
    const twice = await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: true, reason: "spam" } });
    expect(twice.status).toBe(409);
    const restored = await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: false } });
    expect(restored.status).toBe(200);
    expect(restored.json.content.removed).toBe(false);
    expect(restored.json.content.removedAt).toBeNull();
    expect(restored.json.content.removedByEmail).toBeNull();
    expect(restored.json.content.removalReason).toBeNull();
    expect(restored.json.content.removalNote).toBeNull();
    const again = await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: false } });
    expect(again.status).toBe(409);
  });

  it("PATCH on a missing target 404s; on a malformed id 400s", async () => {
    expect((await call("PATCH", `/admin/content/${MISSING_ID}`, { ...asAdmin, body: { removed: true, reason: "spam" } })).status).toBe(404);
    expect((await call("PATCH", "/admin/content/nope", { ...asAdmin, body: { removed: true, reason: "spam" } })).status).toBe(400);
  });

  it("a member's PATCH attempt is a 403 and the row is untouched", async () => {
    const r = await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asMember, body: { removed: true, reason: "spam" } });
    expect(r.status).toBe(403);
    const state = await call("GET", `/admin/content/${POST_TARGET}`, asAdmin);
    expect(state.json.content.removed).toBe(false);
    expect(state.json.content.removedAt).toBeNull();
  });

  it("a comment is removed through the same rail", async () => {
    const r = await call("PATCH", `/admin/content/${REPLY_TARGET}`, { ...asAdmin, body: { removed: true, reason: "harassment" } });
    expect(r.status).toBe(200);
    expect(r.json.content.kind).toBe("comment");
    expect(r.json.content.removed).toBe(true);
    expect(r.json.content.removalReason).toBe("harassment");
  });
});

describe("read-path suppression (the point of the rail)", () => {
  async function removeTarget() {
    const r = await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: true, reason: "spam" } });
    expect(r.status).toBe(200);
  }

  it("a removed post leaves the feed — for a stranger AND for its own author", async () => {
    await removeTarget();
    const member = await call("GET", "/feed", { user: MEMBER });
    expect((member.json.posts ?? []).map((p: any) => p.id)).not.toContain(POST_TARGET);
    expect((member.json.posts ?? []).map((p: any) => p.id)).toContain(POST_LIVE);
    const author = await call("GET", "/feed", { user: AUTHOR });
    expect((author.json.posts ?? []).map((p: any) => p.id)).not.toContain(POST_TARGET);
  });

  it("the single-post read 404s for everyone but the author; the author sees the moderation state", async () => {
    await removeTarget();
    expect((await call("GET", `/posts/${POST_TARGET}`)).status).toBe(404);
    expect((await call("GET", `/posts/${POST_TARGET}`, { bearer: MEMBER })).status).toBe(404);
    const own = await call("GET", `/posts/${POST_TARGET}`, { bearer: AUTHOR });
    expect(own.status).toBe(200);
    expect(own.json.post.moderation_removed).toBe(true);
    expect(own.json.post.removal_reason).toBe("spam");
    expect(own.json.post.body).toBe("spammy offer you cannot refuse");
    // The admin note and identity never ride the public DTO.
    expect(JSON.stringify(own.json.post)).not.toContain("removedByEmail");
    expect(own.json.post.removal_note).toBeUndefined();
  });

  it("a live post's DTO carries moderation_removed false and no reason", async () => {
    const own = await call("GET", `/posts/${POST_LIVE}`, { bearer: AUTHOR });
    expect(own.status).toBe(200);
    expect(own.json.post.moderation_removed).toBe(false);
    expect(own.json.post.removal_reason).toBeNull();
  });

  it("a removed reply leaves the replies read; its parent stays up", async () => {
    const before = await call("GET", `/posts/${POST_LIVE}/replies`, { bearer: MEMBER });
    expect((before.json.replies ?? []).map((p: any) => p.id)).toContain(REPLY_TARGET);
    await call("PATCH", `/admin/content/${REPLY_TARGET}`, { ...asAdmin, body: { removed: true, reason: "harassment" } });
    const after = await call("GET", `/posts/${POST_LIVE}/replies`, { bearer: MEMBER });
    expect((after.json.replies ?? []).map((p: any) => p.id)).not.toContain(REPLY_TARGET);
    const parent = await call("GET", `/posts/${POST_LIVE}`, { bearer: MEMBER });
    expect(parent.status).toBe(200);
  });

  it("a removed quoted post renders quoted:null in someone else's feed", async () => {
    await removeTarget();
    const member = await call("GET", "/feed", { user: MEMBER });
    const q = (member.json.posts ?? []).find((p: any) => p.id === QUOTE_POST);
    expect(q).toBeTruthy();
    expect(q.quoted).toBeNull();
  });

  it("restoring brings the post back to every read", async () => {
    await removeTarget();
    await call("PATCH", `/admin/content/${POST_TARGET}`, { ...asAdmin, body: { removed: false } });
    const member = await call("GET", "/feed", { user: MEMBER });
    expect((member.json.posts ?? []).map((p: any) => p.id)).toContain(POST_TARGET);
    const read = await call("GET", `/posts/${POST_TARGET}`, { bearer: MEMBER });
    expect(read.status).toBe(200);
    expect(read.json.post.moderation_removed).toBe(false);
  });
});
