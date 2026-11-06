/**
 * Too Lost release submission (Front 14) — the §2c routes.
 *
 * The provider is mocked at the global fetch seam (the lib's default
 * fetch), pg-mem backs the DB. What is pinned:
 *   - the happy path runs draft → uploads → attach → metadata → submit
 *     IN ORDER, with the AI declaration on the metadata call;
 *   - the AI GATE: no declaration / "not AI" against an AI-made song /
 *     AI without rights documentation are ALL refused before any
 *     provider call happens;
 *   - tokens: an expired stored token is refreshed BEFORE the pipeline
 *     and persisted; a 401 mid-pipeline forces one refresh + retry; a
 *     failed refresh is an honest 409 reconnect — never a dead-token
 *     submit;
 *   - a provider failure lands as our failed state with OUR reason —
 *     raw provider text never reaches the response or the DB;
 *   - a retry after a mid-pipeline failure REUSES the provider draft;
 *   - an in-review release is never sent twice; no charge is taken
 *     anywhere in this lane (the packaging door owns the tier price).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["TOOLOST_CLIENT_ID"] = "tl-test-client";
process.env["TOOLOST_CLIENT_SECRET"] = "tl-test-secret";
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
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({ chat: { completions: { create: async () => { throw new Error("not used"); } } } }),
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: vi.fn(async (v: string) => v), mirrorProjectScenes: vi.fn(async (v: unknown) => v) }));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

import legacyRouter from "../distribution-legacy";
import { createTestDb } from "../../lib/__tests__/test-db";
import { encryptToken, decryptToken } from "../../lib/social-crypto";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE social_accounts (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL DEFAULT 'instagram', ig_user_id text, provider_user_id text, username text, page_id text, page_name text, access_token_encrypted text, refresh_token_encrypted text, token_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, source text NOT NULL DEFAULT 'upload');
CREATE TABLE distribution_releases (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text, artist_name text, audio_url text, artwork_url text, release_type text, tracks jsonb, genre text, explicit boolean, label_imprint text, copyright_c_line text, copyright_p_line text, upc text, isrc text, release_date date, song_id uuid);
CREATE TABLE distribution_toolost_submissions (id uuid PRIMARY KEY, release_id uuid NOT NULL UNIQUE, user_id uuid NOT NULL, provider_release_id text, state text NOT NULL DEFAULT 'draft', failure_reason text, ai_declaration jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const CREATOR = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", legacyRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = CREATOR;
  testState.userEmail = "creator@example.com";
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); });

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function seedConnection(opts?: { expired?: boolean }) {
  const expires = new Date(Date.now() + (opts?.expired ? -3600_000 : 15 * 24 * 3600_000)).toISOString();
  await testState.db.execute(sql`INSERT INTO social_accounts (id, user_id, platform, provider_user_id, username, access_token_encrypted, refresh_token_encrypted, token_expires_at)
    VALUES (${randomUUID()}, ${CREATOR}, 'toolost', '4242', 'Creator One', ${encryptToken("tl-access-1")}, ${encryptToken("tl-refresh-1")}, ${expires})`);
}

async function seedRelease(opts?: { songSource?: string | null; audio?: boolean; artwork?: boolean; owner?: string }): Promise<string> {
  const releaseId = randomUUID();
  const owner = opts?.owner ?? CREATOR;
  let songId: string | null = null;
  if (opts?.songSource) {
    songId = randomUUID();
    await testState.db.execute(sql`INSERT INTO songs (id, user_id, source) VALUES (${songId}, ${owner}, ${opts.songSource})`);
  }
  await testState.db.execute(sql`INSERT INTO distribution_releases (id, user_id, title, artist_name, audio_url, artwork_url, release_type, tracks, genre, explicit, label_imprint, copyright_c_line, copyright_p_line, upc, isrc, release_date, song_id)
    VALUES (${releaseId}, ${owner}, 'Midnight Run', 'Creator One',
      ${opts?.audio === false ? null : "https://files.example.com/audio/track.wav"},
      ${opts?.artwork === false ? null : "https://files.example.com/art/cover.png"},
      'single', '[{"title":"Midnight Run","isrc":"USRC10000001"}]'::jsonb, 'hip-hop', false, 'Bow Down Records', NULL, NULL, NULL, 'USRC10000001', '2027-01-15', ${songId})`);
  return releaseId;
}

interface ProviderCall { url: string; method: string; auth: string | null; body: any }
interface ProviderBehavior { failAt?: "create" | "metadata" | "submit"; unauthorizedCreateOnce?: boolean; refreshFails?: boolean }

function installProvider(behavior: ProviderBehavior = {}) {
  const calls: ProviderCall[] = [];
  let createAttempts = 0;
  const stub = vi.fn(async (url: any, init: any) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    /* The OAuth token call sends a form-encoded body — only JSON bodies parse. */
    let body = init?.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = undefined; } }
    calls.push({ url: u, method, auth: init?.headers?.Authorization ?? null, body });
    const json = (status: number, payload: unknown) => ({ ok: status < 400, status, json: async () => payload, arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer, headers: { get: () => "audio/wav" } });
    if (u.includes("files.example.com")) return json(200, {});
    if (u.includes("s3.example.com")) return json(200, {});
    if (u.includes("toolost.com/oauth/token")) {
      if (behavior.refreshFails) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: "tl-access-2", refresh_token: "tl-refresh-2", expires_in: 1296000, token_type: "Bearer" });
    }
    if (u.endsWith("/v1/releases") && method === "POST") {
      createAttempts += 1;
      if (behavior.unauthorizedCreateOnce && createAttempts === 1) return json(401, { message: "token expired" });
      if (behavior.failAt === "create") return json(500, { message: "RAW_PROVIDER_MARKER_XYZ" });
      return json(200, { data: { id: 73518 } });
    }
    if (u.endsWith("/tracks/upload-url")) return json(200, { uploadUrl: "https://s3.example.com/put-audio", fileKey: "audio-key-1", headers: { "Content-Type": "audio/wav" } });
    if (u.endsWith("/artwork/upload-url")) return json(200, { uploadUrl: "https://s3.example.com/put-art", fileKey: "cover-key-1", headers: { "Content-Type": "image/png" } });
    if (u.endsWith("/tracks") && method === "PUT") return json(200, {});
    if (u.endsWith("/metadata") && method === "PATCH") {
      if (behavior.failAt === "metadata") return json(422, { message: "RAW_PROVIDER_MARKER_XYZ" });
      return json(200, {});
    }
    if (u.endsWith("/submit") && method === "POST") {
      if (behavior.failAt === "submit") return json(500, { message: "RAW_PROVIDER_MARKER_XYZ" });
      return json(200, {});
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  });
  vi.stubGlobal("fetch", stub);
  return calls;
}

