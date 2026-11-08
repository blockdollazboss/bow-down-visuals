/**
 * Publish upload door streams from disk (stack300 #68) —
 * routes/publish.ts POST /publish/upload end to end (real express app,
 * real multer, requireAuth + objectStorage faked).
 *
 * Before #68 this door used multer.memoryStorage(): the whole upload
 * (up to 80 MB) sat in RAM, the exact OOM suspect the clip door was
 * migrated away from in 2026-10. Pins:
 *  - the handler hands a temp FILE PATH to the streaming storage helper
 *    (never a Buffer), in the same bucket + object-name shape as before;
 *  - the temp file is deleted after the request (no disk leak);
 *  - the size rules are unchanged: an image over 10 MB is still a 413
 *    FILE_TOO_LARGE and never reaches storage;
 *  - the type filter is unchanged: non audio/video/image is a 400.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { existsSync } from "node:fs";

const h = vi.hoisted(() => ({
  streamUpload: vi.fn(
    async (_bucket: string, objectName: string, _path: string, _ct: string) =>
      `r2://generated-clips/${objectName}`,
  ),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("../../lib/objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  uploadFileStreamToSupabaseStorage: h.streamUpload,
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.example/${ref}`,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async () => null,
}));

import publishRouter from "../publish";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: () => {}, warn: () => {}, error: () => {} };
    next();
  });
  app.use("/api/publish", publishRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function uploadFile(bytes: Buffer, type: string, name: string) {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await fetch(`${base}/api/publish/upload`, { method: "POST", body: fd });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("POST /api/publish/upload (stack300 #68)", () => {
  it("streams an image from a temp file path — never a buffer — and deletes the temp file", async () => {
    const { status, json } = await uploadFile(Buffer.from("png-bytes"), "image/png", "cover.png");
    expect(status).toBe(200);
    expect(json.ref).toMatch(/^r2:\/\/generated-clips\/publish\/user-1\/artwork\//);
    expect(json.url).toContain("https://cdn.example/");

    expect(h.streamUpload).toHaveBeenCalledTimes(1);
    const [bucket, objectName, filePath, contentType] = h.streamUpload.mock.calls[0] as unknown as [string, string, unknown, string];
    expect(bucket).toBe("generated-clips");
    expect(objectName).toMatch(/^publish\/user-1\/artwork\/.+\.png$/);
    expect(typeof filePath).toBe("string"); // a path, not a Buffer
    expect(contentType).toBe("image/png");
    // The temp file is gone once the request finished (finally-unlink).
    expect(existsSync(filePath as string)).toBe(false);
  });

  it("streams audio under the audio kind prefix", async () => {
    const { status } = await uploadFile(Buffer.from("mp3-bytes"), "audio/mpeg", "song.mp3");
    expect(status).toBe(200);
    const objectName = (h.streamUpload.mock.calls[0] as unknown as [string, string])[1];
    expect(objectName).toMatch(/^publish\/user-1\/audio\/.+\.mp3$/);
  });

  it("still rejects an image over 10 MB with 413 FILE_TOO_LARGE and never reaches storage", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    const { status, json } = await uploadFile(big, "image/jpeg", "huge.jpg");
    expect(status).toBe(413);
    expect(json.error).toBe("FILE_TOO_LARGE");
    expect(h.streamUpload).not.toHaveBeenCalled();
  });

  it("still rejects a disallowed file type with the filter's 400", async () => {
    const { status, json } = await uploadFile(Buffer.from("plain text"), "text/plain", "notes.txt");
    expect(status).toBe(400);
    expect(String(json.error)).toContain("Only audio, video, or image files are allowed");
    expect(h.streamUpload).not.toHaveBeenCalled();
  });
});
