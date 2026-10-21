/**
 * Tests for release smartlink analytics + retargeting pixels
 * (migration 0186, competitor gap G2).
 *
 * Covers:
 * - POST /distribution/presave/:slug/view records exactly one view row
 *   (channel sanitized, coarse country from the CDN header, no IP)
 * - POST /distribution/presave/:slug/click records one row per tap for
 *   links that are really on the page (platform / video / store /
 *   social / bonus), and refuses — recording nothing — for keys that
 *   aren't on the release
 * - retargeting pixels: owner-only settings, platform ID shapes
 *   validated on save (invalid refused, stored value untouched), the
 *   public landing payload carries exactly the configured pixels, and
 *   clearing an ID returns it to null (nothing fires)
 * - GET /distribution/releases/:id/presave-stats linkAnalytics:
 *   aggregation + owner scoping (another creator's release 404s)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userCredits: 0,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = testState.userCredits;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-6-sol",
  getOpenAI: () => ({
    chat: { completions: { create: async () => { throw new Error("not used"); } } },
  }),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v),
  mirrorProjectScenes: vi.fn(async (v: unknown) => v),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

import router, { PLATFORM_LABEL, cleanPixelId } from "../generate/distribution";
import { createTestDb } from "../../lib/__tests__/test-db";
import { DataType } from "pg-mem";
import { sql } from "drizzle-orm";

/* Mirror of distribution.test.ts's releases DDL + migration 0186 columns. */
const RELEASES_DDL = `
CREATE TABLE distribution_releases (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  artist_name text NOT NULL,
  release_date text,
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_url text,
  artwork_url text,
  metadata jsonb,
  strategy jsonb,
  status text NOT NULL DEFAULT 'draft',
  credits_charged integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  release_type text NOT NULL DEFAULT 'single',
  isrc text,
  genre text,
  explicit boolean NOT NULL DEFAULT false,
  explicit_declared boolean NOT NULL DEFAULT false,
  upc text,
  label text,
  copyright_line text,
  song_id uuid,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  aggregator text NOT NULL DEFAULT 'none',
  aggregator_release_id text,
  platform_statuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  presave_slug text,
  split_share_slug text,
  upc_kind text NOT NULL DEFAULT 'internal',
  label_imprint text,
  copyright_c_line text,
  copyright_p_line text,
  subgenre text,
  original_release_date text,
  preorder_date text,
  territories_mode text NOT NULL DEFAULT 'worldwide',
  territories jsonb NOT NULL DEFAULT '[]'::jsonb,
  presave_headline text,
  presave_platform_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  presave_bonus_url text,
  meta_pixel_id text,
  tiktok_pixel_id text,
  google_tag_id text
);`;

const PRESAVE_TABLES_DDL = `
CREATE TABLE presave_follows (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL,
  email text NOT NULL,
  name text,
  platform text,
  source text NOT NULL DEFAULT 'presave',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, email)
);
CREATE TABLE presave_shares (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL,
  channel text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE release_landing_content (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL,
  user_id uuid NOT NULL,
  video_url text,
  store_url text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

/* Migration 0186, pg-mem form. */
const CLICKS_DDL = `
CREATE TABLE release_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'click',
  link_key text NOT NULL DEFAULT '',
  link_title text NOT NULL DEFAULT '',
  channel text,
  referrer text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const USER_A = randomUUID();
const USER_B = randomUUID();

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

