/**
 * S27-42 — Video Studio rail alignment pins.
 *
 * THE DEFECT (routes audit, confirmed live): pages/video-studio.tsx is
 * routed at /video-studio, but its generate action POSTed
 * /api/generate-video — no such API route exists, so Video Studio
 * generation ALWAYS threw. The page now drives the real video rail,
 * POST /api/generate-runway-clip (submit) + GET
 * /api/generate-runway-clip/:taskId (poll), with model "gen4.5".
 *
 * THE PIN: the exact request bodies the page sends are accepted by the
 * real router (mocked provider, mirroring runway-clip-effects.test.ts):
 *   - text mode → { taskId, creditCost: 400, model: "gen4.5",
 *     durationSec: 5 } — the flat GEN45_CREDIT_COST the page's CostBadge
 *     (400) and the FE registry entry for /api/generate-runway-clip
 *     (400) both promise;
 *   - image mode (referenceImageUrl) → image-to-video submission;
 *   - POST /generate-video stays 404 — the dead path must not come back.
 *
 * S27-72 UPDATE (rail ratio honesty): the original pin below recorded a
 * RAIL QUIRK — runway-clip.ts derived the provider ratio only from
 * locked-pack ingredients, so a non-pack gen4.5 submission reached the
 * provider as portrait 720:1280 even when the client sent "1280:720"
 * (Video Studio's 16:9 picks rendered portrait). That quirk is FIXED:
 * for non-pack submissions the validated body ratio is honored, an
 * absent body ratio keeps the portrait default, and a locked pack's
 * ratio still wins over a conflicting body ratio. The pins below assert
 * that corrected contract.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  submitted: [] as Array<{ via: string; args: Record<string, unknown> }>,
  /* When set, the getLockedPack mock returns this pack instead of
     throwing — used by the S27-72 pack-ratio-wins cases. */
  pack: null as null | { ingredients: Array<Record<string, unknown>> },
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
    if (h.pack) return h.pack;
    throw new Error("no pack in this test");
  }),
}));

vi.mock("@runwayml/sdk", () => ({
  default: class FakeRunway {
    imageToVideo = {
      create: async (args: Record<string, unknown>) => {
        h.submitted.push({ via: "imageToVideo", args });
        return { id: "task-img" };
      },
    };
    textToVideo = {
      create: async (args: Record<string, unknown>) => {
        h.submitted.push({ via: "textToVideo", args });
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
  h.pack = null;
});

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/* The exact bodies pages/video-studio.tsx sends (text / image modes). */
const TEXT_BODY = {
  promptText: "A shark king on a golden throne, dramatic lighting, cinematic, slow push in, dolly forward",
  ratio: "1280:720",
  model: "gen4.5",
};
const IMAGE_BODY = {
  ...TEXT_BODY,
  ratio: "720:1280",
  referenceImageUrl: "https://cdn.example/ref.png",
};

describe("S27-42 — the Video Studio page's submit contract", () => {
  it("text mode: POST /generate-runway-clip returns a taskId at the flat 400 VB gen4.5 price", async () => {
    const r = await post("/generate-runway-clip", TEXT_BODY);
    expect(r.status).toBe(200);
    expect(r.json.taskId).toBe("task-txt");
    expect(r.json.creditCost).toBe(400);
    expect(r.json.model).toBe("gen4.5");
    expect(r.json.durationSec).toBe(5);
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.via).toBe("textToVideo");
    expect(h.submitted[0]!.args["model"]).toBe("gen4.5");
    expect(h.submitted[0]!.args["duration"]).toBe(5);
    /* S27-72 CORRECTED CONTRACT (was: the RAIL QUIRK pin — a non-pack
       gen4.5 submission reached the provider as portrait 720:1280 even
       when the client sent ratio "1280:720"): the validated body ratio
       is now honored for non-pack submissions, so the landscape body
       the page sends for a 16:9 pick reaches the provider as 1280:720. */
    expect(h.submitted[0]!.args["ratio"]).toBe("1280:720");
  });

  it("image mode: a referenceImageUrl submits image-to-video", async () => {
    const r = await post("/generate-runway-clip", IMAGE_BODY);
    expect(r.status).toBe(200);
    expect(r.json.taskId).toBe("task-img");
    expect(r.json.creditCost).toBe(400);
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.via).toBe("imageToVideo");
    expect(h.submitted[0]!.args["promptImage"]).toBe("https://cdn.example/ref.png");
    expect(h.submitted[0]!.args["ratio"]).toBe("720:1280");
  });

  it("the dead path stays dead: POST /generate-video is a 404", async () => {
    const r = await post("/generate-video", TEXT_BODY);
    expect(r.status).toBe(404);
    expect(h.submitted).toHaveLength(0);
  });
});

describe("S27-72 — gen4.5 provider ratio honors the body (non-pack) / the pack (locked)", () => {
  it("non-pack image mode with ratio 1280:720 → provider called with 1280:720", async () => {
    const r = await post("/generate-runway-clip", { ...IMAGE_BODY, ratio: "1280:720" });
    expect(r.status).toBe(200);
    expect(r.json.taskId).toBe("task-img");
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.via).toBe("imageToVideo");
    expect(h.submitted[0]!.args["ratio"]).toBe("1280:720");
  });

  it("non-pack with NO ratio in the body → portrait default 720:1280 preserved", async () => {
    const { ratio: _omit, ...noRatioBody } = TEXT_BODY;
    const r = await post("/generate-runway-clip", noRatioBody);
    expect(r.status).toBe(200);
    expect(r.json.taskId).toBe("task-txt");
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.via).toBe("textToVideo");
    expect(h.submitted[0]!.args["ratio"]).toBe("720:1280");
  });

  it("locked pack ratio wins over a conflicting body ratio (pack portrait, body landscape)", async () => {
    h.pack = {
      ingredients: [
        {
          shotNumber: 1,
          prompt: "Locked pack shot: the king crosses the marble hall",
          negativePrompt: "",
          referenceAssetUrls: [],
          continuityNotes: "",
          model: "gen4.5",
          durationSec: 5,
          ratio: "720:1280",
        },
      ],
    };
    const r = await post("/generate-runway-clip", {
      packId: "pack-1",
      shotNumber: 1,
      ratio: "1280:720",
      model: "gen4.5",
    });
    expect(r.status).toBe(200);
    expect(r.json.model).toBe("gen4.5");
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.args["ratio"]).toBe("720:1280");
  });

  it("locked pack ratio wins over a conflicting body ratio (pack landscape, body portrait)", async () => {
    h.pack = {
      ingredients: [
        {
          shotNumber: 1,
          prompt: "Locked pack shot: a wide establishing sweep of the palace",
          negativePrompt: "",
          referenceAssetUrls: [],
          continuityNotes: "",
          model: "gen4.5",
          durationSec: 5,
          ratio: "1280:720",
        },
      ],
    };
    const r = await post("/generate-runway-clip", {
      packId: "pack-1",
      shotNumber: 1,
      ratio: "720:1280",
      model: "gen4.5",
    });
    expect(r.status).toBe(200);
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.args["ratio"]).toBe("1280:720");
  });

});
