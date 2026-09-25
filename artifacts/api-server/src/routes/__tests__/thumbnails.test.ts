/**
 * Tests for GET /api/thumbnails and DELETE /api/thumbnails/:id.
 *
 * The thumbnail library reads from generation_history (generationType =
 * "thumbnail") — the same rows the Thumbnail Maker writes. Ownership is
 * enforced at the query level: users can never see or delete another
 * user's thumbnails. DELETE is non-destructive (row only, storage untouched).
 *
 * Heavy modules (DB, Supabase, auth) are mocked; the real Express router
 * runs against a local ephemeral server.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  rows: [] as any[],
  deletedIds: [] as string[],
  authedUserId: "user-1",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!dbState.authedUserId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = dbState.authedUserId;
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://signed.example/${ref}`),
  uploadMediaToSupabaseStorage: vi.fn(),
  normalizeToStorageRef: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const selectChain: any = {};
  selectChain.from = vi.fn(() => selectChain);
  selectChain.where = vi.fn(() => selectChain);
  selectChain.orderBy = vi.fn(() => Promise.resolve(dbState.rows));
  // DELETE existence check: .select().from().where().limit() — the mocked
  // where-clause always includes the authed user's id, so filter here.
  selectChain.limit = vi.fn(() =>
    Promise.resolve(dbState.rows.filter((r: any) => r.userId === dbState.authedUserId)),
  );
  const deleteChain: any = {};
  // db.delete(table).where(...) is terminal — resolves when awaited.
  deleteChain.where = vi.fn(() => {
    dbState.deletedIds = dbState.rows
      .filter((r: any) => r.userId === dbState.authedUserId)
      .map((r: any) => r.id);
    return Promise.resolve([]);
  });
  return {
    db: {
      select: vi.fn(() => selectChain),
      delete: vi.fn(() => deleteChain),
    },
    generationHistoryTable: {
      id: "id",
      userId: "user_id",
      generationType: "generation_type",
      createdAt: "created_at",
    },
  };
});

import router from "../thumbnails";
import { refreshSupabaseStorageUrl } from "../../lib/objectStorage";

let server: any;
let baseUrl: string;

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

function thumbRow(overrides: Record<string, any> = {}) {
  return {
    id: "thumb-1",
    userId: "user-1",
    generationType: "thumbnail",
    result: {
      thumbnailUrl: "media/thumbnails/abc.png",
      artistName: "Nova",
      songTitle: "Gold",
      actionLabel: "Thumbnail — Gold",
    },
    creditsUsed: 3,
    createdAt: new Date("2026-09-20T12:00:00Z").toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.authedUserId = "user-1";
  dbState.rows = [thumbRow()];
  dbState.deletedIds = [];
});

describe("GET /api/thumbnails", () => {
  it("returns the user's thumbnails with freshly signed URLs", async () => {
    const res = await fetch(`${baseUrl}/thumbnails`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.thumbnails).toHaveLength(1);
    const t = body.thumbnails[0];
    expect(t.id).toBe("thumb-1");
    expect(t.artist_name).toBe("Nova");
    expect(t.song_title).toBe("Gold");
    // Storage ref is re-signed on read, never returned raw.
    expect(refreshSupabaseStorageUrl).toHaveBeenCalledWith("media/thumbnails/abc.png");
    expect(t.thumbnail_url).toBe("https://signed.example/media/thumbnails/abc.png");
  });

  it("returns an empty library when the user has no thumbnails", async () => {
    dbState.rows = [];
    const res = await fetch(`${baseUrl}/thumbnails`);
    expect(res.status).toBe(200);
    expect((await res.json()).thumbnails).toEqual([]);
  });

  it("requires authentication", async () => {
    dbState.authedUserId = "";
    const res = await fetch(`${baseUrl}/thumbnails`);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/thumbnails/:id", () => {
  it("deletes the user's own thumbnail", async () => {
    const res = await fetch(`${baseUrl}/thumbnails/thumb-1`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(dbState.deletedIds).toContain("thumb-1");
  });

  it("returns 404 for another user's thumbnail (ownership enforced)", async () => {
    dbState.rows = [thumbRow({ id: "thumb-2", userId: "user-2" })];
    const res = await fetch(`${baseUrl}/thumbnails/thumb-2`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(dbState.deletedIds).not.toContain("thumb-2");
  });

  it("returns 404 for a nonexistent thumbnail", async () => {
    dbState.rows = [];
    const res = await fetch(`${baseUrl}/thumbnails/nope`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    dbState.authedUserId = "";
    const res = await fetch(`${baseUrl}/thumbnails/thumb-1`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});
