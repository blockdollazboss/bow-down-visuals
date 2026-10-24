/**
 * Tests for smartlink territory / language routing (Stack-100 #3 W3).
 *
 * Verified absent before the build (.lane/VERDICT.md): the CDN geo
 * header fed analytics only and Accept-Language was never read.
 *
 * Covers:
 * - the pure resolver: territory → language → default tiers, q-value
 *   preference order, regional tags collapsing to the primary subtag
 * - the cleaners: invalid country codes / language codes / URLs refuse
 *   the whole save, lowercase codes normalize, empty URL removes
 * - the public landing resolves a routed destination server-side from
 *   cf-ipcountry + Accept-Language; no match = payload's platform
 *   links untouched and routedDestination null (default tier)
 * - routed clicks are recorded through the existing click rail with
 *   the rule that fired in link_key (analytics, no schema change);
 *   a routed click that resolves to nothing records nothing
 * - settings are owner-scoped; a pre-migration install (routing
 *   columns absent) keeps every old behaviour and answers 503 only
 *   for a routing save
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

import router from "../generate/distribution";
import {
  cleanLanguageDestinations,
  cleanTerritoryDestinations,
  normalizeCountryCode,
  normalizeLanguageTag,
  parseAcceptLanguage,
  resolveSmartlinkDestination,
  sanitizeDestinationMap,
} from "../../lib/smartlink-routing";
import { createTestDb } from "../../lib/__tests__/test-db";
import { DataType } from "pg-mem";
import { sql } from "drizzle-orm";

function releasesDdl(withRouting: boolean): string {
  return `
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
  google_tag_id text${withRouting ? `,
  smartlink_territory_destinations jsonb NOT NULL DEFAULT '{}'::jsonb,
  smartlink_language_destinations jsonb NOT NULL DEFAULT '{}'::jsonb` : ""}
);`;
}

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

function setupDb(withRouting: boolean) {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(releasesDdl(withRouting));
  mem.public.none(PRESAVE_TABLES_DDL);
  mem.public.none(CLICKS_DDL);
  testState.db = db;
}

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
  setupDb(true);
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

const DE_URL = "https://music.example.de/track";
const JP_URL = "https://music.example.jp/track";
const ES_URL = "https://music.example.com/es/track";
const DEFAULT_LINKS = { spotify: "https://open.spotify.com/track/x" };

async function seedSmartlink(slug: string, links: Record<string, string> = DEFAULT_LINKS): Promise<string> {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO distribution_releases
      (id, user_id, title, artist_name, status, presave_slug, presave_platform_links)
    VALUES (${id}, ${USER_A}, ${"Test Track"}, ${"Test Artist"}, ${"draft"},
            ${slug}, ${JSON.stringify(links)}::jsonb)
  `);
  return id;
}

async function saveRouting(id: string) {
  const res = await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
    territoryDestinations: { DE: DE_URL, JP: JP_URL },
    languageDestinations: { es: ES_URL },
  });
  expect(res.status).toBe(200);
  return res;
}

async function clickRows(releaseId: string) {
  const r = await testState.db.execute(sql`
    SELECT kind, link_key, link_title, channel, country
    FROM release_link_clicks WHERE release_id = ${releaseId}
  `);
  return r.rows as Array<{ kind: string; link_key: string; link_title: string; channel: string | null; country: string | null }>;
}

/* ─── pure resolver ───────────────────────────────────────────────────── */

