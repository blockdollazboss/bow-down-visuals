/**
 * Route test for GET /song-cover/covers/:songId storage-ref refresh
 * (routes/generate/song-cover).
 *
 * THE DEFECT: the covers list returned whole songsTable rows verbatim,
 * including an un-refreshed audio_url, even though audio_path IS a
 * storage ref (writers store the storageRef there). Sibling song lists
 * re-mint per row before responding — GET /songs (routes/songs.ts) and
 * GET /mashup/using/:id (routes/mashup.ts) map each row to
 * { …row, audio_url: await refreshSupabaseStorageUrl(row.audio_path) }
 * with a try/catch fallback to the raw row. This list did neither, so
 * covers shipped stale / unplayable audio URLs.
 *
 * The objectStorage mock below SIMULATES the real helper's contract
 * (a ref string becomes a fresh signed https URL; everything else
 * passes through unchanged) rather than mocking it as identity —
 * an identity mock could never catch a missing refresh call.
 *
 * Fake-db style mirrors saves-mine-refresh.test.ts: the ownership
 * lookup on the original resolves through .limit(1); the covers query
 * is awaited directly (thenable chain) after .orderBy().
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const SONG_ID = "11111111-1111-4111-8111-111111111111";
const COVER_ONE_ID = "22222222-2222-4222-8222-222222222222";
const COVER_TWO_ID = "33333333-3333-4333-8333-333333333333";
const CREATED = new Date("2026-10-14T15:04:05.000Z");

const h = vi.hoisted(() => ({
  state: {
    original: null as Record<string, unknown> | null,
    covers: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    req.userCredits = 10000;
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/payment-record", () => ({
  recordGenerationHistory: vi.fn(async () => "history-1"),
  markGenerationHistoryCharged: vi.fn(async () => undefined),
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 10000),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

/* Simulated refresh: refs (r2:// / supabase://) become signed https
   URLs; everything else passes through — mirroring
   refreshSupabaseStorageUrl. */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? signedFor(v)
      : v,
  parseSupabaseStorageRefBucketed: () => null,
  downloadStorageObjectBuffer: async () => null,
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async () => undefined),
  r2PublicUrl: vi.fn((key: string) => `https://cdn.example.com/${key}`),
  r2Download: vi.fn(async () => Buffer.from("")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;

  function chain(): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      /* Ownership lookup on the original: .limit(1). */
      limit: async (_n: number) => (state.original ? [state.original] : []),
      /* Covers query: awaited directly after .orderBy(). */
      then: (res: any, rej: any) => Promise.resolve(state.covers).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => chain(),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../generate/song-cover";

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
  h.state.original = {
    id: SONG_ID,
    user_id: USER_ID,
    title: "Original Song",
    audio_url: "https://example.com/original.mp3",
    audio_path: "r2://audio-stems/originals/original.mp3",
    source: "upload",
    parent_song_id: null,
    created_at: CREATED,
  };
  h.state.covers = [
    {
      id: COVER_ONE_ID,
      user_id: USER_ID,
      title: "Original Song (Cover)",
      audio_url: "https://stale.example.com/cover-one.mp3",
      audio_path: "r2://audio-stems/covers/cover-one.mp3",
      source: "cover",
      parent_song_id: SONG_ID,
      created_at: CREATED,
    },
    {
      id: COVER_TWO_ID,
      user_id: USER_ID,
      title: "Original Song (Cover 2)",
      audio_url: "https://stale.example.com/cover-two.mp3",
      audio_path: "r2://audio-stems/covers/cover-two.mp3",
      source: "cover",
      parent_song_id: SONG_ID,
      created_at: CREATED,
    },
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/song-cover/covers/:songId — storage refs are refreshed at the response boundary", () => {
  it("re-mints each cover's audio_url from its audio_path storage ref", async () => {
    const { status, json } = await get(`/song-cover/covers/${SONG_ID}`);

    expect(status).toBe(200);
    expect(json.covers).toHaveLength(2);

    const one = json.covers.find((c: any) => c.id === COVER_ONE_ID);
    expect(one.audio_path).toBe("r2://audio-stems/covers/cover-one.mp3");
    expect(one.audio_url).toBe(
      "https://signed.example.com/audio-stems/covers/cover-one.mp3?sig=test",
    );
    expect(one.audio_url).not.toContain("r2://");
    expect(one.audio_url).not.toBe("https://stale.example.com/cover-one.mp3");

    const two = json.covers.find((c: any) => c.id === COVER_TWO_ID);
    expect(two.audio_path).toBe("r2://audio-stems/covers/cover-two.mp3");
    expect(two.audio_url).toBe(
      "https://signed.example.com/audio-stems/covers/cover-two.mp3?sig=test",
    );
    expect(two.audio_url).not.toContain("r2://");

    /* Shape otherwise unchanged. */
    expect(one.title).toBe("Original Song (Cover)");
    expect(one.parent_song_id).toBe(SONG_ID);
    expect(one.created_at).toBe("2026-10-14T15:04:05.000Z");
  });

  it("leaves a cover with no audio_path untouched (sibling fallback shape)", async () => {
    h.state.covers = [
      {
        id: COVER_ONE_ID,
        user_id: USER_ID,
        title: "Original Song (Cover)",
        audio_url: "https://cdn.example.com/cover-one.mp3",
        audio_path: null,
        source: "cover",
        parent_song_id: SONG_ID,
        created_at: CREATED,
      },
    ];
    const { status, json } = await get(`/song-cover/covers/${SONG_ID}`);
    expect(status).toBe(200);
    expect(json.covers).toHaveLength(1);
    expect(json.covers[0].audio_url).toBe("https://cdn.example.com/cover-one.mp3");
    expect(json.covers[0].audio_path).toBeNull();
  });

  it("404s when the original song is not the caller's", async () => {
    h.state.original = null;
    const { status, json } = await get(`/song-cover/covers/${SONG_ID}`);
    expect(status).toBe(404);
    expect(json.error).toBe("Song not found.");
  });
});