const apiCalls = (calls: ProviderCall[]) => calls.filter((c) => c.url.includes("api.toolost.com"));
const metaBody = (calls: ProviderCall[]) => calls.find((c) => c.url.endsWith("/metadata"))?.body;

const NOT_AI = { aiDeclaration: { isAiGenerated: false } };
const AI_WITH_DOC = { aiDeclaration: { isAiGenerated: true, aiDocumentation: { fileName: "rights.pdf", fileUrl: "https://files.example.com/rights.pdf" } } };

describe("happy path", () => {
  it("runs the pipeline in order and lands in_review, AI declaration on the metadata call", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload" });
    const calls = installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(200);
    expect(r.json.submission.state).toBe("in_review");
    expect(r.json.submission.providerReleaseId).toBe("73518");

    const seq = apiCalls(calls).map((c) => `${c.method} ${c.url.replace("https://api.toolost.com/v1", "")}`);
    expect(seq).toEqual([
      "POST /releases",
      "POST /releases/73518/tracks/upload-url",
      "POST /releases/73518/artwork/upload-url",
      "PUT /releases/73518/tracks",
      "PATCH /releases/73518/metadata",
      "POST /releases/73518/submit",
    ]);
    expect(apiCalls(calls).every((c) => c.auth === "Bearer tl-access-1")).toBe(true);
    const puts = calls.filter((c) => c.url.includes("s3.example.com"));
    expect(puts).toHaveLength(2);
    expect(calls.find((c) => c.url.endsWith("/tracks") && c.method === "PUT")!.body)
      .toEqual({ tracks: [{ title: "Midnight Run", isrc: "USRC10000001", audioFileKey: "audio-key-1" }] });
    const meta = metaBody(calls);
    expect(meta.isAiGenerated).toBe(false);
    expect(meta).not.toHaveProperty("aiDocumentation");
    expect(meta.coverFileKey).toBe("cover-key-1");
    expect(meta).not.toHaveProperty("coverUrl");

    const list = await req("GET", "/distribution/toolost/submissions");
    expect(list.json).toMatchObject({ configured: true, connected: true });
    expect(list.json.submissions).toHaveLength(1);
    expect(list.json.submissions[0]).toMatchObject({ releaseId, state: "in_review", failureReason: null });
  });

  it("ships isAiGenerated + aiDocumentation for an AI-made song declared with its rights doc", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "generated" });
    const calls = installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, AI_WITH_DOC);
    expect(r.status).toBe(200);
    const meta = metaBody(calls);
    expect(meta.isAiGenerated).toBe(true);
    expect(meta.aiDocumentation).toEqual({ fileName: "rights.pdf", fileUrl: "https://files.example.com/rights.pdf" });
  });
});

describe("the AI gate — refused BEFORE any provider call", () => {
  it("no declaration at all → 400, zero provider calls, no submission row", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "generated" });
    const calls = installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, {});
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("ai_declaration_required");
    expect(calls).toHaveLength(0);
    const rows = await testState.db.execute(sql`SELECT id FROM distribution_toolost_submissions`);
    expect(rows.rows).toHaveLength(0);
  });

  it("declaring 'not AI' for a song our records show was AI-made → 400 conflict, zero provider calls", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "generated" });
    const calls = installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("ai_declaration_conflict");
    expect(calls).toHaveLength(0);
  });

  it("AI declared without rights documentation → 400, zero provider calls", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload" });
    const calls = installProvider();
    const noDoc = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, { aiDeclaration: { isAiGenerated: true } });
    expect(noDoc.status).toBe(400);
    expect(noDoc.json.error).toBe("ai_documentation_required");
    const badUrl = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, { aiDeclaration: { isAiGenerated: true, aiDocumentation: { fileName: "rights.pdf", fileUrl: "ftp://files.example.com/rights.pdf" } } });
    expect(badUrl.status).toBe(400);
    expect(badUrl.json.error).toBe("ai_documentation_required");
    expect(calls).toHaveLength(0);
  });
});

