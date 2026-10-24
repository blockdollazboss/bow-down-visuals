/* Multi-ratio export — AI-disclosure pins (Stack-100 #3, more-provenance).
 * The door joins the F7 disclosure kit: disclosure is ON by default, an
 * explicit false opts out, the stamp lands in the uploaded file's
 * container metadata BEFORE upload, and a stamp failure reports
 * stamp_failed while the ratio still ships. Driven over real HTTP with
 * real ffmpeg renders; only auth/credits/storage/queue are mocked. */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const h = vi.hoisted(() => ({
  uploads: [] as Array<{ objectName: string; buffer: Buffer }>,
  queued: [] as Array<() => Promise<void>>,
  failStamp: false,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 99_900),
  refundCredits: vi.fn(async () => 99_900),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (objectName: string, buffer: Buffer) => {
    h.uploads.push({ objectName, buffer });
    return `supabase://media/${objectName}`;
  }),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://signed.example/${ref}`),
}));

vi.mock("../../lib/export-jobs", () => ({
  enqueueExport: (fn: () => Promise<void>) => {
    h.queued.push(fn);
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

import multiRatioRouter from "../generate/export-multi-ratio";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let sourceVideo: Buffer;

async function probeFormatTags(buffer: Buffer): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "mr-probe-"));
  const p = join(dir, "out.mp4");
  await writeFile(p, buffer);
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format_tags", "-of", "json", p,
  ]);
  return (JSON.parse(stdout).format?.tags ?? {}) as Record<string, string>;
}

async function runJob(body: Record<string, unknown>) {
  const res = await realFetch(`${baseUrl}/export-multi-ratio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  const created = (await res.json()) as any;
  const fn = h.queued.shift();
  expect(fn).toBeTruthy();
  await fn!();
  const jobRes = await realFetch(`${baseUrl}/export-multi-ratio/job/${created.jobId}`);
  expect(jobRes.status).toBe(200);
  return (await jobRes.json()) as any;
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "mr-src-"));
  const src = join(dir, "src.mp4");
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src,
  ]);
  sourceVideo = await readFile(src);

  vi.stubGlobal("fetch", async (url: unknown) => {
    if (String(url).includes("source.example")) {
      return new Response(sourceVideo, { status: 200 });
    }
    return realFetch(url as any);
  });

  const app = express();
  app.use(express.json());
  app.use(multiRatioRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.uploads = [];
  h.queued = [];
  h.failStamp = false;
});

describe("POST /export-multi-ratio — AI disclosure", () => {
  it("DEFAULT ON: the uploaded ratio carries the disclosure in its metadata", async () => {
    const job = await runJob({ videoUrl: "https://source.example/video.mp4", ratios: ["1:1"] });
    expect(job.state).toBe("done");
    expect(job.aiDisclosure).toBe(true);
    expect(job.ratios[0].state).toBe("done");
    expect(job.ratios[0].aiDisclosure).toBe("embedded");
    expect(job.ratios[0].url).toContain("https://signed.example/");
    expect(h.uploads).toHaveLength(1);
    const tags = await probeFormatTags(h.uploads[0]!.buffer);
    expect(tags.comment ?? "").toContain("AI-generated content");
    expect(tags.comment ?? "").toContain("Multi-Ratio Export");
    expect(tags.description ?? "").toContain("AI-generated content");
  });

  it("OPT-OUT: aiDisclosure:false ships unstamped and reports off", async () => {
    const job = await runJob({ videoUrl: "https://source.example/video.mp4", ratios: ["1:1"], aiDisclosure: false });
    expect(job.state).toBe("done");
    expect(job.aiDisclosure).toBe(false);
    expect(job.ratios[0].aiDisclosure).toBe("off");
    expect(h.uploads).toHaveLength(1);
    const tags = await probeFormatTags(h.uploads[0]!.buffer);
    expect(tags.comment ?? "").not.toContain("AI-generated content");
  });

  it("STAMP FAILURE: the ratio still ships and reports stamp_failed honestly", async () => {
    h.failStamp = true;
    const job = await runJob({ videoUrl: "https://source.example/video.mp4", ratios: ["1:1"] });
    expect(job.state).toBe("done");
    expect(job.ratios[0].state).toBe("done");
    expect(job.ratios[0].aiDisclosure).toBe("stamp_failed");
    expect(job.ratios[0].url).toContain("https://signed.example/");
    expect(h.uploads).toHaveLength(1);
    const tags = await probeFormatTags(h.uploads[0]!.buffer);
    expect(tags.comment ?? "").not.toContain("AI-generated content");
  });
});
