/**
 * Route tests for the Creator Rooms world reads (Ring 2, item 3.5):
 *   GET /api/world/creator-rooms        the directory of rooms
 *   GET /api/world/creator-rooms/:slug  one room's data
 *
 * Publicness is the security boundary and these tests pin it
 * against the REAL mounted handler with a fake db:
 *  - only PUBLIC profiles ever appear — a private profile's room
 *    does not exist: not in the directory, and its slug 404s with
 *    the same answer an unknown slug gets;
 *  - the directory row is the camelCase world DTO (slug, display
 *    name, artwork, theme hues from theme_config, hasContent,
 *    occupantCount) — never a raw profile row;
 *  - the room's data carries the spotlight pin as the featured
 *    pick when it's published (a pin at a draft falls back to the
 *    newest published), the published-only music rail, the Front
 *    Row with private members filtered, and the storefront when
 *    the creator runs a shop;
 *  - unpublished tracks/videos never leak into the room.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
    court: [] as Array<Record<string, unknown>>,
    shops: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    royalCourtTable,
    shopsTable,
    worldEventsTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes('"slug"')) {
        const slug = String(params[0] ?? "");
        return state.profiles.filter((p) => p["slug"] === slug && p["isPublic"] === true);
      }
      if (sql.includes('"id"')) {
        const ids = params.map(String);
        return state.profiles.filter((p) => ids.includes(String(p["id"])));
      }
      if (sql.includes('"is_public"')) {
        return state.profiles.filter((p) => p["isPublic"] === true);
      }
      return [];
    }
    if (table === profileTracksTable || table === profileVideosTable) {
      const rows = table === profileTracksTable ? state.tracks : state.videos;
      if (sql.includes('"profile_id"')) {
        const profileId = String(params[0] ?? "");
        return rows.filter((r) => r["profileId"] === profileId && r["isPublished"] === true);
      }
      if (sql.includes('"is_published"')) {
        return rows.filter((r) => r["isPublished"] === true);
      }
      return [];
    }
    if (table === royalCourtTable) {
      const owner = String(params[0] ?? "");
      return state.court.filter((c) => c["ownerProfileId"] === owner);
    }
    if (table === shopsTable) {
      const userId = String(params[0] ?? "");
      return state.shops.filter((s) => s["user_id"] === userId);
    }
    if (table === worldEventsTable) {
      /* The office-hours read: room + kind + open statuses ride the
       * params in order; the handler picks the first whose window
       * hasn't ended, off startsAt order. */
      const roomId = String(params[0] ?? "");
      const kind = String(params[1] ?? "");
      const statuses = params.slice(2).map(String);
      return state.events
        .filter(
          (e) =>
            e["roomId"] === roomId && e["kind"] === kind && statuses.includes(String(e["status"])),
        )
        .sort((a, b) => String(a["startsAt"]).localeCompare(String(b["startsAt"])));
    }
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => rowsFor(table, cond);
          const chain: any = {
            limit: async (n: number) => rows().slice(0, n),
            orderBy: (..._args: unknown[]) => ({
              limit: async (n: number) => rows().slice(0, n),
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
          return chain;
        },
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router, {
  creatorRoomThemeFromConfig,
  pickFeaturedTrack,
  pickFeaturedVideo,
} from "../world";

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

const USER_NOVA = "00000000-0000-4000-8000-0000000000a1";
const PROFILE_NOVA = "11111111-1111-4111-8111-111111111111";
const PROFILE_PRIVATE = "22222222-2222-4222-8222-222222222222";
const PROFILE_EMPTY = "33333333-3333-4333-8333-333333333333";
const PROFILE_FAN = "44444444-4444-4444-8444-444444444444";
const TRACK_OLD = "55555555-5555-4555-8555-555555555555";
const TRACK_NEW = "66666666-6666-4666-8666-666666666666";
const TRACK_DRAFT = "77777777-7777-4777-8777-777777777777";
const VIDEO_PINNED = "88888888-8888-4888-8888-888888888888";
const VIDEO_DRAFT = "99999999-9999-4999-8999-999999999999";

function profileRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: PROFILE_NOVA,
    userId: USER_NOVA,
    slug: "nova-reyes",
    displayName: "Nova Reyes",
    bio: "Singer from the east wing.",
    avatarUrl: "https://cdn.example.com/nova.png",
    bannerUrl: "https://cdn.example.com/nova-banner.png",
    themeId: "gold-lux",
    themeConfig: {
      colors: { primary: "#aa2244", accent: "#ffcc88", background: "#100408" },
    },
    pinnedKind: null,
    pinnedItemId: null,
    isPublic: true,
    followerCount: 42,
    ...over,
  };
}

function trackRow(id: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    profileId: PROFILE_NOVA,
    title: `Track ${id.slice(0, 4)}`,
    audioUrl: `https://cdn.example.com/${id}.mp3`,
    artworkUrl: null,
    durationSec: 200,
    playCount: 5,
    likeCount: 4,
    commentCount: 1,
    isPublished: true,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    ...over,
  };
}

