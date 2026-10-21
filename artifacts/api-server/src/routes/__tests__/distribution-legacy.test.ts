/**
 * Stack 11 (in-house half) — Distribution & Legacy.
 * Driven like real callers over HTTP against pg-mem, same pattern as
 * distribution.test.ts. Covers: persistent smartlink landing content +
 * presave descriptor, Spotify account pre-save (recorded ONLY on API
 * confirmation), per-payee split statements by effective agreement
 * version, lyrics package, takedown/edit request states, permanence
 * elections, the label-roster permission rule, and verified unlock gates.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["SPOTIFY_CLIENT_ID"] = "test-client";
process.env["SPOTIFY_CLIENT_SECRET"] = "test-secret";
process.env["SOCIAL_TOKEN_KEY"] = "a".repeat(64);

const testState = vi.hoisted(() => ({ db: null as any, userId: "", userEmail: "" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = testState.userId; req.userEmail = testState.userEmail; req.userCredits = 10000; next(); },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 9000),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));
vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-6-sol",
  getOpenAI: () => ({ chat: { completions: { create: async () => { throw new Error("not used"); } } } }),
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: vi.fn(async (v: string) => v), mirrorProjectScenes: vi.fn(async (v: unknown) => v) }));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

import legacyRouter from "../distribution-legacy";
import distributionRouter from "../generate/distribution";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE distribution_releases (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, artist_name text NOT NULL,
  release_date text, platforms jsonb NOT NULL DEFAULT '[]'::jsonb, audio_url text, artwork_url text,
  metadata jsonb, strategy jsonb, status text NOT NULL DEFAULT 'draft', credits_charged integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  release_type text NOT NULL DEFAULT 'single', isrc text, genre text, explicit boolean NOT NULL DEFAULT false,
  explicit_declared boolean NOT NULL DEFAULT false, upc text, label text, copyright_line text, song_id uuid,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb, aggregator text NOT NULL DEFAULT 'none', aggregator_release_id text,
  platform_statuses jsonb NOT NULL DEFAULT '[]'::jsonb, presave_slug text, split_share_slug text,
  upc_kind text NOT NULL DEFAULT 'internal', label_imprint text, copyright_c_line text, copyright_p_line text,
  subgenre text, original_release_date text, preorder_date text, territories_mode text NOT NULL DEFAULT 'worldwide',
  territories jsonb NOT NULL DEFAULT '[]'::jsonb,
  presave_headline text, presave_platform_links jsonb NOT NULL DEFAULT '{}'::jsonb, presave_bonus_url text, meta_pixel_id text, tiktok_pixel_id text, google_tag_id text
);
CREATE TABLE presave_follows (id uuid PRIMARY KEY, release_id uuid NOT NULL, email text NOT NULL, name text, platform text, source text NOT NULL DEFAULT 'presave', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (release_id, email));
CREATE TABLE presave_shares (id uuid PRIMARY KEY, release_id uuid NOT NULL, channel text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE release_landing_content (id uuid PRIMARY KEY, release_id uuid NOT NULL, user_id uuid NOT NULL, video_url text, store_url text, social_links jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX release_landing_content_release_uidx ON release_landing_content (release_id);
CREATE TABLE presave_account_actions (id uuid PRIMARY KEY, release_id uuid NOT NULL, user_id uuid NOT NULL, platform text NOT NULL DEFAULT 'spotify', item_kind text NOT NULL, item_id text NOT NULL, status text NOT NULL DEFAULT 'saved', created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX presave_account_actions_uidx ON presave_account_actions (release_id, user_id, platform);
CREATE TABLE release_lyrics_packages (id uuid PRIMARY KEY, release_id uuid NOT NULL, user_id uuid NOT NULL, lyrics text NOT NULL DEFAULT '', timed_lines jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE release_change_requests (id uuid PRIMARY KEY, release_id uuid NOT NULL, user_id uuid NOT NULL, kind text NOT NULL, reason text NOT NULL DEFAULT '', details text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'requested', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE release_permanence_elections (id uuid PRIMARY KEY, user_id uuid NOT NULL, release_id uuid, scope text NOT NULL, election text NOT NULL DEFAULT 'permanent', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE label_roster_members (id uuid PRIMARY KEY, manager_user_id uuid NOT NULL, team_id uuid, artist_user_id uuid, artist_name text NOT NULL DEFAULT '', artist_email text NOT NULL, status text NOT NULL DEFAULT 'invited', distribution_access boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE social_unlock_gates (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, slug text NOT NULL, title text NOT NULL, action text NOT NULL, target_profile_id uuid, content_url text NOT NULL, content_label text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE social_unlock_share_records (id uuid PRIMARY KEY, gate_id uuid NOT NULL, user_id uuid NOT NULL, channel text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX social_unlock_shares_gate_user_uidx ON social_unlock_share_records (gate_id, user_id);
CREATE TABLE royalty_entries (id uuid PRIMARY KEY, user_id uuid NOT NULL, song_title text NOT NULL, artist_name text, platform text NOT NULL, period_start text NOT NULL, period_end text NOT NULL, streams text, gross_amount numeric(12,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD', source text NOT NULL DEFAULT 'csv', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE distribution_royalty_splits (id uuid PRIMARY KEY, release_id uuid NOT NULL, user_id uuid NOT NULL, payee_name text NOT NULL, role text, share_pct numeric(5,2) NOT NULL, payee_email text, invite_status text NOT NULL DEFAULT 'not_invited', invite_token text, agreement_version integer NOT NULL DEFAULT 1, effective_from timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE social_accounts (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL DEFAULT 'instagram', ig_user_id text, provider_user_id text, username text, page_id text, page_name text, access_token_encrypted text, refresh_token_encrypted text, token_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reposts (user_id uuid NOT NULL, track_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE profile_tracks (id uuid PRIMARY KEY, profile_id uuid NOT NULL);
CREATE TABLE teams (id uuid PRIMARY KEY, name text, owner_id uuid NOT NULL);
CREATE TABLE team_members (id uuid PRIMARY KEY, team_id uuid NOT NULL, user_id uuid, email text, role text, status text);
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, audio_url text NOT NULL);
CREATE TABLE email_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text, handle text, description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE email_subscribers (id uuid PRIMARY KEY, list_id uuid NOT NULL, email text NOT NULL, name text, source text, confirmed boolean, unsubscribed_at timestamptz);
`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const OWNER = randomUUID(); const FAN = randomUUID(); const ARTIST = randomUUID(); const OTHER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", legacyRouter);
  app.use("/api", distributionRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = OWNER;
  testState.userEmail = "owner@example.com";
  vi.clearAllMocks();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any, headers: r.headers };
}
function as(userId: string, email = "") { testState.userId = userId; testState.userEmail = email; }

async function seedRelease(userId: string, opts: { title?: string; slug?: string; spotifyLink?: string; releaseDate?: string } = {}) {
  const id = randomUUID();
  const links = opts.spotifyLink ? { spotify: opts.spotifyLink } : {};
  await testState.db.execute(sql`
    INSERT INTO distribution_releases (id, user_id, title, artist_name, presave_slug, presave_platform_links, release_date)
    VALUES (${id}, ${userId}, ${opts.title ?? "Gold Water"}, ${"Test Artist"}, ${opts.slug ?? null}, ${JSON.stringify(links)}::jsonb, ${opts.releaseDate ?? null})`);
  return id;
}

/* ── #1 landing content + presave persistence ─────────────────────────── */
describe("release landing content (smartlink)", () => {
  it("saves video/store/socials and the public presave page carries them after release day", async () => {
    const id = await seedRelease(OWNER, { slug: "goldwater1", releaseDate: "2020-01-01" });
    const put = await req("PUT", `/distribution/releases/${id}/landing-content`, {
      videoUrl: "https://example.com/video.mp4", storeUrl: "https://example.com/store",
      socialLinks: { instagram: "https://instagram.com/x", bogus: "https://x.com/y" },
    });
    expect(put.status).toBe(200);
    expect(put.json.landing.socialLinks).toEqual({ instagram: "https://instagram.com/x" });
    expect(put.json.persistsAfterRelease).toBe(true);
    const pub = await req("GET", "/distribution/presave/goldwater1");
    expect(pub.status).toBe(200);
    expect(pub.json.presave.released).toBe(true);
    expect(pub.json.presave.persistsAfterRelease).toBe(true);
    expect(pub.json.presave.landing.videoUrl).toBe("https://example.com/video.mp4");
    expect(pub.json.presave.landing.storeUrl).toBe("https://example.com/store");
  });
  it("404s landing saves for another user's release", async () => {
    const id = await seedRelease(OTHER);
    expect((await req("PUT", `/distribution/releases/${id}/landing-content`, { videoUrl: "https://e.com/v" })).status).toBe(404);
  });
});

