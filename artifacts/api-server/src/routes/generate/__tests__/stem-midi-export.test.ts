/**
 * Route tests for GET /api/stems/:jobId/midi/:stem — melody MIDI
 * export from one separated stem.
 *
 * Pins: the job owner gate (a job that isn't yours is a 404, exactly
 * like the job poll), readiness (409 before done), stem existence
 * (404 for a stem the job didn't produce), a REAL Standard MIDI File
 * for a melodic stem (the house analysis runs for real over a
 * synthesized WAV served by a mocked fetch), an honest 422 for a
 * melody-less stem, and the charge discipline — the split was paid
 * for, so export charges nothing.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
const JOB_ID = "job-midi-1";

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
  state: { audio: null as Buffer | null },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    req.userCredits = 100_000;
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 100_000),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "supabase://clips/x.wav"),
  uploadFileStreamToSupabaseStorage: vi.fn(async () => "supabase://clips/x.wav"),
  SUPABASE_CLIPS_BUCKET: "clips",
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example.com/${ref}`,
}));

vi.mock("../../../lib/demucs-gate", () => ({
  runGatedDemucs: async (fn: () => Promise<unknown>) => fn(),
  DEMUCS_THREAD_ENV: {},
}));

import router, { __clearStemJobs, __seedStemJob, type StemJob } from "../stem-splitter";
import { chargeCredits } from "../../../lib/credits";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

function doneJob(overrides: Partial<StemJob> = {}): StemJob {
  return {
    id: JOB_ID,
    userId: USER_ID,
    status: "done",
    mode: "full",
    pro: false,
    sourceName: "Fixture Track.mp3",
    durationSeconds: 3,
    stemUrls: {
      vocals: "https://stems.example.com/vocals.wav",
      drums: "https://stems.example.com/drums.wav",
      bass: "https://stems.example.com/bass.wav",
      other: "https://stems.example.com/other.wav",
    },
    stemRefs: null,
    instrumentalUrl: null,
    instrumentalRef: null,
    error: null,
    creditsCharged: 400,
    createdAt: Date.now(),
    ...overrides,
  };
}

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
  __clearStemJobs();
  h.state.audio = MELODY_WAV;
  // The stem download streams from the job's signed URL — serve the
  // fixture for any stem URL the handler asks for.
  vi.stubGlobal("fetch", async (_url: unknown) =>
    new Response(new Uint8Array(h.state.audio!), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/stems/:jobId/midi/:stem", () => {
  it("returns a real MIDI file for the owner's melodic stem — and charges nothing", async () => {
    __seedStemJob(doneJob());
    const r = await realFetch(`${baseUrl}/stems/${JOB_ID}/midi/vocals`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("audio/midi");
    expect(r.headers.get("content-disposition")).toContain("fixture-track-vocals-melody.mid");
    const body = Buffer.from(await r.arrayBuffer());
    expect(body.subarray(0, 4).toString("ascii")).toBe("MThd");
    expect(body.includes(0x90)).toBe(true);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  }, 30_000);

  it("404s for another member's job — the same gate as the job poll", async () => {
    __seedStemJob(doneJob({ userId: OTHER_USER_ID }));
    const r = await realFetch(`${baseUrl}/stems/${JOB_ID}/midi/vocals`);
    expect(r.status).toBe(404);
  });

  it("404s for a stem the job never produced, and for a nonsense stem name", async () => {
    __seedStemJob(doneJob());
    const pro = await realFetch(`${baseUrl}/stems/${JOB_ID}/midi/guitar`);
    expect(pro.status).toBe(404);
    const bogus = await realFetch(`${baseUrl}/stems/${JOB_ID}/midi/kazoo`);
    expect(bogus.status).toBe(404);
  });

  it("409s while the split hasn't finished", async () => {
    __seedStemJob(doneJob({ status: "processing", stemUrls: null }));
    const r = await realFetch(`${baseUrl}/stems/${JOB_ID}/midi/vocals`);
    expect(r.status).toBe(409);
  });

  it("answers an honest 422 — no file — when the stem has no melody (silent drums)", async () => {
    __seedStemJob(doneJob());
    h.state.audio = SILENCE_WAV;
    const r = await realFetch(`${baseUrl}/stems/${JOB_ID}/midi/drums`);
    expect(r.status).toBe(422);
    const json = (await r.json()) as any;
    expect(json.code).toBe("no_melody");
    expect(json.error).toMatch(/drums/i);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  }, 30_000);
});
