/**
 * Route tests for DE-17 (routes/social): notifications must take you
 * to the thing.
 *
 * THE DEFECT: every post alert — mention, reply, quote, repost —
 * inserted its notification with link "/home", so the bell dumped the
 * creator at the feed's front door to hunt for the post. The follow
 * alert named nobody; a story reply linked the recipient's OWN
 * profile instead of the conversation the reply actually landed in.
 *
 * These tests mount the real router over a cond-aware fake db (style
 * mirrors social-feed-dto.test.ts; WHERE params read back through
 * PgDialect rendering, like creator-follow-unfollow.test.ts) and pin
 * the notification rows each write path inserts:
 *   mention / reply / quote → /post/<the acting post's id> (the new
 *     /post/:id page renders exactly that post)
 *   repost                  → /post/<the ORIGINAL post's id> (a repost
 *     row has an empty body — the original is the thing)
 *   story reply             → /messages?to=<replier> (the DM thread
 *     the reply was dropped into)
 * No assertion here accepts "/home".
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ME_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_POST_ID = "55555555-5555-4555-8555-555555555555";
const STORY_ID = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    posts: [] as Array<Record<string, unknown>>,
    stories: [] as Array<Record<string, unknown>>,
    conversations: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>,
    seq: 0,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

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
    conversationsTable,
    notificationsTable,
  } = actual;

  function nextId(): string {
    state.seq += 1;
    return `99999999-9999-4999-8999-${String(state.seq).padStart(12, "0")}`;
  }

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (cond === undefined || cond === null) {
      if (table === creatorProfilesTable) return state.profiles;
      if (table === postsTable) return state.posts;
      if (table === storiesTable) return state.stories;
      if (table === conversationsTable) return state.conversations;
      return [];
    }
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes('"user_id"')) return state.profiles.filter((p) => params.some((x) => String(x) === String(p["userId"])));
      if (sql.includes('"slug"')) return state.profiles.filter((p) => params.some((x) => String(x) === String(p["slug"])));
      if (sql.includes('"id"')) return state.profiles.filter((p) => params.some((x) => String(x) === String(p["id"])));
      return state.profiles;
    }
    if (table === postsTable) {
      if (sql.includes('"repost_of"')) {
        return state.posts.filter(
          (p) => String(p["profileId"]) === String(params[0]) && String(p["repostOf"]) === String(params[1]),
        );
      }
      if (sql.includes('"id"')) return state.posts.filter((p) => params.some((x) => String(x) === String(p["id"])));
      return state.posts;
    }
    if (table === storiesTable) {
      if (sql.includes('"id"')) return state.stories.filter((s) => params.some((x) => String(x) === String(s["id"])));
      return state.stories;
    }
    if (table === conversationsTable) {
      return state.conversations.filter(
        (c) => String(c["participantA"]) === String(params[0]) && String(c["participantB"]) === String(params[1]),
      );
    }
    return [];
  }

  function chain(table: unknown): any {
    let cond: unknown;
    const c: any = {
      where: (w: unknown) => {
        cond = w;
        return c;
      },
      orderBy: (..._args: unknown[]) => c,
      groupBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table, cond).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return c;
  }

  function thenable(extra: Record<string, unknown> = {}): any {
    return {
      ...extra,
      then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
    };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = Array.isArray(v) ? v : [v];
        const stored = rows.map((row) => {
          if (table === postsTable) {
            const full = {
              id: nextId(),
              likeCount: 0,
              repostCount: 0,
              replyCount: 0,
              createdAt: new Date(),
              ...row,
            };
            state.posts.push(full);
            return full;
          }
          if (table === conversationsTable) {
            const full = { id: nextId(), ...row };
            state.conversations.push(full);
            return full;
          }
          if (table === notificationsTable) {
            state.notifications.push({ ...row });
            return { ...row };
          }
          return { id: nextId(), ...row };
        });
        return thenable({ returning: async () => stored });
      },
    }),
    update: (_table: unknown) => ({
      set: (_patch: unknown) => ({
        where: (_cond: unknown) => thenable({ returning: async () => [] }),
      }),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => thenable({ returning: async () => [] }),
    }),
    execute: async () => ({ rows: [] }),
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

function profileRow(id: string, userId: string, slug: string, displayName: string): Record<string, unknown> {
  return { id, userId, slug, displayName, avatarUrl: null, isVerified: false };
}

function postRow(): Record<string, unknown> {
  return {
    id: PARENT_POST_ID,
    profileId: OTHER_PROFILE_ID,
    body: "Original drop announcement 🦈",
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
    createdAt: new Date(),
  };
}

beforeEach(() => {
  const s = h.state;
  s.profiles = [
    profileRow(ME_PROFILE_ID, VIEWER_ID, "me-creator", "Me Creator"),
    profileRow(OTHER_PROFILE_ID, OTHER_USER_ID, "other-creator", "Other Creator"),
  ];
  s.posts = [postRow()];
  s.stories = [
    {
      id: STORY_ID,
      profileId: OTHER_PROFILE_ID,
      mediaUrl: "https://cdn.example.com/story.mp4",
      mediaKind: "video",
      caption: "Backstage",
      audience: "public",
      viewCount: 0,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
    },
  ];
  s.conversations = [];
  s.notifications = [];
  s.seq = 0;
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => null)) as any;
  return { status: r.status, json };
}

function notesFor(kind: string, userId: string) {
  return h.state.notifications.filter((n) => n["kind"] === kind && n["userId"] === userId);
}

describe("DE-17 — post alerts link the post, never /home", () => {
  it("mention → the mentioning post's page", async () => {
    const { status, json } = await post("/posts", { body: "@other-creator this is your sound now" });
    expect(status).toBe(201);
    const notes = notesFor("mention", OTHER_USER_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]!["link"]).toBe(`/post/${json.post.id}`);
  });

  it("reply composed in POST /posts → the reply post's page", async () => {
    const { status, json } = await post("/posts", { body: "instant classic", reply_to: PARENT_POST_ID });
    expect(status).toBe(201);
    const notes = notesFor("post_reply", OTHER_USER_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]!["link"]).toBe(`/post/${json.post.id}`);
    expect(notes[0]!["link"]).not.toBe(`/post/${PARENT_POST_ID}`);
  });

  it("quote composed in POST /posts → the quote post's page", async () => {
    const { status, json } = await post("/posts", { body: "had to quote this", quote_of: PARENT_POST_ID });
    expect(status).toBe(201);
    const notes = notesFor("post_quote", OTHER_USER_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]!["link"]).toBe(`/post/${json.post.id}`);
  });

  it("POST /posts/:id/reply → the reply post's page", async () => {
    const { status, json } = await post(`/posts/${PARENT_POST_ID}/reply`, { body: "first!" });
    expect(status).toBe(201);
    const notes = notesFor("post_reply", OTHER_USER_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]!["link"]).toBe(`/post/${json.post.id}`);
  });

  it("POST /posts/:id/repost → the ORIGINAL post's page (the repost row itself is an empty shell)", async () => {
    const { status } = await post(`/posts/${PARENT_POST_ID}/repost`, {});
    expect(status).toBe(201);
    const notes = notesFor("post_repost", OTHER_USER_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]!["link"]).toBe(`/post/${PARENT_POST_ID}`);
  });

  it("POST /posts/:id/quote → the quote post's page", async () => {
    const { status, json } = await post(`/posts/${PARENT_POST_ID}/quote`, { body: "my take on this" });
    expect(status).toBe(201);
    const notes = notesFor("post_quote", OTHER_USER_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]!["link"]).toBe(`/post/${json.post.id}`);
  });

  it("story reply → the DM thread with the replier, not the recipient's own profile", async () => {
    const { status } = await post(`/stories/${STORY_ID}/reply`, { body: "that hook is crazy" });
    expect(status).toBe(201);
    const notes = notesFor("story_reply", OTHER_USER_ID);
    expect(notes).toHaveLength(1);
    expect(notes[0]!["link"]).toBe(`/messages?to=${VIEWER_ID}`);
  });

  it("no notification inserted by any of these paths links /home", async () => {
    await post("/posts", { body: "@other-creator ping" });
    await post(`/posts/${PARENT_POST_ID}/reply`, { body: "replying" });
    await post(`/posts/${PARENT_POST_ID}/repost`, {});
    await post(`/posts/${PARENT_POST_ID}/quote`, { body: "quoting" });
    expect(h.state.notifications.length).toBeGreaterThan(0);
    for (const n of h.state.notifications) {
      expect(n["link"]).not.toBe("/home");
    }
  });
});
