/**
 * voice-clone.test.ts — money-fairness contract for POST /api/clone-voice.
 *
 * The route sells ONE thing: a real provider library voice the singing
 * picker can select. The old shape silently fell back to an "openai-match"
 * profile when the provider path was unavailable — same 500 VB charge, no
 * library voice. These tests pin the corrected semantics against the REAL
 * handler with credits, the provider-capability check, storage, the DB,
 * ffprobe/ffmpeg, and outbound fetch all mocked:
 *
 *  - no provider key             → 503 BEFORE charging, nothing created;
 *  - account explicitly lacks IVC → 503 BEFORE charging, nothing created;
 *  - happy path                   → charged once, response carries
 *                                   voice.libraryVoiceId + source
 *                                   "elevenlabs", row stores the same id;
 *  - provider add fails post-charge → 502, refund issued, NO profile row
 *                                   (the fallback is never minted);
 *  - provider returns no voice_id → 502, refund issued, no row;
 *  - too-short sample             → 400 with refund (unchanged behavior).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { request as httpRequest } from "http";
import type { AddressInfo } from "net";
import type { Server } from "http";

/* ── Hoisted mock state ─────────────────────────────────────────────── */
const h = vi.hoisted(() => ({
  chargeCalls: [] as Array<{ userId: string; amount: number; opts: unknown }>,
  refundCalls: [] as Array<{ userId: string; amount: number; opts: unknown }>,
  inserted: [] as Array<Record<string, unknown>>,
  ivcAllowed: true,
  providerMode: "ok" as "ok" | "fail" | "novoice",
  probeDuration: "15.0",
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req["userId"] = "user-1";
    req["userCredits"] = 10_000;
    req["log"] = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: vi.fn(async (userId: string, amount: number, opts: unknown) => {
    h.chargeCalls.push({ userId, amount, opts });
    return 10_000 - amount;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number, opts: unknown) => {
    h.refundCalls.push({ userId, amount, opts });
  }),
}));

vi.mock("../../../lib/elevenlabs", () => ({
  canUseInstantVoiceCloning: vi.fn(async () => h.ivcAllowed),
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "voice-clones/user-1/sample.mp3"),
  refreshSupabaseStorageUrl: vi.fn(async () => "https://example.com/speech.mp3"),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          h.inserted.push(v);
          return [
            {
              id: "clone-row-1",
              name: v["name"],
              description: v["description"] ?? null,
              baseVoice: v["baseVoice"],
              createdAt: new Date("2026-01-01T00:00:00Z"),
            },
          ];
        },
      }),
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  },
}));

vi.mock("child_process", () => {
  const execFile = (
    file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    if (file === "ffprobe") cb(null, `${h.probeDuration}\n`, "");
    else cb(null, "", "RMS level dB: -18.5");
    return {};
  };
  /* The route uses promisify(execFile), which for the REAL execFile
     resolves { stdout, stderr } via its custom-promisify symbol — a plain
     callback mock would resolve only the stdout string and the route's
     destructuring would blow up. Provide the custom form too. */
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for("nodejs.util.promisify.custom")] = (
    file: string,
  ) =>
    Promise.resolve(
      file === "ffprobe"
        ? { stdout: `${h.probeDuration}\n`, stderr: "" }
        : { stdout: "", stderr: "RMS level dB: -18.5" },
    );
  return { execFile };
});

import voiceCloneRouter from "../voice-clone";

/* ── Test HTTP plumbing (real express server, http-module client so the
   global fetch stub below only has to cover the route's own calls) ── */
let server: Server;
let port: number;

function postClone(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/clone-voice",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as Record<string, unknown> });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const SAMPLE = { name: "Stage Voice", sampleUrl: "https://cdn.example.com/sample.mp3" };

beforeEach(async () => {
  h.chargeCalls.length = 0;
  h.refundCalls.length = 0;
  h.inserted.length = 0;
  h.ivcAllowed = true;
  h.providerMode = "ok";
  h.probeDuration = "15.0";
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === SAMPLE.sampleUrl) {
        return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      }
      if (url === "https://api.elevenlabs.io/v1/voices/add") {
        if (h.providerMode === "fail") {
          return { ok: false, status: 500, text: async () => "provider boom" };
        }
        if (h.providerMode === "novoice") {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ voice_id: "el-voice-123" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );

  const app = express();
  app.use(express.json());
  app.use(voiceCloneRouter);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("POST /api/clone-voice — availability gate (no charge)", () => {
  it("503s before charging when no provider key is set", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const res = await postClone(SAMPLE);
    expect(res.status).toBe(503);
    expect(String(res.json["error"])).toMatch(/isn't available/);
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.refundCalls).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
  });

  it("503s before charging when the account explicitly lacks instant cloning", async () => {
    h.ivcAllowed = false;
    const res = await postClone(SAMPLE);
    expect(res.status).toBe(503);
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
  });
});

describe("POST /api/clone-voice — happy path", () => {
  it("charges 500 once and returns the library voice id", async () => {
    const res = await postClone(SAMPLE);
    expect(res.status).toBe(200);
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0]).toMatchObject({ userId: "user-1", amount: 500 });
    expect(h.refundCalls).toHaveLength(0);
    const voice = res.json["voice"] as Record<string, unknown>;
    expect(voice["source"]).toBe("elevenlabs");
    expect(voice["libraryVoiceId"]).toBe("el-voice-123");
    expect(res.json["creditsRemaining"]).toBe(9_500);
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({ elevenlabsVoiceId: "el-voice-123", source: "elevenlabs" });
  });
});

describe("POST /api/clone-voice — provider failure after charge", () => {
  it("refunds and creates NO fallback profile when the provider add fails", async () => {
    h.providerMode = "fail";
    const res = await postClone(SAMPLE);
    expect(res.status).toBe(502);
    expect(String(res.json["error"])).toMatch(/refunded/);
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundCalls[0]).toMatchObject({ userId: "user-1", amount: 500 });
    expect(h.inserted).toHaveLength(0);
  });

  it("refunds and creates nothing when the provider returns no voice_id", async () => {
    h.providerMode = "novoice";
    const res = await postClone(SAMPLE);
    expect(res.status).toBe(502);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.inserted).toHaveLength(0);
  });
});

describe("POST /api/clone-voice — unchanged behaviors", () => {
  it("still rejects a too-short sample with a refund", async () => {
    h.probeDuration = "5.0";
    const res = await postClone(SAMPLE);
    expect(res.status).toBe(400);
    expect(String(res.json["error"])).toMatch(/too short/);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.inserted).toHaveLength(0);
  });
});