describe("connection + token lifecycle", () => {
  it("not connected → 409 connect_required, zero provider calls", async () => {
    const releaseId = await seedRelease({ songSource: "upload" });
    const calls = installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("connect_required");
    expect(calls).toHaveLength(0);
  });

  it("an expired stored token is refreshed BEFORE the pipeline, and the new pair is persisted", async () => {
    await seedConnection({ expired: true });
    const releaseId = await seedRelease({ songSource: "upload" });
    const calls = installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(200);
    const tokenIdx = calls.findIndex((c) => c.url.includes("oauth/token"));
    const createIdx = calls.findIndex((c) => c.url.endsWith("/v1/releases"));
    expect(tokenIdx).toBeGreaterThanOrEqual(0);
    expect(tokenIdx).toBeLessThan(createIdx);
    expect(calls[createIdx]!.auth).toBe("Bearer tl-access-2");
    const rows = await testState.db.execute(sql`SELECT access_token_encrypted, refresh_token_encrypted FROM social_accounts WHERE user_id = ${CREATOR} AND platform = 'toolost'`);
    expect(rows.rows).toHaveLength(1);
    expect(decryptToken((rows.rows[0] as any).access_token_encrypted)).toBe("tl-access-2");
    expect(decryptToken((rows.rows[0] as any).refresh_token_encrypted)).toBe("tl-refresh-2");
  });

  it("a failed refresh is an honest 409 reconnect — failed state recorded, pipeline never starts", async () => {
    await seedConnection({ expired: true });
    const releaseId = await seedRelease({ songSource: "upload" });
    const calls = installProvider({ refreshFails: true });
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("toolost_reconnect");
    expect(apiCalls(calls)).toHaveLength(0);
    const rows = await testState.db.execute(sql`SELECT state, failure_reason FROM distribution_toolost_submissions WHERE release_id = ${releaseId}`);
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as any).state).toBe("failed");
    expect((rows.rows[0] as any).failure_reason).toContain("reconnect");
  });

  it("a 401 mid-pipeline forces one refresh and retries the step with the new token", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload" });
    const calls = installProvider({ unauthorizedCreateOnce: true });
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(200);
    const creates = calls.filter((c) => c.url.endsWith("/v1/releases"));
    expect(creates).toHaveLength(2);
    expect(creates[0]!.auth).toBe("Bearer tl-access-1");
    expect(creates[1]!.auth).toBe("Bearer tl-access-2");
    expect(calls.filter((c) => c.url.includes("oauth/token"))).toHaveLength(1);
  });
});

describe("failure honesty + idempotence", () => {
  it("a provider failure lands as failed with OUR reason — raw provider text in neither response nor DB", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload" });
    installProvider({ failAt: "metadata" });
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.json)).not.toContain("RAW_PROVIDER_MARKER_XYZ");
    const rows = await testState.db.execute(sql`SELECT state, failure_reason, provider_release_id FROM distribution_toolost_submissions WHERE release_id = ${releaseId}`);
    expect((rows.rows[0] as any).state).toBe("failed");
    expect((rows.rows[0] as any).failure_reason).toContain("details");
    expect((rows.rows[0] as any).failure_reason).not.toContain("RAW_PROVIDER_MARKER_XYZ");
    expect((rows.rows[0] as any).provider_release_id).toBe("73518");
  });

  it("a retry after failure REUSES the provider draft — create runs once across both attempts", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload" });
    installProvider({ failAt: "metadata" });
    const first = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(first.status).toBe(502);
    const calls = installProvider();
    const second = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(second.status).toBe(200);
    expect(second.json.submission.state).toBe("in_review");
    expect(calls.filter((c) => c.url.endsWith("/v1/releases"))).toHaveLength(0);
  });

  it("an in-review release is never sent twice", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload" });
    const calls = installProvider();
    const first = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(first.status).toBe(200);
    const second = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(second.status).toBe(409);
    expect(second.json.error).toBe("already_in_review");
    expect(calls.filter((c) => c.url.endsWith("/v1/releases"))).toHaveLength(1);
  });

  it("a release with no audio is refused plainly before any provider call", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload", audio: false });
    const calls = installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("no_audio");
    expect(calls).toHaveLength(0);
  });

  it("someone else's release is a plain 404", async () => {
    await seedConnection();
    const releaseId = await seedRelease({ songSource: "upload", owner: randomUUID() });
    installProvider();
    const r = await req("POST", `/distribution/toolost/releases/${releaseId}/submit`, NOT_AI);
    expect(r.status).toBe(404);
  });
});
