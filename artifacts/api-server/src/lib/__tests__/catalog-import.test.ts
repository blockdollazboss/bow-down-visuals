/**
 * Back-Catalog Migration Assistant (0200) — lib over pg-mem.
 *
 * Pins the discipline the feature lives by:
 *   - only the caller's OWN connected accounts and items are visible
 *     or touchable (everything owner-scoped, strangers get 404),
 *   - TikTok parks honestly (PROVIDER_BLOCKED) — its granted scopes
 *     cannot read a catalog, and no TikTok rows are ever created,
 *   - an item the platform lists but won't hand the file for parks
 *     'blocked' with the reason — never scraped around,
 *   - scan dedupes on (user, platform, external_id); dismissed items
 *     don't resurrect,
 *   - the rebuild draft is a DRAFT: AI words when the rail answers,
 *     the creator's own words labeled 'assembled' when it doesn't, and
 *     every skipped part says why,
 *   - approve is the only door onto the real rails, and it never
 *     double-applies,
 *   - the flow is FREE: this test DB has no credits table at all, and
 *     a source pin keeps credits code out of the feature's files.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { encryptToken } from "../social-crypto";
import {
  CatalogImportError,
  CATALOG_HONESTY,
  getCatalogState,
  scanAccount,
  fetchItem,
  fetchSelected,
  registerUploads,
  rebuildItem,
  approveItem,
  approveBatch,
  dismissItem,
  parseSeriesSuggestion,
  assembleDraft,
  setCatalogImportDeps,
} from "../catalog-import";
import { catalogImportCopyFor } from "../catalog-import-i18n";

function createTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const shim = {
    query: async (config: unknown, values?: unknown[]) => {
      let cfg: unknown = config;
      let wantArray = false;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        const { types: _t, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const result = (await (pool as any).query(cfg, values)) as any;
      if (wantArray && Array.isArray(result?.rows) && result.rows.length > 0) {
        const names = Object.keys(result.rows[0]);
        return { ...result, rows: result.rows.map((row: any) => names.map((n) => row[n])) };
      }
      return result;
    },
  };
  return drizzle(shim as never);
}

const DDL = `
CREATE TABLE social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'instagram',
  ig_user_id text, provider_user_id text, username text,
  page_id text, page_name text,
  access_token_encrypted text, refresh_token_encrypted text,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  avatar_url text, banner_url text,
  theme_id text NOT NULL DEFAULT 'gold-lux',
  vertical text NOT NULL DEFAULT 'music',
  stream_schedule jsonb NOT NULL DEFAULT '[]',
  media_kit jsonb,
  theme_config jsonb NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',
  layout_blocks jsonb NOT NULL DEFAULT '[]',
  pinned_kind text, pinned_item_id uuid,
  collection_visibility text NOT NULL DEFAULT 'public',
  featured_media jsonb,
  merch_items jsonb NOT NULL DEFAULT '[]',
  events jsonb NOT NULL DEFAULT '[]',
  series jsonb NOT NULL DEFAULT '[]',
  social_posts jsonb NOT NULL DEFAULT '[]',
  social_links jsonb NOT NULL DEFAULT '{}',
  top_creators jsonb NOT NULL DEFAULT '[]',
  tip_jar_enabled boolean NOT NULL DEFAULT true,
  ai_design jsonb,
  is_public boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  is_official boolean NOT NULL DEFAULT false,
  follower_count integer NOT NULL DEFAULT 0,
  total_plays integer NOT NULL DEFAULT 0,
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean NOT NULL DEFAULT false,
  stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  title text NOT NULL, video_url text NOT NULL, thumbnail_url text,
  description text NOT NULL DEFAULT '', genre text, tags text[] NOT NULL DEFAULT '{}',
  duration_sec integer NOT NULL DEFAULT 0,
  season integer, episode integer, sound_track_id uuid,
  download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false,
  pwyw_min_cents integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  is_short boolean NOT NULL DEFAULT false,
  duet_with uuid, stitch_with uuid,
  sound_id text, sound_title text, sound_url text,
  sound_use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  cover_url text,
  is_public boolean NOT NULL DEFAULT true,
  kind text NOT NULL DEFAULT 'playlist',
  price_cents integer,
  preview_item jsonb DEFAULT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  follower_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  audio_url text NOT NULL,
  audio_path text,
  source text NOT NULL DEFAULT 'upload',
  parent_song_id uuid,
  artist_vault_id uuid,
  mashup_sources jsonb,
  mashup_style text,
  duration_sec text,
  lyrics text, genre text, isrc text, cover_art_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalog_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_kind text NOT NULL,
  platform text,
  social_account_id uuid,
  external_id text,
  kind text NOT NULL,
  title text NOT NULL,
  original_caption text,
  original_url text,
  remote_file_url text,
  remote_thumbnail_url text,
  media_url text,
  storage_key text,
  thumbnail_url text,
  duration_sec integer,
  status text NOT NULL DEFAULT 'listed',
  status_note text,
  draft jsonb,
  target_kind text,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_import_items_dedupe_ux ON catalog_import_items (user_id, platform, external_id);
`;

const USER = randomUUID();
const OTHER = randomUUID();
const IG_ID = randomUUID();
const TT_ID = randomUUID();
const FB_ID = randomUUID();
const PROFILE_ID = randomUUID();

const TEST_KEY = "a".repeat(64);

let fetchImpl: any;
let downloadBuffer: any;
let aiWords: any;

function igMediaResponse() {
  return {
    ok: true,
    headers: new Headers(),
    json: async () => ({
      data: [
        {
          id: "ig-1",
          caption: "Harbor Nights S1E2 — the dock scene\n#harbor #series",
          media_type: "VIDEO",
          media_product_type: "FEED",
          media_url: "https://cdn.ig.test/v1.mp4",
          thumbnail_url: "https://cdn.ig.test/t1.jpg",
          permalink: "https://instagram.com/p/1",
          timestamp: "2026-01-02T00:00:00Z",
        },
        {
          id: "ig-2",
          caption: "studio freestyle",
          media_type: "VIDEO",
          media_product_type: "REELS",
          media_url: "https://cdn.ig.test/v2.mp4",
          permalink: "https://instagram.com/reel/2",
          timestamp: "2026-01-03T00:00:00Z",
        },
        { id: "ig-3", caption: "a photo", media_type: "IMAGE", media_url: "https://cdn.ig.test/p.jpg" },
      ],
    }),
  };
}

function fbVideosResponse(withSource: boolean) {
  return {
    ok: true,
    headers: new Headers(),
    json: async () => ({
      data: [
        {
          id: "fb-1",
          title: "Warehouse Sessions — Part 2",
          description: "second night in the warehouse",
          ...(withSource ? { source: "https://cdn.fb.test/v1.mp4" } : {}),
          picture: "https://cdn.fb.test/p1.jpg",
          permalink_url: "/watch/1",
          length: 95.4,
          created_time: "2026-02-01T00:00:00Z",
        },
      ],
    }),
  };
}

async function seed() {
  const db = testState.db;
  const { socialAccountsTable, creatorProfilesTable } = await import("@workspace/db");
  await db.insert(socialAccountsTable).values([
    { id: IG_ID, user_id: USER, platform: "instagram", ig_user_id: "ig-user-1", username: "nova", access_token_encrypted: encryptToken("ig-token") },
    { id: TT_ID, user_id: USER, platform: "tiktok", provider_user_id: "tt-1", username: "nova.tt", access_token_encrypted: encryptToken("tt-token") },
    { id: FB_ID, user_id: USER, platform: "facebook", page_id: "page-1", page_name: "Nova Page", username: null, access_token_encrypted: encryptToken("fb-token") },
    { id: randomUUID(), user_id: OTHER, platform: "instagram", ig_user_id: "ig-other", username: "someoneelse", access_token_encrypted: encryptToken("other-token") },
  ]);
  await db.insert(creatorProfilesTable).values({
    id: PROFILE_ID,
    userId: USER,
    slug: "nova",
    displayName: "Nova",
    socialLinks: { youtube: "https://youtube.com/@nova", instagram: "https://instagram.com/nova" },
  });
}

beforeAll(() => {
  process.env["SOCIAL_TOKEN_KEY"] = TEST_KEY;
  testState.db = createTestDb();
});

beforeEach(async () => {
  const db = testState.db;
  const { sql } = await import("drizzle-orm");
  for (const t of ["social_accounts", "creator_profiles", "profile_videos", "playlists", "songs", "catalog_import_items"]) {
    await db.execute(sql.raw(`DELETE FROM ${t}`));
  }
  await seed();

  fetchImpl = vi.fn(async (url: string) => {
    if (url.includes("graph.instagram.com")) return igMediaResponse();
    if (url.includes("graph.facebook.com")) return fbVideosResponse(true);
    throw new Error(`unexpected fetch ${url}`);
  });
  downloadBuffer = vi.fn(async (url: string) => Buffer.from(`bytes:${url}`));
  aiWords = null;
  setCatalogImportDeps({
    fetchImpl,
    downloadBuffer,
    uploadObject: async (key: string) => `https://cdn.bowdown.test/${key}`,
    publicUrl: (key: string) => `https://cdn.bowdown.test/${key}`,
    transcribe: async () => ({
      text: "welcome to the dock. the water is calm tonight. we sail at dawn.",
      duration: 62,
      language: "en",
      words: [],
      segments: [
        { id: 0, start: 0, end: 20, text: "welcome to the dock tonight", words: [] },
        { id: 1, start: 20, end: 62, text: "we sail at dawn together", words: [] },
      ],
    }),
    aiText: async () => aiWords,
  });
});

describe("honest capability states", () => {
  it("reports instagram ready, tiktok blocked with the reason, youtube link-only", async () => {
    const state = await getCatalogState(USER);
    const ig = state.accounts.find((a) => a.platform === "instagram");
    const tt = state.accounts.find((a) => a.platform === "tiktok");
    const yt = state.accounts.find((a) => a.platform === "youtube");
    expect(ig?.state).toBe("ready");
    expect(tt?.state).toBe("blocked");
    expect(tt?.note).toBe(CATALOG_HONESTY.tiktokBlocked);
    expect(yt?.state).toBe("link-only");
    expect(yt?.note).toBe(CATALOG_HONESTY.linkOnly);
    expect(state.honesty.movesLine).toContain("Your followers don't");
  });

  it("a stranger's state shows none of the user's accounts or items", async () => {
    await scanAccount(USER, IG_ID);
    const stranger = await getCatalogState(randomUUID());
    expect(stranger.accounts).toHaveLength(0);
    expect(stranger.items).toHaveLength(0);
  });
});

describe("owner scoping", () => {
  it("scanning someone else's account is a 404", async () => {
    const { socialAccountsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await testState.db.select().from(socialAccountsTable).where(eq(socialAccountsTable.user_id, OTHER));
    expect(rows).toHaveLength(1);
    await expect(scanAccount(USER, rows[0]!.id)).rejects.toMatchObject({ status: 404, code: "ACCOUNT_NOT_FOUND" });
  });

  it("touching someone else's item is a 404 on every door", async () => {
    const { items } = await scanAccount(USER, IG_ID);
    const id = items[0]!.id;
    await expect(fetchItem(OTHER, id)).rejects.toMatchObject({ status: 404 });
    await expect(rebuildItem(OTHER, id)).rejects.toMatchObject({ status: 404 });
    await expect(approveItem(OTHER, id)).rejects.toMatchObject({ status: 404 });
    await expect(dismissItem(OTHER, id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("scan", () => {
  it("tiktok scan is provider-blocked and creates no rows", async () => {
    await expect(scanAccount(USER, TT_ID)).rejects.toMatchObject({ status: 422, code: "PROVIDER_BLOCKED" });
    const state = await getCatalogState(USER);
    expect(state.items.filter((i) => i.platform === "tiktok")).toHaveLength(0);
  });

  it("lists instagram videos only, counts photos as skipped, dedupes on rescan", async () => {
    const first = await scanAccount(USER, IG_ID);
    expect(first.listed).toBe(2);
    expect(first.skippedNonVideo).toBe(1);
    expect(first.items.map((i) => i.externalId).sort()).toEqual(["ig-1", "ig-2"]);
    const reel = first.items.find((i) => i.externalId === "ig-2");
    expect(reel?.title).toBe("studio freestyle");
    const second = await scanAccount(USER, IG_ID);
    expect(second.listed).toBe(0);
    expect(second.alreadyKnown).toBe(2);
    const state = await getCatalogState(USER);
    expect(state.items.filter((i) => i.platform === "instagram")).toHaveLength(2);
  });

  it("a dismissed item does not resurrect on rescan", async () => {
    const { items } = await scanAccount(USER, IG_ID);
    await dismissItem(USER, items[0]!.id);
    await scanAccount(USER, IG_ID);
    const state = await getCatalogState(USER);
    expect(state.items.find((i) => i.id === items[0]!.id)?.status).toBe("dismissed");
  });
});

describe("fetch", () => {
  it("brings a listed file home: bytes land in the caller's own prefix, status 'here'", async () => {
    const { items } = await scanAccount(USER, IG_ID);
    const target = items.find((i) => i.externalId === "ig-1")!;
    const done = await fetchItem(USER, target.id);
    expect(done.status).toBe("here");
    expect(done.storageKey).toBe(`${USER}/catalog-import/${target.id}.mp4`);
    expect(done.mediaUrl).toContain(done.storageKey!);
    expect(done.thumbnailUrl).toContain("-thumb.jpg");
  });

  it("an item the platform lists without a file parks blocked with the plain reason", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (url.includes("graph.facebook.com")) return fbVideosResponse(false);
      throw new Error("unexpected");
    });
    const { items } = await scanAccount(USER, FB_ID);
    expect(items).toHaveLength(1);
    const done = await fetchItem(USER, items[0]!.id);
    expect(done.status).toBe("blocked");
    expect(done.statusNote).toBe(CATALOG_HONESTY.noFileUrl);
  });

  it("a failed download marks the item failed (retryable), and a retry lands it", async () => {
    const { items } = await scanAccount(USER, IG_ID);
    const target = items.find((i) => i.externalId === "ig-2")!;
    downloadBuffer.mockRejectedValueOnce(new Error("socket died"));
    const failed = await fetchItem(USER, target.id);
    expect(failed.status).toBe("failed");
    expect(failed.statusNote).toBeTruthy();
    const retried = await fetchItem(USER, target.id);
    expect(retried.status).toBe("here");
  });

  it("batch fetch reports per-item results", async () => {
    const { items } = await scanAccount(USER, IG_ID);
    const out = await fetchSelected(USER, items.map((i) => i.id));
    expect(out.results).toHaveLength(2);
    expect(out.results.every((r) => r.ok && r.status === "here")).toBe(true);
  });
});

describe("bulk upload registration", () => {
  it("registers the caller's own files as 'here'; foreign keys are refused", async () => {
    const created = await registerUploads(USER, [
      { key: `${USER}/catalog-import/abc-old-song.mp3`, filename: "old-song.mp3", kind: "audio" },
    ]);
    expect(created[0]?.status).toBe("here");
    expect(created[0]?.sourceKind).toBe("upload");
    expect(created[0]?.title).toBe("old song");
    await expect(
      registerUploads(USER, [{ key: `${OTHER}/catalog-import/x.mp4`, filename: "x.mp4", kind: "video" }]),
    ).rejects.toMatchObject({ status: 403, code: "BAD_KEY" });
  });
});

describe("rebuild draft", () => {
  it("with the AI rail answering, the draft is AI-sourced with captions, chapters and a series read", async () => {
    aiWords = { title: "Harbor Nights — The Dock Scene", description: "Episode two at the dock.", tags: ["harbor", "series"] };
    const { items } = await scanAccount(USER, IG_ID);
    const target = items.find((i) => i.externalId === "ig-1")!;
    await fetchItem(USER, target.id);
    const ready = await rebuildItem(USER, target.id);
    expect(ready.status).toBe("ready");
    expect(ready.draft?.source).toBe("ai");
    expect(ready.draft?.title).toBe("Harbor Nights — The Dock Scene");
    expect(ready.draft?.captions).toContain("sail at dawn");
    expect(ready.draft?.chapters.length).toBe(2);
    expect(ready.draft?.series).toEqual({ name: "Harbor Nights", season: 1, episode: 2 });
    expect(ready.draft?.notes.find((n) => n.part === "thumbnail")?.state).toBe("done");
    expect(ready.durationSec).toBe(62);
  });

  it("with AI off and transcription down, the draft is the creator's own words, labeled assembled, skips stated", async () => {
    aiWords = null;
    setCatalogImportDeps({
      transcribe: async () => { throw new Error("no scribe in tests"); },
    });
    const [up] = await registerUploads(USER, [
      { key: `${USER}/catalog-import/xyz-loft-tape.mp3`, filename: "loft-tape.mp3", kind: "audio" },
    ]);
    const ready = await rebuildItem(USER, up!.id);
    expect(ready.draft?.source).toBe("assembled");
    expect(ready.draft?.title).toBe("loft tape");
    expect(ready.draft?.captions).toBeNull();
    const capNote = ready.draft?.notes.find((n) => n.part === "captions");
    expect(capNote?.state).toBe("skipped");
    expect(capNote?.reason).toBeTruthy();
  });
});

describe("approve — the only door home", () => {
  it("publishes the video onto the profile and groups it into its series, once", async () => {
    aiWords = { title: "Harbor Nights — The Dock Scene", description: "Episode two.", tags: ["harbor"] };
    const { items } = await scanAccount(USER, IG_ID);
    const target = items.find((i) => i.externalId === "ig-1")!;
    await fetchItem(USER, target.id);
    await rebuildItem(USER, target.id);
    const approved = await approveItem(USER, target.id);
    expect(approved.status).toBe("approved");
    expect(approved.targetKind).toBe("profile_video");

    const { profileVideosTable, playlistsTable } = await import("@workspace/db");
    const videos = await testState.db.select().from(profileVideosTable);
    expect(videos).toHaveLength(1);
    expect(videos[0].isPublished).toBe(true);
    expect(videos[0].profileId).toBe(PROFILE_ID);
    expect(videos[0].season).toBe(1);
    expect(videos[0].episode).toBe(2);
    const series = await testState.db.select().from(playlistsTable);
    expect(series).toHaveLength(1);
    expect(series[0].kind).toBe("series");
    expect(series[0].title).toBe("Harbor Nights");
    expect(series[0].items).toEqual([{ kind: "video", id: approved.targetId }]);

    const again = await approveItem(USER, target.id);
    expect(again.status).toBe("approved");
    expect(await testState.db.select().from(profileVideosTable)).toHaveLength(1);
  });

  it("an audio upload lands in the song library with the import source marked", async () => {
    const [up] = await registerUploads(USER, [
      { key: `${USER}/catalog-import/abc-loft-tape.mp3`, filename: "loft-tape.mp3", kind: "audio" },
    ]);
    const approved = await approveItem(USER, up!.id);
    expect(approved.targetKind).toBe("song");
    const { songsTable } = await import("@workspace/db");
    const songs = await testState.db.select().from(songsTable);
    expect(songs).toHaveLength(1);
    expect(songs[0].source).toBe("catalog-import");
    expect(songs[0].audio_url).toContain("abc-loft-tape.mp3");
  });

  it("a video with no creator profile waits honestly — nothing is created", async () => {
    const noProfileUser = randomUUID();
    const [up] = await registerUploads(noProfileUser, [
      { key: `${noProfileUser}/catalog-import/v.mp4`, filename: "v.mp4", kind: "video" },
    ]);
    await expect(approveItem(noProfileUser, up!.id)).rejects.toMatchObject({ status: 409, code: "PROFILE_REQUIRED" });
    const { profileVideosTable } = await import("@workspace/db");
    expect(await testState.db.select().from(profileVideosTable)).toHaveLength(0);
  });

  it("batch approve applies what it can and reports the rest", async () => {
    const [a] = await registerUploads(USER, [{ key: `${USER}/catalog-import/a.mp3`, filename: "a.mp3", kind: "audio" }]);
    const [b] = await registerUploads(USER, [{ key: `${USER}/catalog-import/b.mp3`, filename: "b.mp3", kind: "audio" }]);
    const out = await approveBatch(USER, [a!.id, b!.id, randomUUID()]);
    expect(out.results.filter((r) => r.ok)).toHaveLength(2);
    expect(out.results.find((r) => !r.ok)?.note).toBeTruthy();
  });
});

describe("pure helpers + the free pin", () => {
  it("parses series markers and assembles honest drafts", () => {
    expect(parseSeriesSuggestion("Warehouse Sessions — Part 2")).toEqual({ name: "Warehouse Sessions", season: 1, episode: 2 });
    expect(parseSeriesSuggestion("Show S3E12 finale")).toEqual({ name: "Show", season: 3, episode: 12 });
    expect(parseSeriesSuggestion("just a vlog")).toBeNull();
    const draft = assembleDraft({ title: "loft tape", caption: "#loft vibes", transcript: null, hasThumbnail: false, ai: null });
    expect(draft.source).toBe("assembled");
    expect(draft.tags).toEqual(["loft"]);
    expect(draft.notes.every((n) => n.state === "done" || (n.reason ?? "").length > 0)).toBe(true);
  });

  it("the feature's own files never touch credits", () => {
    const here = join(fileURLToPath(import.meta.url), "..");
    const libSrc = readFileSync(join(here, "..", "catalog-import.ts"), "utf8");
    const routeSrc = readFileSync(join(here, "..", "..", "routes", "catalog-import.ts"), "utf8");
    for (const src of [libSrc, routeSrc]) {
      expect(src).not.toMatch(/creditsTable|spendCredits|chargeCredits|deductCredits/);
      expect(src).not.toMatch(/from\s+["'][^"']*lib\/credits["']/);
    }
  });
});

describe("locale path — server catalogs", () => {
  it("CATALOG_HONESTY is the catalog's en block (single source)", () => {
    expect(CATALOG_HONESTY).toEqual(catalogImportCopyFor("en").honesty);
  });

  it("state renders the honesty block + account notes in the caller's locale", async () => {
    const fr = catalogImportCopyFor("fr");
    const state = await getCatalogState(USER, "fr");
    expect(state.honesty).toEqual(fr.honesty);
    expect(state.accounts.find((a) => a.platform === "tiktok")?.note).toBe(fr.honesty.tiktokBlocked);
    expect(state.accounts.find((a) => a.platform === "youtube")?.note).toBe(fr.honesty.linkOnly);
    /* A default read is still English. */
    const en = await getCatalogState(USER);
    expect(en.honesty).toEqual(catalogImportCopyFor("en").honesty);
  });

  it("a tiktok scan refuses in the caller's locale", async () => {
    const err = await scanAccount(USER, TT_ID, "es").catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: "PROVIDER_BLOCKED" });
    expect(err.message).toBe(catalogImportCopyFor("es").honesty.tiktokBlocked);
  });

  it("a blocked fetch stores the note in the fetch call's locale — a later English read never rewrites it", async () => {
    fetchImpl.mockImplementation(async (url: string) => {
      if (url.includes("graph.facebook.com")) return fbVideosResponse(false);
      throw new Error("unexpected");
    });
    const { items } = await scanAccount(USER, FB_ID);
    const done = await fetchItem(USER, items[0]!.id, "es");
    expect(done.status).toBe("blocked");
    expect(done.statusNote).toBe(catalogImportCopyFor("es").honesty.noFileUrl);
    const state = await getCatalogState(USER);
    expect(state.items.find((i) => i.id === items[0]!.id)?.statusNote).toBe(
      catalogImportCopyFor("es").honesty.noFileUrl,
    );
  });

  it("a failed fetch stores the catalog failure note in the call's locale", async () => {
    const { items } = await scanAccount(USER, IG_ID);
    const target = items.find((i) => i.externalId === "ig-2")!;
    downloadBuffer.mockRejectedValueOnce(new Error("socket died"));
    const failed = await fetchItem(USER, target.id, "de");
    expect(failed.status).toBe("failed");
    expect(failed.statusNote).toBe(catalogImportCopyFor("de").fetchFailedNote);
  });

  it("a rebuild in Spanish stores Spanish draft notes; the creator's own words stay theirs", async () => {
    aiWords = null;
    setCatalogImportDeps({
      transcribe: async () => { throw new Error("no scribe in tests"); },
    });
    const [up] = await registerUploads(USER, [
      { key: `${USER}/catalog-import/xyz-loft-tape.mp3`, filename: "loft-tape.mp3", kind: "audio" },
    ]);
    const ready = await rebuildItem(USER, up!.id, "es");
    const es = catalogImportCopyFor("es");
    const notes = ready.draft?.notes ?? [];
    expect(ready.draft?.title).toBe("loft tape");
    expect(notes.find((n) => n.part === "captions")?.reason).toBe(es.transcriptUnavailable);
    expect(notes.find((n) => n.part === "chapters")?.reason).toBe(es.draftNotes.chaptersNeedTranscript);
    expect(notes.find((n) => n.part === "thumbnail")?.reason).toBe(es.draftNotes.thumbnailMissing);
    expect(notes.find((n) => n.part === "series")?.reason).toBe(es.draftNotes.seriesNoMarker);
  });

  it("assembleDraft in a locale composes that locale's notes; en stays the default", () => {
    const esDraft = assembleDraft(
      { title: "Plain Title", caption: "", transcript: null, hasThumbnail: false, ai: null },
      "es",
    );
    expect(esDraft.notes.find((n) => n.part === "captions")?.reason).toBe(
      catalogImportCopyFor("es").draftNotes.captionsUnavailable,
    );
    const enDraft = assembleDraft({ title: "Plain Title", caption: "", transcript: null, hasThumbnail: false, ai: null });
    expect(enDraft.notes.find((n) => n.part === "captions")?.reason).toBe(
      "Transcription wasn't available for this file.",
    );
  });
});
