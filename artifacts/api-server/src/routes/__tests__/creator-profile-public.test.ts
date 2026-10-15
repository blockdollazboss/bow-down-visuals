/**
 * Route tests for GET /api/creator-profiles/:slug (routes/creator-platform).
 *
 * THE REGRESSION: the public profile page (frontend artist-public.tsx)
 * renders a profile only when the payload's profile.is_public is truthy,
 * and maps ANY failure to its "This page doesn't exist — yet." state.
 * The endpoint's inline payload carried every other visibility field
 * (is_official, tip_jar_enabled, …) but never is_public — the sibling
 * serializer toPublicProfile has always included it — so EVERY public
 * profile, including the official Thy Cheat Code profile seeded by
 * migrations 0125/0126, rendered as non-existent for every visitor.
 * The handler 404s private profiles before the payload is built, so
 * is_public is always true at that point; the field simply has to be
 * present for the client contract to hold.
 *
 * These tests mount the real router over a fake db seeded with the
 * official profile's exact migration shape (0125/0126: sentinel owner,
 * slug thy-cheat-code, plain-path avatar/banner, is_public = true,
 * is_official = true) and run the REAL refreshSupabaseStorageUrlsDeep
 * (objectStorage is deliberately NOT mocked) so the read-path refresh
 * wrap is covered too: plain paths and ordinary URLs must come back
 * byte-identical.
 *
 * Fake-db style mirrors routes/__tests__/fan-contests-hardening.test.ts:
 * real table objects via importOriginal, WHERE params read back through
 * PgDialect rendering.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    profilesBySlug: new Map<string, Record<string, unknown>>(),
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
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
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    playlistsTable,
  } = actual;

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    if (table === creatorProfilesTable) {
      const slug = String(render(cond).params[0] ?? "");
      const row = state.profilesBySlug.get(slug);
      return row ? [row] : [];
    }
    if (fields && typeof fields === "object") {
      const keys = Object.keys(fields as Record<string, unknown>);
      if (keys.includes("trackCount")) return [{ trackCount: 0 }];
      if (keys.includes("videoCount")) return [{ videoCount: 0 }];
      if (keys.includes("playlistCount")) return [{ playlistCount: 0 }];
    }
    // tracks / videos / playlists / extras selects: no rows seeded.
    void profileTracksTable;
    void profileVideosTable;
    void playlistsTable;
    return [];
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, fields, cond),
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, fields, cond),
              then: (res: any, rej: any) =>
                Promise.resolve(rowsFor(table, fields, cond)).then(res, rej),
            }),
            then: (res: any, rej: any) =>
              Promise.resolve(rowsFor(table, fields, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router, { mirrorProfileMediaDeep } from "../creator-platform";

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

/** The official profile exactly as migrations 0125/0126 seed it. */
function officialProfileRow(): Record<string, unknown> {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId: "00000000-0000-4000-8000-000000000001",
    slug: "thy-cheat-code",
    displayName: "Thy Cheat Code",
    vertical: "influencer",
    streamSchedule: null,
    mediaKit: null,
    bio: "🦈 The King Shark — I run Bow Down Visuals, the content creation cheat code.",
    avatarUrl: "/images/shark-king-clean-authority.png",
    bannerUrl: "/bowdownvisuals-banner-sharkking.jpg",
    themeId: "gold-lux",
    themeConfig: null,
    sections: null,
    featuredMedia: null,
    socialLinks: { website: "https://bowdownvisuals.com" },
    topCreators: null,
    tipJarEnabled: false,
    aiDesign: null,
    isPublic: true,
    isVerified: true,
    isOfficial: true,
    followerCount: 0,
    totalPlays: 0,
    createdAt: new Date("2026-10-12T00:00:00.000Z"),
    updatedAt: new Date("2026-10-12T00:00:00.000Z"),
  };
}

