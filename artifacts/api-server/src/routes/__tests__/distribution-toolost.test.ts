/**
 * Too Lost distribution connection (Front 12) — driven like real callers
 * over HTTP against pg-mem, same harness as distribution-legacy.test.ts.
 * Covers: the authorize URL (PKCE S256, verifier bound server-side),
 * the callback success path with a mocked token exchange, state
 * mismatch refusal, exchange-failure honesty, denial + missing params,
 * and the status surface. The unconfigured state has its own file
 * (distribution-toolost-unconfigured.test.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "crypto";
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
  getOpenAI: () => ({ chat: { completions: { create: async () => { throw new Error("not used"); } } } }),
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: vi.fn(async (v: string) => v), mirrorProjectScenes: vi.fn(async (v: unknown) => v) }));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

import legacyRouter from "../distribution-legacy";
import { createTestDb } from "../../lib/__tests__/test-db";
import { decryptToken } from "../../lib/social-crypto";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE social_accounts (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL DEFAULT 'instagram', ig_user_id text, provider_user_id text, username text, page_id text, page_name text, access_token_encrypted text, refresh_token_encrypted text, token_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
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

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any, headers: r.headers };
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintAuth(): Promise<{ state: string; challenge: string }> {
  const auth = await req("GET", "/distribution/toolost/auth-url");
  expect(auth.status).toBe(200);
  const url = new URL(auth.json.authUrl);
  return { state: url.searchParams.get("state")!, challenge: url.searchParams.get("code_challenge")! };
}

function stubToolostOk(capture?: (url: string, init: any) => void) {
  const stub = vi.fn(async (url: any, init: any) => {
    capture?.(String(url), init);
    if (String(url).includes("toolost.com/oauth/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tl-access-1", refresh_token: "tl-refresh-1", expires_in: 1296000, token_type: "Bearer" }) };
    }
    if (String(url).includes("api.toolost.com/v1/me")) {
      return { ok: true, status: 200, json: async () => ({ id: 4242, display_name: "Creator One" }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

describe("toolost auth-url", () => {
  it("returns the authorize URL with PKCE S256 and the app-request scopes", async () => {
    const auth = await req("GET", "/distribution/toolost/auth-url");
    expect(auth.status).toBe(200);
    const url = new URL(auth.json.authUrl);
    expect(url.origin + url.pathname).toBe("https://toolost.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("tl-test-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://bowdownvisuals.com/api/distribution/toolost/callback");
    expect(url.searchParams.get("scope")).toBe("read:profile read:catalog write:releases read:analytics read:earnings");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(auth.json.authUrl).not.toContain("tl-test-secret");
  });
});

describe("toolost callback", () => {
  it("exchanges code + the state-bound verifier, stores encrypted tokens, and reports connected", async () => {
    const { state, challenge } = await mintAuth();
    let tokenForm: URLSearchParams | null = null;
    stubToolostOk((_url, init) => {
      if (typeof init?.body === "string") tokenForm = new URLSearchParams(init.body);
    });
    const cb = await realFetch(`${baseUrl}/distribution/toolost/callback?code=auth-code-1&state=${state}`, { redirect: "manual" });
    vi.unstubAllGlobals();
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("/distribute?toolost=connected");
    /* The verifier sent to the token endpoint must be the one whose
       S256 hash rode the authorize URL — the PKCE binding is real. */
    expect(tokenForm).not.toBeNull();
    expect(tokenForm!.get("grant_type")).toBe("authorization_code");
    expect(tokenForm!.get("code")).toBe("auth-code-1");
    expect(tokenForm!.get("client_secret")).toBe("tl-test-secret");
    expect(s256(tokenForm!.get("code_verifier")!)).toBe(challenge);

    const rows = await testState.db.execute(sql`SELECT platform, provider_user_id, username, access_token_encrypted, refresh_token_encrypted, token_expires_at FROM social_accounts WHERE user_id = ${CREATOR}`);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as any;
    expect(row.platform).toBe("toolost");
    expect(row.provider_user_id).toBe("4242");
    expect(row.username).toBe("Creator One");
    expect(decryptToken(row.access_token_encrypted)).toBe("tl-access-1");
    expect(decryptToken(row.refresh_token_encrypted)).toBe("tl-refresh-1");
    expect(new Date(row.token_expires_at).getTime()).toBeGreaterThan(Date.now() + 14 * 24 * 3600 * 1000);

    const status = await req("GET", "/distribution/toolost/status");
    expect(status.json).toMatchObject({ configured: true, connected: true, username: "Creator One" });
  });

  it("refuses a state it didn't mint (bad_state) and stores nothing", async () => {
    stubToolostOk();
    const cb = await realFetch(`${baseUrl}/distribution/toolost/callback?code=auth-code-1&state=deadbeefdeadbeef`, { redirect: "manual" });
    vi.unstubAllGlobals();
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("toolost=error");
    expect(cb.headers.get("location")).toContain("reason=bad_state");
    const rows = await testState.db.execute(sql`SELECT id FROM social_accounts`);
    expect(rows.rows).toHaveLength(0);
  });

  it("consumes the state — replaying the same callback fails as bad_state", async () => {
    const { state } = await mintAuth();
    stubToolostOk();
    const first = await realFetch(`${baseUrl}/distribution/toolost/callback?code=auth-code-1&state=${state}`, { redirect: "manual" });
    expect(first.headers.get("location")).toContain("toolost=connected");
    const replay = await realFetch(`${baseUrl}/distribution/toolost/callback?code=auth-code-1&state=${state}`, { redirect: "manual" });
    vi.unstubAllGlobals();
    expect(replay.headers.get("location")).toContain("reason=bad_state");
  });

  it("fails honestly when the token exchange is refused — no row, plain reason", async () => {
    const { state } = await mintAuth();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "expired code" }) })));
    const cb = await realFetch(`${baseUrl}/distribution/toolost/callback?code=stale-code&state=${state}`, { redirect: "manual" });
    vi.unstubAllGlobals();
    expect(cb.status).toBe(302);
    const loc = cb.headers.get("location")!;
    expect(loc).toContain("toolost=error");
    expect(loc).toContain("reason=token_exchange_failed");
    expect(loc).not.toContain("invalid_grant");
    const rows = await testState.db.execute(sql`SELECT id FROM social_accounts`);
    expect(rows.rows).toHaveLength(0);
    const status = await req("GET", "/distribution/toolost/status");
    expect(status.json).toMatchObject({ configured: true, connected: false, username: null });
  });

  it("maps a user denial and missing params to plain reasons", async () => {
    const denied = await realFetch(`${baseUrl}/distribution/toolost/callback?error=access_denied&state=whatever`, { redirect: "manual" });
    expect(denied.headers.get("location")).toContain("reason=denied");
    const missing = await realFetch(`${baseUrl}/distribution/toolost/callback`, { redirect: "manual" });
    expect(missing.headers.get("location")).toContain("reason=missing_params");
  });

  it("reconnect replaces the stored account instead of stacking rows", async () => {
    const first = await mintAuth();
    stubToolostOk();
    await realFetch(`${baseUrl}/distribution/toolost/callback?code=c1&state=${first.state}`, { redirect: "manual" });
    vi.unstubAllGlobals();
    const second = await mintAuth();
    stubToolostOk();
    await realFetch(`${baseUrl}/distribution/toolost/callback?code=c2&state=${second.state}`, { redirect: "manual" });
    vi.unstubAllGlobals();
    const rows = await testState.db.execute(sql`SELECT id FROM social_accounts WHERE user_id = ${CREATOR} AND platform = 'toolost'`);
    expect(rows.rows).toHaveLength(1);
  });
});

describe("toolost status (before any connect)", () => {
  it("reports configured but not connected", async () => {
    const status = await req("GET", "/distribution/toolost/status");
    expect(status.json).toMatchObject({ configured: true, connected: false, username: null });
  });
});
