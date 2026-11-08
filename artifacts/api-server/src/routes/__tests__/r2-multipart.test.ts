/**
 * R2 multipart upload door (stack300 #67) — routes/r2-upload.ts
 * multipart endpoints end to end (real express app, requireAuth faked,
 * lib/r2-client faked).
 *
 * Pins the door's guarantees:
 *  - init/part-url/parts/complete/abort all answer and pass the caller's
 *    key + uploadId through to the R2 client untouched;
 *  - the same key allowlist as the single-PUT door guards every
 *    multipart endpoint (a key outside the caller's prefixes is 403 and
 *    never reaches R2);
 *  - invalid shapes (partNumber out of range, empty parts list) are 400
 *    before any R2 call;
 *  - an unconfigured R2 is an honest 503, like the sibling doors.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

const h = vi.hoisted(() => ({
  configured: true,
  create: vi.fn(async (_key: string, _ct: string) => "upload-id-1"),
  partUrl: vi.fn(async (_key: string, _up: string, part: number) => `https://r2.example/part-${part}`),
  listParts: vi.fn(async (_key: string, _up: string) => [
    { partNumber: 1, etag: '"etag-1"', size: 8388608 },
  ]),
  complete: vi.fn(async (key: string, _up: string, _parts: unknown) => `https://cdn.example/${key}`),
  abort: vi.fn(async (_key: string, _up: string) => undefined),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/r2-client", () => ({
  isR2Configured: () => h.configured,
  r2PublicUrl: (key: string) => `https://cdn.example/${key}`,
  r2GetPresignedPutUrl: vi.fn(async () => "https://r2.example/single-put"),
  r2Delete: vi.fn(async () => undefined),
  r2List: vi.fn(async () => []),
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
  vi.clearAllMocks();
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("POST /api/r2/multipart/init", () => {
  it("starts an upload for the caller's own key and returns the upload id", async () => {
    const { status, json } = await post("/api/r2/multipart/init", {
      key: "user-1/clips/big.mp4",
      contentType: "video/mp4",
    });
    expect(status).toBe(200);
    expect(json.uploadId).toBe("upload-id-1");
    expect(json.publicUrl).toBe("https://cdn.example/user-1/clips/big.mp4");
    expect(h.create).toHaveBeenCalledWith("user-1/clips/big.mp4", "video/mp4");
  });

  it("403s a key outside the caller's prefixes and never reaches R2", async () => {
    const { status } = await post("/api/r2/multipart/init", {
      key: "someone-else/big.mp4",
      contentType: "video/mp4",
    });
    expect(status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("503s honestly when R2 is not configured", async () => {
    h.configured = false;
    const { status } = await post("/api/r2/multipart/init", {
      key: "user-1/big.mp4",
      contentType: "video/mp4",
    });
    expect(status).toBe(503);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/r2/multipart/part-url", () => {
  it("presigns the requested part", async () => {
    const { status, json } = await post("/api/r2/multipart/part-url", {
      key: "user-1/big.mp4",
      uploadId: "upload-id-1",
      partNumber: 3,
    });
    expect(status).toBe(200);
    expect(json.url).toBe("https://r2.example/part-3");
    expect(h.partUrl).toHaveBeenCalledWith("user-1/big.mp4", "upload-id-1", 3);
  });

  it("400s an out-of-range part number before any R2 call", async () => {
    const { status } = await post("/api/r2/multipart/part-url", {
      key: "user-1/big.mp4",
      uploadId: "upload-id-1",
      partNumber: 0,
    });
    expect(status).toBe(400);
    expect(h.partUrl).not.toHaveBeenCalled();
  });
});

describe("GET /api/r2/multipart/parts", () => {
  it("returns the parts the server already holds (the resume truth)", async () => {
    const res = await fetch(
      `${base}/api/r2/multipart/parts?key=${encodeURIComponent("user-1/big.mp4")}&uploadId=upload-id-1`,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.parts).toEqual([{ partNumber: 1, etag: '"etag-1"', size: 8388608 }]);
    expect(h.listParts).toHaveBeenCalledWith("user-1/big.mp4", "upload-id-1");
  });

  it("403s a foreign key", async () => {
    const res = await fetch(
      `${base}/api/r2/multipart/parts?key=${encodeURIComponent("someone-else/big.mp4")}&uploadId=x`,
    );
    expect(res.status).toBe(403);
    expect(h.listParts).not.toHaveBeenCalled();
  });
});

describe("POST /api/r2/multipart/complete + abort", () => {
  it("completes with the caller's part list and returns the public URL", async () => {
    const parts = [
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 1, etag: '"e1"' },
    ];
    const { status, json } = await post("/api/r2/multipart/complete", {
      key: "user-1/big.mp4",
      uploadId: "upload-id-1",
      parts,
    });
    expect(status).toBe(200);
    expect(json.publicUrl).toBe("https://cdn.example/user-1/big.mp4");
    expect(h.complete).toHaveBeenCalledWith("user-1/big.mp4", "upload-id-1", parts);
  });

  it("400s an empty parts list before any R2 call", async () => {
    const { status } = await post("/api/r2/multipart/complete", {
      key: "user-1/big.mp4",
      uploadId: "upload-id-1",
      parts: [],
    });
    expect(status).toBe(400);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("aborts the upload", async () => {
    const { status, json } = await post("/api/r2/multipart/abort", {
      key: "user-1/big.mp4",
      uploadId: "upload-id-1",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(h.abort).toHaveBeenCalledWith("user-1/big.mp4", "upload-id-1");
  });
});
