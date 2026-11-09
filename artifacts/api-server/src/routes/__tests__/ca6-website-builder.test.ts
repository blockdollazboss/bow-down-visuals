/**
 * CA-6 (charge audit B6) — website-builder, the lane's NAMED SPECIAL.
 * The build charge (3,000, the largest exposed charge in the census)
 * and its sibling edit charge (200) over pg-mem with the REAL
 * generation_stored_results table (migration 0333) and a keyed fake
 * ledger:
 *
 *   - an identical re-ask of /generate is a stored replay: same
 *     projectId, same version, replayed:true, ONE 3,000 charge, ONE
 *     provider call, and still exactly ONE project row / ONE version;
 *   - an identical re-ask of /edit is a stored replay: no second
 *     version appended, ONE 200 charge;
 *   - a provider failure refunds the build charge and VOIDS its key,
 *     so the retry charges fresh and builds.
 *
 * Fresh responses keep the pre-CA-6 wire shape (no replayed field).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({
  db: null as any,
  aiFiles: {} as Record<string, string>,
  aiMode: "ok" as "ok" | "throw",
  aiCalls: 0,
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u);
    req.userCredits = testState.balance;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          testState.aiCalls++;
          if (testState.aiMode === "throw") throw new Error("model down");
          return {
            choices: [{ message: { content: JSON.stringify(testState.aiFiles) } }],
          };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && testState.chargedKeys.has(key)) return testState.balance;
      if (testState.balance < amount) throw new OutOfCreditsError("out");
      testState.balance -= amount;
      if (key) testState.chargedKeys.add(key);
      testState.charges.push({ amount, key });
      return testState.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      testState.balance += amount;
      testState.refunds.push(amount);
      return testState.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      testState.voids.push(key);
      return testState.chargedKeys.delete(key);
    },
  };
});

import websiteBuilderRouter from "../generate/website-builder";
import { createTestDb } from "../../lib/__tests__/test-db";
import { __resetCa6ReplayCache } from "../generate/ca6-replay-guard";

const DDL = `
CREATE TABLE website_builder_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  client_ref TEXT,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX website_builder_projects_client_ref_idx
  ON website_builder_projects (user_id, client_ref);
CREATE INDEX website_builder_projects_user_idx
  ON website_builder_projects (user_id, updated_at DESC);
CREATE TABLE website_builder_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES website_builder_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generate', 'regenerate', 'edit', 'restore', 'save')),
  note TEXT,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  files JSONB NOT NULL,
  file_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX website_builder_versions_project_version_idx
  ON website_builder_versions (project_id, version);
CREATE TABLE generation_stored_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  rail TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX generation_stored_results_key_idx
  ON generation_stored_results (idempotency_key);
`;

const SITE_V1: Record<string, string> = {
  "index.html": "<!doctype html>\n<html><body><h1>CA6 SITE</h1></body></html>",
  "styles.css": "body { background: #0a0a0a; }",
  "script.js": "console.log('v1');",
  "README.md": "# V1\n",
};
const SITE_V2: Record<string, string> = {
  ...SITE_V1,
  "index.html": "<!doctype html>\n<html><body><h1>CA6 SITE — DARKER</h1></body></html>",
};

const OWNER = randomUUID();
const BRIEF = {
  template: "artist-site",
  businessName: "TRGDY TRBLZ",
  description: "Hip-hop artist from Atlanta — latest single front and center, dark and luxurious.",
  style: "dark luxury",
  colorScheme: "black and gold",
};

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {}, warn: () => {} }; next(); });
  app.use("/api/website-builder", websiteBuilderRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(DDL);
  testState.db = db;
  testState.aiFiles = SITE_V1;
  testState.aiMode = "ok";
  testState.aiCalls = 0;
  testState.balance = 100_000;
  testState.charges = [];
  testState.refunds = [];
  testState.voids = [];
  testState.chargedKeys.clear();
  __resetCa6ReplayCache();
});

async function req(user: string, method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

describe("CA-6 website-builder (Pattern C named special)", () => {
  it("build replay: one 3,000 charge, one provider call, same projectId, one project row", async () => {
    const first = await req(OWNER, "POST", "/api/website-builder/generate", { ...BRIEF });
    expect(first.status).toBe(200);
    expect(first.json.replayed).toBeUndefined();
    expect(first.json.saved).toBe(true);
    expect(first.json.projectId).toBeTruthy();
    expect(first.json.version).toBe(1);
    expect(testState.charges).toHaveLength(1);
    expect(testState.charges[0]!.amount).toBe(3000);
    expect(testState.aiCalls).toBe(1);

    const second = await req(OWNER, "POST", "/api/website-builder/generate", { ...BRIEF });
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    expect(second.json.projectId).toBe(first.json.projectId);
    expect(second.json.version).toBe(1);
    expect(testState.charges).toHaveLength(1);
    expect(testState.aiCalls).toBe(1);

    const list = await req(OWNER, "GET", "/api/website-builder/projects");
    expect(list.json.projects).toHaveLength(1);
    const detail = await req(OWNER, "GET", `/api/website-builder/projects/${first.json.projectId}`);
    expect(detail.json.project.versionCount).toBe(1);
  });

  it("edit replay: one 200 charge, no second version appended", async () => {
    const gen = await req(OWNER, "POST", "/api/website-builder/generate", { ...BRIEF });
    const projectId = gen.json.projectId as string;
    testState.aiFiles = SITE_V2;
    const editBody = {
      template: BRIEF.template,
      businessName: BRIEF.businessName,
      currentFiles: SITE_V1,
      editRequest: "Make the hero darker",
      projectId,
    };
    const edit = await req(OWNER, "POST", "/api/website-builder/edit", editBody);
    expect(edit.status).toBe(200);
    expect(edit.json.replayed).toBeUndefined();
    expect(edit.json.version).toBe(2);

    const again = await req(OWNER, "POST", "/api/website-builder/edit", editBody);
    expect(again.status).toBe(200);
    expect(again.json.replayed).toBe(true);
    expect(again.json.version).toBe(2);
    expect(testState.charges.filter((c) => c.amount === 200)).toHaveLength(1);

    const detail = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}`);
    expect(detail.json.project.versionCount).toBe(2);
  });

  it("build failure refunds + voids; the retry charges fresh and builds", async () => {
    testState.aiMode = "throw";
    const failed = await req(OWNER, "POST", "/api/website-builder/generate", { ...BRIEF });
    expect(failed.status).toBe(500);
    expect(testState.refunds).toEqual([3000]);
    expect(testState.voids).toHaveLength(1);

    testState.aiMode = "ok";
    const retry = await req(OWNER, "POST", "/api/website-builder/generate", { ...BRIEF });
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBeUndefined();
    expect(testState.charges).toHaveLength(2);
  });
});