function videoRow(id: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    profileId: PROFILE_NOVA,
    title: `Video ${id.slice(0, 4)}`,
    videoUrl: `https://cdn.example.com/${id}.mp4`,
    thumbnailUrl: null,
    durationSec: 95,
    viewCount: 9,
    isPublished: true,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  h.state.profiles = [
    profileRow(),
    profileRow({
      id: PROFILE_PRIVATE,
      userId: "00000000-0000-4000-8000-0000000000b2",
      slug: "hidden-creator",
      displayName: "Hidden Creator",
      isPublic: false,
    }),
    profileRow({
      id: PROFILE_EMPTY,
      userId: "00000000-0000-4000-8000-0000000000c3",
      slug: "quiet-corner",
      displayName: "Quiet Corner",
      themeConfig: {},
    }),
    profileRow({
      id: PROFILE_FAN,
      userId: "00000000-0000-4000-8000-0000000000d4",
      slug: "fan-favorite",
      displayName: "Fan Favorite",
    }),
  ];
  h.state.tracks = [
    trackRow(TRACK_OLD, { title: "First Song" }),
    trackRow(TRACK_NEW, { title: "Newest Song" }),
    trackRow(TRACK_DRAFT, { title: "Secret Draft", isPublished: false }),
  ];
  h.state.videos = [
    videoRow(VIDEO_PINNED, { title: "The Big Video" }),
    videoRow(VIDEO_DRAFT, { title: "Unlisted Cut", isPublished: false }),
  ];
  h.state.court = [
    { ownerProfileId: PROFILE_NOVA, memberProfileId: PROFILE_FAN, position: 1 },
    { ownerProfileId: PROFILE_NOVA, memberProfileId: PROFILE_PRIVATE, position: 2 },
  ];
  h.state.shops = [
    { id: "shop-1", user_id: USER_NOVA, handle: "nova-goods", name: "Nova Goods" },
  ];
  h.state.events = [];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/world/creator-rooms — the rooms directory", () => {
  it("lists public creators' rooms as camelCase DTOs — private profiles never appear", async () => {
    const { status, json } = await get("/world/creator-rooms");
    expect(status).toBe(200);
    const slugs = json.rooms.map((r: any) => r.slug);
    expect(slugs).toContain("nova-reyes");
    expect(slugs).toContain("quiet-corner");
    expect(slugs).not.toContain("hidden-creator");
    const nova = json.rooms.find((r: any) => r.slug === "nova-reyes");
    expect(nova).toMatchObject({
      displayName: "Nova Reyes",
      roomName: "Nova Reyes's Room",
      avatarUrl: "https://cdn.example.com/nova.png",
      theme: { primary: "#aa2244", accent: "#ffcc88", background: "#100408" },
      hasContent: true,
      occupantCount: 0,
    });
    /* The DTO disease guard: no raw row fields on the wire. */
    expect(nova.userId).toBeUndefined();
    expect(nova.theme_config).toBeUndefined();
    const quiet = json.rooms.find((r: any) => r.slug === "quiet-corner");
    expect(quiet.hasContent).toBe(false);
    /* An empty theme_config wears the house gold, not a crash. */
    expect(quiet.theme.primary).toBe("#d4af37");
  });
});

describe("GET /api/world/creator-rooms/:slug — one room's data", () => {
  it("404s an unknown slug and a private profile with the same honest answer", async () => {
    const unknown = await get("/world/creator-rooms/no-such-creator");
    expect(unknown.status).toBe(404);
    const priv = await get("/world/creator-rooms/hidden-creator");
    expect(priv.status).toBe(404);
    expect(priv.json.error).toBe(unknown.json.error);
  });

  it("carries the room: featured picks, the published rail, the Front Row, the storefront", async () => {
    const { status, json } = await get("/world/creator-rooms/nova-reyes");
    expect(status).toBe(200);
    const room = json.room;
    expect(room).toMatchObject({
      roomId: "creator:nova-reyes",
      slug: "nova-reyes",
      displayName: "Nova Reyes",
      roomName: "Nova Reyes's Room",
      followerCount: 42,
      occupantCount: 0,
    });
    /* No pin: the featured picks are the newest published of each
     * kind; drafts are nowhere in the room. */
    expect(room.featuredTrack.title).toBe("First Song");
    expect(room.featuredVideo.title).toBe("The Big Video");
    expect(room.featuredVideo.videoUrl).toBe(`https://cdn.example.com/${VIDEO_PINNED}.mp4`);
    expect(room.tracks.map((t: any) => t.id)).toEqual([TRACK_OLD, TRACK_NEW]);
    expect(JSON.stringify(room)).not.toContain("Secret Draft");
    expect(JSON.stringify(room)).not.toContain("Unlisted Cut");
    /* The Front Row: public members only — the private profile in
     * seat 2 is filtered, the seat-1 fan stands. */
    expect(room.frontRow).toEqual([
      {
        position: 1,
        profileId: PROFILE_FAN,
        slug: "fan-favorite",
        displayName: "Fan Favorite",
        avatarUrl: "https://cdn.example.com/nova.png",
      },
    ]);
    expect(room.storefront).toEqual({ id: "shop-1", handle: "nova-goods", name: "Nova Goods" });
  });

  it("a creator with no shop and no court reads honest nulls and empty rails", async () => {
    const { status, json } = await get("/world/creator-rooms/quiet-corner");
    expect(status).toBe(200);
    expect(json.room.storefront).toBeNull();
    expect(json.room.frontRow).toEqual([]);
    expect(json.room.tracks).toEqual([]);
    expect(json.room.featuredTrack).toBeNull();
    expect(json.room.featuredVideo).toBeNull();
  });
});

