/**
 * Photo editor routes (Stack 7): presets CRUD + public slug + batch
 * look-sync per-photo outcomes. Fake-db style like drafts.test.ts:
 * REAL router, fake db implementing only the chains used, WHERE
 * params read back via PgDialect.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

interface PresetRow {
  id: string; user_id: string; name: string; recipe: Record<string, unknown>;
  is_public: boolean; share_slug: string | null; store_product_id: string | null;
  created_at: Date; updated_at: Date;
}
const testState = vi.hoisted(() => ({ userId: "user-1", rows: [] as PresetRow[] }));
const dialect = new PgDialect();
const params = (cond: unknown): unknown[] => dialect.sqlToQuery(cond as never).params as unknown[];

function fakeDb() {
  return {
    insert: () => ({
      values: (v: Omit<PresetRow, "id" | "created_at" | "updated_at" | "store_product_id">) => ({
        returning: async () => {
          const row: PresetRow = { id: randomUUID(), store_product_id: null, created_at: new Date(), updated_at: new Date(), ...v, recipe: JSON.parse(JSON.stringify(v.recipe)) as Record<string, unknown> };
          testState.rows.push(row);
          return [row];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          const p = params(cond);
          const matched = testState.rows.filter((r) =>
            p.includes(r.user_id) || p.includes(r.share_slug) || p.includes(r.id));
          const chain = {
            orderBy: async () => matched,
            then: (res: (v: PresetRow[]) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(matched).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    delete: () => ({
      where: (cond: unknown) => ({
        returning: async () => {
          const p = params(cond);
          const idx = testState.rows.findIndex((r) => p.includes(r.id) && p.includes(r.user_id));
          if (idx < 0) return [];
          const [gone] = testState.rows.splice(idx, 1);
          return [{ id: gone!.id }];
        },
      }),
    }),
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = testState.userId;
    next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, db: fakeDb() };
});
vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (name: string) => `r2://generated-clips/${name}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.example/${ref}`,
}));

import photoEditorRouter from "../generate/photo-editor";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { log: unknown }).log = { info() {}, error() {}, warn() {} }; next(); });
  app.use(photoEditorRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { testState.rows = []; testState.userId = "user-1"; });

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, never> };
}

describe("photo presets", () => {
  it("saves a preset with the recipe clamped; private presets get no slug", async () => {
    const r = await call("POST", "/photo-presets", {
      name: "Warm Gold", recipe: { develop: { exposure: 99, contrast: 20 } },
    });
    expect(r.status).toBe(201);
    const preset = (r.json as { preset: { recipe: { develop: { exposure: number; contrast: number } }; shareSlug: string | null } }).preset;
    expect(preset.recipe.develop.exposure).toBe(2); // clamped server-side
    expect(preset.recipe.develop.contrast).toBe(20);
    expect(preset.shareSlug).toBeNull();
  });

  it("public presets get a share slug and are readable without ownership; private ones 404 publicly", async () => {
    const pub = await call("POST", "/photo-presets", { name: "Stage Glow", isPublic: true, recipe: { develop: { saturation: 10 } } });
    const slug = (pub.json as { preset: { shareSlug: string } }).preset.shareSlug;
    expect(slug).toContain("stage-glow-");
    const read = await call("GET", `/photo-presets/public/${slug}`);
    expect(read.status).toBe(200);
    const missing = await call("GET", "/photo-presets/public/nope-1234");
    expect(missing.status).toBe(404);
  });

  it("lists only my presets and delete enforces ownership", async () => {
    await call("POST", "/photo-presets", { name: "Mine", recipe: { develop: {} } });
    testState.userId = "user-2";
    await call("POST", "/photo-presets", { name: "Theirs", recipe: { develop: {} } });
    const mine = await call("GET", "/photo-presets");
    expect((mine.json as { presets: unknown[] }).presets).toHaveLength(1);
    const otherId = testState.rows.find((r) => r.user_id === "user-1")!.id;
    const del = await call("DELETE", `/photo-presets/${otherId}`);
    expect(del.status).toBe(404); // not theirs
    expect(testState.rows).toHaveLength(2);
  });
});

describe("photo editor render/batch routes", () => {
  it("batch look-sync reports EVERY photo's outcome — failures are rows, not a silent half-apply", async () => {
    const r = await call("POST", "/photo-editor/batch-look-sync", {
      imageUrls: ["notaurl", "https://127.0.0.1:1/missing.jpg"],
      recipe: { develop: { contrast: 15 } },
    });
    expect(r.status).toBe(200);
    const out = r.json as unknown as { succeeded: number; failed: number; results: { ok: boolean; error: string | null }[] };
    expect(out.succeeded).toBe(0);
    expect(out.failed).toBe(2);
    expect(out.results).toHaveLength(2);
    expect(out.results.every((x) => !x.ok && typeof x.error === "string" && x.error.length > 0)).toBe(true);
  });

  it("render-multi validates outputs honestly", async () => {
    const bad = await call("POST", "/photo-editor/render-multi", { imageUrl: "https://x/a.jpg", outputs: [{ format: "gif", width: 10, height: 10 }] });
    expect(bad.status).toBe(400);
    const empty = await call("POST", "/photo-editor/render-multi", {});
    expect(empty.status).toBe(400);
  });
});
