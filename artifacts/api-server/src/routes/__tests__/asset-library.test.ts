/**
 * Tests for GET /api/asset-library (Stack 4 #5 — unified asset library).
 *
 * Driven the way real callers drive it: an authenticated GET against the
 * real Express router on an ephemeral server, with the DB and auth mocked.
 * The library merges the caller's hub-project assets with their generation
 * history; the project copy wins on duplicate URLs.
 */
import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  hubRows: [] as any[],
  genRows: [] as any[],
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
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) =>
    ref.startsWith("ref:") ? `https://signed.example/${ref.slice(4)}` : ref,
  ),
}));

vi.mock("@workspace/db", () => {
  const hubTable = { __table: "hub_projects", user_id: "user_id" };
  const genTable = { __table: "generation_history", userId: "userId", createdAt: "createdAt" };
  const chain: any = {};
  chain.from = vi.fn((table: any) => { chain.__table = table?.__table; return chain; });
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() =>
    Promise.resolve(chain.__table === "hub_projects" ? dbState.hubRows : dbState.genRows),
  );
  return {
    db: { select: vi.fn(() => chain) },
    hubProjectsTable: hubTable,
    generationHistoryTable: genTable,
  };
});

import assetLibraryRouter from "../asset-library";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api", assetLibraryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  dbState.authedUserId = "user-1";
  dbState.hubRows = [];
  dbState.genRows = [];
});

describe("GET /api/asset-library", () => {
  it("merges project + generation assets into camelCase DTOs, project copy wins on duplicate URLs", async () => {
    dbState.hubRows = [{
      user_id: "user-1",
      assets: [
        { id: "a1", kind: "song", url: "https://cdn.example/song.mp3", label: "Midnight Run", detail: "Make a Song", createdAt: 1_700_000_000_000 },
        { id: "a2", kind: "stems", url: "ref:stems.wav", label: "Stems", createdAt: 1_700_000_100_000 },
      ],
    }];
    dbState.genRows = [
      { id: "g1", generationType: "video", result: { videoUrl: "https://cdn.example/clip.mp4", songTitle: "Clip One" }, createdAt: new Date(1_700_000_200_000) },
      { id: "g2", generationType: "song", result: { videoUrl: "https://cdn.example/song.mp3" }, createdAt: new Date(1_700_000_300_000) },
      { id: "g3", generationType: "lyrics", result: { content: "text only" }, createdAt: new Date(1_700_000_400_000) },
    ];
    const res = await fetch(`${base}/api/asset-library`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { assets: any[] };
    // g2 deduped against the project song (same URL); g3 has no media URL.
    expect(data.assets.map((a) => a.id)).toEqual(["gen:g1", "hub:a2", "hub:a1"]);
    const song = data.assets.find((a) => a.id === "hub:a1")!;
    expect(song).toMatchObject({
      mediaKind: "audio", hubKind: "song", label: "Midnight Run",
      origin: "project", detail: "Make a Song",
    });
    expect(typeof song.createdAt).toBe("string");
    const stems = data.assets.find((a) => a.id === "hub:a2")!;
    expect(stems.mediaKind).toBe("stems");
    expect(stems.url).toBe("https://signed.example/stems.wav");
    const clip = data.assets.find((a) => a.id === "gen:g1")!;
    expect(clip).toMatchObject({ mediaKind: "video", origin: "generation", label: "Clip One", hubKind: null });
  });

  it("returns an honest empty library, not an error, when the caller has nothing", async () => {
    const res = await fetch(`${base}/api/asset-library`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assets: [] });
  });

  it("requires auth", async () => {
    dbState.authedUserId = null;
    const res = await fetch(`${base}/api/asset-library`);
    expect(res.status).toBe(401);
  });
});
