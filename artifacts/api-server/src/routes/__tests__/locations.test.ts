/**
 * Route tests for the user Locations library:
 *
 *   GET    /api/locations
 *   POST   /api/locations
 *   POST   /api/locations/upload
 *   DELETE /api/locations/:id
 *
 * Real database semantics via pg-mem (the @workspace/db module is real;
 * only its `db` handle is swapped for the in-memory instance), so auth
 * scoping, URL validation, and the non-destructive remove (row only —
 * the route has no storage dependency) are genuinely exercised.
 * The storage helpers are mocked for the upload endpoint.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
}));

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

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (_name: string) => "locations/ref.png"),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://cdn.example.com/${ref}`),
  parseSupabaseStorageRefBucketed: vi.fn(),
}));

import router from "../locations";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const LOCATIONS_DDL = `
CREATE TABLE locations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  label text NOT NULL,
  image_url text NOT NULL,
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const USER_A = randomUUID();
const USER_B = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(LOCATIONS_DDL);
  testState.db = db;
  testState.userId = USER_A;
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function seedLocation(userId: string, label = "Golden Throne Room") {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO locations (id, user_id, label, image_url)
    VALUES (${id}, ${userId}, ${label}, 'https://example.com/throne.png')
  `);
  return { id };
}

async function countRows(id: string): Promise<number> {
  const r = await testState.db.execute(
    sql`SELECT COUNT(*)::int AS n FROM locations WHERE id = ${id}`,
  );
  return (r.rows[0] as { n: number }).n;
}

describe("GET /api/locations", () => {
  it("returns only the caller's locations", async () => {
    await seedLocation(USER_A, "Mine");
    await seedLocation(USER_B, "Theirs");

    const { status, json } = await req("GET", "/locations");
    expect(status).toBe(200);
    expect(json.locations).toHaveLength(1);
    expect(json.locations[0].label).toBe("Mine");
  });

  it("returns an empty list when the user has none", async () => {
    const { status, json } = await req("GET", "/locations");
    expect(status).toBe(200);
    expect(json.locations).toEqual([]);
  });
});

describe("POST /api/locations", () => {
  it("creates a location for the caller", async () => {
    const { status, json } = await req("POST", "/locations", {
      label: "Black-Ocean Stage",
      image_url: "https://example.com/stage.png",
    });
    expect(status).toBe(201);
    expect(json.location.label).toBe("Black-Ocean Stage");
    expect(json.location.user_id).toBe(USER_A);

    const { json: list } = await req("GET", "/locations");
    expect(list.locations).toHaveLength(1);
  });

  it("rejects a non-http(s) image_url", async () => {
    const { status } = await req("POST", "/locations", {
      label: "Sneaky",
      image_url: "ftp://example.com/x.png",
    });
    expect(status).toBe(400);
  });

  it("rejects javascript: URLs", async () => {
    const { status } = await req("POST", "/locations", {
      label: "XSS",
      image_url: "javascript:alert(1)",
    });
    expect(status).toBe(400);
  });

  it("rejects a missing label", async () => {
    const { status } = await req("POST", "/locations", {
      label: "   ",
      image_url: "https://example.com/x.png",
    });
    expect(status).toBe(400);
  });
});

describe("DELETE /api/locations/:id", () => {
  it("deletes the caller's own location (row only)", async () => {
    const row = await seedLocation(USER_A);
    const { status, json } = await req("DELETE", `/locations/${row.id}`);
    expect(status).toBe(200);
    expect(json.deleted).toBe(row.id);

    expect(await countRows(row.id)).toBe(0);
  });

  it("404s (not deletes) another user's location", async () => {
    const row = await seedLocation(USER_B);
    const { status } = await req("DELETE", `/locations/${row.id}`);
    expect(status).toBe(404);

    expect(await countRows(row.id)).toBe(1);
  });

  it("404s for an unknown id", async () => {
    const { status } = await req("DELETE", `/locations/${randomUUID()}`);
    expect(status).toBe(404);
  });
});

describe("POST /api/locations/upload", () => {
  it("uploads an image and creates the location row", async () => {
    const form = new FormData();
    form.append("label", "Uploaded Cave");
    form.append(
      "image",
      new Blob(["fake-png"], { type: "image/png" }),
      "cave.png",
    );
    const r = await realFetch(`${baseUrl}/locations/upload`, {
      method: "POST",
      body: form,
    });
    expect(r.status).toBe(201);
    const json = (await r.json()) as any;
    expect(json.location.label).toBe("Uploaded Cave");
    expect(json.location.image_url).toBe("https://cdn.example.com/locations/ref.png");
    expect(json.location.image_path).toBe("locations/ref.png");
    expect(json.location.user_id).toBe(USER_A);
  });

  it("400s with no file", async () => {
    const form = new FormData();
    form.append("label", "No file");
    const r = await realFetch(`${baseUrl}/locations/upload`, {
      method: "POST",
      body: form,
    });
    expect(r.status).toBe(400);
  });
});
