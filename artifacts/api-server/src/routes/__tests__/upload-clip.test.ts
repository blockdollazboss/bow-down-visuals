/**
 * Scene-clip direct door (Stack 400 census D-45) —
 * routes/generate/upload-clip.ts session + complete endpoints
 * (real express app, requireAuth faked, lib/r2-client faked).
 *
 * Pins the door's guarantees:
 *  - session mints ONLY per-member scoped keys (`<userId>/clips/…`);
 *  - the video rule and the size caps (member 80 MB, admin 1 GB) are
 *    enforced at the mint with the retired door's own honest shapes;
 *  - complete records a clip only when the object exists under the
 *    caller's own clips prefix and respects the same caps, and
 *    answers the recorded { url, ref } shape downstream reads;
 *  - another member's key is 403 and never reaches storage;
 *  - the old multipart POST /upload-clip is GONE (404) — no
 *    server-disk transit door remains.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

const MB = 1024 * 1024;

const h = vi.hoisted(() => ({
  configured: true,
  admin: false,
  head: vi.fn(async (_key: string) => ({ size: 1024, contentType: "video/mp4" }) as
    | { size: number; contentType: string | null }
    | null),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? "user-1";
    req.userEmail = req.headers["x-test-email"] ?? "member@example.com";
    next();
  },
}));

vi.mock("../../lib/admin", () => ({
  isAdminRequest: () => h.admin,
}));

vi.mock("../../lib/upload-storage", () => ({
  ADMIN_UPLOAD_MAX_BYTES: 1024 * 1024 * 1024,
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../lib/r2-client", () => ({
  isR2Configured: () => h.configured,
  r2ObjectSize: h.head,
  r2PublicUrl: (key: string) => `https://cdn.example/${key}`,
}));

import uploadClipRouter from "../generate/upload-clip";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", uploadClipRouter);
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
  h.admin = false;
  h.head.mockClear();
  h.head.mockImplementation(async () => ({ size: 1024, contentType: "video/mp4" }));
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

describe("POST /api/upload-clip/session — the mint", () => {
  it("hands back a per-member scoped clips key", async () => {
    const { status, body } = await post("/api/upload-clip/session", {
      filename: "My Clip.MP4",
      contentType: "video/mp4",
      size: 5 * MB,
    });
    expect(status).toBe(200);
    expect(body.key).toMatch(/^user-1\/clips\/\d+-[0-9a-f-]{36}\.mp4$/);
  });

  it("refuses a non-video file with the retired door's own words", async () => {
    const { status, body } = await post("/api/upload-clip/session", {
      filename: "photo.png",
      contentType: "image/png",
      size: 1000,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Only video files are allowed");
  });

  it("refuses a member clip over 80 MB with the FILE_TOO_LARGE shape", async () => {
    const { status, body } = await post("/api/upload-clip/session", {
      filename: "big.mp4",
      contentType: "video/mp4",
      size: 80 * MB + 1,
    });
    expect(status).toBe(413);
    expect(body.error).toBe("FILE_TOO_LARGE");
    expect(body.message).toContain("80 MB");
  });

  it("lets an admin mint past 80 MB but not past the 1 GB ceiling", async () => {
    h.admin = true;
    const ok = await post("/api/upload-clip/session", {
      filename: "big.mp4",
      contentType: "video/mp4",
      size: 500 * MB,
    });
    expect(ok.status).toBe(200);
    const tooBig = await post("/api/upload-clip/session", {
      filename: "huge.mp4",
      contentType: "video/mp4",
      size: 1024 * MB + 1,
    });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.message).toContain("1 GB");
  });

  it("answers an honest 503 when storage is not configured", async () => {
    h.configured = false;
    const { status, body } = await post("/api/upload-clip/session", {
      filename: "clip.mp4",
      contentType: "video/mp4",
      size: 1000,
    });
    expect(status).toBe(503);
    expect(body.error).toContain("not available");
  });

  it("rejects a shapeless mint request", async () => {
    const { status } = await post("/api/upload-clip/session", { filename: "x.mp4" });
    expect(status).toBe(400);
  });
});

describe("POST /api/upload-clip/complete — the record", () => {
  it("records an existing clip and answers the { url, ref } shape", async () => {
    const { status, body } = await post("/api/upload-clip/complete", {
      key: "user-1/clips/1700000000000-abc.mp4",
    });
    expect(status).toBe(200);
    expect(body).toEqual({
      url: "https://cdn.example/user-1/clips/1700000000000-abc.mp4",
      ref: "https://cdn.example/user-1/clips/1700000000000-abc.mp4",
    });
    expect(h.head).toHaveBeenCalledWith("user-1/clips/1700000000000-abc.mp4");
  });

  it("refuses another member's key before touching storage", async () => {
    const { status, body } = await post("/api/upload-clip/complete", {
      key: "user-2/clips/1700000000000-abc.mp4",
    });
    expect(status).toBe(403);
    expect(body.error).toBe("Key not allowed.");
    expect(h.head).not.toHaveBeenCalled();
  });

  it("answers an honest 404 when the object never landed", async () => {
    h.head.mockImplementation(async () => null);
    const { status, body } = await post("/api/upload-clip/complete", {
      key: "user-1/clips/1700000000000-missing.mp4",
    });
    expect(status).toBe(404);
    expect(body.error).toContain("could not be found");
  });

  it("re-checks the real stored size against the member cap", async () => {
    h.head.mockImplementation(async () => ({ size: 90 * MB, contentType: "video/mp4" }));
    const { status, body } = await post("/api/upload-clip/complete", {
      key: "user-1/clips/1700000000000-big.mp4",
    });
    expect(status).toBe(413);
    expect(body.error).toBe("FILE_TOO_LARGE");
  });
});

describe("the retired door", () => {
  it("POST /api/upload-clip no longer exists — no server-transit path remains", async () => {
    const { status } = await post("/api/upload-clip", {});
    expect(status).toBe(404);
  });
});
