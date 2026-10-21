/**
 * Website builder persistence (migration 0196, dossier gap G2) —
 * POST /api/website-builder/generate + /edit and the /projects
 * endpoints over HTTP against pg-mem, with the header-driven
 * requireAuth mock so the 401 and cross-owner 404 cases are real.
 *
 * Pins:
 * - a generate SAVES a project + version 1, and a re-open returns the
 *   exact payload byte-identical (the refresh-loses-the-site defect)
 * - an edit appends version 2 (source 'edit', note = the request);
 *   version 1 is never touched
 * - a re-generation into the project appends a 'regenerate' version
 *   and moves the project brief
 * - restore APPENDS a copy as the new head — history is never rewound
 * - another member's project is a 404 everywhere and a foreign
 *   projectId is refused BEFORE any charge (charge spy stays silent)
 * - explicit save is idempotent by clientRef (identical payload
 *   dedupes; changed payload appends a 'save' version)
 * - delete removes project + versions, owner only
 * - persistence adds NO charges: exactly one build charge per
 *   generate, one edit charge per edit, at the standing prices
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({
  db: null as any,
  aiFiles: {} as Record<string, string>,
  chargeCalls: [] as Array<{ userId: string; amount: number; action?: string }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
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
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(testState.aiFiles) } }],
        }),
      },
    },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    OutOfCreditsError,
    chargeCredits: vi.fn(async (userId: string, amount: number, opts?: { action?: string }) => {
      testState.chargeCalls.push({ userId, amount, action: opts?.action });
    }),
    refundCredits: vi.fn(async (userId: string, amount: number) => {
      testState.refundCalls.push({ userId, amount });
    }),
  };
});

import websiteBuilderRouter, {
  WEBSITE_BUILD_CREDITS,
  WEBSITE_EDIT_CREDITS,
} from "../generate/website-builder";
import { createTestDb } from "../../lib/__tests__/test-db";

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
`;

/* File payloads carry quotes, unicode, and markup on purpose — the
   round-trip must be byte-identical, not merely similar. */
const SITE_V1: Record<string, string> = {
  "index.html": "<!doctype html>\n<html><head><link rel=\"stylesheet\" href=\"styles.css\"></head><body><h1>© TRGDY TRBLZ — “gold” &amp; loud</h1></body></html>",
  "styles.css": "body { background: #0a0a0a; color: #f5d76e; }\nh1::after { content: \"★\"; }",
  "script.js": "console.log('v1 — ready');",
  "README.md": "# V1 site\nDeploy it anywhere.\n",
};
const SITE_V2: Record<string, string> = {
  ...SITE_V1,
  "index.html": "<!doctype html>\n<html><head><link rel=\"stylesheet\" href=\"styles.css\"></head><body><h1>DARKER HERO</h1></body></html>",
  "styles.css": "body { background: #000; color: #f5d76e; }",
};
const SITE_V3: Record<string, string> = {
  ...SITE_V1,
  "index.html": "<!doctype html>\n<html><head><link rel=\"stylesheet\" href=\"styles.css\"></head><body><h1>REBUILT FROM SCRATCH</h1></body></html>",
  "shows.html": "<!doctype html><html><body>Tour dates</body></html>",
};

const OWNER = randomUUID();
const STRANGER = randomUUID();
const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
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
  testState.chargeCalls = [];
  testState.refundCalls = [];
});