describe("office hours on the room's data (UPGRADE-PROGRAM 3.7)", () => {
  const HOUR = 3600_000;
  function officeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    const start = Date.now() + 2 * HOUR;
    return {
      id: "evt-oh-1",
      kind: "office_hours",
      roomId: "creator:nova-reyes",
      hostUserId: USER_NOVA,
      title: "Office hours — ask me anything",
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + HOUR).toISOString(),
      payload: { note: "Mixing questions welcome" },
      status: "scheduled",
      createdAt: new Date(Date.now() - HOUR).toISOString(),
      ...over,
    };
  }

  it("no booked session reads as an honest null", async () => {
    const { status, json } = await get("/world/creator-rooms/nova-reyes");
    expect(status).toBe(200);
    expect(json.room.officeHours).toBeNull();
  });

  it("an upcoming session rides the DTO with its agenda line, state from the window", async () => {
    h.state.events = [officeRow()];
    const { json } = await get("/world/creator-rooms/nova-reyes");
    expect(json.room.officeHours).toMatchObject({
      id: "evt-oh-1",
      title: "Office hours — ask me anything",
      note: "Mixing questions welcome",
      state: "upcoming",
    });
  });

  it("a session whose window holds the clock reads in-session", async () => {
    const now = Date.now();
    h.state.events = [
      officeRow({
        status: "live",
        startsAt: new Date(now - 30 * 60_000).toISOString(),
        endsAt: new Date(now + 30 * 60_000).toISOString(),
      }),
    ];
    const { json } = await get("/world/creator-rooms/nova-reyes");
    expect(json.room.officeHours.state).toBe("in-session");
  });

  it("ended, cancelled, other-room and other-kind rows never name this room's hours", async () => {
    const now = Date.now();
    h.state.events = [
      officeRow({
        id: "evt-ended",
        startsAt: new Date(now - 3 * HOUR).toISOString(),
        endsAt: new Date(now - 2 * HOUR).toISOString(),
        status: "live",
      }),
      officeRow({ id: "evt-cancelled", status: "cancelled" }),
      officeRow({ id: "evt-other-room", roomId: "creator:fan-favorite" }),
      officeRow({ id: "evt-other-kind", kind: "drop" }),
    ];
    const { json } = await get("/world/creator-rooms/nova-reyes");
    expect(json.room.officeHours).toBeNull();
  });

  it("the soonest open session wins when two stand", async () => {
    const now = Date.now();
    h.state.events = [
      officeRow({
        id: "evt-later",
        title: "Later hours",
        startsAt: new Date(now + 5 * HOUR).toISOString(),
        endsAt: new Date(now + 6 * HOUR).toISOString(),
      }),
      officeRow({ id: "evt-sooner", title: "Sooner hours" }),
    ];
    const { json } = await get("/world/creator-rooms/nova-reyes");
    expect(json.room.officeHours.id).toBe("evt-sooner");
  });
});

describe("the featured picks (pure)", () => {
  it("the spotlight pin wins when published; a pin at a draft falls back to newest published", () => {
    const videos = [videoRow(VIDEO_PINNED), videoRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")] as never[];
    const pinnedProfile = { pinnedKind: "video" as const, pinnedItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    expect(pickFeaturedVideo(pinnedProfile, videos)?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const draftPin = { pinnedKind: "video" as const, pinnedItemId: VIDEO_DRAFT };
    expect(pickFeaturedVideo(draftPin, videos)?.id).toBe(VIDEO_PINNED);
    const noPin = { pinnedKind: null, pinnedItemId: null };
    expect(pickFeaturedVideo(noPin, [])).toBeNull();

    const tracks = [trackRow(TRACK_OLD), trackRow(TRACK_NEW)] as never[];
    const trackPin = { pinnedKind: "track" as const, pinnedItemId: TRACK_NEW };
    expect(pickFeaturedTrack(trackPin, tracks)?.id).toBe(TRACK_NEW);
    expect(pickFeaturedTrack(noPin, tracks)?.id).toBe(TRACK_OLD);
  });

  it("theme hues validate as hex and fall back to the house gold per-field", () => {
    expect(creatorRoomThemeFromConfig({ colors: { primary: "red", accent: "#123456" } })).toEqual({
      primary: "#d4af37",
      accent: "#123456",
      background: "#0d0a04",
    });
    expect(creatorRoomThemeFromConfig(null).primary).toBe("#d4af37");
    expect(creatorRoomThemeFromConfig({}).background).toBe("#0d0a04");
  });
});