beforeEach(() => {
  h.state.profilesBySlug = new Map();
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/creator-profiles/:slug — public profile contract", () => {
  it("serves the official profile to a guest WITH is_public in the payload", async () => {
    h.state.profilesBySlug.set("thy-cheat-code", officialProfileRow());

    const { status, json } = await get("/creator-profiles/thy-cheat-code");

    expect(status).toBe(200);
    expect(json.profile.slug).toBe("thy-cheat-code");
    // The regression pin: the page renders only when this is truthy.
    expect(json.profile.is_public).toBe(true);
    expect(json.profile.is_official).toBe(true);
    expect(json.profile.display_name).toBe("Thy Cheat Code");
    // Plain-path media passes the read-path refresh byte-identical.
    expect(json.profile.avatar_url).toBe("/images/shark-king-clean-authority.png");
    expect(json.profile.banner_url).toBe("/bowdownvisuals-banner-sharkking.jpg");
    expect(json.profile.social_links).toEqual({ website: "https://bowdownvisuals.com" });
    expect(json.counts).toEqual({ tracks: 0, videos: 0, playlists: 0 });
  });

  it("serves an ordinary public (non-official) profile with is_public too", async () => {
    const row = {
      ...officialProfileRow(),
      id: "33333333-3333-4333-8333-333333333333",
      userId: "44444444-4444-4444-8444-444444444444",
      slug: "some-creator",
      displayName: "Some Creator",
      isOfficial: false,
    };
    h.state.profilesBySlug.set("some-creator", row);

    const { status, json } = await get("/creator-profiles/some-creator");

    expect(status).toBe(200);
    expect(json.profile.is_public).toBe(true);
    expect(json.profile.is_official).toBe(false);
  });

 it("serves a COMPLETE theme_config when the stored row carries the column default ({})", async () => {
    // Migrations 0125/0126 seed the official profile without theme_config,
    // so the row holds the 0085 column default {}. The public page
    // dereferences theme_config nested (themeVars reads colors.*, the
    // hero reads banner.overlayOpacity) — serving {} verbatim threw on
    // render and landed the page on its error boundary.
    const row = { ...officialProfileRow(), themeConfig: {} };
    h.state.profilesBySlug.set("thy-cheat-code", row);

    const { status, json } = await get("/creator-profiles/thy-cheat-code");

    expect(status).toBe(200);
    const tc = json.profile.theme_config;
    expect(tc.colors.background).toBe("#0a0a0b");
    expect(tc.colors.primary).toBe("#d4af37");
    expect(tc.fonts.heading).toBe("Cinzel");
    expect(tc.banner.overlayOpacity).toBe(0.55);
    expect(tc.spacing).toBe("comfortable");
    expect(tc.cornerRadius).toBe("sharp");
  });

  it("keeps a creator's own theme values and only fills the gaps", async () => {
    const row = {
      ...officialProfileRow(),
      slug: "custom-creator",
      themeConfig: { colors: { primary: "#ff0000" }, banner: { overlayOpacity: 0.2 } },
    };
    h.state.profilesBySlug.set("custom-creator", row);

    const { status, json } = await get("/creator-profiles/custom-creator");

    expect(status).toBe(200);
    const tc = json.profile.theme_config;
    expect(tc.colors.primary).toBe("#ff0000");
    expect(tc.colors.background).toBe("#0a0a0b");
    expect(tc.banner.overlayOpacity).toBe(0.2);
    expect(tc.banner.layout).toBe("full-bleed");
    expect(tc.fonts.body).toBe("Inter");
  });

  it("still 404s a private profile (server-side gate unchanged)", async () => {
    const row = { ...officialProfileRow(), slug: "quiet-creator", isPublic: false };
    h.state.profilesBySlug.set("quiet-creator", row);

    const { status } = await get("/creator-profiles/quiet-creator");

    expect(status).toBe(404);
  });

  it("404s an unknown slug", async () => {
    const { status } = await get("/creator-profiles/no-such-creator");

    expect(status).toBe(404);
  });
});

describe("mirrorProfileMediaDeep — plain-object guard", () => {
  /* The walker receives JSON-parsed bodies today (Dates cannot exist in
     them), but the guard is insurance: if a caller ever feeds it a
     server-built value, a Date must survive as a Date — Object.entries
     on a Date yields nothing, so an unguarded walk would rebuild it
     as {} and silently destroy it. */
  it("passes a nested Date through untouched", async () => {
    const when = new Date("2026-10-14T12:00:00.000Z");
    const out = await mirrorProfileMediaDeep({ kit: { releasedAt: when }, stamps: [when] }, "user-1");

    expect(out.kit.releasedAt).toBe(when);
    expect(out.kit.releasedAt).toBeInstanceOf(Date);
    expect(out.stamps[0]).toBe(when);
  });
});
