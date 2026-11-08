/**
 * R2 storage hardening (stack400 C-06/C-07/C-08/C-09) — routes/r2-upload.ts
 * (real express app, requireAuth faked per-caller via the x-test-user
 * header, lib/r2-client faked, the rate limiter a pass-through — pacing
 * is the limiter's own suite's business; the CAPS are pinned here).
 *
 * Pins:
 *  - C-06: member A cannot presign/upload/list/delete/multipart member
 *    B's key under ANY prefix; the shared "anon/" prefix is dead; the
 *    bare "audio-stems/" namespace is dead — only "audio-stems/<own
 *    userId>/…" and "<own userId>/…" pass.
 *  - C-07: at most 5 in-flight multipart sessions per member (a 6th init
 *    is 429 and never reaches R2; completing/aborting frees a slot;
 *    another member is unaffected); part numbers and complete part
 *    lists cap at 128; a session whose server-held parts total over
 *    1 GiB is refused at complete (413) with the true, server-measured
 *    size.
 *  - C-08 (code-side half): a tracked session older than 24h is aborted
 *    bucket-side and its slot freed when the next init sweeps.
 *  - C-09: complete reconciles the submitted (partNumber, etag) set
 *    against the server's ListParts — forged etag, missing part, or
 *    extra part is an honest 409 and R2 complete is never called; an
 *    exact match completes (etag quoting differences are normalized —
 *    the value is the identity).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";

const A = "user-a";
const B = "user-b";

const h = vi.hoisted(() => ({
  configured: true,
  createCount: 0,
  presign: vi.fn(async (_key: string, _ct: string) => "https://r2.example/put"),
  del: vi.fn(async (_key: string) => undefined),
  list: vi.fn(async (_prefix: string) => [] as string[]),
  create: vi.fn(async (_key: string, _ct: string) => `upload-${++h.createCount}`),
  partUrl: vi.fn(async (_key: string, _up: string, part: number) => `https://r2.example/part-${part}`),
  listParts: vi.fn(async (_key: string, _up: string) => [
    { partNumber: 1, etag: '"e1"', size: 8388608 },
    { partNumber: 2, etag: '"e2"', size: 8388608 },
  ]),
  complete: vi.fn(async (key: string, _up: string, _parts: unknown) => `https://cdn.example/${key}`),
  abort: vi.fn(async (_key: string, _up: string) => undefined),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? A;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/r2-client", () => ({
  isR2Configured: () => h.configured,
  r2PublicUrl: (key: string) => `https://cdn.example/${key}`,
  r2GetPresignedPutUrl: h.presign,
  r2Delete: h.del,
  r2List: h.list,
  r2CreateMultipartUpload: h.create,
  r2GetPresignedPartUrl: h.partUrl,
  r2ListParts: h.listParts,
  r2CompleteMultipartUpload: h.complete,
  r2AbortMultipartUpload: h.abort,
}));

import r2UploadRouter from "../r2-upload";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", r2UploadRouter);
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
  h.configured = true;
  h.createCount = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function post(path: string, body: unknown, user: string = A) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

async function get(path: string, user: string = A) {
  const res = await fetch(`${base}${path}`, { headers: { "x-test-user": user } });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

async function del(path: string, body: unknown, user: string = A) {
  const res = await fetch(`${base}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("C-06 — per-member key isolation on every door", () => {
  it("presign: own prefixes pass, everything else is 403 and never reaches R2", async () => {
    expect((await post("/api/r2/presign-upload", { key: `${A}/clips/x.mp4`, contentType: "video/mp4" })).status).toBe(200);
    expect((await post("/api/r2/presign-upload", { key: `audio-stems/${A}/stem.wav`, contentType: "audio/wav" })).status).toBe(200);
    expect(h.presign).toHaveBeenCalledTimes(2);

    for (const key of [
      `audio-stems/${B}/stem.wav`, // another member's stems
      `${B}/clips/x.mp4`, // another member's general prefix
      "audio-stems/exports/someone.mp3", // the bare shared namespace
      "anon/scratch.txt", // the dead shared scratch prefix
      "audio-stems/", // namespace root itself
    ]) {
      const { status } = await post("/api/r2/presign-upload", { key, contentType: "application/octet-stream" });
      expect(status, key).toBe(403);
    }
    expect(h.presign).toHaveBeenCalledTimes(2);
  });

  it("upload alias: a foreign audio-stems key is 403", async () => {
    const { status } = await post("/api/r2/upload", { key: `audio-stems/${B}/stem.wav`, contentType: "audio/wav" });
    expect(status).toBe(403);
    expect(h.presign).not.toHaveBeenCalled();
  });

  it("list: only the caller's own prefixes can be listed", async () => {
    expect((await get(`/api/r2/list?prefix=${encodeURIComponent(`audio-stems/${A}/`)}`)).status).toBe(200);
    expect((await get(`/api/r2/list?prefix=${encodeURIComponent(`${A}/generated`)}`)).status).toBe(200);
    for (const prefix of [`audio-stems/${B}/`, "audio-stems/", `${B}/`, "anon/"]) {
      const { status } = await get(`/api/r2/list?prefix=${encodeURIComponent(prefix)}`);
      expect(status, prefix).toBe(403);
    }
    expect(h.list).toHaveBeenCalledTimes(2);
  });

  it("delete: member A cannot delete member B's key under any prefix", async () => {
    for (const key of [`audio-stems/${B}/exports/song.mp3`, `${B}/clips/x.mp4`, "anon/x"]) {
      const { status } = await del("/api/r2/object", { key });
      expect(status, key).toBe(403);
    }
    expect(h.del).not.toHaveBeenCalled();

    const { status } = await del("/api/r2/object", { key: `audio-stems/${A}/stem.wav` });
    expect(status).toBe(200);
    expect(h.del).toHaveBeenCalledWith(`audio-stems/${A}/stem.wav`);
  });

  it("multipart doors: a foreign key is 403 on init, part-url, parts, complete and abort", async () => {
    const foreign = `audio-stems/${B}/big.mp4`;
    expect((await post("/api/r2/multipart/init", { key: foreign, contentType: "video/mp4" })).status).toBe(403);
    expect((await post("/api/r2/multipart/part-url", { key: foreign, uploadId: "u1", partNumber: 1 })).status).toBe(403);
    expect((await get(`/api/r2/multipart/parts?key=${encodeURIComponent(foreign)}&uploadId=u1`)).status).toBe(403);
    expect(
      (await post("/api/r2/multipart/complete", { key: foreign, uploadId: "u1", parts: [{ partNumber: 1, etag: '"e1"' }] })).status,
    ).toBe(403);
    expect((await post("/api/r2/multipart/abort", { key: foreign, uploadId: "u1" })).status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.partUrl).not.toHaveBeenCalled();
    expect(h.listParts).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.abort).not.toHaveBeenCalled();
  });

  it("the same request from member B for B's own key passes", async () => {
    const { status } = await post("/api/r2/presign-upload", { key: `audio-stems/${B}/stem.wav`, contentType: "audio/wav" }, B);
    expect(status).toBe(200);
  });
});

describe("C-07 — multipart session/part/byte caps", () => {
  const initFor = (user: string, n: number) =>
    post("/api/r2/multipart/init", { key: `${user}/big-${n}.mp4`, contentType: "video/mp4" }, user);

  it("caps in-flight sessions at 5 per member; abort frees a slot; another member is unaffected", async () => {
    for (let i = 1; i <= 5; i++) {
      const { status, json } = await initFor(A, i);
      expect(status).toBe(200);
      expect(json.uploadId).toBe(`upload-${i}`);
    }
    const sixth = await initFor(A, 6);
    expect(sixth.status).toBe(429);
    expect(h.create).toHaveBeenCalledTimes(5);

    // Another member's budget is their own.
    expect((await initFor(B, 1)).status).toBe(200);

    // Aborting one of A's sessions frees a slot.
    expect((await post("/api/r2/multipart/abort", { key: `${A}/big-1.mp4`, uploadId: "upload-1" })).status).toBe(200);
    expect((await initFor(A, 7)).status).toBe(200);
  });

  it("caps part numbers at 128", async () => {
    expect(
      (await post("/api/r2/multipart/part-url", { key: `${A}/big.mp4`, uploadId: "u1", partNumber: 128 })).status,
    ).toBe(200);
    expect(
      (await post("/api/r2/multipart/part-url", { key: `${A}/big.mp4`, uploadId: "u1", partNumber: 129 })).status,
    ).toBe(400);
    expect(h.partUrl).toHaveBeenCalledTimes(1);
  });

  it("caps the complete parts list at 128 entries", async () => {
    const parts = Array.from({ length: 129 }, (_, i) => ({ partNumber: (i % 128) + 1, etag: '"e"' }));
    const { status } = await post("/api/r2/multipart/complete", { key: `${A}/big.mp4`, uploadId: "u1", parts });
    expect(status).toBe(400);
    expect(h.listParts).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("refuses a session whose server-held parts total over 1 GiB (413), measured server-side", async () => {
    h.listParts.mockResolvedValueOnce([
      { partNumber: 1, etag: '"e1"', size: 700 * 1024 * 1024 },
      { partNumber: 2, etag: '"e2"', size: 700 * 1024 * 1024 },
    ]);
    const { status } = await post("/api/r2/multipart/complete", {
      key: `${A}/big.mp4`,
      uploadId: "u1",
      parts: [
        { partNumber: 1, etag: '"e1"' },
        { partNumber: 2, etag: '"e2"' },
      ],
    });
    expect(status).toBe(413);
    expect(h.complete).not.toHaveBeenCalled();
  });
});

describe("C-08 — stale tracked sessions are swept and aborted", () => {
  it("a session older than 24h is aborted bucket-side at the next init and stops occupying a slot", async () => {
    // A fresh member: the in-process registry is module state shared by
    // the whole file, and earlier suites leave other members' sessions in it.
    const C = "user-c";
    const t0 = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0);
    const first = await post("/api/r2/multipart/init", { key: `${C}/old.mp4`, contentType: "video/mp4" }, C);
    expect(first.status).toBe(200);
    expect(first.json.uploadId).toBe("upload-1");

    nowSpy.mockReturnValue(t0 + 25 * 60 * 60 * 1000);
    const second = await post("/api/r2/multipart/init", { key: `${C}/new.mp4`, contentType: "video/mp4" }, C);
    expect(second.status).toBe(200);
    expect(h.abort).toHaveBeenCalledWith(`${C}/old.mp4`, "upload-1");
  });
});

describe("C-09 — complete reconciles against the server's part list", () => {
  const complete = (parts: unknown) =>
    post("/api/r2/multipart/complete", { key: `${A}/big.mp4`, uploadId: "u1", parts });

  it("an exact match completes and passes the caller's list through", async () => {
    const parts = [
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 1, etag: '"e1"' },
    ];
    const { status, json } = await complete(parts);
    expect(status).toBe(200);
    expect(json.publicUrl).toBe(`https://cdn.example/${A}/big.mp4`);
    expect(h.complete).toHaveBeenCalledWith(`${A}/big.mp4`, "u1", parts);
  });

  it("etag quoting differences are normalized — the value is the identity", async () => {
    const { status } = await complete([
      { partNumber: 1, etag: "e1" },
      { partNumber: 2, etag: "e2" },
    ]);
    expect(status).toBe(200);
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it("a forged etag is an honest 409 and R2 complete is never called", async () => {
    const { status, json } = await complete([
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"forged"' },
    ]);
    expect(status).toBe(409);
    expect(json.error).toMatch(/don't match/);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("a missing part is a 409", async () => {
    const { status } = await complete([{ partNumber: 1, etag: '"e1"' }]);
    expect(status).toBe(409);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("an extra part the server does not hold is a 409", async () => {
    const { status } = await complete([
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 3, etag: '"e3"' },
    ]);
    expect(status).toBe(409);
    expect(h.complete).not.toHaveBeenCalled();
  });
});