/* ── #2 Spotify account pre-save ──────────────────────────────────────── */
describe("spotify account pre-save", () => {
  async function connectFan() {
    as(FAN, "fan@example.com");
    const auth = await req("GET", "/distribution/spotify/auth-url");
    expect(auth.status).toBe(200);
    const state = new URL(auth.json.authUrl).searchParams.get("state")!;
    const stub = vi.fn(async (url: any) => {
      if (String(url).includes("accounts.spotify.com/api/token")) return { ok: true, json: async () => ({ access_token: "fan-token", refresh_token: "fan-refresh", expires_in: 3600 }) };
      if (String(url).includes("api.spotify.com/v1/me")) return { ok: true, json: async () => ({ id: "spot-user-1", display_name: "Fan One" }) };
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", stub);
    const cb = await realFetch(`${baseUrl}/distribution/spotify/callback?code=abc&state=${state}`, { redirect: "manual" });
    vi.unstubAllGlobals();
    expect(cb.status).toBe(302);
  }
  it("connects via OAuth and records a save ONLY after the library API confirms", async () => {
    await seedRelease(OWNER, { slug: "save1", spotifyLink: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x" });
    await connectFan();
    const status = await req("GET", "/distribution/spotify/status");
    expect(status.json).toMatchObject({ connected: true, username: "Fan One" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) })));
    const save = await req("POST", "/distribution/presave/save1/account-presave", {});
    vi.unstubAllGlobals();
    expect(save.status).toBe(200);
    expect(save.json).toMatchObject({ saved: true, itemKind: "track", itemId: "4uLU6hMCjMI75M1A2tKUQC" });
    const pub = await req("GET", "/distribution/presave/save1");
    expect(pub.json.presave.accountPresave).toMatchObject({ supported: true, actionLabel: "Save on Spotify", accountSaveCount: 1 });
  });
  it("records nothing when the platform API fails", async () => {
    await seedRelease(OWNER, { slug: "save2", spotifyLink: "https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX" });
    await connectFan();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const save = await req("POST", "/distribution/presave/save2/account-presave", {});
    vi.unstubAllGlobals();
    expect(save.status).toBe(502);
    const rows = await testState.db.execute(sql`SELECT id FROM presave_account_actions`);
    expect(rows.rows).toHaveLength(0);
  });
  it("honestly refuses when there's no saveable link or no connection", async () => {
    await seedRelease(OWNER, { slug: "save3" });
    as(FAN, "fan@example.com");
    const noLink = await req("POST", "/distribution/presave/save3/account-presave", {});
    expect(noLink.status).toBe(409);
    expect(noLink.json.error).toBe("account_presave_unavailable");
    expect(noLink.json.fallback).toBe("email");
    await seedRelease(OWNER, { slug: "save4", spotifyLink: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" });
    const noConn = await req("POST", "/distribution/presave/save4/account-presave", {});
    expect(noConn.status).toBe(409);
    expect(noConn.json.error).toBe("spotify_not_connected");
    const pub = await req("GET", "/distribution/presave/save3");
    expect(pub.json.presave.accountPresave.supported).toBe(false);
  });
});

/* ── #3 split statements ──────────────────────────────────────────────── */
describe("split statements", () => {
  async function seedRoyalties() {
    const relId = await seedRelease(OWNER, { title: "Gold Water" });
    await seedRelease(OWNER, { title: "No Split Song" });
    const entry = async (song: string, periodEnd: string, gross: string) => {
      await testState.db.execute(sql`INSERT INTO royalty_entries (id, user_id, song_title, platform, period_start, period_end, gross_amount) VALUES (${randomUUID()}, ${OWNER}, ${song}, 'spotify', '2026-01-01', ${periodEnd}, ${gross})`);
    };
    await entry("Gold Water", "2026-01-31", "100.00");
    await entry("Gold Water", "2026-03-31", "50.00");
    await entry("No Split Song", "2026-01-31", "10.00");
    await entry("Someone Else", "2026-01-31", "999.00");
    const split = async (name: string, share: number, eff: string, sup: string | null, v: number) => {
      await testState.db.execute(sql`INSERT INTO distribution_royalty_splits (id, release_id, user_id, payee_name, share_pct, agreement_version, effective_from, superseded_at) VALUES (${randomUUID()}, ${relId}, ${OWNER}, ${name}, ${share}, ${v}, ${eff}, ${sup})`);
    };
    await split("Me", 70, "2025-01-01T00:00:00Z", "2026-02-01T00:00:00Z", 1);
    await split("Producer", 30, "2025-01-01T00:00:00Z", "2026-02-01T00:00:00Z", 1);
    await split("Me", 60, "2026-02-01T00:00:00Z", null, 2);
    await split("Producer", 40, "2026-02-01T00:00:00Z", null, 2);
  }
  it("allocates per payee using the agreement version effective in each period", async () => {
    await seedRoyalties();
    const { status, json } = await req("GET", "/distribution/splits/statements");
    expect(status).toBe(200);
    expect(json.hasData).toBe(true);
    const me = json.statements.find((s: any) => s.payeeName === "Me");
    const prod = json.statements.find((s: any) => s.payeeName === "Producer");
    expect(me.totalAmount).toBe("100.00"); // 70% of 100 + 60% of 50
    expect(prod.totalAmount).toBe("50.00"); // 30% of 100 + 40% of 50
    expect(json.unallocated).toHaveLength(1);
    expect(json.unallocated[0].songTitle).toBe("No Split Song");
    expect(json.matchedEntryCount).toBe(3);
  });
  it("period filter narrows statements", async () => {
    await seedRoyalties();
    const { json } = await req("GET", "/distribution/splits/statements?periodStart=2026-03-01&periodEnd=2026-03-31");
    const me = json.statements.find((s: any) => s.payeeName === "Me");
    expect(me.totalAmount).toBe("30.00");
  });
  it("no recorded royalties → hasData false, no fake-zero statements", async () => {
    const { json } = await req("GET", "/distribution/splits/statements");
    expect(json.hasData).toBe(false);
    expect(json.statements).toEqual([]);
  });
});

/* ── #4 lyrics package + change requests ──────────────────────────────── */
describe("lyrics package step", () => {
  it("stores lyrics + synced timing and renders an LRC delivered with the package", async () => {
    const id = await seedRelease(OWNER);
    const put = await req("PUT", `/distribution/releases/${id}/lyrics-package`, {
      lyrics: "line one\nline two",
      timedLines: [{ text: "line one", start: 0, end: 1.5 }, { text: "line two", start: 1.5, end: 3 }],
    });
    expect(put.status).toBe(200);
    expect(put.json.lyricsPackage.step).toEqual({ name: "Lyrics", complete: true });
    expect(put.json.lyricsPackage.lrc).toContain("[00:00.00]line one");
    expect(put.json.lyricsPackage.lrc).toContain("[00:01.50]line two");
    expect(put.json.lyricsPackage.deliveredWithReleasePackage).toBe(true);
  });
});
describe("takedown/edit requests", () => {
  it("files as requested, acknowledges, and refuses sent_to_partner without a pipe", async () => {
    const id = await seedRelease(OWNER);
    const created = await req("POST", `/distribution/releases/${id}/change-requests`, { kind: "takedown", reason: "Wrong audio file" });
    expect(created.status).toBe(201);
    expect(created.json.request.status).toBe("requested");
    expect(created.json.note).toMatch(/sandbox-simulated/i);
    const rid = created.json.request.id;
    const ack = await req("PATCH", `/distribution/change-requests/${rid}`, { status: "acknowledged" });
    expect(ack.json.request.status).toBe("acknowledged");
    const sent = await req("PATCH", `/distribution/change-requests/${rid}`, { status: "sent_to_partner" });
    expect(sent.status).toBe(409);
    expect(sent.json.error).toBe("no_partner_pipe");
    const list = await req("GET", `/distribution/releases/${id}/change-requests`);
    expect(list.json.requests).toHaveLength(1);
  });
  it("requires a reason", async () => {
    const id = await seedRelease(OWNER);
    expect((await req("POST", `/distribution/releases/${id}/change-requests`, { kind: "edit", reason: "" })).status).toBe(400);
  });
});

/* ── #5 permanence ────────────────────────────────────────────────────── */
describe("permanence elections", () => {
  it("records catalog + per-release elections beside succession settings", async () => {
    const id = await seedRelease(OWNER);
    expect((await req("PUT", "/distribution/permanence/catalog", { election: "permanent" })).status).toBe(200);
    await req("PUT", "/distribution/permanence/catalog", { election: "standard" });
    await req("PUT", `/distribution/releases/${id}/permanence`, { election: "permanent" });
    const { json } = await req("GET", "/distribution/permanence");
    expect(json.catalog.election).toBe("standard"); // replaced, not duplicated
    expect(json.releases).toHaveLength(1);
    expect(json.releases[0]).toMatchObject({ releaseId: id, releaseTitle: "Gold Water", election: "permanent" });
    expect(json.covers.join(" ")).toMatch(/smartlink stay live/);
    expect(json.excludes.join(" ")).toMatch(/outside this platform/);
  });

  /* Ring 4 parity pins (stack3): the management contract the two website
     surfaces rely on — change, owner-scoping, validation, and the code's
     actual changeability rule. */
  it("a recorded per-release election can be changed, and the change replaces it", async () => {
    const id = await seedRelease(OWNER);
    expect((await req("PUT", `/distribution/releases/${id}/permanence`, { election: "permanent" })).status).toBe(200);
    const changed = await req("PUT", `/distribution/releases/${id}/permanence`, { election: "standard" });
    expect(changed.status).toBe(200);
    expect(changed.json.election).toMatchObject({ releaseId: id, scope: "release", election: "standard" });
    const { json } = await req("GET", "/distribution/permanence");
    expect(json.releases).toHaveLength(1); // replaced, never duplicated
    expect(json.releases[0].election).toBe("standard");
  });

  it("owner-scoping: a stranger cannot set an election on another's release, and views never leak", async () => {
    const id = await seedRelease(OWNER);
    await req("PUT", "/distribution/permanence/catalog", { election: "permanent" });
    await req("PUT", `/distribution/releases/${id}/permanence`, { election: "permanent" });
    as(OTHER, "other@example.com");
    /* Setting an election on someone else's release: the release is
       invisible to them, so 404 — and nothing is written. */
    expect((await req("PUT", `/distribution/releases/${id}/permanence`, { election: "standard" })).status).toBe(404);
    /* Their own view shows none of the owner's elections. */
    const strangerView = await req("GET", "/distribution/permanence");
    expect(strangerView.json.catalog).toBeNull();
    expect(strangerView.json.releases).toEqual([]);
    /* The catalog election is per-user: the stranger's own choice does
       not touch the owner's. */
    await req("PUT", "/distribution/permanence/catalog", { election: "standard" });
    as(OWNER, "owner@example.com");
    const ownerView = await req("GET", "/distribution/permanence");
    expect(ownerView.json.catalog.election).toBe("permanent");
    expect(ownerView.json.releases).toHaveLength(1);
    expect(ownerView.json.releases[0].election).toBe("permanent"); // the 404'd write never landed
  });

  it("rejects election values outside the recorded set", async () => {
    const id = await seedRelease(OWNER);
    expect((await req("PUT", "/distribution/permanence/catalog", { election: "forever" })).status).toBe(400);
    expect((await req("PUT", "/distribution/permanence/catalog", {})).status).toBe(400);
    expect((await req("PUT", `/distribution/releases/${id}/permanence`, { election: "forever" })).status).toBe(400);
    const { json } = await req("GET", "/distribution/permanence");
    expect(json.catalog).toBeNull();
    expect(json.releases).toEqual([]);
  });

  it("no status lock in code: an election stays changeable after the release is packaged", async () => {
    /* The permanence handlers never gate on release status — 'packaged'
       is the distribution flow's own post-submission state (distribution.ts),
       and the election must still record + change there. Any future lock
       has to arrive as a deliberate rule change, not a UI invention. */
    const id = await seedRelease(OWNER);
    await testState.db.execute(sql`UPDATE distribution_releases SET status = 'packaged' WHERE id = ${id}`);
    expect((await req("PUT", `/distribution/releases/${id}/permanence`, { election: "permanent" })).status).toBe(200);
    expect((await req("PUT", `/distribution/releases/${id}/permanence`, { election: "standard" })).status).toBe(200);
    const { json } = await req("GET", "/distribution/permanence");
    expect(json.releases[0].election).toBe("standard");
  });
});

/* ── #7 label roster permission rule ──────────────────────────────────── */
describe("label roster", () => {
  async function inviteAndRespond(grant: boolean) {
    as(OWNER, "owner@example.com");
    const inv = await req("POST", "/distribution/roster/invite", { artistName: "Roster Artist", artistEmail: "artist@example.com" });
    expect(inv.status).toBe(201);
    const memberId = inv.json.member.id;
    as(ARTIST, "artist@example.com");
    const invites = await req("GET", "/distribution/roster/invites");
    expect(invites.json.invites).toHaveLength(1);
    const resp = await req("POST", `/distribution/roster/invites/${memberId}/respond`, { response: "accept", distributionAccess: false });
    expect(resp.json.member.status).toBe("accepted");
    if (grant) await req("POST", `/distribution/roster/invites/${memberId}/access`, { distributionAccess: true });
    return memberId;
  }
  it("manager sees NO releases until the artist accepts AND grants access; then read-only", async () => {
    const memberId = await inviteAndRespond(false);
    await seedRelease(ARTIST, { title: "Artist Song" });
    as(OWNER, "owner@example.com");
    const denied = await req("GET", `/distribution/roster/${memberId}/releases`);
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe("no_distribution_access");
    expect(denied.json.releases).toEqual([]);
    as(ARTIST, "artist@example.com");
    await req("POST", `/distribution/roster/invites/${memberId}/access`, { distributionAccess: true });
    as(OWNER, "owner@example.com");
    const allowed = await req("GET", `/distribution/roster/${memberId}/releases`);
    expect(allowed.status).toBe(200);
    expect(allowed.json.readOnly).toBe(true);
    expect(allowed.json.releases.map((r: any) => r.title)).toEqual(["Artist Song"]);
  });
  it("invited-but-not-accepted artists expose nothing; strangers get 404", async () => {
    as(OWNER, "owner@example.com");
    const inv = await req("POST", "/distribution/roster/invite", { artistName: "Pending", artistEmail: "pending@example.com" });
    const denied = await req("GET", `/distribution/roster/${inv.json.member.id}/releases`);
    expect(denied.status).toBe(403);
    as(OTHER, "other@example.com");
    expect((await req("GET", `/distribution/roster/${inv.json.member.id}/releases`)).status).toBe(404);
  });
  it("roster list states the permission rule and carries no release data", async () => {
    as(OWNER, "owner@example.com");
    await req("POST", "/distribution/roster/invite", { artistName: "A", artistEmail: "a@example.com" });
    const { json } = await req("GET", "/distribution/roster");
    expect(json.permissionRule).toMatch(/read-only/);
    expect(json.members).toHaveLength(1);
    expect(json.members[0]).not.toHaveProperty("releases");
  });
});

/* ── #8 unlock gates ──────────────────────────────────────────────────── */
describe("social-unlock gates", () => {
  async function seedProfile() {
    const pid = randomUUID();
    await testState.db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${pid}, ${OWNER}, 'owner', 'Owner')`);
    return pid;
  }
  it("follow gate: content URL is never public and unlocks only on a real follows row", async () => {
    const pid = await seedProfile();
    as(OWNER, "owner@example.com");
    const created = await req("POST", "/promote/unlock-gates", { title: "Exclusive track", action: "follow", targetProfileId: pid, contentUrl: "https://example.com/secret.mp3", contentLabel: "Secret track" });
    expect(created.status).toBe(201);
    const slug = created.json.gate.slug;
    const pub = await req("GET", `/promote/unlock-gates/${slug}`);
    expect(pub.json.gate).not.toHaveProperty("contentUrl");
    as(FAN, "fan@example.com");
    const locked = await req("POST", `/promote/unlock-gates/${slug}/unlock`, {});
    expect(locked.status).toBe(403);
    expect(locked.json).not.toHaveProperty("contentUrl");
    await testState.db.execute(sql`INSERT INTO follows (follower_user_id, profile_id) VALUES (${FAN}, ${pid})`);
    const unlocked = await req("POST", `/promote/unlock-gates/${slug}/unlock`, {});
    expect(unlocked.status).toBe(200);
    expect(unlocked.json.contentUrl).toBe("https://example.com/secret.mp3");
  });
  it("share gate: unlocks only after a recorded share by the signed-in fan", async () => {
    as(OWNER, "owner@example.com");
    const created = await req("POST", "/promote/unlock-gates", { title: "Exclusive video", action: "share", contentUrl: "https://example.com/secret.mp4" });
    const slug = created.json.gate.slug;
    as(FAN, "fan@example.com");
    expect((await req("POST", `/promote/unlock-gates/${slug}/unlock`, {})).status).toBe(403);
    await req("POST", `/promote/unlock-gates/${slug}/record-share`, { channel: "copy" });
    const unlocked = await req("POST", `/promote/unlock-gates/${slug}/unlock`, {});
    expect(unlocked.status).toBe(200);
    /* A different fan is still locked — the record is per-fan. */
    as(OTHER, "other@example.com");
    expect((await req("POST", `/promote/unlock-gates/${slug}/unlock`, {})).status).toBe(403);
  });
  it("follow gates require an existing target profile", async () => {
    as(OWNER, "owner@example.com");
    expect((await req("POST", "/promote/unlock-gates", { title: "X", action: "follow", targetProfileId: randomUUID(), contentUrl: "https://e.com/x" })).status).toBe(400);
  });
});
