/**
 * Linkage Fix 2 — generated songs enter the song library.
 *
 * Before the fix, POST /generate-music-audio saved the audio, wrote a
 * history row and charged — but never inserted into `songs`, so a
 * generated song lived only in the 100-item hub tray: invisible to
 * the song library, the distribution picker (pages/distribute.tsx
 * reads GET /api/songs), remix-by-id, and albums.
 *
 * These tests drive the REAL generation route + the REAL GET
 * /api/songs route (provider + storage mocked at the module boundary)
 * over the house fake-db harness — the style used for every
 * builder-based router (pg-mem is reserved for raw-SQL surfaces).
 * The fake implements the exact query shapes the two routes make:
 * the vault voice/ownership lookups, the library existence check,
 * the songs insert, and the owner-scoped library list.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const OWNED_VAULT = "55555555-5555-4555-8555-555555555555";
const FOREIGN_VAULT = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  state: {
    userId: "",
    userCredits: 0,
    songs: [] as Array<Record<string, unknown>>,
    vaults: [] as Array<Record<string, unknown>>,
    charges: [] as Array<{ userId: string; cost: number }>,
    refunds: [] as Array<{ userId: string; amount: number }>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.state.userId;
    req.userCredits = h.state.userCredits;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (userId: string, cost: number) => {
    h.state.charges.push({ userId, cost });
    return 100_000 - cost;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number) => {
    h.state.refunds.push({ userId, amount });
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/payment-record", () => ({
  recordGenerationHistory: vi.fn(async () => randomUUID()),
  markGenerationHistoryCharged: vi.fn(async () => {}),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async () => {}),
  r2PublicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));

vi.mock("../../lib/voice-swap", () => ({
  swapSongVocalsToVoice: vi.fn(async (buf: Buffer) => buf),
}));

/* Storage refresh simulator: our bucket-prefixed refs mint a signed
   URL; everything else passes through (the real refresher's contract
   for values it doesn't own). */
