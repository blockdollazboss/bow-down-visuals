/**
 * Round-trip test for Audio Studio library linkage (audit DE-6):
 * a song picked FROM the library goes into Audio Cleanup, and the
 * finished output comes back AS a library song — a real `songs` row
 * whose parent_song_id points at the song it started from.
 *
 * Driven over HTTP against the real router; ffmpeg, storage, credits
 * and the DB are mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import express from "express";
import { promises as fs } from "fs";
import type { AddressInfo } from "node:net";

const PARENT_ID = "123e4567-e89b-12d3-a456-426614174000";

const state = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  userCredits: 5000,
  insertedSongs: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!state.authedUserId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = state.authedUserId;
    req.userCredits = state.userCredits;
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_userId: string, amount: number) => state.userCredits - amount),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (name: string) => `ref:${name}`),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://signed.example/${ref.replace(/^ref:/, "")}`),
}));

/* ffmpeg stand-in: "renders" the output file (last arg) with dummy bytes
   and reports an RMS level on stderr for the measurement passes. */
vi.mock("child_process", () => ({
  execFile: (_file: string, args: string[], options: unknown, cb?: unknown) => {
    const callback = (typeof options === "function" ? options : cb) as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    void (async () => {
      const out = args[args.length - 1];
      if (out && /\.mp3$/i.test(out)) {
        await fs.writeFile(out, Buffer.from("fake-cleaned-audio"));
      }
      callback(null, "", "RMS level dB: -18.5");
    })();
  },
}));

vi.mock("@workspace/db", () => {
  const songsTable = { __table: "songs", id: "id" };
  return {
    songsTable,
    db: {
      insert: vi.fn(() => ({
        values: (v: any) => {
          state.insertedSongs.push(v);
          return { returning: async () => [{ id: "song-cleaned-1" }] };
        },
      })),
    },
  };
});

import audioCleanupRouter, { __clearAudioCleanupJobs } from "../generate/audio-cleanup";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api", audioCleanupRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.authedUserId = "user-1";
  state.userCredits = 5000;
  state.insertedSongs = [];
  __clearAudioCleanupJobs();
});

async function waitForDone(jobId: string): Promise<any> {
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${base}/api/audio-cleanup/${jobId}`);
    const data = await res.json();
    if (data.status === "done" || data.status === "failed") return data;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("job never finished");
}

describe("Audio Studio ⇄ song library round-trip (DE-6)", () => {
  it("library song in → cleaned output recorded back as a library song, chained to its parent", async () => {
    const form = new FormData();
    form.append("mode", "voice");
    form.append("sourceSongId", PARENT_ID);
    form.append("audio", new Blob([Buffer.from("rough-audio")], { type: "audio/mpeg" }), "Midnight Run.mp3");

    const post = await fetch(`${base}/api/audio-cleanup`, { method: "POST", body: form });
    expect(post.status).toBe(202);
    const { jobId } = await post.json();

    const done = await waitForDone(jobId);
    expect(done.status).toBe("done");
    expect(done.outputUrl).toContain("https://signed.example/audio-cleanup/");
    /* The poll tells the client the output's library id… */
    expect(done.songId).toBe("song-cleaned-1");
    /* …and the row itself carries the round-trip: same user, cleaned
       title, source "cleanup", parent = the library song it came from. */
    expect(state.insertedSongs).toHaveLength(1);
    expect(state.insertedSongs[0]).toMatchObject({
      user_id: "user-1",
      title: "Midnight Run (Cleaned)",
      source: "cleanup",
      parent_song_id: PARENT_ID,
    });
    expect(state.insertedSongs[0].audio_url).toBe(done.outputUrl);
    expect(state.insertedSongs[0].audio_path).toMatch(/^ref:audio-cleanup\//);
  });

  it("an upload that did NOT come from the library still saves its output, with no parent", async () => {
    const form = new FormData();
    form.append("mode", "denoise");
    form.append("audio", new Blob([Buffer.from("rough-audio")], { type: "audio/wav" }), "voice memo.wav");

    const post = await fetch(`${base}/api/audio-cleanup`, { method: "POST", body: form });
    expect(post.status).toBe(202);
    const { jobId } = await post.json();

    const done = await waitForDone(jobId);
    expect(done.status).toBe("done");
    expect(done.songId).toBe("song-cleaned-1");
    expect(state.insertedSongs[0]).toMatchObject({
      title: "voice memo (Cleaned)",
      source: "cleanup",
      parent_song_id: null,
    });
  });
});
