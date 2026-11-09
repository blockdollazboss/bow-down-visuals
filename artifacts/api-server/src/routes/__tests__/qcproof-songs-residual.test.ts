/**
 * qcproof-songs-residual.test.ts — QC-200 Q158 residual pins.
 *
 * gateproof-songs (stack1200/gateproof-songs @ 92951a56d, on the
 * applyfix lineage) already proved the tier boundaries charge
 * exactly 400/800/1,200/2,400, a member past 10 minutes is refused
 * with the balance byte-identical and the provider never called, an
 * admin at 601 s pays exactly 2,400, and ADMIN_EMAILS-unset fails
 * closed. music-audio-library-linkage.test.ts proved the EXTEND
 * path's library-save failure refunds in full. The residual legs no
 * suite pinned, driven here over that suite's harness (real routes,
 * provider stubbed at global fetch, fake db):
 *
 *   - insufficient balance → 402 BEFORE any charge and BEFORE any
 *     provider call, on BOTH the generate and extend paths;
 *   - a library-save failure on the GENERATE path (not just extend)
 *     refunds the charge in full, exactly once, and saves no song.
 *
 * Charge idempotency itself is lib/credits.ts' contract, proven by
 * credits-team-pool / credits-ledger (re-run in this lane); D3 clip
 * charge persistence is clip-charge-obligations.test.ts (also
 * re-run).
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
    userEmail: "",
    userCredits: 0,
    songs: [] as Array<Record<string, unknown>>,
    vaults: [] as Array<Record<string, unknown>>,
    charges: [] as Array<{ userId: string; cost: number }>,
    refunds: [] as Array<{ userId: string; amount: number }>,
    failSongInsert: false,
    elevenCalls: 0,
    lastMusicLengthMs: null as number | null,
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
    req.userEmail = h.state.userEmail;
    req.userCredits = h.state.userCredits;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (userId: string, cost: number) => {
    h.state.charges.push({ userId, cost });
    return 100_000 - cost;
  }),
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    const ck = typeof clientKey === "string" && clientKey.trim().length >= 8 ? clientKey.trim() : null;
    return ck ? `${scope}:${userId}:client:${ck}` : `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
  },
  voidChargeIdempotencyKey: async () => {},
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
          if (state.failSongInsert) throw new Error("library insert failed (test toggle)");
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

/* Extend tests: the route downloads the original and crossfade-joins it
   with the provider segment through REAL ffmpeg, so both fetches must
   return valid audio — two 5-second sine tones, generated once here. */
const ORIGINAL_URL = "https://media.example.com/original-track.mp3";
let originalTone: Buffer;
let segmentTone: Buffer;

function toneArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

beforeAll(async () => {
  process.env["ELEVENLABS_API_KEY"] = "test-key";
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const { readFile } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const execFileAsync = promisify(execFile);
  const origPath = join(tmpdir(), `bdv-test-original-${randomUUID()}.mp3`);
  const segPath = join(tmpdir(), `bdv-test-segment-${randomUUID()}.mp3`);
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
    "-c:a", "libmp3lame", "-b:a", "192k", origPath,
  ]);
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=5",
    "-c:a", "libmp3lame", "-b:a", "192k", segPath,
  ]);
  originalTone = await readFile(origPath);
  segmentTone = await readFile(segPath);
  /* The provider call is the only global fetch the main route makes;
     the extend route additionally downloads the original audio URL. */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).includes("api.elevenlabs.io")) {
        h.state.elevenCalls += 1;
        try {
          const parsed = JSON.parse(String(init?.body ?? "{}")) as { music_length_ms?: number };
          h.state.lastMusicLengthMs = parsed.music_length_ms ?? null;
        } catch {
          h.state.lastMusicLengthMs = null;
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => toneArrayBuffer(segmentTone),
          text: async () => "",
        };
      }
      if (String(url) === ORIGINAL_URL) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => toneArrayBuffer(originalTone),
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
  h.state.userEmail = "";
  h.state.elevenCalls = 0;
  h.state.lastMusicLengthMs = null;
  h.state.userCredits = 100_000;
  h.state.songs = [];
  h.state.charges = [];
  h.state.refunds = [];
  h.state.failSongInsert = false;
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


describe("Q158 residual — insufficient balance refuses BEFORE the provider", () => {
  it("POST /generate-music-audio with 100 VB against a 400 VB song → 402, no charge, no provider call", async () => {
    h.state.userCredits = 100;
    const { status, json } = await req("POST", "/generate-music-audio", {
      prompt: "warm soul groove",
      lengthSeconds: 30,
    });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(h.state.elevenCalls).toBe(0);
    expect(h.state.charges).toEqual([]);
    expect(h.state.refunds).toEqual([]);
    expect(h.state.songs).toHaveLength(0);
  });

  it("POST /generate-music-audio/extend with 100 VB → 402, no charge, no provider call", async () => {
    h.state.userCredits = 100;
    const { status, json } = await req("POST", "/generate-music-audio/extend", {
      originalAudioUrl: ORIGINAL_URL,
      originalPrompt: "warm soul groove",
      extendPrompt: "epic outro",
      extendSeconds: 5,
      songTitle: "Golden Hour",
    });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(h.state.elevenCalls).toBe(0);
    expect(h.state.charges).toEqual([]);
    expect(h.state.refunds).toEqual([]);
    expect(h.state.songs).toHaveLength(0);
  });
});

describe("Q158 residual — generate-path library-save failure refunds in full", () => {
  it("the song saves nowhere, the 400 VB charge is refunded exactly once, the failure is loud", async () => {
    h.state.failSongInsert = true;
    try {
      const { status, json } = await req("POST", "/generate-music-audio", {
        prompt: "warm soul groove",
        songTitle: "Doomed Save",
        lengthSeconds: 30,
      });
      expect(status).toBe(500);
      expect(String(json.error)).toContain("refunded");
      /* The provider DID run (one call) — the failure is the save. */
      expect(h.state.elevenCalls).toBe(1);
      expect(h.state.charges).toEqual([{ userId: OWNER, cost: 400 }]);
      expect(h.state.refunds).toEqual([{ userId: OWNER, amount: 400 }]);
      expect(h.state.songs).toHaveLength(0);
    } finally {
      h.state.failSongInsert = false;
    }
  });
});
