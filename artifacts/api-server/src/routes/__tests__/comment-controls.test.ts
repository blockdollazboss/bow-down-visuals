/**
 * Route tests for creator comment controls (Stack-100 #3, #27):
 *   GET/PUT /api/creator-profiles/me/comment-settings
 *   GET     /api/creator-profiles/me/held-comments
 *   POST    /api/creator-comments/:commentId/action
 *
 * The security pin of this feature: controls resolve ownership from the
 * COMMENT ROW's owning profile, never from client input — a non-owner
 * gets 403 on every action, and settings/queue are keyed to the
 * caller's own profile only. Fake db style mirrors
 * creator-comments-dto.test.ts (real table objects via importOriginal,
 * WHERE params read back through PgDialect rendering).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "99999999-9999-4999-8999-999999999999";
const FAN = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "12121212-1212-4212-8212-121212121212";
const TRACK_ID = "55555555-5555-4555-8555-555555555555";
const WALL_HELD = "66666666-6666-4666-8666-666666666666";
const WALL_PUBLIC = "77777777-7777-4777-8777-777777777777";
const WALL_PINNED = "78787878-7878-4787-8787-787878787878";
const MEDIA_HELD = "88888888-8888-4888-8888-888888888888";
const MEDIA_PUBLIC = "89898989-8989-4898-8989-898989898989";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    wallComments: [] as Array<Record<string, unknown>>,
    mediaComments: [] as Array<Record<string, unknown>>,
    tracksById: new Map<string, Record<string, unknown>>(),
    settingsByProfile: new Map<string, Record<string, unknown>>(),
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? OWNER;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const s = h.state;
  const {
    creatorProfilesTable, profileTracksTable, profileVideosTable,
    profileCommentsTable, mediaCommentsTable, creatorCommentSettingsTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (cond === undefined) return [];
    const { sql, params } = render(cond);
    const p = params.map(String);
    if (table === creatorProfilesTable) {
      if (sql.includes('"user_id"')) {
        const row = s.profilesByUserId.get(p[0] ?? "");
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
      if (sql.includes('"profile_id"')) {
        return s.wallComments.filter((c) =>
          String(c["profileId"]) === p[0] && (!sql.includes('"status"') || String(c["status"]) === p[1]));
      }
      return s.wallComments.filter((c) => String(c["id"]) === p[0]);
    }
    if (table === mediaCommentsTable) {
      if (sql.includes(" in (")) {
        return s.mediaComments.filter((c) => p.includes(String(c["mediaId"])) && p.includes(String(c["status"])));
      }
      return s.mediaComments.filter((c) => String(c["id"]) === p[0]);
    }
    if (table === profileTracksTable) {
      if (sql.includes('"profile_id"')) return [...s.tracksById.values()].filter((t) => String(t["profileId"]) === p[0]);
      const row = s.tracksById.get(p[0] ?? "");
      return row ? [row] : [];
    }
    if (table === profileVideosTable) return [];
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: () => self,
      orderBy: () => self,
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const self: any = {
          onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
            if (table === creatorCommentSettingsTable) {
              s.settingsByProfile.set(String(v["profileId"]), { ...v, ...cfg.set });
            }
            return [];
          },
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
        return self;
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          const { sql, params } = render(cond);
          const p = params.map(String);
          const apply = (rows: Array<Record<string, unknown>>) => {
            for (const r of rows) Object.assign(r, vals);
          };
          if (table === profileCommentsTable) {
            if (sql.includes('"profile_id"')) {
              apply(s.wallComments.filter((c) => String(c["profileId"]) === p[0] && c["pinned"] === true));
            } else {
              apply(s.wallComments.filter((c) => String(c["id"]) === p[0]));
            }
          }
          if (table === mediaCommentsTable) {
            if (sql.includes('"media_id"')) {
              apply(s.mediaComments.filter((c) => p.includes(String(c["mediaId"])) && c["pinned"] === true));
            } else {
              apply(s.mediaComments.filter((c) => String(c["id"]) === p[0]));
            }
          }
          return [];
        },
      }),
    }),
    execute: async () => [],
  };
  return { ...actual, db: fakeDb };
});

import router from "../comment-controls";

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

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const s = h.state;
  s.profilesById = new Map();
  s.profilesByUserId = new Map();
  s.wallComments = [];
  s.mediaComments = [];
  s.tracksById = new Map();
  s.settingsByProfile = new Map();

  const mine = { id: PROFILE_ID, userId: OWNER, slug: "mine", displayName: "Mine", isPublic: true };
  s.profilesById.set(PROFILE_ID, mine);
  s.profilesByUserId.set(OWNER, mine);
  const theirs = { id: OTHER_PROFILE_ID, userId: OTHER, slug: "theirs", displayName: "Theirs", isPublic: true };
  s.profilesById.set(OTHER_PROFILE_ID, theirs);
  s.profilesByUserId.set(OTHER, theirs);

  s.tracksById.set(TRACK_ID, { id: TRACK_ID, profileId: PROFILE_ID, title: "Midnight Gold" });

  s.wallComments = [
    { id: WALL_HELD, profileId: PROFILE_ID, authorUserId: FAN, body: "held wall comment", status: "held", pinned: false, heldReason: "blocked_word", createdAt: new Date("2026-10-05T00:00:00Z") },
    { id: WALL_PUBLIC, profileId: PROFILE_ID, authorUserId: FAN, body: "public wall comment", status: "public", pinned: false, heldReason: null, createdAt: new Date("2026-10-04T00:00:00Z") },
    { id: WALL_PINNED, profileId: PROFILE_ID, authorUserId: FAN, body: "pinned wall comment", status: "public", pinned: true, heldReason: null, createdAt: new Date("2026-10-03T00:00:00Z") },
  ];
  s.mediaComments = [
    { id: MEDIA_HELD, kind: "track", mediaId: TRACK_ID, authorUserId: FAN, body: "held media comment", status: "held", pinned: false, heldReason: "hold_all", createdAt: new Date("2026-10-06T00:00:00Z") },
    { id: MEDIA_PUBLIC, kind: "track", mediaId: TRACK_ID, authorUserId: FAN, body: "public media comment", status: "public", pinned: false, heldReason: null, createdAt: new Date("2026-10-02T00:00:00Z") },
  ];
});

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": opts.user ?? OWNER },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("comment settings — caller's own profile only", () => {
  it("defaults are OFF with an empty blocklist", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/comment-settings");
    expect(status).toBe(200);
    expect(json.settings).toMatchObject({ hold_mode: "off", blocked_words: [], defaults_off: true });
    expect(json.settings.held_copy).toContain("delay, not a deletion");
  });

  it("PUT saves hold mode + normalized blocklist and reads back", async () => {
    const put = await call("PUT", "/creator-profiles/me/comment-settings", {
      body: { hold_mode: "first_time", blocked_words: [" SpamWord ", "spamword", "free money"] },
    });
    expect(put.status).toBe(200);
    expect(put.json.settings).toMatchObject({ hold_mode: "first_time", blocked_words: ["spamword", "free money"] });
    const get = await call("GET", "/creator-profiles/me/comment-settings");
    expect(get.json.settings.hold_mode).toBe("first_time");
  });

  it("another creator's settings are separate (keyed to the caller)", async () => {
    await call("PUT", "/creator-profiles/me/comment-settings", { body: { hold_mode: "all", blocked_words: [] } });
    const other = await call("GET", "/creator-profiles/me/comment-settings", { user: OTHER });
    expect(other.json.settings.hold_mode).toBe("off");
  });

  it("a caller with no creator profile gets 404, not someone else's settings", async () => {
    const { status } = await call("GET", "/creator-profiles/me/comment-settings", { user: FAN });
    expect(status).toBe(404);
  });

  it("rejects an invalid hold mode", async () => {
    const { status } = await call("PUT", "/creator-profiles/me/comment-settings", { body: { hold_mode: "sometimes" } });
    expect(status).toBe(400);
  });
});

describe("held queue — only the owner's held comments, both surfaces", () => {
  it("returns wall + media held comments with surface metadata and held copy", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/held-comments");
    expect(status).toBe(200);
    expect(json.held_copy).toContain("delay, not a deletion");
    expect(json.comments).toHaveLength(2);
    const wall = json.comments.find((c: any) => c.id === WALL_HELD);
    expect(wall).toMatchObject({ surface: "wall", status: "held", held_reason: "blocked_word" });
    const media = json.comments.find((c: any) => c.id === MEDIA_HELD);
    expect(media).toMatchObject({ surface: "media", media_kind: "track", media_title: "Midnight Gold" });
  });

  it("another creator's queue is empty — held comments never leak across owners", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/held-comments", { user: OTHER });
    expect(status).toBe(200);
    expect(json.comments).toHaveLength(0);
  });
});

describe("comment actions — ownership enforced from the comment row", () => {
  it("owner pins a public wall comment and the previous pin is cleared (one pin per wall)", async () => {
    const { status, json } = await call("POST", `/creator-comments/${WALL_PUBLIC}/action`, { body: { surface: "wall", action: "pin" } });
    expect(status).toBe(200);
    expect(json.comment).toMatchObject({ pinned: true, status: "public" });
    const pinnedRows = h.state.wallComments.filter((c) => c["pinned"] === true);
    expect(pinnedRows).toHaveLength(1);
    expect(pinnedRows[0]!["id"]).toBe(WALL_PUBLIC);
  });

  it("owner hides a public comment (state, not delete) and can unhide it", async () => {
    const hide = await call("POST", `/creator-comments/${WALL_PUBLIC}/action`, { body: { surface: "wall", action: "hide" } });
    expect(hide.status).toBe(200);
    expect(hide.json.comment.status).toBe("hidden");
    expect(h.state.wallComments.find((c) => c["id"] === WALL_PUBLIC)).toBeTruthy();
    const unhide = await call("POST", `/creator-comments/${WALL_PUBLIC}/action`, { body: { surface: "wall", action: "unhide" } });
    expect(unhide.json.comment.status).toBe("public");
  });

  it("owner approves a held media comment → public; rejects another → hidden (never deleted)", async () => {
    const approve = await call("POST", `/creator-comments/${MEDIA_HELD}/action`, { body: { surface: "media", action: "approve" } });
    expect(approve.status).toBe(200);
    expect(approve.json.comment).toMatchObject({ status: "public", held_reason: null });
    // re-hold by direct state reset to exercise reject
    h.state.mediaComments.find((c) => c["id"] === MEDIA_HELD)!["status"] = "held";
    const reject = await call("POST", `/creator-comments/${MEDIA_HELD}/action`, { body: { surface: "media", action: "reject" } });
    expect(reject.json.comment.status).toBe("hidden");
    expect(h.state.mediaComments.find((c) => c["id"] === MEDIA_HELD)).toBeTruthy();
  });

  it("NON-OWNER gets 403 on every action and nothing changes", async () => {
    for (const action of ["pin", "hide", "approve", "reject"]) {
      const surface = action === "approve" || action === "reject" ? "media" : "wall";
      const id = surface === "media" ? MEDIA_HELD : WALL_PUBLIC;
      const { status } = await call("POST", `/creator-comments/${id}/action`, { user: OTHER, body: { surface, action } });
      expect(status).toBe(403);
    }
    expect(h.state.wallComments.find((c) => c["id"] === WALL_PUBLIC)!["status"]).toBe("public");
    expect(h.state.mediaComments.find((c) => c["id"] === MEDIA_HELD)!["status"]).toBe("held");
  });

  it("the comment's AUTHOR (not the content owner) also gets 403", async () => {
    const { status } = await call("POST", `/creator-comments/${WALL_PUBLIC}/action`, { user: FAN, body: { surface: "wall", action: "hide" } });
    expect(status).toBe(403);
  });

  it("inapplicable actions 409: cannot pin a held comment, cannot approve a public one", async () => {
    const pinHeld = await call("POST", `/creator-comments/${WALL_HELD}/action`, { body: { surface: "wall", action: "pin" } });
    expect(pinHeld.status).toBe(409);
    const approvePublic = await call("POST", `/creator-comments/${MEDIA_PUBLIC}/action`, { body: { surface: "media", action: "approve" } });
    expect(approvePublic.status).toBe(409);
  });

  it("unknown comment 404s; bad action 400s", async () => {
    const missing = await call("POST", "/creator-comments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/action", { body: { surface: "wall", action: "pin" } });
    expect(missing.status).toBe(404);
    const bad = await call("POST", `/creator-comments/${WALL_PUBLIC}/action`, { body: { surface: "wall", action: "delete" } });
    expect(bad.status).toBe(400);
  });
});
