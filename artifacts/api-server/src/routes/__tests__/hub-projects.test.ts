/**
 * Hub projects (0142, DE-20): hub_projects used to be keyed by user_id —
 * one commingled project per creator. Now a surrogate id PK + a
 * client_ref upsert key let one user hold many projects. These drive
 * the REAL router over HTTP against pg-mem:
 * - two clientRefs = two rows; re-saving one updates only its row
 * - a lone legacy row (client_ref NULL) is claimed, not duplicated
 * - id-targeted saves 404 for another user's project
 * - GET /hub/project returns the most recently updated project
 * - GET /hub/projects lists them all
 * - artistVaultId round-trips (G8)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const testState = vi.hoisted(() => ({ db: null as any, userId: "" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
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

vi.mock("../../lib/retention", () => ({ recordCreation: vi.fn(async () => {}) }));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: vi.fn(async (v: any) => v),
  normalizeToStorageRef: vi.fn((v: string) => v),
}));

import hubProjectsRouter from "../hub-projects";

const DDL = `
CREATE TABLE hub_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_ref text,
  name text NOT NULL DEFAULT 'Untitled Project',
  type text NOT NULL DEFAULT 'song',
  assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  concept text NOT NULL DEFAULT '',
  template_key text,
  attribution boolean NOT NULL DEFAULT true,
  artist_vault_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const USER_A = randomUUID();
const USER_B = randomUUID();
const VAULT_ID = randomUUID();

let server: any;
let baseUrl: string;

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

function saveBody(over: Record<string, unknown> = {}) {
  return {
    name: "Project",
    type: "song",
    assets: [],
    concept: "",
    templateKey: null,
    attribution: true,
    updatedAt: Date.now(),
    ...over,
  };
}

beforeAll(async () => {
  const mem = newDb();
  /* pg-mem ships almost no native functions — register the one the
     table default needs. */
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: DataType.uuid,
    /* impure: otherwise pg-mem constant-folds the default and every
       inserted row gets the same id. */
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const clientShim = {
    query: (config: unknown, values?: unknown[]) => {
      const cfg =
        config !== null && typeof config === "object" && !Array.isArray(config) && "types" in config
          ? (({ types: _s, ...rest }: Record<string, unknown>) => rest)(config as Record<string, unknown>)
          : config;
      return (pool as any).query(cfg, values);
    },
  };
  testState.db = drizzle(clientShim as never);
  const app = express();
  app.use("/api", hubProjectsRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(async () => {
  await testState.db.execute(sql`DELETE FROM hub_projects`);
  testState.userId = USER_A;
});

describe("hub projects (0142 multi-project)", () => {
  it("two clientRefs become two projects; re-saving one updates only its row", async () => {
    const a = await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", name: "Alpha" }));
    expect(a.status).toBe(200);
    const b = await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-b", name: "Beta" }));
    expect(b.status).toBe(200);
    expect(a.json.id).not.toBe(b.json.id);

    const again = await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", name: "Alpha v2" }));
    expect(again.json.id).toBe(a.json.id);

    const list = await req("GET", "/api/hub/projects");
    expect(list.json.projects).toHaveLength(2);
    expect(list.json.projects.map((p: any) => p.name).sort()).toEqual(["Alpha v2", "Beta"]);
  });

  it("a lone legacy row (client_ref NULL) is claimed by the first clientRef save", async () => {
    const legacyId = randomUUID();
    await testState.db.execute(sql`
      INSERT INTO hub_projects (id, user_id, name, type, updated_at)
      VALUES (${legacyId}, ${USER_A}, ${"Legacy"}, ${"song"}, now())
    `);
    const saved = await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-new", name: "Claimed" }));
    expect(saved.json.id).toBe(legacyId);
    const list = await req("GET", "/api/hub/projects");
    expect(list.json.projects).toHaveLength(1);
    expect(list.json.projects[0].name).toBe("Claimed");
  });

  it("id-targeted save updates the row; another user's id 404s", async () => {
    const created = await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", name: "Mine" }));
    const id = created.json.id as string;

    const updated = await req("PUT", "/api/hub/project", saveBody({ id, name: "Mine v2" }));
    expect(updated.status).toBe(200);
    expect(updated.json.id).toBe(id);

    testState.userId = USER_B;
    const stolen = await req("PUT", "/api/hub/project", saveBody({ id, name: "Stolen" }));
    expect(stolen.status).toBe(404);
    const listB = await req("GET", "/api/hub/projects");
    expect(listB.json.projects).toHaveLength(0);
  });

  it("GET /hub/project returns the most recently updated project with its clientRef", async () => {
    await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", name: "First", updatedAt: 1000 }));
    await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-b", name: "Second", updatedAt: 2000 }));
    const got = await req("GET", "/api/hub/project");
    expect(got.json.project.name).toBe("Second");
    expect(got.json.project.clientRef).toBe("proj-b");
    expect(got.json.project.id).toBeTruthy();
  });

  it("artistVaultId round-trips and an explicit null clears it (G8)", async () => {
    await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", artistVaultId: VAULT_ID }));
    let got = await req("GET", "/api/hub/project");
    expect(got.json.project.artistVaultId).toBe(VAULT_ID);
    await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", artistVaultId: null }));
    got = await req("GET", "/api/hub/project");
    expect(got.json.project.artistVaultId).toBeNull();
  });

  it("DELETE ?id= removes only that project", async () => {
    const a = await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", name: "A" }));
    await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-b", name: "B" }));
    await req("DELETE", `/api/hub/project?id=${a.json.id}`);
    const list = await req("GET", "/api/hub/projects");
    expect(list.json.projects.map((p: any) => p.name)).toEqual(["B"]);
  });
});

describe("GET /hub/projects/:id — open any project by id (wave-2 #3)", () => {
  it("the owner opens their own OLDER project by id, with the full payload", async () => {
    const asset = {
      id: "asset-1", kind: "song", url: "https://example.com/song.mp3",
      label: "Song One", createdAt: 123,
    };
    const older = await req("PUT", "/api/hub/project", saveBody({
      clientRef: "proj-a", name: "First", concept: "the older one",
      assets: [asset], updatedAt: 1000,
    }));
    await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-b", name: "Second", updatedAt: 2000 }));

    /* The singular read would give "Second" — the by-id read must
       give the older row, payload and all. */
    const got = await req("GET", `/api/hub/projects/${older.json.id}`);
    expect(got.status).toBe(200);
    expect(got.json.project.id).toBe(older.json.id);
    expect(got.json.project.name).toBe("First");
    expect(got.json.project.clientRef).toBe("proj-a");
    expect(got.json.project.concept).toBe("the older one");
    expect(got.json.project.assets).toEqual([asset]);
    expect(got.json.project.updatedAt).toBe(1000);
  });

  it("another member's project id reads as 404 — no existence leak", async () => {
    const mine = await req("PUT", "/api/hub/project", saveBody({ clientRef: "proj-a", name: "Mine" }));

    testState.userId = USER_B;
    const stolen = await req("GET", `/api/hub/projects/${mine.json.id}`);
    expect(stolen.status).toBe(404);
    expect(stolen.json.project).toBeUndefined();
    expect(JSON.stringify(stolen.json)).not.toContain("Mine");
  });

  it("a missing id 404s, and a malformed id 404s instead of 500ing", async () => {
    const missing = await req("GET", `/api/hub/projects/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.json.project).toBeUndefined();

    const malformed = await req("GET", "/api/hub/projects/not-a-uuid");
    expect(malformed.status).toBe(404);
    expect(malformed.json.project).toBeUndefined();
  });

  it("the summaries endpoint is unchanged — no payload fields ride along", async () => {
    await req("PUT", "/api/hub/project", saveBody({
      clientRef: "proj-a", name: "Summarized", concept: "must not leak into the list",
      assets: [{ id: "asset-1", kind: "song", url: "https://example.com/s.mp3", label: "S", createdAt: 1 }],
    }));
    const list = await req("GET", "/api/hub/projects");
    expect(list.status).toBe(200);
    expect(list.json.projects).toHaveLength(1);
    const row = list.json.projects[0];
    expect(Object.keys(row).sort()).toEqual(["artistVaultId", "id", "name", "type", "updatedAt"]);
    expect(row.assets).toBeUndefined();
    expect(row.concept).toBeUndefined();
    expect(row.clientRef).toBeUndefined();
  });
});
