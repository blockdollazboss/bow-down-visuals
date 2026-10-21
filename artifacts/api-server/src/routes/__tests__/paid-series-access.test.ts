/**
 * Paid Series (0192) — the READ side: episode access on every surface.
 *
 * A kind='series' playlist with price_cents > 0 is an unlock sold on the
 * digital store rail; the completed digital_sales row IS the entitlement.
 * These tests pin the access law end to end:
 *   - anonymous / non-buyer: locked episodes arrive WITHOUT playable URLs
 *     on the playlist page payload, the profile media listing, and the
 *     media detail endpoints (403 with the buy pointer);
 *   - the ONE creator-marked preview episode plays free for everyone;
 *   - a completed buyer is unlocked everywhere; a REFUNDED buyer is
 *     locked again (the 0183 clawback's status flip is the whole lock);
 *   - the owner always has full access;
 *   - series settings (PATCH) are owner-only, price is series-only and
 *     creator-typed, preview must be an episode, order is reorder-only;
 *   - the buyer list answers the owner alone;
 *   - the Turbo Series Builder returns a draft and writes NOTHING — no
 *     reorder, no publish, no price — and its price band is labeled advice.
 *
 * Fake-db style mirrors playlists-mine.test.ts (real table objects via
 * importOriginal, rows matched off the rendered WHERE params), extended
 * with digital_sales + update/insert chains. Auth is header-driven for
 * BOTH requireAuth and optionalAuth: x-test-user seats the viewer.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_USER = "20000000-0000-4000-8000-000000000001";
const BUYER_USER = "20000000-0000-4000-8000-000000000002";
const REFUNDED_USER = "20000000-0000-4000-8000-000000000003";
const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const BUYER_PROFILE = "12121212-1212-4121-8121-121212121212";
const REFUNDED_PROFILE = "13131313-1313-4131-8131-131313131313";
const V_PREVIEW = "21212121-2121-4121-8121-212121212121";
const V_SECOND = "22222222-2222-4222-8222-222222222222";
const T_THIRD = "23232323-2323-4232-8232-232323232323";
const SERIES_ID = "31313131-3131-4131-8131-313131313131";
const FREE_SERIES_ID = "32323232-3232-4232-8232-323232323232";
const MIX_ID = "33333333-3333-4333-8333-333333333333";
const NEW_PLAYLIST_ID = "34343434-3434-4343-8343-343434343434";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, any>>,
    playlists: [] as Array<Record<string, any>>,
    tracks: [] as Array<Record<string, any>>,
    videos: [] as Array<Record<string, any>>,
    sales: [] as Array<Record<string, any>>,
  },
  ai: {
    mode: "ok" as "ok" | "throw",
    content: "{}",
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

/* Soft auth (lib/optional-auth) is header-driven here too: x-test-user
   seats the viewer identity exactly like the requireAuth mock above. */
vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const user = req.headers["x-test-user"];
    if (typeof user === "string" && user) req.userId = user;
  },
}));

vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