beforeEach(async () => {
  const { db, mem } = createTestDb();
  /* pg-mem needs gen_random_uuid registered before it can parse the
     DEFAULT on release_link_clicks.id (house pattern). */
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(RELEASES_DDL);
  mem.public.none(PRESAVE_TABLES_DDL);
  mem.public.none(CLICKS_DDL);
  testState.db = db;
  testState.userId = USER_A;
  testState.userCredits = 10000;
  vi.clearAllMocks();
});

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function seedSmartlink(
  userId: string,
  opts: { slug: string; links?: Record<string, string>; bonusUrl?: string | null },
): Promise<string> {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO distribution_releases
      (id, user_id, title, artist_name, status, presave_slug, presave_platform_links, presave_bonus_url)
    VALUES (${id}, ${userId}, ${"Test Track"}, ${"Test Artist"}, ${"draft"},
            ${opts.slug}, ${JSON.stringify(opts.links ?? {})}::jsonb, ${opts.bonusUrl ?? null})
  `);
  return id;
}

async function seedLanding(releaseId: string, userId: string, video: string | null, store: string | null, socials: Record<string, string>) {
  await testState.db.execute(sql`
    INSERT INTO release_landing_content (id, release_id, user_id, video_url, store_url, social_links)
    VALUES (${randomUUID()}, ${releaseId}, ${userId}, ${video}, ${store}, ${JSON.stringify(socials)}::jsonb)
  `);
}

async function clickRows(releaseId: string) {
  const r = await testState.db.execute(sql`
    SELECT kind, link_key, link_title, channel, country, user_id
    FROM release_link_clicks WHERE release_id = ${releaseId}
  `);
  return r.rows as Array<{
    kind: string; link_key: string; link_title: string;
    channel: string | null; country: string | null; user_id: string;
  }>;
}

/* ─── views + clicks ──────────────────────────────────────────────────── */

describe("smartlink view + click recording", () => {
  it("records exactly one view row per view call, with sanitized channel + coarse country", async () => {
    const id = await seedSmartlink(USER_A, { slug: "gold1", links: { spotify: "https://open.spotify.com/track/x" } });
    const res = await req("POST", "/distribution/presave/gold1/view", { channel: "IG Story!!" }, { "cf-ipcountry": "us" });
    expect(res.status).toBe(200);
    const rows = await clickRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "view", link_key: "", channel: "igstory", country: "US", user_id: USER_A });
    const again = await req("POST", "/distribution/presave/gold1/view", {});
    expect(again.status).toBe(200);
    expect(await clickRows(id)).toHaveLength(2);
  });

  it("drops the unknown-country sentinel instead of storing it", async () => {
    const id = await seedSmartlink(USER_A, { slug: "gold2" });
    await req("POST", "/distribution/presave/gold2/view", {}, { "cf-ipcountry": "XX" });
    const rows = await clickRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.country).toBeNull();
  });

  it("records one click row per tap on a platform link, with the platform label", async () => {
    const id = await seedSmartlink(USER_A, {
      slug: "gold3",
      links: { spotify: "https://open.spotify.com/track/x", apple_music: "https://music.apple.com/x" },
    });
    const res = await req("POST", "/distribution/presave/gold3/click", { kind: "platform", key: "spotify", channel: "instagram" });
    expect(res.status).toBe(200);
    await req("POST", "/distribution/presave/gold3/click", { kind: "platform", key: "spotify" });
    const rows = await clickRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "click" && r.link_key === "spotify")).toBe(true);
    expect(rows[0]!.link_title).toBe((PLATFORM_LABEL as Record<string, string>)["spotify"]);
    expect(rows[0]!.channel).toBe("instagram");
  });

  it("refuses — and records nothing — for a platform that isn't on the release", async () => {
    const id = await seedSmartlink(USER_A, { slug: "gold4", links: { spotify: "https://open.spotify.com/track/x" } });
    const res = await req("POST", "/distribution/presave/gold4/click", { kind: "platform", key: "tidal" });
    expect(res.status).toBe(400);
    expect(await clickRows(id)).toHaveLength(0);
  });

  it("refuses a click key that tries to smuggle an arbitrary URL", async () => {
    const id = await seedSmartlink(USER_A, { slug: "gold5", links: { spotify: "https://open.spotify.com/track/x" } });
    const res = await req("POST", "/distribution/presave/gold5/click", { kind: "platform", key: "https://evil.example.com" });
    expect(res.status).toBe(400);
    expect(await clickRows(id)).toHaveLength(0);
  });

  it("records video / store / social / bonus clicks from the landing extras", async () => {
    const id = await seedSmartlink(USER_A, { slug: "gold6", bonusUrl: "https://example.com/bonus" });
    await seedLanding(id, USER_A, "https://example.com/v.mp4", "https://example.com/store", { instagram: "https://instagram.com/a" });
    expect((await req("POST", "/distribution/presave/gold6/click", { kind: "video" })).status).toBe(200);
    expect((await req("POST", "/distribution/presave/gold6/click", { kind: "store" })).status).toBe(200);
    expect((await req("POST", "/distribution/presave/gold6/click", { kind: "social", key: "instagram" })).status).toBe(200);
    expect((await req("POST", "/distribution/presave/gold6/click", { kind: "bonus" })).status).toBe(200);
    const bad = await req("POST", "/distribution/presave/gold6/click", { kind: "social", key: "tiktok" });
    expect(bad.status).toBe(400);
    const rows = await clickRows(id);
    expect(rows.map((r) => r.link_key).sort()).toEqual(["bonus", "social:instagram", "store", "video"]);
  });

  it("404s view + click for an unknown slug", async () => {
    expect((await req("POST", "/distribution/presave/nope/view", {})).status).toBe(404);
    expect((await req("POST", "/distribution/presave/nope/click", { kind: "platform", key: "spotify" })).status).toBe(404);
  });
});

/* ─── retargeting pixels ──────────────────────────────────────────────── */

describe("retargeting pixel settings", () => {
  it("saves valid pixel IDs and the public landing carries exactly those", async () => {
    const id = await seedSmartlink(USER_A, { slug: "pix1" });
    const save = await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
    expect(save.status).toBe(200);
    expect(save.json.settings.pixels).toEqual({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
    const pub = await req("GET", "/distribution/presave/pix1");
    expect(pub.status).toBe(200);
    expect(pub.json.presave.pixels).toEqual({
      metaPixelId: "123456789012345",
      tiktokPixelId: "C9ABCDEFGHIJKLMN12",
      googleTagId: "G-ABC123XYZ9",
    });
  });

  it("a release with no pixels configured exposes all nulls (nothing fires)", async () => {
    await seedSmartlink(USER_A, { slug: "pix2" });
    const pub = await req("GET", "/distribution/presave/pix2");
    expect(pub.json.presave.pixels).toEqual({ metaPixelId: null, tiktokPixelId: null, googleTagId: null });
  });

  it("refuses an invalid pixel ID and leaves the stored value untouched", async () => {
    const id = await seedSmartlink(USER_A, { slug: "pix3" });
    const good = await req("PATCH", `/distribution/releases/${id}/presave-settings`, { metaPixelId: "123456789012345" });
    expect(good.status).toBe(200);
    const bad = await req("PATCH", `/distribution/releases/${id}/presave-settings`, { metaPixelId: "not-a-pixel" });
    expect(bad.status).toBe(400);
    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.json.settings.pixels.metaPixelId).toBe("123456789012345");
  });

  it("refuses invalid TikTok + Google IDs too", async () => {
    const id = await seedSmartlink(USER_A, { slug: "pix4" });
    expect((await req("PATCH", `/distribution/releases/${id}/presave-settings`, { tiktokPixelId: "!!" })).status).toBe(400);
    expect((await req("PATCH", `/distribution/releases/${id}/presave-settings`, { googleTagId: "12345" })).status).toBe(400);
  });

  it("clearing an ID with an empty string returns it to null", async () => {
    const id = await seedSmartlink(USER_A, { slug: "pix5" });
    await req("PATCH", `/distribution/releases/${id}/presave-settings`, { metaPixelId: "123456789012345" });
    const cleared = await req("PATCH", `/distribution/releases/${id}/presave-settings`, { metaPixelId: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.json.settings.pixels.metaPixelId).toBeNull();
    const pub = await req("GET", "/distribution/presave/pix5");
    expect(pub.json.presave.pixels.metaPixelId).toBeNull();
  });

  it("pixel settings are owner-scoped: another creator gets 404", async () => {
    const id = await seedSmartlink(USER_A, { slug: "pix6" });
    testState.userId = USER_B;
    const res = await req("PATCH", `/distribution/releases/${id}/presave-settings`, { metaPixelId: "123456789012345" });
    expect(res.status).toBe(404);
  });

  it("cleanPixelId: shape table", () => {
    expect(cleanPixelId("meta", "123456", null)).toEqual({ ok: true, value: "123456" });
    expect(cleanPixelId("meta", "12345", null).ok).toBe(false);
    expect(cleanPixelId("meta", "123456789012345678901", null).ok).toBe(false);
    expect(cleanPixelId("tiktok", "C9ABCDEFGHIJKLMN12", null).ok).toBe(true);
    expect(cleanPixelId("tiktok", "has spaces init", null).ok).toBe(false);
    expect(cleanPixelId("google", "AW-123456789", null).ok).toBe(true);
    expect(cleanPixelId("google", "GT-AB12CD", null).ok).toBe(true);
    expect(cleanPixelId("google", "XX-12345", null).ok).toBe(false);
    expect(cleanPixelId("meta", undefined, "999999")).toEqual({ ok: true, value: "999999" });
    expect(cleanPixelId("meta", "  ", "999999")).toEqual({ ok: true, value: null });
  });
});

/* ─── owner analytics aggregation ─────────────────────────────────────── */

describe("presave-stats linkAnalytics", () => {
  it("aggregates views, clicks, per-link, per-channel, per-country for the owner", async () => {
    const id = await seedSmartlink(USER_A, {
      slug: "agg1",
      links: { spotify: "https://open.spotify.com/track/x", apple_music: "https://music.apple.com/x" },
    });
    await req("POST", "/distribution/presave/agg1/view", { channel: "instagram" });
    await req("POST", "/distribution/presave/agg1/view", {});
    await req("POST", "/distribution/presave/agg1/click", { kind: "platform", key: "spotify", channel: "instagram" }, { "cf-ipcountry": "US" });
    await req("POST", "/distribution/presave/agg1/click", { kind: "platform", key: "spotify", channel: "instagram" }, { "cf-ipcountry": "US" });
    await req("POST", "/distribution/presave/agg1/click", { kind: "platform", key: "apple_music", channel: "tiktok" }, { "cf-ipcountry": "GB" });

    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.status).toBe(200);
    const la = stats.json.linkAnalytics;
    expect(la).not.toBeNull();
    expect(la.views).toBe(2);
    expect(la.clicks).toBe(3);
    expect(la.clicksLast7d).toBe(3);
    expect(la.perLink).toEqual(expect.arrayContaining([
      expect.objectContaining({ linkKey: "spotify", clicks: 2 }),
      expect.objectContaining({ linkKey: "apple_music", clicks: 1 }),
    ]));
    expect(la.perChannel).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "instagram", clicks: 2 }),
      expect.objectContaining({ channel: "tiktok", clicks: 1 }),
    ]));
    expect(la.perCountry).toEqual(expect.arrayContaining([
      expect.objectContaining({ country: "US", clicks: 2 }),
      expect.objectContaining({ country: "GB", clicks: 1 }),
    ]));
  });

  it("never shows another creator's release analytics (404, nothing leaks)", async () => {
    const id = await seedSmartlink(USER_A, { slug: "agg2", links: { spotify: "https://open.spotify.com/track/x" } });
    await req("POST", "/distribution/presave/agg2/click", { kind: "platform", key: "spotify" });
    testState.userId = USER_B;
    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.status).toBe(404);
    expect(stats.json.linkAnalytics).toBeUndefined();
  });

  it("an untouched release reports real zeros, not an error", async () => {
    const id = await seedSmartlink(USER_A, { slug: "agg3" });
    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.status).toBe(200);
    expect(stats.json.linkAnalytics).toMatchObject({ views: 0, clicks: 0, clicksLast7d: 0, perLink: [], perChannel: [], perCountry: [] });
  });
});