async function req(user: string | null, method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

const BRIEF = {
  template: "artist-site",
  businessName: "TRGDY TRBLZ",
  description: "Hip-hop artist from Atlanta — latest single front and center, dark and luxurious.",
  style: "dark luxury",
  colorScheme: "black and gold",
};

async function generateAs(user: string, extra: Record<string, unknown> = {}) {
  return req(user, "POST", "/api/website-builder/generate", { ...BRIEF, ...extra });
}

/** A project with two versions: v1 (generate) + v2 (edit). */
async function seedTwoVersions(user: string) {
  const gen = await generateAs(user, { clientRef: "seed-ref" });
  expect(gen.status).toBe(200);
  const projectId = gen.json.projectId as string;
  testState.aiFiles = SITE_V2;
  const edit = await req(user, "POST", "/api/website-builder/edit", {
    template: BRIEF.template,
    businessName: BRIEF.businessName,
    currentFiles: SITE_V1,
    editRequest: "Make the hero darker",
    projectId,
  });
  expect(edit.status).toBe(200);
  testState.aiFiles = SITE_V1;
  return projectId;
}

describe("website builder persistence", () => {
  it("generate saves a project + version 1, and re-open round-trips byte-identical", async () => {
    const gen = await generateAs(OWNER, { clientRef: "build-1" });
    expect(gen.status).toBe(200);
    expect(gen.json.saved).toBe(true);
    expect(gen.json.version).toBe(1);
    expect(gen.json.projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(gen.json.files).toEqual(SITE_V1);
    /* Persistence added no charge: exactly the one standing build charge. */
    expect(testState.chargeCalls).toEqual([
      { userId: OWNER, amount: WEBSITE_BUILD_CREDITS, action: "Website Build (Artist Site)" },
    ]);
    expect(testState.refundCalls).toEqual([]);

    const list = await req(OWNER, "GET", "/api/website-builder/projects");
    expect(list.status).toBe(200);
    expect(list.json.projects).toHaveLength(1);
    const summary = list.json.projects[0];
    expect(summary).toMatchObject({
      id: gen.json.projectId,
      name: "TRGDY TRBLZ",
      template: "artist-site",
      templateLabel: "Artist Site",
      versionCount: 1,
      latestVersion: 1,
      fileCount: 4,
    });
    /* List payloads carry no site files — metadata only. */
    expect(summary.files).toBeUndefined();

    const reopened = await req(OWNER, "GET", `/api/website-builder/projects/${gen.json.projectId}/versions/1`);
    expect(reopened.status).toBe(200);
    expect(reopened.json.source).toBe("generate");
    expect(reopened.json.brief).toEqual({
      description: BRIEF.description,
      style: BRIEF.style,
      colorScheme: BRIEF.colorScheme,
    });
    expect(reopened.json.files).toEqual(SITE_V1);
    /* Byte-identical, file by file — not merely deep-equal-ish.
       (The map itself is compared per key: jsonb does not promise
       object key order, but every file's contents must be exact.) */
    for (const [path, contents] of Object.entries(SITE_V1)) {
      expect(reopened.json.files[path]).toBe(contents);
    }
    expect(Object.keys(reopened.json.files).sort()).toEqual(Object.keys(SITE_V1).sort());
  });

  it("edit appends version 2 with the request as its note; version 1 is untouched", async () => {
    const projectId = await seedTwoVersions(OWNER);

    const detail = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.project.versionCount).toBe(2);
    expect(detail.json.project.latestVersion).toBe(2);
    expect(detail.json.versions.map((v: any) => [v.version, v.source, v.note])).toEqual([
      [2, "edit", "Make the hero darker"],
      [1, "generate", null],
    ]);

    const v1 = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}/versions/1`);
    expect(v1.json.files).toEqual(SITE_V1);
    const v2 = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}/versions/2`);
    expect(v2.json.files).toEqual(SITE_V2);
    /* The edit inherited the brief of the build it edited. */
    expect(v2.json.brief.description).toBe(BRIEF.description);

    const editCharges = testState.chargeCalls.filter((c) => c.amount === WEBSITE_EDIT_CREDITS);
    expect(editCharges).toHaveLength(1);
  });

  it("re-generation into the project appends a 'regenerate' version and moves the brief", async () => {
    const projectId = await seedTwoVersions(OWNER);
    testState.aiFiles = SITE_V3;
    const regen = await generateAs(OWNER, {
      projectId,
      description: "A rebuilt brief — tour-first this time, every date up top.",
    });
    expect(regen.status).toBe(200);
    expect(regen.json.projectId).toBe(projectId);
    expect(regen.json.version).toBe(3);
    expect(regen.json.saved).toBe(true);

    const detail = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}`);
    expect(detail.json.project.versionCount).toBe(3);
    expect(detail.json.project.brief.description).toBe("A rebuilt brief — tour-first this time, every date up top.");
    const head = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}/versions/3`);
    expect(head.json.source).toBe("regenerate");
    expect(head.json.files).toEqual(SITE_V3);
    /* Still exactly one project — the re-generation did not spawn a copy. */
    const list = await req(OWNER, "GET", "/api/website-builder/projects");
    expect(list.json.projects).toHaveLength(1);
  });

  it("restore appends a copy as the new head — history is never rewound", async () => {
    const projectId = await seedTwoVersions(OWNER);
    const restore = await req(OWNER, "POST", `/api/website-builder/projects/${projectId}/versions/1/restore`);
    expect(restore.status).toBe(200);
    expect(restore.json.version).toBe(3);
    expect(restore.json.restoredFrom).toBe(1);
    expect(restore.json.files).toEqual(SITE_V1);
    /* Restoring is not an AI action — no charge. */
    expect(testState.chargeCalls.filter((c) => c.userId === OWNER)).toHaveLength(2);

    const detail = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}`);
    expect(detail.json.versions.map((v: any) => [v.version, v.source])).toEqual([
      [3, "restore"],
      [2, "edit"],
      [1, "generate"],
    ]);
    const v2 = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}/versions/2`);
    expect(v2.json.files).toEqual(SITE_V2);
  });

  it("another member's project is invisible and untouchable — and refused before any charge", async () => {
    const projectId = await seedTwoVersions(OWNER);
    const chargesBefore = testState.chargeCalls.length;

    expect((await req(STRANGER, "GET", "/api/website-builder/projects")).json.projects).toEqual([]);
    expect((await req(STRANGER, "GET", `/api/website-builder/projects/${projectId}`)).status).toBe(404);
    expect((await req(STRANGER, "GET", `/api/website-builder/projects/${projectId}/versions/1`)).status).toBe(404);
    expect((await req(STRANGER, "POST", `/api/website-builder/projects/${projectId}/versions/1/restore`)).status).toBe(404);
    expect((await req(STRANGER, "DELETE", `/api/website-builder/projects/${projectId}`)).status).toBe(404);

    const foreignEdit = await req(STRANGER, "POST", "/api/website-builder/edit", {
      template: BRIEF.template,
      businessName: BRIEF.businessName,
      currentFiles: SITE_V1,
      editRequest: "Make the hero darker",
      projectId,
    });
    expect(foreignEdit.status).toBe(404);
    const foreignGenerate = await generateAs(STRANGER, { projectId });
    expect(foreignGenerate.status).toBe(404);
    /* Ownership was checked before money: the stranger was never charged. */
    expect(testState.chargeCalls).toHaveLength(chargesBefore);
    expect(testState.chargeCalls.some((c) => c.userId === STRANGER)).toBe(false);

    const detail = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.project.versionCount).toBe(2);
  });

  it("explicit save: clientRef create dedupes an identical retry and appends a changed one", async () => {
    const saveBody = {
      clientRef: "retry-ref",
      template: BRIEF.template,
      businessName: BRIEF.businessName,
      brief: { description: BRIEF.description, style: BRIEF.style, colorScheme: BRIEF.colorScheme },
      files: SITE_V1,
    };
    const first = await req(OWNER, "POST", "/api/website-builder/projects", saveBody);
    expect(first.status).toBe(201);
    expect(first.json.created).toBe(true);
    expect(first.json.version).toBe(1);

    const retry = await req(OWNER, "POST", "/api/website-builder/projects", saveBody);
    expect(retry.status).toBe(200);
    expect(retry.json.deduplicated).toBe(true);
    expect(retry.json.version).toBe(1);
    expect(retry.json.project.versionCount).toBe(1);

    const changed = await req(OWNER, "POST", "/api/website-builder/projects", { ...saveBody, files: SITE_V2 });
    expect(changed.status).toBe(200);
    expect(changed.json.deduplicated).toBe(false);
    expect(changed.json.version).toBe(2);

    const projectId = first.json.project.id as string;
    const v2 = await req(OWNER, "GET", `/api/website-builder/projects/${projectId}/versions/2`);
    expect(v2.json.source).toBe("save");
    expect(v2.json.files).toEqual(SITE_V2);
    /* Saving is free — no charges on any of these calls. */
    expect(testState.chargeCalls).toEqual([]);
  });

  it("explicit save rejects a payload missing required files", async () => {
    const bad = await req(OWNER, "POST", "/api/website-builder/projects", {
      template: BRIEF.template,
      businessName: BRIEF.businessName,
      brief: { description: BRIEF.description },
      files: { "index.html": "<html></html>" },
    });
    expect(bad.status).toBe(400);
    expect((await req(OWNER, "GET", "/api/website-builder/projects")).json.projects).toEqual([]);
  });

  it("delete removes the project and every version, for the owner only", async () => {
    const projectId = await seedTwoVersions(OWNER);
    const del = await req(OWNER, "DELETE", `/api/website-builder/projects/${projectId}`);
    expect(del.status).toBe(200);
    expect(del.json.deleted).toBe(true);
    expect((await req(OWNER, "GET", `/api/website-builder/projects/${projectId}`)).status).toBe(404);
    expect((await req(OWNER, "GET", `/api/website-builder/projects/${projectId}/versions/1`)).status).toBe(404);
    expect((await req(OWNER, "GET", "/api/website-builder/projects")).json.projects).toEqual([]);
    /* Deleting again is a 404, not an error or a resurrection. */
    expect((await req(OWNER, "DELETE", `/api/website-builder/projects/${projectId}`)).status).toBe(404);
  });

  it("edit without a projectId keeps the legacy browser-held behavior and saves nothing", async () => {
    testState.aiFiles = SITE_V2;
    const edit = await req(OWNER, "POST", "/api/website-builder/edit", {
      template: BRIEF.template,
      businessName: BRIEF.businessName,
      currentFiles: SITE_V1,
      editRequest: "Make the hero darker",
    });
    expect(edit.status).toBe(200);
    expect(edit.json.files).toEqual(SITE_V2);
    expect(edit.json.projectId).toBeUndefined();
    expect((await req(OWNER, "GET", "/api/website-builder/projects")).json.projects).toEqual([]);
  });

  it("unauthenticated calls are 401", async () => {
    expect((await req(null, "GET", "/api/website-builder/projects")).status).toBe(401);
    expect((await req(null, "POST", "/api/website-builder/generate", BRIEF)).status).toBe(401);
    expect((await req(null, "DELETE", `/api/website-builder/projects/${randomUUID()}`)).status).toBe(401);
  });
});