vi.mock("../generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  baseUrlForEmail: () => "https://example.com",
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("../../lib/job-notifications", () => ({
  createJobNotification: async () => undefined,
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => {
    if (h.ai.mode === "throw") {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: h.ai.content } }],
          }),
        },
      },
    };
  },
  getTextModel: () => "gpt-test",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable, playlistsTable, profileTracksTable,
    profileVideosTable, digitalSalesTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): Array<Record<string, any>> {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes('"slug"')) return state.profiles.filter((p) => p.slug === params[0]);
      if (sql.includes('"user_id"')) return state.profiles.filter((p) => params.includes(p.userId));
      return state.profiles.filter((p) => params.includes(p.id));
    }
    if (table === playlistsTable) {
      if (sql.includes('"owner_profile_id"')) {
        return state.playlists.filter((p) => p.ownerProfileId === params[0]);
      }
      if (sql.includes('"price_cents"')) {
        return state.playlists.filter((p) => p.kind === "series" && (p.priceCents ?? 0) > 0);
      }
      return state.playlists.filter((p) => p.id === params[0]);
    }
    if (table === profileTracksTable || table === profileVideosTable) {
      const rows = table === profileTracksTable ? state.tracks : state.videos;
      if (sql.includes('"profile_id"')) {
        return rows.filter((r) => r.profileId === params[0] && r.isPublished);
      }
      return rows.filter((r) => params.includes(r.id));
    }
    if (table === digitalSalesTable) {
      if (sql.includes('"buyer_user_id"')) {
        return state.sales.filter((s) =>
          s.buyerUserId === params[0] && s.itemKind === "series"
          && s.status === "completed" && params.includes(s.itemId));
      }
      if (sql.includes('"profile_id"')) {
        return state.sales.filter((s) =>
          s.profileId === params[0] && s.itemKind === "series" && params.includes(s.itemId));
      }
      return [];
    }
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const rows = () => rowsFor(table, cond);
    return {
      limit: async (_n: number) => rows(),
      orderBy: (..._args: unknown[]) => ({
        limit: async (_n: number) => rows(),
        then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
      }),
      then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
    };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
    update: (table: unknown) => ({
      set: (obj: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            const { params } = render(cond);
            const row = state.playlists.find((p) => p.id === params[0]);
            if (!row) return [];
            Object.assign(row, obj);
            return [row];
          },
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (obj: Record<string, unknown>) => ({
        returning: async () => {
          const row: Record<string, any> = {
            id: NEW_PLAYLIST_ID,
            followerCount: 0,
            createdAt: new Date("2026-10-20T00:00:00.000Z"),
            ...obj,
          };
          state.playlists.push(row);
          return [row];
        },
      }),
    }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import router, {
  normalizeSeriesPrice, parseSeriesAssistResponse,
} from "../creator-platform";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
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

function profileRow(over: Partial<Record<string, any>> = {}): Record<string, any> {
  return {
    id: OWNER_PROFILE, userId: OWNER_USER, slug: "queen-creator",
    displayName: "Queen Creator", avatarUrl: null, vertical: "film",
    isPublic: true, pinnedKind: null, pinnedItemId: null, followerCount: 10,
    ...over,
  };
}

function videoRow(over: Partial<Record<string, any>> = {}): Record<string, any> {
  return {
    id: V_PREVIEW, profileId: OWNER_PROFILE, title: "Ep 1 — Cold Open",
    videoUrl: "https://cdn.example.com/ep1.mp4",
    thumbnailUrl: "https://cdn.example.com/ep1.jpg",
    description: "The premiere.", genre: "drama", tags: [],
    durationSec: 600, downloadPriceCents: 0, viewCount: 5, likeCount: 1,
    repostCount: 0, commentCount: 0, isPublished: true, isShort: false,
    season: 1, episode: 1, soundTrackId: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    ...over,
  };
}

function seriesRow(over: Partial<Record<string, any>> = {}): Record<string, any> {
  return {
    id: SERIES_ID, ownerProfileId: OWNER_PROFILE, title: "Crown City",
    description: "A season about power.", coverUrl: null, isPublic: true,
    kind: "series", priceCents: 1999,
    previewItem: { kind: "video", id: V_PREVIEW },
    items: [
      { kind: "video", id: V_PREVIEW },
      { kind: "video", id: V_SECOND },
      { kind: "track", id: T_THIRD },
    ],
    followerCount: 3,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    ...over,
  };
}

function saleRow(over: Partial<Record<string, any>> = {}): Record<string, any> {
  return {
    id: "41414141-4141-4141-8141-414141414141",
    buyerUserId: BUYER_USER, profileId: OWNER_PROFILE, itemKind: "series",
    itemId: SERIES_ID, stripeSessionId: "cs_test_series_1",
    amountCents: 1999, platformFeeCents: 100, creatorAmountCents: 1899,
    status: "completed", refundedAt: null,
    createdAt: new Date("2026-10-19T00:00:00.000Z"),
    ...over,
  };
}

function seed() {
  h.state.profiles = [
    profileRow(),
    profileRow({ id: BUYER_PROFILE, userId: BUYER_USER, slug: "fan-one", displayName: "Fan One", vertical: "music" }),
    profileRow({ id: REFUNDED_PROFILE, userId: REFUNDED_USER, slug: "gone-fan", displayName: "Gone Fan", vertical: "music" }),
  ];
  h.state.videos = [
    videoRow(),
    videoRow({
      id: V_SECOND, title: "Ep 2 — The Turn",
      videoUrl: "https://cdn.example.com/ep2.mp4",
      thumbnailUrl: "https://cdn.example.com/ep2.jpg",
      episode: 2, viewCount: 2,
    }),
  ];
  h.state.tracks = [{
    id: T_THIRD, profileId: OWNER_PROFILE, title: "Ep 3 — Audio Confessional",
    audioUrl: "https://cdn.example.com/ep3.mp3",
    artworkUrl: "https://cdn.example.com/ep3.jpg",
    genre: "drama", tags: [], durationSec: 900, downloadPriceCents: 0,
    playCount: 1, likeCount: 0, repostCount: 0, commentCount: 0,
    isPublished: true, createdAt: new Date("2026-10-01T00:00:00.000Z"),
  }];
  h.state.playlists = [
    seriesRow(),
    seriesRow({
      id: FREE_SERIES_ID, title: "Open Season Diaries", priceCents: null,
      previewItem: null, items: [{ kind: "video", id: V_SECOND }],
    }),
    seriesRow({
      id: MIX_ID, title: "Friday Mix", kind: "playlist", priceCents: null,
      previewItem: null, items: [{ kind: "track", id: T_THIRD }],
    }),
  ];
  h.state.sales = [
    saleRow(),
    saleRow({
      id: "42424242-4242-4242-8242-424242424242",
      buyerUserId: REFUNDED_USER, stripeSessionId: "cs_test_series_2",
      status: "refunded", refundedAt: new Date("2026-10-20T00:00:00.000Z"),
    }),
  ];
  h.ai.mode = "ok";
  h.ai.content = "{}";
}

beforeEach(seed);

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function itemOf(playlist: any, id: string) {
  return (playlist.resolved_items ?? []).find((r: any) => r.item?.id === id);
}

describe("GET /api/playlists/:id — the locked shelf", () => {
  it("anonymous: locked episodes carry no playable URL; the preview plays", async () => {
    const { status, json } = await call("GET", `/playlists/${SERIES_ID}`);
    expect(status).toBe(200);
    expect(json.playlist.series_access).toBe("locked");
    expect(json.playlist.is_paid_series).toBe(true);
    expect(json.playlist.price_cents).toBe(1999);
    expect(json.playlist.is_owner).toBe(false);

    const preview = itemOf(json.playlist, V_PREVIEW);
    expect(preview.locked).toBe(false);
    expect(preview.is_preview).toBe(true);
    expect(preview.item.video_url).toBe("https://cdn.example.com/ep1.mp4");

    const second = itemOf(json.playlist, V_SECOND);
    expect(second.locked).toBe(true);
    expect(second.is_preview).toBe(false);
    expect(second.item.video_url).toBe("");
    /* The shelf card survives: title + art still show. */
    expect(second.item.title).toBe("Ep 2 — The Turn");
    expect(second.item.thumbnail_url).toBe("https://cdn.example.com/ep2.jpg");

    const third = itemOf(json.playlist, T_THIRD);
    expect(third.locked).toBe(true);
    expect(third.item.audio_url).toBe("");
  });

  it("a completed buyer sees the whole season unlocked", async () => {
    const { json } = await call("GET", `/playlists/${SERIES_ID}`, { user: BUYER_USER });
    expect(json.playlist.series_access).toBe("purchased");
    expect(itemOf(json.playlist, V_SECOND).item.video_url).toBe("https://cdn.example.com/ep2.mp4");
    expect(itemOf(json.playlist, V_SECOND).locked).toBe(false);
    expect(itemOf(json.playlist, T_THIRD).item.audio_url).toBe("https://cdn.example.com/ep3.mp3");
  });

  it("a refunded buyer is locked again — the clawback's status flip is the lock", async () => {
    const { json } = await call("GET", `/playlists/${SERIES_ID}`, { user: REFUNDED_USER });
    expect(json.playlist.series_access).toBe("locked");
    expect(itemOf(json.playlist, V_SECOND).item.video_url).toBe("");
  });

  it("the owner reads their own shelf fully open, flagged as owner", async () => {
    const { json } = await call("GET", `/playlists/${SERIES_ID}`, { user: OWNER_USER });
    expect(json.playlist.series_access).toBe("owner");
    expect(json.playlist.is_owner).toBe(true);
    expect(itemOf(json.playlist, V_SECOND).item.video_url).toBe("https://cdn.example.com/ep2.mp4");
  });

  it("a free series locks nothing, for anyone", async () => {
    const { json } = await call("GET", `/playlists/${FREE_SERIES_ID}`);
    expect(json.playlist.series_access).toBe("free");
    expect(json.playlist.is_paid_series).toBe(false);
    expect(itemOf(json.playlist, V_SECOND).locked).toBe(false);
    expect(itemOf(json.playlist, V_SECOND).item.video_url).toBe("https://cdn.example.com/ep2.mp4");
  });

  it("GET /playlists/mine hands the owner their commerce fields", async () => {
    const { json } = await call("GET", "/playlists/mine", { user: OWNER_USER });
    const mine = json.playlists.find((p: any) => p.id === SERIES_ID);
    expect(mine.series_access).toBe("owner");
    expect(mine.price_cents).toBe(1999);
    expect(itemOf(mine, V_SECOND).item.video_url).toBe("https://cdn.example.com/ep2.mp4");
  });
});

describe("media detail + profile listing — the episode gate", () => {
  it("anonymous is refused a locked episode's detail, with the buy pointer", async () => {
    const { status, json } = await call("GET", `/media/video/${V_SECOND}`);
    expect(status).toBe(403);
    expect(json.locked).toBe(true);
    expect(json.series.id).toBe(SERIES_ID);
    expect(json.series.price_cents).toBe(1999);
    expect(json.series.buy_url).toBe(`/store/buy/series/${SERIES_ID}`);
  });

  it("the preview episode's detail is public", async () => {
    const { status, json } = await call("GET", `/media/video/${V_PREVIEW}`);
    expect(status).toBe(200);
    expect(json.video.video_url).toBe("https://cdn.example.com/ep1.mp4");
  });

  it("buyer passes the gate; refunded buyer does not", async () => {
    const bought = await call("GET", `/media/video/${V_SECOND}`, { user: BUYER_USER });
    expect(bought.status).toBe(200);
    expect(bought.json.video.video_url).toBe("https://cdn.example.com/ep2.mp4");

    const refunded = await call("GET", `/media/video/${V_SECOND}`, { user: REFUNDED_USER });
    expect(refunded.status).toBe(403);
  });

  it("the profile media listing withholds locked episode URLs too", async () => {
    const { status, json } = await call("GET", "/creator-profiles/queen-creator/media?kind=video");
    expect(status).toBe(200);
    const ep2 = json.items.find((i: any) => i.id === V_SECOND);
    expect(ep2.video_url).toBe("");
    expect(ep2.locked).toBe(true);
    expect(ep2.locked_series_id).toBe(SERIES_ID);
    const ep1 = json.items.find((i: any) => i.id === V_PREVIEW);
    expect(ep1.video_url).toBe("https://cdn.example.com/ep1.mp4");
  });
});

describe("PATCH /api/playlists/:id — series settings", () => {
  it("a non-owner cannot touch settings", async () => {
    const { status } = await call("PATCH", `/playlists/${SERIES_ID}`, {
      user: BUYER_USER, body: { price_cents: 1 },
    });
    expect(status).toBe(403);
  });

  it("the owner sets their own price on a free series", async () => {
    const { status, json } = await call("PATCH", `/playlists/${FREE_SERIES_ID}`, {
      user: OWNER_USER, body: { price_cents: 2999 },
    });
    expect(status).toBe(200);
    expect(json.playlist.price_cents).toBe(2999);
    expect(json.playlist.is_paid_series).toBe(true);
    /* Current viewers lock immediately: the free-series shelf is now priced. */
    const shelf = await call("GET", `/playlists/${FREE_SERIES_ID}`);
    expect(shelf.json.playlist.series_access).toBe("locked");
  });

  it("a price on a plain playlist is refused — series only", async () => {
    const { status, json } = await call("PATCH", `/playlists/${MIX_ID}`, {
      user: OWNER_USER, body: { price_cents: 999 },
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/Only a series/);
  });

  it("a price under the card floor is refused", async () => {
    const { status } = await call("PATCH", `/playlists/${SERIES_ID}`, {
      user: OWNER_USER, body: { price_cents: 25 },
    });
    expect(status).toBe(400);
  });

  it("the preview must be one of the series' own episodes", async () => {
    const bad = await call("PATCH", `/playlists/${SERIES_ID}`, {
      user: OWNER_USER,
      body: { preview_item: { kind: "video", id: "99999999-9999-4999-8999-999999999999" } },
    });
    expect(bad.status).toBe(400);

    const good = await call("PATCH", `/playlists/${SERIES_ID}`, {
      user: OWNER_USER,
      body: { preview_item: { kind: "video", id: V_SECOND } },
    });
    expect(good.status).toBe(200);
    expect(good.json.playlist.preview_item).toEqual({ kind: "video", id: V_SECOND });
    /* The new preview opens for everyone; the old one locks. */
    const shelf = await call("GET", `/playlists/${SERIES_ID}`);
    expect(itemOf(shelf.json.playlist, V_SECOND).is_preview).toBe(true);
    expect(itemOf(shelf.json.playlist, V_PREVIEW).locked).toBe(true);
  });

  it("episode order applies as a pure reorder — and only as one", async () => {
    const reordered = await call("PATCH", `/playlists/${SERIES_ID}`, {
      user: OWNER_USER,
      body: {
        items: [
          { kind: "track", id: T_THIRD },
          { kind: "video", id: V_SECOND },
          { kind: "video", id: V_PREVIEW },
        ],
      },
    });
    expect(reordered.status).toBe(200);
    expect(reordered.json.playlist.items.map((i: any) => i.id)).toEqual([T_THIRD, V_SECOND, V_PREVIEW]);

    const dropped = await call("PATCH", `/playlists/${SERIES_ID}`, {
      user: OWNER_USER,
      body: { items: [{ kind: "video", id: V_PREVIEW }] },
    });
    expect(dropped.status).toBe(400);
  });

  it("creating a priced series works; pricing a playlist at create is refused", async () => {
    const priced = await call("POST", "/playlists", {
      user: OWNER_USER,
      body: { title: "New Season", kind: "series", price_cents: 1500 },
    });
    expect(priced.status).toBe(201);
    expect(priced.json.playlist.price_cents).toBe(1500);

    const bad = await call("POST", "/playlists", {
      user: OWNER_USER,
      body: { title: "Mix Tape", kind: "playlist", price_cents: 1500 },
    });
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/playlists/:id/buyers — the creator's own list", () => {
  it("the owner sees buyers with identity, amounts, and refund state", async () => {
    const { status, json } = await call("GET", `/playlists/${SERIES_ID}/buyers`, { user: OWNER_USER });
    expect(status).toBe(200);
    expect(json.totals.buyers).toBe(1);
    expect(json.totals.gross_cents).toBe(1999);
    const buyer = json.buyers.find((b: any) => b.buyer_user_id === BUYER_USER);
    expect(buyer.display_name).toBe("Fan One");
    expect(buyer.slug).toBe("fan-one");
    expect(buyer.amount_cents).toBe(1999);
    expect(buyer.status).toBe("completed");
    const refunded = json.buyers.find((b: any) => b.buyer_user_id === REFUNDED_USER);
    expect(refunded.status).toBe("refunded");
  });

  it("nobody else can read the list — not even a buyer on it", async () => {
    const { status } = await call("GET", `/playlists/${SERIES_ID}/buyers`, { user: BUYER_USER });
    expect(status).toBe(403);
    const anon = await call("GET", `/playlists/${SERIES_ID}/buyers`);
    expect(anon.status).toBe(401);
  });
});

describe("Turbo Series Builder — a draft, never a deed", () => {
  function aiDraftContent() {
    return JSON.stringify({
      suggested_order: [`video:${V_SECOND}`, `track:${T_THIRD}`, `video:${V_PREVIEW}`],
      sales_copy: {
        headline: "Crown City: the whole first season",
        description: "Three episodes, one arc. Watch the premiere free, then own the season.",
      },
      trailer_shot_list: [
        { item: `video:${V_SECOND}`, moment: "the betrayal reveal, first 15 seconds", caption: "It was never about the money" },
        { item: "video:99999999-9999-4999-8999-999999999999", moment: "invented episode", caption: "dropped" },
      ],
    });
  }

  it("returns order + copy + shot-list + labeled price advice — and writes NOTHING", async () => {
    h.ai.content = aiDraftContent();
    const before = JSON.parse(JSON.stringify(h.state.playlists.find((p) => p.id === SERIES_ID)));

    const { status, json } = await call("POST", `/playlists/${SERIES_ID}/series-assist`, { user: OWNER_USER });
    expect(status).toBe(200);
    expect(json.draft).toBe(true);
    expect(json.applied).toBe(false);
    expect(json.suggested_order).toEqual([`video:${V_SECOND}`, `track:${T_THIRD}`, `video:${V_PREVIEW}`]);
    expect(json.sales_copy.headline).toContain("Crown City");
    /* The invented episode is dropped from the shot-list by the parser. */
    expect(json.trailer_shot_list).toHaveLength(1);
    expect(json.trailer_shot_list[0].item).toBe(`video:${V_SECOND}`);
    /* Advice is a band, labeled — never a price field on the series. */
    expect(json.price_advice.low_cents).toBe(499);
    expect(json.price_advice.high_cents).toBe(9999);
    expect(json.price_advice.label).toMatch(/Advice only/);
    expect(json.price_cents).toBeUndefined();

    const after = h.state.playlists.find((p) => p.id === SERIES_ID);
    expect(JSON.parse(JSON.stringify(after))).toEqual(before);
  });

  it("owner-only, series-only, and honest when the AI is down", async () => {
    const stranger = await call("POST", `/playlists/${SERIES_ID}/series-assist`, { user: BUYER_USER });
    expect(stranger.status).toBe(403);

    const mix = await call("POST", `/playlists/${MIX_ID}/series-assist`, { user: OWNER_USER });
    expect(mix.status).toBe(400);

    h.ai.mode = "throw";
    const down = await call("POST", `/playlists/${SERIES_ID}/series-assist`, { user: OWNER_USER });
    expect(down.status).toBe(503);
    expect(down.json.error).toBe("ai_unavailable");
  });
});

describe("price discipline + assist parser units", () => {
  it("normalizeSeriesPrice: creator-typed, series-only, floored, clearable", () => {
    expect(normalizeSeriesPrice(1999, "series")).toEqual({ ok: true, priceCents: 1999 });
    expect(normalizeSeriesPrice(0, "series")).toEqual({ ok: true, priceCents: null });
    expect(normalizeSeriesPrice(null, "series")).toEqual({ ok: true, priceCents: null });
    expect(normalizeSeriesPrice(1999, "playlist").ok).toBe(false);
    expect(normalizeSeriesPrice(49, "series").ok).toBe(false);
    expect(normalizeSeriesPrice(50, "series")).toEqual({ ok: true, priceCents: 50 });
  });

  it("parseSeriesAssistResponse keeps a full permutation and real items only", () => {
    const episodes = [
      { key: `video:${V_PREVIEW}`, kind: "video" as const, title: "A", season: 1, episode: 1, durationSec: 60, description: "" },
      { key: `video:${V_SECOND}`, kind: "video" as const, title: "B", season: 1, episode: 2, durationSec: 60, description: "" },
    ];
    const draft = parseSeriesAssistResponse(JSON.stringify({
      suggested_order: [`video:${V_SECOND}`, "video:nope"],
      sales_copy: { headline: "H", description: "D" },
      trailer_shot_list: [{ item: "video:nope", moment: "x", caption: "y" }],
    }), episodes);
    expect(draft.suggestedOrder).toEqual([`video:${V_SECOND}`, `video:${V_PREVIEW}`]);
    expect(draft.trailerShotList).toHaveLength(0);
  });
});