describe("smartlink-routing pure core", () => {
  it("normalizes country + language codes, rejects bent shapes", () => {
    expect(normalizeCountryCode("de")).toBe("DE");
    expect(normalizeCountryCode(" DE ")).toBe("DE");
    expect(normalizeCountryCode("XX")).toBeNull();
    expect(normalizeCountryCode("USA")).toBeNull();
    expect(normalizeCountryCode("D1")).toBeNull();
    expect(normalizeCountryCode("")).toBeNull();
    expect(normalizeLanguageTag("es")).toBe("es");
    expect(normalizeLanguageTag("ES-MX")).toBe("es");
    expect(normalizeLanguageTag("en_US")).toBe("en");
    expect(normalizeLanguageTag("e")).toBeNull();
    expect(normalizeLanguageTag("e1")).toBeNull();
    expect(normalizeLanguageTag("*")).toBeNull();
  });

  it("parses Accept-Language in q-value preference order", () => {
    expect(parseAcceptLanguage("es-ES,es;q=0.9,en;q=0.8")).toEqual(["es", "en"]);
    expect(parseAcceptLanguage("en;q=0.5,de;q=0.9")).toEqual(["de", "en"]);
    expect(parseAcceptLanguage("fr,fr-CA;q=0.8")).toEqual(["fr"]);
    expect(parseAcceptLanguage("de;q=0,es;q=0.5")).toEqual(["es"]);
    expect(parseAcceptLanguage("*,en;q=0.5")).toEqual(["en"]);
    expect(parseAcceptLanguage("")).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });

  it("resolves territory → language → default(null)", () => {
    const cfg = {
      territoryDestinations: { DE: DE_URL },
      languageDestinations: { es: ES_URL },
    };
    /* territory beats a matching language */
    expect(resolveSmartlinkDestination({ ...cfg, country: "DE", acceptLanguage: "es" }))
      .toEqual({ url: DE_URL, rule: "territory", country: "DE" });
    /* territory miss falls through to language */
    expect(resolveSmartlinkDestination({ ...cfg, country: "FR", acceptLanguage: "es-MX,es;q=0.9" }))
      .toEqual({ url: ES_URL, rule: "language", language: "es" });
    /* no country signal at all still reaches the language tier */
    expect(resolveSmartlinkDestination({ ...cfg, country: null, acceptLanguage: "es" }))
      .toEqual({ url: ES_URL, rule: "language", language: "es" });
    /* nothing matches → default */
    expect(resolveSmartlinkDestination({ ...cfg, country: "FR", acceptLanguage: "fr" })).toBeNull();
    expect(resolveSmartlinkDestination({ territoryDestinations: {}, languageDestinations: {}, country: "DE", acceptLanguage: "es" })).toBeNull();
    expect(resolveSmartlinkDestination({ territoryDestinations: null, languageDestinations: undefined, country: null, acceptLanguage: null })).toBeNull();
  });

  it("cleaners refuse invalid codes/URLs and normalize valid ones", () => {
    expect(cleanTerritoryDestinations(undefined, { DE: DE_URL })).toEqual({ ok: true, value: { DE: DE_URL } });
    expect(cleanTerritoryDestinations({ de: DE_URL }, {})).toEqual({ ok: true, value: { DE: DE_URL } });
    expect(cleanTerritoryDestinations({ USA: DE_URL }, {}).ok).toBe(false);
    expect(cleanTerritoryDestinations({ XX: DE_URL }, {}).ok).toBe(false);
    expect(cleanTerritoryDestinations({ DE: "ftp://example.com/x" }, {}).ok).toBe(false);
    expect(cleanTerritoryDestinations({ DE: "example.com/x" }, {}).ok).toBe(false);
    expect(cleanTerritoryDestinations({ DE: "https://ok.example/x", de: "https://ok.example/y" }, {}).ok).toBe(false);
    /* empty URL removes the entry */
    expect(cleanTerritoryDestinations({ DE: "" }, {})).toEqual({ ok: true, value: {} });

    expect(cleanLanguageDestinations({ "es-MX": ES_URL }, {})).toEqual({ ok: true, value: { es: ES_URL } });
    expect(cleanLanguageDestinations({ e: ES_URL }, {}).ok).toBe(false);
    expect(cleanLanguageDestinations({ es: "not a url" }, {}).ok).toBe(false);
    expect(cleanLanguageDestinations({ es: ES_URL, "es-ES": ES_URL }, {}).ok).toBe(false);
    expect(cleanLanguageDestinations({ es: "  " }, {})).toEqual({ ok: true, value: {} });
  });

  it("sanitizeDestinationMap drops bent stored entries", () => {
    expect(sanitizeDestinationMap({ DE: DE_URL, USA: DE_URL, JP: "javascript:alert(1)", FR: 42 }, "territory"))
      .toEqual({ DE: DE_URL });
    expect(sanitizeDestinationMap({ "es-MX": ES_URL, "!!": ES_URL }, "language")).toEqual({ es: ES_URL });
    expect(sanitizeDestinationMap(null, "territory")).toEqual({});
    expect(sanitizeDestinationMap([], "language")).toEqual({});
  });
});

/* ─── settings save ───────────────────────────────────────────────────── */

