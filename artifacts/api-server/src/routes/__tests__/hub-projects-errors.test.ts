/**
 * S27-49 — hub project GETs return controlled errors.
 *
 * GET /hub/project and GET /hub/projects had no try/catch: a DB
 * failure escaped as an unhandled 500 (framework default page / stack
 * leak shape). They now answer 500 with this file's sibling { error }
 * shape. The by-id read carries the same guard.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000001";
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      execute: async () => {
        throw new Error("hub_projects source down");
      },
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

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/api", hubProjectsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("hub project GETs — controlled errors (S27-49)", () => {
  it("GET /hub/project answers a controlled 500 when the DB read fails", async () => {
    const { status, json } = await get("/hub/project");
    expect(status).toBe(500);
    expect(json).toEqual({ error: "Couldn't load your hub project — try again." });
  });

  it("GET /hub/projects answers a controlled 500 when the DB read fails", async () => {
    const { status, json } = await get("/hub/projects");
    expect(status).toBe(500);
    expect(json).toEqual({ error: "Couldn't load your hub projects — try again." });
  });

  it("GET /hub/projects/:id answers a controlled 500 when the DB read fails", async () => {
    const { status, json } = await get("/hub/projects/11111111-1111-4111-8111-111111111111");
    expect(status).toBe(500);
    expect(json).toEqual({ error: "Couldn't load your hub project — try again." });
  });

  it("GET /hub/projects/:id still 404s a malformed id without touching the DB", async () => {
    const { status, json } = await get("/hub/projects/not-a-uuid");
    expect(status).toBe(404);
    expect(json).toEqual({ error: "Project not found" });
  });
});
