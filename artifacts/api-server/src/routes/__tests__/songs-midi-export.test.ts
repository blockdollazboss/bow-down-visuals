/**
 * Route tests for GET /api/songs/:id/midi — melody MIDI export from a
 * finished song in the creator's library.
 *
 * Pins: owner-scoped lookup (a miss is a 404, including another
 * member's song), a REAL Standard MIDI File for a melodic fixture
 * (the house analysis runs for real over a synthesized WAV), an
 * honest 422 when no melody is heard, and the charge discipline —
 * library downloads are free, so chargeCredits must never fire.
 *
 * Mock style mirrors song-cover-covers.test.ts: the real table
 * objects ride along (drizzle conditions build against them) while
 * `db` is a fake chain whose .limit() resolves the hoisted rows.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const SONG_ID = "11111111-1111-4111-8111-111111111111";

/* ── WAV fixture (same shape as lib/__tests__/midi-file.test.ts) ───── */
function wavBuffer(segments: Array<{ freq: number; seconds: number }>, sampleRate = 16_000): Buffer {
  const totalSamples = segments.reduce((n, s) => n + Math.round(s.seconds * sampleRate), 0);
  const data = Buffer.alloc(totalSamples * 2);
  let offset = 0;
  for (const seg of segments) {
    const count = Math.round(seg.seconds * sampleRate);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const v = seg.freq > 0 ? Math.sin(2 * Math.PI * seg.freq * t) * 0.5 : 0;
      data.writeInt16LE(Math.round(v * 32767), offset * 2);
      offset++;
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const MELODY_WAV = wavBuffer([
  { freq: 440, seconds: 0.7 },
  { freq: 0, seconds: 0.2 },
  { freq: 523.25, seconds: 0.7 },
  { freq: 0, seconds: 0.2 },
  { freq: 659.25, seconds: 0.8 },
]);
const SILENCE_WAV = wavBuffer([{ freq: 0, seconds: 2.5 }]);

const h = vi.hoisted(() => ({
  state: {
    rows: [] as Array<Record<string, unknown>>,
    audio: null as Buffer | null,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    req.userCredits = 100_000;
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 100_000),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "supabase://songs/x.mp3"),
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example.com/${ref}`,
  parseSupabaseStorageRefBucketed: (ref: string) => ({ bucket: "songs", path: ref }),
  downloadStorageObjectBuffer: async () => h.state.audio,
}));

vi.mock("../../lib/voice-swap", () => ({
  swapSongVocalsToVoice: vi.fn(async () => Buffer.from("")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  function chain(): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (_n: number) => state.rows,
      then: (res: any, rej: any) => Promise.resolve(state.rows).then(res, rej),
    };
    return c;
  }
  const fakeDb: any = {
    select: (_fields?: unknown) => ({ from: (_table: unknown) => chain() }),
    insert: () => ({ values: () => ({ returning: async () => state.rows }) }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../songs";
import { chargeCredits } from "../../lib/credits";

const realFetch = globalThis.fetch;
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

beforeEach(() => {
  vi.clearAllMocks();
  h.state.rows = [
    {
      id: SONG_ID,
      user_id: USER_ID,
      title: "Fixture Song",
      audio_url: "https://signed.example.com/song.mp3",
      audio_path: "supabase://songs/fixture.mp3",
      source: "generated",
      parent_song_id: null,
      artist_vault_id: null,
      created_at: new Date(),
    },
  ];
  h.state.audio = MELODY_WAV;
});

describe("GET /api/songs/:id/midi", () => {
  it("returns a real MIDI file for the owner's melodic song — and charges nothing", async () => {
    const r = await realFetch(`${baseUrl}/songs/${SONG_ID}/midi`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("audio/midi");
    expect(r.headers.get("content-disposition")).toContain("fixture-song-melody.mid");
    const body = Buffer.from(await r.arrayBuffer());
    expect(body.subarray(0, 4).toString("ascii")).toBe("MThd");
    expect(body.includes(0x90)).toBe(true); // note-on events present
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  }, 30_000);

  it("404s when the owner-scoped lookup misses (another member's song, or none)", async () => {
    h.state.rows = [];
    const r = await realFetch(`${baseUrl}/songs/${SONG_ID}/midi`);
    expect(r.status).toBe(404);
    const json = (await r.json()) as any;
    expect(json.error).toMatch(/not found/i);
  });

  it("answers an honest 422 — no file — when the song has no melody to hear", async () => {
    h.state.audio = SILENCE_WAV;
    const r = await realFetch(`${baseUrl}/songs/${SONG_ID}/midi`);
    expect(r.status).toBe(422);
    expect(r.headers.get("content-type")).toContain("application/json");
    const json = (await r.json()) as any;
    expect(json.code).toBe("no_melody");
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  }, 30_000);
});
