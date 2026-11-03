/**
 * Too Lost release submission — the DARK state (Front 14).
 * No TOOLOST_CLIENT_ID / TOOLOST_CLIENT_SECRET in this file's env, so
 * the submission rail must be cleanly unavailable: the submit endpoint
 * answers an honest 503 not_configured and the submissions list
 * reports configured:false — no fake pipeline, no provider call.
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
  getOpenAI: () => ({ chat: { completions: { create: async () => { throw new Error("not used"); } } } }),
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: vi.fn(async (v: string) => v), mirrorProjectScenes: vi.fn(async (v: unknown) => v) }));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

import legacyRouter from "../distribution-legacy";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE social_accounts (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL DEFAULT 'instagram', ig_user_id text, provider_user_id text, username text, page_id text, page_name text, access_token_encrypted text, refresh_token_encrypted text, token_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
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

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("toolost submission rail — unconfigured", () => {
  it("submit answers an honest 503 not_configured", async () => {
    const r = await req("POST", `/distribution/toolost/releases/${randomUUID()}/submit`, { aiDeclaration: { isAiGenerated: false } });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("not_configured");
  });

  it("the submissions list reports the dark state plainly", async () => {
    const r = await req("GET", "/distribution/toolost/submissions");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ configured: false, connected: false, submissions: [] });
  });
});
