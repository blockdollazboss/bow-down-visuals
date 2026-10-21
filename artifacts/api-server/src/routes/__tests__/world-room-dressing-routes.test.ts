/**
 * Creator Room dressing (THE-GAME Ring 4) — the mounted routes:
 *   GET /api/world/creator-rooms/:slug          carries the resolved dressing
 *   PUT /api/world/creator-rooms/:slug/dressing the owner's pick
 *
 * Pinned against the REAL handlers with a fake db:
 * - a visitor's room read carries the OWNER's stored pick (server
 *   resolution), and an unpicked room carries its band default
 *   with picked=false;
 * - the write is the owner's action only: no session → 401 (the
 *   requireAuth contract), a signed-in stranger → the room-isn't-
 *   open 404, and the stored pick never moves for either;
 * - the gate is max(earned, saved dial): above-earned picks are
 *   refused with the honest unlock reason unless the grandfather
 *   floor covers them;
 * - the pick persists into theme_config in place — the room's
 *   hues and everything else the config carries survive it.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    rankCounts: {} as Record<string, Record<string, number>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/* requireAuth stand-in with the real contract's shape (the
   world-my-music pattern): no session identity → 401; the
   x-test-user header plays the session's role. */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.headers["x-test-user"];
    if (typeof userId !== "string" || !userId) {
      res.status(401).json({ error: "Sign in first." });
      return;
    }
    req.userId = userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table !== creatorProfilesTable) return [];
    const { sql, params } = render(cond);
    if (sql.includes('"slug"')) {
      const slug = String(params[0] ?? "");
      const bySlug = state.profiles.filter((p) => p["slug"] === slug);
      /* The public reads filter is_public in the same breath;
         the dressing write looks the slug up alone (ownership is
         its filter) — mirror both shapes. */
      return sql.includes('"is_public"') ? bySlug.filter((p) => p["isPublic"] === true) : bySlug;
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
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          const { params } = render(cond);
          const row = state.profiles.find((p) => String(p["id"]) === String(params[0]));
          if (row) Object.assign(row, patch);
        },
      }),
    }),
    /* countRankSources: one statement, the user id its first
     * param — the counts row comes from the test's table. */
    execute: async (query: unknown) => {
      const { params } = render(query);
      const userId = String(params[0] ?? "");
      const counts = state.rankCounts[userId] ?? {};
      return {
        rows: [
          {
            published_tracks: counts["publishedTracks"] ?? 0,
            published_videos: counts["publishedVideos"] ?? 0,
            exports_done: counts["exports"] ?? 0,
            followers: counts["followers"] ?? 0,
            streams_hosted: counts["streamsHosted"] ?? 0,
            jar_tips: counts["jarTips"] ?? 0,
            stream_tips: counts["streamTips"] ?? 0,
            store_sales: counts["storeSales"] ?? 0,
            shop_sales: counts["shopSales"] ?? 0,
            memberships_sold: counts["membershipsSold"] ?? 0,
          },
        ],
      };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../world";
import { clearCreatorRankCache } from "../../lib/creator-rank";
import { ROOM_DRESSING_CONFIG_KEY } from "../../lib/world-room-dressing";

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
const USER_FAN = "00000000-0000-4000-8000-0000000000d4";
const PROFILE_NOVA = "11111111-1111-4111-8111-111111111111";

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

beforeEach(() => {
  clearCreatorRankCache();
  h.state.profiles = [profileRow()];
  /* Nova has published 10 tracks = 100 rank points = ★3 Gangster. */
  h.state.rankCounts = { [USER_NOVA]: { publishedTracks: 10 } };
});

function novaConfig(): Record<string, unknown> {
  return h.state.profiles[0]!["themeConfig"] as Record<string, unknown>;
}

async function getRoom(slug = "nova-reyes"): Promise<any> {
  const res = await fetch(`${baseUrl}/world/creator-rooms/${slug}`);
  return { status: res.status, body: await res.json() };
}

async function putDressing(
  slug: string,
  payload: Record<string, unknown>,
  userId?: string,
): Promise<any> {
  const res = await fetch(`${baseUrl}/world/creator-rooms/${slug}/dressing`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

describe("GET the room — the dressing a visitor sees", () => {
  it("an unpicked room carries its band default, marked unpicked", async () => {
    const { status, body } = await getRoom();
    expect(status).toBe(200);
    expect(body.room.evolution.stars).toBe(3);
    expect(body.room.dressing).toEqual({
      variantId: "t3-classic",
      band: 3,
      name: "Gangster Classic",
      palette: "house",
      trimStyle: "bar",
      bannerStyle: "flank",
      picked: false,
    });
  });

  it("a stored pick is what the visitor's read carries — the owner's choice, resolved server-side", async () => {
    h.state.profiles = [
      profileRow({
        themeConfig: {
          colors: { primary: "#aa2244", accent: "#ffcc88", background: "#100408" },
          [ROOM_DRESSING_CONFIG_KEY]: "t2-regal",
        },
      }),
    ];
    const { status, body } = await getRoom();
    expect(status).toBe(200);
    expect(body.room.dressing.variantId).toBe("t2-regal");
    expect(body.room.dressing.picked).toBe(true);
    expect(body.room.dressing.palette).toBe("gilded");
  });
});

describe("PUT the dressing — the owner's action only", () => {
  it("no session → 401, and nothing is stored", async () => {
    const { status } = await putDressing("nova-reyes", { variantId: "t3-bold" });
    expect(status).toBe(401);
    expect(novaConfig()[ROOM_DRESSING_CONFIG_KEY]).toBeUndefined();
  });

  it("a signed-in stranger gets the closed door and changes nothing", async () => {
    const { status, body } = await putDressing(
      "nova-reyes",
      { variantId: "t1-classic" },
      USER_FAN,
    );
    expect(status).toBe(404);
    expect(body.error).toContain("isn't open");
    expect(novaConfig()[ROOM_DRESSING_CONFIG_KEY]).toBeUndefined();
  });

  it("an unknown slug is the same closed door, even signed in", async () => {
    const { status } = await putDressing("no-such-room", { variantId: "t1-classic" }, USER_NOVA);
    expect(status).toBe(404);
  });

  it("the owner picks inside their band; the answer is the resolved dressing and the read agrees", async () => {
    const put = await putDressing("nova-reyes", { variantId: "t3-bold" }, USER_NOVA);
    expect(put.status).toBe(200);
    expect(put.body.dressing.variantId).toBe("t3-bold");
    expect(put.body.dressing.picked).toBe(true);

    expect(novaConfig()[ROOM_DRESSING_CONFIG_KEY]).toBe("t3-bold");
    /* Merged in place: the room's hues survive the pick. */
    expect((novaConfig()["colors"] as any).primary).toBe("#aa2244");

    const { body } = await getRoom();
    expect(body.room.dressing.variantId).toBe("t3-bold");
    expect(body.room.dressing.palette).toBe("inverted");
  });

  it("the owner may also dress DOWN — a lower band is never locked", async () => {
    const put = await putDressing("nova-reyes", { variantId: "t1-regal" }, USER_NOVA);
    expect(put.status).toBe(200);
    expect(put.body.dressing.variantId).toBe("t1-regal");
  });

  it("a variant above the earned band is refused with the honest unlock reason", async () => {
    const put = await putDressing("nova-reyes", { variantId: "t5-regal" }, USER_NOVA);
    expect(put.status).toBe(403);
    expect(put.body.error).toContain("★5 Crime Boss");
    expect(novaConfig()[ROOM_DRESSING_CONFIG_KEY]).toBeUndefined();
  });

  it("the grandfather floor (saved dial) opens the higher band", async () => {
    const put = await putDressing(
      "nova-reyes",
      { variantId: "t5-regal", savedDial: 5 },
      USER_NOVA,
    );
    expect(put.status).toBe(200);
    expect(put.body.dressing.variantId).toBe("t5-regal");
    expect(novaConfig()[ROOM_DRESSING_CONFIG_KEY]).toBe("t5-regal");
  });

  it("an unknown variant is a 400, even for the owner", async () => {
    const put = await putDressing("nova-reyes", { variantId: "solid-gold" }, USER_NOVA);
    expect(put.status).toBe(400);
    expect(novaConfig()[ROOM_DRESSING_CONFIG_KEY]).toBeUndefined();
  });
});
