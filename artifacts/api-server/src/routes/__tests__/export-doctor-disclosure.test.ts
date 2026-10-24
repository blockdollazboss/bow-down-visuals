/* Export-doctor — AI-disclosure pins (Stack-100 #3, more-provenance).
 * Every doctor export endpoint uploads through the one funnel
 * (uploadDoctorExport), so the Scene-1 export path pins the shared
 * semantics: disclosure ON by default, explicit false opts out, the
 * stamp lands in the uploaded file's metadata BEFORE upload, and a
 * stamp failure reports stamp_failed while the export still ships.
 * Real HTTP + real ffmpeg; auth, R2 and the stamp switch are mocked. */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const h = vi.hoisted(() => {
  /* SUPABASE_HOST is read at module load — set it before the router
     module is imported (vi.hoisted runs first). */
  process.env["SUPABASE_URL"] = "https://supabase.example.co";
  return {
    uploads: [] as Array<{ objectName: string; buffer: Buffer }>,
    failStamp: false,
  };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/r2-client", () => ({
  isR2Configured: () => true,
  r2Upload: vi.fn(async (objectName: string, body: Buffer) => {
    h.uploads.push({ objectName, buffer: Buffer.from(body) });
    return objectName;
  }),
  r2GetSignedUrl: vi.fn(async (objectName: string) => `https://r2.example/${objectName}`),
}));

vi.mock("../../lib/objectStorage", () => ({
  objectStorageClient: {
    bucket: () => ({
      file: () => ({ save: async () => undefined }),
    }),
  },
}));

vi.mock("../../lib/disclosure-metadata", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    stampVideoFileWithDisclosure: async (...args: any[]) => {
      if (h.failStamp) return false;
      return actual.stampVideoFileWithDisclosure(...args);
    },
  };
});

import doctorRouter from "../generate/export-doctor";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let sourceVideo: Buffer;
let doctorId = "";

async function probeFormatTags(buffer: Buffer): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "doctor-probe-"));
  const p = join(dir, "out.mp4");
  await writeFile(p, buffer);
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format_tags", "-of", "json", p,
  ]);
  return (JSON.parse(stdout).format?.tags ?? {}) as Record<string, string>;
}

async function post(path: string, body: Record<string, unknown>) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "doctor-src-"));
  const src = join(dir, "src.mp4");
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", src,
  ]);
  sourceVideo = await readFile(src);

  vi.stubGlobal("fetch", async (url: unknown, init?: any) => {
    const u = String(url);
    /* Object-storage sidecar (fresh signed URLs) — unavailable in tests,
       so the download keeps its original URL, as production does then. */
    if (u.includes("127.0.0.1:1106")) return new Response("nope", { status: 500 });
    if (u.includes("supabase.example.co")) {
      return new Response(sourceVideo, { status: 200, headers: { "content-type": "video/mp4" } });
    }
    return realFetch(url as any, init);
  });

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  });
  app.use(doctorRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const dl = await post("/export-doctor/download", {
    projectId: "p1",
    url: "https://supabase.example.co/storage/v1/object/public/media/scene1.mp4",
  });
  expect(dl.status).toBe(200);
  expect(dl.json.ffprobeValid).toBe(true);
  doctorId = dl.json.doctorId;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.uploads = [];
  h.failStamp = false;
});

describe("POST /export-doctor/export — AI disclosure (shared funnel)", () => {
  it("DEFAULT ON: the uploaded export carries the disclosure in its metadata", async () => {
    const out = await post("/export-doctor/export", { doctorId });
    expect(out.status).toBe(200);
    expect(out.json.success).toBe(true);
    expect(out.json.aiDisclosure).toBe("embedded");
    expect(out.json.url).toContain("https://r2.example/export-doctor/");
    expect(h.uploads).toHaveLength(1);
    const tags = await probeFormatTags(h.uploads[0]!.buffer);
    expect(tags.comment ?? "").toContain("AI-generated content");
    expect(tags.comment ?? "").toContain("Video Editor");
  });

  it("OPT-OUT: aiDisclosure:false ships unstamped and reports off", async () => {
    const out = await post("/export-doctor/export", { doctorId, aiDisclosure: false });
    expect(out.status).toBe(200);
    expect(out.json.success).toBe(true);
    expect(out.json.aiDisclosure).toBe("off");
    expect(h.uploads).toHaveLength(1);
    const tags = await probeFormatTags(h.uploads[0]!.buffer);
    expect(tags.comment ?? "").not.toContain("AI-generated content");
  });

  it("STAMP FAILURE: the export still ships and reports stamp_failed honestly", async () => {
    h.failStamp = true;
    const out = await post("/export-doctor/export", { doctorId });
    expect(out.status).toBe(200);
    expect(out.json.success).toBe(true);
    expect(out.json.aiDisclosure).toBe("stamp_failed");
    expect(out.json.url).toContain("https://r2.example/export-doctor/");
    expect(h.uploads).toHaveLength(1);
    const tags = await probeFormatTags(h.uploads[0]!.buffer);
    expect(tags.comment ?? "").not.toContain("AI-generated content");
  });
});