vi.mock("../../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    refreshSupabaseStorageUrl: async (v: unknown) =>
      typeof v === "string" && v.startsWith("audio-stems/")
        ? `https://signed.example.com/${v}?sig=test`
        : v,
    uploadMediaToSupabaseStorage: vi.fn(async () => {
      throw new Error("not used by these tests");
    }),
    parseSupabaseStorageRefBucketed: () => null,
    downloadStorageObjectBuffer: async () => null,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { songsTable, artistVaultsTable } = actual;

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    const params = cond !== undefined ? render(cond).params : [];
    if (table === artistVaultsTable) {
      /* Both lookups scope by (vault id, owner user id). */
      return state.vaults.filter(
        (v) => v["id"] === params[0] && v["user_id"] === params[1],
      );
    }
    if (table === songsTable) {
      const fieldKeys =
        fields && typeof fields === "object"
          ? Object.keys(fields as Record<string, unknown>)
          : [];
      if (fieldKeys.length === 1 && fieldKeys[0] === "id") {
        /* The library-save existence check: (user_id, audio_path). */
        return state.songs.filter(
          (s) => s["user_id"] === params[0] && s["audio_path"] === params[1],
        );
      }
      /* GET /api/songs: the caller's library, newest first. */
      return state.songs
        .filter((s) => s["user_id"] === params[0])
        .sort(
          (a, b) =>
            new Date(String(b["created_at"])).getTime() -
            new Date(String(a["created_at"])).getTime(),
        );
    }
    return [];
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => rowsFor(table, fields, cond);
          return {
            limit: async (n: number) => rows().slice(0, n),
            orderBy: (..._args: unknown[]) => ({
              limit: async (n: number) => rows().slice(0, n),
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (obj: Record<string, unknown>) => ({
        returning: async () => {
          if (table !== songsTable) throw new Error("unexpected insert table");
          const row: Record<string, unknown> = {
            id: randomUUID(),
            parent_song_id: null,
            mashup_sources: null,
            mashup_style: null,
            created_at: new Date(),
            ...obj,
          };
          state.songs.push(row);
          return [row];
        },
      }),
    }),
    /* The release flow's attach-by-id ownership query (distribution.ts
       runs `SELECT id, audio_url FROM songs WHERE id = ? AND
       user_id = ?` before pre-filling a release from a library song). */
    execute: async (cond: unknown) => {
      const { sql: text, params } = render(cond);
      if (/from\s+songs/i.test(text)) {
        const rows = state.songs
          .filter((s) => s["id"] === params[0] && s["user_id"] === params[1])
          .map((s) => ({ id: s["id"], audio_url: s["audio_url"] }));
        return { rows };
      }
      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

import musicAudioRouter from "../generate/music-audio";
import songsRouter from "../songs";
import { sql } from "drizzle-orm";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["ELEVENLABS_API_KEY"] = "test-key";
  /* The provider call is the only global fetch the route makes. */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("api.elevenlabs.io")) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
          text: async () => "",
        };
      }
      throw new Error(`unexpected fetch in test: ${String(url)}`);
    }),
  );

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api", musicAudioRouter);
  app.use("/api", songsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env["ELEVENLABS_API_KEY"];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.userId = OWNER;
  h.state.userCredits = 100_000;
  h.state.songs = [];
  h.state.charges = [];
  h.state.refunds = [];
  h.state.vaults = [
    { id: OWNED_VAULT, user_id: OWNER, voice_id: "voice-owned" },
    { id: FOREIGN_VAULT, user_id: OTHER_USER, voice_id: "voice-foreign" },
  ];
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

describe("POST /api/generate-music-audio — the library save", () => {
  it("creates exactly one library song per generation, carrying title / audio / duration / source", async () => {
    const { status, json } = await req("POST", "/generate-music-audio", {
      prompt: "warm soul groove",
      songTitle: "Golden Hour",
      lengthSeconds: 60,
    });
    expect(status).toBe(200);
    expect(json.songId).toBeTruthy();
    expect(json.songIds).toEqual([json.songId]);
    expect(json.variants[0].songId).toBe(json.songId);
    expect(h.state.refunds).toEqual([]);

    expect(h.state.songs).toHaveLength(1);
    const [row] = h.state.songs;
    expect(row!["id"]).toBe(json.songId);
    expect(row!["user_id"]).toBe(OWNER);
    expect(row!["title"]).toBe("Golden Hour");
    expect(row!["source"]).toBe("generated");
    expect(String(row!["audio_path"])).toMatch(
      new RegExp(`^audio-stems/${OWNER}/generated/\\d+-music-v1\\.mp3$`),
    );
    expect(row!["audio_url"]).toBe(`https://cdn.example.com/${String(row!["audio_path"])}`);
    expect(row!["duration_sec"]).toBe("60");
    expect(row!["artist_vault_id"]).toBeNull();
  });

  it("the generated song is returned by GET /api/songs — the distribute picker's query", async () => {
    const gen = await req("POST", "/generate-music-audio", {
      prompt: "warm soul groove",
      songTitle: "Picker Song",
      lengthSeconds: 30,
    });
    expect(gen.status).toBe(200);

    const list = await req("GET", "/songs");
    expect(list.status).toBe(200);
    const mine = (list.json.songs as any[]).filter((s) => s.id === gen.json.songId);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Picker Song");
    expect(mine[0].source).toBe("generated");
    /* The library hands back a playable (refreshed) URL, not the ref. */
    expect(mine[0].audio_url).toContain("https://signed.example.com/audio-stems/");

    /* The release flow's attach-by-id ownership query, verbatim. */
    const { db } = await import("@workspace/db");
    const owned = await (db as any).execute(
      sql`SELECT id, audio_url FROM songs WHERE id = ${gen.json.songId} AND user_id = ${OWNER}`,
    );
    expect(owned.rows).toHaveLength(1);
    const foreign = await (db as any).execute(
      sql`SELECT id, audio_url FROM songs WHERE id = ${gen.json.songId} AND user_id = ${OTHER_USER}`,
    );
    expect(foreign.rows).toHaveLength(0);
  });

  it("dual-variant generation saves one row per variant, ids in variant order", async () => {
    const { status, json } = await req("POST", "/generate-music-audio", {
      prompt: "two takes",
      songTitle: "Twin Takes",
      lengthSeconds: 30,
      variants: 2,
    });
    expect(status).toBe(200);
    expect(json.songIds).toHaveLength(2);
    expect(json.songIds[0]).not.toBe(json.songIds[1]);
    expect(json.variants.map((v: any) => v.songId)).toEqual(json.songIds);
    expect(json.variants.map((v: any) => v.label)).toEqual(["A", "B"]);

    expect(h.state.songs).toHaveLength(2);
    expect(h.state.songs.map((r) => r["id"]).sort()).toEqual([...json.songIds].sort());
    expect(
      h.state.songs.every((r) => r["source"] === "generated" && r["title"] === "Twin Takes"),
    ).toBe(true);
  });

  it("carries the generating character's vault id only when the vault is the caller's own", async () => {
    const own = await req("POST", "/generate-music-audio", {
      prompt: "as my character",
      songTitle: "In Character",
      lengthSeconds: 30,
      artistVaultId: OWNED_VAULT,
    });
    expect(own.status).toBe(200);
    const ownRow = h.state.songs.find((r) => r["id"] === own.json.songId);
    expect(ownRow!["artist_vault_id"]).toBe(OWNED_VAULT);

    const foreign = await req("POST", "/generate-music-audio", {
      prompt: "as someone else's character",
      songTitle: "Not Mine",
      lengthSeconds: 30,
      artistVaultId: FOREIGN_VAULT,
    });
    expect(foreign.status).toBe(200);
    const foreignRow = h.state.songs.find((r) => r["id"] === foreign.json.songId);
    /* A vault the caller doesn't own never lands on their song row. */
    expect(foreignRow!["artist_vault_id"]).toBeNull();
  });

  it("a retried completion does not duplicate the row (idempotent per generation job)", async () => {
    /* A retry re-presents the same generation outputs: same upload
       paths (Date.now frozen), same body. The library must converge
       on the one row the first completion wrote. */
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const body = { prompt: "retry me", songTitle: "Once Only", lengthSeconds: 30 };
      const first = await req("POST", "/generate-music-audio", body);
      const second = await req("POST", "/generate-music-audio", body);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.json.songId).toBe(first.json.songId);

      expect(h.state.songs).toHaveLength(1);
      expect(h.state.songs[0]!["id"]).toBe(first.json.songId);

      const list = await req("GET", "/songs");
      expect((list.json.songs as any[]).filter((s) => s.title === "Once Only")).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
