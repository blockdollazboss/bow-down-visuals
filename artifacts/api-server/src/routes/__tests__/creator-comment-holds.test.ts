/**
 * POST-time hold integration (Stack-100 #3, #27): the wall owner's
 * comment settings decide whether a new comment on
 *   POST /api/creator-profiles/:id/comments  (wall)
 *   POST /api/media/:kind/:id/comments       (media)
 * starts public or HELD for the creator's review. Held is a delay,
 * never a silent deletion: the response says so, the row carries
 * status 'held' + held_reason, and a held media comment does NOT bump
 * the public comment counter. Fake db mirrors creator-comments-dto.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const WALL_ID = "11111111-1111-4111-8111-111111111111";
const WALL_OWNER = "22222222-2222-4222-8222-222222222222";
const FAN = "33333333-3333-4333-8333-333333333333";
const TRACK_ID = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  state: {
    currentUser: "33333333-3333-4333-8333-333333333333",
    profilesById: new Map<string, Record<string, unknown>>(),
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    wallComments: [] as Array<Record<string, unknown>>,
    mediaComments: [] as Array<Record<string, unknown>>,
    tracksById: new Map<string, Record<string, unknown>>(),
    settingsByProfile: new Map<string, Record<string, unknown>>(),
    inserted: [] as Array<Record<string, unknown>>,
    executeCalls: 0,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.state.currentUser;
    next();
  },
}));
vi.mock("../referrals", () => ({ getRecruiterBadgeForUser: async () => null }));
vi.mock("../generate/milestones", () => ({ computeAchievements: () => [] }));
vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) => typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const s = h.state;
  const {
    creatorProfilesTable, profileTracksTable,
    profileCommentsTable, mediaCommentsTable, creatorCommentSettingsTable,
  } = actual;

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    const p = params.map(String);
    if (table === creatorProfilesTable) {
      if (fields && typeof fields === "object" && "displayName" in (fields as object)) {
        const wanted = new Set(p);
        return [...s.profilesByUserId.values()]
          .filter((pr) => wanted.has(String(pr["userId"])))
          .map((pr) => ({ userId: pr["userId"], slug: pr["slug"], displayName: pr["displayName"], avatarUrl: pr["avatarUrl"] }));
      }
      if (sql.includes('"slug"')) {
        const row = [...s.profilesById.values()].find((pr) => String(pr["slug"]) === (p[0] ?? ""));
        return row ? [row] : [];
      }
      const row = s.profilesById.get(p[0] ?? "");
      return row ? [row] : [];
    }
    if (table === creatorCommentSettingsTable) {
      const row = s.settingsByProfile.get(p[0] ?? "");
      return row ? [row] : [];
    }
    if (table === profileCommentsTable) {
      // first-time probe carries an author condition; plain reads don't
      if (sql.includes('"author_user_id"')) {
        return s.wallComments.filter((c) => String(c["profileId"]) === p[0] && String(c["authorUserId"]) === p[1]);
      }
      return s.wallComments.filter((c) => String(c["profileId"]) === p[0]);
    }
    if (table === mediaCommentsTable) {
      if (sql.includes('"author_user_id"')) {
        return s.mediaComments.filter((c) => String(c["authorUserId"]) === p[p.length - 1]);
      }
      return s.mediaComments.filter((c) => p.includes(String(c["mediaId"])));
    }
    if (table === profileTracksTable) {
      const row = s.tracksById.get(p[0] ?? "");
      return row ? [row] : [];
    }
    return [];
  }

  function chain(table: unknown, fields: unknown, cond: unknown): any {
    const self: any = {
      limit: () => self,
      offset: () => self,
      orderBy: () => self,
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, fields, cond)).then(res, rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, fields, cond),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (table === profileCommentsTable || table === mediaCommentsTable) {
            const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "track", ...v, createdAt: new Date("2026-10-14T09:30:00.000Z") };
            s.inserted.push(row);
            return [row];
          }
          return [{ ...v }];
        },
        then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
      }),
    }),
    execute: async () => { s.executeCalls += 1; return []; },
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

beforeEach(() => {
  const s = h.state;
  s.currentUser = FAN;
  s.profilesById = new Map();
  s.profilesByUserId = new Map();
  s.wallComments = [];
  s.mediaComments = [];
  s.tracksById = new Map();
  s.settingsByProfile = new Map();
  s.inserted = [];
  s.executeCalls = 0;

  const wall = { id: WALL_ID, userId: WALL_OWNER, slug: "wall-owner", displayName: "Wall Owner", avatarUrl: null, isPublic: true, followerCount: 0 };
  s.profilesById.set(WALL_ID, wall);
  s.profilesByUserId.set(WALL_OWNER, wall);
  const fan = { id: "13131313-1313-4313-8313-131313131313", userId: FAN, slug: "fan", displayName: "Fan", avatarUrl: null, isPublic: true, followerCount: 0 };
  s.profilesByUserId.set(FAN, fan);
  s.tracksById.set(TRACK_ID, { id: TRACK_ID, profileId: WALL_ID, title: "Midnight Gold", isPublished: true, commentCount: 0 });
  // Owner's rules: hold first-timers + keyword blocklist.
  s.settingsByProfile.set(WALL_ID, { profileId: WALL_ID, holdMode: "first_time", blockedWords: ["spamword"] });
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("wall POST under the owner's comment controls", () => {
  it("a keyword match is HELD (not deleted, not public) with the delay copy in the response", async () => {
    const { status, json } = await post(`/creator-profiles/${WALL_ID}/comments`, { body: "spamword alert" });
    expect(status).toBe(201);
    expect(json.held).toBe(true);
    expect(json.held_copy).toContain("delay, not a deletion");
    expect(json.comment.status).toBe("held");
    expect(json.comment.held_reason).toBe("blocked_word");
    expect(h.state.inserted[0]!["status"]).toBe("held");
  });

  it("a first-time commenter's clean comment is held as first_time_commenter", async () => {
    const { json } = await post(`/creator-profiles/${WALL_ID}/comments`, { body: "clean first words" });
    expect(json.comment.status).toBe("held");
    expect(json.comment.held_reason).toBe("first_time_commenter");
  });

  it("a returning commenter's clean comment posts public", async () => {
    h.state.wallComments = [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", profileId: WALL_ID, authorUserId: FAN, body: "earlier", status: "public", createdAt: new Date() }];
    const { json } = await post(`/creator-profiles/${WALL_ID}/comments`, { body: "back again" });
    expect(json.held).toBe(false);
    expect(json.comment.status).toBe("public");
  });

  it("with no settings row (defaults OFF) everything posts public, keyword included", async () => {
    h.state.settingsByProfile.clear();
    const { json } = await post(`/creator-profiles/${WALL_ID}/comments`, { body: "spamword but no rules set" });
    expect(json.comment.status).toBe("public");
  });

  it("the owner posting on their own wall is never held by their own rules", async () => {
    h.state.currentUser = WALL_OWNER;
    const { json } = await post(`/creator-profiles/${WALL_ID}/comments`, { body: "spamword from me" });
    expect(json.comment.status).toBe("public");
  });
});

describe("media POST under the owner's comment controls", () => {
  it("a held media comment does NOT bump the public comment counter", async () => {
    const { status, json } = await post(`/media/track/${TRACK_ID}/comments`, { body: "spamword on the track" });
    expect(status).toBe(201);
    expect(json.comment.status).toBe("held");
    expect(h.state.executeCalls).toBe(0);
  });

  it("a public media comment (returning fan, clean) bumps the counter once", async () => {
    h.state.mediaComments = [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", kind: "track", mediaId: TRACK_ID, authorUserId: FAN, body: "earlier", status: "public", createdAt: new Date() }];
    const { json } = await post(`/media/track/${TRACK_ID}/comments`, { body: "clean return" });
    expect(json.comment.status).toBe("public");
    // Exactly 2 raw executes: 1 = the counter bump itself (a double
    // bump would make this 3), +1 = the keyword-automations rules
    // read, which fires fire-and-forget once a comment lands public
    // (migration 0232). Held comments fire neither — see the 0 above.
    expect(h.state.executeCalls).toBe(2);
  });
});

describe("list visibility through the real GET routes", () => {
  it("anonymous wall GET hides held/hidden and shows the pinned comment first", async () => {
    h.state.wallComments = [
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", profileId: WALL_ID, authorUserId: FAN, body: "held one", status: "held", pinned: false, createdAt: new Date("2026-10-06T00:00:00Z") },
      { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", profileId: WALL_ID, authorUserId: FAN, body: "hidden one", status: "hidden", pinned: false, createdAt: new Date("2026-10-05T00:00:00Z") },
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", profileId: WALL_ID, authorUserId: FAN, body: "plain public", status: "public", pinned: false, createdAt: new Date("2026-10-04T00:00:00Z") },
      { id: "12121212-1212-4121-8121-121212121212", profileId: WALL_ID, authorUserId: FAN, body: "pinned public", status: "public", pinned: true, pinnedAt: new Date("2026-10-03T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z") },
    ];
    const r = await realFetch(`${baseUrl}/creator-profiles/${WALL_ID}/comments`);
    const json: any = await r.json();
    expect(r.status).toBe(200);
    expect(json.viewer_is_owner).toBe(false);
    expect(json.comments.map((c: any) => c.body)).toEqual(["pinned public", "plain public"]);
    expect(json.comments[0].pinned).toBe(true);
  });
});