describe("smartlink routing settings", () => {
  it("saves normalized maps and reports them back in settings + stats", async () => {
    const id = await seedSmartlink("route-set1");
    const res = await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      territoryDestinations: { de: DE_URL },
      languageDestinations: { "ES-mx": ES_URL },
    });
    expect(res.status).toBe(200);
    expect(res.json.settings.territoryDestinations).toEqual({ DE: DE_URL });
    expect(res.json.settings.languageDestinations).toEqual({ es: ES_URL });
    expect(res.json.settings.routingReady).toBe(true);

    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.json.settings.territoryDestinations).toEqual({ DE: DE_URL });
    expect(stats.json.settings.languageDestinations).toEqual({ es: ES_URL });
  });

  it("refuses an invalid country code and leaves stored routing untouched", async () => {
    const id = await seedSmartlink("route-set2");
    await saveRouting(id);
    const bad = await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      territoryDestinations: { USA: DE_URL },
    });
    expect(bad.status).toBe(400);
    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.json.settings.territoryDestinations).toEqual({ DE: DE_URL, JP: JP_URL });
  });

  it("refuses invalid URLs and invalid language codes (nothing saved)", async () => {
    const id = await seedSmartlink("route-set3");
    expect((await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      territoryDestinations: { DE: "javascript:alert(1)" },
    })).status).toBe(400);
    expect((await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      languageDestinations: { e: ES_URL },
    })).status).toBe(400);
    expect((await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      languageDestinations: { es: "https://" },
    })).status).toBe(400);
    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.json.settings.territoryDestinations).toEqual({});
    expect(stats.json.settings.languageDestinations).toEqual({});
  });

  it("an empty URL removes that territory; a settings save without routing fields leaves routing as-is", async () => {
    const id = await seedSmartlink("route-set4");
    await saveRouting(id);
    const cleared = await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      territoryDestinations: { DE: "", JP: JP_URL },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.json.settings.territoryDestinations).toEqual({ JP: JP_URL });

    const headlineOnly = await req("PATCH", `/distribution/releases/${id}/presave-settings`, { headline: "New headline" });
    expect(headlineOnly.status).toBe(200);
    expect(headlineOnly.json.settings.territoryDestinations).toEqual({ JP: JP_URL });
    expect(headlineOnly.json.settings.languageDestinations).toEqual({ es: ES_URL });
  });

  it("routing settings are owner-scoped: another creator gets 404", async () => {
    const id = await seedSmartlink("route-set5");
    testState.userId = USER_B;
    const res = await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      territoryDestinations: { DE: DE_URL },
    });
    expect(res.status).toBe(404);
  });
});

/* ─── public landing resolution ───────────────────────────────────────── */

describe("smartlink landing territory/language resolution", () => {
  it("a DE fan gets the territory destination even when their language also matches", async () => {
    const id = await seedSmartlink("route-land1");
    await saveRouting(id);
    const pub = await req("GET", "/distribution/presave/route-land1", undefined, {
      "cf-ipcountry": "de",
      "accept-language": "es-ES,es;q=0.9",
    });
    expect(pub.status).toBe(200);
    expect(pub.json.presave.routing.routedDestination).toEqual({ url: DE_URL, rule: "territory", country: "DE" });
    /* default destination set is still there, unchanged */
    expect(pub.json.presave.platformLinks).toEqual(DEFAULT_LINKS);
  });

  it("a fan with no territory override falls through to the language destination", async () => {
    const id = await seedSmartlink("route-land2");
    await saveRouting(id);
    const pub = await req("GET", "/distribution/presave/route-land2", undefined, {
      "cf-ipcountry": "FR",
      "accept-language": "es-MX,es;q=0.9,en;q=0.5",
    });
    expect(pub.json.presave.routing.routedDestination).toEqual({ url: ES_URL, rule: "language", language: "es" });
  });

  it("no matching signal → routedDestination null and the payload's links are the defaults", async () => {
    const id = await seedSmartlink("route-land3");
    await saveRouting(id);
    const pub = await req("GET", "/distribution/presave/route-land3", undefined, {
      "cf-ipcountry": "FR",
      "accept-language": "fr-FR,fr;q=0.9",
    });
    expect(pub.json.presave.routing.routedDestination).toBeNull();
    expect(pub.json.presave.platformLinks).toEqual(DEFAULT_LINKS);
  });

  it("a release with no routing configured behaves exactly as today for every fan", async () => {
    await seedSmartlink("route-land4");
    const pub = await req("GET", "/distribution/presave/route-land4", undefined, {
      "cf-ipcountry": "DE",
      "accept-language": "es",
    });
    expect(pub.status).toBe(200);
    expect(pub.json.presave.routing.routedDestination).toBeNull();
    expect(pub.json.presave.platformLinks).toEqual(DEFAULT_LINKS);
  });

  it("the unknown-country sentinel (XX) never matches a territory", async () => {
    const id = await seedSmartlink("route-land5");
    await saveRouting(id);
    const pub = await req("GET", "/distribution/presave/route-land5", undefined, {
      "cf-ipcountry": "XX",
      "accept-language": "en",
    });
    expect(pub.json.presave.routing.routedDestination).toBeNull();
  });
});

