/**
 * Tests for the Featured Songs playlist routes (homepage).
 *
 * Properties under test:
 * - GET /api/featured-songs is public and returns tracks ordered by position.
 * - GET serves the built-in theme-song default when the table is empty
 *   (and when the DB call fails, e.g. migration not run yet).
 * - POST /api/featured-songs requires auth + admin email; rejects non-admins
 *   with 403, requires a file, and appends at max(position)+1.
 * - PATCH /api/featured-songs/reorder reassigns positions in order.
 * - DELETE /api/featured-songs/:id removes the track.
 *
 * Heavy modules (DB, auth, storage, logger) are mocked; the real Express
 * router runs against a local ephemeral server.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  tracks: [] as Array<{
    id: string; title: string; artist: string; audio_url: string;
    audio_path: string | null; duration_label: string | null; position: number;
  }>,
  failList: false,
  authedUserId: "user-1" as string | null,
  authedEmail: "blockdollazboss@gmail.com" as string | null,
  uploaded: [] as Array<{ name: string; size: number }>,
}));

const ADMIN_EMAILS = "blockdollazboss@gmail.com";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!dbState.authedUserId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = dbState.authedUserId;
    req.userEmail = dbState.authedEmail;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (name: string, buffer: Buffer) => {
    dbState.uploaded.push({ name, size: buffer.length });
    return `bucketed:media/${name}`;
  }),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://cdn.example/${ref}`),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/* Minimal drizzle-shaped mock: the route only uses select/from/orderBy,
   insert/values/returning, update/set/where, delete/where. */
vi.mock("@workspace/db", () => {
  const chainable = (run: () => any) => {
    const c: any = {};
    const methods = ["from", "orderBy", "values", "returning", "set", "where", "select"];
    for (const m of methods) c[m] = () => c;
    c.then = (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject);
    return c;
  };
  const selectImpl = (..._cols: any[]) => {
    if (dbState.failList) throw new Error("relation does not exist");
    return chainable(() => dbState.tracks
      .slice()
      .sort((a, b) => a.position - b.position));
  };
  return {
    featuredSongsTable: {
      id: "id", title: "title", artist: "artist", audio_url: "audio_url",
      audio_path: "audio_path", duration_label: "duration_label",
      position: "position", created_by: "created_by", created_at: "created_at",
    },
    db: {
      select: (...cols: any[]) => {
        // max(position) probe vs full select
        const first = cols[0];
        const isMaxProbe =
          cols.length === 1 &&
          first && typeof first === "object" &&
          (first.__maxPos === true || first.maxPos?.__maxPos === true);
        if (isMaxProbe) {
          return chainable(() => [{
            maxPos: dbState.tracks.reduce((m, t) => Math.max(m, t.position), -1),
          }]);
        }
        return selectImpl(...cols);
      },
      insert: () => ({
        values: (vals: any) => chainable(() => {
          const row = { id: `id-${dbState.tracks.length + 1}`, ...vals };
          dbState.tracks.push(row);
          return [row];
        }),
      }),
      update: () => ({
        set: (vals: any) => ({
          where: (cond: any) => chainable(() => {
            const t = dbState.tracks.find((x) => x.id === cond.id);
            if (t) Object.assign(t, vals);
            return [];
          }),
        }),
      }),
      delete: () => ({
        where: (cond: any) => chainable(() => {
          dbState.tracks = dbState.tracks.filter((x) => x.id !== cond.id);
          return [];
        }),
      }),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ col, id: val }),
  asc: (col: any) => ({ col, dir: "asc" }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._vals: any[]) => ({ __maxPos: true }),
    { raw: (s: string) => s },
  ),
}));

let app: express.Express;
let server: ReturnType<express.Express["listen"]>;
let base: string;

beforeAll(async () => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAILS;
  const mod = await import("../featured-songs");
  app = express();
  app.use(express.json());
  app.use("/api", mod.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  dbState.tracks = [];
  dbState.failList = false;
  dbState.authedUserId = "user-1";
  dbState.authedEmail = "blockdollazboss@gmail.com";
  dbState.uploaded = [];
});

function authHeaders(): Record<string, string> {
  return { Authorization: "Bearer test-token" };
}

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

