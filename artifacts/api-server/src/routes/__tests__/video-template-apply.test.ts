/**
 * Stack-28 item 18 (audit A6-T2) — the template refund pin.
 *
 * POST /api/video-template/apply charges TEMPLATE_COST (250) up front
 * and its background render refunds on failure — the wiring existed
 * but NO suite exercised it, so one silent edit could regress the
 * money path. This suite runs the real router over HTTP with the
 * credit ledger, storage and ffmpeg faked at the edges:
 *  - 402 pre-check: insufficient credits → no charge, no job;
 *  - unknown template / wrong slot count → 400, no charge;
 *  - success: exactly one 250 charge, NO refund, job done with a URL;
 *  - render failure: the 250 charge is refunded exactly once with the
 *    "Video Template — Refund" action, and the job reports failed.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  ffmpegFail: false,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(u);
    req.userCredits = Number(req.headers["x-test-credits"] ?? 10000);
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 9750),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (name: string) => `supabase://generated-clips/${name}`),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://cdn.example/${ref}`),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} },
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const run = (file: string, args: string[]): { stdout: string; stderr: string } => {
    if (file === "ffprobe") {
      return {
        stdout: JSON.stringify({
          format: { duration: "3.2" },
          streams: [{ codec_type: "video" }, { codec_type: "audio" }],
        }),
        stderr: "",
      };
    }
    if (file === "ffmpeg") {
      if (h.ffmpegFail) throw new Error("ffmpeg boom");
      writeFileSync(args[args.length - 1]!, Buffer.from("fake-video"));
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected execFile: ${file}`);
  };
  const execFileMock = (file: string, args: string[], opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    try {
      const { stdout, stderr } = run(file, args);
      callback(null, stdout, stderr);
    } catch (err) {
      callback(err as Error, "", "");
    }
  };
  /* The route uses promisify(execFile): Node's execFile carries a
     custom promisify resolving { stdout, stderr } — the mock must
     carry the same symbol or ffprobe's stdout destructures to
     undefined and every probe reads as "no video stream". */
  (execFileMock as any)[Symbol.for("nodejs.util.promisify.custom")] = async (
    file: string,
    args: string[],
  ) => run(file, args);
  return { ...actual, execFile: execFileMock };
});

import videoTemplateRouter from "../generate/video-template";
import { chargeCredits, refundCredits } from "../../lib/credits";

const TEMPLATE_COST = 250; // routes/generate/video-template.ts TEMPLATE_COST
const APPLY_BODY = {
  template: "before-after-reveal",
  slots: [{ url: "https://media.example/before.mp4" }, { url: "https://media.example/after.mp4" }],
  overlays: ["BEFORE", "AFTER"],
};

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(videoTemplateRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The render downloads slot media through the global fetch — serve
  // it in-process; the suite's own HTTP calls use realFetch.
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  }));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.ffmpegFail = false;
  vi.clearAllMocks();
});

async function apply(body: unknown = APPLY_BODY, credits?: number) {
  const r = await realFetch(`${baseUrl}/video-template/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user": "user-1",
      ...(credits !== undefined ? { "x-test-credits": String(credits) } : {}),
    },
    body: JSON.stringify(body),
  });
  const json: any = await r.json().catch(() => null);
  return { status: r.status, json };
}

async function pollJob(jobId: string) {
  const r = await realFetch(`${baseUrl}/video-template/job/${jobId}`, {
    headers: { "x-test-user": "user-1" },
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** The render runs on the route's serial background queue — poll the
    job endpoint until it settles (done/failed) or the budget runs out. */
async function settleJob(jobId: string): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const { json } = await pollJob(jobId);
    if (json?.state === "done" || json?.state === "failed") return json;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("template job did not settle in time");
}

describe("POST /api/video-template/apply — charge-on-success, refund-on-failure (Stack-28 item 18)", () => {
  it("402 pre-check: insufficient credits charges nothing and creates no job", async () => {
    const { status, json } = await apply(APPLY_BODY, TEMPLATE_COST - 1);
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    expect(vi.mocked(refundCredits)).not.toHaveBeenCalled();
  });

  it("unknown template and wrong slot count are 400 before any charge", async () => {
    const unknown = await apply({ ...APPLY_BODY, template: "no-such-template" });
    expect(unknown.status).toBe(400);
    const short = await apply({ ...APPLY_BODY, slots: [APPLY_BODY.slots[0]] });
    expect(short.status).toBe(400);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });

  it("success: charges exactly 250 once, never refunds, job completes with a result URL", async () => {
    const { status, json } = await apply();
    expect(status).toBe(202);
    expect(json.price).toBe(TEMPLATE_COST);
    expect(json.jobId).toBeTruthy();
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledWith(
      "user-1",
      TEMPLATE_COST,
      expect.objectContaining({ action: expect.stringContaining("Video Template") }),
    );

    const job = await settleJob(json.jobId);
    expect(job.state).toBe("done");
    expect(job.result?.url).toContain("https://cdn.example/");
    expect(vi.mocked(refundCredits)).not.toHaveBeenCalled();
  });

  it("render failure: the 250 charge is refunded exactly once and the job reports failed", async () => {
    h.ffmpegFail = true;
    const { status, json } = await apply();
    expect(status).toBe(202);
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledWith(
      "user-1",
      TEMPLATE_COST,
      expect.objectContaining({ action: expect.stringContaining("Video Template") }),
    );

    const job = await settleJob(json.jobId);
    expect(job.state).toBe("failed");
    expect(job.error).toBeTruthy();
    expect(vi.mocked(refundCredits)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refundCredits)).toHaveBeenCalledWith(
      "user-1",
      TEMPLATE_COST,
      expect.objectContaining({ action: "Video Template — Refund" }),
    );
  });
});
