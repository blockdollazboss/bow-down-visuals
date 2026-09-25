/**
 * Route tests for the widget playlist:
 *
 *   GET    /api/playlist
 *   POST   /api/playlist/upload
 *   DELETE /api/playlist/:name
 *
 * Storage is fully mocked (no Supabase, no network): the bucket self-heal
 * REST call is intercepted at global fetch, and the storage client is a
 * vi mock. requireAuth is mocked like the other route tests; requireAdmin
 * is replaced with a controllable stand-in so both branches are exercised.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  userId: "user-123",
  userEmail: "owner@example.com",
  isAdmin: true,
  files: [] as string[],
  uploaded: [] as { name: string; bytes: number }[],
  removed: [] as string[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userEmail = testState.userEmail;
    next();
  },
}));

vi.mock("../admin", () => ({
  requireAdmin: (req: any, res: any, next: any) => {
    if (!testState.isAdmin) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    next();
  },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: (_bucket: string) => ({
        list: vi.fn(async () => ({
          data: testState.files.map((name) => ({ name })),
          error: null,
        })),
        upload: vi.fn(async (name: string, body: Buffer) => {
          testState.uploaded.push({ name, bytes: body.length });
          return { data: { path: name }, error: null };
        }),
        remove: vi.fn(async (names: string[]) => {
          testState.removed.push(...names);
          return { data: null, error: null };
        }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.example.com/playlist/${path}` },
        }),
      }),
    },
  }),
}));

import router from "../playlist";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["SUPABASE_URL"] = "https://example.supabase.co";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role-key";
  // Bucket self-heal: pretend the bucket already exists; everything else
  // goes to the real fetch (the express test server).
  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).includes("/storage/v1/bucket")) {
      return new Response(JSON.stringify({ id: "playlist" }), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  testState.isAdmin = true;
  testState.files = [];
  testState.uploaded = [];
  testState.removed = [];
});

async function uploadTrack(filename: string, type: string, bytes: number) {
  const form = new FormData();
  form.append("track", new Blob([new Uint8Array(bytes)], { type }), filename);
  const r = await realFetch(`${baseUrl}/playlist/upload`, {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
    body: form,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/playlist", () => {
  it("returns tracks sorted by name with public urls", async () => {
    testState.files = ["zebra.mp3", "alpha.mp3", "mike.wav"];
    const r = await realFetch(`${baseUrl}/playlist`);
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.tracks.map((t: any) => t.name)).toEqual([
      "alpha.mp3",
      "mike.wav",
      "zebra.mp3",
    ]);
    expect(json.tracks[0].url).toBe("https://cdn.example.com/playlist/alpha.mp3");
  });

  it("returns an empty list when the bucket is empty", async () => {
    const r = await realFetch(`${baseUrl}/playlist`);
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.tracks).toEqual([]);
  });

  it("is public — no auth required", async () => {
    const r = await realFetch(`${baseUrl}/playlist`, { headers: {} });
    expect(r.status).toBe(200);
  });
});

describe("POST /api/playlist/upload", () => {
  it("rejects non-admins with 403", async () => {
    testState.isAdmin = false;
    const { status } = await uploadTrack("song.mp3", "audio/mpeg", 1000);
    expect(status).toBe(403);
    expect(testState.uploaded).toHaveLength(0);
  });

  it("rejects non-audio files with 400", async () => {
    const { status, json } = await uploadTrack("photo.png", "image/png", 1000);
    expect(status).toBe(400);
    expect(json.code).toBe("no_file");
    expect(testState.uploaded).toHaveLength(0);
  });

  it("rejects files over 25MB with 413", async () => {
    const { status, json } = await uploadTrack(
      "huge.mp3",
      "audio/mpeg",
      26 * 1024 * 1024,
    );
    expect(status).toBe(413);
    expect(json.code).toBe("too_large");
    expect(testState.uploaded).toHaveLength(0);
  });

  it("uploads a valid track for the admin", async () => {
    const { status, json } = await uploadTrack("my song.mp3", "audio/mpeg", 5000);
    expect(status).toBe(201);
    expect(json.track.name).toBe("my song.mp3");
    expect(json.track.url).toBe("https://cdn.example.com/playlist/my song.mp3");
    expect(testState.uploaded).toHaveLength(1);
    expect(testState.uploaded[0]!.bytes).toBe(5000);
  });

  it("neutralizes path-traversal filenames instead of rejecting", async () => {
    const { status, json } = await uploadTrack("../../evil.mp3", "audio/mpeg", 100);
    expect(status).toBe(201);
    expect(json.track.name).toBe("evil.mp3");
    expect(testState.uploaded[0]!.name).toBe("evil.mp3");
  });
});

describe("DELETE /api/playlist/:name", () => {
  it("rejects non-admins with 403", async () => {
    testState.isAdmin = false;
    const r = await realFetch(`${baseUrl}/playlist/song.mp3`, {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });
    expect(r.status).toBe(403);
    expect(testState.removed).toHaveLength(0);
  });

  it("deletes a track for the admin", async () => {
    const r = await realFetch(`${baseUrl}/playlist/song.mp3`, {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });
    const json = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(testState.removed).toEqual(["song.mp3"]);
  });

  it("rejects path-traversal names with 400", async () => {
    const r = await realFetch(`${baseUrl}/playlist/${encodeURIComponent("../../etc/passwd")}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });
    expect(r.status).toBe(400);
    expect(testState.removed).toHaveLength(0);
  });
});

describe("sanitizeTrackName", () => {
  it("accepts normal audio filenames", async () => {
    const { sanitizeTrackName } = await import("../playlist");
    expect(sanitizeTrackName("My Song (final).mp3")).toBe("My Song (final).mp3");
  });

  it("neutralizes traversal, rejects bad chars and non-audio extensions", async () => {
    const { sanitizeTrackName } = await import("../playlist");
    expect(sanitizeTrackName("../evil.mp3")).toBe("evil.mp3");
    expect(sanitizeTrackName("song.exe")).toBe("");
    expect(sanitizeTrackName("")).toBe("");
  });
});
