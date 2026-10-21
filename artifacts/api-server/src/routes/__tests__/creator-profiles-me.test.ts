/**
 * Route tests for GET /api/creator-profiles/me (routes/creator-platform).
 *
 * THE REGRESSION: the route did not exist. The client's fetchMyProfile
 * (lib/artist-profiles.ts) GETs /api/creator-profiles/me and maps 404 to
 * null — but with no /me route, the request fell into GET
 * /creator-profiles/:slug with slug "me", 404'd, and every owner loaded
 * as profile-less in artist-setup / choose-artist even though their
 * profile exists. These tests drive the endpoint exactly the way the
 * client does, and pin the contract: owner's own profile through the
 * same toPublicProfile mapping its siblings use; 404 (→ client's null)
 * when the caller truly has no profile yet.
 *
 * Fake-db style mirrors creator-profile-public.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    profilesBySlug: new Map<string, Record<string, unknown>>(),
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000099";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = AUTH_USER_ID;
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
  const { creatorProfilesTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table === creatorProfilesTable) {
      const { sql, params } = render(cond);
      const key = String(params[0] ?? "");
      if (sql.includes('"user_id"')) {
        const row = state.profilesByUserId.get(key);
        return row ? [row] : [];
      }
      const row = state.profilesBySlug.get(key);
      return row ? [row] : [];
    }
    return [];
  }

  const fakeDb: any = {
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            const { params } = render(cond);
            const id = String(params[0] ?? "");
            for (const [userId, row] of state.profilesByUserId.entries()) {
              if ((row as Record<string, unknown>)["id"] === id) {
                const updated = { ...row, ...patch };
                state.profilesByUserId.set(userId, updated);
                return [updated];
              }
            }
            return [];
          },
        }),
      }),
    }),
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

beforeEach(() => {
  h.state.profilesByUserId = new Map();
  h.state.profilesBySlug = new Map();
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function put(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

/** The owner's row, carrying the 0085 column-default theme_config ({}). */
function ownerRow(): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: AUTH_USER_ID,
    slug: "my-corner",
    displayName: "My Corner",
    vertical: "music",
    streamSchedule: null,
    mediaKit: null,
    bio: "Owner bio.",
    avatarUrl: "/images/me.png",
    bannerUrl: null,
    themeId: "gold-lux",
    themeConfig: {},
    sections: [],
    featuredMedia: null,
    merchItems: [{ title: "Crown Tee", price: "$40" }],
    profileEvents: [{ title: "Listening Party", date: "2026-11-01" }],
    series: [{ title: "The Making Of", episodeCount: 4 }],
    socialPosts: [{ platform: "tiktok", caption: "new drop" }],
    socialLinks: null,
    topCreators: [],
    tipJarEnabled: true,
    aiDesign: null,
    isPublic: true,
    isOfficial: false,
    followerCount: 12,
    totalPlays: 34,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

describe("GET /api/creator-profiles/me — the owner's own profile", () => {
  it("returns the signed-in owner's profile through toPublicProfile (snake_case, completed theme)", async () => {
    h.state.profilesByUserId.set(AUTH_USER_ID, ownerRow());

    const { status, json } = await get("/creator-profiles/me");
    // fetchMyProfile accepts the bare profile or a { profile } wrapper.
    const profile = json?.profile ?? json;

    expect(status).toBe(200);
    expect(profile.slug).toBe("my-corner");
    expect(profile.display_name).toBe("My Corner");
    // user_id is declared on the client contract and consumed from THIS
    // payload: ProfileMembershipsSection's owner check compares
    // mine.user_id against the public page's creator id — toPublicProfile
    // omitted it, so the owner was never recognized on their own page.
    expect(profile.user_id).toBe(AUTH_USER_ID);
    // No referral code minted for the owner → null (fake db has no
    // referral_codes rows), the field the setup page's ?ref= hint reads.
    expect(profile.referral_code).toBeNull();
    expect(profile.is_public).toBe(true);
    expect(profile.follower_count).toBe(12);
    // Stored theme_config is the {} column default — the DTO must serve
    // the completed config, never the raw gap (the profile-crash fix).
    expect(profile.theme_config.colors.background).toBe("#0a0a0b");
    expect(profile.theme_config.banner.overlayOpacity).toBe(0.55);
  });

  it("404s when the caller has no profile yet (client maps that to null → setup flow)", async () => {
    const { status } = await get("/creator-profiles/me");

    expect(status).toBe(404);
  });

  it("PUT returns the public DTO (snake_case, completed theme, no camelCase keys)", async () => {
    h.state.profilesByUserId.set(AUTH_USER_ID, ownerRow());

    const { status, json } = await put("/creator-profiles/me", {
      display_name: "My Corner Renamed",
      is_public: true,
      theme_config: {},
    });

    expect(status).toBe(200);
    const profile = json.profile;
    // saveMyProfile types data.profile as the snake_case CreatorProfile and
    // artist-setup reads saved.is_public — the raw Drizzle row (displayName /
    // isPublic / themeConfig) made that undefined and blanked the editor.
    expect(profile.display_name).toBe("My Corner Renamed");
    expect(profile.is_public).toBe(true);
    expect(profile.theme_config.colors.background).toBe("#0a0a0b");
    expect(profile).not.toHaveProperty("displayName");
    expect(profile).not.toHaveProperty("isPublic");
    expect(profile).not.toHaveProperty("themeConfig");
  });

  it("PUT accepts + persists the extension lists, and GET returns them (0142, DE-20)", async () => {
    h.state.profilesByUserId.set(AUTH_USER_ID, ownerRow());

    const putResult = await put("/creator-profiles/me", {
      merch_items: [{ title: "Gold Chain Print", price: "$25" }],
      events: [{ title: "Album Release Night", date: "2026-12-01" }],
      series: [{ title: "Studio Diaries", episodeCount: 9 }],
      social_posts: [{ platform: "instagram", caption: "studio day" }],
    });
    expect(putResult.status).toBe(200);
    expect(putResult.json.profile.merch_items[0].title).toBe("Gold Chain Print");
    expect(putResult.json.profile.events[0].title).toBe("Album Release Night");
    expect(putResult.json.profile.series[0].episodeCount).toBe(9);
    expect(putResult.json.profile.social_posts[0].platform).toBe("instagram");

    const getResult = await get("/creator-profiles/me");
    expect(getResult.status).toBe(200);
    expect(getResult.json.merch_items[0].title).toBe("Gold Chain Print");
    expect(getResult.json.events[0].date).toBe("2026-12-01");
  });

  it("a PUT that omits the extension lists leaves the stored ones intact", async () => {
    h.state.profilesByUserId.set(AUTH_USER_ID, ownerRow());

    const { status, json } = await put("/creator-profiles/me", { bio: "New bio." });
    expect(status).toBe(200);
    expect(json.profile.merch_items[0].title).toBe("Crown Tee");
    expect(json.profile.events[0].title).toBe("Listening Party");
    expect(json.profile.series[0].title).toBe("The Making Of");
    expect(json.profile.social_posts[0].caption).toBe("new drop");
  });

  it("does not leak into the public :slug route — a stranger's slug still resolves publicly", async () => {
    const stranger = {
      ...ownerRow(),
      id: "22222222-2222-4222-8222-222222222222",
      userId: "44444444-4444-4444-8444-444444444444",
      slug: "someone-else",
      displayName: "Someone Else",
    };
    h.state.profilesBySlug.set("someone-else", stranger);

    const { status, json } = await get("/creator-profiles/someone-else");

    expect(status).toBe(200);
    expect(json.profile.slug).toBe("someone-else");
  });
});
