/**
 * Generated clips (routes/generated-clips.ts) — the rail behind the
 * My Projects "Generated Clips" tab.
 *
 * Pins the ownership contract:
 *   • GET /generated-clips lists ONLY the caller's clips.
 *   • POST /generated-clips saves a clip for the caller.
 *   • DELETE /generated-clips/:id removes the caller's own clip —
 *     and MUST NOT remove another user's clip (the delete used to be
 *     scoped by id alone, so any signed-in user could delete anyone's
 *     clip by UUID; the fix scopes it with and(eq(id), eq(user_id)),
 *     the drafts.ts house pattern, with the same no-leak success shape).
 *
 * Fake-db style (mirrors drafts.test.ts): the REAL router + REAL
 * generatedClipsTable column objects, with a fake db implementing
 * only the chains these handlers use; WHERE conditions are read back
 * via PgDialect so eq/and render real SQL + params.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

interface ClipRow {
  id: string;
  user_id: string;
  project_id: string | null;
  scene_id: string | null;
  title: string | null;
  prompt: string | null;
  final_prompt: string | null;
  runway_job_id: string | null;
  artist_vault_id: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  status: string;
  created_at: Date;
}

const testState = vi.hoisted(() => ({
  userId: "",
  rows: new Map<string, ClipRow>(),
}));

const dialect = new PgDialect();
function renderSql(cond: unknown): string {
  return dialect.sqlToQuery(cond as never).sql;
}
function renderParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as never).params as unknown[];
}

/** Filter stored rows by a rendered WHERE: params are matched against
    the columns the SQL names, exactly as Postgres would apply them. */
function matchRows(cond: unknown): ClipRow[] {
  const sqlText = renderSql(cond);
  const params = renderParams(cond);
  let rows = [...testState.rows.values()];
  if (sqlText.includes('"user_id"')) {
    const uid = params.find((p) => rows.some((r) => r.user_id === p)) ?? params[params.length - 1];
    rows = rows.filter((r) => r.user_id === uid);
  }
  if (sqlText.includes('"id"')) {
    const id = params.find((p) => rows.some((r) => r.id === p)) ?? params[0];
    rows = rows.filter((r) => r.id === id);
  }
  return rows;
}

function buildFakeDb() {
  return {
    insert: (_table: unknown) => ({
      values: (v: Omit<ClipRow, "id" | "created_at">) => ({
        returning: async (_sel: unknown) => {
          const row: ClipRow = {
            id: randomUUID(),
            created_at: new Date(),
            ...v,
          };
          testState.rows.set(row.id, row);
          return [{ id: row.id }];
        },
      }),
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (cond: unknown) => ({
          orderBy: (..._args: unknown[]) => ({
            limit: async (n: number) =>
              matchRows(cond)
                .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
                .slice(0, n),
          }),
        }),
      }),
    }),
    delete: (_table: unknown) => ({
      where: async (cond: unknown) => {
        for (const row of matchRows(cond)) testState.rows.delete(row.id);
      },
    }),
  };
}

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
      return buildFakeDb();
    },
  };
});

vi.mock("../../lib/payment-record", () => ({
  recordRunwayClipHistory: vi.fn(async () => {}),
}));

vi.mock("../../lib/credits", () => ({
  refundCredits: vi.fn(async () => {}),
}));

vi.mock("../generate/runway-clip", () => ({
  chargedTasks: new Map<string, unknown>(),
}));

vi.mock("../../lib/objectStorage", () => ({
  /* Stored values pass through as playable URLs in these tests. */
  refreshSupabaseStorageUrl: async (v: string | null) => v,
  normalizeToStorageRef: (v: string | null | undefined): string | null =>
    v != null && (v.startsWith("supabase://") || v.startsWith("r2://")) ? v : null,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  /* No re-hosting in tests: the stored URL stays what the client sent. */
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
}));

import router from "../generated-clips";

const USER_A = randomUUID();
const USER_B = randomUUID();

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  testState.userId = USER_A;
  testState.rows = new Map();
});

function seedClip(userId: string, overrides: Partial<ClipRow> = {}): ClipRow {
  const row: ClipRow = {
    id: randomUUID(),
    user_id: userId,
    project_id: null,
    scene_id: null,
    title: "Scene Clip",
    prompt: "a prompt",
    final_prompt: null,
    runway_job_id: null,
    artist_vault_id: null,
    video_url: "https://cdn.example.com/clip.mp4",
    thumbnail_url: null,
    status: "completed",
    created_at: new Date(),
    ...overrides,
  };
  testState.rows.set(row.id, row);
  return row;
}

describe("GET /generated-clips", () => {
  it("lists only the caller's clips", async () => {
    const mine = seedClip(USER_A);
    seedClip(USER_B);
    const res = await realFetch(`${baseUrl}/generated-clips`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { clips: ClipRow[] };
    expect(data.clips.map((c) => c.id)).toEqual([mine.id]);
  });

  it("returns an honest empty list when the caller has no clips", async () => {
    seedClip(USER_B);
    const res = await realFetch(`${baseUrl}/generated-clips`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { clips: ClipRow[] };
    expect(data.clips).toEqual([]);
  });
});

describe("POST /generated-clips", () => {
  it("saves a clip owned by the caller", async () => {
    const res = await realFetch(`${baseUrl}/generated-clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "My new clip",
        videoUrl: "https://cdn.example.com/new.mp4",
        status: "completed",
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string };
    const stored = testState.rows.get(data.id);
    expect(stored?.user_id).toBe(USER_A);
    expect(stored?.title).toBe("My new clip");
  });
});

describe("DELETE /generated-clips/:id", () => {
  it("deletes the caller's own clip", async () => {
    const mine = seedClip(USER_A);
    const res = await realFetch(`${baseUrl}/generated-clips/${mine.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(testState.rows.has(mine.id)).toBe(false);
  });

  it("does NOT delete another user's clip", async () => {
    const theirs = seedClip(USER_B);
    const res = await realFetch(`${baseUrl}/generated-clips/${theirs.id}`, { method: "DELETE" });
    /* Same success shape (no existence leak) — but the row survives. */
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(testState.rows.has(theirs.id)).toBe(true);
  });

  it("succeeds (no-op) for a clip that never existed", async () => {
    const res = await realFetch(`${baseUrl}/generated-clips/${randomUUID()}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
