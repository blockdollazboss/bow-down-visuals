/**
 * End-frame (last-frame) keyframe control — POST /generate-runway-clip.
 *
 * Pins, per model, exactly what reaches the provider request builders:
 *  - seedance2_5: the end frame is sent as a positioned keyframe
 *    (first frame 'first', end frame 'last'); with no end frame the
 *    request keeps its exact pre-end-frame shape.
 *  - gen4.5: the SDK's Gen4_5.PromptImage position is 'first' ONLY, so
 *    the end-frame parameter must be ABSENT — never sent-and-ignored.
 *  - veo3_1: still refused by the pricing gate (VEO_PRICING_APPROVED is
 *    an open owner price call) — 402 before any provider call, end frame
 *    or not.
 *  - locked packs: the shot's locked endFrameImageUrl ingredient wins
 *    over the per-request field (the end frame rides the pack).
 *  - charge discipline: an end frame never changes the credit cost.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  imageCalls: [] as any[],
  textCalls: [] as any[],
  veoCalls: [] as any[],
  lockedPack: null as any,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u);
    req.userCredits = Number(req.headers["x-test-credits"] ?? 1_000_000);
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({
  generationLimiter: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("@runwayml/sdk", () => ({
  default: class FakeRunway {
    imageToVideo = {
      create: async (args: any) => {
        h.imageCalls.push(args);
        return { id: `task-img-${h.imageCalls.length}` };
      },
    };
    textToVideo = {
      create: async (args: any) => {
        h.textCalls.push(args);
        return { id: `task-txt-${h.textCalls.length}` };
      },
    };
  },
}));
vi.mock("../../lib/veo-client", () => ({
  submitVeoVideo: async (opts: any) => { h.veoCalls.push(opts); return "operations/test-op"; },
  pollVeoOperation: async () => ({ done: false }),
  downloadVeoVideoToFile: async () => {},
}));
vi.mock("../../lib/supabase-admin", () => ({ getSupabaseAdmin: () => null }));
vi.mock("../../lib/rail-core", () => ({ invokeRailHandler: async () => ({}) }));
vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => ({ success: true }),
  LedgerWriteError: class LedgerWriteError extends Error {},
}));
vi.mock("../../lib/clip-charge-obligations", () => ({ recordClipCharge: async () => {} }));
vi.mock("../../lib/objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  uploadMediaToSupabaseStorage: async () => "supabase://generated-clips/x.jpg",
  uploadFileStreamToSupabaseStorage: async () => "supabase://generated-clips/x.mp4",
  parseSupabaseStorageRef: (v: string) =>
    typeof v === "string" && v.startsWith("supabase://") ? v.slice("supabase://".length) : null,
  refreshSupabaseStorageUrl: async (v: string) =>
    v.startsWith("supabase://") ? `https://cdn.test/${v.slice("supabase://".length)}` : v,
}));
vi.mock("../generate/pre-production", () => ({
  getLockedPack: async () => {
    if (!h.lockedPack) throw Object.assign(new Error("pack not locked"), { status: 404 });
    return h.lockedPack;
  },
}));

import runwayClipRouter from "../generate/runway-clip";
import { CLIP_END_FRAME_SUPPORT, modelSupportsEndFrame } from "../generate/clip-pricing";

const OWNER = randomUUID();
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

const REF = "https://cdn.test/start.jpg";
const END = "https://cdn.test/end.jpg";

beforeAll(async () => {
  process.env["RUNWAYML_API_SECRET"] = "test-secret";
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(runwayClipRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  h.imageCalls = []; h.textCalls = []; h.veoCalls = []; h.lockedPack = null;
});

async function submit(body: unknown) {
  const r = await realFetch(`${baseUrl}/generate-runway-clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": OWNER },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as any };
}

describe("support record (grounded in the vendored provider builders)", () => {
  it("gen4.5 has no last frame; seedance2_5 and veo3_1 do", () => {
    expect(CLIP_END_FRAME_SUPPORT).toEqual({ "gen4.5": false, seedance2_5: true, veo3_1: true });
    expect(modelSupportsEndFrame("gen4.5")).toBe(false);
    expect(modelSupportsEndFrame("seedance2_5")).toBe(true);
    expect(modelSupportsEndFrame("veo3_1")).toBe(true);
  });
});

describe("seedance2_5 end frame", () => {
  it("sends first + last as positioned keyframes and reports endFrameUsed", async () => {
    const { status, json } = await submit({
      promptText: "performer walks to the balcony",
      model: "seedance2_5",
      durationSec: 5,
      referenceImageUrl: REF,
      endFrameImageUrl: END,
    });
    expect(status).toBe(200);
    expect(json.endFrameUsed).toBe(true);
    expect(h.textCalls).toHaveLength(0);
    expect(h.imageCalls).toHaveLength(1);
    expect(h.imageCalls[0].promptImage).toEqual([
      { uri: REF, position: "first" },
      { uri: END, position: "last" },
    ]);
  });

  it("sends a lone end frame as a 'last' keyframe via image-to-video", async () => {
    const { status, json } = await submit({
      promptText: "city skyline at dusk",
      model: "seedance2_5",
      durationSec: 5,
      endFrameImageUrl: END,
    });
    expect(status).toBe(200);
    expect(json.endFrameUsed).toBe(true);
    expect(h.textCalls).toHaveLength(0);
    expect(h.imageCalls).toHaveLength(1);
    expect(h.imageCalls[0].promptImage).toEqual([{ uri: END, position: "last" }]);
  });

  it("resolves a storage-ref end frame to HTTPS before sending", async () => {
    const { status } = await submit({
      promptText: "neon alley",
      model: "seedance2_5",
      durationSec: 5,
      referenceImageUrl: REF,
      endFrameImageUrl: "supabase://generated-clips/frame-end.jpg",
    });
    expect(status).toBe(200);
    expect(h.imageCalls[0].promptImage).toEqual([
      { uri: REF, position: "first" },
      { uri: "https://cdn.test/generated-clips/frame-end.jpg", position: "last" },
    ]);
  });

  it("without an end frame the request keeps its exact old shape", async () => {
    const { status, json } = await submit({
      promptText: "performer walks to the balcony",
      model: "seedance2_5",
      durationSec: 5,
      referenceImageUrl: REF,
    });
    expect(status).toBe(200);
    expect(json.endFrameUsed).toBe(false);
    expect(h.imageCalls).toHaveLength(1);
    expect(h.imageCalls[0].promptImage).toBe(REF);
  });

  it("text-only seedance still goes text-to-video with no image parameter", async () => {
    const { status } = await submit({ promptText: "abstract gold waves", model: "seedance2_5", durationSec: 5 });
    expect(status).toBe(200);
    expect(h.imageCalls).toHaveLength(0);
    expect(h.textCalls).toHaveLength(1);
    expect(h.textCalls[0]).not.toHaveProperty("promptImage");
  });

  it("an end frame never changes the credit cost", async () => {
    const withEnd = await submit({
      promptText: "same scene", model: "seedance2_5", durationSec: 5,
      referenceImageUrl: REF, endFrameImageUrl: END,
    });
    const without = await submit({
      promptText: "same scene", model: "seedance2_5", durationSec: 5,
      referenceImageUrl: REF,
    });
    expect(withEnd.json.creditCost).toBe(without.json.creditCost);
  });
});

describe("gen4.5 — parameter absent, never sent-and-ignored", () => {
  it("image-to-video keeps the plain string promptImage even when an end frame is supplied", async () => {
    const { status, json } = await submit({
      promptText: "close-up performance",
      model: "gen4.5",
      referenceImageUrl: REF,
      endFrameImageUrl: END,
    });
    expect(status).toBe(200);
    expect(json.endFrameUsed).toBe(false);
    expect(h.imageCalls).toHaveLength(1);
    expect(h.imageCalls[0].promptImage).toBe(REF);
    expect(JSON.stringify(h.imageCalls[0])).not.toContain(END);
    expect(JSON.stringify(h.imageCalls[0])).not.toContain("last");
  });

  it("text-to-video carries no image parameter at all", async () => {
    const { status, json } = await submit({
      promptText: "close-up performance",
      model: "gen4.5",
      endFrameImageUrl: END,
    });
    expect(status).toBe(200);
    expect(json.endFrameUsed).toBe(false);
    expect(h.textCalls).toHaveLength(1);
    expect(h.textCalls[0]).not.toHaveProperty("promptImage");
  });
});

describe("veo3_1 — pricing refusal untouched", () => {
  it("refuses with the pricing gate before any provider call, end frame included", async () => {
    const { status, json } = await submit({
      promptText: "cinematic dolly shot",
      model: "veo3_1",
      referenceImageUrl: REF,
      endFrameImageUrl: END,
    });
    expect(status).toBe(402);
    expect(json.error).toBe("veo_pricing_pending_approval");
    expect(h.veoCalls).toHaveLength(0);
    expect(h.imageCalls).toHaveLength(0);
    expect(h.textCalls).toHaveLength(0);
  });
});

describe("locked pack — the end frame rides the pack", () => {
  it("the locked ingredient's end frame wins over the per-request field", async () => {
    h.lockedPack = {
      ingredients: [
        {
          shotNumber: 2,
          prompt: "LOCKED PROMPT — rooftop finale",
          negativePrompt: "",
          referenceAssetUrls: [],
          continuityNotes: "",
          model: "seedance2_5",
          durationSec: 5,
          ratio: "720:1280",
          endFrameImageUrl: "https://cdn.test/pack-end.jpg",
        },
      ],
    };
    const { status, json } = await submit({
      packId: "pack-1",
      shotNumber: 2,
      promptText: "client prompt that must be ignored",
      endFrameImageUrl: "https://cdn.test/request-end.jpg",
      referenceImageUrl: REF,
    });
    expect(status).toBe(200);
    expect(json.endFrameUsed).toBe(true);
    expect(h.imageCalls).toHaveLength(1);
    expect(h.imageCalls[0].promptImage).toEqual([
      { uri: REF, position: "first" },
      { uri: "https://cdn.test/pack-end.jpg", position: "last" },
    ]);
    expect(h.imageCalls[0].promptText).toContain("LOCKED PROMPT");
    expect(JSON.stringify(h.imageCalls[0])).not.toContain("request-end.jpg");
  });
});
