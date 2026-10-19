/**
 * Stack-20 R2 item #20 (program 2.25) — route tests for
 * GET /creator-profiles/:slug/party-tables.
 *
 * The endpoint is the profile/stream home read for party tables:
 * the OPEN (lobby-phase) rooms homed to one creator profile, in the
 * exact PartyRoomDto shape GET /api/party/rooms serves the Kingdom
 * Board. These tests drive the REAL profile-website router over
 * the house fake-db harness, with rooms created through the REAL
 * shared PartyRooms manager (the same instance the routes share):
 *   - a room homed to the profile is listed, with its DTO intact;
 *   - the home is the room's stored profileSlug: at creation it
 *     defaults to the HOST's own profile — so a table the host
 *     homed to their stream still stands at their profile, its
 *     streamId carried on the DTO (the watch page's cut);
 *   - another creator's table is never listed here;
 *   - unknown slug and private profile both 404, like every public
 *     read on this router;
 *   - the read is public (no Authorization header is sent): a
 *     guest may SEE a table on a public profile. Taking the seat
 *     stays members-only at the summons + party socket, which are
 *     pinned by their own suites — this read seats nobody.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return (dialect.sqlToQuery(cond as never).params as unknown[]) ?? [];
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { creatorProfilesTable } = actual;
  const state = h.state;

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async (n: number) => {
            const params = cond !== undefined ? renderParams(cond) : [];
            const rows =
              table === creatorProfilesTable
                ? state.profiles.filter((p) => p["slug"] === params[0])
                : [];
            return rows.slice(0, n);
          },
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        }),
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

import profileWebsiteRouter from "../profile-website";
import { partyRooms } from "../party";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api", profileWebsiteRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedProfile(slug: string, overrides: Record<string, unknown> = {}) {
  h.state.profiles.push({
    id: `profile-${slug}`,
    userId: `user-${slug}`,
    slug,
    displayName: `Creator ${slug}`,
    isPublic: true,
    ...overrides,
  });
}

beforeEach(() => {
  h.state.profiles = [];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /creator-profiles/:slug/party-tables", () => {
  it("lists the open table homed to the profile — and only that profile's", async () => {
    seedProfile("table-host");
    seedProfile("other-host");
    const mine = partyRooms.createRoom(
      { userId: "user-table-host", displayName: "Table Host", avatarUrl: null, profileSlug: "table-host" },
      { game: "trivia" },
    );
    partyRooms.createRoom(
      { userId: "user-other-host", displayName: "Other Host", avatarUrl: null, profileSlug: "other-host" },
      { game: "duel" },
    );

    const { status, json } = await get("/creator-profiles/table-host/party-tables");
    expect(status).toBe(200);
    expect(json.rooms).toHaveLength(1);
    expect(json.rooms[0].code).toBe(mine.code);
    expect(json.rooms[0].game).toBe("trivia");
    expect(json.rooms[0].profileSlug).toBe("table-host");
    expect(json.rooms[0].phase).toBe("lobby");
  });

  it("a stream-homed table still stands at the host's profile, streamId on the DTO", async () => {
    seedProfile("stream-host");
    const room = partyRooms.createRoom(
      { userId: "user-stream-host", displayName: "Stream Host", avatarUrl: null, profileSlug: "stream-host" },
      { game: "trivia", streamId: "stream-42" },
    );

    const { status, json } = await get("/creator-profiles/stream-host/party-tables");
    expect(status).toBe(200);
    expect(json.rooms).toHaveLength(1);
    expect(json.rooms[0].code).toBe(room.code);
    expect(json.rooms[0].streamId).toBe("stream-42");
  });

  it("a creator with no open table gets an empty list, not an error", async () => {
    seedProfile("quiet-host");
    const { status, json } = await get("/creator-profiles/quiet-host/party-tables");
    expect(status).toBe(200);
    expect(json.rooms).toEqual([]);
  });

  it("unknown slug 404s", async () => {
    const { status } = await get("/creator-profiles/no-such-creator/party-tables");
    expect(status).toBe(404);
  });

  it("a private profile 404s — its tables are not a public read", async () => {
    seedProfile("private-host", { isPublic: false });
    partyRooms.createRoom(
      { userId: "user-private-host", displayName: "Private Host", avatarUrl: null, profileSlug: "private-host" },
      { game: "trivia" },
    );
    const { status } = await get("/creator-profiles/private-host/party-tables");
    expect(status).toBe(404);
  });
});