/* ─── routed click analytics ──────────────────────────────────────────── */

describe("routed click recording", () => {
  it("records which rule fired (territory) in the existing per-link analytics", async () => {
    const id = await seedSmartlink("route-click1");
    await saveRouting(id);
    const res = await req("POST", "/distribution/presave/route-click1/click",
      { kind: "routed", channel: "instagram" },
      { "cf-ipcountry": "DE", "accept-language": "es" });
    expect(res.status).toBe(200);
    const rows = await clickRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "click", link_key: "routed:territory", link_title: "Territory route (DE)", country: "DE", channel: "instagram" });

    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.json.linkAnalytics.perLink).toEqual(expect.arrayContaining([
      expect.objectContaining({ linkKey: "routed:territory", linkTitle: "Territory route (DE)", clicks: 1 }),
    ]));
  });

  it("records a language-rule click when only the language matches", async () => {
    const id = await seedSmartlink("route-click2");
    await saveRouting(id);
    const res = await req("POST", "/distribution/presave/route-click2/click",
      { kind: "routed" },
      { "cf-ipcountry": "FR", "accept-language": "es-ES" });
    expect(res.status).toBe(200);
    const rows = await clickRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ link_key: "routed:language", link_title: "Language route (es)" });
  });

  it("a routed click that resolves to nothing is refused and records nothing", async () => {
    const id = await seedSmartlink("route-click3");
    await saveRouting(id);
    const res = await req("POST", "/distribution/presave/route-click3/click",
      { kind: "routed" },
      { "cf-ipcountry": "FR", "accept-language": "fr" });
    expect(res.status).toBe(400);
    expect(await clickRows(id)).toHaveLength(0);
  });

  it("the client cannot smuggle a destination into a routed click", async () => {
    const id = await seedSmartlink("route-click4");
    await saveRouting(id);
    const res = await req("POST", "/distribution/presave/route-click4/click",
      { kind: "routed", key: "https://evil.example.com" },
      { "cf-ipcountry": "JP", "accept-language": "ja" });
    expect(res.status).toBe(200);
    const rows = await clickRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.link_key).toBe("routed:territory");
    expect(rows[0]!.link_title).toBe("Territory route (JP)");
  });
});

/* ─── pre-migration install (routing columns absent) ──────────────────── */

describe("pre-migration install", () => {
  beforeEach(() => {
    setupDb(false);
  });

  it("the public landing, settings save and stats all keep working; routing reads as not-ready", async () => {
    const id = await seedSmartlink("route-old1");
    const pub = await req("GET", "/distribution/presave/route-old1", undefined, {
      "cf-ipcountry": "DE", "accept-language": "es",
    });
    expect(pub.status).toBe(200);
    expect(pub.json.presave.routing.routedDestination).toBeNull();
    expect(pub.json.presave.platformLinks).toEqual(DEFAULT_LINKS);

    const headline = await req("PATCH", `/distribution/releases/${id}/presave-settings`, { headline: "Still works" });
    expect(headline.status).toBe(200);
    expect(headline.json.settings.routingReady).toBe(false);
    expect(headline.json.settings.territoryDestinations).toEqual({});

    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.status).toBe(200);
    expect(stats.json.settings.routingReady).toBe(false);
  });

  it("a routing save on a pre-migration install answers 503 and changes nothing", async () => {
    const id = await seedSmartlink("route-old2");
    const res = await req("PATCH", `/distribution/releases/${id}/presave-settings`, {
      headline: "Must not persist",
      territoryDestinations: { DE: DE_URL },
    });
    expect(res.status).toBe(503);
    expect(res.json.error).toBe("smartlink_routing_not_ready");
    const stats = await req("GET", `/distribution/releases/${id}/presave-stats`);
    expect(stats.json.settings.headline).toBeNull();
  });

  it("a routed click on a pre-migration install is refused and records nothing", async () => {
    const id = await seedSmartlink("route-old3");
    const res = await req("POST", "/distribution/presave/route-old3/click", { kind: "routed" }, { "cf-ipcountry": "DE" });
    expect(res.status).toBe(400);
    expect(await clickRows(id)).toHaveLength(0);
  });
});
