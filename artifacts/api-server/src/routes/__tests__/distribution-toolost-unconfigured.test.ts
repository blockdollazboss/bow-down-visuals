/**
 * Too Lost distribution connection — the DARK state (Front 12).
 * No TOOLOST_CLIENT_ID / TOOLOST_CLIENT_SECRET in this file's env, so the
 * integration must be cleanly unavailable: auth-url answers an honest
 * 503 not_configured, status reports configured:false, and the callback
 * never stores anything. A fake connect flow here would be a defect.
 * Kept in its own file because the configured suite sets the env vars.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

delete process.env["TOOLOST_CLIENT_ID"];
delete process.env["TOOLOST_CLIENT_SECRET"];
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

describe("toolost dark state (unconfigured)", () => {
  it("auth-url answers 503 not_configured with a plain message — no fake authorize URL", async () => {
    const auth = await req("GET", "/distribution/toolost/auth-url");
    expect(auth.status).toBe(503);
    expect(auth.json.error).toBe("not_configured");
    expect(auth.json.message).toContain("isn't configured yet");
    expect(auth.json.authUrl).toBeUndefined();
  });

  it("status reports configured:false, connected:false", async () => {
    const status = await req("GET", "/distribution/toolost/status");
    expect(status.status).toBe(200);
    expect(status.json).toMatchObject({ configured: false, connected: false, username: null });
  });

  it("a stray callback with a minted-looking state still fails closed (bad_state) and stores nothing", async () => {
    const cb = await realFetch(`${baseUrl}/distribution/toolost/callback?code=anything&state=0123456789abcdef0123456789abcdef01234567`, { redirect: "manual" });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("reason=bad_state");
    const rows = await testState.db.execute(sql`SELECT id FROM social_accounts`);
    expect(rows.rows).toHaveLength(0);
  });
});
