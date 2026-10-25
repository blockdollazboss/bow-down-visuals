/**
 * Route tests for the playlist WRITE rails (routes/creator-platform):
 *
 *   POST /api/playlists              — create (auth, needs own profile)
 *   POST /api/playlists/:id/items    — add item (auth, owner only)
 *
 * These are the exact endpoints the palace Listening Booth drives
 * (lib/streaming's createPlaylist / addItemToPlaylist, via the
 * Booth's AddToPlaylistPicker) and the website's AddToPlaylist
 * widget. The read side is pinned elsewhere (playlists-mine.test.ts
 * for GET /mine after the "mine"-as-id reorder, media-streaming-dto
 * .test.ts for the GET /:id DTO) — what had NO coverage was the
 * write path itself: guest refusal, the no-profile and non-owner
 * refusals, the published-only rule, and the no-duplicates rule the
 * Booth's picker relies on when it reports "it's on your playlist".
 *
 * Auth here is header-driven: the real requireAuth answers a
 * tokenless request with 401 { error: "Unauthorized" } before the
 * handler ever runs, so the mock does exactly that when the
 * x-test-user header is absent and otherwise seats that user —
 * which is what lets one file exercise guest / owner / non-owner /
 * profile-less callers against the real handlers.
 *
 * Fake-db style mirrors playlists-mine.test.ts (real table objects
 * via importOriginal, rows matched off the rendered WHERE params),
 * extended with the insert/update chains the write routes use.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "12121212-1212-4121-8121-121212121212";
const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "23232323-2323-4232-8232-232323232323";
const PROFILELESS_USER_ID = "24242424-2424-4242-8242-242424242424";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_TRACK_ID = "35353535-3535-4353-8353-353535353535";
const PLAYLIST_ID = "55555555-5555-4555-8555-555555555555";
const MISSING_PLAYLIST_ID = "56565656-5656-4656-8656-565656565656";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
    playlists: [] as Array<Record<string, unknown>>,
    insertSeq: 0,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (typeof user !== "string" || !user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
    next();
  },
}));

vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

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
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    playlistsTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const params = cond ? render(cond).params : [];
    if (table === creatorProfilesTable) {
      return state.profiles.filter(
        (p) =>
          params.includes(p["id"]) ||
          params.includes(p["slug"]) ||
          params.includes(p["userId"]),
      );
    }
    if (table === profileTracksTable) {
      const byId = state.tracks.filter((t) => params.includes(t["id"]));
      if (byId.length) return byId;
      return state.tracks.filter((t) => params.includes(t["profileId"]));
    }
    if (table === profileVideosTable) {
      const byId = state.videos.filter((v) => params.includes(v["id"]));
      if (byId.length) return byId;
      return state.videos.filter((v) => params.includes(v["profileId"]));
    }
    if (table === playlistsTable) {
      const byId = state.playlists.filter((p) => params.includes(p["id"]));
      if (byId.length) return byId;
      return state.playlists.filter((p) => params.includes(p["ownerProfileId"]));
    }
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, cond),
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, cond),
              then: (res: any, rej: any) =>
                Promise.resolve(rowsFor(table, cond)).then(res, rej),
            }),
            then: (res: any, rej: any) =>
              Promise.resolve(rowsFor(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table !== playlistsTable) throw new Error("unexpected insert table");
        state.insertSeq += 1;
        const row: Record<string, unknown> = {
          followerCount: 0,
          createdAt: new Date("2026-10-18T00:00:00.000Z"),
          updatedAt: new Date("2026-10-18T00:00:00.000Z"),
          ...values,
          id: `99999999-9999-4999-8999-${String(state.insertSeq).padStart(12, "0")}`,
        };
        state.playlists.push(row);
        const done = Promise.resolve([row]);
        return {
          returning: async () => [row],
          then: (res: any, rej: any) => done.then(res, rej),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        const apply = (cond: unknown) => {
          if (table !== playlistsTable) return;
          const id = String(render(cond).params[0] ?? "");
          const row = state.playlists.find((p) => p["id"] === id);
          if (row) Object.assign(row, patch);
        };
        return {
          where: async (cond: unknown) => {
            apply(cond);
          },
          then: (res: any, rej: any) => Promise.resolve().then(res, rej),
        };
      },
    }),
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
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function profileRow(id: string, userId: string, slug: string): Record<string, unknown> {
  return {
    id,
    userId,
    slug,
    displayName: slug,
    vertical: "musician",
    streamSchedule: null,
    mediaKit: null,
    bio: "Test creator.",
    avatarUrl: null,
    bannerUrl: null,
    themeId: "gold-lux",
    themeConfig: {},
    sections: [],
    featuredMedia: null,
    socialLinks: {},
    topCreators: null,
    tipJarEnabled: false,
    aiDesign: null,
    isPublic: true,
    isVerified: false,
    isOfficial: false,
    followerCount: 0,
    totalPlays: 0,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

function trackRow(id: string, isPublished: boolean): Record<string, unknown> {
  return {
    id,
    profileId: PROFILE_ID,
    title: isPublished ? "King Anthem" : "Unreleased Draft",
    audioUrl: "audio/king-anthem.mp3",
    artworkUrl: "artwork/king-anthem.jpg",
    genre: "Hip-Hop",
    tags: ["king"],
    isrc: null,
    durationSec: 187,
    downloadPriceCents: 499,
    playCount: 1234,
    likeCount: 56,
    repostCount: 7,
    commentCount: 3,
    isPublished,
    createdAt: new Date("2026-10-05T12:00:00.000Z"),
  };
}

function emptyPlaylistRow(): Record<string, unknown> {
  return {
    id: PLAYLIST_ID,
    ownerProfileId: PROFILE_ID,
    title: "Booth Session",
    description: "",
    coverUrl: null,
    isPublic: true,
    kind: "playlist",
    items: [],
    followerCount: 0,
    createdAt: new Date("2026-10-07T12:00:00.000Z"),
    updatedAt: new Date("2026-10-07T12:00:00.000Z"),
  };
}

beforeEach(() => {
  h.state.profiles = [
    profileRow(PROFILE_ID, OWNER_USER_ID, "king-creator"),
    profileRow(OTHER_PROFILE_ID, OTHER_USER_ID, "other-corner"),
  ];
  h.state.tracks = [trackRow(TRACK_ID, true), trackRow(DRAFT_TRACK_ID, false)];
  h.state.videos = [];
  h.state.playlists = [emptyPlaylistRow()];
  h.state.insertSeq = 0;
});

async function call(
  method: "GET" | "POST",
  path: string,
  opts: { user?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.user) headers["x-test-user"] = opts.user;
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /api/playlists — create, the Booth picker's Create & add", () => {
  it("refuses a guest outright (401) and creates nothing", async () => {
    const { status, json } = await call("POST", "/playlists", {
      body: { title: "Sneaky" },
    });

    expect(status).toBe(401);
    expect(json.error).toBe("Unauthorized");
    expect(h.state.playlists).toHaveLength(1);
  });

  it("refuses a signed-in user with no creator profile yet (403)", async () => {
    const { status, json } = await call("POST", "/playlists", {
      user: PROFILELESS_USER_ID,
      body: { title: "Too Soon" },
    });

    expect(status).toBe(403);
    expect(json.error).toMatch(/creator profile first/i);
    expect(h.state.playlists).toHaveLength(1);
  });

  it("refuses a body with no title (400)", async () => {
    const { status } = await call("POST", "/playlists", {
      user: OWNER_USER_ID,
      body: {},
    });

    expect(status).toBe(400);
    expect(h.state.playlists).toHaveLength(1);
  });

  it("creates the playlist for the owner and it lands on GET /mine", async () => {
    const created = await call("POST", "/playlists", {
      user: OWNER_USER_ID,
      body: { title: "Booth Warmups" },
    });

    expect(created.status).toBe(201);
    expect(created.json.playlist.title).toBe("Booth Warmups");
    expect(created.json.playlist.kind).toBe("playlist");
    expect(created.json.playlist.owner_profile_slug).toBe("king-creator");
    expect(created.json.playlist.resolved_items).toEqual([]);

    const mine = await call("GET", "/playlists/mine", { user: OWNER_USER_ID });
    expect(mine.status).toBe(200);
    const titles = (mine.json.playlists as Array<{ title: string }>).map((p) => p.title);
    expect(titles).toContain("Booth Warmups");
    expect(titles).toContain("Booth Session");
  });
});

describe("POST /api/playlists/:id/items — add, the Booth picker's tap", () => {
  it("refuses a guest outright (401) and the playlist is unchanged", async () => {
    const { status } = await call("POST", `/playlists/${PLAYLIST_ID}/items`, {
      body: { kind: "track", id: TRACK_ID },
    });

    expect(status).toBe(401);
    expect(h.state.playlists[0]!["items"]).toEqual([]);
  });

  it("refuses a member who doesn't own the playlist (403)", async () => {
    const { status, json } = await call("POST", `/playlists/${PLAYLIST_ID}/items`, {
      user: OTHER_USER_ID,
      body: { kind: "track", id: TRACK_ID },
    });

    expect(status).toBe(403);
    expect(json.error).toMatch(/not your playlist/i);
    expect(h.state.playlists[0]!["items"]).toEqual([]);
  });

  it("404s when the playlist doesn't exist", async () => {
    const { status } = await call("POST", `/playlists/${MISSING_PLAYLIST_ID}/items`, {
      user: OWNER_USER_ID,
      body: { kind: "track", id: TRACK_ID },
    });

    expect(status).toBe(404);
  });

  it("404s an unpublished track — playlists ride published media only", async () => {
    const { status } = await call("POST", `/playlists/${PLAYLIST_ID}/items`, {
      user: OWNER_USER_ID,
      body: { kind: "track", id: DRAFT_TRACK_ID },
    });

    expect(status).toBe(404);
    expect(h.state.playlists[0]!["items"]).toEqual([]);
  });

  it("adds for the owner, never duplicates, and the read resolves it for the player", async () => {
    const first = await call("POST", `/playlists/${PLAYLIST_ID}/items`, {
      user: OWNER_USER_ID,
      body: { kind: "track", id: TRACK_ID },
    });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ ok: true, item_count: 1 });

    const again = await call("POST", `/playlists/${PLAYLIST_ID}/items`, {
      user: OWNER_USER_ID,
      body: { kind: "track", id: TRACK_ID },
    });
    expect(again.status).toBe(200);
    expect(again.json.item_count).toBe(1);

    /* The exact read the Booth's playPlaylist folds into the Shelf
       player: the stored {kind,id} comes back resolved, in order. */
    const read = await call("GET", `/playlists/${PLAYLIST_ID}`);
    expect(read.status).toBe(200);
    expect(read.json.playlist.resolved_items).toHaveLength(1);
    expect(read.json.playlist.resolved_items[0].kind).toBe("track");
    expect(read.json.playlist.resolved_items[0].item.title).toBe("King Anthem");
    expect(read.json.playlist.resolved_items[0].item.audio_url).toBe("audio/king-anthem.mp3");
  });
});
