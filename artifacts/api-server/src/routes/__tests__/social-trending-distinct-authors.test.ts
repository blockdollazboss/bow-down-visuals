/**
 * Route tests for GET /trending/topics — Charts OD4 (stack1400 ruling #7).
 *
 * BEFORE: velocity used RAW post/video counts, so one author posting
 * 5 times with a tag counted 5 times and could single-handedly push a
 * tag up the trending list.
 *
 * RULING: velocity counts DISTINCT AUTHORS per tag per source. The same
 * author (profileId — shared namespace across posts and profile_videos)
 * counts ONCE per tag per source. Velocity keeps the 2:1 weighting on
 * the distinct counts: velocity = distinctPostAuthors*2 + distinctVideoAuthors.
 * Response shape is unchanged: { topics: [{ tag, posts, videos, velocity }] }
 * with posts/videos now carrying the distinct-author counts.
 *
 * Fake-db style mirrors routes/__tests__/social-feed-dto.test.ts:
 * real table objects via importOriginal, a chainable select whose rows
 * dispatch on table identity.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const AUTHOR_A = "11111111-1111-4111-8111-111111111111";
const AUTHOR_B = "22222222-2222-4222-8222-222222222222";
const AUTHOR_C = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  state: {
    posts: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
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
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
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
  const { postsTable, profileVideosTable } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === postsTable) return state.posts;
    if (table === profileVideosTable) return state.videos;
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

beforeEach(() => {
  h.state.posts = [];
  h.state.videos = [];
});

async function getTrending() {
  const r = await realFetch(`${baseUrl}/trending/topics`);
  const json = (await r.json().catch(() => null)) as any;
  return { status: r.status, json };
}

const post = (profileId: string, body: string) => ({ profileId, body });
const video = (profileId: string, tags: string[]) => ({ profileId, tags });

describe("GET /api/trending/topics — distinct authors (Charts OD4)", () => {
  it("counts the same author posting 5 times with a tag ONCE for posts", async () => {
    h.state.posts = Array.from({ length: 5 }, (_, i) => post(AUTHOR_A, `drop ${i} #viral`));

    const { status, json } = await getTrending();

    expect(status).toBe(200);
    expect(json.topics).toEqual([{ tag: "viral", posts: 1, videos: 0, velocity: 2 }]);
  });

  it("counts each distinct post author once", async () => {
    h.state.posts = [
      post(AUTHOR_A, "one #viral"),
      post(AUTHOR_A, "two #viral"),
      post(AUTHOR_B, "three #viral"),
      post(AUTHOR_C, "four #viral"),
      post(AUTHOR_C, "five #viral"),
    ];

    const { json } = await getTrending();

    expect(json.topics).toEqual([{ tag: "viral", posts: 3, videos: 0, velocity: 6 }]);
  });

  it("counts the same author posting multiple videos with a tag ONCE for videos", async () => {
    h.state.videos = [
      video(AUTHOR_A, ["dance"]),
      video(AUTHOR_A, ["#dance"]),
      video(AUTHOR_A, ["Dance"]),
      video(AUTHOR_B, ["dance"]),
    ];

    const { json } = await getTrending();

    expect(json.topics).toEqual([{ tag: "dance", posts: 0, videos: 2, velocity: 2 }]);
  });

  it("counts the same author once per source when they post AND publish a video with the tag", async () => {
    // profileId is the shared author namespace across both tables:
    // the same profile counts once in the post source and once in the
    // video source, so velocity = 1*2 + 1 = 3 (not raw 2*2+1, and not
    // a single cross-source count that would lose the 2:1 weighting).
    h.state.posts = [post(AUTHOR_A, "hi #viral"), post(AUTHOR_A, "again #viral")];
    h.state.videos = [video(AUTHOR_A, ["viral"]), video(AUTHOR_A, ["viral"])];

    const { json } = await getTrending();

    expect(json.topics).toEqual([{ tag: "viral", posts: 1, videos: 1, velocity: 3 }]);
  });

  it("keeps the 2:1 weighting on distinct counts and sorts by velocity", async () => {
    h.state.posts = [post(AUTHOR_A, "solo #alpha")];
    h.state.videos = [video(AUTHOR_A, ["beta"]), video(AUTHOR_B, ["beta"]), video(AUTHOR_C, ["beta"])];

    const { json } = await getTrending();

    // beta: 3 distinct video authors -> velocity 3; alpha: 1 distinct
    // post author -> velocity 2. Raw counts would tie/order differently
    // once spam is added, so this pins weighting on distinct counts.
    expect(json.topics).toEqual([
      { tag: "beta", posts: 0, videos: 3, velocity: 3 },
      { tag: "alpha", posts: 1, videos: 0, velocity: 2 },
    ]);
  });

  it("does not let one spamming author outrank many distinct authors", async () => {
    h.state.posts = [
      ...Array.from({ length: 10 }, (_, i) => post(AUTHOR_A, `spam ${i} #loud`)),
      post(AUTHOR_B, "real #quiet"),
      post(AUTHOR_C, "real #quiet"),
    ];

    const { json } = await getTrending();

    expect(json.topics).toEqual([
      { tag: "quiet", posts: 2, videos: 0, velocity: 4 },
      { tag: "loud", posts: 1, videos: 0, velocity: 2 },
    ]);
  });

  it("merges tag case and duplicate tags on a single item before distinct counting", async () => {
    h.state.posts = [post(AUTHOR_A, "#VIRAL #viral #Viral")];
    h.state.videos = [video(AUTHOR_B, ["#VIRAL", "viral"])];

    const { json } = await getTrending();

    expect(json.topics).toEqual([{ tag: "viral", posts: 1, videos: 1, velocity: 3 }]);
  });

  it("returns the byte-compatible response shape", async () => {
    h.state.posts = [post(AUTHOR_A, "hi #viral")];

    const { status, json } = await getTrending();

    expect(status).toBe(200);
    expect(Object.keys(json)).toEqual(["topics"]);
    expect(Object.keys(json.topics[0]).sort()).toEqual(["posts", "tag", "velocity", "videos"]);
  });

  it("returns no topics when there are no posts or videos", async () => {
    const { status, json } = await getTrending();

    expect(status).toBe(200);
    expect(json).toEqual({ topics: [] });
  });
});
