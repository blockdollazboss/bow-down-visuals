/**
 * CA-7 replay safety — batch B (in-handler flight patterns):
 *  - stock.ts POST /stock/import (50)
 *  - artist-voices.ts POST /artist-vaults/:id/voice/from-song (200)
 *  - song-remix.ts POST /song-remix (400) + /song-replace-section (300)
 *  - songs.ts POST /songs/:id/remix (300)
 *  - mashup.ts POST /mashup (400)
 *  - lut.ts POST /apply-lut (150, multipart)
 *  - wallpapers.ts POST /wallpapers/render clean (400) +
 *    /wallpapers/screensaver-render (300) + /wallpapers/pack-of-10 (500)
 *
 * Per rail: fresh charges once + provider/work once + stored row =
 * body; re-ask serves stored + `replayed: true` (+ replayNote where
 * the rail carries one) with counts frozen; failure refunds + voids
 * the charge key, stores nothing, and the retry charges fresh.
 * Wallpaper branded renders stay FREE and unstored.
 *
 * Harness: the CA-KEY fake-credits ledger + key-aware stored-result
 * fake over @workspace/db, per-table row stores, a URL-prefix fetch
 * stub (ElevenLabs IVC + music, song downloads), child_process fakes
 * for ffmpeg/ffprobe, and mocked object storage / stem separation /
 * voice swap so no real provider or encoder runs.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "crypto";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 10_000,
  charges: [] as Array<{ amount: number; key: string | null }>,
  refunds: [] as Array<{ amount: number }>,
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  stores: new Map<any, Array<Record<string, any>>>(),
  storeMode: "ok" as "ok" | "throw",
  musicCalls: 0,
  musicMode: "ok" as "ok" | "fail",
  ivcCalls: 0,
  ivcMode: "ok" as "ok" | "fail",
  stemCalls: 0,
  swapCalls: 0,
  swapMode: "ok" as "ok" | "throw",
  uploads: 0,
  saves: 0,
  execCounts: { ffmpeg: 0, ffprobe: 0 },
}));

function tableStore(table: any): Array<Record<string, any>> {
  let s = h.stores.get(table);
  if (!s) { s = []; h.stores.set(table, s); }
  return s;
}

function collectEq(node: any, out: Record<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  const chunks: any[] = Array.isArray(node.queryChunks) ? node.queryChunks : [];
  let pendingCol: string | null = null;
  for (const ch of chunks) {
    if (ch && typeof ch === "object") {
      if (typeof ch.name === "string" && ch.table) { pendingCol = ch.name; continue; }
      if (ch.constructor?.name === "Param" && pendingCol) { out[pendingCol] = ch.value; pendingCol = null; continue; }
      if (Array.isArray(ch.queryChunks)) collectEq(ch, out);
      if (Array.isArray(ch.value)) for (const v of ch.value) collectEq(v, out);
    }
  }
}
function matches(row: Record<string, any>, cond: any): boolean {
  const eqs: Record<string, unknown> = {};
  collectEq(cond, eqs);
  return Object.entries(eqs).every(([k, v]) => String(row[k]) === String(v));
}

function keyFromCondition(cond: unknown): string | null {
  const walk = (node: unknown, depth: number): string | null => {
    if (node === null || typeof node !== "object" || depth > 6) return null;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      const v = (node as { value?: unknown }).value;
      return typeof v === "string" ? v : null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = walk(child, depth + 1);
        if (hit !== null) return hit;
      }
      return null;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    return Array.isArray(chunks) ? walk(chunks, depth + 1) : null;
  };
  return walk(cond, 0);
}

const FakeClasses = vi.hoisted(() => ({
  OutOfCreditsError: class FakeOutOfCredits extends Error {},
  LedgerWriteError: class FakeLedgerWrite extends Error {},
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: FakeClasses.OutOfCreditsError,
  LedgerWriteError: FakeClasses.LedgerWriteError,
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
      return `${scope}:${userId}:client:${clientKey.trim()}`;
    }
    const hash = createHash("sha256").update(JSON.stringify(intent ?? null)).digest("hex").slice(0, 32);
    return `${scope}:${userId}:${hash}`;
  },
  chargeCredits: async (_userId: string, amount: number, _record: unknown, opts?: { idempotencyKey?: string }) => {
    const key = opts?.idempotencyKey ?? null;
    if (key !== null && h.chargedKeys.has(key)) return h.balance;
    if (h.balance < amount) throw new FakeClasses.OutOfCreditsError("out");
    h.balance -= amount;
    if (key !== null) h.chargedKeys.add(key);
    h.charges.push({ amount, key });
    return h.balance;
  },
  refundCredits: async (_userId: string, amount: number) => {
    h.balance += amount;
    h.refunds.push({ amount });
    return h.balance;
  },
  voidChargeIdempotencyKey: async (key: string) => {
    h.voids.push(key);
    h.chargedKeys.delete(key);
  },
}));

/* ffmpeg/ffprobe: count invocations; ffmpeg writes a dummy output file
   (the last argv entry) so readFile calls downstream succeed. */
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    execFile: (cmd: string, args: string[], optsOrCb: any, maybeCb?: any) => {
      const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
      if (cmd === "ffmpeg") {
        h.execCounts.ffmpeg++;
        const out = args[args.length - 1]!;
        try { writeFileSync(out, Buffer.alloc(4096, 7)); } catch { /* ignore */ }
        cb(null, { stdout: "", stderr: "t: 1.000 TARGET: -23.0 LUFS M: -20.0" });
      } else if (cmd === "ffprobe") {
        h.execCounts.ffprobe++;
        cb(null, { stdout: "60\n", stderr: "" });
      } else {
        cb(new Error(`unexpected execFile ${cmd}`), { stdout: "", stderr: "" });
      }
    },
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (name: string) => {
    h.uploads++;
    return `storage://${name}`;
  }),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) =>
    String(ref).startsWith("http") ? ref : `https://cdn.example.com/${ref}`),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  parseSupabaseStorageRefBucketed: () => null,
  downloadStorageObjectBuffer: vi.fn(async () => null),
}));

