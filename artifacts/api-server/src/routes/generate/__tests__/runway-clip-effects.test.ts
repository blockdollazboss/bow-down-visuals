/**
 * Viral Effects × generation pins (routes/generate/runway-clip.ts):
 *  - a picked effect's construction is woven into the prompt the provider
 *    actually receives;
 *  - NO effects (field absent or empty) → the submitted prompt is
 *    byte-identical to the pre-rail construction;
 *  - effects ride the existing generation charge — the quoted creditCost
 *    is identical with and without effects;
 *  - unknown effect ids 400 (never silently dropped) and stacking past
 *    the cap 400s at validation.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  submitted: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 4242),
  chargeCreditsAtomic: vi.fn(async () => 4242),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "clips/test.mp4"),
  uploadFileStreamToSupabaseStorage: vi.fn(async () => "clips/test.mp4"),
  SUPABASE_CLIPS_BUCKET: "clips",
  refreshSupabaseStorageUrl: async (ref: string) => `https://minted.test/${ref}`,
  parseSupabaseStorageRef: () => null,
}));

vi.mock("../../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

vi.mock("../../../lib/rail-core", () => ({
  invokeRailHandler: vi.fn(async () => ({ status: 200, body: {} })),
}));

vi.mock("../../../lib/clip-charge-obligations", () => ({
  recordClipCharge: vi.fn(async () => {}),
}));

vi.mock("../../../lib/veo-client", () => ({
  submitVeoVideo: vi.fn(async () => "operations/test"),
  pollVeoOperation: vi.fn(async () => ({ done: false })),
  downloadVeoVideoToFile: vi.fn(async () => {}),
}));

vi.mock("../pre-production", () => ({
  getLockedPack: vi.fn(async () => {
    throw new Error("no pack in this test");
  }),
}));

vi.mock("@runwayml/sdk", () => ({
  default: class FakeRunway {
    imageToVideo = {
      create: async (args: Record<string, unknown>) => {
        h.submitted.push(args);
        return { id: "task-img" };
      },
    };
    textToVideo = {
      create: async (args: Record<string, unknown>) => {
        h.submitted.push(args);
        return { id: "task-txt" };
      },
    };
  },
}));

import runwayClipRouter from "../runway-clip";

let server: any;
let baseUrl: string;

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
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  h.submitted.length = 0;
});

const PROMPT = "A singer performs on a rooftop stage at night, dramatic spotlight";

async function submit(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/generate-runway-clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("POST /generate-runway-clip with Viral Effects", () => {
  it("weaves the picked effect's construction into the submitted prompt", async () => {
    const { status, json } = await submit({ promptText: PROMPT, effectIds: ["bullet-time-freeze"] });
    expect(status).toBe(200);
    expect(json.effectsApplied).toEqual(["bullet-time-freeze"]);
    expect(h.submitted).toHaveLength(1);
    const sent = String(h.submitted[0]!["promptText"]);
    expect(sent).toContain("Viral effect — Bullet-Time Freeze Arc:");
    expect(sent).toContain("motion freezes completely");
    expect(sent).toContain("A singer performs on a rooftop stage");
  });

  it("no-effect submissions are byte-identical with the field absent or empty", async () => {
    const a = await submit({ promptText: PROMPT });
    const b = await submit({ promptText: PROMPT, effectIds: [] });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(h.submitted).toHaveLength(2);
    const pa = String(h.submitted[0]!["promptText"]);
    const pb = String(h.submitted[1]!["promptText"]);
    expect(pa).toBe(pb);
    expect(pa).not.toContain("Viral effect");
    expect(a.json.effectsApplied).toEqual([]);
    /* Same charge either way — effects ride the generation charge. */
    expect(a.json.creditCost).toBe(b.json.creditCost);
  });

  it("effect picks do not change the quoted credit cost", async () => {
    const plain = await submit({ promptText: PROMPT });
    const effected = await submit({ promptText: PROMPT, effectIds: ["earth-zoom-out", "neon-outline"] });
    expect(effected.status).toBe(200);
    expect(effected.json.effectsApplied).toEqual(["earth-zoom-out", "neon-outline"]);
    expect(effected.json.creditCost).toBe(plain.json.creditCost);
  });

  it("unknown effect id → 400, nothing submitted", async () => {
    const { status, json } = await submit({ promptText: PROMPT, effectIds: ["not-real"] });
    expect(status).toBe(400);
    expect(json.error).toBe("unknown_effect");
    expect(h.submitted).toHaveLength(0);
  });

  it("stacking past the cap → 400 at validation, nothing submitted", async () => {
    const { status } = await submit({
      promptText: PROMPT,
      effectIds: ["earth-zoom-out", "neon-outline", "vhs-rewind"],
    });
    expect(status).toBe(400);
    expect(h.submitted).toHaveLength(0);
  });
});
