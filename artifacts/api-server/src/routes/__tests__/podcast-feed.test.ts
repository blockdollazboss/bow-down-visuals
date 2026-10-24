/**
 * Route tests for the hosted podcast feed (Lane F10) — fake-db harness in
 * the style of creator-profile-public.test.ts: the real router runs over
 * seeded rows, storage helpers are stubbed to deterministic values, and
 * the served document is asserted as XML text.
 *
 * Pins:
 *  - GET /api/podcast-feed/:slug serves a spec-shaped feed built from the
 *    profile + its PUBLISHED tracks only (drafts never leak).
 *  - Enclosures carry the probed byte length and the stable door URL.
 *  - Unknown/private shows 404; the episode door 302s to a fresh signed URL.
 *  - /me + settings PUT round-trip through theme_config.podcastFeed
 *    without disturbing the rest of theme_config.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const PROFILE_ID = "00000000-0000-4000-8000-0000000000bb";
const TRACK_OK = "11111111-1111-4111-8111-111111111111";
const TRACK_DRAFT = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  state: {
    profile: {
      id: "00000000-0000-4000-8000-0000000000bb",
      userId: "00000000-0000-4000-8000-0000000000aa",
      slug: "test-show",
      displayName: "The Test Show",
      bio: "A show about testing.",
      avatarUrl: "https://cdn.test/avatar.jpg",
      bannerUrl: null,
      themeConfig: { colors: { bg: "#000" }, podcastFeed: { category: "Technology", explicit: true } },
      isPublic: true,
    } as Record<string, unknown> | null,
    tracks: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        profileId: "00000000-0000-4000-8000-0000000000bb",
        title: "Episode One",
        audioUrl: "supabase://generated-clips/u1/podcast/ep1.mp3",
        artworkUrl: null,
        genre: "Tech",
        tags: ["ai", "creators"],
        durationSec: 754,
        isPublished: true,
        createdAt: new Date("2026-10-20T12:00:00Z"),
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        profileId: "00000000-0000-4000-8000-0000000000bb",
        title: "Secret Draft",
        audioUrl: "supabase://generated-clips/u1/podcast/draft.mp3",
        artworkUrl: null,
        genre: null,
        tags: [],
        durationSec: 60,
        isPublished: false,
        createdAt: new Date("2026-10-21T12:00:00Z"),
      },
    ] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    next();
  },
}));

vi.mock("../../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    refreshSupabaseStorageUrl: async (v: string) => {
      if (/^https?:\/\//i.test(v)) return v;
      const parsed = actual.parseSupabaseStorageRefBucketed(v);
      if (parsed) return `https://signed.test/${parsed.bucket}/${parsed.objectPath}`;
      return v;
    },
  };
});

vi.mock("../../lib/r2-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    isR2Configured: () => true,
    r2ObjectSize: async (key: string) =>
      key.endsWith("ep1.mp3") ? { size: 12_345_678, contentType: "audio/mpeg" } : null,
  };
});

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "owner@test.dev" } } }),
      },
    },
  }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { creatorProfilesTable, profileTracksTable } = actual;
  const state = h.state;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const rendered = render(cond);
    const params = rendered.params.map(String);
    if (table === creatorProfilesTable) {
      const p = state.profile;
      if (!p) return [];
      return params.some((x) => x === p["slug"] || x === p["userId"]) ? [p] : [];
    }
    if (table === profileTracksTable) {
      const publishedOnly = rendered.sql.includes("is_published");
      const pool = publishedOnly
        ? state.tracks.filter((t) => t["isPublished"] === true)
        : state.tracks;
      const byId = pool.find((t) => params.includes(String(t["id"])));
      if (byId && params.length >= 2) return [byId];
      // A query that names a track id which the pool filtered out (the
      // draft at the door) is a miss — never fall through to the list.
      if (state.tracks.some((t) => params.includes(String(t["id"])))) return [];
      return pool.filter((t) => params.includes(String(t["profileId"])));
    }
    return [];
  }

  const chain = (table: unknown, cond: unknown): any => ({
    limit: async (_n: number) => rowsFor(table, cond),
    orderBy: (..._a: unknown[]) => ({
      limit: async (_n: number) => rowsFor(table, cond),
    }),
    then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
  });

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(payload);
          if (state.profile && payload["themeConfig"]) {
            state.profile["themeConfig"] = payload["themeConfig"];
          }
          return [];
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

import podcastFeedRouter from "../podcast-feed";

let server: any;
let base = "";

beforeAll(async () => {
  delete process.env["R2_PUBLIC_URL"];
  delete process.env["MEDIA_CDN_URL"];
  const app = express();
  app.use(express.json());
  app.use("/api", podcastFeedRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/podcast-feed/:slug", () => {
  it("serves the show feed with published episodes only and truthful enclosures", async () => {
    const res = await fetch(`${base}/api/podcast-feed/test-show`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain("<title>The Test Show</title>");
    expect(xml).toContain('<itunes:category text="Technology"/>');
    expect(xml).toContain("<itunes:explicit>true</itunes:explicit>");
    expect(xml).toContain("<itunes:email>owner@test.dev</itunes:email>");
    expect(xml).toContain("<title>Episode One</title>");
    expect(xml).not.toContain("Secret Draft");
    expect(xml).toContain(`length="12345678"`);
    expect(xml).toContain(
      `/api/podcast-feed/test-show/episodes/${TRACK_OK}.mp3`,
    );
    expect(xml).toContain(`<guid isPermaLink="true">https://bowdownvisuals.com/track/${TRACK_OK}</guid>`);
    expect(xml).toContain("<itunes:duration>12:34</itunes:duration>");
  });

  it("404s an unknown show", async () => {
    const res = await fetch(`${base}/api/podcast-feed/nope`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/podcast-feed/:slug/episodes/:file", () => {
  it("302s a published episode to a fresh signed URL", async () => {
    const res = await fetch(`${base}/api/podcast-feed/test-show/episodes/${TRACK_OK}.mp3`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://signed.test/generated-clips/u1/podcast/ep1.mp3",
    );
  });

  it("404s a draft episode at the door", async () => {
    const res = await fetch(`${base}/api/podcast-feed/test-show/episodes/${TRACK_DRAFT}.mp3`, {
      redirect: "manual",
    });
    expect(res.status).toBe(404);
  });
});

describe("/me + settings", () => {
  it("reports the feed URL, episode count and stored settings", async () => {
    const res = await fetch(`${base}/api/podcast-feed/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasProfile).toBe(true);
    expect(body.feedUrl).toBe("https://bowdownvisuals.com/api/podcast-feed/test-show");
    expect(body.episodeCount).toBe(1);
    expect(body.settings.category).toBe("Technology");
    expect(body.categories["Arts"]).toContain("Design");
  });

  it("saves settings into theme_config.podcastFeed without touching other keys, and clears a mismatched subcategory", async () => {
    const res = await fetch(`${base}/api/podcast-feed/me/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Show", category: "Technology", subcategory: "Improv" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.title).toBe("Renamed Show");
    expect(body.settings.subcategory).toBeUndefined();
    const saved = h.state.updates.at(-1)?.["themeConfig"] as any;
    expect(saved.colors).toEqual({ bg: "#000" });
    expect(saved.podcastFeed.title).toBe("Renamed Show");
    expect(saved.podcastFeed.explicit).toBe(true);
  });

  it("rejects an unknown category with 400", async () => {
    const res = await fetch(`${base}/api/podcast-feed/me/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "Not A Category" }),
    });
    expect(res.status).toBe(400);
  });
});