function seedTracks() {
  dbState.tracks = [
    { id: T1, title: "First", artist: "A", audio_url: "https://x/1.mp3", audio_path: null, duration_label: "3:00", position: 0 },
    { id: T2, title: "Second", artist: "B", audio_url: "https://x/2.mp3", audio_path: null, duration_label: "2:30", position: 1 },
  ];
}

describe("GET /api/featured-songs", () => {
  it("is public and returns tracks ordered by position", async () => {
    dbState.tracks = [
      { id: "t2", title: "Second", artist: "B", audio_url: "https://x/2.mp3", audio_path: null, duration_label: "2:30", position: 1 },
      { id: "t1", title: "First", artist: "A", audio_url: "https://x/1.mp3", audio_path: null, duration_label: "3:00", position: 0 },
    ];
    const res = await fetch(`${base}/api/featured-songs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.default).toBe(false);
    expect(body.tracks.map((t: any) => t.title)).toEqual(["First", "Second"]);
  });

  it("serves the built-in theme song default when the table is empty", async () => {
    const res = await fetch(`${base}/api/featured-songs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.default).toBe(true);
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].title).toContain("Theme Song");
    expect(body.tracks[0].audio_url).toContain("bow-down-visuals-theme.mp3");
  });

  it("serves the default instead of 500 when the DB call fails", async () => {
    dbState.failList = true;
    const res = await fetch(`${base}/api/featured-songs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.default).toBe(true);
    expect(body.tracks[0].audio_url).toContain("bow-down-visuals-theme.mp3");
  });
});

describe("POST /api/featured-songs", () => {
  const mp3 = Buffer.from("fake-mp3-bytes");

  function uploadForm(fields: Record<string, string> = { title: "New Track" }) {
    const form = new FormData();
    form.append("track", new Blob([mp3], { type: "audio/mpeg" }), "song.mp3");
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return form;
  }

  it("rejects unauthenticated uploads with 401", async () => {
    dbState.authedUserId = null;
    const res = await fetch(`${base}/api/featured-songs`, {
      method: "POST",
      headers: authHeaders(),
      body: uploadForm(),
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users with 403", async () => {
    dbState.authedEmail = "someone@else.com";
    const res = await fetch(`${base}/api/featured-songs`, {
      method: "POST",
      headers: authHeaders(),
      body: uploadForm(),
    });
    expect(res.status).toBe(403);
  });

  it("requires an audio file", async () => {
    const form = new FormData();
    form.append("title", "No File");
    const res = await fetch(`${base}/api/featured-songs`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("requires a title", async () => {
    const res = await fetch(`${base}/api/featured-songs`, {
      method: "POST",
      headers: authHeaders(),
      body: uploadForm({ title: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("uploads and appends at max(position)+1", async () => {
    seedTracks();
    const res = await fetch(`${base}/api/featured-songs`, {
      method: "POST",
      headers: authHeaders(),
      body: uploadForm({ title: "Third", artist: "C", duration_label: "4:00" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.track.title).toBe("Third");
    expect(body.track.artist).toBe("C");
    expect(body.track.audio_url).toContain("https://cdn.example/");
    expect(body.track.position).toBe(2);
    expect(dbState.uploaded).toHaveLength(1);
  });
});

describe("PATCH /api/featured-songs/reorder", () => {
  it("rejects non-admin users with 403", async () => {
    dbState.authedEmail = "someone@else.com";
    const res = await fetch(`${base}/api/featured-songs/reorder`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [T1] }),
    });
    expect(res.status).toBe(403);
  });

  it("reassigns positions in the given order", async () => {
    seedTracks();
    const res = await fetch(`${base}/api/featured-songs/reorder`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [T2, T1] }),
    });
    expect(res.status).toBe(200);
    const t1 = dbState.tracks.find((t) => t.id === T1)!;
    const t2 = dbState.tracks.find((t) => t.id === T2)!;
    expect(t2.position).toBe(0);
    expect(t1.position).toBe(1);
  });

  it("rejects an empty ids array", async () => {
    const res = await fetch(`${base}/api/featured-songs/reorder`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/featured-songs/:id", () => {
  it("rejects non-admin users with 403", async () => {
    dbState.authedEmail = "someone@else.com";
    const res = await fetch(`${base}/api/featured-songs/${T1}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(403);
  });

  it("removes the track", async () => {
    seedTracks();
    const res = await fetch(`${base}/api/featured-songs/${T1}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(dbState.tracks.map((t) => t.id)).toEqual([T2]);
  });
});
