/**
 * #29 alt text on the posts door (routes/social POST /posts):
 *  - An image attachment's `alt` is sanitized and STORED inside
 *    posts.media_urls JSONB (no migration — the column is jsonb).
 *  - A whitespace-only alt is dropped, never stored as "".
 *  - Attachments without alt store exactly as before.
 * Fake-db style mirrors social-feed-dto.test.ts, extended with an
 * insert chain that captures the values handed to postsTable.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  state: {
    profile: null as Record<string, unknown> | null,
    inserted: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => { throw new Error("no AI in route tests"); },
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => undefined,
  refundCredits: async () => undefined,
  buildChargeIdempotencyKey: () => "k",
  voidChargeIdempotencyKey: async () => undefined,
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
  exchangeCodeForLongLivedToken: async () => { throw new Error("no Meta"); },
  exchangeFacebookCodeForLongLivedToken: async () => { throw new Error("no Meta"); },
  fetchInstagramProfile: async () => { throw new Error("no Meta"); },
  listPages: async () => [],
  publishReelToInstagram: async () => { throw new Error("no Meta"); },
  publishVideoToPage: async () => { throw new Error("no Meta"); },
  MetaApiError: class MetaApiError extends Error {},
}));

vi.mock("../../lib/social-idempotency", () => ({
  claimPublishAttempt: async () => ({ claimed: true }),
  createDrizzleAttemptStore: () => ({}),
}));

vi.mock("../../lib/social-tiktok", () => ({
  buildTikTokAuthUrl: () => "",
  exchangeCodeForTikTokTokens: async () => { throw new Error("no TikTok"); },
  refreshTikTokTokens: async () => { throw new Error("no TikTok"); },
  fetchTikTokUserInfo: async () => { throw new Error("no TikTok"); },
  uploadDraftToTikTok: async () => { throw new Error("no TikTok"); },
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
  const state = h.state;
  const { creatorProfilesTable, postsTable } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === creatorProfilesTable) return state.profile ? [state.profile] : [];
    if (table === postsTable) {
      return state.inserted
        .filter((i) => i.table === postsTable)
        .map((i) => ({ id: POST_ID, createdAt: new Date(), likeCount: 0, repostCount: 0, replyCount: 0, ...i.values }));
    }
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      groupBy: (..._args: unknown[]) => c,
      innerJoin: (..._args: unknown[]) => c,
      leftJoin: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.inserted.push({ table, values });
        return {
          returning: async () => rowsFor(table).slice(-1),
          then: (res: any, rej: any) => Promise.resolve(rowsFor(table).slice(-1)).then(res, rej),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (_v: unknown) => ({ where: async () => undefined }),
    }),
    delete: (_table: unknown) => ({ where: async () => undefined }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../social";

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
  h.state.profile = {
    id: PROFILE_ID, userId: VIEWER_ID, slug: "some-creator",
    displayName: "Some Creator", avatarUrl: null, isVerified: false,
  };
  h.state.inserted = [];
});

async function post(path: string, body: unknown) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /api/posts — attachment alt text (#29)", () => {
  it("stores a sanitized alt inside media_urls and returns it on the post", async () => {
    const r = await post("/posts", {
      body: "New cover drop 🦈",
      media_urls: [{ kind: "image", url: "https://cdn.example.com/pic.jpg", alt: "  A gold stage,\nred lights. " }],
    });
    expect(r.status).toBe(201);
    const stored = h.state.inserted[0]?.values["mediaUrls"] as Array<Record<string, unknown>>;
    expect(stored).toEqual([{ kind: "image", url: "https://cdn.example.com/pic.jpg", alt: "A gold stage, red lights." }]);
    expect(r.json.post.media_urls).toEqual(stored);
  });

  it("drops a whitespace-only alt instead of storing an empty string", async () => {
    const r = await post("/posts", {
      body: "Quiet post",
      media_urls: [{ kind: "image", url: "https://cdn.example.com/pic.jpg", alt: "   " }],
    });
    expect(r.status).toBe(201);
    const stored = h.state.inserted[0]?.values["mediaUrls"] as Array<Record<string, unknown>>;
    expect(stored).toEqual([{ kind: "image", url: "https://cdn.example.com/pic.jpg" }]);
  });

  it("posts without any alt store exactly as before", async () => {
    const r = await post("/posts", {
      body: "Plain post",
      media_urls: [{ kind: "video", url: "https://cdn.example.com/v.mp4", thumb: "https://cdn.example.com/t.jpg" }],
    });
    expect(r.status).toBe(201);
    const stored = h.state.inserted[0]?.values["mediaUrls"] as Array<Record<string, unknown>>;
    expect(stored).toEqual([{ kind: "video", url: "https://cdn.example.com/v.mp4", thumb: "https://cdn.example.com/t.jpg" }]);
  });
});