vi.mock("../../lib/stem-separation", () => ({
  separateVocalStems: async () => {
    h.stemCalls++;
    const vocalsPath = join(tmpdir(), `ca7-vocals-${randomUUID()}.wav`);
    writeFileSync(vocalsPath, Buffer.alloc(600 * 1024, 3));
    return { vocalsPath, workdir: tmpdir() };
  },
  cleanupWorkdir: async () => {},
}));

vi.mock("../../lib/elevenlabs", () => ({
  canUseInstantVoiceCloning: async () => true,
}));

vi.mock("../../lib/voice-swap", () => ({
  swapSongVocalsToVoice: async (buf: Buffer) => {
    h.swapCalls++;
    if (h.swapMode === "throw") throw new Error("voice swap exploded");
    return buf;
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  freeExpensiveAiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/midi-file", () => ({
  buildMelodyMidi: () => Buffer.alloc(0),
  midiFilenameBase: (s: string) => s,
  NoMelodyError: class NoMelodyError extends Error {},
}));

vi.mock("../../lib/song-credits-db", () => ({
  loadCanonicalCreditsForSongs: async () => new Map(),
}));

vi.mock("../../lib/song-credits", () => ({
  publicCreditsDto: (x: any) => x,
}));

vi.mock("../../lib/save-generation", () => ({
  saveGeneration: async () => { h.saves++; },
}));

vi.mock("../../lib/theme-kit-build", () => ({
  /* Site assets resolve from disk only for paths WITHOUT a dot in the
     first segment — hostnames like media.example.com / bad.invalid
     must fall through to the HTTP fetch path, exactly as a real
     external URL would. */
  readSiteAsset: (p: string) => (String(p).split("/")[1]?.includes(".") ? null : Buffer.alloc(2048, 5)),
}));

vi.mock("../../lib/disclosure-metadata", () => ({
  stampImageWithDisclosure: (buf: Buffer) => ({ applied: false, buffer: buf }),
  stampVideoFileWithDisclosure: async () => false,
}));

vi.mock("../../lib/provenance", () => ({
  aiDisclosureMetadataText: () => "AI disclosure",
  PROVENANCE_PLATFORM: "Bow Down Visuals",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { generationStoredResultsTable } = actual;
  const fakeDb = {
    select: () => ({
      from: (table: any) => {
        if (table === generationStoredResultsTable) {
          return {
            where: (cond: unknown) => ({
              limit: async () => {
                const key = keyFromCondition(cond);
                const row = key !== null ? h.stored.get(key) : undefined;
                return row ? [row] : [];
              },
            }),
          };
        }
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = cond ? tableStore(table).filter((r) => matches(r, cond)) : [...tableStore(table)];
          if (lim !== null) rows = rows.slice(0, lim);
          return rows;
        };
        const chain: any = {
          where: (c: any) => { cond = c; return chain; },
          orderBy: (..._a: any[]) => chain,
          limit: async (n: number) => { lim = n; return run(); },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        if (table === generationStoredResultsTable) {
          return {
            onConflictDoNothing: async () => {
              if (h.storeMode === "throw") throw new Error("store write failed");
              if (!h.stored.has(v.idempotencyKey)) {
                h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
              }
              return [];
            },
          };
        }
        const build = () => {
          const row = { ...v, id: v.id ?? randomUUID(), created_at: new Date(), updated_at: new Date() };
          tableStore(table).push(row);
          return [row];
        };
        return {
          returning: async () => build(),
          onConflictDoUpdate: () => ({ returning: async () => build() }),
          onConflictDoNothing: async () => build(),
        };
      },
    }),
    update: (table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            const hit = tableStore(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
          then: (res: any, rej: any) => {
            const hit = tableStore(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return Promise.resolve(hit).then(res, rej);
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: async (cond: any) => {
        h.stores.set(table, tableStore(table).filter((r) => !matches(r, cond)));
      },
    }),
  };
  return { ...actual, db: fakeDb };
});

import stockRouter, { __resetStockImportReplayCache } from "../stock";
import artistVoicesRouter, { __resetFromSongReplayCache } from "../artist-voices";
import songRemixRouter, { __resetSongRemixReplayCache } from "../song-remix";
import songsRouter, { __resetSongsRemixReplayCache } from "../songs";
import mashupRouter, { __resetMashupReplayCache } from "../mashup";
import lutRouter, { __resetLutReplayCache } from "../lut";
import wallpapersRouter, { __resetWallpaperReplayCache } from "../wallpapers";
import { songsTable, artistVaultsTable } from "@workspace/db";

let base = "";
let server: ReturnType<express.Express["listen"]>;
let realFetch: typeof fetch;

const SONG_ID = randomUUID();
const SONG2_ID = randomUUID();
const VAULT_ID = randomUUID();

beforeAll(async () => {
  realFetch = globalThis.fetch;
  /* URL-prefix fetch stub: ElevenLabs + remote media; everything else
     (the test server itself) delegates to the real fetch. */
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url.includes("api.elevenlabs.io/v1/voices/add")) {
      h.ivcCalls++;
      if (h.ivcMode === "fail") {
        return new Response("ivc rejected", { status: 500 });
      }
      return new Response(JSON.stringify({ voice_id: "voice-abc", requires_verification: false }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.elevenlabs.io/v1/voices/")) {
      return new Response(JSON.stringify({ preview_url: "https://cdn.example.com/preview.mp3" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.elevenlabs.io/v1/music")) {
      h.musicCalls++;
      if (h.musicMode === "fail") {
        return new Response("music provider down", { status: 500 });
      }
      return new Response(new Uint8Array(4096), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (url.includes("media.example.com")) {
      return new Response(new Uint8Array(8192), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(stockRouter);
  app.use(artistVoicesRouter);
  app.use(songRemixRouter);
  app.use(songsRouter);
  app.use(mashupRouter);
  app.use(lutRouter);
  app.use(wallpapersRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.balance = 10_000;
  h.charges = [];
  h.refunds = [];
  h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.stores = new Map();
  h.storeMode = "ok";
  h.musicCalls = 0;
  h.musicMode = "ok";
  h.ivcCalls = 0;
  h.ivcMode = "ok";
  h.stemCalls = 0;
  h.swapCalls = 0;
  h.swapMode = "ok";
  h.uploads = 0;
  h.saves = 0;
  h.execCounts = { ffmpeg: 0, ffprobe: 0 };
  tableStore(songsTable).push(
    { id: SONG_ID, user_id: USER, title: "Original Track", audio_url: "https://media.example.com/song.mp3", audio_path: null },
    { id: SONG2_ID, user_id: USER, title: "Second Track", audio_url: "https://media.example.com/song2.mp3", audio_path: null },
  );
  tableStore(artistVaultsTable).push({
    id: VAULT_ID, user_id: USER, artist_name: "King Shark",
    voice_id: "voice-locked", voice_name: "King Shark — Locked Voice",
  });
  __resetStockImportReplayCache();
  __resetFromSongReplayCache();
  __resetSongRemixReplayCache();
  __resetSongsRemixReplayCache();
  __resetMashupReplayCache();
  __resetLutReplayCache();
  __resetWallpaperReplayCache();
});

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("CA-7 stock import", () => {
  const body = {
    itemId: "pexels-123", type: "video", title: "City B-roll",
    previewUrl: "https://images.pexels.com/photos/1/preview.jpg",
    fileUrl: "https://videos.pexels.com/video-files/1/clip.mp4",
  };

  it("fresh charges 50 once and persists; replay serves the stored import", async () => {
    const r1 = await postJson("/stock/import", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.success).toBe(true);
    expect(r1.body.item.id).toBe("pexels-123");
    expect(r1.body.creditsRemaining).toBe(10_000 - 50);
    expect(h.charges).toHaveLength(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("stock-import");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/stock/import", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
  });

  it("non-provider file URL refunds + voids, stores nothing, retry charges fresh", async () => {
    const bad = { ...body, fileUrl: "https://evil.example.com/clip.mp4" };
    const r1 = await postJson("/stock/import", bad);
    expect(r1.status).toBe(500);
    expect(r1.body.error).toContain("refunded");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    const r2 = await postJson("/stock/import", bad);
    expect(r2.status).toBe(500);
    expect(h.charges).toHaveLength(2); // voided key → the retry charged fresh
    expect(h.refunds).toHaveLength(2);
  });
});

describe("CA-7 artist-voices voice-from-song", () => {
  const path = `/artist-vaults/${VAULT_ID}/voice/from-song`;
  const send = async () => {
    const form = new FormData();
    form.append("songUrl", "https://media.example.com/song.mp3");
    const res = await fetch(`${base}${path}`, { method: "POST", body: form });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  it("fresh charges 200 once, clones once, persists; replay serves the stored clone", async () => {
    const r1 = await send();
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.voice_id).toBe("voice-abc");
    expect(r1.body.creditsAfter).toBe(10_000 - 200);
    expect(h.charges).toHaveLength(1);
    expect(h.ivcCalls).toBe(1);
    expect(h.stemCalls).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("artist-voice-from-song");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await send();
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.ivcCalls).toBe(1); // no second clone
    expect(h.stemCalls).toBe(1); // no second isolation
  });

  it("clone failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.ivcMode = "fail";
    const r1 = await send();
    expect(r1.status).toBe(502);
    expect(r1.body.code).toBe("clone_failed");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.ivcMode = "ok";
    const r2 = await send();
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-7 song-remix rails", () => {
  it("song-remix: fresh charges 400 once, provider once, one song row; replay serves it", async () => {
    const body = { songId: SONG_ID, lyrics: "new hook energy", lengthSeconds: 30 };
    const r1 = await postJson("/song-remix", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.song.source).toBe("song-remix");
    expect(r1.body.creditsAfter).toBe(10_000 - 400);
    expect(h.charges).toHaveLength(1);
    expect(h.musicCalls).toBe(1);
    const songRows = tableStore(songsTable).length;
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("song-remix");
    expect(JSON.parse(JSON.stringify(storedRow.result))).toEqual(JSON.parse(JSON.stringify(r1.body)));

    const r2 = await postJson("/song-remix", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.musicCalls).toBe(1);
    expect(tableStore(songsTable).length).toBe(songRows); // no second song row
  });

  it("song-remix: provider failure refunds + voids, retry charges fresh", async () => {
    h.musicMode = "fail";
    const body = { songId: SONG_ID, lyrics: "new hook energy", lengthSeconds: 30 };
    const r1 = await postJson("/song-remix", body);
    expect(r1.status).toBe(500);
    expect(r1.body.code).toBe("remix_failed");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.musicMode = "ok";
    const r2 = await postJson("/song-remix", body);
    expect(r2.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });

  it("replace-section: fresh charges 300 once; replay serves the stored splice", async () => {
    const body = { songId: SONG_ID, section: "Chorus", startSec: 10, endSec: 40 };
    const r1 = await postJson("/song-replace-section", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.song.source).toBe("section-replace");
    expect(r1.body.section).toBe("Chorus");
    expect(r1.body.creditsAfter).toBe(10_000 - 300);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);
    expect(h.musicCalls).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("song-replace-section");

    const r2 = await postJson("/song-replace-section", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.musicCalls).toBe(1);
  });

  it("replace-section: provider failure refunds + voids, retry charges fresh", async () => {
    h.musicMode = "fail";
    const body = { songId: SONG_ID, section: "Chorus", startSec: 10, endSec: 40 };
    const r1 = await postJson("/song-replace-section", body);
    expect(r1.status).toBe(500);
    expect(r1.body.code).toBe("replace_failed");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.musicMode = "ok";
    const r2 = await postJson("/song-replace-section", body);
    expect(r2.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-7 songs remix", () => {
  const path = `/songs/${SONG_ID}/remix`;
  const body = { artistVaultId: VAULT_ID };

  it("fresh charges 300 once, swaps once, one song row; replay serves it", async () => {
    const r1 = await postJson(path, body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.song.source).toBe("remix");
    expect(r1.body.creditsAfter).toBe(10_000 - 300);
    expect(h.charges).toHaveLength(1);
    expect(h.swapCalls).toBe(1);
    const songRows = tableStore(songsTable).length;
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("songs-remix");

    const r2 = await postJson(path, body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.swapCalls).toBe(1);
    expect(tableStore(songsTable).length).toBe(songRows);
  });

  it("swap failure refunds + voids, stores nothing, retry charges fresh", async () => {
    h.swapMode = "throw";
    const r1 = await postJson(path, body);
    expect(r1.status).toBe(500);
    expect(r1.body.code).toBe("remix_failed");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.swapMode = "ok";
    const r2 = await postJson(path, body);
    expect(r2.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-7 mashup", () => {
  const body = {
    songA: { songId: SONG_ID }, songB: { songId: SONG2_ID },
    style: "crossfade", crossfadeSec: 6, balance: 50,
  };

  it("fresh charges 400 once, renders once, one song row; replay serves it", async () => {
    const r1 = await postJson("/mashup", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.song.source).toBe("mashup");
    expect(r1.body.analysis.style).toBe("crossfade");
    expect(h.charges).toHaveLength(1);
    /* ffmpeg runs 3x per fresh mashup: two beat-detection passes +
       the render itself. The pin is that a replay adds NONE. */
    const ffmpegAfterFresh = h.execCounts.ffmpeg;
    expect(ffmpegAfterFresh).toBeGreaterThan(0);
    const songRows = tableStore(songsTable).length;
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("song-mashup");

    const r2 = await postJson("/mashup", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(ffmpegAfterFresh); // no second render
    expect(tableStore(songsTable).length).toBe(songRows);
  });

  it("unknown song refunds (bad input) + voids, stores nothing, retry charges fresh", async () => {
    const bad = { ...body, songA: { songId: randomUUID() } };
    const r1 = await postJson("/mashup", bad);
    expect(r1.status).toBe(400);
    expect(r1.body.code).toBe("bad_input");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    const r2 = await postJson("/mashup", bad);
    expect(r2.status).toBe(400);
    expect(h.charges).toHaveLength(2); // voided key → charged fresh again
  });
});

const CUBE_TEXT = [
  'TITLE "Test LUT"',
  "LUT_3D_SIZE 2",
  "0 0 0", "0 0 1", "0 1 0", "0 1 1",
  "1 0 0", "1 0 1", "1 1 0", "1 1 1",
  "",
].join("\n");

describe("CA-7 lut apply", () => {
  const sendLut = async () => {
    const form = new FormData();
    form.append("video", new Blob([new Uint8Array(2048)], { type: "video/mp4" }), "clip.mp4");
    form.append("lut", new Blob([CUBE_TEXT], { type: "text/plain" }), "test.cube");
    const res = await fetch(`${base}/apply-lut`, { method: "POST", body: form });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  it("fresh charges 150 once, renders once, persists; replay serves the stored grade", async () => {
    const r1 = await sendLut();
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.lut).toBe("Test LUT");
    expect(r1.body.creditsRemaining).toBe(10_000 - 150);
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("lut-apply");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await sendLut();
    expect(r2.body).toEqual({ ...r1.body, replayed: true, replayNote: expect.any(String) });
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(1); // no second render
  });
});

describe("CA-7 wallpapers", () => {
  const cleanBody = { sourceUrl: "https://media.example.com/art.png", presetKey: "phone-iphone", branded: false };

  it("clean render: fresh charges 400 once, renders once; replay serves the stored render", async () => {
    const r1 = await postJson("/wallpapers/render", cleanBody);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.creditCost).toBe(400);
    expect(r1.body.branded).toBe(false);
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("wallpaper-clean-render");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/wallpapers/render", cleanBody);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(1);
  });

  it("branded render stays FREE and unstored", async () => {
    const brandedBody = { sourceUrl: "https://media.example.com/art.png", presetKey: "phone-iphone", branded: true };
    const r1 = await postJson("/wallpapers/render", brandedBody);
    expect(r1.status).toBe(200);
    expect(r1.body.creditCost).toBe(0);
    expect(r1.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(0);
    expect(h.stored.size).toBe(0);

    const r2 = await postJson("/wallpapers/render", brandedBody);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(0);
    expect(h.execCounts.ffmpeg).toBe(2); // free path always renders fresh
  });

  it("screensaver: fresh charges 300 once; replay serves the stored loop", async () => {
    const body = { videoUrl: "https://media.example.com/clip.mp4", presetKey: "desktop-fhd", seconds: 30 };
    const r1 = await postJson("/wallpapers/screensaver-render", body);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.creditCost).toBe(300);
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("wallpaper-screensaver-loop");

    const r2 = await postJson("/wallpapers/screensaver-render", body);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(1);
  });

  it("pack of 10: fresh charges 500 once for ten renders; replay serves the stored pack", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      sourceUrl: `https://media.example.com/art-${i}.png`, presetKey: "phone-iphone",
    }));
    const r1 = await postJson("/wallpapers/pack-of-10", { items });
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.count).toBe(10);
    expect(r1.body.creditCost).toBe(500);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(500);
    expect(h.execCounts.ffmpeg).toBe(10);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("wallpaper-pack-10");

    const r2 = await postJson("/wallpapers/pack-of-10", { items });
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.execCounts.ffmpeg).toBe(10); // no re-render of any of the ten
  });

  it("pack failure (bad source) refunds + voids, stores nothing, retry charges fresh", async () => {
    const items = Array.from({ length: 10 }, () => ({
      sourceUrl: "https://media.example.com/art.png", presetKey: "phone-iphone",
    }));
    items[3] = { sourceUrl: "https://bad.invalid/art.png", presetKey: "phone-iphone" };
    const failReal = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : String(input?.url ?? input);
      if (url.includes("bad.invalid")) return new Response("nope", { status: 404 });
      return failReal(input, init);
    }) as typeof fetch;
    try {
      const r1 = await postJson("/wallpapers/pack-of-10", { items });
      expect(r1.status).toBe(502);
      expect(h.refunds).toHaveLength(1);
      expect(h.voids).toHaveLength(1);
      expect(h.stored.size).toBe(0);

      const r2 = await postJson("/wallpapers/pack-of-10", { items });
      expect(r2.status).toBe(502);
      expect(h.charges).toHaveLength(2); // voided key → charged fresh again
    } finally {
      globalThis.fetch = failReal;
    }
  });
});
