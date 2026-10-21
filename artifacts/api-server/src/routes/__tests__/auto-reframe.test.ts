/**
 * Auto-reframe v2 — route pins over HTTP (express + mocked rails):
 *  - tracking OFF reproduces the v1 centre crop byte-for-byte and
 *    never touches the detector;
 *  - a trustworthy subject track renders a tracked crop filter and
 *    the response labels itself "subject-tracked";
 *  - no subject / tracker unavailable → centre crop, honestly
 *    labeled with the reason — never dressed up as tracking;
 *  - the v1 charge discipline is untouched: 200 up front, refund
 *    on render failure, 402 before any charge when broke.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  ffmpegCalls: [] as string[][],
  ffmpegFail: false,
  detectorCalls: 0,
  detectorImpl: null as null | (() => Promise<unknown>),
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
  chargeCredits: vi.fn(async () => 9800),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "reframe/test/out.mp4"),
  refreshSupabaseStorageUrl: vi.fn(async () => "https://cdn.example/out.mp4"),
}));

vi.mock("../../lib/subject-detector", () => ({
  detectSubjectsInVideo: async () => {
    h.detectorCalls++;
    if (!h.detectorImpl) throw new Error("detector impl not set");
    return h.detectorImpl();
  },
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    execFile: (file: string, args: string[], opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === "function" ? opts : cb) as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      if (file === "ffmpeg") {
        h.ffmpegCalls.push([...args]);
        if (h.ffmpegFail) {
          callback(new Error("ffmpeg boom"), "", "");
          return;
        }
        writeFileSync(args[args.length - 1]!, Buffer.from("fake-mp4"));
        callback(null, "", "");
        return;
      }
      callback(new Error(`unexpected execFile: ${file}`), "", "");
    },
  };
});

import reframeRouter from "../generate/auto-reframe";
import { chargeCredits, refundCredits } from "../../lib/credits";
import type { DetectionSample } from "../../lib/reframe-tracking";

const CENTRE_916 =
  "crop='if(gt(iw/ih,0.562500),ih*0.562500,iw)':'if(gt(iw/ih,0.562500),ih,iw/0.562500)'," +
  "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

function detectionWithSamples(samples: DetectionSample[]) {
  return {
    samples,
    width: 1280,
    height: 720,
    durationSec: 4,
    engine: "rvm-onnx" as const,
  };
}

function walkingDetection() {
  const samples: DetectionSample[] = [];
  for (let i = 0; i < 8; i++) {
    const cx = 0.25 + 0.0625 * i;
    samples.push({
      t: 0.25 + i * 0.5,
      box: { x: cx - 0.07, y: 0.25, w: 0.14, h: 0.5 },
      coverage: 0.05,
    });
  }
  return detectionWithSamples(samples);
}

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
  app.use(reframeRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal(
    "fetch",
    async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  h.ffmpegCalls.length = 0;
  h.ffmpegFail = false;
  h.detectorCalls = 0;
  h.detectorImpl = null;
  vi.clearAllMocks();
});

async function post(body: unknown, credits?: number) {
  const r = await realFetch(`${baseUrl}/auto-reframe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user": "user-1",
      ...(credits !== undefined ? { "x-test-credits": String(credits) } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

function vfArg(): string {
  const call = h.ffmpegCalls[0];
  expect(call).toBeTruthy();
  const idx = call!.indexOf("-vf");
  return call![idx + 1]!;
}

describe("auto-reframe v2", () => {
  it("tracking off: exact v1 centre crop, detector never runs", async () => {
    const { status, body } = await post({
      videoUrl: "https://files.example/v.mp4",
      aspect: "9:16",
      trackSubject: false,
    });
    expect(status).toBe(200);
    expect(h.detectorCalls).toBe(0);
    expect(vfArg()).toBe(CENTRE_916);
    expect(body.reframe).toEqual({
      mode: "centre-crop",
      reason: "tracking-off",
      samples: 0,
      trackedSamples: 0,
    });
    expect(body.url).toBe("https://cdn.example/out.mp4");
    expect(body.creditsRemaining).toBe(9800);
  });

  it("tracked: renders a subject-following crop and labels it", async () => {
    h.detectorImpl = async () => walkingDetection();
    const { status, body } = await post({
      videoUrl: "https://files.example/v.mp4",
      aspect: "9:16",
    });
    expect(status).toBe(200);
    expect(h.detectorCalls).toBe(1);
    const vf = vfArg();
    expect(vf.startsWith("crop=404:720:'clip(if(lt(t,")).toBe(true);
    expect(vf).not.toBe(CENTRE_916);
    expect(body.reframe.mode).toBe("subject-tracked");
    expect(body.reframe.reason).toBeNull();
    expect(body.reframe.samples).toBe(8);
    expect(body.reframe.trackedSamples).toBe(8);
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledWith(
      "user-1",
      200,
      expect.objectContaining({ action: "Auto Reframe" }),
    );
  });

  it("no subject: centre crop, labeled no-subject — not tracking", async () => {
    h.detectorImpl = async () =>
      detectionWithSamples([
        { t: 0.5, box: null, coverage: 0 },
        { t: 1.5, box: null, coverage: 0 },
        { t: 2.5, box: null, coverage: 0 },
        { t: 3.5, box: null, coverage: 0 },
      ]);
    const { status, body } = await post({
      videoUrl: "https://files.example/v.mp4",
      aspect: "9:16",
    });
    expect(status).toBe(200);
    expect(vfArg()).toBe(CENTRE_916);
    expect(body.reframe.mode).toBe("centre-crop");
    expect(body.reframe.reason).toBe("no-subject");
    expect(body.reframe.samples).toBe(4);
    expect(body.reframe.trackedSamples).toBe(0);
  });

  it("tracker unavailable: centre crop, labeled tracker-unavailable", async () => {
    h.detectorImpl = async () => null;
    const { status, body } = await post({
      videoUrl: "https://files.example/v.mp4",
      aspect: "9:16",
    });
    expect(status).toBe(200);
    expect(vfArg()).toBe(CENTRE_916);
    expect(body.reframe).toEqual({
      mode: "centre-crop",
      reason: "tracker-unavailable",
      samples: 0,
      trackedSamples: 0,
    });
  });

  it("render failure refunds the 200 charge", async () => {
    h.detectorImpl = async () => walkingDetection();
    h.ffmpegFail = true;
    const { status } = await post({
      videoUrl: "https://files.example/v.mp4",
      aspect: "9:16",
    });
    expect(status).toBe(500);
    expect(vi.mocked(refundCredits)).toHaveBeenCalledWith(
      "user-1",
      200,
      expect.objectContaining({ action: "Auto Reframe — Refund" }),
    );
  });

  it("402 before any charge when the balance is short", async () => {
    const { status, body } = await post(
      { videoUrl: "https://files.example/v.mp4", aspect: "9:16" },
      100,
    );
    expect(status).toBe(402);
    expect(body.error).toBe("out_of_credits");
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    expect(h.detectorCalls).toBe(0);
    expect(h.ffmpegCalls.length).toBe(0);
  });
});
