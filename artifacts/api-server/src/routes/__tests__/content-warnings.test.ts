/**
 * Content warnings & sensitive-content labels (Wave 4 #40).
 *
 * THE failure mode is a leak: a labelled post's media URL must never
 * reach a client that hasn't explicitly revealed that one item — on
 * ANY surface (feed, single post, quote embeds, co-post DTOs). What
 * travels instead is the cover: the warning NAMED, the media counted,
 * nothing playable. These tests pin:
 *
 *  - the author alone sets / changes / clears a label (create + PATCH);
 *  - covered-by-default payloads for everyone but the author;
 *  - the per-item reveal door, and its refusals;
 *  - the viewer's own preference: stricter only (hide, never loosen);
 *  - composition with the members gate: a members-only sensitive post
 *    stays locked AND covered — the lock wins, the reveal stays shut;
 *  - autoplay safety is structural: no URL in the payload, nothing to
 *    autoplay.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-1111111111a1";
const FAN = "00000000-0000-4000-8000-0000000000f1";
const FAN_PROFILE = "11111111-1111-4111-8111-1111111111f1";
const MEMBER = "00000000-0000-4000-8000-0000000000b1";
const MEMBER_PROFILE = "11111111-1111-4111-8111-1111111111b1";
const OUTSIDER = "00000000-0000-4000-8000-0000000000e1";
const OUTSIDER_PROFILE = "11111111-1111-4111-8111-1111111111e1";

const TIER_LOW = "44444444-4444-4444-8444-444444444401";

const LABELLED_VIDEO = "22222222-2222-4222-8222-222222222301";
const LABELLED_IMG = "22222222-2222-4222-8222-222222222302";
const PLAIN = "22222222-2222-4222-8222-222222222303";
const TEXT_LABELLED = "22222222-2222-4222-8222-222222222304";
const MEMBERS_LABELLED = "22222222-2222-4222-8222-222222222305";
const QUOTE_OF_LABELLED = "22222222-2222-4222-8222-222222222306";

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
    contentWarningPreferences: actual.contentWarningPreferencesTable,
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
    contentWarnings: [],
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

beforeEach(() => {
  h.fake.clear();
  h.fake.seed("creatorProfiles", [
    { id: AUTHOR_PROFILE, userId: AUTHOR, slug: "author", displayName: "Author", avatarUrl: null, isVerified: false },
    { id: FAN_PROFILE, userId: FAN, slug: "fan", displayName: "Fan", avatarUrl: null, isVerified: false },
    { id: MEMBER_PROFILE, userId: MEMBER, slug: "member", displayName: "Member", avatarUrl: null, isVerified: false },
    { id: OUTSIDER_PROFILE, userId: OUTSIDER, slug: "outsider", displayName: "Outsider", avatarUrl: null, isVerified: false },
  ]);
  h.fake.seed("fanTiers", [
    { id: TIER_LOW, user_id: AUTHOR, name: "Bronze", price_cents: 500, description: "", perks: [], sort_order: 0, trial_enabled: false, annual_discount_pct: 0, is_active: "true", created_at: NOW, updated_at: NOW },
  ]);
  h.fake.seed("fanMembers", [{
    id: "55555555-5555-4555-8555-555555555501",
    user_id: AUTHOR,
    tier_id: TIER_LOW,
    fan_label: MEMBER,
    fan_user_id: MEMBER,
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
  }]);
  h.fake.seed("posts", [
    postRow(LABELLED_VIDEO, {
      body: "strobe set from last night",
      contentWarnings: ["flashing_lights"],
      mediaUrls: [{ kind: "video", url: "https://cdn.example.com/strobe.mp4", thumb: "https://cdn.example.com/strobe.jpg" }],
    }),
    postRow(LABELLED_IMG, {
      body: "the explicit cover art",
      contentWarnings: ["sensitive", "mature_themes"],
      mediaUrls: [{ kind: "image", url: "https://cdn.example.com/art.jpg" }],
    }),
    postRow(PLAIN, {
      body: "ordinary post",
      mediaUrls: [{ kind: "image", url: "https://cdn.example.com/plain.jpg" }],
    }),
    postRow(TEXT_LABELLED, {
      body: "a post whose WORDS carry the warning",
      contentWarnings: ["strong_language"],
      mediaUrls: [],
    }),
    postRow(MEMBERS_LABELLED, {
      body: "members-only and labelled",
      audience: "members",
      contentWarnings: ["sensitive"],
      mediaUrls: [{ kind: "image", url: "https://cdn.example.com/vault.jpg" }],
    }),
    postRow(QUOTE_OF_LABELLED, {
      body: "look at this",
      kind: "quote",
      quoteOf: LABELLED_IMG,
      profileId: FAN_PROFILE,
    }),
  ]);
});

const feedPost = (json: any, id: string) => (json.posts ?? []).find((p: any) => p.id === id);

function expectCovered(p: any, mode: "covered" | "hidden") {
  expect(p, "post should be present, covered").toBeTruthy();
  expect(p.media_urls).toEqual([]);
  expect(p.content_cover).toBeTruthy();
  expect(p.content_cover.mode).toBe(mode);
  expect(p.content_cover.media_count).toBeGreaterThan(0);
}

describe("covered by default — nobody receives the media URL", () => {
  it("feed: a fan gets the cover (warning named), the author gets their media, an unlabelled post is untouched", async () => {
    const fan = await call("GET", "/feed", { user: FAN });
    const v = feedPost(fan.json, LABELLED_VIDEO);
    expectCovered(v, "covered");
    expect(v.content_cover.labels).toEqual(["flashing_lights"]);
    expect(v.content_cover.message).toContain("Flashing lights");
    expect(v.content_warnings).toEqual(["flashing_lights"]);
    // Autoplay safety is structural: neither the video nor its poster
    // URL appears ANYWHERE in the payload — there is nothing to fetch.
    expect(JSON.stringify(fan.json)).not.toContain("strobe.mp4");
    expect(JSON.stringify(fan.json)).not.toContain("strobe.jpg");
    expect(JSON.stringify(fan.json)).not.toContain("art.jpg");
    expect(JSON.stringify(fan.json)).not.toContain("vault.jpg");

    const img = feedPost(fan.json, LABELLED_IMG);
    expectCovered(img, "covered");
    expect(img.content_cover.labels).toEqual(["sensitive", "mature_themes"]);
    expect(img.content_cover.message).toContain("Mature themes");

    const plain = feedPost(fan.json, PLAIN);
    expect(plain.content_warnings).toEqual([]);
    expect(plain.content_cover).toBeNull();
    expect(plain.media_urls?.[0]?.url).toBe("https://cdn.example.com/plain.jpg");

    const author = await call("GET", "/feed", { user: AUTHOR });
    const mine = feedPost(author.json, LABELLED_VIDEO);
    expect(mine.content_cover).toBeNull();
    expect(mine.content_warnings).toEqual(["flashing_lights"]);
    expect(mine.media_urls?.[0]?.url).toBe("https://cdn.example.com/strobe.mp4");
  });

  it("single post (direct link): anonymous readers are covered too", async () => {
    const anon = await call("GET", `/posts/${LABELLED_IMG}`);
    expect(anon.status).toBe(200);
    expectCovered(anon.json.post, "covered");
    expect(JSON.stringify(anon.json)).not.toContain("art.jpg");
  });

  it("a label on a text-only post rides the DTO but covers nothing (no media to cover)", async () => {
    const fan = await call("GET", `/posts/${TEXT_LABELLED}`, { bearer: FAN });
    expect(fan.json.post.content_warnings).toEqual(["strong_language"]);
    expect(fan.json.post.content_cover).toBeNull();
    expect(fan.json.post.body).toContain("WORDS");
  });

  it("quote embeds: the quoted post keeps its OWN cover inside someone else's post", async () => {
    const outsider = await call("GET", `/posts/${QUOTE_OF_LABELLED}`, { bearer: OUTSIDER });
    expect(outsider.status).toBe(200);
    expect(outsider.json.post.quoted).toBeTruthy();
    expectCovered(outsider.json.post.quoted, "covered");
    expect(JSON.stringify(outsider.json)).not.toContain("art.jpg");
  });
});

describe("the reveal door — per item, and only through the door", () => {
  it("a fan reveals one post and receives exactly its media", async () => {
    const r = await call("POST", `/posts/${LABELLED_VIDEO}/content-warning/reveal`, { bearer: FAN });
    expect(r.status).toBe(200);
    expect(r.json.media_urls?.[0]?.url).toBe("https://cdn.example.com/strobe.mp4");
    // The reveal changes nothing in the stored DTO: a fresh read is
    // covered again — the reveal is per item, per session, client's
    // memory only.
    const again = await call("GET", `/posts/${LABELLED_VIDEO}`, { bearer: FAN });
    expectCovered(again.json.post, "covered");
  });

  it("anonymous reveal works on a public post (the door is the tap, not an account)", async () => {
    const r = await call("POST", `/posts/${LABELLED_IMG}/content-warning/reveal`);
    expect(r.status).toBe(200);
    expect(r.json.media_urls?.[0]?.url).toBe("https://cdn.example.com/art.jpg");
  });

  it("reveal refuses an unlabelled post and an unknown post", async () => {
    expect((await call("POST", `/posts/${PLAIN}/content-warning/reveal`, { user: FAN })).status).toBe(400);
    expect((await call("POST", `/posts/99999999-9999-4999-8999-999999999999/content-warning/reveal`, { user: FAN })).status).toBe(404);
  });

  it("reveal on a followers-scoped labelled post is a 404 to a non-follower (existence doesn't leak)", async () => {
    h.fake.seed("posts", [postRow("22222222-2222-4222-8222-222222222307", {
      body: "followers only, labelled",
      audience: "followers",
      contentWarnings: ["sensitive"],
      mediaUrls: [{ kind: "image", url: "https://cdn.example.com/circle.jpg" }],
    })]);
    const r = await call("POST", `/posts/22222222-2222-4222-8222-222222222307/content-warning/reveal`, { bearer: OUTSIDER });
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.json)).not.toContain("circle.jpg");
  });
});

describe("author-only labels", () => {
  it("create: the author labels at publish; a bogus label is a 400", async () => {
    const proper = await realFetch(`${baseUrl}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": AUTHOR },
      body: JSON.stringify({
        body: "fresh drop, mind the strobes",
        media_urls: [{ kind: "image", url: "https://cdn.example.com/fresh.jpg" }],
        content_warnings: ["flashing_lights"],
      }),
    });
    expect(proper.status).toBe(201);
    const pj = await proper.json() as any;
    expect(pj.post.content_warnings).toEqual(["flashing_lights"]);
    // Author's own create response is uncovered (author rule).
    expect(pj.post.content_cover).toBeNull();
    expect(pj.post.media_urls?.[0]?.url).toBe("https://cdn.example.com/fresh.jpg");
    // And a fan reading it is covered.
    const fanRead = await call("GET", `/posts/${pj.post.id}`, { bearer: FAN });
    expectCovered(fanRead.json.post, "covered");

    const bogus = await realFetch(`${baseUrl}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": AUTHOR },
      body: JSON.stringify({ body: "nope", content_warnings: ["gore"] }),
    });
    expect(bogus.status).toBe(400);
  });

  it("PATCH: only the author can set, change or clear a label", async () => {
    const byFan = await call("PATCH", `/posts/${PLAIN}/content-warning`, {
      user: FAN,
      body: { content_warnings: ["sensitive"] },
    });
    expect(byFan.status).toBe(404);

    const set = await call("PATCH", `/posts/${PLAIN}/content-warning`, {
      user: AUTHOR,
      body: { content_warnings: ["mature_themes"] },
    });
    expect(set.status).toBe(200);
    expect(set.json.post.content_warnings).toEqual(["mature_themes"]);

    const fanRead = await call("GET", `/posts/${PLAIN}`, { bearer: FAN });
    expectCovered(fanRead.json.post, "covered");

    const cleared = await call("PATCH", `/posts/${PLAIN}/content-warning`, {
      user: AUTHOR,
      body: { content_warnings: [] },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.json.post.content_warnings).toEqual([]);
    const open = await call("GET", `/posts/${PLAIN}`, { bearer: FAN });
    expect(open.json.post.content_cover).toBeNull();
    expect(open.json.post.media_urls?.[0]?.url).toBe("https://cdn.example.com/plain.jpg");

    const bogus = await call("PATCH", `/posts/${PLAIN}/content-warning`, {
      user: AUTHOR,
      body: { content_warnings: ["everything"] },
    });
    expect(bogus.status).toBe(400);
  });
});

describe("viewer preference — stricter for themselves, never looser", () => {
  it("hiding a label turns cover into hidden, shuts the reveal, and leaves other labels covered-not-hidden", async () => {
    const put = await call("PUT", "/content-warning/preferences", {
      user: FAN,
      body: { hidden_labels: ["flashing_lights"] },
    });
    expect(put.status).toBe(200);
    expect(put.json.hidden_labels).toEqual(["flashing_lights"]);

    const got = await call("GET", "/content-warning/preferences", { user: FAN });
    expect(got.json.hidden_labels).toEqual(["flashing_lights"]);

    const feed = await call("GET", "/feed", { user: FAN });
    expectCovered(feedPost(feed.json, LABELLED_VIDEO), "hidden");
    expectCovered(feedPost(feed.json, LABELLED_IMG), "covered");

    const reveal = await call("POST", `/posts/${LABELLED_VIDEO}/content-warning/reveal`, { bearer: FAN });
    expect(reveal.status).toBe(403);
    expect(reveal.json.error).toBe("hidden_by_preference");

    const revealOther = await call("POST", `/posts/${LABELLED_IMG}/content-warning/reveal`, { bearer: FAN });
    expect(revealOther.status).toBe(200);

    // Another viewer's preference is unaffected by the fan's choice.
    const outsiderFeed = await call("GET", "/feed", { user: OUTSIDER });
    expectCovered(feedPost(outsiderFeed.json, LABELLED_VIDEO), "covered");
  });

  it("preferences require an account and reject labels outside the fixed set", async () => {
    expect((await call("GET", "/content-warning/preferences")).status).toBe(401);
    const bogus = await call("PUT", "/content-warning/preferences", {
      user: FAN,
      body: { hidden_labels: ["spoilers"] },
    });
    expect(bogus.status).toBe(400);
  });
});

describe("composition with the members gate — locked AND covered", () => {
  it("a non-member gets the locked teaser (labels named, no cover to lift) and the reveal stays shut", async () => {
    const feed = await call("GET", "/feed", { user: OUTSIDER });
    const p = feedPost(feed.json, MEMBERS_LABELLED);
    expect(p).toBeTruthy();
    expect(p.member_lock).toBeTruthy();
    expect(p.content_warnings).toEqual(["sensitive"]);
    expect(p.content_cover).toBeNull();
    expect(p.media_urls).toEqual([]);
    expect(JSON.stringify(feed.json)).not.toContain("vault.jpg");

    const reveal = await call("POST", `/posts/${MEMBERS_LABELLED}/content-warning/reveal`, { bearer: OUTSIDER });
    expect(reveal.status).toBe(403);
    expect(reveal.json.error).toBe("members_only");
    expect(JSON.stringify(reveal.json)).not.toContain("vault.jpg");
  });

  it("a qualifying member gets the full post — still covered until they tap, then the reveal opens", async () => {
    const feed = await call("GET", "/feed", { user: MEMBER });
    const p = feedPost(feed.json, MEMBERS_LABELLED);
    expect(p.member_lock).toBeNull();
    expectCovered(p, "covered");
    expect(JSON.stringify(feed.json)).not.toContain("vault.jpg");

    const reveal = await call("POST", `/posts/${MEMBERS_LABELLED}/content-warning/reveal`, { bearer: MEMBER });
    expect(reveal.status).toBe(200);
    expect(reveal.json.media_urls?.[0]?.url).toBe("https://cdn.example.com/vault.jpg");
  });
});
